// Which lines of labit each browser test runs: the map ci/affected.mjs picks a PR's browser tests from, so a change to
// src/comments.js or the server runs the tests that reach the changed lines, not all of them.
//
//   node ci/reach.mjs [--out ci/reach-map.json] [--jobs 6] [--only browser|unit] [--shard i/n] [name…]   (browser: needs playwright)
//   node ci/reach.mjs --merge part1.json part2.json … --out ci/reach-map.json
//   node ci/reach.mjs --carry old-map.json --out ci/reach-map.json     the old map moved to this commit, no test run
// The unit tests (test/*.test.mjs) are mapped too, by file: the lines of the repo's code each one runs, its labs' too.
//
// The page scripts are built unminified with source maps (build-widget.mjs --map), every test in
// ci/browser-tests.json runs in Chromium with ci/reach-hook.mjs loaded (page coverage) and NODE_V8_COVERAGE set (the
// lab's own lines), and the lines that ran are kept per test and file, in the files' own line numbers:
//   { commit, tests: { name: { "src/widget/thread.ts": "12-40,52", "local.mjs": "…", "#classes": "card pin …" } } }
// "#classes" are the classes the widget's elements wore during the test: a change to a CSS rule runs the tests that
// showed one of its classes.
// Chromium only: a line only WebKit runs is in no test's list, and ci/affected.mjs runs every test for a change there.
// The plain build is put back at the end. reach.yml makes the map on a GitHub runner after each code merge to main.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args.splice(args.indexOf(`--${n}`), 2)[1] : d);
const OUT = path.resolve(opt('out', path.join(ROOT, 'ci/reach-map.json')));
const JOBS = Number(opt('jobs', 6));
const ONLY = opt('only', 'both'); // browser | unit | both
// --shard i/n: this job's part of the tests (CI runs the map as n jobs side by side, then --merge joins the parts).
const [SHARD, SHARDS] = opt('shard', '1/1').split('/').map(Number);
const MERGE = args.includes('--merge') ? args.splice(args.indexOf('--merge'), 1) && args.splice(0) : null;
const CARRY = opt('carry', null); // an older map, carried to this commit (no tests run)
const TIMES = JSON.parse(fs.readFileSync(path.join(ROOT, 'ci/browser-tests.json'), 'utf8'));
// Longest first onto the shortest part, so the parts end together; the same split on every job.
const part = (list, cost) => {
  const bins = Array.from({ length: SHARDS }, () => ({ items: [], secs: 0 }));
  for (const n of [...list].sort((a, b) => cost(b) - cost(a) || a.localeCompare(b))) {
    const bin = bins.reduce((lo, b) => (b.secs < lo.secs ? b : lo));
    bin.items.push(n);
    bin.secs += cost(n);
  }
  return bins[SHARD - 1].items;
};
// Tests that can't be mapped (anchoring-torture opens 4,800 pages, more than coverage can follow in 4 min), with the
// files they are about: not run here; the map says so, and a PR runs them when it changes one of those files.
export const UNMAPPED = { 'anchoring-torture': ['src/widget/anchoring.ts'] };
const names = part((args.length ? args : Object.keys(TIMES)).filter((n) => !UNMAPPED[n]), (n) => TIMES[n] ?? 60);
const build = (...more) => execFileSync('npx', ['--yes', '-p', 'esbuild@0.25.12', '-p', 'terser@5.44.0', 'node', 'scripts/build-widget.mjs', '--outfile=public/_lab/comments.js', ...more], { cwd: ROOT, stdio: 'inherit' });

// ---------- lines as ranges ----------
export const toRanges = (lines) => {
  const s = [...new Set(lines)].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(i === j ? `${s[i]}` : `${s[i]}-${s[j]}`);
    i = j;
  }
  return out.join(',');
};
export const fromRanges = (text) => {
  const set = new Set();
  for (const part of (text || '').split(',').filter(Boolean)) {
    const [a, b = a] = part.split('-').map(Number);
    for (let l = a; l <= b; l++) set.add(l);
  }
  return set;
};

// ---------- source maps: generated line -> [source, line] for each segment ----------
const B64 = Object.fromEntries([...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].map((c, i) => [c, i]));
function vlq(str) {
  const out = [];
  let shift = 0;
  let value = 0;
  for (const c of str) {
    const d = B64[c];
    value += (d & 31) << shift;
    if (d & 32) shift += 5;
    else {
      out.push(value & 1 ? -(value >> 1) : value >> 1);
      value = 0;
      shift = 0;
    }
  }
  return out;
}
function mapOf(file) {
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(/\/\/# sourceMappingURL=data:application\/json;base64,(\S+)\s*$/);
  if (!m) return null;
  const map = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
  const sources = map.sources.map((s) => path.relative(ROOT, path.resolve(path.dirname(file), s)));
  const lines = []; // generated line (1-based) -> [[sourceIndex, line (1-based)], …]
  let src = 0;
  let line = 0;
  for (const [i, group] of map.mappings.split(';').entries()) {
    const segs = [];
    for (const seg of group.split(',').filter(Boolean)) {
      const v = vlq(seg);
      if (v.length < 4) continue;
      src += v[1];
      line += v[2];
      segs.push([src, line + 1]);
    }
    lines[i + 1] = segs;
  }
  return { sources, lines };
}

// ---------- V8 coverage of a file's own text -> lines that ran ----------
// Block coverage: ranges nest, the innermost one says whether its code ran. Painted per character, outermost first; a
// line ran when any of its characters (not spaces) did, so a branch not taken on a line that ran doesn't erase it.
// The same in ci/reach-hook.mjs.
export function linesRan(source, functions) {
  const paint = new Uint8Array(source.length);
  const ranges = functions.flatMap((f) => f.ranges).sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
  for (const r of ranges) paint.fill(r.count > 0 ? 1 : 0, r.startOffset, r.endOffset);
  const out = [];
  let line = 1;
  let ran = false;
  for (let i = 0; i <= source.length; i++) {
    const c = i < source.length ? source.charCodeAt(i) : 10;
    if (c === 10) {
      if (ran) out.push(line);
      line++;
      ran = false;
    } else if (c > 32 && paint[i]) ran = true;
  }
  return out;
}

// The repo's own code a test can run (not tests, not this map's own hook).
const CODE = /^(local\.mjs|(lib|src|hooks|ci|bench|scripts)\/.+\.(m?js|ts))$/;
const NOT_CODE = /^ci\/reach(-hook)?\.mjs$/;

// One unit test file (test/<name>.test.mjs) as npm test runs it, its own lines and its labs' recorded.
function runUnit(name, dir) {
  return new Promise((resolve) => {
    const env = { ...process.env, NODE_V8_COVERAGE: path.join(dir, 'node'), NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import ${path.join(ROOT, 'ci/reach-hook.mjs')}`.trim() };
    const started = Date.now();
    const child = spawn(process.execPath, ['--import', './test/setup.mjs', '--test', `test/${name}.test.mjs`], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    // A test that hangs under coverage (anchoring-torture's 4,800 pages did) is stopped after 4 min: it counts as failed,
    // so it always runs on PRs, and the part goes on.
    const stop = setTimeout(() => child.kill('SIGKILL'), 240_000);
    child.on('close', (code) => {
      clearTimeout(stop);
      console.log(`unit ${name}: ${code === 0 ? 'ran' : `exit ${code}`} in ${Math.round((Date.now() - started) / 1000)} s`);
      resolve(code === 0);
    });
  });
}

function runOne(name, dir) {
  return new Promise((resolve) => {
    const env = { ...process.env, ENGINES: 'chromium', TORTURE_SEEDS: '1', LABIT_REACH_OUT: path.join(dir, 'pages'), NODE_V8_COVERAGE: path.join(dir, 'node'), NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import ${path.join(ROOT, 'ci/reach-hook.mjs')}`.trim() };
    const started = Date.now();
    const child = spawn(process.execPath, [`test/browser/${name}.mjs`], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    // A test that hangs under coverage (anchoring-torture's 4,800 pages did) is stopped after 4 min: it counts as failed,
    // so it always runs on PRs, and the part goes on.
    const stop = setTimeout(() => child.kill('SIGKILL'), 240_000);
    child.on('close', (code) => {
      clearTimeout(stop);
      console.log(`${name}: ${code === 0 ? 'ran' : `exit ${code}`} in ${Math.round((Date.now() - started) / 1000)} s`);
      if (code !== 0) console.log(out.split('\n').filter((l) => /^FAIL|Error/.test(l)).slice(0, 5).join('\n'));
      resolve(code === 0);
    });
  });
}

function reduce(dir, maps) {
  const files = new Map(); // file -> Set of lines
  const classes = new Set();
  const add = (file, line) => {
    if (!files.has(file)) files.set(file, new Set());
    files.get(file).add(line);
  };
  for (const f of fs.existsSync(path.join(dir, 'pages')) ? fs.readdirSync(path.join(dir, 'pages')) : []) {
    for (const [url, gen] of Object.entries(JSON.parse(fs.readFileSync(path.join(dir, 'pages', f), 'utf8')))) {
      if (url === '#classes') {
        gen.forEach((c) => classes.add(c));
        continue;
      }
      const built = path.join(ROOT, 'public', url);
      if (!maps.has(built)) maps.set(built, fs.existsSync(built) ? mapOf(built) : null);
      const m = maps.get(built);
      if (!m) continue;
      for (const g of gen) for (const [s, l] of m.lines[g] || []) if (/^src\//.test(m.sources[s])) add(m.sources[s], l);
    }
  }
  for (const f of fs.existsSync(path.join(dir, 'node')) ? fs.readdirSync(path.join(dir, 'node')) : []) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(dir, 'node', f), 'utf8'));
    } catch {
      continue;
    }
    for (const r of data.result) {
      if (!r.url.startsWith('file://')) continue;
      const file = path.relative(ROOT, new URL(r.url).pathname);
      if (!CODE.test(file) || NOT_CODE.test(file)) continue;
      for (const l of linesRan(fs.readFileSync(path.join(ROOT, file), 'utf8'), r.functions)) add(file, l);
    }
  }
  const out = Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(([f, s]) => [f, toRanges(s)]));
  out['#classes'] = [...classes].sort().join(' ');
  return out;
}

const MAIN = import.meta.url === pathToFileURL(process.argv[1] || '').href;

// ---------- carrying a map to a newer commit, without running a test ----------
// Each changed file's lines move through the diff (git diff -U0 old new): a line outside a change shifts; a line a
// change rewrote becomes the new lines that replaced it; lines only added count as run when both lines around them
// were. Lines only removed go. A file that is gone goes. Close enough between full maps, which reset it each night;
// a test the old map doesn't know (new) is not in it, so it always runs until then.
export function carryLines(text, diff) {
  const old = fromRanges(text);
  const hs = [...diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map((m) => ({ a: +m[1], b: m[2] === undefined ? 1 : +m[2], c: +m[3], d: m[4] === undefined ? 1 : +m[4] }));
  if (!hs.length) return text;
  const out = new Set();
  const range = (from, n) => Array.from({ length: n }, (_, i) => from + i);
  for (const l of old) {
    let shift = 0;
    let gone = false;
    for (const h of hs) {
      const nextOld = h.b ? h.a + h.b : h.a + 1;
      const nextNew = h.d ? h.c + h.d : h.c + 1;
      if (h.b && l >= h.a && l < nextOld) {
        range(h.c, h.d).forEach((n) => out.add(n)); // rewritten: its new lines (none if only removed)
        gone = true;
        break;
      }
      if (l >= nextOld) shift = nextNew - nextOld;
      else break;
    }
    if (!gone) out.add(l + shift);
  }
  for (const h of hs) if (!h.b && old.has(h.a) && old.has(h.a + 1)) range(h.c, h.d).forEach((n) => out.add(n));
  return toRanges([...out]);
}

if (MAIN && CARRY) {
  const map = JSON.parse(fs.readFileSync(CARRY, 'utf8'));
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const git = (...x) => execFileSync('git', x, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  const files = git('diff', '--name-only', '--no-renames', map.commit, head).split('\n').filter(Boolean);
  const changed = files.filter((f) => CODE.test(f));
  // A test changed since the map may run other lines now: it always runs until the night's map (as a failed one).
  const browserRead = (n) => {
    try {
      return fs.readFileSync(path.join(ROOT, 'test/browser', `${n}.mjs`), 'utf8');
    } catch {
      return '';
    }
  };
  const edited = files.map((f) => f.match(/^test\/browser\/([\w-]+)\.mjs$/)?.[1]).filter(Boolean);
  // And the tests that run a changed one as part of themselves (behaviours-choices.mjs imports behaviours.mjs).
  const stale = Object.keys(map.tests || {}).filter((n) => edited.includes(n) || edited.some((t) => browserRead(n).includes(`'./${t}.mjs'`)));
  const staleUnit = Object.keys(map.unit || {}).filter((n) => files.includes(`test/${n}.test.mjs`));
  map.failed = [...new Set([...(map.failed || []), ...stale])];
  map.unitFailed = [...new Set([...(map.unitFailed || []), ...staleUnit])];
  for (const f of changed) {
    const gone = !fs.existsSync(path.join(ROOT, f));
    const diff = gone ? '' : git('diff', '-U0', '--no-renames', map.commit, head, '--', f);
    for (const part of [map.tests, map.unit]) for (const lines of Object.values(part || {})) {
      if (!lines[f]) continue;
      if (gone) delete lines[f];
      else lines[f] = carryLines(lines[f], diff);
    }
  }
  const from = map.commit;
  Object.assign(map, { commit: head, carriedFrom: map.carriedFrom || from, made: new Date().toISOString() });
  fs.writeFileSync(OUT, JSON.stringify(map) + '\n');
  console.log(`${OUT}: carried from ${from.slice(0, 8)} to ${head.slice(0, 8)} through ${changed.length} changed code file${changed.length === 1 ? '' : 's'}${stale.length || staleUnit.length ? `; changed tests (run them always): ${[...stale, ...staleUnit].join(' ')}` : ''}`);
  process.exit(0);
}

// --merge part.json…: the parts as one map (same commit), written to --out.
if (MAIN && MERGE) {
  const parts = MERGE.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
  const commits = new Set(parts.map((p) => p.commit));
  if (commits.size !== 1) (console.error(`parts from different commits: ${[...commits].join(' ')}`), process.exit(1));
  const join = (key) => Object.fromEntries(parts.flatMap((p) => Object.entries(p[key] || {})).sort(([a], [b]) => a.localeCompare(b)));
  const map = { commit: parts[0].commit, made: new Date().toISOString(), failed: parts.flatMap((p) => p.failed || []), unmapped: parts[0].unmapped || {}, tests: join('tests'), unitFailed: parts.flatMap((p) => p.unitFailed || []), unit: join('unit') };
  fs.writeFileSync(OUT, JSON.stringify(map) + '\n');
  console.log(`${OUT}: ${Object.keys(map.tests).length} browser and ${Object.keys(map.unit).length} unit tests from ${parts.length} parts at ${map.commit.slice(0, 8)}${map.failed.length || map.unitFailed.length ? `; failed (run them always): ${[...map.failed, ...map.unitFailed].join(' ')}` : ''}`);
  process.exit(0);
}

if (MAIN) {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  // Every folder the map keeps lines of (CODE), so the lines match the commit.
  if (execFileSync('git', ['status', '--porcelain', '--', 'src', 'lib', 'local.mjs', 'hooks', 'ci', 'bench', 'scripts'], { cwd: ROOT, encoding: 'utf8' }).trim()) {
    console.error('src/, lib/, local.mjs, hooks/, ci/, bench/ or scripts/ has changes not committed: the map must match a commit.');
    process.exit(1);
  }
  const only = ONLY;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'labit-reach-'));
  const tests = {};
  const failed = [];
  const unit = {};
  const unitFailed = [];
  const maps = new Map();
  const pool = (list, fn) => Promise.all(Array.from({ length: JOBS }, async () => {
    while (list.length) await fn(list.shift());
  }));
  try {
    if (only !== 'unit') {
      build('--map');
      await pool([...names], async (name) => {
        const dir = path.join(work, name);
        // A failing test still says what it ran up to its failure; its list may be short, so it is marked.
        if (!(await runOne(name, dir))) failed.push(name);
        tests[name] = reduce(dir, maps);
      });
    }
    if (only !== 'browser') {
      // Unit files by their size, a rough stand-in for their time.
      const units = part(fs.readdirSync(path.join(ROOT, 'test')).filter((f) => f.endsWith('.test.mjs')).map((f) => f.slice(0, -'.test.mjs'.length)), (n) => fs.statSync(path.join(ROOT, 'test', `${n}.test.mjs`)).size);
      await pool(units, async (name) => {
        const dir = path.join(work, `unit-${name}`);
        if (!(await runUnit(name, dir))) unitFailed.push(name);
        const lines = reduce(dir, maps);
        delete lines['#classes'];
        unit[name] = lines;
      });
    }
  } finally {
    if (only !== 'unit') build(); // the plain page scripts back
    fs.rmSync(work, { recursive: true, force: true });
  }
  const ordered = Object.fromEntries(names.filter((n) => tests[n]).map((n) => [n, tests[n]]));
  const units = Object.fromEntries(Object.keys(unit).sort().map((n) => [n, unit[n]]));
  fs.writeFileSync(OUT, JSON.stringify({ commit, made: new Date().toISOString(), failed, unmapped: UNMAPPED, tests: ordered, unitFailed, unit: units }) + '\n');
  console.log(`${OUT}: ${Object.keys(ordered).length} browser and ${Object.keys(units).length} unit tests at ${commit.slice(0, 8)}${failed.length || unitFailed.length ? `; failed (run them always): ${[...failed, ...unitFailed].join(' ')}` : ''}`);
}
