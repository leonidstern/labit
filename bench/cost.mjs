// What a task costs an agent: runs a bench task through Claude Code (claude -p, stream-json) several times per arm, each
// in a fresh copy, and records what each run spent and whether it was right. Issue #426: cost per correct answer, not
// the size of the text.
//   node bench/cost.mjs situations   [--arms full,lean] [--runs 10] [--model sonnet] [--jobs 3]
//   node bench/cost.mjs situations-2 [...]
//   node bench/cost.mjs drawings     [--arms full,nolines,skill-whole,skill-core,typed,artifact] [--runs 3]   (after drawings/draw.mjs, typed.mjs)
//   node bench/cost.mjs --summary bench/results/cost/<file>.json      (prints a saved run again)
// Arms are what changes for the agent; each task lists its own (below). Situations: full (the saved agent text) or lean
// (what a wait hands over: LEAN_SKIP lines left out).
// Runs are shuffled across arms, so cache warm-up and drift don't all fall on one arm.
//
// Per run, from the host's own report (null when it doesn't say; never a guess from text size): model calls, uncached
// input, cache-write input, cache-read input, output tokens, turns, tool calls by kind, bytes of tool results, pictures
// the agent opened, wall time, cost in USD as the host lists it (list price, not a plan's bill), and the task's score.
// Raw runs and per-arm medians, p90s and a 95% interval for the mean cost go to bench/results/cost/<task>-<model>-<time>.json.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LEAN_SKIP } from '../lib/comments-api.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// A task: the files an agent gets (copied into a fresh folder), the text it is handed, what to ask, how to score, and
// its arms (what changes between them: the text it is handed, extra arguments for the agent). A task with cases runs
// each case on its own (a run is one arm on one case, --runs times each).
const full = (text) => text;
const lean = (text) => text.split('\n').filter((l) => !LEAN_SKIP.test(l)).join('\n');
const situations = (n) => {
  const tag = n === 1 ? 'situations' : `situations-${n}`;
  return {
    files: ['situations', `${tag}-task.md`],
    text: () => readFileSync(join(HERE, `results/${tag}-agent-text.txt`), 'utf8'),
    into: `bench/results/${tag}-agent-text.txt`,
    prompt: () => `Do the task in bench/${tag}-task.md. Use the name run as your model name in the answer file name.`,
    tools: 'Read,Write,Grep,Glob,Bash',
    arms: { full: { text: full }, lean: { text: lean } },
    score: (dir) => {
      const answer = readdirSync(join(dir, 'bench/results')).find((f) => f.startsWith(`${tag}-answer-`));
      if (!answer) return { pass: 0, of: null, note: 'no answer file' };
      const out = execFileSync('node', [join(HERE, 'score-situations.mjs'), join(dir, 'bench/results', answer), '--batch', String(n)], { encoding: 'utf8' });
      const [, pass, of] = /total: (\d+)\/(\d+) situations/.exec(out) || [];
      // Which situations it got wrong, to tell a miss that comes back in every run of an arm from a one-off.
      const missed = [...out.matchAll(/^(\S+)\s+\S+\s+MISS\s/gm)].map((m) => m[1]);
      return { pass: Number(pass ?? 0), of: of ? Number(of) : null, missed };
    },
  };
};
// The skill as an agent has it: whole, or only its core (start, the local lab, own pins), without the parts for
// boards and for showing a page instead of an Artifact.
const SKILL = readFileSync(join(ROOT, 'skills/labit/SKILL.md'), 'utf8');
const CORE = SKILL.split(/\n(?=## )/).filter((part) => !/^## (Boards|Instead of an Artifact)/.test(part)).join('\n');
// Drawings (bench/drawings): one drawn pin per run, its text as a wait hands it over (out/<id>.txt, from draw.mjs),
// done in a fresh copy of the page; the scenario's check reads the edited page. Arms: the coordinates of a mark the
// page read (`lines`) kept or left out, and the skill whole or only its core.
const DRAWN = join(HERE, 'drawings');
// The same words for a labit pin and an Artifact comment: the page is pricing.html (published as index.html).
const anyPage = (text) => `You answer comments people leave on a page. This folder is the site; the page is pricing.html (published as index.html). A new comment came in:\n\n${text}\n\nDo the work it asks for in the files now (no one is around to answer questions). If it truly asks nothing you can do, change nothing. Then end with one short line: what you did.`;
const drawings = {
  files: [],
  cases: async () => (await import('./drawings/scenarios.mjs')).SCENARIOS,
  setup: (dir) => {
    for (const f of ['pricing.html', 'site.css']) cpSync(join(DRAWN, f), join(dir, f));
  },
  text: (c) => {
    const f = join(DRAWN, 'out', `${c.id}.txt`);
    if (!existsSync(f)) throw new Error(`no ${f}: run bench/drawings/draw.mjs first`);
    return readFileSync(f, 'utf8');
  },
  prompt: (c, text) => `You answer comments people leave on pages in a lab (labit). This folder is the site; the page /pricing is pricing.html. A new comment came in:\n\n${text}\n\nDo the work it asks for in the files now (no one is around to answer questions). If it truly asks nothing you can do, change nothing. Then end with one short line: what you did.`,
  tools: 'Read,Edit,Write,Grep,Glob',
  arms: {
    full: { text: lean },
    nolines: { text: (t) => lean(t).split('\n').filter((l) => !/^lines \(px/.test(l) || /^drawn: .*unclear/m.test(t)).join('\n') },
    'skill-whole': { text: lean, args: ['--append-system-prompt', SKILL] },
    'skill-core': { text: lean, args: ['--append-system-prompt', CORE] },
    // The same asks typed, as labit pins (drawings/typed.mjs) and as comments on an Artifact of the same page (left by a
    // person, read with Claude's artifact comment tool: drawings/artifact-comments.json), with the same words.
    typed: { source: (c) => readFileSync(join(DRAWN, 'out', `${c.id}.typed.txt`), 'utf8'), text: lean, prompt: (c, text) => anyPage(text) },
    artifact: { source: (c) => JSON.parse(readFileSync(join(DRAWN, 'artifact-comments.json'), 'utf8'))[c.id], text: full, prompt: (c, text) => anyPage(text) },
  },
  score: (dir, c) => {
    const ok = Boolean(c.check(readFileSync(join(dir, 'pricing.html'), 'utf8'), readFileSync(join(DRAWN, 'pricing.html'), 'utf8')));
    return { pass: ok ? 1 : 0, of: 1, missed: ok ? [] : [c.id] };
  },
};
const TASKS = { situations: situations(1), 'situations-2': situations(2), drawings };

// One run's spend, from Claude Code's stream-json lines. Each model call can come as several assistant events with the
// same message id and the same usage: counted once.
export function spendOf(lines) {
  const calls = new Map();
  const tools = {};
  let toolBytes = 0;
  let pictures = 0;
  let result = null;
  for (const m of lines) {
    if (m.type === 'assistant' && m.message) {
      if (m.message.id && m.message.usage) calls.set(m.message.id, m.message.usage);
      for (const c of m.message.content || []) if (c.type === 'tool_use') tools[c.name] = (tools[c.name] || 0) + 1;
    }
    if (m.type === 'user' && Array.isArray(m.message?.content))
      for (const c of m.message.content) {
        if (c.type !== 'tool_result') continue;
        const parts = Array.isArray(c.content) ? c.content : [{ type: 'text', text: String(c.content ?? '') }];
        for (const p of parts) {
          if (p.type === 'image') pictures++;
          else toolBytes += Buffer.byteLength(p.text ?? JSON.stringify(p));
        }
      }
    if (m.type === 'result') result = m;
  }
  const sum = (k) => (calls.size ? [...calls.values()].reduce((n, u) => n + (u[k] ?? 0), 0) : null);
  return {
    calls: calls.size,
    uncached: sum('input_tokens'),
    cacheWrite: sum('cache_creation_input_tokens'),
    cacheRead: sum('cache_read_input_tokens'),
    // Output from the final report when there is one: per-event usage can be written before a call's output is done.
    output: result?.usage?.output_tokens ?? sum('output_tokens'),
    turns: result?.num_turns ?? null,
    costUsd: result?.total_cost_usd ?? null,
    models: Object.keys(result?.modelUsage || {}),
    tools,
    toolCalls: Object.values(tools).reduce((n, v) => n + v, 0),
    toolBytes,
    pictures,
    finished: result?.subtype === 'success' || result?.terminal_reason === 'completed',
  };
}

const quantile = (xs, q) => {
  const s = xs.filter((v) => v != null).sort((a, b) => a - b);
  if (!s.length) return null;
  const i = (s.length - 1) * q;
  return s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i));
};
// Two-sided 95% t values for n - 1 degrees of freedom (1.96 from 30 on).
const T95 = [12.71, 4.3, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23, 2.2, 2.18, 2.16, 2.14, 2.13, 2.12, 2.11, 2.1, 2.09, 2.09, 2.08, 2.07, 2.07, 2.06, 2.06, 2.06, 2.05, 2.05, 2.05];
const interval = (xs) => {
  const v = xs.filter((x) => x != null);
  if (v.length < 2) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1));
  const half = (T95[v.length - 2] ?? 1.96) * (sd / Math.sqrt(v.length));
  return { mean, low: Math.max(0, mean - half), high: mean + half }; // a cost is never below zero
};
export function summary(runs) {
  const arms = {};
  for (const arm of [...new Set(runs.map((r) => r.arm))]) {
    const rs = runs.filter((r) => r.arm === arm);
    const pick = (k) => rs.map((r) => r[k]);
    const right = rs.filter((r) => r.score.of && r.score.pass === r.score.of).length;
    const cost = interval(pick('costUsd'));
    arms[arm] = {
      runs: rs.length,
      allRight: right,
      meanScore: rs.reduce((n, r) => n + (r.score.of ? r.score.pass / r.score.of : 0), 0) / rs.length,
      costUsd: { median: quantile(pick('costUsd'), 0.5), p90: quantile(pick('costUsd'), 0.9), mean95: cost },
      // Every run's cost, wrong ones too, over the runs that got everything right; unknown if any run's cost is.
      costPerAllRightRun: right && rs.every((r) => r.costUsd != null) ? rs.reduce((n, r) => n + r.costUsd, 0) / right : null,
      ...Object.fromEntries(['calls', 'turns', 'uncached', 'cacheWrite', 'cacheRead', 'output', 'toolCalls', 'toolBytes', 'pictures', 'seconds'].map((k) => [k, { median: quantile(pick(k), 0.5), p90: quantile(pick(k), 0.9) }])),
    };
  }
  return arms;
}
const show = (arms) => {
  const n = (v, d = 0) => (v == null ? '?' : Number(v).toFixed(d));
  for (const [arm, s] of Object.entries(arms)) {
    const ci = s.costUsd.mean95;
    console.log(`${arm.padEnd(6)} ${s.allRight}/${s.runs} all right · score ${n(s.meanScore * 100)}% · cost median $${n(s.costUsd.median, 3)}, p90 $${n(s.costUsd.p90, 3)}` +
      `${ci ? `, mean $${n(ci.mean, 3)} (95%: ${n(ci.low, 3)}–${n(ci.high, 3)})` : ''} · per all-right run $${n(s.costPerAllRightRun, 3)}`);
    console.log(`       median: ${n(s.turns.median)} turns, ${n(s.calls.median)} calls, cache read ${n(s.cacheRead.median)}, cache write ${n(s.cacheWrite.median)}, uncached ${n(s.uncached.median)}, output ${n(s.output.median)}, ${n(s.toolCalls.median)} tool calls, ${n(s.pictures.median)} pictures, ${n(s.seconds.median)} s`);
  }
};

const run = (task, arm, model, c) =>
  new Promise((done) => {
    const dir = mkdtempSync(join(tmpdir(), 'labit-cost-'));
    mkdirSync(join(dir, 'bench/results'), { recursive: true });
    for (const f of task.files) cpSync(join(HERE, f), join(dir, 'bench', f), { recursive: true });
    task.setup?.(dir, c);
    const a = task.arms[arm];
    const text = a.text(a.source ? a.source(c) : task.text(c));
    if (task.into) writeFileSync(join(dir, task.into), text);
    const t0 = Date.now();
    const args = ['-p', (a.prompt || task.prompt)(c, text), '--output-format', 'stream-json', '--verbose', '--model', model, '--permission-mode', 'acceptEdits', '--allowedTools', task.tools, ...(a.args || [])];
    execFile('claude', args, { cwd: dir, timeout: 1500000, maxBuffer: 1 << 30 }, (err, stdout) => {
      const lines = String(stdout).split('\n').flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      });
      let score;
      try {
        score = task.score(dir, c);
      } catch (e) {
        score = { pass: 0, of: null, note: String(e.message || e).slice(0, 200) };
      }
      rmSync(dir, { recursive: true, force: true });
      done({ arm, ...(c.id ? { case: c.id } : {}), ...spendOf(lines), seconds: Math.round((Date.now() - t0) / 1000), score, ...(err && !lines.length ? { error: String(err.message).slice(0, 200) } : {}) });
    });
  });

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (opt('summary')) {
    const saved = JSON.parse(readFileSync(opt('summary'), 'utf8'));
    console.log(`${saved.task} · ${saved.model} · ${saved.commit} · ${saved.host}`);
    show(saved.arms);
    process.exit(0);
  }
  const name = argv[0];
  const task = TASKS[name];
  if (!task) {
    console.error(`usage: node bench/cost.mjs <${Object.keys(TASKS).join('|')}> [--arms a,b] [--runs 10] [--model sonnet] [--jobs 3]`);
    process.exit(2);
  }
  const arms = opt('arms', Object.keys(task.arms).slice(0, 2).join(',')).split(',');
  if (arms.some((a) => !task.arms[a])) {
    console.error(`arms of ${name}: ${Object.keys(task.arms).join(', ')}`);
    process.exit(2);
  }
  const runs = Number(opt('runs', 10));
  const model = opt('model', 'sonnet');
  const jobs = Number(opt('jobs', 3));
  const cases = task.cases ? await task.cases() : [{}];
  const queue = arms.flatMap((arm) => cases.flatMap((c) => Array.from({ length: runs }, () => [arm, c]))).sort(() => Math.random() - 0.5);
  const done = [];
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (queue.length) {
      const [arm, c] = queue.shift();
      const r = await run(task, arm, model, c);
      done.push(r);
      console.log(`${String(done.length).padStart(3)} ${arm.padEnd(11)}${c.id ? ` ${c.id.padEnd(16)}` : ''} ${r.score.pass}/${r.score.of ?? '?'} · $${r.costUsd ?? '?'} · ${r.turns ?? '?'} turns · ${r.toolCalls} tools · ${r.pictures} pictures · ${r.seconds} s${r.error ? ` · ${r.error}` : ''}`);
    }
  }));
  const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const host = execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim();
  const out = join(HERE, 'results/cost');
  if (!existsSync(out)) mkdirSync(out, { recursive: true });
  const file = join(out, `${name}-${model}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`);
  const saved = { task: name, model, commit, host, node: process.version, at: new Date().toISOString(), arms: summary(done), runs: done };
  writeFileSync(file, JSON.stringify(saved, null, 2));
  show(saved.arms);
  console.log(`\n${file}`);
}
