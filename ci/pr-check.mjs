// The PR's CI on this computer, before a push (`npm run check`): the quick checks, the unit tests, and the browser tests
// CI would pick for the changes since main, in WebKit like a PR. An agent that runs this finds a failure in a few
// minutes here instead of after a push, a CI run and a log to read.
//
//   npm run check                  changes against origin/main (fetched first), committed or not
//   npm run check -- --base main   another base
//   npm run check -- --no-browser  skip the browser tests (no playwright here)
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { affected, changedFiles, reachFor, readTimes } from './affected.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'origin/main';
const step = (title, cmd, cmdArgs, env = {}) => {
  console.log(`\n== ${title}`);
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) {
    console.log(`\n${title}: failed. Fix it before you push.`);
    process.exit(1);
  }
};

if (base.startsWith('origin/')) {
  try {
    execFileSync('git', ['fetch', '--quiet', 'origin', base.slice('origin/'.length)], { cwd: ROOT, stdio: 'ignore' });
  } catch {} // offline: the last fetched one
}
const from = execFileSync('git', ['merge-base', base, 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
// With ci/reach-map.json (node ci/reach.mjs, or one downloaded from reach.yml), by the lines changed, as CI picks.
const picked = affected(changedFiles(from), { diffOf: (f) => execFileSync('git', ['diff', '-U0', from, '--', f], { cwd: ROOT, encoding: 'utf8' }), ...reachFor(from) });

step('build', 'npm', ['run', '--silent', 'build']);
step('checks', process.execPath, ['ci/reuse.mjs']);
step('classes', process.execPath, ['ci/classes.mjs']);
// Four files at a time, like CI's three: all cores at once makes some timing tests miss (idle, proxy) on a laptop.
step('unit tests', process.execPath, ['ci/unit-run.mjs', '--test-concurrency=4']);
const names = picked.tests === 'all' ? Object.keys(readTimes()) : picked.tests.split(' ').filter(Boolean);
if (args.includes('--no-browser') || !names.length) {
  console.log(`\n== browser tests: ${names.length ? 'skipped (--no-browser)' : 'none for these changes'}`);
} else {
  const mins = Math.round(names.reduce((s, n) => s + (readTimes()[n] ?? 60), 0) / 60);
  step(`browser tests, WebKit (${names.length}, about ${mins} min)`, process.execPath, ['ci/browser-run.mjs', ...names], { ENGINES: 'webkit' });
}
console.log('\nAll green: CI should be too.');
