// BUG? (real widget, Chromium) A comment made after the page has loaded its list (GET /_lab/api/comments) and before the
// live stream's FIRST message is never shown. src/widget/live.ts:505/523-525: commentsRev starts null and the first
// message only stores v.comments; loadChanges() is asked only when commentsRev is already set. The list answer carries no
// version, so nothing tells the widget the list is older than that first message. The gap is the time from the list's
// GET to the stream's first message (a phone that sleeps or loses the wifi right after a reload makes it long; the torture
// test's "reload, then offline" steps make it exactly that). Here the stream's connection is held by the test.
// Run: node test/torture/repros/agent-widget-first-message.mjs   (needs playwright; prints PASS or BUG, or ERROR when the
// race was not set up, exits 0 either way)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { claimPort, tmp, rm, spawnLab, stop, up, sleep, H1 } from '../../harness.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const req = createRequire(import.meta.url);
let chromium;
for (const p of [undefined, path.join(here, '../../../../.labit-pw-scratch/node_modules')]) {
  try { ({ chromium } = req(req.resolve('playwright', p ? { paths: [p] } : undefined))); break; } catch {}
}
if (!chromium) { console.log('SKIP: playwright not found (set NODE_PATH)'); process.exit(0); }

const PORT = claimPort(23800, 20);
const DIR = tmp('repro-widget');
const HOME = tmp('home');
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><title>i</title><h1 id="t">hello</h1><p>text</p>');
const lab = spawnLab(DIR, PORT, { env: { ...process.env, LABIT_HOME: HOME, LABIT_NO_UPDATE_CHECK: '1', LABIT_IDLE_MS: '0' }, stdio: 'ignore' });
// What the page tells: the pill's "next new comment, N new" (the number of comments it holds that are new to this person).
const pins = (page) => page.evaluate(() => {
  const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.more'))?.shadowRoot;
  const m = r && [...r.querySelectorAll('[aria-label]')].map((n) => /next new comment, (\d+) new/.exec(n.getAttribute('aria-label') || '')).find(Boolean);
  return r ? (m ? Number(m[1]) : 0) : -1;
});
let browser;
try {
  await up(B + '/');
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('lab-name', 'Watcher'); localStorage.setItem('lab-on', '1'); } catch {} }); // comments on, as the torture test sets them
  const page = await ctx.newPage();
  let letGo;
  const held = new Promise((r) => (letGo = r));
  let streamAsked = false;
  await page.route('**/_lab/live**', async (route) => { streamAsked = true; await held; await route.continue().catch(() => {}); });
  // The race needs both: the page's (empty) list loaded, and its live stream held before it said anything.
  const listed = page.waitForResponse((r) => new URL(r.url()).pathname === '/_lab/api/comments' && r.request().method() === 'GET', { timeout: 10000 }).then(() => true, () => false);
  await page.goto(B + '/index', { waitUntil: 'load' });
  for (let i = 0; i < 50 && !streamAsked; i++) await sleep(100);
  if (!streamAsked || !(await listed)) {
    console.log(`ERROR: the race was not set up (${streamAsked ? '' : 'the live stream was not asked for; '}${(await listed) ? '' : 'the comment list was not loaded'})`);
    throw Object.assign(new Error('setup'), { quiet: true });
  }
  await sleep(100); // the list's answer is applied
  const made = await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', name: 'Leo', text: 'made while the stream was connecting', anchor: H1 }) });
  if (made.status !== 201) throw new Error('pin: ' + made.status);
  letGo(); // the stream connects now: its first message says "comments: 1"
  await sleep(2500);
  const shown = await pins(page);
  console.log(`the page says it holds this many new comments: ${shown} (expected 1; the lab holds 1)`);
  // Control (and how long it lasts): the next comment arrives through the open stream, as always.
  await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', name: 'Leo', text: 'second, after the stream was open', anchor: { ...H1, y: 0.9 } }) });
  await sleep(1500);
  console.log(`after a second pin through the open stream the page says ${await pins(page)} new (the lab holds 2): the first stays missing until a reload`);
  console.log(shown === 1 ? 'PASS' : 'BUG: a comment made between the list GET and the first live message never reaches the page');
} catch (e) {
  if (!e.quiet) throw e;
} finally {
  await browser?.close().catch(() => {});
  await stop(lab);
  rm([DIR, HOME], { maxRetries: 5 });
}
