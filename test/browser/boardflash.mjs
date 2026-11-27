// The board view's opening, frame by frame (src/board/overlay.ts, mount.ts): what is painted never shows the board
// unfitted for a frame and fitted the next (Leo, 20 Nov: the open "flash").
// A frame's state is read as it is painted: last in the frame, after the board's own ResizeObserver has run (a read in
// requestAnimationFrame comes before it, and shows a state that is never drawn). Not part of `npm test`.
// Run: node test/browser/boardflash.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();

const DIR = tmp('labit-boardflash-');
const PORT = claimPort(8390, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'pricing.html'), '<!doctype html><meta charset="utf-8"><title>Pricing</title><h1>Pricing one</h1><p>Plan two</p>');
fs.writeFileSync(path.join(DIR, 'canvas.html'), '<!doctype html><meta charset="utf-8"><title>Canvas</title><meta name="viewport" content="width=device-width,initial-scale=1"><h1>Canvas</h1><a id="go" href="/_lab/board/pricing?of=%2Fcanvas">open the board</a><div style="height:3000px"></div>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT, flags: { board: true } }));
const server = startLab(DIR, labEnv());
await labUp(B);
await fetch(`${B}/_lab/api/board?name=pricing`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ v: 1, rev: 0, of: '/canvas', frames: [{ id: 'a', src: '/pricing', w: 390, h: 844, x: 0, y: 0 }, { id: 'b', src: '/pricing', w: 820, h: 600, x: 500, y: 0 }] }) });

// One row per frame: [t, view height, frame a x, y, width] as read in requestAnimationFrame (before the board's observer
// has run: a state that is never drawn) and the same read in the task after it (what that frame drew).
const SAMPLER = `(() => {
  const S = (window.__s = { rows: [], on: true, t0: performance.now() });
  const read = () => {
    const v = document.querySelector('[data-lab-board-view]');
    const f = v?.shadowRoot?.querySelector('#lab-board .f[data-id="a"]');
    if (!f) return [0, 0, 0, 0];
    // The frame's place in the view, not on the screen: the view slides up as it opens (as the comment drawer does).
    const g = f.getBoundingClientRect();
    const r = v.getBoundingClientRect();
    return [r.height, g.x, g.y - r.y, g.width];
  };
  const mc = new MessageChannel();
  mc.port1.onmessage = () => { const l = S.rows[S.rows.length - 1]; if (l && !l.drawn) l.drawn = read(); };
  const tick = () => { if (!S.on) return; S.rows.push({ t: Math.round(performance.now() - S.t0), raf: read() }); mc.port2.postMessage(0); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
})()`;

// An A, B, A of one number across frames: it goes by more than 20 and is back in the next frame.
const worstSpike = (vals) => {
  let worst = 0;
  for (let i = 1; i + 1 < vals.length; i++) if (Math.abs(vals[i - 1] - vals[i + 1]) < 2 && Math.abs(vals[i] - vals[i - 1]) > 20) worst = Math.max(worst, Math.abs(vals[i] - vals[i - 1]));
  return worst;
};
const sample = async (p, fn, ms = 900) => {
  await p.evaluate(SAMPLER);
  await sleep(100);
  await fn();
  await sleep(ms);
  return p.evaluate(() => { window.__s.on = false; return window.__s.rows.filter((r) => r.drawn); });
};

try {
  for (const [mode, opts] of [['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }], ['desktop', { viewport: { width: 1200, height: 800 } }]]) {
    for (const eng of engines('webkit,chromium')) {
      const name = `${eng} ${mode}`;
      const browser = await pw[eng].launch();
      try {
        const ctx = await browser.newContext(opts);
        await ctx.addInitScript(() => { try { localStorage.setItem('lab-name', 'zz-flash'); localStorage.setItem('lab-on', '1'); } catch {} });
        const p = await ctx.newPage();
        p.on('pageerror', (e) => console.log('pageerror', e.message));
        await p.goto(B + '/canvas');
        await p.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.scrim')), null, { timeout: 8000 });
        await sleep(800);
        // ----- open: the first frame that draws the board's frame has it already fitted
        const opened = await sample(p, async () => {
          await p.evaluate(() => document.getElementById('go').click());
        }, 1200);
        const o = opened.filter((r) => r.drawn[3] > 0);
        const rest = o[o.length - 1].drawn;
        const off = (r) => Math.max(Math.abs(r.drawn[1] - rest[1]), Math.abs(r.drawn[2] - rest[2]), Math.abs(r.drawn[3] - rest[3]));
        check(name, 'open: the first drawn frame of the board is already fitted (x, y, width as at rest)', off(o[0]) < 2, JSON.stringify([o[0].drawn, rest]));
        const unfitted = o.filter((r) => off(r) >= 2).length;
        check(name, 'open: no drawn frame shows the board unfitted', unfitted === 0, `${unfitted} frames: ${JSON.stringify(o.slice(0, 4).map((r) => [r.t, ...r.drawn]))}`);
        await sleep(600);
        await ctx.close();
      } finally {
        await browser.close();
      }
    }
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
}
finish();
