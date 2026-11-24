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
  // A small pick (under a minute) is one job; the bench rides on the first WebKit shard, or gets its own when there is none.
  assert.deepEqual(shards('g h', { times }).map((j) => j.files), ['g h']);
  assert.equal(shards('c', { times, bench: true })[0].bench, true);
  assert.deepEqual(shards('', { times, bench: true }).map((j) => [j.files, j.bench]), [['', true]]);
  assert.deepEqual(shards('c', { times, engines: ['chromium'], bench: true }).map((j) => j.engine), ['chromium', 'webkit']);
  // The real list: a full PR run is WebKit on at most 5 macOS jobs.
  const real = shards('all');
  assert.ok(real.length <= 5 && real.every((j) => j.os === 'macos-latest'));
});

test('main runs the browsers only for a version bump', async () => {
  const { onMain } = await import('../ci/affected.mjs');
  assert.equal(onMain('-  "version": "0.7.0",\n+  "version": "0.7.1",').tests, 'all');
  assert.equal(onMain('+    "dev": "node scripts/dev.mjs",').tests, '');
  assert.equal(onMain('').tests, '');
});

test('reach map: a changed line runs the tests that ran it; one no test ran runs all (widget) or none (server)', async () => {
  const { backTo, touched, classesAt } = await import('../ci/affected.mjs');
  const map = { commit: 'abc12345', failed: ['ink'], tests: { fluid: { 'src/widget/x.ts': '1-10', 'local.mjs': '5-9', '#classes': 'card pin' }, board: { 'src/widget/x.ts': '20-30', 'local.mjs': '5', '#classes': 'frame' }, ink: {}, boardpins: {}, native: {}, selection: { '#classes': 'pin' } } };
  const on = (files, lines, classes = []) => affected(files, { tests, reach, map, linesOf: () => lines, classesOf: () => classes });
  assert.equal(on(['src/widget/x.ts'], [3]).tests, 'fluid ink'); // ink failed while the map was made: it always runs
  assert.equal(on(['src/widget/x.ts'], [3, 25]).tests, 'board fluid ink');
  assert.equal(on(['src/widget/x.ts'], [15]).tests, 'all'); // no test ran it: maybe only WebKit does
  assert.equal(on(['src/widget/x.ts'], null).tests, 'all'); // can't be placed
  assert.equal(on(['local.mjs'], [5]).tests, 'board fluid ink');
  assert.equal(on(['local.mjs'], [100]).tests, ''); // a server line no browser test runs: the unit tests' part
  assert.equal(on(['src/widget/styles.css'], null, ['frame']).tests, 'board ink');
  assert.equal(on(['src/widget/styles.css'], null, []).tests, 'all'); // :host, a keyframe: no class to go by
  assert.equal(affected(['src/widget/x.ts'], { tests, reach }).tests, 'all'); // no map
  // Lines through a diff: kept, shifted past an insertion, a rewritten line becomes the lines it replaced.
  const diff = '@@ -5,0 +6,2 @@\n@@ -10,2 +12,1 @@';
  assert.deepEqual([3, 6, 8, 12, 13].map((l) => backTo([l], diff)), [[3], [5, 6], [6], [10, 11], [12]]);
  assert.deepEqual(touched('@@ -4,2 +4,3 @@\n@@ -9,0 +11,1 @@'), [4, 5, 9, 10]);
  assert.deepEqual(classesAt('.a{color:red}\n:host{--x:1}\n@media (x){\n  .b .c,\n  .d {\n    margin:0;\n  }\n}', [1, 2, 6]), ['a', 'b', 'c', 'd']);
});
