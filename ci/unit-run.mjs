// Runs the unit tests (npm test's command) and, when some fail, says which: each failing test as an error on the PR's
// checks page at its file and line, and the failures with their messages in the job summary, so an agent reading the PR
// sees what broke without opening the raw log.
//
//   UNIT_FILES='ack sync' node ci/unit-run.mjs [node --test flags…]     e.g. --test-shard=1/2
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
// UNIT_FILES: the names the plan picked (ci/affected.mjs), space separated; unset or "all": every file.
const picked = (process.env.UNIT_FILES || 'all').trim();
const files = (picked === 'all' ? fs.readdirSync(path.join(ROOT, 'test')).filter((f) => f.endsWith('.test.mjs')).sort() : picked.split(/\s+/).map((n) => `${n}.test.mjs`)).map((f) => `test/${f}`);
const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

const child = spawn(process.execPath, ['--import', './test/setup.mjs', '--test', ...process.argv.slice(2), ...files], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => {
  out += d;
  process.stdout.write(d);
});
const code = await new Promise((r) => child.on('close', r));

if (code !== 0 && process.env.GITHUB_ACTIONS) {
  // node's spec reporter ends with "✖ failing tests:", then per test "test at <file>:<line>:<col>", its name and error.
  const at = out.lastIndexOf('failing tests:');
  const tail = at < 0 ? '' : out.slice(at).replace(/\x1b\[[0-9;]*m/g, '');
  const blocks = tail.split(/\n(?=test at )/).slice(1);
  const real = blocks.filter((b) => !/^✖ .*# /m.test(b)); // a "# reason" after the name: a known gap (todo), not a failure
  for (const b of real) {
    const [, file, line] = b.match(/^test at (\S+?):(\d+):\d+/) ?? [];
    const lines = b.split('\n').filter((l) => l.trim() && !/^\s+at /.test(l));
    const name = (lines[1] ?? '').replace(/^✖ /, '').replace(/ \([\d.]+ms\)$/, '');
    console.log(`::error file=${file},line=${line},title=${esc(name)}::${esc(lines.slice(2, 14).join('\n'))}`);
  }
  // No test named (a crash, a file that didn't load, a run cut short): still an error, with the run's last lines.
  if (!real.length) console.log(`::error title=unit tests failed (exit ${code})::${esc(out.replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').slice(-12).join('\n'))}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const text = real.map((b) => b.split('\n').filter((l) => !/^\s+at /.test(l)).slice(0, 20).join('\n')).join('\n\n');
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${real.length ? `${real.length} unit test${real.length === 1 ? '' : 's'} failed` : `Unit tests failed (exit ${code}), no test named`}\n\n\`\`\`\n${text || out.slice(-3000)}\n\`\`\`\n`);
  }
}
process.exit(code ?? 1);
