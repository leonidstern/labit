// Drawings as quick actions, part 1: the real widget draws each mark on pricing.html (hold D, drag, let go), the lab
// sends it on lift, and the agent text for each one is saved to out/<id>.txt, with what the page read it as.
//   NODE_PATH=<folder with playwright-core>/node_modules node bench/drawings/draw.mjs
// Runs its own lab on a copy of this folder (port 4499), in Playwright's Chromium.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS } from './scenarios.mjs';
import { SHAPES } from './shapes.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SITE = join(HERE, 'out', 'site');
const PORT = 4499;
if (!process.env.ONLY) rmSync(join(HERE, 'out'), { recursive: true, force: true });
rmSync(SITE, { recursive: true, force: true });
mkdirSync(SITE, { recursive: true });
for (const f of ['pricing.html', 'site.css']) cpSync(join(HERE, f), join(SITE, f));

const lab = spawn('node', [join(ROOT, 'local.mjs'), '.', '--port', String(PORT), '--no-open', '--new'], { cwd: SITE, stdio: 'ignore' });
const stop = () => lab.kill();
process.on('exit', stop);
for (let i = 0; i < 40; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/pricing`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
// A name, as a person who has commented before has: with none, the drawing's box waits for one and nothing is sent.
await page.addInitScript(() => localStorage.setItem('lab-name', 'leo'));
page.on('console', (m) => process.env.ONLY && console.log('page:', m.text()));
await page.goto(`http://localhost:${PORT}/pricing`);
await page.waitForTimeout(1500);
// The box of the element's words (a person strikes or underlines the words, not the whole row), in the viewport.
const boxOf = async (sel, scroll = true) => {
  const l = page.locator(sel).first();
  if (scroll) await l.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  return l.evaluate((e) => {
    const r = document.createRange();
    r.selectNodeContents(e);
    const b = r.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
};
const seen = new Set();
const results = [];
for (const s of SCENARIOS.filter((x) => !process.env.ONLY || process.env.ONLY.split(",").includes(x.id))) {
  await page.goto(`http://localhost:${PORT}/pricing`); // each drawing on a fresh page, as a person comes back to it
  await page.waitForTimeout(1200);
  const from = await boxOf(s.on);
  const to = s.to ? await boxOf(s.to, false) : null;
  const strokes = SHAPES[s.mark](from, to);
  await page.mouse.move(strokes[0][0][0], strokes[0][0][1]);
  await page.keyboard.down('d');
  for (const st of strokes) {
    await page.mouse.move(st[0][0], st[0][1]);
    await page.mouse.down();
    for (const [x, y] of st.slice(1)) await page.mouse.move(x, y, { steps: 4 });
    if (process.env.ONLY) console.log("stroke", JSON.stringify(st.map((p) => p.map(Math.round))));
    await page.mouse.up();
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(1600); // sent a second after the last stroke
  await page.keyboard.up('d');
  await page.waitForTimeout(300);
  await page.waitForTimeout(700); // a drawing sends itself on lift (an Enter here would follow a link it was drawn on)
  const text = await (await fetch(`http://localhost:${PORT}/_lab/agent/pricing`)).text();
  const blocks = text.split(/\n(?=## \d+\. )/).slice(1);
  const mine = blocks.find((b) => !seen.has(/id ([0-9a-f]{12})/.exec(b)?.[1])) || '';
  seen.add(/id ([0-9a-f]{12})/.exec(mine)?.[1]);
  const read = /drawn: (.*)/.exec(mine)?.[1] || '(nothing sent)';
  // As a wait hands it over: the page and its file, then the comment.
  const head = text.split(/\n## /)[0].split('\n').filter((l) => /^(page|file): /.test(l)).join('\n');
  writeFileSync(join(HERE, 'out', `${s.id}.txt`), `${head}\n\n${mine}`);
  results.push({ id: s.id, mark: s.mark, read });
  console.log(`${s.id.padEnd(16)} ${s.mark.padEnd(9)} read as: ${read}`);
}
writeFileSync(join(HERE, 'out', 'reads.json'), JSON.stringify(results, null, 2));
await browser.close();
stop();
