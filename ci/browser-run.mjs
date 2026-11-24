// Runs browser test files one after another, the way CI's browser jobs do, and says plainly what failed: each failing
// check's own line, in the job summary and as an error on the PR's checks page, so an agent reading the PR sees which
// test and why without opening the raw log.
//
//   node ci/browser-run.mjs <name>…     names as in ci/browser-tests.json (test/browser/<name>.mjs); engines from ENGINES
//
// A file that fails runs once more: eight browsers on one Mac make a timing check miss now and then. The retry is a
// warning, so a file that keeps needing it is easy to spot. A file that fails twice fails the job, unless it is in
// ci/flaky.json (quarantined: a known flake with an issue and a note); then it is a warning and the job goes on. Keep that
// list short: a quarantined test still runs, but no longer guards anything.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const flaky = JSON.parse(fs.readFileSync(path.join(ROOT, 'ci/flaky.json'), 'utf8'));
const inCI = Boolean(process.env.GITHUB_ACTIONS);
const say = (line) => inCI && console.log(line);
// Workflow commands take one line: newlines and % escaped as GitHub documents.
const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

function once(name) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [path.join('test/browser', `${name}.mjs`)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const take = (to) => (d) => {
      out += d;
      to.write(d);
    };
    child.stdout.on('data', take(process.stdout));
    child.stderr.on('data', take(process.stderr));
    child.on('close', (code) => {
      const fails = out.split('\n').filter((l) => l.startsWith('FAIL'));
      // A crash says no FAIL line: its last lines say what went wrong.
      const why = fails.length ? fails : out.trim().split('\n').slice(-6);
      resolve({ ok: code === 0, secs: Math.round((Date.now() - started) / 1000), why });
    });
  });
}

const names = process.argv.slice(2);
const rows = [];
let failed = 0;
for (const name of names) {
  say(`::group::${name}`);
  let run = await once(name);
  let result = 'passed';
  if (!run.ok) {
    say(`::warning title=${name} failed once::${esc(`running it again. First run:\n${run.why.join('\n')}`)}`);
    if (!inCI) console.log(`\n${name} failed once, running it again`);
    const again = await once(name);
    run = { ...again, secs: run.secs + again.secs, why: again.ok ? run.why : again.why };
    result = again.ok ? 'passed on retry' : 'failed';
  }
  say('::endgroup::');
  console.log(`${name} took ${run.secs} s: ${result}`);
  if (result === 'failed') {
    if (flaky[name]) {
      result = 'failed (quarantined)';
      say(`::warning file=test/browser/${name}.mjs,title=${name} failed, quarantined::${esc(`${flaky[name]}\n${run.why.join('\n')}`)}`);
    } else {
      failed++;
      say(`::error file=test/browser/${name}.mjs,title=${name} failed::${esc(run.why.join('\n'))}`);
    }
  }
  rows.push({ name, secs: run.secs, result, why: result === 'passed' ? [] : run.why });
}

const report = [
  `| test | time | result |`,
  `|---|---|---|`,
  ...rows.map((r) => `| ${r.name} | ${r.secs} s | ${r.result} |`),
  ...rows.filter((r) => r.why.length).map((r) => `\n**${r.name}** (${r.result})\n\n\`\`\`\n${r.why.join('\n')}\n\`\`\``),
].join('\n');
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
else if (rows.some((r) => r.result !== 'passed')) console.log(`\n${report}`);
process.exit(failed ? 1 : 0);
