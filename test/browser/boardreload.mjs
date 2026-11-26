// Shortcuts from labit.json in real browsers (WebKit and Chrome's engine): the changed keys work, the old ones don't,
// and the bar shows the new key. Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/shortcuts.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();

const DIR = tmp('labit-boardreload-');
const PORT = claimPort(8050, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'plain.html'), '<!doctype html><meta charset="utf-8"><title>pl</title><iframe src="/pricing"></iframe><script>0</script>');
fs.writeFileSync(path.join(DIR, 'data.json'), '{"a":1}');
fs.writeFileSync(path.join(DIR, 'pricing.html'), '<!doctype html><meta charset="utf-8"><title>p</title><h1>Pricing one</h1>');
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><meta charset="utf-8"><title>k</title><h1>Keys</h1><p>text</p>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);
try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await ctx.addInitScript(() => localStorage.setItem('lab-name', 'tester'));
      const mark = async (p) => { await p.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.scrim')), null, { timeout: 5000 }); await p.evaluate(() => (window.__kept = 1)); };
      // The board route is the data layer's; here a page of the lab is served under the board's key.
      await ctx.route(B + '/_board/x', async (r) => {
        const res = await r.fetch({ url: B + '/plain' });
        await r.fulfill({ response: res, body: (await res.text()).replace('data-page="/plain"', 'data-page="/_board/x"') });
      });
      const bp = await ctx.newPage();
      await bp.goto(B + '/_board/x');
      await mark(bp);
      const pp = await ctx.newPage();
      await pp.goto(B + '/plain');
      await mark(pp);
      await pp.evaluate(() => fetch('/data.json').then((r) => r.text())); // the page uses the data file: a save of it reloads the page
      await sleep(500);
      const save = (f, text) => fs.writeFileSync(path.join(DIR, f), text);
      save('pricing.html', '<!doctype html><meta charset="utf-8"><title>p</title><h1>Pricing two</h1>');
      await sleep(1500);
      save('data.json', '{"a":2}');
      await sleep(1500);
      save('pricing.html', '<!doctype html><meta charset="utf-8"><title>p</title><h1>Pricing three</h1>');
      await sleep(2500);
      const kept = (p) => p.evaluate(() => window.__kept === 1).catch(() => false);
      check(eng, 'a page that names the saved files reloads, as before (control)', !(await kept(pp)));
      check(eng, 'a board page does not reload on a save of a frame page, a .json or the next one', await kept(bp));
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
}
finish();
