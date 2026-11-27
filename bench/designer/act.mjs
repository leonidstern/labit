// Designer review, drawing vs text, part 2: each comment (out/<id>.draw.txt, out/<id>.text.txt from pins.mjs) goes
// to an agent with a fresh copy of app.html, back to back, and a grader (Sonnet) reads the diff against the
// scenario's problem and done_when: right / partial / wrong / nothing, and how many changes had nothing to do with it.
//   node bench/designer/act.mjs [haiku,sonnet]
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
const SCEN = JSON.parse(readFileSync(join(HERE, 'scenarios.json'), 'utf8'));
const models = (process.argv[2] || 'haiku,sonnet').split(',');
const claude = (args, cwd) =>
  new Promise((done) => execFile('claude', args, { cwd, timeout: 300000, maxBuffer: 1 << 24 }, (err, stdout) => {
    try {
      done(JSON.parse(stdout));
    } catch {
      done({ result: String(stdout || err) });
    }
  }));
const diffOf = (a, b) => {
  try {
    execFileSync('diff', ['-u', a, b]);
    return '';
  } catch (e) {
    return String(e.stdout);
  }
};
const GRADE = (s, diff, said) => `You grade a coding agent's edit for a design review benchmark. Reply with JSON only, no prose:
{"verdict":"right|partial|wrong|nothing","unrelated":<number of changes in the diff that have nothing to do with the problem>,"why":"<one short line>"}

The problem the reviewer meant: ${s.problem}
Done when: ${s.done_when}
The agent's last words: ${said}

The diff of app.html (empty = nothing changed):
${diff.slice(0, 12000) || '(empty)'}

right = done_when holds. partial = it moved toward it but missed part. wrong = it changed the wrong thing or broke something. nothing = no change.`;

const arms = (process.env.ARMS || 'draw,text').split(',');
const jobs = models.flatMap((m) => SCEN.flatMap((s) => arms.map((arm) => ({ m, s, arm }))));
const results = [];
const run = async ({ m, s, arm }) => {
  const dir = join(OUT, `run-${m}-${arm}-${s.id}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(join(HERE, 'app.html'), join(dir, 'app.html'));
  const pin = readFileSync(join(OUT, `${s.id}.${arm}.txt`), 'utf8');
  const prompt = `You answer comments people leave on pages in a lab (labit). This folder is the site; the page /app is app.html. A new comment came in:\n\n${pin}\n\nDo the work it asks for in the files now (no one is around to answer questions). If it truly asks nothing you can do, change nothing. Then end with one short line: what you did.`;
  const t0 = Date.now();
  const j = await claude(['-p', prompt, '--output-format', 'json', '--model', m, '--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Edit,Write,Grep,Glob'], dir);
  const s_ = Math.round((Date.now() - t0) / 100) / 10;
  const said = String(j.result || '').trim().split('\n').filter(Boolean).at(-1) || '';
  const diff = diffOf(join(HERE, 'app.html'), join(dir, 'app.html'));
  const g = await claude(['-p', GRADE(s, diff, said), '--output-format', 'json', '--model', 'sonnet', '--allowedTools', ''], OUT);
  let grade = {};
  try {
    grade = JSON.parse(/\{[\s\S]*\}/.exec(g.result || '')?.[0] || '{}');
  } catch {}
  const changed = diff.split('\n').filter((l) => /^[+-][^+-]/.test(l)).length;
  results.push({ model: m, arm, id: s.id, kind: s.kind, mark: s.mark, text: s.text, verdict: grade.verdict || '?', unrelated: grade.unrelated ?? null, why: grade.why || '', s: s_, api: Math.round((j.duration_api_ms || 0) / 100) / 10, turns: j.num_turns, cost: j.total_cost_usd, changed, said });
  console.log(`${(grade.verdict || '?').padEnd(8)} ${m.padEnd(6)} ${arm} ${s.id.padEnd(26)} ${s_}s ${j.num_turns}t  ${grade.why || ''}`.slice(0, 200));
};
const queue = [...jobs];
await Promise.all(Array.from({ length: 3 }, async () => {
  while (queue.length) await run(queue.shift());
}));
writeFileSync(join(OUT, `results-${process.env.TAG || 'run'}.json`), JSON.stringify(results, null, 2));
const avg = (a) => Math.round((a.reduce((x, y) => x + y, 0) / (a.length || 1)) * 10) / 10;
for (const m of models)
  for (const arm of arms) {
    const r = results.filter((x) => x.model === m && x.arm === arm);
    const n = (v) => r.filter((x) => x.verdict === v).length;
    console.log(`${m} ${arm}: right ${n('right')}, partial ${n('partial')}, wrong ${n('wrong')}, nothing ${n('nothing')} · ${avg(r.map((x) => x.s))} s · ${avg(r.map((x) => x.turns || 0))} calls · unrelated ${r.reduce((a, x) => a + (x.unrelated || 0), 0)} · lines changed ${avg(r.map((x) => x.changed))} · reply ${avg(r.map((x) => x.said.length))} chars`);
  }
