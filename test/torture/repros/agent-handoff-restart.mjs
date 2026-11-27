// BUG? A pin handed to a wait and confirmed (ack) is handed AGAIN after the lab restarts within ~300 ms of the hand-off.
// The thread's own file (.lab/comments/*.json: handedAt) is written at once, but the record of which session got which
// message (`handoff`, .lab/state.json) goes through saveState()'s 300 ms timer (local.mjs:495-497, 1241-1246) and
// bye() (local.mjs:2881-2889, SIGINT/SIGTERM/SIGHUP) exits without writing it. SIGKILL cannot flush; it is the same gap.
// The restarted lab no longer knows the agent got the pin, so the next wait is told "# New comments" with it again.
// Run: node test/torture/repros/agent-handoff-restart.mjs [SIGTERM|SIGKILL]   (prints PASS or BUG, exits 0 either way)
import fs from 'node:fs';
import path from 'node:path';
import { claimPort, tmp, rm, spawnLab, stop, up, serverJson, agentCall, sleep, H1, openTab } from '../../harness.mjs';

const SIG = process.argv[2] || 'SIGTERM';
const PORT = claimPort(23800, 20);
const DIR = tmp('repro-handoff');
const HOME = tmp('home');
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><title>i</title><h1>i</h1>');
const env = { ...process.env, LABIT_HOME: HOME, LABIT_NO_UPDATE_CHECK: '1', LAB_SETTLE_MS: '120', LAB_ACK_MS: '20000', LAB_ANSWER_MS: '600000', LAB_REMIND_MS: '600000' };
const start = () => spawnLab(DIR, PORT, { env, stdio: 'ignore' });
const post = (text) => fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', name: 'Leo', text, anchor: H1 }) }).then((r) => r.json());
const idsIn = (t) => [...(t || '').matchAll(/id ([0-9a-f]{12})/g)].map((m) => m[1]);
const key = () => serverJson(DIR).agent;
const call = agentCall(PORT, key);
async function run(gapMs) {
  let lab = start();
  const tabs = [];
  try {
    await up(B + '/');
    tabs.push(openTab(PORT));
    await sleep(300);
    const { comment } = await post('please fix the heading');
    const first = await call('/_lab/wait', { timeout: 5, ack: true }, 'sA');
    if (first.status !== 200 || !first.delivery) throw new Error('first wait: ' + first.status);
    await call('/_lab/ack', { id: first.delivery }, 'sA'); // the agent printed it and confirmed
    await sleep(gapMs);
    lab.kill(SIG);
    await new Promise((r) => (lab.exitCode !== null || lab.signalCode ? r() : lab.once('exit', r)));
    lab = start();
    await up(B + '/');
    tabs.forEach((t) => t.destroy());
    tabs.length = 0;
    tabs.push(openTab(PORT));
    await sleep(300);
    const again = await call('/_lab/wait', { timeout: 1, ack: true }, 'sA'); // the same session, listening again
    return { handedAgain: idsIn(again.text).includes(comment.id), status: again.status };
  } finally {
    tabs.forEach((t) => t.destroy());
    await stop(lab);
  }
}
try {
  const quick = await run(0);   // restart right after the confirmed hand-off
  const slow = await run(600);  // control: restart 600 ms later
  console.log(`${SIG}: restart at once: pin handed again = ${quick.handedAgain} (wait ${quick.status}); restart after 600 ms: handed again = ${slow.handedAgain} (wait ${slow.status})`);
  console.log(!quick.handedAgain ? 'PASS' : 'BUG: a confirmed hand-off is handed out again after a restart within 300 ms of it');
} finally {
  rm([DIR, HOME], { maxRetries: 5 });
}
