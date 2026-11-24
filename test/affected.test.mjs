// ci/affected.mjs: which browser tests a PR's changed files need.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { affected, groupTests, listEdit, readTimes, shards } from '../ci/affected.mjs';

const tests = new Set(['fluid', 'board', 'boardpins', 'ink', 'selection', 'native']);
const reach = { 'src/widget/ink.ts': ['ink', 'selection'], 'src/board/mount.ts': ['board', 'boardpins', 'gone'] };
const run = (files, diffOf) => affected(files, { tests, reach, diffOf });

test('docs, skills, unit tests and other workflows run no browser test', () => {
  const r = run(['README.md', 'CHANGELOG.md', 'docs/settings.md', 'skills/labit/SKILL.md', 'test/local.test.mjs', 'test/phone/sim.mjs', '.github/workflows/gates.yml', 'ci/metrics.mjs', 'ci/flaky.json', 'ci/unit-run.mjs', 'ci/pr-check.mjs']);
  assert.equal(r.tests, '');
  assert.equal(r.native, false);
  assert.equal(r.bench, false);
});

test('a changed browser test runs itself; one CI never runs (a helper) runs everything', () => {
  assert.equal(run(['test/browser/ink.mjs', 'CHANGELOG.md']).tests, 'ink');
  assert.equal(run(['test/browser/port.mjs']).tests, 'all');
});

test('a mapped widget module runs its tests, the build beside it adds nothing, and the native check follows', () => {
  const r = run(['src/widget/ink.ts', 'public/_lab/comments.js']);
  assert.equal(r.tests, 'ink selection');
  assert.equal(r.native, true);
  assert.equal(run(['src/board/mount.ts']).tests, 'board boardpins'); // 'gone' is in no group
});

test('the core, the server, the build, package.json and unknown paths run everything', () => {
  for (const f of ['src/comments.js', 'src/widget/styles.css', 'local.mjs', 'lib/settings.ts', 'package.json', 'scripts/build-widget.mjs', 'ci/affected.mjs', 'src/widget/new.ts', 'new/thing.js']) {
    assert.equal(run([f]).tests, 'all', f);
  }
  // A built file changed without its source: a hand edit, so everything.
  assert.equal(run(['public/_lab/comments.js']).tests, 'all');
});

test('ci/native.mjs runs the native check only; bench/ the bench only', () => {
  assert.deepEqual([run(['ci/native.mjs']).tests, run(['ci/native.mjs']).native], ['', true]);
  assert.deepEqual([run(['bench/run.mjs']).tests, run(['bench/run.mjs']).bench], ['', true]);
});

test('ci/browser-tests.json: a test added runs that test, a new time runs nothing; test.yml runs everything', () => {
  const list = `@@ -1 +1 @@
-  "selection": 20,
+  "selection": 25,
+  "board": 38,`;
  assert.deepEqual(listEdit(list), ['board']);
  assert.equal(run(['ci/browser-tests.json', 'test/browser/board.mjs'], () => list).tests, 'board');
  assert.equal(run(['ci/browser-tests.json'], () => '-  "selection": 20,\n+  "selection": 25,').tests, '');
  assert.equal(listEdit('+  "_note": "x",'), null);
  assert.equal(run(['ci/browser-tests.json'], () => '+  "_note": "x",').tests, 'all');
  assert.equal(run(['.github/workflows/test.yml']).tests, 'all');
});

test('the CI tests and their times are read from ci/browser-tests.json, and each is a test file', async () => {
  const fs = await import('node:fs');
  const times = readTimes();
  const names = groupTests(times);
  assert.ok(names.size > 10);
  for (const n of names) {
    assert.ok(fs.existsSync(new URL(`./browser/${n}.mjs`, import.meta.url)), n);
    assert.ok(Number.isInteger(times[n]) && times[n] > 0, n);
  }
});

test('shards: every picked test runs once per engine, the longest shard near the even share, never more jobs than runners', () => {
  const times = { a: 100, b: 90, c: 60, d: 50, e: 40, f: 30, g: 20, h: 10 };
  const all = shards('all', { times, runners: 8 });
  assert.deepEqual(all.flatMap((j) => j.files.split(' ')).sort(), Object.keys(times));
  assert.ok(all.length <= 8 && all.length >= 2);
  assert.ok(Math.max(...all.map((j) => j.secs)) <= 120);
  const both = shards('all', { times, engines: ['webkit', 'chromium'], runners: 8 });
  assert.ok(both.length <= 8);
  assert.equal(both.filter((j) => j.engine === 'chromium').length, both.filter((j) => j.engine === 'webkit').length);
  // A small pick is one job; the bench rides on the first WebKit shard, or gets its own when there is none.
  assert.deepEqual(shards('c h', { times }).map((j) => j.files), ['c h']);
  assert.equal(shards('c', { times, bench: true })[0].bench, true);
  assert.deepEqual(shards('', { times, bench: true }).map((j) => [j.files, j.bench]), [['', true]]);
  assert.deepEqual(shards('c', { times, engines: ['chromium'], bench: true }).map((j) => j.engine), ['chromium', 'webkit']);
  // The real list: a full PR run fits in the runners, each shard under three minutes.
  const real = shards('all');
  assert.ok(real.length <= 8 && Math.max(...real.map((j) => j.secs)) < 180);
});

test('main runs the browsers only for a version bump', async () => {
  const { onMain } = await import('../ci/affected.mjs');
  assert.equal(onMain('-  "version": "0.7.0",\n+  "version": "0.7.1",').tests, 'all');
  assert.equal(onMain('+    "dev": "node scripts/dev.mjs",').tests, '');
  assert.equal(onMain('').tests, '');
});
