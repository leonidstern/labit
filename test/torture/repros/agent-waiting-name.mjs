// BUG? waitingOn() (local.mjs:1451-1459) decides "the newest word in the thread is the agent's" with
// agentKind(reply.name) (lib/agents.ts:16-20: lower-cased substring match on "amp", "codex", "claude", ...) instead of
// the reply's `session` field (which only the lab can set, lib/comments-api.mjs:571). A person called "Campbell"
// (contains "amp") who writes last is read as an agent's answer: the page list says 0 waiting, the thread waits.
// Run: node test/torture/repros/agent-waiting-name.mjs   (prints PASS or BUG, exits 0 either way)
import fs from 'node:fs';
import path from 'node:path';
import { claimPort, tmp, rm, spawnLab, stop, up, serverJson, agentCall, sleep, H1 } from '../../harness.mjs';

const PORT = claimPort(23800, 20);
const DIR = tmp('repro-waiting');
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><title>i</title><h1>i</h1>');
const lab = spawnLab(DIR, PORT, { env: { ...process.env, LABIT_HOME: tmp('home'), LABIT_NO_UPDATE_CHECK: '1' }, stdio: 'ignore' });
const post = (name, text, parent) => fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', name, text, parent, anchor: parent ? undefined : H1 }) }).then((r) => r.json());
const waiting = async () => (await (await fetch(B + '/_lab/pages')).json()).pages.find((p) => p.path === '/index')?.waiting;
try {
  await up(B + '/');
  const call = agentCall(PORT, () => serverJson(DIR).agent);
  // Two threads, each answered by the agent and then written to last by a person: 2 threads wait on the agent.
  const seen = {};
  for (const who of ['Dana', 'Campbell']) {
    const { comment } = await post('Leo', `pin for ${who}`);
    const a = await call('/_lab/api/comments', { page: '/index', name: 'Claude', text: 'on it', parent: comment.id }, 's1');
    if (a.status !== 201) throw new Error('agent reply ' + a.status);
    await post(who, 'still broken', comment.id); // the person writes last
    await sleep(100);
    seen[who] = await waiting(); // after Dana: 1 expected; after Campbell: 2 expected
  }
  console.log(`waiting after Dana's reply: ${seen.Dana} (expected 1); after Campbell's reply: ${seen.Campbell} (expected 2)`);
  console.log(seen.Dana === 1 && seen.Campbell === 2 ? 'PASS' : 'BUG: a person named Campbell writing last does not count as waiting');
} finally {
  await stop(lab);
  rm([DIR], { maxRetries: 5 });
}
