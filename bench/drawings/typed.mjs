// The drawings' asks as typed pins: the real widget clicks the same element as each drawing (Option-click) and types the
// words a person would leave on any page, so the same comments can be compared with comments left elsewhere (an
// Artifact's comments). Saves the agent text a wait hands over to out/<id>.typed.txt.
//   NODE_PATH=<folder with playwright-core>/node_modules node bench/drawings/typed.mjs
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS } from './scenarios.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SITE = join(HERE, 'out', 'typed-site');
const PORT = 4497;
// What a person types on each spot: short, as on any page.
export const WORDS = {
  'x-fine': 'remove',
  'strike-li': 'drop this line',
  'scribble-note': 'remove this note',
  'x-solo-li': 'remove',
  'wavy-typo': 'typo',
  'circle-button': 'typo',
  'box-heading': 'typo',
  'underline-blurb': 'rewrite this',
  'side-lead': 'rework this',
  'caret-team': 'add an item here',
  'arrow-li': 'move this into the Team plan',
  'circle-price': 'is this right?',
};
if (import.meta.url === `file://${process.argv[1]}`) {
  rmSync(SITE, { recursive: true, force: true });
  mkdirSync(SITE, { recursive: true });
  for (const f of ['pricing.html', 'site.css']) cpSync(join(HERE, f), join(SITE, f));
  const lab = spawn('node', [join(ROOT, 'local.mjs'), '.', '--port', String(PORT), '--no-open', '--new'], { cwd: SITE, stdio: 'ignore' });
  process.on('exit', () => lab.kill());
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/pricing`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => localStorage.setItem('lab-name', 'leo'));
  const seen = new Set();
  for (const s of SCENARIOS) {
    await page.goto(`http://localhost:${PORT}/pricing`);
    await page.waitForTimeout(1200);
    const l = page.locator(s.on).first();
    await l.evaluate((e) => e.scrollIntoView({ block: 'center' }));
    const b = await l.evaluate((e) => {
      const r = document.createRange();
      r.selectNodeContents(e);
      let x = r.getBoundingClientRect();
      if (!x.width || !x.height) x = e.getBoundingClientRect();
      return { x: x.x, y: x.y, w: x.width, h: x.height };
    });
    await page.keyboard.down('Alt');
    await page.mouse.click(b.x + Math.min(b.w / 2, 40), b.y + b.h / 2);
    await page.keyboard.up('Alt');
    await page.waitForTimeout(400);
    await page.keyboard.type(WORDS[s.id], { delay: 10 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    const text = await (await fetch(`http://localhost:${PORT}/_lab/agent/pricing`)).text();
    const head = text.split(/\n## /)[0].split('\n').filter((x) => /^(page|file): /.test(x)).join('\n');
    const mine = text.split(/\n(?=## \d+\. )/).slice(1).find((x) => !seen.has(/id ([0-9a-f]{12})/.exec(x)?.[1])) || '';
    seen.add(/id ([0-9a-f]{12})/.exec(mine)?.[1]);
    writeFileSync(join(HERE, 'out', `${s.id}.typed.txt`), mine ? `${head}\n\n${mine}` : '');
    console.log(`${s.id.padEnd(16)} ${mine ? (/^element: (.*)$/m.exec(mine)?.[1] || '?') : 'MISSING'}`);
  }
  await browser.close();
  lab.kill();
}
