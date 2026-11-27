// The board's draw tool (Leo, 27 Nov: "add draw tool select in board context menu so people with ipads and pencils can
// draw"). On an iPad-sized touch screen with a board open, the ⋯ menu has "draw"; while it is on, a pen or mouse stroke
// on the board is saved as a drawing (as holding D does), and "stop drawing" turns it off so the same stroke saves
// nothing. The mouse stands in for the Pencil: both are presses that aren't a finger (a finger still moves the board).
// Run: node test/browser/boarddraw.mjs (needs playwright). Not part of `npm test`; CI runs it in the `browser` job.
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });
const DIR = tmp('labit-boarddraw-');
const PORT = String(claimPort(11780, 30));
const B = `http://localhost:${PORT}`;
const paras = Array.from({ length: 20 }, (_, i) => `<p id="p${i}">paragraph ${i} with some words to read</p>`).join('');
fs.writeFileSync(path.join(DIR, 'index.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>T</title><body style="margin:20px;font:16px/1.5 sans-serif">${paras}</body>`);
fs.mkdirSync(path.join(DIR, '.lab/boards'), { recursive: true });
fs.writeFileSync(path.join(DIR, '.lab/boards/sketch.json'), JSON.stringify({ v: 1, name: 'sketch', rev: 1, of: '/index', frames: [] }));
const server = startLab(DIR, labEnv({}, { settings: false }), { root: '.', port: PORT });
await labUp(B);
const drawings = async () => (await (await fetch(`${B}/_lab/api/comments?page=%2Findex`)).json()).comments.filter((c) => c.anchor?.ink || c.anchor?.kind === 'board').length;

try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 834, height: 1112 }, hasTouch: true, isMobile: eng !== 'firefox' });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'leo'); localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      await p.goto(B + '/#board=sketch');
      await p.waitForFunction(() => document.querySelector('[data-lab-board-view]') && document.querySelector('[data-lab-comments]')?.shadowRoot?.querySelector('.more'), null, { timeout: 20000 });
      await sleep(1500);
      const menu = () => p.evaluate(() => { const r = document.querySelector('[data-lab-comments]').shadowRoot; r.querySelector('.more').click(); return [...r.querySelectorAll('.more-menu button')].map((x) => x.textContent); });
      const pick = (label) => p.evaluate((label) => [...document.querySelector('[data-lab-comments]').shadowRoot.querySelectorAll('.more-menu button')].find((x) => x.textContent === label)?.click(), label);
      const stroke = async (x, y) => { await p.mouse.move(x, y); await p.mouse.down(); for (let i = 1; i <= 12; i++) await p.mouse.move(x + i * 12, y + i * 6); await p.mouse.up(); };

      const rows = await menu();
      check(eng, 'with a board open, the ⋯ menu has "draw"', rows.includes('draw'), JSON.stringify(rows));
      await pick('draw');
      await sleep(300);
      const n0 = await drawings();
      await stroke(250, 400);
      await sleep(2500); // a drawing is sent a second after its last stroke
      const n1 = await drawings();
      check(eng, 'with the draw tool on, a pen or mouse stroke on the board is saved as a drawing', n1 === n0 + 1, `${n0} -> ${n1}`);
      const rows2 = await menu();
      check(eng, '... and the menu offers "stop drawing"', rows2.includes('stop drawing'), JSON.stringify(rows2));
      await pick('stop drawing');
      await sleep(300);
      await stroke(250, 700);
      await sleep(2500);
      check(eng, 'off again: the same stroke saves no drawing', (await drawings()) === n1, `${n1} -> ${await drawings()}`);
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
}
finish();
