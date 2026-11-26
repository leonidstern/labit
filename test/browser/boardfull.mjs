// A board's page frames show the whole page: the frame is as tall as its page, nothing scrolls inside it, a page sized by
// the window's height (100vh) does not grow without end, and the frames under a grown one move down to keep clear of it
// (Leo, 26 Nov: "dont show pages inside boards pls i cant scroll there zoom or whatever, always show full thing").
// Not part of `npm test`. Run: node test/browser/boardfull.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();
const DIR = tmp('labit-boardfull-');
const PORT = claimPort(8420, 30);
const B = `http://localhost:${PORT}`;
const doc = (t, body) => `<!doctype html><meta charset="utf-8"><title>${t}</title><style>body{margin:0}</style>${body}`;
fs.writeFileSync(path.join(DIR, 'long.html'), doc('Long', '<h1>Long</h1><div style="height:2400px;background:linear-gradient(#cde,#edc)"></div><p id="end">end</p>'));
fs.writeFileSync(path.join(DIR, 'hero.html'), doc('Hero', '<section style="min-height:100vh;background:#dfe">hero</section><div style="height:1000px">rest</div><p id="end">end</p>'));
fs.writeFileSync(path.join(DIR, 'short.html'), doc('Short', '<p>short</p>'));
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);
await fetch(`${B}/_lab/api/board?name=full`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ v: 1, rev: 0, frames: [
  { id: 'a', src: '/long', w: 600, h: 500, x: 0, y: 0 },
  { id: 'b', src: '/hero', w: 600, h: 500, x: 700, y: 0 },
  { id: 'c', src: '/short', w: 600, h: 500, x: 1400, y: 0 },
  { id: 'd', src: '/short', w: 600, h: 300, x: 0, y: 660 }, // under a: moved down as a grows, the gap kept
] }) });
try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'tester'); localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => console.log('pageerror', e.message));
      await p.goto(B + '/_lab/board/full');
      await p.waitForFunction(() => ['a', 'b', 'c'].every((i) => document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector(`iframe[name="lab:${i}"]`)?.dataset.ready), null, { timeout: 10000 });
      await sleep(800);
      const read = () => p.evaluate(() => Object.fromEntries(['a', 'b', 'c', 'd'].map((i) => {
        const box = document.querySelector('[data-lab-board-view]').shadowRoot.querySelector(`#lab-board .f[data-id="${i}"]`);
        const fr = box.querySelector('iframe');
        const d = fr?.contentDocument;
        return [i, { boxH: parseFloat(box.style.height), top: parseFloat(box.style.top), frH: fr?.offsetHeight, pageH: d && Math.max(d.documentElement.scrollHeight, d.body.scrollHeight), inner: d && d.documentElement.scrollHeight - d.documentElement.clientHeight, end: d?.getElementById('end')?.getBoundingClientRect().bottom }];
      })));
      const r = await read();
      check(eng, `a long page's frame is as tall as its page`, r.a.boxH === r.a.pageH && r.a.boxH > 2400 && r.a.frH === r.a.boxH, JSON.stringify(r.a));
      check(eng, `nothing scrolls inside it (its end is in the frame)`, r.a.inner <= 0 && r.a.end <= r.a.frH, JSON.stringify(r.a));
      check(eng, `a 100vh page is its device's height plus the rest, not more`, r.b.boxH >= 1500 && r.b.boxH <= 1560 && r.b.end <= r.b.frH, JSON.stringify(r.b));
      check(eng, `a short page keeps its device's height`, r.c.boxH === 500, JSON.stringify(r.c));
      check(eng, `the frame under a grown one moves down, the gap kept`, r.d.top === r.a.boxH + 160, JSON.stringify({ a: r.a, d: r.d }));
      await sleep(1500);
      const r2 = await read();
      check(eng, `the 100vh page does not keep growing`, r2.b.boxH === r.b.boxH, JSON.stringify({ was: r.b.boxH, now: r2.b.boxH }));
      // a reload draws them tall at once (kept per frame), before any page has loaded
      await p.reload();
      await p.waitForFunction(() => document.querySelector('[data-lab-board-view]').shadowRoot.querySelector('#lab-board .f[data-id="a"]'), null, { timeout: 8000 });
      const first = await p.evaluate(() => parseFloat(document.querySelector('[data-lab-board-view]').shadowRoot.querySelector('#lab-board .f[data-id="a"]').style.height));
      check(eng, `after a reload the frame is tall from the start`, first === r.a.boxH, JSON.stringify({ first, was: r.a.boxH }));
      // "fit" shows every frame whole
      await p.waitForFunction(() => document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('iframe[name="lab:a"]')?.dataset.ready, null, { timeout: 8000 });
      await sleep(600);
      const fits = await p.evaluate(() => [...document.querySelector('[data-lab-board-view]').shadowRoot.querySelectorAll('#lab-board .f')].every((f) => { const b = f.getBoundingClientRect(); return b.top >= -1 && b.bottom <= innerHeight + 1; }));
      check(eng, 'fit shows every frame whole', fits);
      // the wheel over an entered frame pans the board
      await p.evaluate(() => { const a = document.querySelector('[data-lab-board-view]').shadowRoot.querySelector('#lab-board .f[data-id="a"]'); a.classList.add('in'); });
      const before = await p.evaluate(() => document.querySelector('[data-lab-board-view]').shadowRoot.querySelector('#lab-board .world').style.transform);
      const box = await p.evaluate(() => { const b = document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('iframe[name="lab:a"]').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + 40 }; });
      await p.mouse.move(box.x, box.y);
      await p.mouse.wheel(0, 200);
      await sleep(500);
      const after = await p.evaluate(() => document.querySelector('[data-lab-board-view]').shadowRoot.querySelector('#lab-board .world').style.transform);
      check(eng, `a wheel over an open frame moves the board`, before !== after, JSON.stringify({ before, after }));
      await p.evaluate(() => document.querySelector('[data-lab-board-view]').shadowRoot.querySelector('#lab-board .f[data-id="a"]').classList.remove('in'));
      // With the pin tool (C) a plain click on a frame comments, at its top and far down its page (Leo, 26 Nov: "cant comment
      // pin on board"); the pin is on frame a, at the page's own px.
      const sr = '[...document.querySelectorAll("*")].find((n) => n.shadowRoot?.querySelector(".scrim"))?.shadowRoot';
      const draft = () => p.evaluate(`Boolean(${sr}?.querySelector('.pin.draft'))`);
      await p.mouse.move(600, 400);
      await p.keyboard.press('c');
      await sleep(300);
      for (const [where, k] of [['top', 0.03], ['far down', 0.95]]) {
        const a = await p.evaluate(() => { const r = document.querySelector('[data-lab-board-view]').shadowRoot.querySelector('#lab-board .f[data-id="a"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y, h: r.height }; });
        const y = a.y + a.h * k;
        const spot = await p.evaluate(([x, y]) => __labBoard.anchor(x, y), [a.x, y]);
        await p.mouse.click(a.x, y);
        await sleep(700);
        check(eng, `with the pin tool a click comments on the frame (${where})`, (await draft()) && spot.frame === 'a' && (k < 0.5 ? spot.fy < 300 : spot.fy > 2200), JSON.stringify(spot));
        await p.keyboard.press('Escape');
        await sleep(500);
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
finish();
