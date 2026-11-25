// Walkie-talkie (src/widget/walkie.ts): K turns the bar into the pill, words typed by dictation and the pointer's rests go
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
      check(eng, 'the bar has walkie-tal(k)ie, and its part is not loaded yet', s0.btnShown && s0.btn === 'walkie-tal(k)ie' && !(await asked()), JSON.stringify(s0));

      const mid = async (sel) => p.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
      const say = (words) => p.evaluate((w) => { const root = document.querySelector('[data-lab-comments]').shadowRoot; const ta = root.querySelector('.walkie textarea'); ta.value += (ta.value ? ' ' : '') + w; ta.dispatchEvent(new Event('input')); }, words);
      const speak = async (text) => { for (const w of text.split(' ')) { await sleep(320); await say(w); } };

      await p.keyboard.press('k');
      await sleep(400);
      const s1 = await state();
      check(eng, 'K: the bar turns into the pill, the box has the cursor, no pins on the page', (await asked()) && s1.pill && !s1.bar && s1.off && s1.focused === 'textarea', JSON.stringify(s1));

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
      const s2 = await state();
      check(eng, 'after sending, the bar is back and pins work again', !s2.pill && s2.bar && !s2.off, JSON.stringify(s2));

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
