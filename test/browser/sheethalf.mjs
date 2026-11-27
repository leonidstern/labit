// A phone's thread pulled up to full and pulled back down goes to its half height in one move (iOS 18 Pro simulator,
// 27 Nov: let go 90-180 px down from full, the height dropped from full to half in one frame while the finger's offset
// still played out, so the sheet fell past half and rose back to it, 175 px). The thread card is pulled up to full, then
// its handle is dragged down at three paces with made-up touches paced by the clock (as sheetrelease does: no engine
// Playwright drives makes a real touch drag in Safari) and let go; the card's top is read on every frame after. Checks:
// it ends at half, at the top it had there before, every frame's top moves down toward it (never back up), and no frame
// goes past it. With LOG=1 the frames are printed. Run: node test/browser/sheethalf.mjs (needs playwright). Not part of
// `npm test`; CI runs it in the `browser` job.
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });
const LOG = Boolean(process.env.LOG);

const DIR = tmp('labit-sheethalf-');
const PORT = String(claimPort(6230, 30));
const B = `http://localhost:${PORT}`;
const paras = Array.from({ length: 30 }, (_, i) => `<p id="p${i}">paragraph ${i} with some words to read</p>`).join('');
fs.writeFileSync(path.join(DIR, 'index.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>H</title><body style="margin:20px">${paras}</body>`);
const server = startLab(DIR, labEnv({}, { settings: false }), { root: '.', port: PORT });
await labUp(B);
await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B },
  body: JSON.stringify({ page: '/index', name: 'Sam', text: 'A short one', anchor: { selector: '#p3', x: 0.2, y: 0.5, docX: 40, docY: 100, width: 390, element: '<p id="p3">' } }) });

// In the page: drags the open card's handle by [speed px/ms, signed px] steps, one move a frame, lets go on the next
// frame and records the card's top on each frame after, for `span` ms.
const DRIVER = `(() => {
  const root = document.querySelector('[data-lab-comments]').shadowRoot;
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const sheet = () => root.querySelector('.card:not(.out)');
  window.__sh = {
    top: () => sheet().getBoundingClientRect().top,
    full: () => sheet().classList.contains('full'),
    async run({ segs, span = 900 }) {
      const node = sheet();
      const handle = node.querySelector('.handle');
      const hr = handle.getBoundingClientRect();
      const x = hr.left + hr.width / 2;
      const y0 = hr.top + hr.height / 2;
      const send = (type, y) => {
        const e = new Event(type, { bubbles: true, cancelable: true, composed: true });
        Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] });
        handle.dispatchEvent(e);
      };
      send('touchstart', y0);
      let y = y0;
      let t = await frame();
      for (const [speed, dist] of segs) {
        const ys = y;
        const ts = t;
        while (Math.abs(y - ys) < Math.abs(dist)) {
          t = await frame();
          y = ys + Math.sign(dist) * Math.abs(speed) * (t - ts);
          send('touchmove', y);
        }
      }
      await frame();
      const tops = [node.getBoundingClientRect().top];
      send('touchend', y);
      const end = performance.now() + span;
      while (performance.now() < end) {
        await frame();
        const n = node.isConnected ? node : sheet(); // a redraw may put a new card in its place
        tops.push(n ? n.getBoundingClientRect().top : 1e4);
      }
      const n = sheet();
      return { tops, full: Boolean(n?.classList.contains('full')), open: Boolean(n) };
    },
  };
})()`;

for (const eng of engines()) {
  const browser = await pw[eng].launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => localStorage.setItem('lab-name', 'tess'));
  const p = await ctx.newPage();
  await p.goto(B + '/');
  await p.waitForFunction(() => document.querySelector('[data-lab-comments]')?.shadowRoot?.querySelector('.pin'), null, { timeout: 20000 });
  await p.waitForTimeout(400);
  await p.evaluate(DRIVER);
  const r = await p.evaluate(() => { const b = document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.pin').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await p.touchscreen.tap(r.x, r.y);
  await p.waitForFunction(() => document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.card:not(.out) > .body'), null, { timeout: 10000 });
  // The sheet slides in, the page scrolls to the pin, the thread is marked read and redrawn (a new card): wait for one
  // card that has stayed for a second.
  await p.waitForFunction(() => {
    const w = /** @type {any} */ (window);
    const c = document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.card:not(.out)');
    w.__same = c && c === w.__card ? (w.__same || 0) + 1 : 0;
    w.__card = c;
    return w.__same >= 10;
  }, null, { polling: 100, timeout: 10000 });
  const half = await p.evaluate(() => window.__sh.top());
  // [name, the drag down from full: [speed px/ms, px] steps]
  const cases = [
    ['quick pull, 90 px', [[0.9, 90]]],
    ['quick pull, 180 px', [[0.9, 180]]],
    ['0.3 s pull, 120 px', [[0.4, 120]]],
  ];
  for (const [name, segs] of cases) {
    const up = await p.evaluate(() => window.__sh.run({ segs: [[1.6, -70]], span: 900 }));
    const fullTop = await p.evaluate(() => window.__sh.top());
    if (LOG) console.log(eng, name, 'up', up.tops.map((v) => v.toFixed(0)).join(' '));
    if (!up.full) { check(eng, `${name}: pulled up to full first`, false, `top ${fullTop.toFixed(1)}`); continue; }
    const res = await p.evaluate((segs) => window.__sh.run({ segs, span: 1000 }), segs);
    await p.waitForTimeout(300);
    const t = res.tops;
    const st = t.slice(1).map((v, i) => v - t[i]);
    if (LOG) console.log(eng, name, 'half', half.toFixed(1), 'full', fullTop.toFixed(1), 'tops', t.map((v) => v.toFixed(0)).join(' '));
    check(eng, `${name}: ends at half, where it sat`, res.open && !res.full && Math.abs(t.at(-1) - half) < 1.5, `${t.at(-1).toFixed(1)} vs ${half.toFixed(1)}`);
    check(eng, `${name}: every frame moves down toward half, never back up`, st.every((v) => v >= -1), st.map((v) => v.toFixed(1)).join(' '));
    check(eng, `${name}: no frame goes past half`, Math.max(...t) <= half + 1.5, `lowest top ${Math.max(...t).toFixed(1)} vs half ${half.toFixed(1)}`);
  }
  await browser.close();
}
server.kill();
fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
finish();
