// A port for one test's lab, from the test's own range, that no other test on this machine holds right now.
// The browser jobs share one Mac (eight at once), so two files with overlapping ranges, or the same file in WebKit and
// Chromium, could pick the same port and talk to each other's lab. Each claim is a lock file, made exclusively and
// removed when the process exits; a lock older than 30 minutes is a crashed run's and is taken over.
// The unit tests claim theirs here too (test/harness.mjs): they run side by side, and beside the browser jobs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = path.join(os.tmpdir(), 'labit-test-ports');
fs.mkdirSync(dir, { recursive: true });
const mine = [];
process.on('exit', () => {
  for (const f of mine) try { fs.unlinkSync(f); } catch {}
});

// Whether another program answers on the port (an app on this computer may listen inside a test's range: a lab then
// starts on another port and the test talks to that app). Asked in a process of its own: claimPort is not async.
const PROBE = `const net = require('node:net'); let left = 2;
for (const host of ['127.0.0.1', '::1']) net.connect(Number(process.argv[1]), host).on('connect', () => process.exit(1)).on('error', () => --left || process.exit(0));
setTimeout(() => process.exit(0), 500);`;
const held = (port) => spawnSync(process.execPath, ['-e', PROBE, String(port)]).status === 1;

/** A free port in [base, base + span), as a number. */
export function claimPort(base, span) {
  const start = Math.floor(Math.random() * span);
  for (let i = 0; i < span; i++) {
    const port = base + ((start + i) % span);
    const f = path.join(dir, String(port));
    try {
      if (Date.now() - fs.statSync(f).mtimeMs > 30 * 60_000) fs.unlinkSync(f);
    } catch {}
    try {
      fs.closeSync(fs.openSync(f, 'wx'));
      mine.push(f);
      if (!held(port)) return port;
    } catch {}
  }
  throw new Error(`no free test port in ${base}-${base + span - 1}`);
}
