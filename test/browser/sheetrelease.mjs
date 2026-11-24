// A phone's sheet carries on at the finger's speed when it is let go, and the pill comes back softly (Apple's "Designing
// Fluid Interfaces": a thing you drag and let go continues at the finger's velocity; nothing starts steeply for no reason).
// The thread card is dragged by its handle with made-up touches paced by the clock (so the speed is exact) and let go at
// three speeds; its top is read on every frame after. Checks: the first frame moves about as far as the finger did in
// that time, the sheet never turns back, it ends where the rules say (back, full, closed), and the pill's frames rise
// steadily with no big first step. With LOG=1 the frames are printed. Run: node test/browser/sheetrelease.mjs
// (needs playwright). Not part of `npm test`; CI runs it in the `browser` job.
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });
const LOG = Boolean(process.env.LOG);

const DIR = tmp('labit-sheetrelease-');
const PORT = String(claimPort(6070, 30));
const B = `http://localhost:${PORT}`;
const paras = Array.from({ length: 30 }, (_, i) => `<p id="p${i}">paragraph ${i} with some words to read</p>`).join('');
fs.writeFileSync(path.join(DIR, 'index.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>S</title><body style="margin:20px">${paras}</body>`);
const server = startLab(DIR, labEnv({}, { settings: false }), { root: '.', port: PORT });
await labUp(B);
await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B },
  body: JSON.stringify({ page: '/index', name: 'Sam', text: 'A short one', anchor: { selector: '#p3', x: 0.2, y: 0.5, docX: 40, docY: 100, width: 390, element: '<p id="p3">' } }) });

// In the page: drives the sheet's handle and records frames. Runs in the page so the clock is the page's own.
const DRIVER = `(() => {
  const root = document.querySelector('[data-lab-comments]').shadowRoot;
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const sheet = () => root.querySelector('.card:not(.out)');
  window.__sr = {
    h: () => sheet().offsetHeight,
    top: () => sheet().getBoundingClientRect().top,
    full: () => sheet().classList.contains('full'),
    // Puts a finger on the handle, moves it by speed (px/ms, + down) for dist px, one move a frame, lets go on the next
    // frame, and records [ms since release, sheet top, pill top] for each frame after, for 'span' ms.
    async run({ segs, span = 700 }) {
      const node = sheet();
      const bar = root.querySelector('.bar');
      const handle = node.querySelector('.handle');
      const hr = handle.getBoundingClientRect();
      const x = hr.left + hr.width / 2;
      const y0 = hr.top + 76;
      const send = (type, y, node = handle) => {
        const e = new Event(type, { bubbles: true, cancelable: true, composed: true });
        Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] });
        node.dispatchEvent(e);
        return e;
      };
      const top0 = node.getBoundingClientRect().top;
      const drag = [];
      send('touchstart', y0);
      let y = y0;
      let t = await frame();
      for (const [speed, dist] of segs) {
        const ys = y;
        const ts = t;
        while (Math.abs(y - ys) < Math.abs(dist)) {
          t = await frame();
          y = ys + Math.sign(dist) * Math.abs(speed) * (t - ts); // past the end by a step at most: a finger doesn't slow for the last bit
          send('touchmove', y);
          drag.push([t, node.getBoundingClientRect().top]);
        }
      }
      // let go on the next frame, as a finger does
      const tr = await frame();
      const before = node.getBoundingClientRect().top;
      const tr0 = node.style.transform;
      send('touchend', y);
      const tr1 = node.style.transform + ' | ' + node.style.transition.slice(0, 60);
      const frames = [[0, before, bar.getBoundingClientRect().top]];
      const end = performance.now() + span;
      let tf = tr;
      while (performance.now() < end) {
        tf = await frame();
        const n = node.isConnected ? node : sheet();
        frames.push([tf - tr, n ? n.getBoundingClientRect().top : null, bar.getBoundingClientRect().top]);
      }
      return { frames, h: node.offsetHeight, open: Boolean(sheet()), full: node.classList.contains('full'), y: before - top0, tr0, tr1, drag };
    },
    // Closes the open sheet as a tap on the dimmed page does (or Escape), recording the pill the same way.
    async tapClose({ span = 700 }) {
      const bar = root.querySelector('.bar');
      const t0 = await frame();
      const frames = [[0, null, bar.getBoundingClientRect().top]];
      root.querySelector('.scrim').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      while (performance.now() < t0 + span) {
        const t = await frame();
        frames.push([t - t0, null, bar.getBoundingClientRect().top]);
      }
      return { frames };
    },
  };
})()`;

const steps = (a) => a.slice(1).map((v, i) => v - a[i]);

for (const eng of engines()) {
  const browser = await pw[eng].launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => localStorage.setItem('lab-name', 'tess'));
  const p = await ctx.newPage();
  await p.goto(B + '/');
  await p.waitForFunction(() => document.querySelector('[data-lab-comments]')?.shadowRoot?.querySelector('.pin'), null, { timeout: 20000 });
  await p.waitForTimeout(400);
  await p.evaluate(DRIVER);
  await p.waitForTimeout(2500); // the first thread read is marked seen and the list redrawn: not under a drag
  const open = async () => {
    // Nothing open from before (a thread still on its way out counts), the page at its top.
    await p.evaluate(() => document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.card:not(.out)') && document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.scrim').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })));
    await p.waitForFunction(() => !document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.card'), null, { timeout: 10000 });
    await p.waitForTimeout(500);
    await p.evaluate(() => scrollTo(0, 0));
    await p.waitForTimeout(200);
    const r = await p.evaluate(() => { const b = document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.pin').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    await p.touchscreen.tap(r.x, r.y);
    await p.waitForFunction(() => document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.card:not(.out) > .body'), null, { timeout: 10000 });
    await p.waitForTimeout(1200); // the sheet slides in, the page scrolls to the pin
  };
  const gone = (r) => r.frames.some((f) => f[1] === null || f[1] > 844 - 1);
  const sh = (r) => r.frames.map((f) => f[1]).filter((v) => v !== null);
  const cases = [
    // [name, the finger's moves [speed px/ms, signed distance px: + down], where it ends]
    ['slow drag, short', [[0.1, 50]], 'back'],
    ['medium swipe down', [[0.9, 90]], 'closed'],
    ['hard flick down', [[2.4, 70]], 'closed'],
    ['finger on its way back up', [[0.3, 130], [0.35, -30]], 'back-toward'],
    ['slow drag past halfway', [[0.1, 400]], 'closed-slow'],
  ];
  // How fast the sheet's top was going over the last ~100 ms of the drag (px/ms, + down).
  const speedAt = (drag) => {
    const last = drag.at(-1);
    const first = drag.find((d) => last[0] - d[0] <= 100) || drag[0];
    return (last[1] - first[1]) / (last[0] - first[0] || 1);
  };
  const run = async (name, segs, ends) => {
    await open();
    const rest = await p.evaluate(() => window.__sr.top());
    const r = await p.evaluate((a) => window.__sr.run(a), { segs });
    await p.waitForTimeout(600);
    const s = sh(r);
    const vs = speedAt(r.drag);
    const dt = r.frames[1]?.[0] || 16.7;
    const st = steps(s);
    const first = st[0];
    const dirn = ends.startsWith('closed') ? 1 : ends === 'full' ? -1 : -1;
    if (LOG) console.log(name, ends, 'vs', vs.toFixed(2), 'dt', dt.toFixed(1), r.tr0, '>>', r.tr1, 'steps', st.slice(0, 12).map((v) => v.toFixed(1)).join(' '), 'last', s.at(-1));
    const D = Math.abs(r.y);
    if (ends === 'closed') {
      const u = Math.max(0, vs);
      check(eng, `${name}: the first frame goes as far as the sheet was going (${(u * dt).toFixed(1)} px)`, first >= 0.6 * u * dt && first <= 1.6 * u * dt, `${first.toFixed(1)} px`);
    } else if (ends === 'closed-slow') {
      check(eng, `${name}: the first frame is not a jump (under ${(Math.max(0, vs) * dt * 1.6 + 2).toFixed(1)} px)`, first <= Math.max(0, vs) * dt * 1.6 + 2, `${first.toFixed(1)} px`);
    } else if (ends === 'back') {
      check(eng, `${name}: let go moving away, the first frame is soft (under 8% of ${D.toFixed(0)} px)`, Math.abs(first) <= 0.08 * D, `${first.toFixed(1)} px`);
    } else if (ends === 'back-toward') {
      const u = Math.max(0, -vs);
      check(eng, `${name}: the first frame goes as far as the sheet was going (${(u * dt).toFixed(1)} px)`, -first >= 0.6 * u * dt && -first <= 1.6 * u * dt, `${(-first).toFixed(1)} px`);
    }
    check(eng, `${name}: never turns back`, st.every((v) => v * dirn >= -1.5));
    if (ends.startsWith('closed')) check(eng, `${name}: closes`, !r.open && (gone(r) || s.at(-1) > 843));
    else check(eng, `${name}: ends where it sat`, r.open && Math.abs(s.at(-1) - rest) < 1.5, `${s.at(-1).toFixed(1)} vs ${rest.toFixed(1)}`);
  };
  for (const [name, segs, ends] of cases) await run(name, segs, ends);

  // The pill after a sheet closes: a tap on the dimmed page, and a swipe let go at speed.
  let pillHidden = 0;
  const bar = async (name, getRun) => {
    await open();
    pillHidden = await p.evaluate(() => document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.bar').getBoundingClientRect().top);
    const r = await getRun();
    await p.waitForTimeout(500);
    const tops = r.frames.map((f) => f[2]);
    const from = tops[0];
    const to = tops.at(-1);
    const travel = Math.abs(pillHidden - to);
    const st = steps(tops).map((v) => Math.abs(v));
    if (LOG) console.log(name, 'travel', travel.toFixed(1), 'tops', tops.slice(0, 6).map((v) => v.toFixed(1)).join(' '), 'steps', steps(tops).slice(0, 24).map((v) => v.toFixed(1)).join(' '));
    // the frame where the pill starts to move, not the frame the close was asked in
    const moving = steps(tops);
    const i0 = moving.findIndex((v) => Math.abs(v) > 0.05);
    const dirn = Math.sign(to - from) || -1;
    check(eng, `${name}: the pill comes back (${travel.toFixed(0)} px)`, travel > 30);
    check(eng, `${name}: its first frame moves under 20% of the way`, i0 >= 0 && Math.abs(moving[i0]) <= 0.2 * travel, `${i0 >= 0 ? Math.abs(moving[i0]).toFixed(1) : '-'} of ${travel.toFixed(1)} px`);
    check(eng, `${name}: it only ever goes one way`, moving.every((v) => v * dirn >= -0.3));
    return r;
  };
  await bar('close by a tap: pill', () => p.evaluate(() => window.__sr.tapClose({ span: 700 })));
  await bar('close by a swipe (0.6 px/ms): pill', () => p.evaluate(() => window.__sr.run({ segs: [[0.6, 90]], span: 700 })));
  await bar('close by a flick (2.4 px/ms): pill', () => p.evaluate(() => window.__sr.run({ segs: [[2.4, 70]], span: 700 })));
  // Pulled up fast: it takes the screen (full), starting at the speed it was going.
  await open();
  const rest0 = await p.evaluate(() => window.__sr.top());
  const rf = await p.evaluate((a) => window.__sr.run(a), { segs: [[1.6, -70]] });
  await p.waitForTimeout(600);
  {
    const s = sh(rf);
    const st = steps(s);
    const vs = speedAt(rf.drag);
    const dt = rf.frames[1]?.[0] || 16.7;
    if (LOG) console.log('flick up full', 'vs', vs.toFixed(2), 'steps', st.slice(0, 12).map((v) => v.toFixed(1)).join(' '), 'last', s.at(-1));
    check(eng, `flick up: the first frame goes as far as the sheet was going (${(-vs * dt).toFixed(1)} px)`, -st[0] >= 0.6 * -vs * dt && -st[0] <= 1.6 * -vs * dt, `${(-st[0]).toFixed(1)} px`);
    check(eng, 'flick up: never turns back', st.every((v) => v <= 1.5));
    check(eng, 'flick up: ends full', rf.full && s.at(-1) < rest0 - 20, `${s.at(-1).toFixed(1)} vs ${rest0.toFixed(1)}`);
  }
  await browser.close();
}
server.kill();
fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
finish();
