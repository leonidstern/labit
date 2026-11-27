// A hand-off the agent confirmed is not handed out again after the lab dies right after it: the record of which
// session got which message is written with the hand-off, not 300 ms later (a kill cannot flush a timer).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { site, tmp, rm, spawnLab, stop, sleep, up, serverJson, agentCall, openTab, pinPost } from './harness.mjs';

const { DIR, PORT, B } = site('handoff-restart', 9650, 40);
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><title>index</title><h1>index</h1>');
const env = { ...process.env, LABIT_HOME: tmp('home'), LABIT_NO_UPDATE_CHECK: '1', LABIT_IDLE_MS: '0', LAB_SETTLE_MS: '120', LAB_ACK_MS: '20000', LAB_ANSWER_MS: '600000', LAB_REMIND_MS: '600000' };
const start = () => spawnLab(DIR, PORT, { env, stdio: 'ignore' });
const call = agentCall(PORT, () => serverJson(DIR).agent);
const tabs = [];
let lab = start();
after(async () => {
  tabs.forEach((t) => t.destroy());
  await stop(lab);
  rm([DIR], { maxRetries: 5 });
});

for (const sig of ['SIGKILL', 'SIGTERM']) {
  test(`a confirmed hand-off is not handed again after ${sig} right after it`, async () => {
    await up(B + '/');
    tabs.push(openTab(PORT));
    await sleep(300);
    const { comment } = await pinPost(B)(`please fix the heading (${sig})`);
    const first = await call('/_lab/wait', { timeout: 5, ack: true }, 'sA');
    assert.equal(first.status, 200);
    assert.ok(first.text.includes(comment.id), 'the first wait has the pin');
    const ack = await call('/_lab/ack', { id: first.delivery }, 'sA');
    assert.equal(ack.status, 204, ack.text);
    lab.kill(sig); // at once: inside the 300 ms the state file used to wait
    await new Promise((r) => (lab.exitCode !== null || lab.signalCode ? r() : lab.once('exit', r)));
    lab = start();
    await up(B + '/');
    tabs.forEach((t) => t.destroy());
    tabs.length = 0;
    tabs.push(openTab(PORT));
    await sleep(300);
    const again = await call('/_lab/wait', { timeout: 1, ack: true }, 'sA');
    assert.equal(again.status, 204, `an empty wait, not an error: ${again.text}`);
    assert.ok(!again.text.includes(comment.id), 'the pin the session already has is not handed again');
  });
}
