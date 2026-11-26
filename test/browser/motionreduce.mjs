// Reduced motion and touch targets (Apple's guidance). With prefers-reduced-motion: reduce nothing in the widget
// slides or scales, and what appears or goes ramps its opacity (a short crossfade, ~120 ms: --_t-calm) instead of
// popping in one frame; with normal motion it still moves as before. On a phone (coarse pointer) every control is at
// least 44 x 44 pt to hit, measured by what a point inside it resolves to, not by how it is drawn.
// Per-frame sampling: requestAnimationFrame records the element's rect and its opacity (with its parents') every frame.
// Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/motionreduce.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();

const DIR = tmp('labit-motionreduce-');
const PORT = claimPort(8760, 30);
const B = `http://localhost:${PORT}`;
const sec = (id, t) => `<section id="${id}"><h2>${t}</h2><p id="${id}-p">Words of ${t}.</p><div style="height:700px"></div></section>`;
fs.writeFileSync(path.join(DIR, 'index.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>M</title><link rel="stylesheet" href="/_lab/lab.css"><body style="margin:0 24px"><h1>Motion</h1><a id="go" href="/_lab/board/pricing?of=%2Findex">open the board</a>${sec('speed', 'Speed')}${sec('cost', 'Cost')}${sec('risk', 'Risk')}</body>`);
fs.writeFileSync(path.join(DIR, 'pricing.html'), '<!doctype html><meta charset="utf-8"><title>Pricing</title><h1>Pricing</h1><p>Plan</p>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT, flags: { board: true } }));
const server = startLab(DIR, labEnv());
await labUp(B);
await fetch(`${B}/_lab/api/board?name=pricing`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ v: 1, rev: 0, of: '/index', frames: [{ id: 'a', src: '/pricing', w: 390, h: 600, x: 0, y: 0 }] }) });
await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', name: 'Sam', text: 'A thread to open', anchor: { selector: '#speed-p', x: 0.2, y: 0.5, docX: 60, docY: 100, width: 300 } }) });

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const DESK = { viewport: { width: 1000, height: 800 } };
const R = `document.querySelector('[data-lab-comments]').shadowRoot`;
const BV = `document.querySelector('[data-lab-board-view]')`;

// Starts the sampler: every frame for `dur` ms, the element `find` returns (an expression), its box and its opacity.
const sample = (p, find, dur = 900) => p.evaluate(([f, d]) => {
  const get = new Function('return ' + f);
  const out = (window.__frames = []);
  const t0 = performance.now();
  const step = () => {
    const el = get();
    let o = 1, on = false, r = { x: 0, y: 0, width: 0, height: 0 };
    if (el) {
      r = el.getBoundingClientRect();
      on = r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
      for (let n = el; n; n = n.parentNode || n.host) if (n.nodeType === 1) o *= +getComputedStyle(n).opacity;
    }
    out.push({ t: Math.round(performance.now() - t0), on, o: +o.toFixed(3), x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) });
    if (performance.now() - t0 < d) requestAnimationFrame(step);
  };
  step();
}, [find, dur]);
const frames = async (p, dur = 900) => {
  await sleep(dur + 150);
  return p.evaluate(() => window.__frames);
};
// moves: frames where the box differs from the one before it; ramp: frames in between invisible and whole; pop: a frame
// that goes from not there / clear to whole without a step (the largest jump of opacity between two shown frames).
const stats = (fr) => {
  const on = fr.filter((f) => f.on);
  let moves = 0;
  for (let i = 1; i < on.length; i++) if (Math.abs(on[i].x - on[i - 1].x) + Math.abs(on[i].y - on[i - 1].y) + Math.abs(on[i].w - on[i - 1].w) + Math.abs(on[i].h - on[i - 1].h) > 0.6) moves++;
  const ramp = on.filter((f) => f.o > 0.03 && f.o < 0.97).length;
  return { shown: on.length, moves, ramp, from: on[0]?.o, to: on.at(-1)?.o };
};
const line = (s) => `moves ${s.moves}, ramp ${s.ramp}, ${s.shown} frames shown`;

// Scenes: what to sample and how to make it appear / go. `calm`: nothing translates (moves <= 1) and the opacity ramps.
const waitRoot = (p) => p.waitForFunction(() => document.querySelector('[data-lab-comments]')?.shadowRoot?.querySelector('.pin, .bar'), null, { timeout: 20000 });
const rootClick = (p, sel) => p.evaluate(([s]) => document.querySelector('[data-lab-comments]').shadowRoot.querySelector(s).click(), [sel]);
const pinAt = (p) => p.evaluate(() => { const b = document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.pin:not(.draft)').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
const hold = async (p, x, y) => { // a phone's hold on the page: a new comment
  await p.evaluate(([x, y]) => { const t = document.elementFromPoint(x, y); t.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0, bubbles: true, composed: true })); }, [x, y]);
  await sleep(550);
  await p.evaluate(([x, y]) => document.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0, bubbles: true, composed: true })), [x, y]);
};

async function reduced(eng, browser, name, ctxOpts, scenes, setup = async () => {}) {
  const ctx = await browser.newContext({ ...ctxOpts, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'tess'); localStorage.setItem('lab-on', '1'); });
  const p = await ctx.newPage();
  await p.goto(B + '/');
  await waitRoot(p);
  await sleep(700);
  await setup(p);
  for (const s of scenes) {
    await s.before?.(p);
    await sample(p, s.find);
    await s.act(p);
    const fr = await frames(p, s.dur || 900);
    if (process.env.DEBUG === s.name) console.log(JSON.stringify(fr.slice(0, 16)));
    const st = stats(fr);
    check(eng, `reduced, ${name}: ${s.name}: nothing translates, opacity ramps`, st.moves <= 1 && st.ramp >= 2, line(st));
    await s.after?.(p);
    await sleep(300);
  }
  await ctx.close();
}

const SCENES_DESK = [
  { name: 'new comment box appears', find: `${R}.querySelector('.float')`, act: (p) => p.mouse.click(400, 300) },
  { name: 'new comment box goes', find: `${R}.querySelector('.float')`, act: (p) => p.keyboard.press('Escape') },
  { name: 'thread card appears', find: `${R}.querySelector('.card')`, before: async (p) => { const b = await pinAt(p); p.__pin = b; }, act: (p) => p.mouse.click(p.__pin.x, p.__pin.y) },
  { name: 'thread card goes', find: `${R}.querySelector('.card')`, act: (p) => p.keyboard.press('Escape') },
  { name: 'the ⋯ menu appears', find: `${R}.querySelector('.more-menu')`, act: (p) => rootClick(p, '.more') },
  { name: 'the ⋯ menu goes', find: `${R}.querySelector('.more-menu')`, act: (p) => p.keyboard.press('Escape') },
  { name: 'the board view appears', find: BV, act: (p) => p.click('#go') },
];
const SCENES_PHONE = [
  { name: 'chat sheet appears', find: `${R}.querySelector('.chatwin')`, act: (p) => rootClick(p, '.chat-btn') },
  { name: 'chat sheet goes', find: `${R}.querySelector('.chatwin')`, act: (p) => rootClick(p, '.scrim') },
  { name: 'thread sheet appears', find: `${R}.querySelector('.card')`, act: async (p) => { const b = await pinAt(p); await p.touchscreen.tap(b.x, b.y); } },
  { name: 'thread sheet goes', find: `${R}.querySelector('.card')`, act: (p) => rootClick(p, '.scrim') },
  { name: 'new comment sheet appears', find: `${R}.querySelector('.float')`, act: (p) => hold(p, 200, 650) },
  { name: 'new comment sheet goes', find: `${R}.querySelector('.float')`, act: (p) => rootClick(p, '.scrim') },
  { name: 'the ⋯ menu appears', find: `${R}.querySelector('.more-menu')`, act: (p) => rootClick(p, '.more') },
  { name: 'the ⋯ menu goes', find: `${R}.querySelector('.more-menu')`, act: (p) => rootClick(p, '.more') },
  { name: 'the board view appears', find: BV, act: (p) => p.tap('#go'), before: (p) => p.evaluate(() => scrollTo(0, 0)) },
];
// The pill steps away while a sheet is open: sampled together with the chat opening.
const PILL = { name: 'the pill fades as the chat sheet opens (it does not slide)', find: `${R}.querySelector('.bar')`, act: (p) => rootClick(p, '.chat-btn') };

for (const eng of engines()) {
  const browser = await pw[eng].launch();
  try {
    await reduced(eng, browser, 'computer', DESK, SCENES_DESK);
    await reduced(eng, browser, 'phone', PHONE, SCENES_PHONE);
    await reduced(eng, browser, 'phone', PHONE, [PILL]);

    // Normal motion still moves: a new comment box and a thread card translate / scale over several frames.
    {
      const ctx = await browser.newContext({ ...DESK, reducedMotion: 'no-preference' });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'tess'); localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      await p.goto(B + '/');
      await waitRoot(p);
      await sleep(700);
      await sample(p, `${R}.querySelector('.float')`, 500);
      await p.mouse.click(400, 300);
      const st = stats(await frames(p, 500));
      check(eng, 'normal motion: the new comment box still moves (translate and scale, unchanged)', st.moves >= 3, line(st));
      await ctx.close();
    }

    // Touch targets: a phone (coarse pointer). The hit size is how far a point resolves to the control, each way from its middle.
    {
      const ctx = await browser.newContext({ ...PHONE, reducedMotion: 'no-preference' });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'tess'); localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      await p.goto(B + '/');
      await waitRoot(p);
      await sleep(900);
      const measure = (scope) => p.evaluate(([scope]) => {
        const host = scope === 'board' ? document.querySelector('[data-lab-board-view]') : document.querySelector('[data-lab-comments]');
        const root = host.shadowRoot;
        const out = [];
        const sel = scope === 'board' ? '.bv-bar button' : 'button:not(.pin)';
        for (const b of root.querySelectorAll(sel)) {
          const r = b.getBoundingClientRect();
          if (r.width < 1 || r.height < 1 || getComputedStyle(b).visibility === 'hidden' || r.bottom < 0 || r.top > innerHeight) continue;
          const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
          const hits = (x, y) => { const e = root.elementFromPoint(x, y); return e && (e === b || b.contains(e)); };
          const reach = (dx, dy) => { let n = 0; while (n < 60 && hits(cx + dx * (n + 1) / 2, cy + dy * (n + 1) / 2)) n++; return n / 2; };
          const w = reach(-1, 0) + reach(1, 0) + 0.5, h = reach(0, -1) + reach(0, 1) + 0.5;
          out.push({ name: `${b.className.toString().split(' ').slice(0, 2).join('.') || b.localName}|${(b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 14)}`, w: Math.round(r.width), h: Math.round(r.height), hw: w, hh: h });
        }
        return out;
      }, [scope]);
      const verdict = (what, list) => {
        for (const m of list) check(eng, `targets, ${what}: ${m.name} is 44 x 44 to hit`, m.hw >= 43.5 && m.hh >= 43.5, `drawn ${m.w}x${m.h}, hit ${m.hw}x${m.hh}`);
      };
      verdict('the pill', await measure('widget'));
      // the chat sheet
      await rootClick(p, '.chat-btn');
      await sleep(900);
      verdict('the chat sheet', (await measure('widget')).filter((m) => /^send/.test(m.name)));
      await rootClick(p, '.scrim');
      await sleep(800);
      // a thread card
      const pb = await pinAt(p);
      await p.touchscreen.tap(pb.x, pb.y);
      await sleep(1200);
      verdict('a thread card', (await measure('widget')).filter((m) => /resolve|delete|undo|send/.test(m.name)));
      await rootClick(p, '.scrim');
      await sleep(800);
      // the ⋯ menu rows
      await rootClick(p, '.more');
      await sleep(600);
      verdict('the ⋯ menu', await p.evaluate(() => {
        const root = document.querySelector('[data-lab-comments]').shadowRoot;
        return [...root.querySelectorAll('.more-menu button')].filter((b) => b.getBoundingClientRect().width > 0).map((b) => {
          const r = b.getBoundingClientRect(), cx = r.x + r.width / 2, cy = r.y + r.height / 2;
          const hits = (x, y) => { const e = root.elementFromPoint(x, y); return e && (e === b || b.contains(e)); };
          const reach = (dx, dy) => { let n = 0; while (n < 60 && hits(cx + dx * (n + 1) / 2, cy + dy * (n + 1) / 2)) n++; return n / 2; };
          return { name: `menu|${(b.textContent || '').trim().slice(0, 14)}`, w: Math.round(r.width), h: Math.round(r.height), hw: reach(-1, 0) + reach(1, 0) + 0.5, hh: reach(0, -1) + reach(0, 1) + 0.5 };
        });
      }));
      await rootClick(p, '.more');
      await sleep(500);
      // the board view's bar
      await p.tap('#go');
      await p.waitForFunction(() => document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('#lab-board'), null, { timeout: 8000 });
      await sleep(600);
      verdict('the board bar', await measure('board'));
      const bar = await p.evaluate(() => document.querySelector('[data-lab-board-view]').shadowRoot.querySelector('.bv-bar').getBoundingClientRect().height);
      check(eng, 'targets, the board bar is still 40 px (+ the top safe area) tall to the eye', Math.abs(bar - 40) < 1.5, String(bar));
      await ctx.close();
    }
    // A computer's sizes are not changed (pointer: fine): the board bar's buttons are the same small ones.
    {
      const ctx = await browser.newContext({ ...DESK, reducedMotion: 'no-preference' });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'tess'); localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      await p.goto(B + '/');
      await waitRoot(p);
      await sleep(600);
      await p.click('#go');
      await p.waitForFunction(() => document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('#lab-board'), null, { timeout: 8000 });
      await sleep(500);
      const hs = await p.evaluate(() => [...document.querySelector('[data-lab-board-view]').shadowRoot.querySelectorAll('.bv-bar button')].map((b) => Math.round(b.getBoundingClientRect().height)));
      check(eng, 'computer: the board bar buttons keep their size (under 44 tall, pointer: fine)', hs.length === 1 && hs.every((h) => h < 36), hs.join(', '));
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}
server.kill();
fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
finish();
