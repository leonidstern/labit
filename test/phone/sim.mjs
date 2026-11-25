// Phone checks in real mobile browsers: Safari in the iOS simulator, and the "Chrome stand-in" app there (a WKWebView
// with Chrome's layout and user agent; real Chrome can't be installed in a simulator). Not part of `npm test` or CI:
// the touches come from outside the page (the simulator's own touch input), one step at a time.
//
//   node test/phone/sim.mjs serve            starts a lab on the test page (:4470, or PHONE_PORT) and the recorder's sink (the next port)
//   node test/phone/sim.mjs next [--as NAME]  says what to do next, with the screen point to touch, and starts its clock
//   (touch the simulator as it says)
//   node test/phone/sim.mjs check            checks what the recorder saw since `next`, prints ok / FAIL lines
//   node test/phone/sim.mjs report           all results so far, per browser
//   node test/phone/sim.mjs go <step>         jumps to a step by name (calibrate first, then e.g. ask-open or board-open)
//
// Steps: calibrate, the taps and holds on the page (tap-no-pin .. swipe-no-pin), ask-open / ask-pick (a
// question with choices: a tap answers after 5 s with undo, no Keep), board-open .. board-close (a board over the page).
// Before the first hold: run the tool's set_keyboard show (after its `text` action too: typing switches the simulator to a hardware
// keyboard and no keyboard comes up). If a thread's card reads y < 0 or a tap on the dimmed page does nothing, Safari is painted out of step
// with its rects after the keyboard toggling: open the page again (open_url) and `go` to the step.
// Taps below y 780 land on Safari's toolbar, not the page: `next` says so when a point is that low (scroll first).
//
// The page (test/phone/page) has a recorder (probe.js) that logs, every frame while something happens: scroll, what
// the keyboard covers, what has focus, the selection, the pins and boxes, and where the page's paragraphs sit on screen.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(os.tmpdir(), 'labit-phone');
const STATE = path.join(RUN, 'state.json');
const LOG = path.join(RUN, 'probe.jsonl');
const LAB = Number(process.env.PHONE_PORT) || 4470, SINK = LAB + 1, B = `http://127.0.0.1:${LAB}`; // PHONE_PORT: when something else sits on 4470 or 4471
const [cmd, ...args] = process.argv.slice(2);
const read = () => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { as: 'safari', step: 0, off: null, results: {} });
const save = (s) => fs.writeFileSync(STATE, JSON.stringify(s, null, 1));
const lines = (as = read().as) => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((l) => !as || l.ua === as) : []); // one browser's lines: another one's tab may still be sending
const snaps = (as) => lines(as).filter((l) => l.why !== 'answer'); // the recorder's frames (an answer to `ask` is no frame)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const comments = async () => (await (await fetch(`${B}/_lab/api/comments?page=/index`)).json()).comments || [];
// Runs JavaScript in the open page (probe.js evaluates it, with the widget's shadow root as `shadow`) and returns its answer.
const inPage = async (js) => {
  const from = Date.now();
  fs.writeFileSync(path.join(RUN, 'ask.js'), js);
  for (let i = 0; i < 30; i++) { await sleep(300); const a = lines().find((l) => l.why === 'answer' && l.at >= from); if (a) return a.answer; }
  return null;
};
// The agent's calls as the lab sees them (the server's own key), for the question the ask steps put on the page.
const agentPost = (body) => {
  const key = JSON.parse(fs.readFileSync(path.join(RUN, 'site/.lab/server.json'), 'utf8')).agent;
  return fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-admin': key, 'x-lab-agent': '1' }, body: JSON.stringify({ page: '/index', ...body }) }).then((r) => r.json());
};

if (cmd === 'serve') {
  fs.rmSync(RUN, { recursive: true, force: true });
  const dir = path.join(RUN, 'site');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(path.join(HERE, 'page'))) fs.copyFileSync(path.join(HERE, 'page', f), path.join(dir, f));
  save(read());
  const env = { ...process.env, LABIT_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'labit-phone-home-')), LABIT_NO_UPDATE_CHECK: '1' };
  const lab = spawn(process.execPath, [path.join(HERE, '../../local.mjs'), '.', '--new', '--no-open', '--port', String(LAB)], { cwd: dir, env, stdio: 'inherit' });
  http.createServer((req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    if (req.url === '/ask') { const f = path.join(RUN, 'ask.js'); const js = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; fs.rmSync(f, { force: true }); return res.end(js); }
    if (req.method !== 'POST') return res.end();
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const { ua, lines: ls } = JSON.parse(body);
        fs.appendFileSync(LOG, ls.map((l) => JSON.stringify({ ...l, ua: /CriOS/.test(ua) ? 'chrome' : /Safari/.test(ua) ? 'safari' : ua.slice(0, 30) })).join('\n') + '\n');
      } catch {}
      res.end();
    });
  }).listen(SINK, '0.0.0.0', () => console.log(`lab ${B}/  sink :${SINK}  log ${LOG}`));
  process.on('SIGTERM', () => (lab.kill(), process.exit(0)));
  process.on('SIGINT', () => (lab.kill(), process.exit(0)));
} else {
  // ---- helpers over the recorder's lines ----
  const kb = (s) => s.ih - s.vh; // what the keyboard (or anything else) covers at the bottom
  // Where a paragraph sits on the screen. Safari on iOS 27 gives client rects from the top of what the screen shows (the
  // visual viewport): with the keyboard up and the view panned, scrollY and vv.offsetTop both move, rects follow scrollY.
  const vis = (s, id) => (s.t[id] ? s.t[id].y : null);
  const st = read();
  const pt = (s, id, fx = 0.5, fy = 0.5) => {
    const r = s.t[id];
    if (!r || !st.off) return null;
    return { x: Math.round(r.x + r.w * fx + st.off.x), y: Math.round(r.y + r.h * fy + st.off.y) };
  };
  const dev = (s, x, y) => ({ x: Math.round(x + st.off.x), y: Math.round(y + st.off.y) });
  // The paragraph nearest a share of the visible height (for a hold low on the screen, where the keyboard will come).
  const at = (s, share) => Object.keys(s.t).filter((k) => /^p\d+$/.test(k)).map((k) => [k, Math.abs(vis(s, k) + s.t[k].h / 2 - s.vh * share)]).sort((a, b) => a[1] - b[1])[0]?.[0];
  const firstEv = (ss, type) => ss.find((s) => s.ev?.type === type);
  const range = (ss, f) => { const v = ss.map(f).filter((x) => x != null); return v.length ? [Math.min(...v), Math.max(...v)] : [0, 0]; };
  const spikes = (ss, id) => { // a jump of the paragraph you look at that comes back the next frames: a one-frame flash
    let n = 0, big = 0;
    for (let i = 1; i < ss.length - 1; i++) {
      const a = vis(ss[i - 1], id), b = vis(ss[i], id), c = vis(ss[i + 1], id);
      if (a == null || b == null || c == null) continue;
      if (Math.abs(b - a) > 30 && Math.abs(c - a) < 6) (n++, (big = Math.max(big, Math.abs(b - a))));
    }
    return { n, big };
  };
  const steady = (ss, s0, id, tol = 4) => {
    const [lo, hi] = range(ss, (s) => vis(s, id));
    const d = Math.max(Math.abs(lo - vis(s0, id)), Math.abs(hi - vis(s0, id)));
    return [`what you look at (${id}) stays put on screen`, d <= tol, `moved up to ${d}px`];
  };
  const noScroll = (ss, s0, tol = 2) => { const [lo, hi] = range(ss, (s) => s.sy); const d = Math.max(Math.abs(lo - s0.sy), Math.abs(hi - s0.sy)); return ['the page does not scroll', d <= tol, `scrollY ${s0.sy} → ${lo}..${hi}`]; };
  const inFloat = (s) => /textarea/.test(s.inner || '') && /@float/.test(s.inner || '');
  const fits = (s, box) => s[box] && s[box].y >= -1 && s[box].y + s[box].h <= s.vh + 1;
  const kbUp = (s) => kb(s) > 150;
  const kbDown = (s) => kb(s) < 60;
  // Safari paints a CSS highlight over whole blocks when its text can't be selected (17 Nov): the quoted words of an
  // open comment must sit on selectable text once the finger is up.
  const quoteOk = (ss) => { const end = ss.at(-1); return ['the quoted words are lit on selectable text (else Safari tints whole blocks)', end.quoteOnUnselectable !== true, end.quoteOnUnselectable == null ? 'nothing quoted' : end.quoteOnUnselectable ? 'unselectable' : 'selectable']; };
  // After a new comment is sent or dropped, the page goes back to where it was before the hold scrolled it (17 Nov).
  const back = (ss) => { const end = ss.at(-1); return ['the page goes back to where it was before the hold', st.before == null || Math.abs(end.sy - st.before) <= 2, `scrollY ${st.before} before, ${end.sy} now`]; };
  const pinShown = (ss, s0, box) => {
    st.before = s0.sy;
    const end = ss.at(-1), d = firstEv(ss, 'pointerdown');
    const want = d && { x: d.ev.cx, y: d.ev.cy - (end.sy - d.sy) };
    // The open thread's pin or the new one's; else the one nearest the finger.
    const pin = end.pins.find((p) => /\b(open|draft)\b/.test(p.c)) || (want && end.pins.map((p) => [p, Math.hypot(p.x + p.w / 2 - want.x, p.y + p.h - want.y)]).sort((a, b) => a[1] - b[1])[0]?.[0]);
    const b = end[box];
    return [
      ['the pin stays in view, above the ' + (box === 'card' ? 'thread' : 'box'), Boolean(pin && pin.y >= 0 && (!b || pin.y + pin.h <= b.y + 2)), pin ? `pin ${pin.y}..${pin.y + pin.h}, ${box} from ${b?.y}` : 'no pin near the finger'],
      ['the page moves only to show the pin', true, `moved ${end.sy - s0.sy}px`],
    ];
  };
  // The dimmed page above the box or thread, clear of its grab zone (the handle reaches ~60 px above a thread's top, 100 above a box's); the card sits at the top of a tall page, so no floor of 70.
  // A page's own pin must not show over a board view that covers it (boardview.mjs hides it): any pin of the page (not fixed) whose middle is inside the view.
  const pageDecoy = (end) => { const v = end.bv, hit = v && end.pins.filter((p) => !p.fixed && p.x + p.w / 2 >= v.x && p.x + p.w / 2 <= v.x + v.w && p.y + p.h / 2 >= v.y && p.y + p.h / 2 <= v.y + v.h); return ['no pin of the page shows over the board view', !hit?.length, JSON.stringify(hit?.map((p) => [p.x, p.y, p.c]))]; };
  const top = (s) => dev(s, s.iw / 2, Math.max(8, s.float ? s.float.y - 110 : (s.card?.y ?? 200) - 80));

  // ---- the steps ----
  const steps = [
    { name: 'calibrate', say: () => 'tap at (200, 330)', expect: (ss) => {
      const d = firstEv(ss, 'pointerdown');
      if (d) st.off = { x: 200 - d.ev.cx, y: 330 - d.ev.cy };
      return [['the tap reached the page', Boolean(d), d ? `client ${d.ev.cx},${d.ev.cy} → offset ${st.off.x},${st.off.y}` : 'no pointerdown seen'], ['a tap on the page makes no comment box', !ss.some((s) => s.float)]];
    } },
    { name: 'tap-no-pin', say: (s) => { st.tapId = at(s, 0.45); return `tap ${fmt(pt(s, st.tapId, 0.7))} (paragraph ${st.tapId})`; }, expect: (ss, s0) => [
      ['a short tap makes no comment box', !ss.some((s) => s.float)],
      ['a short tap selects no text', ss.every((s) => !s.sel)],
      noScroll(ss, s0),
    ] },
    { name: 'hold-link', say: (s) => `hold 0.8 s on ${fmt(pt(s, 'lnk', 0.15, 0.75))} (the link)`, expect: (ss, s0) => {
      const end = ss.at(-1);
      st.before = s0.sy;
      return [
        ['holding a link makes a comment box', ss.some((s) => s.float)],
        ['holding a link does not follow it', ss.every((s) => s.load === s0.load && s.href === s0.href), `${s0.href} → ${end.href}`],
        ['no link preview or callout (no contextmenu)', !firstEv(ss, 'contextmenu')],
        ['no click on the link after the hold', !ss.some((s) => s.ev?.type === 'click' && /a#lnk/.test(s.ev.on || ''))],
        quoteOk(ss),
        ['the cursor is in the new box', inFloat(end), end.inner || end.ae],
        ['the keyboard is up', kbUp(end), `covers ${kb(end)}px`],
        ['the box sits above the keyboard', fits(end, 'float'), JSON.stringify({ float: end.float, vt: end.vt, vh: end.vh })],
        noScroll(ss, s0),
        steady(ss, s0, 'intro'),
      ];
    } },
    { name: 'cancel-empty', say: (s) => `tap ${fmt(top(s))} (the dimmed page, clear of the grab zone above the box)`, expect: async (ss, s0) => {
      const end = ss.at(-1);
      return [
        ['an empty box closes on a tap outside', !end.float],
        ['the keyboard goes down', kbDown(end), `covers ${kb(end)}px`],
        ['focus leaves the widget', !end.inner, end.inner],
        ['no comment was saved', (await comments()).length === st.count0, `${(await comments()).length} comments`],
        ['the tap made no new box', !ss.slice(-5).some((s) => s.float)],
        back(ss),
      ];
    } },
    { name: 'hold-pin', say: (s) => { st.pinId = at(s, 0.5); return `hold 0.8 s on ${fmt(pt(s, st.pinId, 0.5))} (paragraph ${st.pinId})`; }, expect: (ss, s0) => {
      const end = ss.at(-1);
      const d = firstEv(ss, 'pointerdown');
      const shown = ss.find((s) => s.float);
      st.hold = { x: d?.ev.cx, y: d?.ev.cy, sy: d?.sy };
      st.base5 = vis(s0, st.pinId);
      return [
        ['a comment box opens', Boolean(shown), shown && d ? `after ${shown.at - d.at} ms` : ''],
        ['the cursor is in it', inFloat(end), end.inner || end.ae],
        ['the keyboard is up', kbUp(end), `covers ${kb(end)}px`],
        ['the box sits above the keyboard', fits(end, 'float'), JSON.stringify({ float: end.float, vt: end.vt, vh: end.vh })],
        ['no text got selected', ss.every((s) => !s.sel), ss.find((s) => s.sel)?.sel],
        ['no callout (no contextmenu)', !firstEv(ss, 'contextmenu')],
        ...pinShown(ss, s0, 'float'),
        quoteOk(ss),
        ((sp) => [`no one-frame jumps of what you look at`, sp.n === 0, `${sp.n} jumps, biggest ${sp.big}px`])(spikes(ss, st.pinId)),
      ];
    } },
    { name: 'type-send', say: () => 'type "phone check" then press return', expect: async (ss, s0) => {
      const end = ss.at(-1);
      const cs = await comments();
      const c = cs.find((x) => /^phone check$/i.test(x.text)); // iOS capitalises the first letter
      const pin = end.pins.map((p) => Math.hypot(p.x + p.w / 2 - st.hold.x, p.y + p.h / 2 - (st.hold.y - (end.sy - st.hold.sy)))).sort((a, b) => a - b)[0]; // on the page: the finger's spot, moved by any scroll since
      return [
        ['the comment was saved', Boolean(c)],
        ['the box closes', !end.float],
        ['the keyboard goes down', kbDown(end), `covers ${kb(end)}px`],
        ['focus leaves the widget', !end.inner, end.inner],
        ['the pin is where the finger was', pin != null && pin <= 24, `${Math.round(pin)}px away`],
        ['the dimming is gone', end.scrimOn === undefined ? true : !end.scrimOn, `scrim ${end.scrimOn ? 'shown' : 'hidden'}`],
        ((m) => ['the page waits for the card to land in its pin before going back', !m || !m.float, m ? `first move ${m.at - ss[0].at} ms in, card ${m.float ? 'still there' : 'gone'}` : 'no move'])(ss.find((x) => x.sy !== s0.sy)),
        back(ss),
        [`the page goes back to where it was before the hold`, Math.abs(vis(end, st.pinId) - st.base5) <= 4, `${st.pinId} at ${st.base5} before, ${vis(end, st.pinId)} after`],
        ((sp) => [`no one-frame jumps of what you look at`, sp.n === 0, `${sp.n} jumps, biggest ${sp.big}px`])(spikes(ss, st.pinId)),
      ];
    } },
    { name: 'tap-pin', say: (s) => { const p = s.pins.at(-1); return p ? `tap ${fmt(dev(s, p.x + p.w / 2, p.y + p.h / 2))} (the new pin)` : 'no pin on screen'; }, expect: (ss, s0) => {
      const end = ss.at(-1);
      return [
        ['the thread opens', Boolean(end.card), JSON.stringify(end.card)],
        ['no keyboard just for reading', kbDown(end), `covers ${kb(end)}px`],
        ['the thread fits on the screen', fits(end, 'card'), JSON.stringify({ card: end.card, vt: end.vt, vh: end.vh })],
        ...pinShown(ss, s0, 'card'),
        quoteOk(ss),
      ];
    } },
    { name: 'close-thread', say: (s) => `tap ${fmt(top(s))} (the dimmed page above the thread)`, expect: (ss, s0) => {
      const end = ss.at(-1);
      return [['the thread closes', !end.card], ['focus leaves the widget', !end.inner, end.inner], ['no new box from that tap', !end.float], noScroll(ss, s0), steady(ss, s0, st.pinId)];
    } },
    { name: 'hold-low', say: (s) => { st.low = at(s, 0.75); return `hold 0.8 s on ${fmt(pt(s, st.low, 0.3))} (paragraph ${st.low}, low on the screen, where the keyboard comes)`; }, expect: (ss, s0) => {
      const end = ss.at(-1);
      return [
        ['a comment box opens', ss.some((s) => s.float)],
        ['the cursor is in it', inFloat(end), end.inner || end.ae],
        ['the keyboard is up', kbUp(end), `covers ${kb(end)}px`],
        ['the box sits above the keyboard', fits(end, 'float'), JSON.stringify({ float: end.float, vt: end.vt, vh: end.vh })],
        ...pinShown(ss, s0, 'float'),
        ((sp) => [`no one-frame jumps of what you look at`, sp.n === 0, `${sp.n} jumps, biggest ${sp.big}px`])(spikes(ss, st.low)),
      ];
    } },
    { name: 'cancel-low', say: (s) => `tap ${fmt(top(s))} (the dimmed page, clear of the grab zone above the box)`, expect: async (ss, s0) => {
      const end = ss.at(-1);
      return [['the box closes', !end.float], ['the keyboard goes down', kbDown(end), `covers ${kb(end)}px`], ['nothing new was saved', (await comments()).length === st.count0 + 1], back(ss)];
    } },
    { name: 'page-field', setup: async () => { await inPage(`(scrollTo(0, 0), 'top')`); await sleep(800); }, say: (s) => `tap ${fmt(pt(s, 'field', 0.5))} (the page's own text field)`, expect: (ss) => {
      const end = ss.at(-1);
      return [
        ['the page\'s field gets the cursor', end.ae === 'input#field', end.ae],
        ['the widget does not take it', !end.inner, end.inner],
        ['no comment box', !ss.some((s) => s.float)],
        ['the keyboard is up', kbUp(end), `covers ${kb(end)}px`],
      ];
    } },
    { name: 'hold-while-typing', say: (s) => { st.mid = 'pic'; return `hold 0.8 s on ${fmt(pt(s, 'pic', 0.3))} (the picture, while the page's field has the keyboard)`; }, expect: (ss, s0) => {
      const end = ss.at(-1);
      return [
        ['a comment box opens', ss.some((s) => s.float)],
        ['the cursor moves into it', inFloat(end), end.inner || end.ae],
        ['the keyboard stays up', kbUp(end), `covers ${kb(end)}px`],
        ['the box sits above the keyboard', fits(end, 'float'), JSON.stringify({ float: end.float, vt: end.vt, vh: end.vh })],
        ...pinShown(ss, s0, 'float'),
      ];
    } },
    { name: 'cancel-mid', say: (s) => `tap ${fmt(top(s))} (the dimmed page, clear of the grab zone above the box)`, expect: (ss) => {
      const end = ss.at(-1);
      return [['the box closes', !end.float], ['the keyboard goes down', kbDown(end), `covers ${kb(end)}px`], ['focus does not jump back into the page\'s field', end.ae !== 'input#field', end.ae], back(ss)];
    } },
    { name: 'swipe-no-pin', say: () => 'swipe up: touch_path (200,650) → (200,300) over ~0.5 s', expect: (ss, s0) => {
      const end = ss.at(-1);
      return [['scrolling makes no comment box', !ss.some((s) => s.float)], ['the page scrolled', end.sy - s0.sy > 100, `scrollY ${s0.sy} → ${end.sy}`], ['no text got selected', ss.every((s) => !s.sel)]];
    } },
    // A question with choices (src/widget/thread.ts, trial.ts) on a phone: a sheet of at most half the screen, 44 pt rows,
    // a tap on a row answers (no Keep button; the card says "Picked A · undo" and the pick goes after 5 s, or when the card closes). `go ask-open` after
    // calibrate. The question sits on words in paragraph p20; the page is scrolled so they are in the lower part of the
    // screen, where a tall sheet would cover them.
    { name: 'ask-open', setup: async () => {
      const quote = { exact: 'the lazy dog while the band', prefix: 'Paragraph 20. The quick brown fox jumps over ', suffix: ' keeps playing' };
      const pin = (await (await fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', name: 'phone-check', text: 'which reads best?', anchor: { kind: 'text', selector: '#p20', x: 0.4, y: 0.3, docX: 0.4, docY: 900, width: 390, element: '<p id="p20">', text: '…over [the lazy dog while the band] keeps…', quote } }) })).json()).comment;
      const asked = await agentPost({ name: 'Claude', text: 'Which reads best?', parent: pin.id, choices: ['the sleepy dog while the band', 'the lazy cat while the band', 'a lazy dog while the band', 'the lazy dog as the band', 'the lazy dog while the choir'], recommend: 0 });
      st.asked = asked.comment?.id;
      await inPage(`(document.querySelector('#p20').scrollIntoView({ block: 'end' }), scrollBy(0, 60), 'scrolled')`);
      await sleep(2500);
    }, say: (s) => { const p = s.pins.at(-1); return p ? `tap ${fmt(dev(s, p.x + p.w / 2, p.y + p.h / 2))} (the pin on the quoted words in p20)` : 'no pin on screen'; }, expect: (ss) => {
      const end = ss.at(-1);
      const q = end.t.p20;
      return [
        ['the question opens as a sheet', Boolean(end.card), JSON.stringify(end.card)],
        ['the sheet is at most half the screen', Boolean(end.card) && end.card.h <= end.vh / 2 + 2, `${end.card?.h} of ${end.vh}`],
        ['the rows are 44 pt tall to tap', end.rows.length === 6 && end.rows.every((r) => r.h >= 44), JSON.stringify(end.rows.map((r) => r.h))],
        ['the quoted line is in view above the sheet', Boolean(q && end.card && q.y >= 0 && q.y + q.h <= end.card.y + 2), JSON.stringify({ p20: q, card: end.card })],
        ['the sheet is whole inside the window', fits(end, 'card'), JSON.stringify({ card: end.card, vt: end.vt, vh: end.vh })],
        ['there is no Keep button', end.keep == null, JSON.stringify(end.keep)],
        ['no keyboard just for reading', kbDown(end), `covers ${kb(end)}px`],
      ];
    } },
    { name: 'ask-pick', say: (s) => { const r = s.rows[1]; return r ? `tap ${fmt(dev(s, r.x + r.w / 2, r.y + r.h / 2))} (row A: a tap answers, no Keep), then WAIT 6 s before check (the pick goes after 5 s)` : 'no rows on screen'; }, expect: async (ss) => {
      const end = ss.at(-1);
      const cs = await comments();
      const pick = cs.find((c) => c.picked);
      const words = await inPage(`document.querySelector('#p20').textContent`);
      return [
        ['the pick was sent', Boolean(pick) && pick.picked.of === st.asked && pick.picked.n === 0, JSON.stringify(pick?.picked)],
        ['the page\'s own words are back until the agent writes the file', /the lazy dog while the band/.test(words || ''), words],
        ['the card stayed whole inside the window', !end.card || fits(end, 'card'), JSON.stringify(end.card)],
        ['no Keep button', end.keep == null, JSON.stringify(end.keep)],
      ];
    } },
    { name: 'ask-close', say: (s) => s.card ? `tap ${fmt(top(s))} (the dimmed page above the thread)` : 'the thread is closed already: just run check', expect: (ss) => {
      const end = ss.at(-1);
      return [['the thread closes', !end.card], ['no new box from that tap', !end.float]];
    } },
    // A board opened from a link on the page (src/board/overlay.ts): it comes over the same page (no navigation, #board=pricing),
    // full window with a bar: ‹ back and the name (no half: Leo, 23 Nov, #422). Made here with the lab's board API (as test/browser/boardview.mjs).
    { name: 'board-open', setup: async () => {
      await ensureBoard();
      await inPage(`(document.querySelector('#boardlink').scrollIntoView({ block: 'center' }), 'scrolled')`);
      await sleep(1500);
    }, say: (s) => { st.beforeBoard = s.sy; const r = s.t.boardlink; return r ? `tap ${fmt(pt(s, 'boardlink', 0.5))} (the link "open the pricing board"; the page is scrolled so it is mid-screen)` : 'no link on screen'; }, expect: (ss, s0) => {
      const end = ss.at(-1);
      st.beforeBoard = s0.sy;
      return [
        ['the board view opens over the same page (#board=pricing, no navigation)', end.hash === '#board=pricing' && end.href === s0.href && end.load === s0.load, `${end.href}${end.hash}`],
        ['the view fills the window', Boolean(end.bv) && end.bv.h >= end.vh - 4 && end.bv.w >= end.iw - 2, JSON.stringify(end.bv && [end.bv.y, end.bv.h, end.vh])],
        ['the bar has ‹ back, at least 36 pt tall to tap (Apple asks 44), and no half', Boolean(end.bv?.close) && end.bv.close.h >= 36 && !end.bv.size, JSON.stringify(end.bv && [end.bv.close, end.bv.size])],
        ['the board has its two frames', end.bv?.frames.length === 2, String(end.bv?.frames.length)],
        ['no comment box from that tap', !ss.some((s) => s.float)],
      ];
    } },
    // A hold on a frame is a comment, as on a page: a box, the keyboard.
    { name: 'board-hold-frame', say: (s) => { const p = framePoint(s, 0.5); return p ? `hold 0.8 s on ${fmt(p)} (inside frame ${p.id})` : 'no frame on screen (go board-open)'; }, expect: (ss, s0) => {
      const end = ss.at(-1);
      return [
        ['a comment box opens', ss.some((s) => s.float)],
        ['the cursor is in it', inFloat(end), end.inner || end.ae],
        ['the keyboard is up', kbUp(end), `covers ${kb(end)}px`],
        ['the box is whole inside the window (above the keyboard)', fits(end, 'float'), JSON.stringify({ float: end.float, vt: end.vt, vh: end.vh })],
        ['the board is still open', end.hash === '#board=pricing' && Boolean(end.bv)],
        // Safari pans the page when the keyboard comes (the page scrolls under the view, vt follows), so scrollY may change: the view must stay whole above the keyboard.
        ['the board view stays whole above the keyboard', Boolean(end.bv) && end.bv.y >= -1 && end.bv.y + end.bv.h <= end.vh + 1, JSON.stringify(end.bv && [end.bv.y, end.bv.h, end.vh])],
        pageDecoy(end),
      ];
    } },
    { name: 'board-cancel', say: (s) => `tap ${fmt(top(s))} (the dimmed page above the box)`, expect: async (ss) => {
      const end = ss.at(-1);
      return [
        ['the empty box closes', !end.float],
        ['the keyboard goes down', kbDown(end), `covers ${kb(end)}px`],
        ['the board stays open', Boolean(end.bv) && end.hash === '#board=pricing'],
        ['nothing was saved', (await comments()).filter((c) => c.anchor?.kind === 'board').length === 0],
      ];
    } },
    // The same near the bottom of a full view: the box must come up whole inside the window, above the keyboard (test/browser/boxfits.mjs).
    { name: 'board-hold-low', say: (s) => { const p = framePoint(s, 0.72); return p ? `hold 0.8 s on ${fmt(p)} (inside frame ${p.id}, at 72% of the window height)` : 'no frame on screen'; }, expect: (ss) => {
      const end = ss.at(-1);
      return [
        ['a comment box opens', ss.some((s) => s.float)],
        ['the cursor is in it', inFloat(end), end.inner || end.ae],
        ['the keyboard is up', kbUp(end), `covers ${kb(end)}px`],
        ['the box is whole inside the window, top and bottom', fits(end, 'float'), JSON.stringify({ float: end.float, vt: end.vt, vh: end.vh })],
      ];
    } },
    { name: 'board-cancel-low', say: (s) => `tap ${fmt(top(s))} (the dimmed board above the box)`, expect: (ss) => {
      const end = ss.at(-1);
      return [['the box closes', !end.float], ['the keyboard goes down', kbDown(end), `covers ${kb(end)}px`], ['the board stays open', Boolean(end.bv)]];
    } },
    // ‹ close: the view goes, the address loses #board (history.back), the page is where it was.
    { name: 'board-close', say: (s) => { const b = s.bv?.close; return b ? `tap ${fmt(dev(s, b.x + b.w / 2, b.y + b.h / 2))} (‹ close in the board's bar)` : 'no board view on screen'; }, expect: (ss) => {
      const end = ss.at(-1);
      return [
        ['the board view is gone', !end.bv],
        ['the address loses #board, still the same page', end.hash === '' && end.href === ss[0].href && end.load === ss[0].load, `${end.href}${end.hash}`],
        ['the page is scrolled where it was before the board', Math.abs(end.sy - st.beforeBoard) <= 2, `scrollY ${st.beforeBoard} → ${end.sy}`],
        ['the widget is back (no stray box or thread)', !end.float && !end.card],
      ];
    } },
  ];
  // A tap point below y 780 lands on Safari's toolbar (it covers the bottom), not on the page: the line says so.
  const fmt = (p) => (p ? `(${p.x}, ${p.y})${p.y > 780 ? ' - BELOW y 780: Safari\'s toolbar takes it, scroll the element up first' : ''}` : '(not on screen)');
  const lastLine = () => snaps().at(-1);
  // A point inside a board frame (the biggest on screen), at a share of the window height, in device points (clamped above the toolbar).
  const framePoint = (s, share) => {
    const fr = (s.bv?.frames || []).filter((f) => f.w > 40 && f.h > 40 && f.x < s.iw - 40).sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (!fr) return null;
    const x = Math.round(Math.min(Math.max(fr.x + fr.w / 2, 40), s.iw - 40));
    const y = Math.round(Math.min(Math.max(s.vh * share, fr.y + 40, (s.bv?.y || 0) + 60), fr.y + fr.h - 20, 770 - st.off.y));
    return { ...dev(s, x, y), id: fr.id };
  };
  // The lab's board API, as test/browser/boardview.mjs: a board of the test page with two frames, so a link can open it.
  const ensureBoard = () => fetch(`${B}/_lab/api/board?name=pricing`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ v: 1, rev: 0, of: '/index', frames: [{ id: 'a', src: '/other', w: 390, h: 844, x: 0, y: 0 }, { id: 'b', src: '/other', w: 820, h: 600, x: 500, y: 0 }] }) });

  if (cmd === 'next') {
    const as = args.includes('--as') ? args[args.indexOf('--as') + 1] : null;
    if (as && as !== st.as) Object.assign(st, { as, step: 0, off: null });
    const step = steps[st.step];
    if (!step) { console.log('all steps done: node test/phone/sim.mjs report'); process.exit(0); }
    await sleep(400);
    const s = snaps().at(-1);
    if (!s) { console.log('the recorder has sent nothing yet: open the page first'); process.exit(1); }
    if (st.step === 0) st.count0 = (await comments()).length;
    if (step.setup) await step.setup();
    const now = snaps().at(-1); // after a setup the page has changed
    st.mark = Date.now();
    console.log(`${st.as} · step ${st.step + 1}/${steps.length} ${step.name}: ${await step.say(now)}`);
    save(st);
  } else if (cmd === 'check') {
    const step = steps[st.step];
    await sleep(700);
    const all = snaps();
    const s0 = all.filter((l) => l.at < st.mark).at(-1);
    const ss = all.filter((l) => l.at >= st.mark);
    if (!ss.length) { console.log('nothing recorded since `next`'); process.exit(1); }
    const out = await step.expect(ss, s0);
    st.results[st.as] ||= {};
    st.results[st.as][step.name] = out.map(([n, ok, d]) => ({ n, ok: Boolean(ok), d: d ?? '' }));
    for (const r of st.results[st.as][step.name]) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${step.name}: ${r.n}${r.d ? ` (${r.d})` : ''}`);
    if (!args.includes('--again')) st.step++;
    save(st);
  } else if (cmd === 'report') {
    for (const [as, byStep] of Object.entries(st.results)) {
      const all = Object.values(byStep).flat();
      console.log(`\n${as}: ${all.filter((r) => r.ok).length}/${all.length} ok`);
      for (const [name, rs] of Object.entries(byStep)) for (const r of rs) if (!r.ok || args.includes('--all')) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${name}: ${r.n}${r.d ? ` (${r.d})` : ''}`);
    }
  } else if (cmd === 'ask') {
    const from = Date.now();
    fs.writeFileSync(path.join(RUN, 'ask.js'), args.join(' '));
    for (let i = 0; i < 20; i++) { await sleep(300); const a = lines().find((l) => l.why === 'answer' && l.at >= from); if (a) { console.log(a.answer); process.exit(0); } }
    console.log('no answer (is the page open?)');
  } else if (cmd === 'go') {
    const i = steps.findIndex((x) => x.name === args[0]);
    if (i < 0) console.log(`no step ${args[0]}: ${steps.map((x) => x.name).join(', ')}`);
    else (st.step = i, save(st), console.log(`at step ${i + 1}: ${steps[i].name}`));
  } else if (cmd === 'back') { st.step = Math.max(0, st.step - 1); save(st); console.log(`back to step ${st.step + 1}: ${steps[st.step].name}`); }
  else console.log('serve | next [--as safari|chrome] | check [--again] | report [--all] | back');
}
