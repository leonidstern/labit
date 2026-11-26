// An open comment card (a thread, and the new-comment box) stays beside its pin while the page scrolls: it moves with the pin, one frame at a time, and goes off screen with it. Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/cardscroll.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { claimPort } from './port.mjs';

const require = createRequire(import.meta.url);
const pw = (() => {
  for (const paths of [undefined, (process.env.NODE_PATH || '').split(path.delimiter)]) {
    try {
      return require(require.resolve('playwright', paths && { paths }));
    } catch {}
  }
  console.log('playwright is not installed: skipped');
  process.exit(0);
})();

const LAB = fileURLToPath(new URL('../../local.mjs', import.meta.url));
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'labit-cardscroll-'));
const PORT = claimPort(7990, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'long.html'), '<!doctype html><meta charset="utf-8"><title>k</title><h1 style="margin:100px 0 0 100px">Keys</h1><p style="margin-left:100px">text</p><div style="height:5000px"></div>');
fs.writeFileSync(path.join(DIR, 'stuck.html'), '<!doctype html><meta charset="utf-8"><title>s</title><h1 style="position:sticky;top:20px;margin:100px 0 0 100px;width:300px">Header</h1><div style="height:5000px"></div>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const env = { ...process.env, PORT: '', XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'labit-cfg-')), LABIT_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'labit-home-')), LABIT_NO_UPDATE_CHECK: '1', LABIT_EXIT_WITH_PARENT: '1' };
const server = spawn(process.execPath, [LAB, '--new', '--no-open'], { cwd: DIR, env });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 80; i++) {
  try {
    await fetch(B + '/');
    break;
  } catch {
    await sleep(100);
  }
}
let failed = 0;
const check = (eng, name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${eng.padEnd(8)} ${name}${detail ? ` (${detail})` : ''}`);
};
await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: '/long', name: 'Claude', text: 'a thread to scroll away from', anchor: { selector: 'h1', x: 0.5, y: 0.5, docX: 160, docY: 130, width: 200 } }) });
await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: '/stuck', name: 'Claude', text: 'a thread on a sticky header', anchor: { selector: 'h1', x: 0.5, y: 0.5, docX: 160, docY: 130, width: 200 } }) });
try {
  for (const eng of (process.env.ENGINES || 'webkit,chromium').split(',')) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await ctx.addInitScript(() => { localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      await p.goto(B + '/long');
      await p.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.scrim')), null, { timeout: 5000 });
      await sleep(800);
      const root = '[...document.querySelectorAll("*")].find((n) => n.shadowRoot?.querySelector(".scrim")).shadowRoot';
      // Once per animation frame: the open card's and its pin's tops. "pin" is the pin the card belongs to (the thread's, or the draft's).
      const record = () => p.evaluate(`(() => {
        const r = ${root};
        window.__frames = [];
        const tick = () => {
          const f = r.querySelector('.float:not(.out), .card:not(.out)');
          const c = f?.getBoundingClientRect();
          const pins = [...r.querySelectorAll('.pin')].map((e) => e.getBoundingClientRect()).filter((b) => b.width);
          const pin = pins.sort((a, b) => Math.abs(a.top - (c?.top ?? 0)) - Math.abs(b.top - (c?.top ?? 0)))[0];
          window.__frames.push(c && pin ? { card: c.top, pin: pin.top, sy: scrollY } : null);
          requestAnimationFrame(() => setTimeout(tick, 0)); // read after the frame is drawn: Chromium's rect reads in the frame's own callback miss the step an anchored box takes with the scroll
        };
        requestAnimationFrame(tick);
      })()`);
      await record();
      const state = () => p.evaluate(`(() => { const r = ${root}; const f = r.querySelector('.float:not(.out), .card:not(.out)'); if (!f) return null; const c = f.getBoundingClientRect();
        const pin = [...r.querySelectorAll('.pin')].map((e) => e.getBoundingClientRect()).filter((b) => b.width).sort((a, b) => Math.abs(a.top - c.top) - Math.abs(b.top - c.top))[0];
        return { card: Math.round(c.top), pin: pin && Math.round(pin.top), w: Math.round(c.width), x: Math.round(c.left) }; })()`);
      // A smooth scroll by wheel: 1500 px in steps, down and back.
      const wheel = async (total) => {
        await p.evaluate('window.__frames.length = 0');
        const step = total > 0 ? 50 : -50;
        for (let y = 0; Math.abs(y) < Math.abs(total); y += step) {
          await p.mouse.wheel(0, step);
          await sleep(16);
        }
        await sleep(300);
        return p.evaluate('window.__frames.slice()');
      };
      // The card keeps its offset to the pin in every frame, whatever the frame's scroll.
      const jitter = (frames, base) => {
        const seen = frames.filter(Boolean);
        const worst = Math.max(0, ...seen.map((f) => Math.abs(f.card - f.pin - base)));
        return { frames: seen.length, worst: Math.round(worst * 10) / 10 };
      };
      const run = async (label, openIt, stays = false) => {
        await p.evaluate('scrollTo(0, 0)');
        await sleep(300);
        await openIt();
        await sleep(600);
        await p.mouse.move(1200, 400); // the wheel turns over the page, not over the card
        const s0 = await state();
        check(eng, `${label}: open beside its pin`, s0 && s0.pin !== undefined && Math.abs(s0.card - s0.pin) < 300, JSON.stringify(s0));
        const base = s0.card - s0.pin;
        const down = await wheel(1500);
        const s1 = await state();
        const sy = await p.evaluate('scrollY');
        check(eng, `${label}: page scrolled`, sy > 1200, `scrollY ${sy}`);
        check(eng, `${label}: after 1500 px the card is ${stays ? 'still on screen' : 'above the screen'} with its pin`, s1 && (stays ? s1.card > 0 : s1.card < -300) && Math.abs(s1.card - s1.pin - base) <= 3, JSON.stringify(s1));
        check(eng, `${label}: the card keeps its width and its side`, s1.w === s0.w && Math.abs(s1.x - s0.x) <= 1, `${s0.w}@${s0.x} -> ${s1.w}@${s1.x}`);
        const j = jitter(down, base);
        check(eng, `${label}: scrolling down, the card's offset to its pin is the same in every frame`, j.frames > 10 && j.worst <= 3, JSON.stringify(j));
        const up = await wheel(-1500);
        const s2 = await state();
        check(eng, `${label}: back at the top the card is beside its pin again`, s2 && Math.abs(s2.card - s2.pin - base) <= 3, JSON.stringify(s2));
        const ju = jitter(up, base);
        check(eng, `${label}: scrolling up, the offset is the same in every frame`, ju.frames > 10 && ju.worst <= 3, JSON.stringify(ju));
        await p.keyboard.press('Escape');
        await sleep(400);
      };
      const pinPoint = () => p.evaluate(`(() => { const b = [...${root}.querySelectorAll('.pin')].map((e) => e.getBoundingClientRect()).find((b) => b.width && b.top > 0); return b && { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
      await run('a thread', async () => {
        const pt = await pinPoint();
        await p.mouse.click(pt.x, pt.y);
      });
      await run('the new-comment box', async () => {
        await p.mouse.click(600, 300);
      });
      // Opened low on the screen, where it goes above its pin or in from the edge: the first step of a scroll doesn't flip it.
      await run('a new-comment box low on the screen', async () => {
        await p.mouse.click(700, 770);
      });
      await run('a new-comment box at the right edge', async () => {
        await p.mouse.click(1255, 300);
      });
      // A pin on a sticky header stays on the screen, and its card with it.
      await p.goto(B + '/stuck');
      await p.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.scrim')), null, { timeout: 5000 });
      await sleep(800);
      await record();
      await run('a thread on a sticky header', async () => {
        const pt = await pinPoint();
        await p.mouse.click(pt.x, pt.y);
      }, true);
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
