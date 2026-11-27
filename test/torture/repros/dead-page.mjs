// Repro: a page open in a browser dies for good when its file is missing at the moment the page re-fetches itself.
//   1. open /page.html in a real browser (the lab's widget is in it)
//   2. delete page.html (a build that clears its output), wait 1 s
//   3. write page.html again
// Expected: the open page shows the new file (or at least stays put and follows the file when it is back).
// Observed: the lab tells the page "page.html changed"; the widget re-fetched the page while it was gone (404), reloaded onto the lab's "Not found" screen, which
// carries no widget, so the file coming back changes nothing: the tab stays on "Not found" until a manual refresh.
// Run: node test/torture/repros/dead-page.mjs   (needs the `playwright` package; falls back to HTTP-only facts)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { claimPort, spawnLab, up, tmp, rm, stop, sleep } from '../../harness.mjs';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);
let pw = null;
for (const paths of [undefined, [path.join(REPO, '..', '.labit-pw-scratch', 'node_modules')]]) {
  try { pw = require(require.resolve('playwright', paths && { paths })); break; } catch {}
}

const DIR = tmp('dead-page');
const PORT = claimPort(24700, 100);
const B = `http://localhost:${PORT}`;
const html = (v) => `<!doctype html><title>${v}</title><main id=m>${v}</main>`;
const lab = spawnLab(DIR, PORT, { stdio: 'ignore' });
let browser;
try {
  fs.writeFileSync(path.join(DIR, 'page.html'), html('v1'));
  await up(`${B}/`);
  if (!pw) {
    // No browser: show only the server-side fact the widget runs into.
    fs.rmSync(path.join(DIR, 'page.html'));
    await sleep(300);
    const r = await fetch(`${B}/page.html`, { headers: { accept: 'text/html' } });
    const t = await r.text();
    console.log(`BUG? (HTTP only, no playwright) a deleted page answers ${r.status} with ${/data-live|_lab\/live/.test(t) ? 'a' : 'NO'} widget: a widget that re-fetches now reloads onto it and never hears the file come back`);
  } else {
    browser = await pw.chromium.launch();
    const page = await browser.newPage();
    await page.goto(`${B}/page.html`);
    await page.waitForSelector('script[data-live]', { state: 'attached', timeout: 5000 });
    await sleep(1500); // the widget has heard the live stream's first message
    fs.rmSync(path.join(DIR, 'page.html')); // the file is gone: the lab tells the page "page.html changed"
    await sleep(Number(process.env.GAP ?? 1000)); // how long the file stays gone
    fs.writeFileSync(path.join(DIR, 'page.html'), html('v2'));
    await sleep(4000); // far longer than a save needs to reach a page (~100 ms)
    const shown = await page.evaluate(() => ({ title: document.title, main: document.querySelector('#m')?.textContent ?? null, widget: !!document.querySelector('script[data-live]') }));
    if (shown.main === 'v2') console.log('PASS: the open page shows v2');
    else console.log(`BUG: page.html is back on disk (v2) 4 s ago; the open tab shows title "${shown.title}", #m=${JSON.stringify(shown.main)}, widget=${shown.widget} (expected #m="v2")`);
  }
} catch (e) {
  console.log(`ERROR: ${e.message}`);
} finally {
  await browser?.close();
  await stop(lab);
  rm([DIR], { maxRetries: 5 });
}
process.exit(0);
