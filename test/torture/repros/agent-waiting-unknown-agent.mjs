// BUG? Mirror of agent-waiting-name.mjs. An agent labit does not list (LAB_AGENT=aider, which labit documents as "any
// name") signs its replies "aider". waitingOn() (local.mjs:1458) reads "the agent wrote last" from agentKind(name),
// which knows only the 8 listed agents, so the answered thread is still counted as waiting on an answer.
// Run: node test/torture/repros/agent-waiting-unknown-agent.mjs   (prints PASS or BUG, exits 0 either way)
import fs from 'node:fs';
import path from 'node:path';
import { claimPort, tmp, rm, spawnLab, stop, up, cli, LAB, sleep, H1 } from '../../harness.mjs';

const PORT = claimPort(23800, 20);
const DIR = tmp('repro-waiting2');
const HOME = tmp('home');
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><title>i</title><h1>i</h1>');
const clean = { ...process.env, LABIT_HOME: HOME, LABIT_NO_UPDATE_CHECK: '1' };
for (const k of Object.keys(clean)) if (/^(CLAUDE|CODEX|AMP_|CURSOR|ANTIGRAVITY|GEMINI|OPENCODE|LAB_AGENT|AGENT$|AI_AGENT)/.test(k)) delete clean[k];
const lab = spawnLab(DIR, PORT, { env: clean, stdio: 'ignore' });
const waiting = async () => (await (await fetch(B + '/_lab/pages')).json()).pages.find((p) => p.path === '/index')?.waiting;
try {
  await up(B + '/');
  const { comment } = await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', name: 'Leo', text: 'pin', anchor: H1 }) }).then((r) => r.json());
  const before = await waiting();
  const r = await cli(['reply', comment.id, 'looking at it', '--on-it'], { cwd: DIR, env: { ...clean, LAB_AGENT: 'aider' } });
  await sleep(150);
  const after = await waiting();
  const thread = (await fetch(`${B}/_lab/api/comments?page=/index`, { headers: { origin: B } }).then((x) => x.json())).comments.map((c) => `${c.parent ? 'reply' : 'pin'} by "${c.name}"${c.session ? ' (session)' : ''}`);
  console.log(`reply exit ${r.code}; waiting before reply: ${before}, after the agent answered: ${after} (expected 0); ${thread.join(', ')}`);
  console.log(after === 0 ? 'PASS' : 'BUG: an answered thread of an unlisted agent still counts as waiting');
} finally {
  await stop(lab);
  rm([DIR, HOME], { maxRetries: 5 });
}
