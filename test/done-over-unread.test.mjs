// A person adds to a pin while the agent works on it ("keep the nav, only change spacing"), and the agent, still on the
// first ask, replies --done. The pin must stay open until the agent has been handed what the person added, and if the
// agent never answers that, the usual reminder brings it back (issue #432).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { site, tmp, rm, spawnLab, stop, sleep, up, serverJson, agentCall, pinPost, openTab } from './harness.mjs';

const { DIR, PORT, B } = site('done-over-unread', 11000, 9);
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><title>i</title><h1>i</h1>');
const env = { ...process.env, LAB_CLOSE_GRACE: '1', LAB_SETTLE_MS: '100', LAB_REMIND_MS: '1000', LABIT_HOME: tmp('home'), LABIT_NO_UPDATE_CHECK: '1' };
const server = spawnLab(DIR, PORT, { env });
let tab;
after(async () => {
  tab?.destroy();
  await stop(server);
  rm([DIR], { maxRetries: 5 });
});
const call = agentCall(PORT, () => serverJson(DIR).agent);
const wait = (o = {}) => call('/_lab/wait', { timeout: 2, pages: null, ...o }, 's1');
const pin = pinPost(B);
const person = (parent, text) =>
  fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', parent, name: 'Leo', text }) }).then((r) => r.json());
const reply = (parent, text, intent) => call('/_lab/api/comments', { page: '/index', parent, name: 'Claude', text, intent }, 's1');
const thread = async (id) => (await (await fetch(B + '/_lab/api/comments?page=/index')).json()).comments.find((c) => c.id === id);

test('start', async () => {
  await up(B + '/');
  tab = openTab(PORT);
  await sleep(300);
});

test('done over a correction the agent was never handed keeps the pin open; unanswered, it comes back', async () => {
  const { comment } = await pin('make the header blue');
  assert.match((await wait()).text, /make the header blue/);
  await reply(comment.id, 'On it', 'working');
  await person(comment.id, 'keep the nav as it is, only change spacing');
  await reply(comment.id, 'Done: header is blue', 'done');
  assert.equal((await thread(comment.id)).resolved, false, 'the correction is unread: the pin is not done');
  assert.match((await fetch(B + '/_lab/agent/index').then((r) => r.text())), new RegExp(comment.id), 'still listed for the agent');
  assert.match((await wait()).text, /only change spacing {2}← new/);
  await sleep(1500); // past LAB_REMIND_MS with no answer to the correction
  assert.match((await wait()).text || '', new RegExp(`Still waiting[\\s\\S]*${comment.id}`), 'the reminder brings it back');
});

test('done after the correction was handed closes the pin as before', async () => {
  const { comment } = await pin('make the footer red');
  await wait();
  await person(comment.id, 'green, not red');
  assert.match((await wait()).text, /green, not red/);
  await reply(comment.id, 'Done: footer is green', 'done');
  assert.equal((await thread(comment.id)).resolved, true);
});
