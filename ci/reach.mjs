// Which lines of labit each browser test runs: the map ci/affected.mjs picks a PR's browser tests from, so a change to
// src/comments.js or the server runs the tests that reach the changed lines, not all of them.
//
//   node ci/reach.mjs [--out ci/reach-map.json] [--jobs 6] [name…]     (needs playwright, as the browser tests do)
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
import { execFileSync, spawn } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args.splice(args.indexOf(`--${n}`), 2)[1] : d);
const OUT = path.resolve(opt('out', path.join(ROOT, 'ci/reach-map.json')));
const JOBS = Number(opt('jobs', 6));
const names = args.length ? args : Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'ci/browser-tests.json'), 'utf8')));
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
function linesRan(source, functions) {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) starts.push(i + 1);
  const lineOf = (off) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const paint = new Int8Array(starts.length).fill(-1);
  const ranges = functions.flatMap((f) => f.ranges).sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
  for (const r of ranges) for (let l = lineOf(r.startOffset), b = lineOf(Math.max(r.startOffset, r.endOffset - 1)); l <= b; l++) paint[l] = r.count > 0 ? 1 : 0;
  const out = [];
  paint.forEach((v, l) => v === 1 && out.push(l + 1));
  return out;
}

function runOne(name, dir) {
  return new Promise((resolve) => {
    const env = { ...process.env, ENGINES: 'chromium', TORTURE_SEEDS: '1', LABIT_REACH_OUT: path.join(dir, 'pages'), NODE_V8_COVERAGE: path.join(dir, 'node'), NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import ${path.join(ROOT, 'ci/reach-hook.mjs')}`.trim() };
    const started = Date.now();
    const child = spawn(process.execPath, [`test/browser/${name}.mjs`], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => {
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
      if (!/^(local\.mjs|lib\/)/.test(file)) continue;
      for (const l of linesRan(fs.readFileSync(path.join(ROOT, file), 'utf8'), r.functions)) add(file, l);
    }
  }
  const out = Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(([f, s]) => [f, toRanges(s)]));
  out['#classes'] = [...classes].sort().join(' ');
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  if (execFileSync('git', ['status', '--porcelain', '--', 'src', 'lib', 'local.mjs'], { cwd: ROOT, encoding: 'utf8' }).trim()) {
    console.error('src/, lib/ or local.mjs has changes not committed: the map must match a commit.');
    process.exit(1);
  }
  build('--map');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'labit-reach-'));
  const tests = {};
  const failed = [];
  const maps = new Map();
  try {
    const queue = [...names];
    await Promise.all(Array.from({ length: JOBS }, async () => {
      while (queue.length) {
        const name = queue.shift();
        const dir = path.join(work, name);
        // A failing test still says what it ran up to its failure; its list may be short, so it is marked.
        if (!(await runOne(name, dir))) failed.push(name);
        tests[name] = reduce(dir, maps);
      }
    }));
  } finally {
    build(); // the plain page scripts back
    fs.rmSync(work, { recursive: true, force: true });
  }
  const ordered = Object.fromEntries(names.filter((n) => tests[n]).map((n) => [n, tests[n]]));
  fs.writeFileSync(OUT, JSON.stringify({ commit, made: new Date().toISOString(), failed, tests: ordered }) + '\n');
  console.log(`${OUT}: ${Object.keys(ordered).length} tests at ${commit.slice(0, 8)}${failed.length ? `; failed (run them always): ${failed.join(' ')}` : ''}`);
}
