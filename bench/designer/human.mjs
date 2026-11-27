// Designer review at human speed: each of the 12 problems is commented three ways in the real widget, paced like a
// person (pointing, a mouse drawing at a steady speed, typing at an average typist's pace), and timed from the first
// move to the comment being saved. Paces from the Keystroke-Level Model (Card, Moran & Newell): P 1.1 s to point,
// K 0.28 s a key (about 40 words a minute), M 1.35 s to think, the same for every way and said apart.
//   NODE_PATH=<folder with playwright-core>/node_modules node bench/designer/human.mjs
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHAPES } from '../drawings/shapes.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SITE = join(HERE, 'human-site');
const PORT = 4497;
const SCEN = JSON.parse(readFileSync(join(HERE, 'scenarios.json'), 'utf8'));
const PACE = { point: 1100, key: 280, think: 1350, drawPxPerS: Number(process.env.DRAW_SPEED || 600), between: 250 };
rmSync(SITE, { recursive: true, force: true });
mkdirSync(SITE, { recursive: true });
cpSync(join(HERE, 'app.html'), join(SITE, 'app.html'));
const lab = spawn('node', [join(ROOT, 'local.mjs'), '.', '--port', String(PORT), '--no-open', '--new'], { cwd: SITE, stdio: 'ignore' });
process.on('exit', () => lab.kill());
for (let i = 0; i < 40; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/app`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const wait = (ms) => page.waitForTimeout(ms);
const count = async () => (await (await fetch(`http://localhost:${PORT}/_lab/api/comments?page=/app`)).json()).comments?.length ?? 0;
const savedAfter = async (n, t0) => {
  for (let i = 0; i < 200; i++) {
    if ((await count()) > n) return Date.now() - t0;
    await new Promise((r) => setTimeout(r, 50));
  }
  return NaN;
};
const boxOf = async (sel, scroll = true) => {
  const l = page.locator(sel).first();
  if (scroll) await l.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  return l.evaluate((e) => {
    const r = document.createRange();
    r.selectNodeContents(e);
    let b = r.getBoundingClientRect();
    if (!b.width || !b.height) b = e.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
};
// A stroke at a steady speed, in 8 px steps.
const drawStroke = async (pts) => {
  let len = 0;
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const d = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.round(d / 8));
    for (let k = 1; k <= n; k++) {
      await page.mouse.move(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
      await wait((d / n / PACE.drawPxPerS) * 1000);
    }
    len += d;
  }
  await page.mouse.up();
  return len;
};
const fresh = async () => {
  await page.goto(`http://localhost:${PORT}/app`);
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('lab-typing')).forEach((k) => localStorage.removeItem(k))); // no draft left from the last try
  await page.reload();
  await wait(1000);
};
const rows = [];
for (const s of SCEN) {
  const row = { id: s.id, kind: s.kind, mark: s.mark, chars: s.text.length };
  for (const arm of ['draw', 'text', 'both']) {
    await fresh();
    const from = await boxOf(s.on);
    const to = s.to ? await boxOf(s.to, false) : null;
    const n = await count();
    const t0 = Date.now();
    await wait(PACE.point); // the hand goes to the spot
    let ink = 0;
    if (arm === 'text') {
      await page.keyboard.down('Alt');
      await page.mouse.click(from.x + Math.min(from.w / 2, 40), from.y + from.h / 2);
      await page.keyboard.up('Alt');
      await page.keyboard.type(s.text, { delay: PACE.key });
    } else {
      const strokes = SHAPES[s.mark](from, to);
      await page.keyboard.down('d');
      for (const [i, st] of strokes.entries()) {
        if (i) await wait(PACE.between);
        ink += await drawStroke(st);
      }
      await page.keyboard.up('d');
      await wait(150); // the box opening
      if (arm === 'both') await page.keyboard.type(s.text, { delay: PACE.key });
    }
    await wait(PACE.key);
    await page.keyboard.press('Enter');
    const ms = await savedAfter(n, t0);
    if (Number.isNaN(ms)) console.log('  not saved:', arm, JSON.stringify(await page.evaluate(() => { const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot; return { box: Boolean(r?.querySelector('.float textarea')), typed: r?.querySelector('.float textarea')?.value, err: r?.querySelector('.float .error')?.textContent }; })));
    row[arm] = Math.round(ms / 100) / 10;
    if (arm !== 'text') row.inkPx = Math.round(ink);
  }
  rows.push(row);
  console.log(`${s.id.padEnd(26)} ${s.mark.padEnd(9)} draw ${row.draw}s  text ${row.text}s  both ${row.both}s  (ink ${row.inkPx}px, ${row.chars} chars)`);
}
// Over the saved ones only: one that never saved (NaN) would make the average NaN. How many didn't is said.
const saved = (k) => rows.map((r) => r[k]).filter(Number.isFinite);
const avg = (k) => (saved(k).length ? Math.round((saved(k).reduce((a, v) => a + v, 0) / saved(k).length) * 10) / 10 : null);
const sum = { draw: avg('draw'), text: avg('text'), both: avg('both'), notSaved: Object.fromEntries(['draw', 'text', 'both'].map((k) => [k, rows.length - saved(k).length])), think: PACE.think / 1000, pace: PACE };
console.log(`average to saved: draw ${sum.draw}s · text ${sum.text}s · both ${sum.both}s (plus ${sum.think}s to think, each)`);
const lost = Object.entries(sum.notSaved).filter(([, n]) => n);
if (lost.length) console.log(`not saved, left out of the averages: ${lost.map(([k, n]) => `${k} ${n}`).join(', ')}`);
writeFileSync(join(HERE, 'human.json'), JSON.stringify({ rows, sum }, null, 2));
await browser.close();
lab.kill();
rmSync(SITE, { recursive: true, force: true });
