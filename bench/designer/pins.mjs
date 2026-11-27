// Designer review, drawing vs text, part 1: for each scenario (scenarios.json, written by Fable from brief.md), the
// real widget makes the same comment two ways on app.html: drawn (hold D, the mark, no words) and typed (click the
// element, type the scenario's text, Enter). The agent text a wait would hand over is saved to out/<id>.draw.txt and
// out/<id>.text.txt.
//   NODE_PATH=<folder with playwright-core>/node_modules node bench/designer/pins.mjs
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
const OUT = join(HERE, 'out');
const SITE = join(OUT, 'site');
const PORT = 4498;
const SCEN = JSON.parse(readFileSync(join(HERE, 'scenarios.json'), 'utf8'));
rmSync(OUT, { recursive: true, force: true });
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
// The arrow mode: an Option-click pins there (in the comment mode it is the page's own click).
await page.addInitScript(() => { localStorage.setItem('lab-name', 'leo'); localStorage.setItem('lab-on', '1'); localStorage.setItem('lab-mode', 'use'); });
// The comment's save, set up before the key that sends it.
const saved = () => page.waitForResponse((r) => r.url().endsWith('/_lab/api/comments') && r.request().method() === 'POST', { timeout: 8000 }).catch(() => null);
const fresh = async () => {
  await page.goto(`http://localhost:${PORT}/app`);
  await page.waitForTimeout(1200);
};
const loc = (sel) => page.locator(sel).first();
// The box of the element's words when it has some (a person marks the words), else the element's own box.
const boxOf = async (sel, scroll = true) => {
  if (scroll) await loc(sel).evaluate((e) => e.scrollIntoView({ block: 'center' }));
  return loc(sel).evaluate((e) => {
    const r = document.createRange();
    r.selectNodeContents(e);
    let b = r.getBoundingClientRect();
    if (!b.width || !b.height) b = e.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
};
const seen = new Set();
const newest = async () => {
  const text = await (await fetch(`http://localhost:${PORT}/_lab/agent/app`)).text();
  const head = text.split(/\n## /)[0].split('\n').filter((l) => /^(page|file): /.test(l)).join('\n');
  const mine = text.split(/\n(?=## \d+\. )/).slice(1).find((b) => !seen.has(/id ([0-9a-f]{12})/.exec(b)?.[1])) || '';
  seen.add(/id ([0-9a-f]{12})/.exec(mine)?.[1]);
  return mine ? `${head}\n\n${mine}` : '';
};
const reads = [];
for (const s of SCEN) {
  const n = await page.locator(s.on).count().catch(() => 0);
  const m = s.to ? await page.locator(s.to).count().catch(() => 0) : 1;
  // Drawn.
  await fresh();
  if (n !== 1 || m !== 1) console.log(`  ${s.id}: selector matches ${n}${s.to ? ` / ${m}` : ''}`);
  const from = await boxOf(s.on);
  const to = s.to ? await boxOf(s.to, false) : null;
  const strokes = SHAPES[s.mark](from, to);
  await page.mouse.move(strokes[0][0][0], strokes[0][0][1]);
  await page.keyboard.down('d');
  for (const st of strokes) {
    await page.mouse.move(st[0][0], st[0][1]);
    await page.mouse.down();
    for (const [x, y] of st.slice(1)) await page.mouse.move(x, y, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(1600);
  await page.keyboard.up('d');
  await page.waitForTimeout(300);
  let save = saved();
  await page.keyboard.press('Enter'); // the box opens with the lines: Enter sends the drawing as it is, no words
  await save;
  const drawn = await newest();
  writeFileSync(join(OUT, `${s.id}.draw.txt`), drawn);
  // Typed: a click on the same element (Option-click, which pins links and controls too), the words, Enter.
  await fresh();
  const b = await boxOf(s.on);
  await page.keyboard.down('Alt');
  await page.mouse.click(b.x + Math.min(b.w / 2, 40), b.y + b.h / 2);
  await page.keyboard.up('Alt');
  await page.waitForTimeout(400);
  await page.keyboard.type(s.text, { delay: 10 });
  save = saved();
  await page.keyboard.press('Enter');
  await save;
  const typed = await newest();
  writeFileSync(join(OUT, `${s.id}.text.txt`), typed);
  const read = /drawn: (.*)/.exec(drawn)?.[1] || '(nothing sent)';
  reads.push({ id: s.id, mark: s.mark, read, typed: Boolean(typed) });
  console.log(`${s.id.padEnd(26)} ${s.mark.padEnd(9)} read as: ${read.padEnd(40)} text pin: ${typed ? 'ok' : 'MISSING'}`);
}
writeFileSync(join(OUT, 'reads.json'), JSON.stringify(reads, null, 2));
await browser.close();
lab.kill();
