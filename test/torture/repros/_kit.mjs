// Shared by the hot-*.mjs repros: a lab on a temp folder, a real Chromium on it, and the verdict line.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnLab, claimPort, up, tmp, rm, stop, sleep } from '../../harness.mjs';

export { sleep, fs, path };
const here = path.dirname(fileURLToPath(import.meta.url));
export const loadPlaywright = async () => {
  for (const base of [here, path.join(here, '../../../../.labit-pw-scratch/')]) {
    try {
      return createRequire(path.join(base, 'x.js'))('playwright');
    } catch {}
  }
  throw new Error('playwright not found (looked from this checkout and ../.labit-pw-scratch)');
};
export const page = (extra = '') => `<!doctype html><html><head><meta charset="utf-8"><title>t</title><link rel="stylesheet" href="s.css"></head><body><main id="m">hello</main>${extra}</body></html>`;
/** run(async ({ dir, B, port, lab, start, restart, browser }) => ...) : files are written first by `files`. */
export async function repro(name, files, body) {
  const dir = tmp(`hot-${name}`);
  for (const [f, t] of Object.entries(files)) (fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }), fs.writeFileSync(path.join(dir, f), t));
  const port = claimPort(23900, 100);
  const B = `http://localhost:${port}`;
  let lab = null;
  const start = async () => {
    lab = spawnLab(dir, port, { flags: ['--new'], env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
    await up(B + '/');
    return lab;
  };
  let browser = null;
  try {
    await start();
    const pw = await loadPlaywright();
    browser = await pw.chromium.launch();
    const stopLab = () => stop(lab);
    await body({ dir, B, port, start, stopLab, browser, w: (f, t) => fs.writeFileSync(path.join(dir, f), t) });
  } catch (e) {
    console.log(`ERROR (repro itself failed, not a verdict): ${e.stack || e}`);
  } finally {
    await browser?.close().catch(() => {});
    if (lab) await stop(lab);
    rm([dir], { maxRetries: 5 });
  }
}
export const verdict = (ok, what, observed, expected) =>
  console.log(ok ? `PASS ${what}` : `BUG ${what}\n  observed: ${observed}\n  expected: ${expected}`);
