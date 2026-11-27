// Repro: a reply shows twice in a real browser when the lab's answer to the POST reaches the page after the live
// stream + /changes already brought the same comment (src/comments.js send() / src/widget/thread.ts onSubmit push it blindly).
// One browser, one pin, one reply; the only "fault" is a delay on the POST's answer (DELAY ms, default 300; the lab
// has already saved and broadcast by then). Usage: node dup-comment-browser.mjs [delayMs]   (ENGINES=chromium,webkit)
// Prints PASS (no duplicate) or BUG per engine, with what the card, the lab and .lab hold; exits 0 either way.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimPort } from '../../browser/port.mjs';
// As the torture runner looks for playwright: the folder beside this checkout where this machine keeps it.
process.env.NODE_PATH = [process.env.NODE_PATH, fileURLToPath(new URL('../../../../.labit-pw-scratch/node_modules', import.meta.url))].filter(Boolean).join(path.delimiter);
const { playwright, engines, tmp, labEnv, startLab, labUp, sleep } = await import('../../browser/harness.mjs');

const DELAY = Number(process.argv[2] ?? process.env.DELAY ?? 300);
const pw = playwright();
let bug = false;
for (const eng of engines()) {
  // A lab of its own per engine: each starts with one pin and no replies.
  const dir = tmp('labit-dupcomment-');
  const port = claimPort(23000, 1800);
  const B = `http://localhost:${port}`;
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><title>p</title><body style="margin:40px"><p id="a">first line</p></body>');
  const server = startLab(dir, labEnv({ LAB_SETTLE_MS: '0' }, { settings: false }), { root: '.', port });
  let browser;
  try {
    await labUp(B);
    await fetch(B + '/_lab/api/comments', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: B },
      body: JSON.stringify({ page: '/index', name: 'Leo', text: 'the pin', anchor: { selector: '#a', x: 0.2, y: 0.5, docX: 0.1, docY: 20, width: 1000, element: '<p id="a">' } }),
    });
    browser = await pw[eng].launch();
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    await ctx.addInitScript(() => localStorage.setItem('lab-name', 'leo'));
    const p = await ctx.newPage();
    // The reply's POST: the lab gets it at once (saves, tells the live stream); its answer reaches the page DELAY ms later.
    await p.route('**/_lab/api/comments', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const res = await route.fetch();
      await sleep(DELAY);
      await route.fulfill({ response: res });
    });
    const shadow = async (fn) => p.evaluate(([f]) => new Function('r', f)([...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot), [fn.toString().replace(/^[^{]*{|}$/g, '')]);
    const until = async (fn) => { for (let i = 0; i < 100; i++) { if (await shadow(fn).catch(() => false)) return; await sleep(100); } };
    const open = async () => { await until(() => { return !!r && r.querySelectorAll('button.pin').length > 0; }); await shadow(() => { r.querySelector('button.pin').click(); }); await until(() => { return !!r.querySelector('.card textarea'); }); };
    const bubbles = () => shadow(() => { return [...r.querySelectorAll('.card .msg')].filter((m) => m.textContent.includes('hello twice')).length; });
    await p.goto(B + '/');
    await open();
    await shadow(() => { r.querySelector('.card textarea').focus(); });
    await p.keyboard.type('hello twice');
    await p.keyboard.press('Enter');
    await sleep(DELAY + 1500);
    const shown = await bubbles();
    const stored = (await fetch(B + '/_lab/api/comments?page=/index').then((r) => r.json())).comments.filter((c) => c.text === 'hello twice').length;
    const files = path.join(dir, '.lab/comments');
    const onDisk = fs.readdirSync(files).map((f) => fs.readFileSync(path.join(files, f), 'utf8')).join('').split('hello twice').length - 1;
    await p.unroute('**/_lab/api/comments');
    await p.reload();
    await open();
    const after = await bubbles();
    const dup = shown > 1;
    bug ||= dup;
    console.log(`${dup ? 'BUG ' : 'PASS'} ${eng} delay=${DELAY}ms: bubbles on screen ${shown}, lab holds ${stored}, .lab files hold ${onDisk}, bubbles after reload ${after}`);
  } finally {
    await browser?.close();
    server.kill();
    await sleep(300);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
console.log(bug ? 'BUG' : 'PASS');
process.exit(0);
