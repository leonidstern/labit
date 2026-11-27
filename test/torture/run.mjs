#!/usr/bin/env node
// The torture test's entry: makes N seeded cases in three areas (dev-sync, hotswap, agent-sync), runs each against a lab
// of its own, and says per area and overall how many passed, failed loudly, failed silently, or were flaky, with every
// failure grouped by signature and one small replayable case per signature. See README.md beside this file.
// A fourth area, dev-servers (the lab in front of real frameworks' dev servers), runs when it is named
// (--area dev-servers) or asked for beside the others (--area all --with-dev-servers): it installs frameworks once.
// A fifth, context (what the agent is told about a pin: its element, words, page, window, source and the page's errors),
// is part of --area all: a fifth of the cases, or its own count with --context-cases.
//
//   node test/torture/run.mjs --cases 3000 --area all --seed 1 --concurrency 12 --json out.json
//   node test/torture/run.mjs --smoke
//   node test/torture/run.mjs --smoke --area dev-servers                 (~20 cases on real dev servers)
//   node test/torture/run.mjs --area dev-servers --cases 120 --concurrency 5 --json out.json
//   node test/torture/run.mjs --smoke --area context                      (~20 cases of pin context, real browsers)
//   node test/torture/run.mjs --area context --cases 300 --concurrency 8 --json out.json
//   node test/torture/run.mjs --replay hotswap:2884193731            (one case again, every step printed)
//   node test/torture/run.mjs --replay hotswap:2884193731:0,3,4      (only these steps of it)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Ctx, hashSeed, makeRng, signatureOf, spread, LAN } from './lib.mjs';
import * as devSync from './dev-sync.mjs';
import * as hotswap from './hotswap.mjs';
import * as agentSync from './agent-sync.mjs';
import * as devServers from './dev-servers.mjs';
import * as context from './context.mjs';
import { KNOWN_BUGS, knownBugOf, bugTag } from './known-bugs.mjs';

const AREAS = { 'dev-sync': devSync, hotswap, 'agent-sync': agentSync, 'dev-servers': devServers, context };
// How `--area all` shares its cases out: context a fifth (600 of 3,000), the first three the rest as 35 : 30 : 35.
// (dev-servers is not in the share: it has a count of its own, --dev-server-cases, so the other areas' counts are the
// same with and without it. With --context-cases, context has a count of its own too and the three share --cases.)
const SHARE = { 'dev-sync': 0.28, hotswap: 0.24, 'agent-sync': 0.28, context: 0.2 };
const HEAVY = 'dev-servers';
const CONTEXT = 'context';
const REPO = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

// ---------- arguments (a flag, or the same name in the environment: --cases / TORTURE_CASES) ----------
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0) return argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[i + 1];
  return process.env[`TORTURE_${name.toUpperCase().replace(/-/g, '_')}`] ?? fallback;
};
if (flag('help', false)) {
  console.log(fs.readFileSync(fileURLToPath(new URL('./README.md', import.meta.url)), 'utf8').split('\n## ')[1] || 'see test/torture/README.md');
  process.exit(0);
}
const smoke = Boolean(flag('smoke', false));
const casesGiven = flag('cases', null) !== null;
const opts = {
  seed: Number(flag('seed', 1)),
  cases: Number(flag('cases', smoke ? 60 : 3000)),
  area: String(flag('area', 'all')),
  concurrency: Number(flag('concurrency', smoke ? 8 : 12)),
  json: flag('json', ''),
  /** A failed case is run again this many times: a signature that never comes back is flaky. */
  confirm: Number(flag('confirm', smoke ? 1 : 2)),
  /** At most this many more runs to make a failing case smaller, for each new signature. */
  shrink: Number(flag('shrink', smoke ? 3 : 12)),
  /** The share of hotswap and agent-sync cases that also drive a real browser (Chromium or WebKit). */
  browserShare: flag('no-browser', false) ? 0 : Number(flag('browser-share', smoke ? 0.1 : 0.06)),
  /** Every settle time and bound times this (a slow or busy machine: 2). */
  slow: Number(flag('slow', 1)),
  verbose: Boolean(flag('verbose', false)),
  replay: flag('replay', ''),
  lan: LAN,
  // The dev-servers area: its own number of cases, its own share of real browsers (the widget on a real framework's
  // page is the point), its own limit of cases at once (dev servers are heavy), and the frameworks it draws from.
  devCases: Number(flag('dev-server-cases', smoke ? 20 : 120)),
  devBrowserShare: Number(flag('dev-browser-share', 0.4)),
  devConcurrency: Number(flag('dev-concurrency', smoke ? 4 : 5)),
  frameworks: flag('frameworks', '') ? String(flag('frameworks', '')).split(',') : [],
  // The context area: its own number of cases when asked for (else a fifth of --cases), how many of its browser cases
  // and of its dev-server cases run at once, and the frameworks it draws from ('none': plain pages only).
  contextCases: Number(flag('context-cases', smoke ? 20 : 600)),
  contextBrowserConcurrency: Number(flag('context-browser-concurrency', smoke ? 5 : 6)),
  contextDevConcurrency: Number(flag('context-dev-concurrency', smoke ? 3 : 4)),
  contextFrameworks: flag('context-frameworks', '') ? String(flag('context-frameworks', '')).split(',') : [],
};
// A count that is no whole number (a typo) would run no case at all and still exit 0.
for (const [name, n, min] of [['concurrency', opts.concurrency, 1], ['cases', opts.cases, 0], ['confirm', opts.confirm, 0], ['shrink', opts.shrink, 0]]) {
  if (!Number.isInteger(n) || n < min) throw new Error(`--${name}: a whole number, ${min} or more`);
}
for (const f of opts.contextFrameworks) if (f !== 'none' && !context.FRAMEWORK_NAMES.includes(f)) throw new Error(`--context-frameworks: some of ${context.FRAMEWORK_NAMES.join(', ')}, or none`);
for (const f of opts.frameworks) if (!devServers.FRAMEWORK_NAMES.includes(f)) throw new Error(`--frameworks: some of ${devServers.FRAMEWORK_NAMES.join(', ')}`);
const areaNames = opts.area === 'all' ? [...Object.keys(SHARE), ...(flag('with-dev-servers', false) ? [HEAVY] : [])] : opts.area.split(',');
for (const a of areaNames) if (!AREAS[a]) throw new Error(`--area: one of ${Object.keys(AREAS).join(', ')}, all`);
if (new Set(areaNames).size !== areaNames.length) throw new Error('--area: each area once');
// Named alone, --cases is its count; beside other areas they share --cases and it has --dev-server-cases.
if (areaNames.length === 1 && areaNames[0] === HEAVY && casesGiven) opts.devCases = opts.cases;
// context: named alone, --cases is its count (600 by default, 20 in a smoke run); beside other areas it takes its share
// of --cases, or the count --context-cases gives it (the others then share --cases among them).
const contextOwn = areaNames.includes(CONTEXT) && (areaNames.length === 1 || flag('context-cases', null) !== null);
if (areaNames.length === 1 && areaNames[0] === CONTEXT && casesGiven) opts.contextCases = opts.cases;

// ---------- real browsers, for the cases that ask for one ----------
const require = createRequire(import.meta.url);
let pw = null;
try {
  // From here, from NODE_PATH (as test/browser/harness.mjs looks), or from the folder beside this checkout where this
  // machine keeps it for labit's browser tests.
  for (const paths of [undefined, (process.env.NODE_PATH || '').split(path.delimiter), [path.join(REPO, '..', '.labit-pw-scratch', 'node_modules')]]) {
    try {
      pw = require(require.resolve('playwright', paths && { paths }));
      break;
    } catch {}
  }
} catch {}
const launched = new Map();
let browserSlots = 3; // browser cases at once: each is a real engine's page or two
const browserQueue = [];
opts.browser = !pw || !opts.browserShare
  ? null
  : {
      /** A browser of this engine (started once for the whole run) and a turn to use it; release() when done.
       *  free: no turn is taken (the area holds its own cases back: context.mjs gate). */
      async take(engine, { free = false } = {}) {
        if (free) {
          if (!launched.has(engine)) launched.set(engine, pw[engine].launch());
          try {
            return { browser: await launched.get(engine), devices: pw.devices, release: () => {} };
          } catch (e) {
            launched.delete(engine);
            throw e;
          }
        }
        if (browserSlots > 0) browserSlots--;
        else await new Promise((r) => browserQueue.push(r));
        if (!launched.has(engine)) launched.set(engine, pw[engine].launch());
        try {
          return { browser: await launched.get(engine), devices: pw.devices, release: () => (browserQueue.length ? browserQueue.shift()() : browserSlots++) };
        } catch (e) {
          launched.delete(engine);
          browserQueue.length ? browserQueue.shift()() : browserSlots++;
          throw e;
        }
      },
    };
const closeBrowsers = async () => {
  for (const b of launched.values()) await (await b.catch(() => null))?.close().catch(() => {});
};

// ---------- one case ----------
/** Runs one case: its plan from its seed alone, a world of its own, its findings. `keep`: only these steps of the plan. */
async function runOnce(area, seed, keep = null) {
  const plan = area.plan(makeRng(seed), opts);
  const all = plan.ops.length;
  if (keep) plan.ops = plan.ops.map((op, i) => (keep.includes(i) ? op : null));
  // An area that is heavy lets only so many of its cases run at once (its turn is waited for before the clock starts).
  const release = area.gate ? await area.gate(opts, plan) : null;
  // The turn goes back also when the case's world can't be made (new Ctx throws): the next case would wait for it.
  try {
    const CASE_MS = (area.caseMs || 90000) * opts.slow;
    const ctx = new Ctx(area.name, seed);
    const t0 = Date.now();
    let timer;
    try {
      await Promise.race([
        area.run(plan, ctx, opts),
        new Promise((_, no) => (timer = setTimeout(() => no(new Error(`case ran over ${CASE_MS} ms`)), CASE_MS))),
      ]);
    } catch (e) {
      ctx.add('harness', 'case-threw', e?.stack || String(e));
    } finally {
      clearTimeout(timer);
      await ctx.dispose();
    }
    return { plan, all, findings: ctx.findings, trace: ctx.trace, ms: Date.now() - t0, timings: ctx.timings || {} };
  } finally {
    release?.();
  }
}
// Everything written to stdout and stderr is out before process.exit (a pipe on POSIX writes later).
const flushed = () => Promise.all([process.stdout, process.stderr].map((s) => new Promise((r) => s.write('', r))));
const failing = (findings) => findings.filter((f) => f.cls === 'silent' || f.cls === 'loud');
const sigsOf = (area, findings) => [...new Set(findings.map((f) => signatureOf(area.name, f)))];

// ---------- replay ----------
if (opts.replay) {
  const [name, seed, keep] = String(opts.replay).split(':');
  const area = AREAS[name];
  if (!area || !/^\d+$/.test(seed || '') || (keep !== undefined && !/^(none|\d+(,\d+)*)$/.test(keep))) throw new Error('--replay <area>:<case seed>[:<steps to keep, e.g. 0,3,4, or none>]');
  await (await import(pathToFileURL(path.join(REPO, 'lib/build.ts')).href)).ensureBuilt(REPO);
  await area.prepare?.(opts);
  const times = Number(flag('times', 1));
  let bad = 0;
  for (let n = 0; n < times; n++) {
    const r = await runOnce(area, Number(seed), keep === undefined ? null : keep === 'none' ? [] : keep.split(',').map(Number));
    if (failing(r.findings).length) bad++;
    if (times > 1) {
      console.log(`run ${n + 1}: ${r.findings.length ? [...new Set(r.findings.map((f) => signatureOf(name, f)))].join(' ; ') : 'pass'} (${r.ms} ms)`);
      // The first run that fails is printed in full, below.
      if (!failing(r.findings).length || bad > 1) continue;
    }
    console.log(`# ${name} case ${seed} · kind ${r.plan.kind}${r.plan.browser ? ` · ${r.plan.browser}` : ''} · ${r.ms} ms`);
    console.log(`\n## plan${area.planLine ? ` (${area.planLine(r.plan)})` : ''}`);
    r.plan.ops.forEach((op, i) => console.log(`${String(i).padStart(3)}  ${op ? area.describe(op) : '(left out)'}`));
    console.log('\n## what happened');
    console.log(r.trace.join('\n'));
    console.log('\n## findings');
    for (const f of r.findings) console.log(`- ${signatureOf(name, f)}\n    ${f.detail.replace(/\n/g, '\n    ')}`);
    if (!r.findings.length) console.log('none: pass');
  }
  if (times > 1) console.log(`${bad} of ${times} runs failed`);
  await closeBrowsers();
  await flushed();
  process.exit(0);
}

// ---------- the run ----------
// The page script is built once, before any lab starts (each lab would build it itself, all at once).
await (await import(pathToFileURL(path.join(REPO, 'lib/build.ts')).href)).ensureBuilt(REPO);
// What an area needs once before its cases (dev-servers: the frameworks' installs, into a cache outside this checkout).
for (const a of areaNames) await AREAS[a].prepare?.(opts);

const counts = {};
const byKind = {}; // area -> kind -> the same counts (dev-servers: per framework) // area -> { total, pass, loud, silent, flaky, unclear, harness }
const signatures = new Map(); // signature -> { area, cls, check, tags, cases, confirmed, flaky, example, repro }
const failures = []; // every failing case, one line each
const timings = {}; // name -> [ms], the settle times the areas measured
const caseMs = {};
const own = { [HEAVY]: () => opts.devCases, ...(contextOwn ? { [CONTEXT]: () => opts.contextCases } : {}) }; // areas with a count of their own
const shared = areaNames.filter((a) => !own[a]); // these share --cases
const shares = shared.map((a) => SHARE[a] ?? 1);
const queue = [];
const zero = () => ({ total: 0, pass: 0, loud: 0, silent: 0, flaky: 0, unclear: 0, harness: 0, unconfirmed: 0 });
shared.forEach((a, k) => {
  const n = k === shared.length - 1 ? opts.cases - queue.length : Math.round((opts.cases * shares[k]) / shares.reduce((x, y) => x + y, 0));
  counts[a] = zero();
  for (let i = 0; i < n; i++) queue.push({ area: AREAS[a], index: i, seed: hashSeed(opts.seed, a, i) });
});
for (const a of areaNames.filter((x) => own[x])) {
  counts[a] = zero();
  for (let i = 0; i < own[a](); i++) queue.push({ area: AREAS[a], index: i, seed: hashSeed(opts.seed, a, i) });
}
// Mixed, so the three areas load the machine together from start to end (the order still depends on the seed alone).
const order = makeRng(hashSeed(opts.seed, 'order')).shuffle(queue);
const sig = (key, area, f) => {
  if (!signatures.has(key)) signatures.set(key, { signature: key, area: area.name, cls: f.cls, check: f.check, tags: f.tags, cases: 0, confirmed: 0, flaky: 0, unconfirmed: 0, kinds: {}, example: f.detail, repro: null });
  return signatures.get(key);
};

async function shrink(area, seed, key, all) {
  let keep = Array.from({ length: all }, (_, i) => i);
  let budget = Math.min(opts.shrink, area.shrinkBudget ?? Infinity); // (a heavy area caps it: its cases take long)
  // A smoke run stops making cases smaller a minute in: it has to end within two (with dev servers: two minutes in, within four).
  const late = () => smoke && Date.now() - t0 > (areaNames.includes(HEAVY) ? 120000 : areaNames.includes(CONTEXT) ? 90000 : 60000);
  for (let chunk = Math.ceil(keep.length / 2); chunk >= 1 && budget > 0 && !late(); ) {
    let smaller = false;
    for (let at = 0; at < keep.length && budget > 0 && !late(); ) {
      const cand = [...keep.slice(0, at), ...keep.slice(at + chunk)];
      budget--;
      const r = await runOnce(area, seed, cand);
      if (sigsOf(area, failing(r.findings)).includes(key)) {
        keep = cand;
        smaller = true;
      } else at += chunk;
    }
    if (!smaller || chunk > keep.length) chunk = Math.floor(chunk / 2);
  }
  return keep;
}

async function runCase(job) {
  const { area, seed } = job;
  const c = counts[area.name];
  const first = await runOnce(area, seed);
  (caseMs[area.name] ||= []).push(first.ms);
  for (const [k, list] of Object.entries(first.timings)) (timings[k] ||= []).push(...list);
  const bad = failing(first.findings);
  const keys = sigsOf(area, bad);
  const kind = first.plan.kind;
  for (const f of first.findings.filter((x) => x.cls === 'unclear' || x.cls === 'harness')) {
    const s = sig(signatureOf(area.name, f), area, f);
    s.cases++;
    s.kinds[kind] = (s.kinds[kind] || 0) + 1;
  }
  let cls;
  const confirmedKeys = [];
  if (!keys.length) cls = first.findings.some((f) => f.cls === 'harness') ? 'harness' : first.findings.some((f) => f.cls === 'unclear') ? 'unclear' : 'pass';
  else {
    // Again, to tell a failure that comes back from one that doesn't. A signature seen come back five times already is
    // taken as known (no more reruns for it); one that never did in eight is taken as flaky.
    const known = (k) => signatures.get(k)?.confirmed >= 5;
    const lost = (k) => signatures.get(k)?.flaky >= 8 && !signatures.get(k)?.confirmed;
    // Flaky means it was run again and did not come back. One not run again (--confirm 0, or a signature taken as
    // flaky already) is unconfirmed: neither came back nor passed.
    const open = keys.filter((k) => !known(k) && !lost(k));
    const again = new Set(keys.filter(known));
    let reruns = 0;
    for (let n = 0; n < opts.confirm && open.some((k) => !again.has(k)); n++, reruns++) for (const k of sigsOf(area, failing((await runOnce(area, seed)).findings))) again.add(k);
    const unconfirmedKeys = keys.filter((k) => !again.has(k) && (lost(k) || !reruns));
    for (const k of keys) {
      const f = bad.find((x) => signatureOf(area.name, x) === k);
      const s = sig(k, area, f);
      s.cases++;
      s.kinds[kind] = (s.kinds[kind] || 0) + 1;
      if (again.has(k)) {
        s.confirmed++;
        confirmedKeys.push(k);
        if (!s.repro) {
          s.repro = { seed, keep: null, ops: first.plan.ops.map((op) => area.describe(op)), kind: first.plan.kind, browser: first.plan.browser || null };
          const keep = opts.shrink > 0 && first.all > 1 ? await shrink(area, seed, k, first.all) : null;
          s.repro.flags = area.replayFlags?.(opts) || '';
          if (keep && keep.length < first.all) Object.assign(s.repro, { keep, ops: keep.map((i) => `${i}: ${area.describe(first.plan.ops[i])}`) });
        }
      } else if (unconfirmedKeys.includes(k)) {
        s.unconfirmed++;
        if (s.flakySeed === undefined) Object.assign(s, { flakySeed: seed, flakyBrowser: first.plan.browser || null });
      } else {
        s.flaky++;
        if (s.flakySeed === undefined) Object.assign(s, { flakySeed: seed, flakyBrowser: first.plan.browser || null });
      }
    }
    const confirmed = bad.filter((f) => confirmedKeys.includes(signatureOf(area.name, f)));
    cls = confirmed.some((f) => f.cls === 'silent') ? 'silent' : confirmed.length ? 'loud' : unconfirmedKeys.length ? 'unconfirmed' : 'flaky';
    failures.push({ area: area.name, seed, kind: first.plan.kind, browser: first.plan.browser || null, class: cls, signatures: keys, confirmed: confirmedKeys, line: `${bad[0].check}: ${bad[0].detail.split('\n')[0].slice(0, 200)}`, ops: first.plan.ops.map((op) => area.describe(op)), replay: `node test/torture/run.mjs --replay ${area.name}:${seed}${first.plan.browser ? ' --browser-share 1' : ' --no-browser'}${area.replayFlags?.(opts) || ''}` });
  }
  // A case whose only notes are "unclear" passed: the note is counted beside it, not instead of it.
  for (const x of [c, ((byKind[area.name] ||= {})[kind] ||= zero())]) {
    x.total++;
    if (cls === 'unclear') (x.pass++, x.unclear++);
    else x[cls]++;
  }
  if (opts.verbose && cls !== 'pass') console.error(`${cls.padEnd(7)} ${area.name}:${seed} ${keys.join(' ; ') || first.findings.map((f) => f.check).join(',')}`);
}

const t0 = Date.now();
let done = 0;
const total = order.length;
console.error(`torture: ${total} cases (${areaNames.map((a) => `${a} ${order.filter((j) => j.area.name === a).length}`).join(', ')}), seed ${opts.seed}, ${opts.concurrency} at once${areaNames.includes(HEAVY) ? ` (dev-servers ${opts.devConcurrency} at once)` : ''}${areaNames.includes(CONTEXT) ? ` (context: ${opts.contextBrowserConcurrency} browser cases and ${opts.contextDevConcurrency} dev-server cases at once)` : ''}${opts.browser ? `, browsers in ${shared.length ? `~${Math.round(opts.browserShare * 100)}% of hotswap and agent-sync` : ''}${shared.length && areaNames.includes(HEAVY) ? ' and ' : ''}${areaNames.includes(HEAVY) ? `~${Math.round(opts.devBrowserShare * 100)}% of dev-servers` : ''}` : ', no browsers'}${opts.lan ? '' : ', no wifi address (phones come in as this computer)'}`);
const tick = setInterval(() => {
  const sum = (k) => Object.values(counts).reduce((n, c) => n + c[k], 0);
  console.error(`  ${done}/${total} · pass ${sum('pass')} loud ${sum('loud')} silent ${sum('silent')} flaky ${sum('flaky')} harness ${sum('harness')} · ${Math.round((Date.now() - t0) / 1000)} s`);
}, 10000);
tick.unref();
await Promise.all(
  Array.from({ length: Math.max(1, opts.concurrency) }, async () => {
    for (let job; (job = order.pop()); done++) {
      try {
        await runCase(job);
      } catch (e) {
        counts[job.area.name].total++;
        counts[job.area.name].harness++;
        console.error(`harness: ${job.area.name}:${job.seed} ${e?.stack || e}`);
      }
    }
  }),
);
clearInterval(tick);
await closeBrowsers();

// ---------- the report ----------
const seconds = Math.round((Date.now() - t0) / 1000);
const pct = (n, of) => (of ? `${((100 * n) / of).toFixed(1)}%` : '-');
const rows = [...Object.entries(counts), ['overall', Object.fromEntries(['total', 'pass', 'loud', 'silent', 'flaky', 'unclear', 'harness', 'unconfirmed'].map((k) => [k, Object.values(counts).reduce((n, c) => n + c[k], 0)]))]];
console.log(`\ntorture: seed ${opts.seed}, ${total} cases, ${seconds} s at ${opts.concurrency} at once`);
console.log(`${'area'.padEnd(11)} ${'cases'.padStart(6)} ${'pass'.padStart(6)} ${'loud'.padStart(6)} ${'silent'.padStart(6)} ${'flaky'.padStart(6)} ${'harness'.padStart(7)}   pass%  loud%  silent%  flaky%   (passes with an "unclear" note)`);
const row = (name, c) => console.log(`${name.padEnd(11)} ${String(c.total).padStart(6)} ${String(c.pass).padStart(6)} ${String(c.loud).padStart(6)} ${String(c.silent).padStart(6)} ${String(c.flaky).padStart(6)} ${String(c.harness).padStart(7)}   ${pct(c.pass, c.total).padStart(5)}  ${pct(c.loud, c.total).padStart(5)}  ${pct(c.silent, c.total).padStart(6)}  ${pct(c.flaky, c.total).padStart(5)}   ${c.unclear}`);
for (const [name, c] of rows) row(name, c);
const notRerun = rows.at(-1)[1].unconfirmed;
if (notRerun) console.log(`(${notRerun} failing case${notRerun === 1 ? ' was' : 's were'} not run again: --confirm 0, or a signature taken as flaky; in no column above)`);
if (byKind[HEAVY]) {
  console.log(`\ndev-servers by framework:`);
  for (const f of devServers.FRAMEWORK_NAMES) if (byKind[HEAVY][f]) row(f, byKind[HEAVY][f]);
}
if (byKind[CONTEXT]) {
  console.log(`\ncontext by kind of case (fw-…: behind that framework's dev server):`);
  for (const k of context.KIND_NAMES) if (byKind[CONTEXT][k]) row(k, byKind[CONTEXT][k]);
}
const sigList = [...signatures.values()].sort((a, b) => b.cases - a.cases);
const say = (title, list, each) => {
  if (!list.length) return;
  console.log(`\n${title}`);
  for (const s of list) each(s);
};
// A case with a real browser is replayed with one (--browser-share 1); the others without (--no-browser).
const withBrowser = (b) => (b ? ' --browser-share 1' : ' --no-browser');
// keep: [] (no step needed) is written as "none"; no keep at all is the whole plan.
const replayOf = (s) => `node test/torture/run.mjs --replay ${s.area}:${s.repro.seed}${s.repro.keep ? `:${s.repro.keep.join(',') || 'none'}` : ''}${withBrowser(s.repro.browser)}${s.repro.flags || ''}`;
// Which kinds of case a signature was seen in (dev-servers: which frameworks), when the area has more than one.
const kindsOf = (s) => ((s.area === HEAVY || s.area === CONTEXT) && Object.keys(s.kinds).length ? `\n    seen with: ${Object.entries(s.kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}` : '');
say('Failure signatures (came back on a second run of the same case):', sigList.filter((s) => s.confirmed), (s) => {
  console.log(`- [${s.cls}] ${s.signature}\n    ${bugTag(s.signature)}\n    ${s.cases} case${s.cases === 1 ? '' : 's'} (${s.confirmed} came back, ${s.flaky} did not)${kindsOf(s)}\n    e.g. ${s.example.split('\n')[0].slice(0, 300)}\n    replay: ${replayOf(s)}\n    steps: ${s.repro.ops.join(' → ').slice(0, 900) || '(none needed: it shows before the first step)'}`);
});
say('Flaky signatures (failed once, passed when the case was run again; a race shows here, many cases is a sign of one):', sigList.filter((s) => !s.confirmed && s.flaky), (s) => {
  console.log(`- [${s.cls}] ${s.signature}\n    ${bugTag(s.signature)}\n    ${s.cases} case${s.cases === 1 ? '' : 's'}${kindsOf(s)}, e.g. ${s.example.split('\n')[0].slice(0, 300)}\n    one of them: node test/torture/run.mjs --replay ${s.area}:${s.flakySeed} --times ${s.area === HEAVY ? 5 : 20}${withBrowser(s.flakyBrowser)}${AREAS[s.area].replayFlags?.(opts) || ''}`);
});
say('Not run again (failed once; --confirm 0, or the signature was taken as flaky after eight misses):', sigList.filter((s) => !s.confirmed && s.unconfirmed), (s) => {
  console.log(`- [${s.cls}] ${s.signature}\n    ${bugTag(s.signature)}\n    ${s.unconfirmed} case${s.unconfirmed === 1 ? '' : 's'} not run again${s.flaky ? `, ${s.flaky} that did not come back` : ''}${kindsOf(s)}, e.g. ${s.example.split('\n')[0].slice(0, 300)}\n    one of them: node test/torture/run.mjs --replay ${s.area}:${s.flakySeed}${withBrowser(s.flakyBrowser)}${AREAS[s.area].replayFlags?.(opts) || ''}`);
});
say('Unclear (the contract does not say; noted, the case still passes):', sigList.filter((s) => s.cls === 'unclear'), (s) => console.log(`- ${s.signature}: ${s.cases} cases${kindsOf(s).replace(/\n\s+/, ' (').replace(/$/, kindsOf(s) ? ')' : '')}, e.g. ${s.example.split('\n')[0].slice(0, 240)}`));
say("Harness trouble (this test's own; not counted against labit):", sigList.filter((s) => s.cls === 'harness'), (s) => console.log(`- ${s.signature}: ${s.cases} cases, e.g. ${s.example.split('\n')[0].slice(0, 300)}`));
// Which known bugs showed in this run, and which signatures are new (a re-run after fixes: a bug that shows "not seen"
// is gone, a NEW signature is something nobody listed).
{
  const seen = sigList.filter((x) => (x.cls === 'silent' || x.cls === 'loud') && (x.confirmed || x.flaky || x.unconfirmed));
  console.log('\nKnown bugs and their signatures in this run (confirmed = came back on a rerun; "flaky" = only once):');
  for (const b of KNOWN_BUGS) {
    const mine = seen.filter((x) => knownBugOf(x.signature)?.n === b.n);
    const conf = mine.filter((x) => x.confirmed);
    console.log(`- known bug ${String(b.n).padStart(2)} ${b.name.padEnd(34)} ${mine.length ? `${conf.length} signature${conf.length === 1 ? '' : 's'} confirmed, ${mine.length - conf.length} flaky or not run again; ${mine.reduce((n, x) => n + x.cases, 0)} cases` : 'not seen'}`);
  }
  const fresh = seen.filter((x) => !knownBugOf(x.signature));
  console.log(fresh.length ? `NEW signatures (match no known bug), ${fresh.length}:` : 'NEW signatures: none');
  for (const x of fresh) console.log(`- [${x.cls}] ${x.signature}: ${x.cases} cases (${x.confirmed ? `${x.confirmed} came back` : x.unconfirmed ? 'not run again' : 'flaky only'})`);
}
console.log('\nHow long things took (ms: half of them within, 99% within, slowest):');
for (const [k, list] of Object.entries(caseMs)) console.log(`- one ${k} case: ${spread(list).join(', ')}`);
for (const [k, list] of Object.entries(timings).sort()) console.log(`- ${k}: ${spread(list).join(', ')} (${list.length} measured)`);
if (opts.json) {
  fs.writeFileSync(String(opts.json), JSON.stringify({ seed: opts.seed, cases: total, seconds, concurrency: opts.concurrency, options: { confirm: opts.confirm, shrink: opts.shrink, browserShare: opts.browserShare, slow: opts.slow, lan: Boolean(opts.lan), browsers: Boolean(opts.browser) }, counts: Object.fromEntries(rows), byKind, signatures: sigList.map((x) => ({ ...x, knownBug: knownBugOf(x.signature)?.n ?? null })), failures, timings: Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, spread(v)])) }, null, 2));
  console.log(`\nwrote ${opts.json}`);
}
// Exit 0 when the run itself worked: what it found is in the report (a caller reads the counts, not the exit code).
await flushed();
process.exit(0);
