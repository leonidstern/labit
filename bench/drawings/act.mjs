// Drawings as quick actions, part 2: an agent gets each drawing's agent text (out/<id>.txt, from draw.mjs) and a fresh
// copy of the page, does what it asks, and the edited page is checked (scenarios.mjs).
//   node bench/drawings/act.mjs [haiku,sonnet]      (uses the claude CLI; 3 at a time)
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS } from './scenarios.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
const models = (process.argv[2] || 'haiku,sonnet').split(',');
const original = readFileSync(join(HERE, 'pricing.html'), 'utf8');
const only = process.env.ONLY?.split(',');
const jobs = models.flatMap((m) => SCENARIOS.filter((s) => !only || only.includes(s.id)).map((s) => ({ m, s })));
const results = [];
const run = ({ m, s }) =>
  new Promise((done) => {
    const dir = join(OUT, `run-${m}-${s.id}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const f of ['pricing.html', 'site.css']) cpSync(join(HERE, f), join(dir, f));
    const pin = readFileSync(join(OUT, `${s.id}.txt`), 'utf8');
    const prompt = `You answer comments people leave on pages in a lab (labit). This folder is the site; the page /pricing is pricing.html. A new comment came in:\n\n${pin}\n\nDo the work it asks for in the files now (no one is around to answer questions). If it truly asks nothing you can do, change nothing. Then end with one short line: what you did.`;
    const t0 = Date.now();
    execFile('claude', ['-p', prompt, '--output-format', 'json', '--model', m, '--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Edit,Write,Grep,Glob'], { cwd: dir, timeout: 240000, maxBuffer: 1 << 24 }, (err, stdout) => {
      // A throw here would end the whole batch: a page the agent deleted is a fail of this run only.
      let html = '';
      try { html = readFileSync(join(dir, 'pricing.html'), 'utf8'); } catch {}
      const ok = Boolean(html) && Boolean(s.check(html, original));
      let j = {};
      try { j = JSON.parse(stdout); } catch {}
      const said = String(j.result || stdout || err).trim().split('\n').filter(Boolean).at(-1) || '';
      // Wall time, time spent in the model, and turns (each tool call is one): where an action's time goes.
      results.push({ model: m, id: s.id, mark: s.mark, ask: s.ask, ok, changed: html !== original, said, s: Math.round((Date.now() - t0) / 100) / 10, api: Math.round((j.duration_api_ms || 0) / 100) / 10, turns: j.num_turns, cost: j.total_cost_usd });
      console.log(`${ok ? 'PASS' : 'FAIL'} ${m.padEnd(7)} ${s.id.padEnd(16)} ${results.at(-1).s}s ${j.num_turns} turns  ${said.slice(0, 100)}`);
      done();
    });
  });
const queue = [...jobs];
await Promise.all(Array.from({ length: 3 }, async () => { while (queue.length) await run(queue.shift()); }));
writeFileSync(join(OUT, only ? 'results-only.json' : 'results.json'), JSON.stringify(results, null, 2));
const tag = process.env.TAG || 'run';
writeFileSync(join(OUT, `results-${tag}.json`), JSON.stringify(results, null, 2));
const avg = (a) => Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10;
for (const m of models) {
  const r = results.filter((x) => x.model === m);
  console.log(`${m}: ${r.filter((x) => x.ok).length} / ${r.length} · ${avg(r.map((x) => x.s))} s each · ${avg(r.map((x) => x.api))} s in the model · ${avg(r.map((x) => x.turns || 0))} turns · $${avg(r.map((x) => (x.cost || 0) * 1000)) / 1000}`);
}
