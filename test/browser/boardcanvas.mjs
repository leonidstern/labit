// A page's board view (src/board/overlay.ts), and the board's canvas. It fills the window over its page, with no half
// size and no edge to drag (Leo, 23 Nov, #422). A pan takes the board's pins along with their frames, in the same frame.
// Past the board's edge a pan just stops ("remove weird bounce"). The canvas is a grid of dots that goes with the camera.
// Not part of `npm test`.
// Run: node test/browser/boardcanvas.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish, withAlt } from './harness.mjs';

const pw = playwright();

const DIR = tmp('labit-boardcanvas-');
const PORT = claimPort(8360, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'pricing.html'), '<!doctype html><meta charset="utf-8"><title>Pricing</title><h1>Pricing one</h1><p>Plan two</p>');
fs.writeFileSync(path.join(DIR, 'canvas.html'), '<!doctype html><meta charset="utf-8"><title>Canvas</title><h1>Canvas</h1><p id="one">one</p><div style="height:900px"></div><p id="two">two</p><div style="height:3000px"></div>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT, flags: { board: true } }));
const server = startLab(DIR, labEnv());
await labUp(B);
await fetch(`${B}/_lab/api/board?name=pricing`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ v: 1, rev: 0, of: '/canvas', frames: [{ id: 'a', src: '/pricing', w: 390, h: 600, x: 0, y: 0 }, { id: 'b', src: '/pricing', w: 820, h: 600, x: 500, y: 0 }] }) });
try {
  for (const eng of engines('chromium,webkit')) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'zz-half'); localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => console.log('pageerror', e.message));
      const root = '[...document.querySelectorAll("*")].find((n) => n.shadowRoot?.querySelector(".scrim")).shadowRoot';
      const pins = () => p.evaluate(`[...${root}.querySelectorAll('.pin:not(.draft)')].length`);
      const note = async (x, y, words) => {
        const n = await pins();
        await sleep(200);
        await withAlt(p, () => p.mouse.click(x, y));
        await sleep(400);
        await p.keyboard.type(words);
        await p.keyboard.press('Enter');
        await p.waitForFunction(`[...${root}.querySelectorAll('.pin:not(.draft)')].length > ${n}`, null, { timeout: 4000 });
        await sleep(3600); // its card, open 3 s for undo, has closed
      };
      // a pin of the page itself (on "two", further down), then the board over the page and a pin on frame b
      await p.goto(B + '/canvas');
      await p.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.scrim')), null, { timeout: 5000 });
      await sleep(800);
      if (!(await pins())) {
        await p.evaluate(() => scrollTo(0, 700));
        await sleep(300);
        const two = await p.evaluate(() => { const r = document.getElementById('two').getBoundingClientRect(); return { x: r.x + 10, y: r.y + r.height / 2 }; });
        await note(two.x, two.y, 'on the page');
      }
      await p.goto(B + '/canvas#board=pricing');
      await p.reload(); // the address only gained its #board: the page is read again, and opens it
      await p.waitForFunction(() => window.__labBoard && document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('#lab-board .f[data-id="b"]'), null, { timeout: 8000 });
      await sleep(1200);
      const rect = (sel) => p.evaluate((s) => { const r = (s.startsWith('#lab-board') ? document.querySelector('[data-lab-board-view]').shadowRoot : document).querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom }; }, sel);
      const b0 = await rect('#lab-board .f[data-id="b"]');
      if ((await pins()) < 2) await note(b0.x + b0.w / 2, b0.y + b0.h / 2, 'on the board');
      // What is seen of the pins, each frame while fn runs: [board pin x, y, its position, page pin shown, page pin y, camera z, frame b's x, y]
      const watch = async (fn, ms = 500) => {
        await p.evaluate(`(() => {
          const r = ${root};
          const all = [...r.querySelectorAll('.pin:not(.draft)')];
          const board = all.find((q) => q.style.position === 'fixed');
          const page = all.find((q) => q.style.position !== 'fixed');
          const f = document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('#lab-board .f[data-id="b"]');
          window.__seen = [];
          const tick = () => {
            if (!window.__seen) return;
            const q = board.getBoundingClientRect();
            const g = f.getBoundingClientRect();
            const v = document.querySelector('[data-lab-board-view]').getBoundingClientRect();
            window.__seen.push([q.x, q.bottom, getComputedStyle(board).visibility, page ? getComputedStyle(page).visibility : '', page ? page.getBoundingClientRect().bottom : 0, window.__labBoard.camera().z, g.x, g.y, v.top, scrollY]);
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        })()`);
        await fn();
        await sleep(ms);
        return p.evaluate(() => { const s = window.__seen; window.__seen = null; return s; });
      };
      const spread = (rows, i) => Math.max(...rows.map((r) => r[i])) - Math.min(...rows.map((r) => r[i]));

      // ----- the canvas: dots that go with the camera
      const dots = () => p.evaluate(() => { const d = document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('#lab-board .dots'); const s = d && getComputedStyle(d); return d ? { img: s.backgroundImage, size: parseFloat(s.backgroundSize), pos: s.backgroundPosition, z: window.__labBoard.camera().z, kids: d.children.length } : null; });
      const d0 = await dots();
      check(eng, 'the canvas is a grid of dots: one background, sized by the zoom', Boolean(d0) && /radial-gradient/.test(d0.img) && d0.kids === 0 && Math.abs(d0.size - 32 * d0.z) < 0.5, JSON.stringify(d0));

      // ----- the board fills the window over its page (Leo, 23 Nov, #422): no half, no edge to drag
      const v0 = await rect('[data-lab-board-view]');
      const bar = await p.evaluate(() => { const r = document.querySelector('[data-lab-board-view]').shadowRoot; return { grip: Boolean(r.querySelector('.bv-grip, .bv-size')), back: r.querySelector('.bv-close')?.textContent }; });
      check(eng, 'the board opened over the whole window, with back and no size controls', Math.abs(v0.h - 800) < 2 && !bar.grip && /back/.test(bar.back || ''), JSON.stringify([v0, bar]));
      // ----- panning the board moves the pin with its frame, in the same frame
      await p.mouse.move(600, 600);
      const pans = await watch(async () => {
        for (let i = 0; i < 10; i++) {
          await p.mouse.wheel(12, 0);
          await sleep(30);
        }
      });
      const off = pans.map((r) => [r[0] - r[6], r[1] - r[7]]);
      check(eng, 'a pan takes the pin along with its frame, never a frame behind', spread(pans, 6) > 20 && Math.max(...off.map((o) => Math.abs(o[0] - off[0][0]))) < 0.6 && Math.max(...off.map((o) => Math.abs(o[1] - off[0][1]))) < 0.6, JSON.stringify([spread(pans, 6), off[0], off[off.length - 1]]));

      // ----- past the board's edge a pan just stops
      await p.keyboard.press('Shift+Digit2');
      await sleep(300);
      await p.mouse.move(600, 400);
      for (let i = 0; i < 6; i++) await p.mouse.wheel(3000, 0);
      await sleep(100);
      const edge = await rect('#lab-board .world');
      const past = await watch(async () => {
        for (let i = 0; i < 8; i++) {
          await p.mouse.wheel(900, 0);
          await sleep(20);
        }
      }, 700);
      const now = await rect('#lab-board .world');
      check(eng, 'past the edge a pan just stops: nothing gives way, nothing springs back', spread(past, 6) < 0.5 && Math.abs(now.x - edge.x) < 0.5, JSON.stringify([spread(past, 6), edge.x, now.x]));
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true });
}
finish();
