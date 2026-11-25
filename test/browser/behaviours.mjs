// Browser checks of how a lab page behaves, in Safari's engine (WebKit) and Chrome's, with Playwright.
// Not part of `npm test`; CI runs it as the `browser` job. Run: node test/browser/behaviours.mjs   (needs the playwright package;
// NODE_PATH can point at a node_modules that has it). Prints one line per check and exits 1 if any fails.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { claimPort } from './port.mjs';
import { playwright, engines, LAB, tmp, labEnv, startLab, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });

const DIR = tmp('labit-browser-');
const PORT = String(claimPort(5100, 300));
const B = `http://localhost:${PORT}`;
const env = labEnv({}, { settings: false });
const paras = Array.from({ length: 80 }, (_, i) => `<p id="p${i}">paragraph ${i} with some words</p>`).join('');
const PAGE = `<!doctype html><meta charset="utf-8"><title>T1</title><link rel="stylesheet" href="s.css"><body>
<div id="top"></div><input id="i" value="typed"><details id="d"><summary>more</summary>inside</details>
<img id="pic" src="pic.svg" width="320" height="42" alt="wide"><p class="cap">a caption under it</p>${paras}</body>`;
const write = (f, t) => fs.writeFileSync(path.join(DIR, f), t);
write('index.html', PAGE);
write('s.css', 'h1{color:rgb(255,0,0)} body{margin:30px}');
write('pic.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="42"><rect width="320" height="42" fill="#cde"/></svg>');
write('notes.md', '# notes');
write('data.json', '{"a":1}');
// A page with a script of its own (it builds its words): a lab restart must not reload it when its file is unchanged (#428).
const SCRIPTED = '<!doctype html><title>S</title><p id="s">x</p><script>document.getElementById("s").textContent = "built"</script>';

let server;
const start = () => (server = startLab(DIR, env, { root: '.', port: PORT }));
const up = async () => {
  for (let i = 0; i < 80; i++) {
    try {
      return await fetch(B + '/');
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('lab did not start');
};
// Waits on the condition the next step needs; `ms` is the longest it waits, and it never throws (the check after it reports the real failure).
const until = (p, fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms, polling: 'raf' }).catch(() => {});
// Until a comment of the page satisfies `pred`.
async function untilApi(pred, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(40)) if ((await (await fetch(B + '/_lab/api/comments?page=/index')).json()).comments.some(pred)) return;
}

// Three parts, three files, so they run side by side: this one is the page's own behaviours and saves;
// behaviours-choices.mjs (BEHAVIOURS_PART=choices) a question with choices tried in the sentence (thread.ts, trial.ts);
// behaviours-questions.mjs (=questions) words that look like HTML, a quote over two blocks, hints, touches, the chat.
const PART = process.env.BEHAVIOURS_PART || 'page';
start();
await up();
for (const eng of engines()) {
  write('index.html', PAGE);
  write('s.css', 'h1{color:rgb(255,0,0)} body{margin:30px}');
  write('scripted.html', SCRIPTED);
  const browser = await pw[eng].launch();
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  // Done pins show by default: a resolved pin stays on the page, so the go check below needs no reload
  // (a reload would land in the counts the save checks at the end make).
  await ctx.addInitScript(() => localStorage.setItem('lab-name', 'leo'));
  // The question parts start with labit on, as the page part leaves it.
  if (PART !== 'page') await ctx.addInitScript(() => localStorage.setItem('lab-on', '1'));
  await ctx.addInitScript(() => addEventListener('load', () => fetch('/data.json').catch(() => {}))); // the page uses data.json: a save of it reloads the page
  const p = await ctx.newPage();
  let loads = 0;
  p.on('load', () => loads++);
  const shadow = (fn, arg) => p.evaluate(([f, a]) => new Function('r', 'a', f)([...document.querySelectorAll('*')].find((n) => n.shadowRoot).shadowRoot, a), [fn.toString().replace(/^[^{]*{|}$/g, ''), arg]);
  const untilShadow = (page, fn, arg, ms) =>
    until(page, ([src, a]) => { const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot)?.shadowRoot; return Boolean(r) && new Function('r', 'a', `return (${src})(r, a)`)(r, a); }, [fn.toString(), arg], ms);
  await p.goto(B + '/');
  await until(p, () => [...document.querySelectorAll('*')].some((n) => n.shadowRoot), null, 1200);

  const admin = JSON.parse(fs.readFileSync(path.join(DIR, '.lab/server.json'), 'utf8')).agent;
  const post = (body) =>
    fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lab-admin': admin, 'x-lab-agent': '1' }, body: JSON.stringify(body) }).then((r) => r.json());
  if (PART === 'page') {
  // Saved files
  await p.fill('#i', 'kept text');
  await p.evaluate(() => (document.querySelector('#d').open = true));
  await p.mouse.move(5, 5);
  await sleep(1700);
  write('s.css', 'h1{color:rgb(0,0,255)} body{margin:30px}');
  await until(p, () => [...document.querySelectorAll('link[rel=stylesheet]')].some((x) => /lab-v=/.test(x.href)), null, 1200);
  check(eng, 'CSS save swaps the stylesheet, no reload', loads === 1 && (await p.$$eval('link[rel=stylesheet]', (l) => l.some((x) => /lab-v=/.test(x.href)))));
  write('index.html', PAGE.replace('<title>T1', '<title>T2').replace('a caption under it', 'a caption, changed'));
  await until(p, () => document.title.replace(/^\(\d+\) /, '') === 'T2' && document.querySelector('.cap').textContent === 'a caption, changed', null, 1500);
  const st = await p.evaluate(() => ({ t: document.title.replace(/^\(\d+\) /, ''), // the unread count prefix is the widget's own
    cap: document.querySelector('.cap').textContent, v: document.querySelector('#i').value, open: document.querySelector('#d').open }));
  check(eng, 'HTML save patches in place, no reload', loads === 1 && st.t === 'T2' && st.cap === 'a caption, changed', JSON.stringify(st));
  check(eng, 'typed text and an open section stay', st.v === 'kept text' && st.open);
  await p.evaluate(() => scrollTo(0, 900));
  await sleep(300);
  const under = () => p.evaluate(() => Math.round(document.querySelector('#p30').getBoundingClientRect().top)); // where a paragraph in view sits on screen
  const was = await under();
  write('index.html', PAGE.replace('<title>T1', '<title>T2').replace('a caption under it', 'a caption, changed').replace('<div id="top"></div>', '<div id="top"><p>new</p><p>new</p><p>new</p><p>new</p></div>'));
  await until(p, () => Boolean(document.querySelector('#top p')), null, 1600);
    await sleep(200); // the page keeps the place just after the patch
  const now = await under();
  check(eng, 'what you look at keeps its place', Math.abs(now - was) <= 2, `paragraph at ${was} px → ${now} px`);
  write('pic.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="42"><rect width="320" height="42" fill="#fdc"/></svg>');
  await until(p, () => /lab-v=/.test(document.querySelector('#pic').getAttribute('src')), null, 1300);
  check(eng, 'picture save swaps it, no reload', loads === 1 && /lab-v=/.test(await p.$eval('#pic', (i) => i.getAttribute('src'))));

  // Comments arriving
  await p.evaluate(() => scrollTo(0, 0));
  const pinsBefore = await shadow(() => { return r.querySelectorAll('button.pin').length; });
  await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', name: 'Sam', text: 'from elsewhere', anchor: { selector: '#p2', x: 0.1, y: 0.5, docX: 0.1, docY: 300, width: 1000, element: '<p id="p2">' } }) });
  await untilShadow(p, (r, n) => r.querySelectorAll('button.pin').length === n, pinsBefore + 1, 900);
  check(eng, 'a comment from elsewhere shows up, no reload', loads === 1 && (await shadow(() => { return r.querySelectorAll('button.pin').length; })) === pinsBefore + 1);
  // Pages toggle state classes; a pin stays on its element. One whose element is gone waits on the left edge, at its height.
  await p.evaluate(() => document.querySelector('#p2').classList.add('offscreen'));
  // The lab keeps its comments from the engine before: take that engine's 'gone' pin away, so the count below is this run's one.
  const adminKey = JSON.parse(fs.readFileSync(path.join(DIR, '.lab/server.json'), 'utf8')).agent;
  for (const c of (await (await fetch(B + '/_lab/api/comments?page=/index')).json()).comments.filter((c) => c.text === 'gone')) {
    await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-admin': adminKey, 'x-lab-agent': '1' }, body: JSON.stringify({ page: '/index', action: 'delete', id: c.id }) });
  }
  await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', name: 'Sam', text: 'gone', anchor: { selector: '#nope', x: 0.5, y: 0.5, docX: 0.6, docY: 400, width: 1000, element: '<p id="nope">' } }) });
  await untilShadow(p, (r) => r.querySelector('.moved-btn')?.textContent === 'moved · 1', null, 2000);
  const pins = await shadow(() => { return [...r.querySelectorAll('button.pin')].map((b) => [b.classList.contains('moved'), b.style.left, b.style.top]); });
  check(eng, 'a pin keeps its element when the page adds a class to it', pins.every(([m, l]) => !m || l === '10px'), JSON.stringify(pins));
  check(eng, 'a pin whose element is gone is off the page, and the ⋯ menu counts it', pins.every(([m]) => !m) && (await shadow(() => { return r.querySelector('.moved-btn').textContent; })) === 'moved · 1', JSON.stringify([pins, await shadow(() => { return r.querySelector('.moved-btn').textContent; })]));
  // Opened from the menu it shows on the left edge at its height; with wide margins, beside the content.
  const open = async () => shadow(() => { r.querySelector('.moved-btn').click(); return new Promise((res) => setTimeout(() => res([...r.querySelectorAll('button.pin.moved')].map((b) => [b.style.left, b.style.top])), 400)); });
  const edge = await open();
  check(eng, 'opened from the menu it waits on the left edge at its height', edge.length === 1 && edge[0][0] === '10px' && edge[0][1] === '400px', JSON.stringify(edge));
  write('s.css', 'h1{color:rgb(0,0,255)} body{margin:30px 300px}');
  await sleep(1300);
  const wide = await open();
  check(eng, 'on a page with wide margins it waits beside the content', wide.length > 0 && wide.every(([l]) => l === '270px'), JSON.stringify(wide));
  await p.keyboard.press('Escape');
  write('s.css', 'h1{color:rgb(0,0,255)} body{margin:30px}');
  await untilShadow(p, (r) => { const m = [...r.querySelectorAll('button.pin.moved')]; return m.length > 0 && m.every((b) => b.style.left === '10px'); }, null, 1300);

  // Areas
  const img = await p.locator('#pic').boundingBox();
  await p.mouse.click(img.x + img.width + 40, img.y + 60); // a stray click opens an empty comment box
  await sleep(300);
  const x = img.x + 10, y = img.y + 10;
  await p.mouse.move(x, y);
  await p.mouse.down();
  for (let i = 1; i <= 12; i++) await p.mouse.move(x + 330 * i / 12, y + 20 * i / 12);
  await p.mouse.up();
  await untilShadow(p, (r) => Boolean(r.querySelector('.zone.draft')), null, 300);
  const zone = await shadow(() => { const z = r.querySelector('.zone.draft'); return z ? Math.round(z.getBoundingClientRect().width) + 'x' + Math.round(z.getBoundingClientRect().height) : null; });
  check(eng, 'a narrow area can be drawn, even after a stray click', zone === '330x20', String(zone));
  await p.keyboard.type('narrow strip');
  // Safari sends the Enter that picks a word from an input method after the composition has ended, as key code 229.
  const picked = await shadow(() => {
    const e = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true, composed: true });
    r.activeElement.dispatchEvent(e);
    return e.defaultPrevented;
  });
  check(eng, 'the Enter that picks a word while typing Japanese or Chinese does not send', picked === false, String(picked));
  await p.keyboard.press('Enter');
  await untilApi((c) => c.text === 'narrow strip', 600);
  const saved = (await (await fetch(B + '/_lab/api/comments?page=/index')).json()).comments.find((c) => c.text === 'narrow strip');
  check(eng, 'an area a little past a picture stays on the picture', /<img/.test(saved?.anchor?.element || ''), saved?.anchor?.element);
  await p.keyboard.press('Escape');

  // Text selection
  const lede = await p.locator('#p5').boundingBox();
  // Comment mode is back first: while a comment box is open (or still going out) comment mode is off and the page's own
  // pointer shows, so a drag then selects text on purpose. CI showed it: text "a" selected with data-lab-pinning off, 2 s
  // after Escape, in Linux WebKit. Escape until the page is back in comment mode, and say so if it never is.
  for (let i = 0; i < 4 && !(await p.evaluate(() => Boolean(document.querySelector('[data-lab-pinning]')))); i++) {
    await p.keyboard.press('Escape');
    await until(p, () => Boolean(document.querySelector('[data-lab-pinning]')), null, 600);
  }
  check(eng, 'comment mode is back before the selection check', await p.evaluate(() => Boolean(document.querySelector('[data-lab-pinning]'))), JSON.stringify(await p.evaluate(() => { const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot)?.shadowRoot; return { html: [...document.documentElement.classList].join(' '), go: r?.querySelector('.go-btn')?.className, boxes: [...(r?.querySelectorAll('.float, .card') || [])].map((n) => n.className), text: [...(r?.querySelectorAll('textarea') || [])].map((t) => t.value), on: localStorage.getItem('lab-on') }; })));
  // What the press saw, so a failure says why (Linux WebKit only, now and then).
  await p.evaluate(() => { window.__press = null; addEventListener('pointerdown', (e) => { const c = document.documentElement.classList; const us = (n) => getComputedStyle(n).webkitUserSelect + '/' + getComputedStyle(n).userSelect; window.__press ??= { shift: e.shiftKey, labShift: c.contains('lab-shift'), pinning: Boolean(document.querySelector('[data-lab-pinning]')), lit: c.contains('lab-lit'), us: us(document.getElementById('p5')) }; }, { capture: true, once: true }); window.__ss = []; addEventListener('selectstart', (e) => window.__ss.push(e.defaultPrevented ? 'blocked' : 'allowed'), true); });
  await p.keyboard.down('Shift');
  await p.keyboard.up('Shift');
  await p.mouse.move(lede.x + 10, lede.y + 8);
  await p.mouse.down();
  await p.mouse.move(lede.x + 16, lede.y + 9);
  await p.mouse.up();
  await sleep(100);
  const sel = await p.evaluate(() => { const g = getSelection(); const n = g.anchorNode; return { text: g.toString(), at: n ? (n.nodeType === 3 ? n.parentElement : n)?.closest('[id]')?.id ?? n.nodeName : null, labShift: document.documentElement.classList.contains('lab-shift'), press: window.__press, selectstart: window.__ss }; });
  check(eng, 'a click right after Shift selects no text', sel.text === '', JSON.stringify(sel));
  await p.keyboard.press('Escape');
  await sleep(200);

  // A Shift-drag from inside a word to inside another quotes both whole words; one inside a single word keeps its letters.
  const quoteOf = async (id, from, to, text) => {
    const at = await p.evaluate(([id, from, to]) => {
      const t = document.getElementById(id).firstChild;
      const r = document.createRange();
      r.setStart(t, from);
      r.setEnd(t, to);
      const rs = r.getClientRects();
      const a = rs[0], z = rs[rs.length - 1];
      return { x1: a.left + 1, y: a.top + a.height / 2, x2: z.right - 1 };
    }, [id, from, to]);
    // A Shift-press on main stretches whatever selection is left from before: start clean.
    await p.evaluate(() => getSelection().removeAllRanges());
    await p.keyboard.down('Shift');
    await p.mouse.move(at.x1, at.y);
    await p.mouse.down();
    await p.mouse.move(at.x2, at.y, { steps: 6 });
    await p.mouse.up();
    await p.keyboard.up('Shift');
    await untilShadow(p, (r) => { const e = r.querySelector('.fd'); return Boolean(e) && !e.hidden && e.getAnimations().length === 0; }, null, 400);
    await p.keyboard.type(text);
    await p.keyboard.press('Enter');
    await untilApi((c) => c.text === text, 600);
    const all = (await (await fetch(B + '/_lab/api/comments?page=/index')).json()).comments;
    return all.find((c) => c.text === text)?.anchor?.quote?.exact;
  };
  await p.evaluate(() => document.getElementById('p7').scrollIntoView({ block: 'center' }));
  await sleep(300);
  const whole = await quoteOf('p7', 2, 18, 'snap whole'); // "ragraph 7 with s"
  check(eng, 'a Shift-drag from inside a word to inside another quotes both whole words', whole === 'paragraph 7 with some', whole);
  const inside = await quoteOf('p9', 2, 6, 'snap inside'); // "ragr"
  check(eng, '…a Shift-drag inside one word keeps its letters', inside === 'ragr', inside);
  await p.keyboard.press('Escape');
  await sleep(200);

  // Keys
  const chatOpen = () => shadow(() => { return !r.querySelector('.chatwin').hidden; });
  await p.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'е', code: 'KeyT', bubbles: true })));
  await untilShadow(p, (r) => !r.querySelector('.chatwin').hidden, null, 300);
  check(eng, 'T opens the chat, on a Cyrillic layout too', await chatOpen());
  await p.keyboard.press('Escape');
  await sleep(200);
  // One way to pin (Leo, 20 Nov): no comment/pointer switch in the bar, and 1, 2, 3 and C do nothing; a click pins.
  await p.keyboard.press('1');
  await p.keyboard.press('2');
  await p.keyboard.press('3');
  await p.keyboard.press('c');
  await sleep(100);
  const noSwitch = await shadow(() => { return !r.querySelector('.go-btn') && !r.querySelector('.over-btn'); });
  await p.mouse.click(500, 400);
  await sleep(400);
  const pinnedPlain = await shadow(() => { return Boolean(r.querySelector('.float')); });
  check(eng, 'there is no pointer mode: no switch in the bar, keys 1, 2, 3 and C do nothing, and a click pins', noSwitch && pinnedPlain && !(await chatOpen()), JSON.stringify({ noSwitch, pinnedPlain }));
  await p.keyboard.press('Escape');
  await sleep(300);

  // A "go" comment is a pin like any other: your initial, and the tick once resolved.
  const page = await p.evaluate(() => document.querySelector('script[src*="comments.js"]').dataset.page);
  const placed = await post({ page, name: 'leo', text: 'go', anchor: { kind: 'element', selector: '#p3', x: 0.5, y: 0.5, docX: 0.5, docY: 200, width: 1000, element: '<p id="p3">', text: 'paragraph 3 with some words', section: '' } });
  const ticks = () => shadow(() => { return [...r.querySelectorAll('.pin')].filter((n) => n.textContent.trim() === '✓').length; });
  await untilShadow(p, (r) => r.querySelectorAll('.pin').length > 0, null, 1200);
  const goFace = await ticks();
  const goClass = await shadow(() => { return r.querySelectorAll('.pin.go').length; });
  if (!placed.comment) throw new Error(`could not place the go comment: ${JSON.stringify(placed)}`);
  await post({ page, action: 'resolve', id: placed.comment.id });
  await untilShadow(p, (r, n) => [...r.querySelectorAll('.pin')].filter((x) => x.textContent.trim() === '✓').length > n, goFace, 1500); // one more than before: an earlier done pin may already wear one
  const doneFace = await ticks();
  check(eng, 'a go comment is an ordinary pin (no go look), and wears the tick once it is done', !goClass && doneFace === goFace + 1, `${goClass} go-looks; ticks ${goFace} → ${doneFace}`);
  // A done pin is as big as an open one, only faded (once its face change has played).
  await untilShadow(p, (r) => { const d = [...r.querySelectorAll('button.pin.resolved')]; return d.length > 0 && d.every((b) => b.getAnimations({ subtree: true }).every((a) => a.playState !== 'running')); }, null, 1500);
  const sizes = await shadow(() => {
    const w = (b) => b && Math.round(b.getBoundingClientRect().width * 10) / 10;
    const pins = [...r.querySelectorAll('button.pin')];
    const done = pins.find((b) => b.classList.contains('resolved'));
    return { done: w(done), open: w(pins.find((b) => !b.classList.contains('resolved') && !b.classList.contains('moved'))), fade: done && getComputedStyle(done).opacity };
  });
  check(eng, 'a done pin is the same size as an open one, only faded', sizes.done > 0 && sizes.done === sizes.open && Number(sizes.fade) < 1, JSON.stringify(sizes));
  await post({ page, action: 'delete', id: placed.comment.id });
  // Option-click on a pin resolves its thread without opening it; again opens it again
  const elsewhere = async () => (await (await fetch(B + '/_lab/api/comments?page=/index')).json()).comments.find((c) => c.text === 'from elsewhere');
  const optClick = async () => {
    const at = await shadow(() => { const b = [...r.querySelectorAll('button.pin')].find((x) => x.title.includes('Sam') && !x.classList.contains('moved')); if (!b) return null; b.scrollIntoView({ block: 'center' }); const q = b.getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2]; });
    if (!at) return false;
    await p.keyboard.down('Alt');
    await p.mouse.click(at[0], at[1]);
    await p.keyboard.up('Alt');
    await untilApi((c) => c.text === 'from elsewhere' && c.resolved, 500);
        await sleep(100);
    return true;
  };
  const clicked = await optClick();
  const afterOne = await elsewhere();
  const cardOpen = await shadow(() => { return Boolean(r.querySelector('.card')); });
  check(eng, 'option-click on a pin resolves its thread without opening it', clicked && Boolean(afterOne?.resolved) && !cardOpen, JSON.stringify({ clicked, resolved: afterOne?.resolved, cardOpen }));
  await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', action: 'reopen', id: afterOne?.id }) });
  await untilApi((c) => c.text === 'from elsewhere' && !c.resolved, 700);
  // A control keeps its own click: a plain click on a summary opens the details and pins nothing; option-click pins on it.
  await p.keyboard.press('Escape');
  await sleep(300);
  const before = await p.evaluate(() => document.querySelector('#d').open);
  const sum = await p.locator('#d summary').boundingBox();
  await p.mouse.move(sum.x + 8, sum.y + 6);
  await p.mouse.click(sum.x + 10, sum.y + 7);
  await sleep(400);
  const plain = await shadow(() => { return { pin: Boolean(r.querySelector('.float')), open: document.querySelector('#d').open }; });
  await p.keyboard.down('Alt');
  await p.mouse.click(sum.x + 10, sum.y + 7);
  await p.keyboard.up('Alt');
  await sleep(400);
  const withAlt = await shadow(() => { return { pin: Boolean(r.querySelector('.float')), open: document.querySelector('#d').open }; });
  await p.keyboard.press('Escape');
  await sleep(300);
  check(eng, 'a click on a control goes to the page and pins nothing; option-click pins on it, and the page does not get that click',
    !plain.pin && plain.open === !before && withAlt.pin && withAlt.open === plain.open, JSON.stringify([before, plain, withAlt]));

  // A pin is one element for as long as its thread is on the page: opening, closing and pointing at it (and away) redraw
  // the widget, but the pin and its running animation carry on, not start again (Leo, 18 Nov).
  const work = await post({ page, name: 'leo', text: 'keep running', anchor: { kind: 'element', selector: '#p9', x: 0.5, y: 0.5, docX: 0.5, docY: 300, width: 1000, element: '<p id="p9">', text: 'paragraph 9 with some words', section: '' } });
  execFileSync(process.execPath, [LAB, 'reply', work.comment.id, '--on-it', 'Looking'], { cwd: DIR, env, stdio: 'ignore' });
  await sleep(1500);
  // Its paragraph in the middle of the screen, so the pin is in view whatever the fonts' height (taller on Linux).
  await p.evaluate(() => document.getElementById('p9').scrollIntoView({ block: 'center' }));
  await sleep(200);
  const mine = (tag) => shadow(() => {
    const pin = [...r.querySelectorAll('.pin')].find((b) => (b.getAttribute('aria-label') || '').includes('agent working on it'));
    if (!pin) return null;
    if (a) pin.__tag = a;
    const ring = pin.querySelector('.ring');
    const turn = ring?.getAnimations({ subtree: true }).find((x) => x.animationName === 'lab-turn');
    if (a) pin.__ring = ring;
    const box = pin.getBoundingClientRect();
    return { same: pin.__tag === 'T' && pin.__ring === ring, time: turn ? turn.currentTime : null, card: Boolean(r.querySelector('.card:not(.out)')), draft: Boolean(r.querySelector('.pin.draft')), x: box.left + 14, y: box.top + 14 };
  }, tag);
  const first = await mine('T');
  check(eng, 'a working pin has its ring turning', Boolean(first) && first.time > 0 && first.y > 0 && first.y < (await p.evaluate(() => innerHeight)), JSON.stringify(first));
  if (first) {
    let last = first.time;
    const steps = [
      ['hover', false, async (at) => p.mouse.move(at.x, at.y)],
      ['click (opens its thread)', true, async (at) => p.mouse.click(at.x, at.y)],
      ['click again (closes it)', false, async (at) => p.mouse.click(at.x, at.y)],
      ['leave', false, async () => p.mouse.move(700, 100)],
      ['a click on the page, which opens a new comment box', false, async () => p.mouse.click(700, 150), true],
      ['closing that box (Escape)', false, async () => p.keyboard.press('Escape')],
      ['a second click on empty page space', false, async () => p.mouse.click(780, 330), true],
      ['closing it with a click on the page', false, async () => p.mouse.click(700, 450)],
      ['Escape with nothing open', false, async () => p.keyboard.press('Escape')],
    ];
    let at = first;
    for (const [name, card, act, draft] of steps) {
      await act(at);
      await sleep(350);
      const now = await mine(null);
      const ok = Boolean(now) && now.same && now.card === card && (!draft || now.draft) && now.time > last + 200;
      check(eng, `a pin keeps its element and its ring's animation across: ${name}`, ok, now ? `same ${now.same}, ring ${Math.round(last)} → ${Math.round(now.time)} ms` : 'pin gone');
      if (!now) break;
      last = now.time;
      at = now;
    }
  }
  await post({ page, action: 'delete', id: work.comment.id });
  }
  if (PART !== 'page') {
  // Every comment on a page of ours goes, so each engine starts from nothing.
  const wipe = async (pg) => { for (const c of (await (await fetch(`${B}/_lab/api/comments?page=${pg}`)).json()).comments.filter((x) => !x.parent)) await post({ page: pg, action: 'delete', id: c.id }); };
  if (PART === 'choices') {
  // A question with choices, tried in the sentence (src/widget/thread.ts, trial.ts): a page of its own, so the checks above
  // and the reload below keep their counts.
  {
    const body = (a) => `<!doctype html><meta charset="utf-8"><title>Ask</title><style>body{margin:30px;font:18px/1.6 serif}main{max-width:520px}</style><main>${a}</main>`;
    const para = '<p id="a">First line. labit puts the <a id="lnk" href="#g">full guide</a> on the page, not in chat. Then more words after it.</p><p id="b">Second paragraph with <em>quiet</em> words.</p><p id="c">Third paragraph of filler words.</p>';
    const fill = Array.from({ length: 14 }, (_, i) => `<p>Filler ${i} with some words so the page has a length.</p>`).join('');
    const quote = { exact: 'the full guide on the page', prefix: 'labit puts ', suffix: ', not in chat' };
    const choices = ['this short guide on the page', 'the guide right on the page', 'the full guide, on the page, right beside every sentence you write and every word you weigh'];
    write('ask.html', body(para + fill));
    await wipe('/ask');
    const q = await ctx.newPage();
    const sq = (fn, arg) => q.evaluate(([f, a]) => new Function('r', 'a', f)([...document.querySelectorAll('*')].find((n) => n.shadowRoot).shadowRoot, a), [fn.toString().replace(/^[^{]*{|}$/g, ''), arg]);
    const anchor = { kind: 'text', selector: '#a', x: 0.3, y: 0.2, docX: 0.3, docY: 80, width: 1000, element: '<p id="a">', text: '…labit puts [the full guide on the page], not in chat…', quote };
    const root = (await post({ page: '/ask', name: 'leo', text: 'which reads best?', anchor })).comment;
    const asked = (await post({ page: '/ask', name: 'Claude', text: 'Which reads best?', parent: root.id, choices, recommend: 0 })).comment;
    // Opened once the question is there (it reaches an open page too, but that is the live connection's test).
    await q.goto(B + '/ask');
    await until(q, () => [...document.querySelectorAll('*')].find((n) => n.shadowRoot)?.shadowRoot.querySelector('button.pin'), null, 8000);
    await sleep(300);
    const html = () => q.evaluate(() => document.querySelector('#a').innerHTML);
    const nodes = () => q.evaluate(() => { let n = 0; for (const w = document.createTreeWalker(document.querySelector('#a'), NodeFilter.SHOW_ALL); w.nextNode(); ) n++; return n; });
    const quoteRects = () => q.evaluate(() => {
      const b = document.querySelector('#a').getBoundingClientRect();
      const l = document.querySelector('#lnk').getBoundingClientRect();
      return { para: { right: b.right, top: b.top }, link: { top: l.top, bottom: l.bottom } };
    });
    const card = () => sq(() => {
      const c = r.querySelector('.card');
      if (!c) return null;
      const b = c.getBoundingClientRect();
      const rows = [...r.querySelectorAll('.choice')];
      return { elseRow: Boolean(r.querySelector('.choice.else')), note: r.querySelector('.choices .note')?.textContent, noteIdle: r.querySelector('.choices .note')?.classList.contains('idle'), cls: c.className, left: b.left, top: b.top, right: b.right, bottom: b.bottom, tie: Boolean(r.querySelector('.tie')), keys: Boolean(r.querySelector('.keys, .keeprow, .tag, .lt')), bubble: getComputedStyle(r.querySelector('.msg.asks')).backgroundColor, name: getComputedStyle(r.querySelector('.msg.asks > b')).display, rows: rows.map((x) => x.textContent), on: rows.findIndex((x) => x.classList.contains('on')), disabled: rows.every((x) => x.disabled || x.getAttribute('aria-disabled') === 'true'), keep: r.querySelector('.keep')?.textContent, keepOff: r.querySelector('.keep')?.disabled, picked: rows.findIndex((x) => x.classList.contains('picked')) };
    });
    const original = await html();
    await q.evaluate(() => (window.__lnk = document.querySelector('#lnk')));
    // Where each pin is drawn (the browser holds most of them: their place is not in their style).
    const pinsAt = () => sq(() => { return [...r.querySelectorAll('button.pin')].map((b) => { const q = b.getBoundingClientRect(); return `${Math.round(q.left + scrollX)}/${Math.round(q.top + scrollY)}`; }).join(' '); });
    await sq(() => { r.querySelector('button.pin').click(); });
    await sleep(700);
    let c = await card();
    const geo = await quoteRects();
    // Placed as every thread card is (Leo, 25 Nov): below its pin, whole in the window; no margin place of its own.
    check(eng, 'a question opens as any card does: below its words, whole in the window', c && !/margin|under/.test(c.cls) && !c.tie && c.top > geo.link.top && c.left >= 0 && c.right <= 1000 && c.bottom <= 700, JSON.stringify([c?.cls, c?.tie, c?.left, c?.top, c?.right, c?.bottom, geo]));
    check(eng, 'a question (V1 plain list): no bubble, plain rows, the page\'s words "· now" ticked, no letters, tags or hint, no Keep (a tap answers)', c && c.rows.length === 4 && c.rows[0] === 'the full guide on the page · now' && c.rows.slice(1).every((t, i) => t === choices[i]) && !c.keys && /rgba\(0, 0, 0, 0\)|transparent/.test(c.bubble) && c.name === 'none' && c.on === 0 && c.keep === undefined && !c.elseRow, JSON.stringify(c));
    const pinsBefore = await pinsAt();
    const countBefore = await nodes();
    const belowAt = () => q.evaluate(() => Math.round(document.querySelector('#b').getBoundingClientRect().top + scrollY));
    // Pointing at a row tries it in the page; a tap answers (below).
    const tap = (i) => sq(() => { r.querySelectorAll('.choice')[a].dispatchEvent(new PointerEvent('pointerenter')); }, i);
    const answer = (i) => sq(() => { r.querySelectorAll('.choice')[a].click(); }, i);
    await tap(1); // from the words now to the first version, the agent's pick
    await sleep(250);
    c = await card();
    check(eng, 'pointing at a version tries it and sends nothing', c.on === 0 && !(await (await fetch(`${B}/_lab/api/comments?page=/ask`)).json()).comments.some((x) => x.picked), JSON.stringify([c.on]));
    const tried = await q.evaluate(() => ({ text: document.querySelector('#a').textContent, link: document.querySelector('#lnk') === window.__lnk, linkText: document.querySelector('#lnk')?.textContent, linkIn: document.querySelector('#a').contains(document.querySelector('#lnk')) }));
    check(eng, 'trying B swaps only the differing words; the link keeps its word', /labit puts this short guide on the page, not in chat/.test(tried.text) && tried.linkIn && tried.linkText === 'guide', JSON.stringify(tried));
    // Stepping through versions of different lengths never moves the page below: the block holds its tallest height
    // from the first try (one settle), then stays.
    const below = await belowAt();
    await tap(3); // the third, much longer: it wraps to more lines
    await sleep(250);
    const atC = await belowAt();
    await tap(1); // back on the first
    await sleep(250);
    check(eng, 'stepping to a longer version and back never moves the paragraph below', atC === below && (await belowAt()) === below, `${below} → ${atC} → ${await belowAt()}`);
    check(eng, 'a try adds and removes no node, and moves no pin', pinsBefore.length > 3 && (await nodes()) === countBefore && (await pinsAt()) === pinsBefore, `${countBefore} → ${await nodes()}; ${pinsBefore} → ${await pinsAt()}`);
    // The arrow keys move the ticked row and try it in the page like pointing does (first row: the words as they are now).
    await q.keyboard.press('ArrowDown');
    await sleep(300);
    c = await card();
    const viaKey = await q.evaluate(() => document.querySelector('#a').textContent);
    check(eng, 'ArrowDown ticks the next row and tries it in the page', c.on === 1 && /labit puts this short guide on the page, not in chat/.test(viaKey) && !(await (await fetch(`${B}/_lab/api/comments?page=/ask`)).json()).comments.some((x) => x.picked), JSON.stringify([c.on, viaKey.slice(0, 60)]));
    await q.keyboard.press('ArrowUp');
    await sleep(300);
    c = await card();
    check(eng, 'ArrowUp ticks the row before and the page shows its words again', c.on === 0 && /labit puts the full guide on the page, not in chat/.test(await q.evaluate(() => document.querySelector('#a').textContent)), String(c.on));
    await tap(1); // the first version tried again for the check below
    await sleep(250);
    // A script error on the page leaves a try as it is.
    await q.evaluate(() => setTimeout(() => { throw new Error('boom'); }, 0));
    await sleep(200);
    check(eng, 'a script error elsewhere does not drop the try', /this short guide/.test(await q.evaluate(() => document.querySelector('#a').textContent)));
    await q.keyboard.press('Escape');
    await sleep(400);
    check(eng, 'Escape puts the paragraph back exactly, and closes the card', (await html()) === original && (await card()) === null, (await html()).slice(0, 120));


    // A tap on the page's own words (the "now" row) keeps them as they are.
    await sq(() => { r.querySelector('button.pin').click(); });
    await sleep(600);
    await answer(0);
    await sleep(400);
    const picksNow = async () => (await (await fetch(`${B}/_lab/api/comments?page=/ask`)).json()).comments.filter((x) => x.picked);
    c = await card();
    check(eng, 'a tap waits 5 s: "Kept as is · undo", the rows still, nothing sent yet', c && /^Kept as is · undo$/.test(c.note) && !c.noteIdle && c.disabled && (await picksNow()).length === 0, JSON.stringify(c && [c.note, c.disabled]));
    // Undo puts the rows back, and nothing is ever sent.
    await sq(() => { r.querySelector('.choices .note .btn.undo').click(); });
    await sleep(300);
    c = await card();
    check(eng, 'undo puts the rows back, still open', c && !c.disabled && c.noteIdle && c.on === 0 && c.picked === -1, JSON.stringify(c && [c.disabled, c.noteIdle, c.on, c.picked]));
    await sleep(5400);
    check(eng, 'after undo nothing is sent, not even after the 5 s', (await picksNow()).length === 0);
    // Tapped again, the card closing sends the pick at once.
    await answer(0);
    await sleep(300);
    await q.keyboard.press('Escape');
    await sleep(900);
    const asIs = await picksNow();
    check(eng, 'closing the card sends the waiting pick at once; a tap on the page\'s own words keeps them as they are', asIs.length === 1 && asIs[0].picked.n === -1 && asIs[0].text.startsWith('Keep as is') && (await html()) === original, JSON.stringify(asIs.map((x) => [x.picked, x.text])));
    for (const x of asIs) await post({ page: '/ask', action: 'delete', id: x.id });
    await q.keyboard.press('Escape');
    await sleep(400);

    // A tap on B sends the pick after 5 s; the words are the page's until the agent writes the file.
    await sq(() => { r.querySelector('button.pin').click(); });
    await sleep(600);
    await answer(2);
    await sleep(1200);
    check(eng, 'a pick is still not sent 1.2 s after the tap', (await (await fetch(`${B}/_lab/api/comments?page=/ask`)).json()).comments.every((x) => !x.picked));
    await sleep(4600);
    const got = (await (await fetch(`${B}/_lab/api/comments?page=/ask`)).json()).comments.filter((x) => x.picked);
    c = await card();
    check(eng, 'a tap on B sends the pick', got.length === 1 && got[0].picked.of === asked.id && got[0].picked.n === 1 && got[0].text.startsWith('Picked B: ') && (await html()) === original, JSON.stringify(got.map((x) => [x.picked, x.text])));
    check(eng, 'after the pick the rows are disabled and the pick is marked', c && c.disabled && c.picked === 1, JSON.stringify(c && [c.disabled, c.picked, c.cls]));
    await post({ page: '/ask', action: 'delete', id: got[0].id });
    await q.keyboard.press('Escape');
    await sleep(300);

    // A save of the page's file while a choice is tried: the choice is tried again; words gone: rows only.
    await sq(() => { r.querySelector('button.pin').click(); });
    await sleep(600);
    await tap(1);
    await sleep(250);
    write('ask.html', body(para.replace('Third paragraph of filler words.', 'Third paragraph, edited.') + fill));
    await sleep(1800);
    const after = await q.evaluate(() => ({ text: document.querySelector('#a').textContent, third: document.querySelector('#c').textContent }));
    c = await card();
    check(eng, 'an HTML save mid-try: patch applied, the row pointed at is tried in the new words', /Third paragraph, edited\./.test(after.third) && /this short guide on the page/.test(after.text) && c && c.on === 0, JSON.stringify([after, c?.on]));
    write('ask.html', body(para.replace('labit puts the <a id="lnk" href="#g">full guide</a> on the page, not in chat.', 'Nothing of it is left.') + fill));
    await sleep(1800);
    c = await card();
    check(eng, 'words gone after a save: rows only, no "now" row', c && c.rows.length === 3 && !c.rows[0]?.endsWith('now'), JSON.stringify(c));
    await q.keyboard.press('Escape');
    write('ask.html', body(para + fill));
    await sleep(1800);

    // A pick from elsewhere (another device) while a choice is tried: the words go back, the rows are disabled.
    await sq(() => { r.querySelector('button.pin').click(); });
    await sleep(600);
    await tap(1);
    await sleep(200);
    const trying = await q.evaluate(() => document.querySelector('#a').textContent);
    await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/ask', name: 'Sam', text: 'Picked C: the guide right on the page', parent: asked.id, to: asked.id, picked: 2 }) });
    await sleep(1200);
    c = await card();
    check(eng, 'a pick from elsewhere puts the words back', trying !== (await q.evaluate(() => document.querySelector('#a').textContent)) && (await html()) === original && c && c.disabled && c.picked === 2, JSON.stringify(c && [c.disabled, c.picked]));
    await q.keyboard.press('Escape');
    await sleep(300);
    await post({ page: '/ask', action: 'delete', id: (await (await fetch(`${B}/_lab/api/comments?page=/ask`)).json()).comments.find((x) => x.picked)?.id });
    await sleep(800);

    // Its words by the window's bottom: the card turns over above them as any card does, never off the window (Leo,
    // 25 Nov: "at bottom of screen cant even close it"), and a click on the page closes it. Room above the words lets the
    // page scroll them down there.
    await q.evaluate(() => (document.querySelector('main').style.paddingTop = '700px'));
    await sleep(400);
    await q.evaluate(() => scrollTo(0, document.querySelector('#lnk').getBoundingClientRect().bottom + scrollY - innerHeight + 40));
    await sleep(400);
    await sq(() => { r.querySelector('button.pin').click(); });
    await sleep(800);
    c = await card();
    const low = await quoteRects();
    check(eng, 'a question by the window\'s bottom opens above its words, whole in the window', c && low.link.bottom > 600 && c.top >= 0 && c.bottom <= 700 && c.bottom <= low.link.top + 4, JSON.stringify([c?.top, c?.bottom, low.link]));
    await q.mouse.click(5, 5);
    await sleep(500);
    check(eng, 'a click on the page closes a question\'s card', (await card()) === null && (await html()) === original);
    await q.evaluate(() => { document.querySelector('main').style.paddingTop = ''; scrollTo(0, 0); });
    await sleep(400);

    // A narrow window: the card stays whole in it, and narrowed with the card open it is placed again.
    await q.setViewportSize({ width: 700, height: 700 });
    await sleep(300);
    await sq(() => { r.querySelector('button.pin').click(); });
    await sleep(800);
    c = await card();
    check(eng, 'narrow window: the card whole in it', c && c.left >= 0 && c.right <= 700 && c.bottom <= 700, JSON.stringify([c?.left, c?.right, c?.bottom]));
    await q.keyboard.press('Escape');
    await sleep(300);
    await q.setViewportSize({ width: 1000, height: 700 });
    await sleep(300);
    await sq(() => { r.querySelector('button.pin').click(); });
    await sleep(700);
    await q.setViewportSize({ width: 700, height: 700 });
    await sleep(900);
    c = await card();
    check(eng, 'the window narrowed with a card open: it stays inside', c && c.right <= 700, JSON.stringify([c?.cls, c?.right]));
    await q.keyboard.press('Escape');
    await q.setViewportSize({ width: 1000, height: 700 });
    await q.close();
  }

  }
  if (PART === 'questions') {
  // Words that look like HTML are text; a quote across two paragraphs shows rows only.
  {
    const body = (a) => `<!doctype html><meta charset="utf-8"><title>Ask2</title><style>body{margin:30px;font:18px/1.6 serif}main{max-width:520px}</style><main>${a}</main>`;
    write('ask2.html', body('<p id="a">One sentence ends here.</p><p id="b">The next one starts here and goes on.</p><p id="c">Alone <b>bold</b> words here.</p>' + Array.from({ length: 10 }, (_, i) => `<p>Filler ${i}.</p>`).join('')));
    await wipe('/ask2');
    const q = await ctx.newPage();
    const sq = (fn, arg) => q.evaluate(([f, a]) => new Function('r', 'a', f)([...document.querySelectorAll('*')].find((n) => n.shadowRoot).shadowRoot, a), [fn.toString().replace(/^[^{]*{|}$/g, ''), arg]);
    const across = (await post({ page: '/ask2', name: 'leo', text: 'across', anchor: { kind: 'text', selector: 'body', x: 0.3, y: 0.2, docX: 0.3, docY: 80, width: 1000, element: '<body>', text: '…One [sentence ends here. The next one] starts here…', quote: { exact: 'sentence ends here. The next one', prefix: 'One ', suffix: ' starts here' } } })).comment;
    await post({ page: '/ask2', name: 'Claude', text: 'Which?', parent: across.id, choices: ['sentence ends here. The next one', 'sentence stops. The next two'], recommend: 1 });
    // Opened once the question is there (it reaches an open page too, but that is the live connection's test).
    await q.goto(B + '/ask2');
    await until(q, () => [...document.querySelectorAll('*')].find((n) => n.shadowRoot)?.shadowRoot.querySelector('button.pin'), null, 8000);
    await sleep(300);
    const mine = () => q.evaluate(() => document.querySelector('#a').innerHTML + document.querySelector('#b').innerHTML);
    const before = await mine();
    await sq(() => { r.querySelector('button.pin').click(); });
    await sleep(700);
    await sq(() => { r.querySelectorAll('.choice')[1].dispatchEvent(new PointerEvent('pointerenter')); });
    await sleep(200);
    const row = await sq(() => { return { cls: r.querySelector('.card').className, rows: [...r.querySelectorAll('.choice')].map((x) => x.textContent) }; });
    check(eng, 'a quote across two blocks: rows only, no "now" row, nothing changed in the page', !/margin/.test(row.cls) && row.rows.length === 2 && !row.rows.some((t) => t?.endsWith('now')) && (await mine()) === before, JSON.stringify(row));
    await q.keyboard.press('Escape');
    await post({ page: '/ask2', action: 'delete', id: across.id });
    const text = (await post({ page: '/ask2', name: 'leo', text: 'tags', anchor: { kind: 'text', selector: '#c', x: 0.3, y: 0.2, docX: 0.3, docY: 200, width: 1000, element: '<p id="c">', text: '…Alone [bold] words…', quote: { exact: 'Alone', prefix: '', suffix: ' bold words here' } } })).comment;
    await post({ page: '/ask2', name: 'Claude', text: 'Which?', parent: text.id, choices: ['Alone', '<b>Lonely</b><img src=x onerror="window.__x=1"> שלום'], recommend: 1 });
    await sleep(1200);
    await sq(() => { r.querySelector('button.pin').click(); });
    await sleep(700);
    await sq(() => { r.querySelectorAll('.choice')[1].dispatchEvent(new PointerEvent('pointerenter')); });
    await sleep(250);
    const raw = await sq(() => { return { tx: [...r.querySelectorAll('.choice .tx')].map((x) => [x.textContent, x.getAttribute('dir'), x.children.length]) }; });
    const inPage = await q.evaluate(() => ({ c: document.querySelector('#c').textContent, imgs: document.querySelectorAll('#c img').length, bs: document.querySelectorAll('#c b').length, x: window.__x }));
    check(eng, 'a choice with tags shows as text, in the row and in the sentence (dir auto)', raw.tx[1][0].startsWith('<b>Lonely</b><img') && raw.tx.every(([, d, k]) => d === 'auto' && k === 0) && inPage.c.startsWith('<b>Lonely</b>') && inPage.imgs === 0 && inPage.bs === 1 && inPage.x === undefined, JSON.stringify([raw, inPage]));
    await q.keyboard.press('Escape');
    await q.close();
  }

  // A question with hints, a touch that scrolled, failed and hidden-page picks, and a question in the page chat (thread.ts, chat.ts).
  {
    const body = (a) => `<!doctype html><meta charset="utf-8"><title>Ask3</title><style>body{margin:30px;font:18px/1.6 serif}main{max-width:520px}</style><main>${a}</main>`;
    write('ask3.html', body('<p id="a">A heading-ish line of words.</p>' + Array.from({ length: 8 }, (_, i) => `<p>Filler ${i}.</p>`).join('')));
    await wipe('/ask3');
    const q = await ctx.newPage();
    const sq = (fn, arg) => q.evaluate(([f, a]) => new Function('r', 'a', f)([...document.querySelectorAll('*')].find((n) => n.shadowRoot).shadowRoot, a), [fn.toString().replace(/^[^{]*{|}$/g, ''), arg]);
    const picks = async () => (await (await fetch(`${B}/_lab/api/comments?page=/ask3`)).json()).comments.filter((x) => x.picked);
    const pin = (await post({ page: '/ask3', name: 'leo', text: 'which layout?', anchor: { kind: 'element', selector: '#a', x: 0.5, y: 0.5, docX: 0.3, docY: 80, width: 1000, element: '<p id="a">' } })).comment;
    const ask = (await post({ page: '/ask3', name: 'Claude', text: 'Which layout?', parent: pin.id, choices: ['Tabs', 'List', 'Grid'], hints: ['less scrolling', '', 'denser, harder to scan'], recommend: 0 })).comment;
    await q.goto(B + '/ask3'); // opened once the question is there, as above
    await until(q, () => [...document.querySelectorAll('*')].find((n) => n.shadowRoot)?.shadowRoot.querySelector('button.pin'), null, 8000);
    await sleep(300);
    await sq(() => { r.querySelector('button.pin').click(); });
    await sleep(700);
    const info = () => sq(() => {
      const rows = [...r.querySelectorAll('.choice')];
      return { hints: rows.map((x) => x.querySelector('.desc')?.textContent || ''), tx: rows.map((x) => x.querySelector('.tx')?.textContent), note: r.querySelector('.choices .note')?.textContent.trim(), disabled: rows.every((x) => x.disabled || x.getAttribute('aria-disabled') === 'true'), on: rows.findIndex((x) => x.classList.contains('on')), focus: r.activeElement?.localName, hintInRow: getComputedStyle(rows[0].querySelector('.desc')).position !== 'fixed' && rows[2].querySelector('.desc').getBoundingClientRect().top > rows[0].querySelector('.desc').getBoundingClientRect().bottom, hintMuted: rows[0].querySelector('.desc') && getComputedStyle(rows[0].querySelector('.desc')).color !== getComputedStyle(rows[0].querySelector('.tx')).color, elseRow: Boolean(r.querySelector('.choice.else')), noteRole: r.querySelector('.choices .note')?.getAttribute('role'), focusUndo: Boolean(r.activeElement?.classList.contains('undo')), ariaRows: rows.every((x) => x.getAttribute('aria-disabled') === 'true' && !x.disabled), noteNowrap: getComputedStyle(r.querySelector('.choices .note')).whiteSpace };
    });
    let c = await info();
    check(eng, 'a hint shows as a muted second line in its own row (not stacked at one spot); rows without one have none; no "Something else…" row; the note is a status on one line', c.hints.join('|') === 'less scrolling||denser, harder to scan' && c.tx.join('|') === 'Tabs|List|Grid' && c.hintMuted && c.hintInRow && !c.elseRow && c.noteRole === 'status' && c.noteNowrap === 'nowrap', JSON.stringify(c));
    check(eng, 'an open question does not focus the reply box on a computer', c.focus !== 'textarea' && c.on === 0, JSON.stringify([c.focus, c.on]));
    // A touch that moved more than 8 px was a scroll: no answer. A touch that stayed put answers.
    const touch = (i, dy) => sq(() => {
      const el = r.querySelectorAll('.choice')[a[0]];
      const b = el.getBoundingClientRect();
      const x = b.left + 20, y = b.top + 10;
      const ev = (t, yy) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, composed: true, pointerType: 'touch', clientX: x, clientY: yy }));
      ev('pointerdown', y); ev('pointermove', y + a[1]); ev('pointerup', y + a[1]);
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: x, clientY: y + a[1] }));
    }, [i, dy]);
    await touch(1, 30);
    await sleep(300);
    c = await info();
    check(eng, 'a touch that moved 30 px (a scroll) answers nothing', !c.disabled && c.note === '' && (await picks()).length === 0, JSON.stringify(c));
    await touch(1, 3);
    await sleep(300);
    c = await info();
    check(eng, 'a touch that moved 3 px answers (waiting its 5 s); the rows are aria-disabled, not disabled, and the focus goes to undo', c.disabled && c.note === 'Picked B · undo' && c.ariaRows && c.focusUndo, JSON.stringify(c));
    await sq(() => { r.querySelector('.choices .note .btn.undo').click(); });
    await sleep(200);
    // Words typed in the reply box under an open question are an ordinary reply: no pick, the question stays open.
    await sq(() => { r.querySelector('.card textarea').focus(); });
    await q.keyboard.type('what about a tab bar?');
    await q.keyboard.press('Enter');
    await sleep(900);
    const all = async () => (await (await fetch(`${B}/_lab/api/comments?page=/ask3`)).json()).comments;
    const typed = (await all()).find((x) => x.text === 'what about a tab bar?');
    c = await info();
    check(eng, 'a reply typed under an open question is an ordinary reply: no pick, the question stays open', typed && typed.parent === pin.id && !typed.picked && (await picks()).length === 0 && !c.disabled, JSON.stringify([typed, c.disabled]));
    // A pick that fails to send (the lab says no) is kept: the card, opened again, offers it again.
    await q.route('**/_lab/api/comments', (route) => (route.request().postData()?.includes('"picked"') ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"nope"}' }) : route.continue()));
    await sq(() => { r.querySelectorAll('.choice')[1].click(); });
    await sleep(200);
    await q.keyboard.press('Escape'); // the card closes: the waiting pick goes now, and fails
    await sleep(700);
    await sq(() => { r.querySelector('button.pin').click(); });
    await sleep(700);
    c = await info();
    check(eng, 'a pick that failed is offered again when the card opens: "failed, tap again", its row ticked', c.note === 'failed, tap again' && !c.disabled && c.on === 1 && (await picks()).length === 0, JSON.stringify(c));
    await q.unroute('**/_lab/api/comments');
    // The page hidden (a tab switch, the phone locked) sends a waiting pick at once, not after its 5 s.
    await sq(() => { r.querySelectorAll('.choice')[2].click(); });
    await sleep(300);
    await q.evaluate(() => { Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await sleep(900);
    await q.evaluate(() => delete document.visibilityState);
    const hiddenPick = await picks();
    check(eng, 'hiding the page sends the waiting pick at once', hiddenPick.length === 1 && hiddenPick[0].picked.n === 2 && hiddenPick[0].picked.of === ask.id, JSON.stringify(hiddenPick.map((x) => x.picked)));
    await q.keyboard.press('Escape');
    await post({ page: '/ask3', action: 'delete', id: pin.id });

    // The page chat: the agent's question draws its rows there too; a tap waits, undo or closing the chat decides.
    const root = (await post({ page: '/ask3', name: 'leo', text: 'what about the footer?', anchor: { kind: 'page', width: 1000, height: 700, dpr: 1 } })).comment;
    const chatAsk = (await post({ page: '/ask3', name: 'Claude', text: 'Footer: which?', parent: root.id, choices: ['Dark', 'Light'], hints: ['', 'matches the header'], recommend: 1 })).comment;
    await sleep(1200);
    await sq(() => { r.querySelector('.chat-btn, button[aria-label^="chat"]')?.click(); });
    await sleep(700);
    const chat = () => sq(() => {
      const rows = [...r.querySelectorAll('.msgs .choice')];
      return { rows: rows.map((x) => x.querySelector('.tx')?.textContent), hint: rows[1]?.querySelector('.desc')?.textContent, disabled: rows.every((x) => x.disabled || x.getAttribute('aria-disabled') === 'true'), picked: rows.findIndex((x) => x.classList.contains('picked')), note: r.querySelector('.msgs .choices .note')?.textContent.trim(), other: Boolean(r.querySelector('.msgs .choice.else')) };
    });
    c = await chat();
    check(eng, 'the chat draws the question with its rows and hint, no "Something else…"', c.rows?.join('|') === 'Dark|Light' && c.hint === 'matches the header' && !c.other && !c.disabled, JSON.stringify(c));
    await sq(() => { r.querySelectorAll('.msgs .choice')[0].click(); });
    await sleep(500);
    c = await chat();
    check(eng, 'a tap in the chat waits: "Picked A · undo", nothing sent', c.disabled && c.picked === 0 && c.note === 'Picked A · undo' && (await picks()).length === 0, JSON.stringify(c));
    await sq(() => { r.querySelector('.msgs .choices .note .btn.undo').click(); });
    await sleep(300);
    check(eng, 'undo in the chat puts the rows back', !(await chat()).disabled);
    await sq(() => { r.querySelectorAll('.msgs .choice')[1].click(); });
    await sleep(300);
    await q.keyboard.press('Escape'); // closes the chat: the waiting pick goes at once
    await sleep(900);
    const chatPicks = (await picks()).filter((x) => x.picked.of === chatAsk.id);
    check(eng, 'closing the chat sends the waiting pick', chatPicks.length === 1 && chatPicks[0].picked.n === 1 && /^Picked B: Light/.test(chatPicks[0].text), JSON.stringify(chatPicks.map((x) => [x.picked, x.text])));
    await q.close();
  }

  }
  }
  if (PART === 'page') {
  // A save the page has nothing to do with leaves it alone; one it may fetch reloads it; a lab restart doesn't.
  // (A page with its own <script> is not used here: such a page never patches in place, it reloads on every HTML
  // save, which is what the checks above cover. Whether a page uses a saved script is tested in hot.test.mjs.)
  // (a reload waits while you've just pressed a key or clicked: give it a moment)
  write('notes.md', '# notes, changed');
  await sleep(3000);
  check(eng, 'a save the page does not use leaves it alone', loads === 1, `loads ${loads}`);
  // With the chat open the reload waits (a "!" on the labit mark), and what comes meanwhile still shows: before 19 Nov the
  // held reload cut off every later update, so the agent's answer stayed out of an open chat until it was closed.
  await p.keyboard.press('t');
  await untilShadow(p, (r) => r.querySelector('.chatwin').hidden === false, null, 1000);
  const said = () => shadow(() => { return [...r.querySelectorAll('.msg')].some((m) => m.textContent.includes('while it waits')); });
  write('data.json', '{"a":2}');
  await untilShadow(p, (r) => r.querySelector('.upd')?.hidden === false, null, 3000);
  const waiting = await shadow(() => { return r.querySelector('.upd')?.hidden === false; });
  await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', name: 'Sam', text: 'while it waits', anchor: { kind: 'page', width: 1000, height: 700, dpr: 1 } }) });
  await untilShadow(p, (r) => [...r.querySelectorAll('.msg')].some((m) => m.textContent.includes('while it waits')), null, 2000);
  check(eng, 'a reload that waits for an open chat does not hold back new messages', waiting && loads === 1 && (await said()), `waiting ${waiting}, loads ${loads}`);
  await p.keyboard.press('Escape');
  for (const end = Date.now() + 3000; Date.now() < end && loads < 2; ) await sleep(50);
  check(eng, 'a save it may fetch reloads the page', loads === 2, `loads ${loads}`);
  const s = await ctx.newPage();
  let sLoads = 0;
  s.on('load', () => sLoads++);
  await s.goto(B + '/scripted');
  await sleep(800);
  server.kill();
  await sleep(600);
  start();
  await up();
  await sleep(5000);
  check(eng, 'a lab restart does not reload the page', loads === 2, `loads ${loads}`);
  check(eng, 'nor a page with its own script whose file did not change (#428)', sLoads === 1 && (await s.textContent('#s')) === 'built', `loads ${sLoads}`);
  // Its file saved while the lab was down: the page catches up by reloading once the lab is back.
  server.kill();
  await sleep(600);
  write('scripted.html', SCRIPTED.replace('<title>S', '<title>S2'));
  start();
  await up();
  for (const end = Date.now() + 6000; Date.now() < end && sLoads < 2; ) await sleep(50);
  check(eng, 'a page with its own script whose file was saved while the lab was down reloads when it is back', sLoads === 2 && (await s.title()) === 'S2', `loads ${sLoads}`);
  }
  await browser.close();
}
server.kill();
fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 }); // the lab may still be writing as it ends
finish();
