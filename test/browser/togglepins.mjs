// Hiding comments and showing them again brings every pin back (Leo, 25 Nov: after a few hide/show, some pins did not
// come back). Pins on still content, on a sticky bar, on a transformed card and on an animated one (held by the browser,
// pinhold.ts), and one on a word of a live subtitle that is written again every 330 ms without the page changing size:
// drawn while its word was gone, it was left off until the next scroll or resize. Shown and hidden many times, fast and
// slow, with the button and the key; each time every pin is back within a turn of the subtitle, and the subtitle's pin,
// once back, isn't taken off again by the next change.
// Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/togglepins.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });

const DIR = tmp('labit-togglepins-');
const PORT = claimPort(8420, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'index.html'), `<!doctype html><meta charset="utf-8"><title>toggle</title>
<style>body{margin:0;font:18px/1.5 system-ui} p,.card{margin:22px 24px} #bar{position:sticky;top:0;background:#eee;padding:12px 24px;z-index:1}
.card{padding:16px;border-radius:12px;background:#222;color:#fff} #shift{transform:translateX(30px)}
@keyframes bob{from{translate:0 0}to{translate:0 4px}} #bob{animation:bob 1.2s ease-in-out infinite alternate}</style>
<header id="bar"><b>Sticky bar</b></header>
<p id="a">A plain paragraph.</p><p id="b">Another plain paragraph.</p>
<div class="card" id="shift">A card moved by a transform.</div>
<div class="card" id="bob">A card that keeps moving.</div>
<div class="card" id="look"><p class="sub" id="sub"></p></div>
<script>let k = 0; const W = 'words arrive one at a time here'.split(' '); setInterval(() => { const sub = document.getElementById('sub'); k = (k + 1) % (W.length + 2); sub.textContent = ''; for (const w of W.slice(0, k)) sub.append(Object.assign(document.createElement('span'), { textContent: w + ' ' })); }, 330);</script>
<p id="c">One more paragraph.</p><p id="d">And the last one.</p>`);
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv(), { stdio: 'ignore' });
await labUp(B);
const post = async (body) => (await (await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', name: 'Sam', ...body }) })).json()).comment;
const SPOTS = [['#bar', 'header'], ['#a', 'p'], ['#b', 'p'], ['#shift', 'div class="card"'], ['#bob', 'div class="card"'], ['#c', 'p'], ['#d', 'p'], ['#sub > span:nth-child(3)', 'span']];
for (const [i, [sel, tag]] of SPOTS.entries()) await post({ text: `pin ${i + 1}`, anchor: { kind: 'element', selector: sel, x: 0.3, y: 0.5, element: tag === 'span' ? '<span>' : `<${tag.split(' ')[0]} id="${sel.slice(1)}"${tag.includes(' ') ? ' ' + tag.split(' ').slice(1).join(' ') : ''}>` } });

// The pins seen on the page: drawn, not hidden, and the topmost thing at their middle.
const seen = (p) =>
  p.evaluate(() => {
    const r = document.querySelector('[data-lab-comments]').shadowRoot;
    return [...r.querySelectorAll('button.pin')].filter((b) => {
      const q = b.getBoundingClientRect();
      if (!q.width || getComputedStyle(b).visibility === 'hidden' || getComputedStyle(b).opacity === '0') return false;
      return document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2) === r.host && q.top > -40 && q.top < innerHeight + 40;
    }).length;
  });
// Waits until every pin shows (a subtitle turn is 9 ticks of 330 ms; its third word is there for 6 of them).
const allBack = async (p) => {
  for (let t = Date.now(); Date.now() - t < 4000; await sleep(50)) if ((await seen(p)) === SPOTS.length) return true;
  return false;
};
const settle = (p) => p.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 80)))));

try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } });
      await ctx.addInitScript(() => (localStorage.setItem('lab-on', '1'), localStorage.setItem('lab-name', 'leo')));
      const p = await ctx.newPage();
      await p.goto(B + '/');
      await p.waitForFunction(() => document.querySelector('[data-lab-comments]')?.shadowRoot?.querySelectorAll('button.pin').length >= 7, null, { timeout: 8000 });
      check(eng, 'every pin shows at first, the subtitle word\'s too', await allBack(p), `${await seen(p)}`);
      await sleep(1500);
      check(eng, 'the subtitle\'s pin stays while its words are written again', (await seen(p)) === SPOTS.length, `${await seen(p)}`);
      const toggle = () => p.evaluate(() => document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.toggle')?.click() ?? null);
      const btn = await p.evaluate(() => Boolean(document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.toggle')));
      check(eng, 'the hide/show button is there', btn);
      const lost = [];
      for (let round = 0; round < 12; round++) {
        await toggle();
        if (round % 3 === 0) await settle(p);
        await toggle();
        await (round % 2 ? sleep(5) : settle(p));
        await settle(p);
        if (!(await allBack(p))) lost.push(`round ${round}: ${await seen(p)}`);
      }
      check(eng, 'every pin comes back after hide and show, fast and slow', !lost.length, lost.join(', '));
      await p.mouse.wheel(0, 60);
      await sleep(300);
      for (let round = 0; round < 6; round++) {
        await p.keyboard.press('m');
        await sleep(round * 40);
        await p.keyboard.press('m');
        await sleep(400);
      }
      await p.mouse.wheel(0, -60);
      await sleep(100);
      check(eng, 'every pin comes back after hiding with the key and scrolling', await allBack(p), `${await seen(p)}`);
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
finish();
