// Which browser tests a pull request needs (Leo, 20 Nov: PR CI should run only the tests a change can break). The
// browser jobs run on GitHub's runners; this picks, from the files a PR changes, which test/browser files they run.
//
// Rules, first match per changed file:
// - Never affects a browser: docs, skills, hooks, examples, unit tests, the phone kit, the size gate's ci/ scripts,
//   workflows other than test.yml. Nothing runs for these.
// - A browser test that CI runs (listed in ci/browser-tests.json): that test.
// - A widget module with a known reach (REACH below): the tests listed for it.
// - public/_lab/*.js built from src/: nothing of its own when the PR also changes src/ (it is the build of those
//   files, and the size gate's staleBuild check already holds it to them); everything when it changes alone.
// - Everything else, including anything not listed here: every test. So src/comments.js, styles.css, the server
//   (local.mjs, lib/), package.json, the build script, test.yml, this file, test helpers, and new folders all run the
//   full set. Unknown means all: a missed test costs more than a run.
// A merge to main (--main) runs nothing unless it bumps the version, a release, which runs everything; a run started by
// hand runs everything (--all).
//
//   node ci/affected.mjs <base> <head>    prints {"tests":"all"|"a b c","native":bool,"bench":bool,"jobs":[…],"why":[…]}
//   node ci/affected.mjs --main <before> <after>
//   node ci/affected.mjs --all
// In CI the same JSON goes to $GITHUB_OUTPUT as tests=…, native=…, bench=…, jobs=… (the browser matrix, engines from
// $ENGINES, default webkit), and the reasons and shards to the job summary.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');

// Paths that no browser test reads.
const NO_BROWSER = [
  /\.md$/, /^LICENSE$/, /^docs\//, /^examples\//, /^skills\//, /^hooks\//, /^plugin\.json$/, /^\.claude-plugin\//,
  /^knip\.json$/, /^\.oxlintrc\.json$/, /^tsconfig\.json$/, /^\.gitignore$/,
  /^test\/[^/]+\.test\.mjs$/, /^test\/harness\.mjs$/, /^test\/setup\.mjs$/, /^test\/phone\//,
  /^ci\/(metrics|reuse|unit-run|pr-check|reach|reach-hook)\.mjs$/, /^ci\/(parts|flaky)\.json$/, /^ci\/[^/]+\.sh$/,
  /^\.github\/workflows\/(?!test\.yml$)/,
];

// What a widget module reaches, as the test files that exercise it. A module missing here runs everything.
// Built from what each test does (its selectors, flags and routes); when in doubt a test is listed.
const REACH = {
  // The parts moved out of src/comments.js (motion, drag, keys, board camera). framework.ts has no test of
  // its own (components.js loads only on React, Vue or Svelte pages), so it runs everything.
  'src/widget/motion.ts': ['motionreach', 'moment', 'update'],
  'src/widget/motion.css': ['motionreach', 'moment', 'update'],
  'src/widget/drag.ts': ['pincontext', 'selection', 'draw', 'edge-draw1', 'edge-draw2', 'edge-draw3', 'edge-draw4', 'shortcuts', 'shiftkeys'],
  'src/widget/keys.ts': ['shiftkeys', 'selection'],
  'src/widget/boardcam.ts': ['board', 'boardarrange', 'boardclose', 'boardcanvas', 'boardmode', 'boardpins', 'boardreload', 'boardview', 'frame', 'framescroll', 'nativeboard', 'boardsection', 'boardpin'],
  'src/widget/actions.ts': ['actions'],
  'src/widget/walkie.ts': ['walkie'],
  'src/widget/walkie.css': ['walkie'],
  'src/widget/chat.ts': ['behaviours', 'behaviours-choices', 'behaviours-questions', 'boardclose', 'connection', 'fluid', 'native', 'progress', 'shortcuts', 'update', 'updbadge', 'zoom'],
  'src/widget/draw.ts': ['draw', 'edge-draw1', 'edge-draw2', 'edge-draw3', 'edge-draw4', 'native', 'nativepins', 'shiftkeys'],
  'src/widget/fluid.ts': ['behaviours', 'behaviours-choices', 'behaviours-questions', 'fluid', 'nativepins', 'select', 'selection', 'shortcuts'],
  'src/widget/frame.ts': ['board', 'boardarrange', 'boardclose', 'boardcanvas', 'boardhome', 'boardmode', 'boardpins', 'boardreload', 'boardview', 'frame', 'framescroll', 'nativeboard'],
  'src/widget/ink.ts': ['draw', 'edge-draw1', 'edge-draw2', 'edge-draw3', 'edge-draw4', 'native', 'nativepins', 'shiftkeys'],
  'src/widget/messages.ts': ['behaviours', 'behaviours-choices', 'behaviours-questions', 'boardclose', 'boardcanvas', 'boardpins', 'connection', 'draw', 'edge-draw2', 'fluid', 'moment', 'native', 'progress', 'selection', 'shortcuts', 'undo', 'update', 'updbadge', 'zoom'],
  'src/widget/pinhold.ts': ['actions', 'behaviours', 'behaviours-choices', 'behaviours-questions', 'boardclose', 'boardcanvas', 'boardpins', 'boardview', 'boxfits', 'connection', 'draw', 'edge-draw1', 'edge-draw2', 'edge-draw3', 'edge-draw4', 'fluid', 'moment', 'moved', 'native', 'nativeboard', 'nativepins', 'progress', 'select', 'selection', 'shortcuts', 'undo'],
  'src/widget/select.ts': ['select'],
  'src/widget/stick.ts': ['behaviours', 'behaviours-choices', 'behaviours-questions', 'boardclose', 'boardcanvas', 'boardpins', 'connection', 'draw', 'edge-draw2', 'fluid', 'moment', 'native', 'progress', 'selection', 'shortcuts', 'undo', 'update', 'updbadge', 'zoom'],
  'src/widget/switcher.ts': ['behaviours', 'behaviours-choices', 'behaviours-questions', 'boardcanvas', 'boardmode', 'moved', 'native', 'select', 'shortcuts', 'update', 'updbadge'],
  'src/widget/switcher.css': ['behaviours', 'behaviours-choices', 'behaviours-questions', 'boardcanvas', 'boardmode', 'moved', 'native', 'select', 'shortcuts', 'update', 'updbadge'],
  'src/widget/trial.ts': ['anchoring', 'behaviours', 'behaviours-choices', 'behaviours-questions', 'native', 'progress', 'selection', 'shortcuts'],
  'src/board/camera.ts': ['board', 'boardarrange', 'boardclose', 'boardcanvas', 'boardhome', 'boardmode', 'boardpins', 'boardreload', 'boardview', 'frame', 'framescroll', 'nativeboard'],
  'src/board/mount.ts': ['board', 'boardarrange', 'boardclose', 'boardcanvas', 'boardhome', 'boardimage', 'phonepins', 'boardmode', 'boardpins', 'boardzones', 'boardreload', 'boardview', 'frame', 'framescroll', 'nativeboard'],
  'src/board/overlay.ts': ['board', 'boardarrange', 'boardclose', 'boardcanvas', 'boardhome', 'boardimage', 'phonepins', 'boardmode', 'boardpins', 'boardzones', 'boardreload', 'boardview', 'frame', 'framescroll', 'nativeboard', 'boardsection', 'boardpin'],
  'public/_lab/boardview.js': ['board', 'boardarrange', 'boardclose', 'boardcanvas', 'boardhome', 'boardimage', 'phonepins', 'boardmode', 'boardpins', 'boardzones', 'boardreload', 'boardview', 'frame', 'framescroll', 'nativeboard', 'boardsection', 'boardpin'],
  'public/_lab/draw.js': ['draw', 'edge-draw1', 'edge-draw2', 'edge-draw3', 'edge-draw4', 'native', 'nativepins', 'shiftkeys'],
  'public/_lab/motion.js': ['motionreach', 'moment', 'update'],
  'src/widget/attach.ts': ['attach'],
  'src/widget/attach.css': ['attach'],
  'public/_lab/attach.js': ['attach'],
  'src/widget/reload.ts': ['livereload', 'hotrace', 'morphstate', 'reloadstate', 'remount', 'boardreload', 'pagecss'],
  'public/_lab/reload.js': ['livereload', 'hotrace', 'morphstate', 'reloadstate', 'remount', 'boardreload', 'pagecss'],
  'src/widget/pics.ts': ['attach', 'boardimage'],
  'public/_lab/pics.js': ['attach', 'boardimage'],
  'public/_lab/switcher.js': ['behaviours', 'behaviours-choices', 'behaviours-questions', 'boardcanvas', 'boardmode', 'moved', 'native', 'select', 'shortcuts', 'update', 'updbadge'],
  'lib/actions.ts': ['actions', 'behaviours', 'behaviours-choices', 'behaviours-questions', 'fluid', 'nativepins', 'select', 'selection', 'shortcuts'],
  'lib/agents.ts': ['behaviours', 'behaviours-choices', 'behaviours-questions', 'connection', 'edge-draw1', 'edge-draw2', 'edge-draw3', 'edge-draw4', 'moment', 'moved', 'native', 'progress', 'shortcuts', 'updbadge'],
  'lib/board.ts': ['board', 'boardarrange', 'boardclose', 'boardcanvas', 'boardhome', 'boardmode', 'boardpins', 'boardreload', 'boardview', 'frame', 'framescroll', 'nativeboard'],
  'lib/boardact.ts': ['board', 'boardarrange', 'boardclose', 'boardcanvas', 'boardhome', 'boardmode', 'boardpins', 'boardreload', 'boardview', 'frame', 'framescroll', 'nativeboard'],
  'lib/commands.ts': ['behaviours', 'behaviours-choices', 'behaviours-questions', 'connection', 'moved', 'progress'],
  'lib/flags.ts': ['flags', 'walkie'],
  'lib/labcall.ts': ['behaviours', 'behaviours-choices', 'behaviours-questions', 'connection', 'moved', 'progress'],
  'lib/proxy.ts': ['devroutes'],
  'lib/update.ts': ['update'],
};

// The browser tests CI runs, with how long each takes in one engine on a CI runner (seconds, from a CI run): the plan
// packs the picked ones into shards of about the same length (shards below). A file not listed never runs in CI.
const TIMES = path.join(ROOT, 'ci/browser-tests.json');
export const readTimes = () => JSON.parse(fs.readFileSync(TIMES, 'utf8'));
export const groupTests = (times = readTimes()) => new Set(Object.keys(times));

// ci/browser-tests.json changes that add, drop or re-time tests: the tests added, else null (anything else in the
// file is no list of tests, so every test runs). A new time alone runs nothing.
export function listEdit(diff) {
  const added = new Set();
  const dropped = new Set();
  for (const l of diff.split('\n').filter((x) => /^[+-](?![+-]{2} )/.test(x))) {
    const body = l.slice(1).trim();
    if (body === '' || body === '{' || body === '}') continue;
    const name = body.match(/^"([\w-]+)":\s*\d+,?$/)?.[1];
    if (!name) return null;
    (l[0] === '+' ? added : dropped).add(name);
  }
  return [...added].filter((n) => !dropped.has(n));
}

// The browser jobs: the picked tests packed into shards per engine, longest first onto the shortest shard, so they
// end at about the same time. As many shards as the tests need at about TARGET seconds each, at most RUNNERS[engine]:
// WebKit runs on GitHub's macOS runners (Safari's own WebKit; Linux WebKit draws, scrolls and times frames otherwise),
// 5 at once for a free account; Chromium on Linux, 5 so a release keeps room for a PR. The bench rides on the first
// WebKit shard.
const RUNNERS = { webkit: 5, chromium: 5 };
const TARGET = 60;
// Tests too long for one shard, run in parts side by side: name@i/n, ci/browser-run.mjs passes TEST_PART=i/n and the
// test runs only that part. Each part counts as its share of the test's time. anchoring-torture alone took 250-500 s,
// so its shard ran minutes after the others had ended.
const SPLIT = { 'anchoring-torture': 3 };
const parts = (n, split) => (split[n] > 1 ? Array.from({ length: split[n] }, (_, i) => `${n}@${i + 1}/${split[n]}`) : [n]);
export function shards(picked, { engines = ['webkit'], times = readTimes(), bench = false, native = false, first = [], runners = RUNNERS, split = SPLIT } = {}) {
  const limit = (engine) => (typeof runners === 'number' ? Math.max(1, Math.floor(runners / engines.length)) : runners[engine] ?? 5);
  const names = (picked === 'all' ? Object.keys(times) : picked.split(/\s+/).filter(Boolean)).flatMap((n) => parts(n, split));
  const whole = (n) => n.split('@')[0];
  const cost = (n) => (times[whole(n)] ?? TARGET) / (split[whole(n)] || 1); // a test with no time yet counts as a whole shard
  first = first.flatMap((n) => parts(n, split));
  const total = names.reduce((s, n) => s + cost(n), 0);
  const jobs = [];
  for (const engine of engines) {
    const k = Math.min(limit(engine), Math.max(1, Math.ceil(total / TARGET)), Math.max(1, names.length));
    const bins = Array.from({ length: k }, () => ({ files: [], secs: 0 }));
    for (const n of [...names].sort((a, b) => cost(b) - cost(a) || a.localeCompare(b))) {
      const bin = bins.reduce((lo, b) => (b.secs < lo.secs ? b : lo));
      bin.files.push(n);
      bin.secs += cost(n);
    }
    bins.forEach((b, i) => {
      const withBench = bench && engine === 'webkit' && i === 0;
      const withNative = native && engine === 'webkit' && i === 0;
      // The PR's own test files first, then longest first: a failure shows as early as it can.
      const files = [...b.files.filter((n) => first.includes(n)), ...b.files.filter((n) => !first.includes(n))];
      if (b.files.length || withBench || withNative) jobs.push({ engine, os: engine === 'webkit' ? 'macos-latest' : 'ubuntu-latest', shard: `${i + 1}/${k}`, files: files.join(' '), bench: withBench, native: withNative, secs: Math.round(b.secs) });
    });
  }
  // The bench alone, with no WebKit in this run: a job of its own on WebKit.
  // The bench or the native check with no WebKit shard in this run: a job of their own on WebKit.
  if ((bench || native) && !jobs.some((j) => j.engine === 'webkit' && j.shard.startsWith('1/'))) jobs.push({ engine: 'webkit', os: 'macos-latest', shard: bench ? 'bench' : 'native', files: '', bench, native, secs: 0 });
  return jobs;
}

const readTest = (n) => {
  try {
    return fs.readFileSync(path.join(ROOT, 'test/browser', `${n}.mjs`), 'utf8');
  } catch {
    return '';
  }
};

// ---------- the reach map (ci/reach.mjs): the lines of the widget and the server each browser test runs ----------
// A covered file's change runs the tests that ran one of its changed lines (in Chromium, on the map's commit). Not
// known, so every test: no map, a line the map can't place, or a widget line no test ran (it may be one only WebKit
// runs). A server line (local.mjs, lib/) no browser test runs is left to the unit tests. A test the map has no lines for (new, or it failed
// while the map was made) always runs.
const COVERED = /^(src\/.+\.(ts|js)|local\.mjs|lib\/.+\.(ts|mjs))$/;
export const readMap = (file = process.env.REACH_MAP || path.join(ROOT, 'ci/reach-map.json')) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
const inRanges = (text, lines) => (text || '').split(',').some((part) => {
  if (!part) return false;
  const [a, b = a] = part.split('-').map(Number);
  return lines.some((l) => l >= a && l <= b);
});
// `git diff -U0` hunks: { a, b } the old side's first line and count, { c, d } the new side's.
export const hunks = (diff) => [...diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map((m) => ({ a: +m[1], b: m[2] === undefined ? 1 : +m[2], c: +m[3], d: m[4] === undefined ? 1 : +m[4] }));
// The base's lines a change touches: the lines it removes or rewrites, and for lines only added, the two around them.
export const touched = (diff) => hunks(diff).flatMap(({ a, b }) => (b ? Array.from({ length: b }, (_, i) => a + i) : [a, a + 1]));
// Lines of the base, in the map commit's numbers, through the diff from the map's commit to the base (old side = map).
// A line the base changed since the map becomes the map's lines it replaced (or the two around, if it is new).
export function backTo(lines, diff) {
  const hs = hunks(diff);
  return [...new Set(lines.flatMap((l) => {
    let shift = 0;
    for (const h of hs) {
      // git numbers a side with no lines (b or d 0) by the line before the gap.
      const nextNew = h.d ? h.c + h.d : h.c + 1;
      const nextOld = h.b ? h.a + h.b : h.a + 1;
      if (h.d && l >= h.c && l < nextNew) return h.b ? Array.from({ length: h.b }, (_, i) => h.a + i) : [h.a, h.a + 1];
      if (l >= nextNew) shift = nextOld - nextNew;
      else break;
    }
    return [l + shift];
  }))];
}
// Code nearly every test runs (the lab starting, a pin drawn, a card opened) would pick nearly every test and save
// nothing: a line more than half the tests run picks a few of them instead, the ones that run most of its file (they
// lean on that code the most) and the quickest. A change there that breaks it breaks it for all, so a few find it;
// every test still runs on a release, and a PR can run all by hand ("Run workflow").
const SHARED = 0.25;
const SAMPLE = { widest: 3, quickest: 2 };
const lineCount = (text) => (text || '').split(',').reduce((n, part) => {
  if (!part) return n;
  const [a, b = a] = part.split('-').map(Number);
  return n + b - a + 1;
}, 0);
function sample(names, file, map, times) {
  const size = (n) => (file === '#classes' ? (map.tests[n][file] || '').split(' ').length : lineCount(map.tests[n][file]));
  const widest = [...names].sort((a, b) => size(b) - size(a) || a.localeCompare(b)).slice(0, SAMPLE.widest);
  const quickest = [...names].filter((n) => !widest.includes(n)).sort((a, b) => (times[a] ?? 60) - (times[b] ?? 60) || a.localeCompare(b)).slice(0, SAMPLE.quickest);
  return [...widest, ...quickest];
}
export function reachOf(file, lines, map, tests, times = readTimes()) {
  if (!map || !lines?.length) return null;
  const mapped = Object.keys(map.tests).filter((n) => tests.has(n));
  const pick = new Set();
  let reached = false;
  for (const l of lines) {
    const ran = mapped.filter((n) => inRanges(map.tests[n][file], [l]));
    if (!ran.length) continue;
    reached = true;
    for (const n of ran.length > mapped.length * SHARED ? sample(ran, file, map, times) : ran) pick.add(n);
  }
  if (!reached) return null;
  for (const n of tests) if ((!map.tests[n] && !map.unmapped?.[n]) || map.failed?.includes(n)) pick.add(n);
  return [...pick];
}

// The classes a stylesheet's lines style: for each line, the selectors of the rules it sits in (an @media's too).
export function classesAt(css, lines) {
  const stack = [];
  const at = [];
  let head = '';
  css.split('\n').forEach((line, i) => {
    const inside = [...stack];
    const opened = [];
    for (const ch of line.replace(/\/\*.*?\*\//g, '')) {
      if (ch === '{') (stack.push(head.trim()), opened.push(head), (head = ''));
      else if (ch === '}') (stack.pop(), (head = ''));
      else if (ch === ';') head = '';
      else head += ch;
    }
    at[i + 1] = [...inside, ...opened, ...stack, head].join(' ');
    head += ' ';
  });
  const out = new Set();
  for (const l of lines) for (const m of (at[l] || '').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(m[1]);
  return [...out];
}
export function cssReach(classes, map, tests, times = readTimes()) {
  if (!map || !classes.length) return null;
  const mapped = Object.keys(map.tests).filter((n) => tests.has(n));
  const pick = new Set();
  for (const c of classes) {
    const ran = mapped.filter((n) => ` ${map.tests[n]['#classes'] || ''} `.includes(` ${c} `));
    // A class nearly every test shows (a pin, a card): a few of them, as for shared code.
    for (const n of ran.length > mapped.length * SHARED ? sample(ran, '#classes', map, times) : ran) pick.add(n);
  }
  if (!pick.size) return null;
  for (const n of tests) if ((!map.tests[n] && !map.unmapped?.[n]) || map.failed?.includes(n)) pick.add(n);
  return [...pick];
}

// ---------- unit tests: test/*.test.mjs files a PR needs ----------
// From the reach map's "unit" part (the lines of the repo's code each unit file runs, its labs' too): a changed code
// line runs the files that ran it (a few of them for code most files run, as for the browser tests); a code line no unit
// file runs needs none. A changed test file runs itself; another file (a page, a JSON, a skill) runs the test files
// that name it. Every file: the test setup, package.json, test.yml, no map, or a line the map can't place.
const UNIT_ALL = /^(test\/(harness|setup)\.mjs|package\.json|\.github\/workflows\/test\.yml|ci\/(affected|unit-run)\.mjs)$/;
const UNIT_CODE = /^(local\.mjs|(lib|src|hooks|ci|bench|scripts)\/.+\.(m?js|ts))$/;
const unitFiles = () => fs.readdirSync(path.join(ROOT, 'test')).filter((f) => f.endsWith('.test.mjs')).map((f) => f.slice(0, -'.test.mjs'.length)).sort();
const unitSource = (n) => fs.readFileSync(path.join(ROOT, 'test', `${n}.test.mjs`), 'utf8');
export function unitAffected(files, { map = null, linesOf = () => null, all = unitFiles(), source = unitSource } = {}) {
  const why = [];
  const pick = new Set();
  const everything = (reason) => ({ unit: 'all', why: [...why, reason] });
  for (const f of files) {
    const t = f.match(/^test\/([\w-]+)\.test\.mjs$/)?.[1];
    if (t) {
      if (all.includes(t)) pick.add(t);
      why.push(`${f}: runs itself`);
      continue;
    }
    if (UNIT_ALL.test(f)) return everything(`${f}: every unit test`);
    if (UNIT_CODE.test(f)) {
      if (!map?.unit) return everything(`${f}: no reach map, every unit test`);
      const lines = linesOf(f);
      if (!lines?.length) return everything(`${f}: the reach map can't place its change, every unit test`);
      const mapped = Object.keys(map.unit).filter((n) => all.includes(n));
      const ran = new Set();
      for (const l of lines) {
        const by = mapped.filter((n) => inRanges(map.unit[n][f], [l]));
        for (const n of by.length > mapped.length * SHARED ? sample(by, f, { tests: map.unit }, {}) : by) ran.add(n);
      }
      for (const n of ran) pick.add(n);
      why.push(ran.size ? `${f}: ${lines.length} changed line${lines.length === 1 ? '' : 's'} reached by ${[...ran].join(' ')}` : `${f}: no unit test runs its changed lines`);
      continue;
    }
    const base = path.basename(f);
    const naming = all.filter((n) => source(n).includes(base));
    for (const n of naming) pick.add(n);
    why.push(naming.length ? `${f}: named by ${naming.join(' ')}` : `${f}: no unit test reads it`);
  }
  if (map?.unit) for (const n of all) if (!map.unit[n] || map.unitFailed?.includes(n)) if (pick.size) pick.add(n);
  return { unit: [...pick].sort().join(' '), why };
}

export function affected(files, { tests = groupTests(), reach = REACH, diffOf = () => '', map = null, linesOf = () => null, classesOf = () => [] } = {}) {
  const why = [];
  const pick = new Set();
  const first = new Set(); // the PR's own test files: run first in their shard, so a red PR shows red early
  let all = false;
  let native = false;
  let bench = false;
  const srcChanged = files.some((f) => f.startsWith('src/'));
  for (const f of files) {
    if (NO_BROWSER.some((r) => r.test(f))) {
      why.push(`${f}: no browser test reads it`);
      continue;
    }
    const t = f.match(/^test\/browser\/([\w-]+)\.mjs$/)?.[1];
    if (t && tests.has(t)) {
      // And the tests that run it as part of themselves (behaviours-choices.mjs imports behaviours.mjs).
      const also = [...tests].filter((o) => o !== t && readTest(o).includes(`'./${t}.mjs'`));
      for (const n of [t, ...also]) (pick.add(n), first.add(n));
      why.push(`${f}: runs ${[t, ...also].join(' ')}`);
      continue;
    }
    if (f === 'ci/native.mjs') {
      native = true;
      why.push(`${f}: runs the native check`);
      continue;
    }
    if (f.startsWith('bench/')) {
      bench = true;
      why.push(`${f}: runs the bench`);
      continue;
    }
    if (f === 'ci/browser-tests.json') {
      const added = listEdit(diffOf(f));
      if (added) {
        for (const n of added) pick.add(n);
        why.push(`${f}: only its list or times changed, runs ${added.join(' ') || 'nothing new'}`);
        continue;
      }
    }
    if (map && /^src\/.+\.css$/.test(f)) {
      const cls = classesOf(f);
      const ran = cssReach(cls, map, tests);
      if (ran) {
        for (const n of ran) pick.add(n);
        why.push(`${f}: its changed rules style ${cls.slice(0, 6).map((c) => `.${c}`).join(' ')}${cls.length > 6 ? '…' : ''}, shown by ${ran.length} test${ran.length === 1 ? '' : 's'}`);
        continue;
      }
      why.push(`${f}: a change no class names (or no test shows), so every test`);
      all = true;
      continue;
    }
    if (map && COVERED.test(f)) {
      const lines = linesOf(f);
      const ran = reachOf(f, lines, map, tests);
      if (ran) {
        for (const n of ran) pick.add(n);
        why.push(`${f}: ${lines.length} changed line${lines.length === 1 ? '' : 's'} reached by ${ran.length} test${ran.length === 1 ? '' : 's'} (reach map ${map.commit.slice(0, 8)})`);
        continue;
      }
      // The server's lines no browser test runs (a command, an error path) are the unit tests' to check.
      if (lines?.length && !f.startsWith('src/') && lines.every((l) => Number.isInteger(l))) {
        why.push(`${f}: no browser test runs its changed lines (reach map ${map.commit.slice(0, 8)}); the unit tests do`);
        continue;
      }
      why.push(`${f}: the reach map can't place its change, so every test`);
      all = true;
      continue;
    }
    if (reach[f]) {
      for (const r of reach[f]) if (tests.has(r)) pick.add(r);
      why.push(`${f}: runs ${reach[f].filter((r) => tests.has(r)).join(' ') || 'nothing (its tests left the groups)'}`);
      continue;
    }
    if (/^public\/_lab\/[^/]+\.js$/.test(f) && srcChanged) {
      why.push(`${f}: the build of the src/ files changed here`);
      continue;
    }
    all = true;
    why.push(`${f}: runs every test`);
  }
  // A test the map can't follow runs when a file it is about changes (anchoring-torture: anchoring.ts).
  if (map?.unmapped) for (const [n, about] of Object.entries(map.unmapped)) if (tests.has(n) && files.some((f) => about.includes(f))) (pick.add(n), why.push(`${n}: about ${about.join(' ')}, changed here`));
  if (all) return { tests: 'all', native: true, bench: true, first: [...first], why };
  // The native check probes the engines for what the widget uses; it follows any widget change.
  if (srcChanged) native = true;
  return { tests: [...pick].sort().join(' '), native, bench, first: [...first], why };
}

// A merge to main was already tested in its PR, so main runs browser tests only for a release: a merge that changes
// package.json's version (Leo, 20 Nov: "test whole only on tags"; the tag comes from that merge).
export function onMain(packageDiff) {
  return /^[+-]\s*"version"\s*:/m.test(packageDiff)
    ? { tests: 'all', native: true, bench: true, why: ['package.json: a new version, a release runs every test'] }
    : { tests: '', native: false, bench: false, why: ['main: tested in its PR; only a release (a version bump) runs the browsers'] };
}

// The files changed from base to head; with no head, to the working tree, uncommitted and new files included.
export function changedFiles(base, head) {
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  if (head) return git('diff', '--name-only', '--no-renames', base, head);
  return [...new Set([...git('diff', '--name-only', '--no-renames', base), ...git('ls-files', '--others', '--exclude-standard')])];
}

// The map and the changed lines in its numbers, for a PR whose base is `base`. The map's commit is fetched if this
// checkout doesn't have it; without it, no map.
function reachFor(base, head = "HEAD") {
  const map = readMap();
  if (!map) return {};
  const git = (...x) => execFileSync('git', x, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    git('cat-file', '-e', `${map.commit}^{commit}`);
  } catch {
    try {
      git('fetch', '--quiet', '--depth=200', 'origin', map.commit);
    } catch {
      return {};
    }
  }
  const show = (rev, f) => {
    try {
      return git('show', `${rev}:${f}`);
    } catch {
      return '';
    }
  };
  // A stylesheet's changed rules, on both sides: what they styled before and what they style now.
  const classesOf = (f) => {
    try {
      const hs = hunks(git('diff', '-U0', base, head, '--', f));
      const old = classesAt(show(base, f), hs.flatMap(({ a, b }) => Array.from({ length: b }, (_, i) => a + i)));
      const now = classesAt(show(head, f), hs.flatMap(({ c, d }) => Array.from({ length: d }, (_, i) => c + i)));
      return [...new Set([...old, ...now])];
    } catch {
      return [];
    }
  };
  return { map, classesOf, linesOf: (f) => {
    try {
      return backTo(touched(git("diff", "-U0", base, head, "--", f)), git('diff', '-U0', map.commit, base, '--', f));
    } catch {
      return null;
    }
  } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const main = process.argv[2] === '--main';
  const [a, b] = process.argv.slice(main ? 3 : 2);
  const diffOf = (f) => execFileSync('git', ['diff', '-U0', a, b, '--', f], { cwd: ROOT, encoding: 'utf8' });
  const out = a === '--all' || !a || !b ? { tests: 'all', native: true, bench: true, why: ['full run'] }
    : main ? onMain(diffOf('package.json'))
    : affected(changedFiles(a, b), { diffOf, ...reachFor(a, b) });
  const unitOut = a === '--all' || !a || !b || main ? { unit: 'all', why: [] } : unitAffected(changedFiles(a, b), reachFor(a, b));
  out.unit = unitOut.unit;
  out.unitWhy = unitOut.why;
  const unitCount = out.unit === 'all' ? unitFiles().length : out.unit.split(' ').filter(Boolean).length;
  // Unit files over up to three jobs, about eight files a job; none picked, no job.
  out.unitShards = unitCount ? Array.from({ length: Math.min(3, Math.ceil(unitCount / 8)) }, (_, i) => i + 1) : [];
  const engines = (process.env.ENGINES || 'webkit').split(',');
  out.jobs = out.tests || out.bench || out.native ? shards(out.tests, { engines, bench: out.bench, native: out.native, first: out.first || [] }) : [];
  console.log(JSON.stringify(out, null, 2));
  if (process.env.GITHUB_OUTPUT) {
    const jobs = out.jobs.map(({ secs, ...j }) => j);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `tests=${out.tests}\nnative=${out.native}\nbench=${out.bench}\njobs=${JSON.stringify(jobs)}\nunit=${out.unit}\nunitShards=${JSON.stringify(out.unitShards)}\nunitShardCount=${out.unitShards.length}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const head = out.tests === 'all' ? 'Every browser test' : out.tests ? `Browser tests: ${out.tests}` : 'No browser tests';
    const jobs = out.jobs.map((j) => `- ${j.engine} ${j.shard} (~${j.secs} s): ${j.files || '—'}${j.bench ? ' + bench' : ''}`);
    const uhead = out.unit === 'all' ? 'Every unit test' : out.unit ? `Unit tests: ${out.unit}` : 'No unit tests';
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${uhead}\n\n${out.unitWhy.map((w) => `- ${w}`).join('\n')}\n\n`);
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${head}\n\n${out.why.map((w) => `- ${w}`).join('\n')}\n${jobs.length ? `\n#### Jobs\n\n${jobs.join('\n')}\n` : ''}`);
  }
}
