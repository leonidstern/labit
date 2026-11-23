// How long the live ink takes per pointer move while a drawing is drawn (hold D and drag), on a lab page in Chromium:
// script time a move at points 1–100, ~1000 and ~2000 of one long stroke (mouse, and pen with pressure), and over ten
// strokes of 300, with the lines' elements made and thrown away. Moves are sent inside the page, so the times are the
// widget's own work, not the test driver's.
//   node bench/drawings/ink-bench.mjs [repo root to run, default this one]   (build it first: npm run build)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('playwright-core'); }
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'labit-inkbench-'));
const PORT = 4400 + Math.floor(Math.random() * 90);
fs.writeFileSync(path.join(DIR, 'p.html'), '<!doctype html><meta charset="utf-8"><title>P</title><body style="height:3000px"><h1>A page to draw on</h1><p>Some words.</p>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'labit-inkbench-home-'));
const lab = spawn('node', [path.join(ROOT, 'local.mjs'), '.', '--port', String(PORT), '--no-open', '--new'], { cwd: DIR, stdio: 'ignore', env: { ...process.env, LABIT_HOME: home, XDG_CONFIG_HOME: home } });
process.on('exit', () => lab.kill());
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/p`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
const browser = await pw.chromium.launch();
const out = {};
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'bench'); localStorage.setItem('lab-on', '1'); });
  const p = await ctx.newPage();
  await p.goto(`http://localhost:${PORT}/p`);
  await p.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.scrim')), null, { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 800));
  // In the page: n moves of the pointer that is down, timed one by one, and the ink's elements added and removed.
  const moves = (n, x0, y0, pen) => p.evaluate(([n, x0, y0, pen]) => {
    const root = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot;
    let made = 0, gone = 0;
    const mo = new MutationObserver((l) => { for (const m of l) { made += m.addedNodes.length; gone += m.removedNodes.length; } });
    mo.observe(root, { childList: true, subtree: true });
    const t = [];
    let at = performance.now();
    for (let i = 1; i <= n; i++) {
      const e = new PointerEvent('pointermove', { pointerId: 1, pointerType: pen ? 'pen' : 'mouse', isPrimary: true, pressure: pen ? 0.3 + 0.4 * Math.abs(Math.sin(i / 30)) : 0.5, buttons: 1, clientX: x0 + (i % 600) * 1.5, clientY: y0 + 60 * Math.sin(i / 40) + Math.floor(i / 600) * 40, bubbles: true, composed: true, cancelable: true });
      const s = performance.now();
      document.body.dispatchEvent(e);
      t.push(performance.now() - s);
      at = s;
    }
    mo.takeRecords().forEach((m) => { made += m.addedNodes.length; gone += m.removedNodes.length; });
    mo.disconnect();
    const live = root.querySelector('svg.ink.live');
    const avg = (a) => Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 1000) / 1000;
    return { first100: avg(t.slice(0, 100)), near1000: t.length >= 1000 ? avg(t.slice(900, 1000)) : null, near2000: t.length >= 2000 ? avg(t.slice(1900, 2000)) : null, worst: Math.round(Math.max(...t) * 100) / 100, total: Math.round(t.reduce((x, y) => x + y, 0)), made, gone, liveElements: live ? live.querySelectorAll('*').length : 0 };
  }, [n, x0, y0, pen]);
  const stroke = async (n, x0, y0, pen) => {
    await p.mouse.move(x0, y0);
    await p.mouse.down();
    await p.mouse.move(x0 + 12, y0 + 2); // past the 8 px that starts a stroke
    const r = await moves(n, x0, y0, pen);
    await p.mouse.up();
    return r;
  };
  const one = async (name, fn) => {
    await p.keyboard.down('d');
    out[name] = await fn();
    await p.keyboard.up('d');
    await new Promise((r) => setTimeout(r, 1500));
  };
  await one('one stroke, 2000 moves, mouse', () => stroke(2000, 100, 200, false));
  await one('one stroke, 2000 moves, pen pressure', () => stroke(2000, 100, 400, true));
  await one('ten strokes of 300 moves', async () => {
    const all = [];
    for (let k = 0; k < 10; k++) all.push(await stroke(300, 100 + k * 20, 150 + k * 50, false));
    return { lastStroke: all.at(-1), made: all.reduce((n, r) => n + r.made, 0), gone: all.reduce((n, r) => n + r.gone, 0), total: all.reduce((n, r) => n + r.total, 0) };
  });
} finally {
  await browser.close();
  lab.kill();
  console.log(JSON.stringify(out, null, 1));
}
