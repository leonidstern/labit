// Walkie-talkie (src/widget/walkie.ts): K (the bar's tal(k)) turns the bar into the pill, words typed by dictation and the pointer's rests go
// to the chat as one message with each part's spot; a click while walking points, it doesn't press; Esc drops the walk.
// The part loads only when used. Not part of `npm test`. Run: node test/browser/walkie.mjs (NODE_PATH to a playwright).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();
const DIR = fs.realpathSync(tmp('labit-walkie-'));
const PORT = claimPort(8360, 40);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
fs.writeFileSync(path.join(DIR, 'walk.html'), `<!doctype html><meta charset="utf-8"><title>t</title><link rel="stylesheet" href="/_lab/lab.css">
<body><h1>Orders</h1><p>Some words to read.</p>
<button id="a" style="margin:40px;padding:20px 40px" onclick="window.pressed = (window.pressed || 0) + 1">Export</button>
<button id="b" style="margin:40px 40px 40px 400px;padding:20px 40px">New order</button></body>`);
const server = startLab(DIR, labEnv(), { port: PORT });
await labUp(B);

try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
      await ctx.addInitScript(() => localStorage.setItem('lab-name', 'zz-walkie'));
      const p = await ctx.newPage();
      const posted = [];
      p.on('request', (r) => r.method() === 'POST' && /\/_lab\/api\/comments/.test(r.url()) && posted.push(JSON.parse(r.postData() || '{}')));
      await p.goto(`${B}/walk.html`);
      await sleep(1500);
      const asked = () => p.evaluate(() => performance.getEntriesByType('resource').some((e) => /\/_lab\/walkie\.js/.test(e.name)));
      const state = () => p.evaluate(() => {
        const root = document.querySelector('[data-lab-comments]').shadowRoot;
        const pill = root.querySelector('.walkie');
        return {
          btn: root.querySelector('.walkie-btn')?.textContent, btnShown: !root.querySelector('.walkie-btn')?.hidden,
          pill: Boolean(pill && !pill.hidden), bar: getComputedStyle(root.querySelector('.bar')).display !== 'none',
          off: document.body.hasAttribute('data-lab-off'), focused: root.activeElement?.localName || '',
        };
      });
      const s0 = await state();
      check(eng, 'the bar has tal(k), and its part is not loaded yet', s0.btnShown && s0.btn === 'tal(k)' && !(await asked()), JSON.stringify(s0));

      const mid = async (sel) => p.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
      const say = (words) => p.evaluate((w) => { const root = document.querySelector('[data-lab-comments]').shadowRoot; const ta = root.querySelector('.walkie textarea'); ta.value += (ta.value ? ' ' : '') + w; ta.dispatchEvent(new Event('input')); }, words);
      const speak = async (text) => { for (const w of text.split(' ')) { await sleep(320); await say(w); } };

      await p.keyboard.press('k');
      await sleep(400);
      const s1 = await state();
      check(eng, 'K: the bar turns into the pill, the box has the cursor, no pins on the page', (await asked()) && s1.pill && !s1.bar && s1.off && s1.focused === 'textarea', JSON.stringify(s1));

      const looks = () => p.evaluate(() => { const r = document.querySelector('[data-lab-comments]').shadowRoot; const dot = getComputedStyle(r.querySelector('.wk-dot')); return [getComputedStyle(r.querySelector('.wk-tm span')).visibility, dot.visibility, r.querySelector('.walkie').getBoundingClientRect().width]; });
      await sleep(1200);
      const quiet = await looks();
      await say('so');
      await sleep(100);
      const heard = await looks();
      const first = await p.evaluate(() => document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.wk-tm span').textContent);
      check(eng, 'before the first word no dot and no clock; with it they show, at the same width', quiet[0] === 'hidden' && quiet[1] === 'hidden' && heard[0] === 'visible' && heard[1] === 'visible' && quiet[2] === heard[2] && first === '0:00', JSON.stringify([quiet, heard, first]));
      await p.evaluate(() => { const ta = document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.walkie textarea'); ta.value = ''; ta.dispatchEvent(new Event('input')); });

      const ink = await p.evaluate(() => { const r = document.querySelector('[data-lab-comments]').shadowRoot; return [getComputedStyle(r.querySelector('.wk-tm span')).color, getComputedStyle(r.querySelector('.walkie')).color]; });
      check(eng, 'the time is in the pill\'s own colour, so it shows on the black pill', ink[0] === ink[1], JSON.stringify(ink));

      const a = await mid('#a'), b = await mid('#b');
      await p.mouse.move(a.x, a.y, { steps: 8 });
      await sleep(500);
      await speak('make this bigger');
      await sleep(300);
      await p.mouse.click(b.x, b.y);
      await sleep(300);
      await speak('and this one green');
      await sleep(400);
      await p.mouse.click(a.x - 30, a.y); // pointing back at Export: a click while walking doesn't press it
      check(eng, 'a click while walking points, it does not press the page\'s button', !(await p.evaluate(() => window.pressed)));
      await sleep(300);
      await p.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
      await sleep(1200);
      const msg = posted.find((m) => /^Walkie-talkie, /.test(m.text || ''));
      const lines = msg ? msg.text.split('\n') : [];
      const ia = lines.findIndex((l) => /#a\b/.test(l) && /bigger/.test(l)), ib = lines.findIndex((l) => /#b\b/.test(l) && /green/.test(l));
      check(eng, '⌘↵ sends one chat message, each part on what was pointed at, in order', Boolean(msg) && msg.anchor?.kind === 'page' && ia > 0 && ib > ia, msg ? msg.text : 'nothing sent');
      const after = () => p.evaluate(() => { const root = document.querySelector('[data-lab-comments]').shadowRoot; const b = root.querySelector('.walkie-btn'); return { btn: b.textContent, width: b.getBoundingClientRect().width, lines: root.textContent.includes('sent to the chat') }; });
      const t1 = await after();
      await sleep(1500);
      const t2 = await after();
      check(eng, 'after sending, the button says "sent ✓" for a moment, then tal(k) again, with no line over the bar', t1.btn === 'sent ✓' && t2.btn === 'tal(k)' && Math.abs(t1.width - t2.width) < 0.5 && !t1.lines, JSON.stringify([t1, t2]));
      const s2 = await state();
      check(eng, 'after sending, the bar is back and pins work again', !s2.pill && s2.bar && !s2.off, JSON.stringify(s2));

      // a pause in the middle of a move, while the pointer travels: still one part, from and to
      await p.keyboard.press('k');
      await sleep(300);
      await p.mouse.move(a.x, a.y, { steps: 8 });
      await sleep(600);
      await speak('move this');
      await p.mouse.move(b.x, b.y, { steps: 8 });
      await sleep(1500);
      await speak('next to there');
      await sleep(400);
      await p.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
      await sleep(1200);
      const mv = posted.filter((m) => /^Walkie-talkie, /.test(m.text || '')).pop()?.text || '';
      check(eng, 'a pause inside "move this … next to there" keeps one part, from and to', /^Walkie-talkie, 1 part /.test(mv) && /move from "Export" \(#a\) to "New order" \(#b\)/.test(mv), mv);

      const before = posted.length;
      await p.keyboard.press('k');
      await sleep(300);
      await speak('never mind');
      await p.keyboard.press('Escape');
      await sleep(800);
      const s3 = await state();
      check(eng, 'Esc drops the walk: nothing sent, the bar is back', posted.length === before && !s3.pill && s3.bar && !s3.off, JSON.stringify(s3));
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
finish();
