// A pin handed to a wait that never answers (a shell loop left running by a closed session, Leo 19 Nov) counts as not
// answered after LAB_ANSWER_MS: it goes to the next wait, the comment says so, and the lab's state names the session
// as not answering until it replies to anything.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { site, tmp, rm, spawnLab, stop, sleep, up, serverJson, agentCall, pinPost, openTab } from './harness.mjs';

const { DIR, PORT, B } = site('unanswered', 8800, 90);
fs.writeFileSync(path.join(DIR, 'design.html'), '<!doctype html><title>design</title><h1>design</h1>');
const env = { ...process.env, LAB_CLOSE_GRACE: '1', LAB_SETTLE_MS: '100', LAB_ANSWER_MS: '1500', LABIT_HOME: tmp('home'), LABIT_NO_UPDATE_CHECK: '1' };
const server = spawnLab(DIR, PORT, { env });
const tabs = [];
after(async () => {
  for (const t of tabs) t.destroy();
  await stop(server);
  rm([DIR], { maxRetries: 5 });
});
const call = agentCall(PORT, () => serverJson(DIR).agent);
const PAGES = ['/design'];
const wait = (who, o = {}) => call('/_lab/wait', { timeout: 3, pages: PAGES, ack: true, ...o }, who);
const waitAcked = async (who, o) => {
  const r = await wait(who, o);
  if (r.delivery) await call('/_lab/ack', { id: r.delivery }, who);
  return r;
};
const post = (text) => pinPost(B)(text, '/design');
const find = async (id) => ((await fetch(`${B}/_lab/api/comments?page=/design`, { headers: { origin: B } }).then((r) => r.json())).comments || []).find((c) => c.id === id);
const state = () => fetch(`${B}/_lab/state`).then((r) => r.json());

test('start', async () => {
  await up(B + '/', { fail: false });
  tabs.push(openTab(PORT));
  await sleep(300);
});

test('a hand-off with no reply goes to the next wait and is marked not answered', async () => {
  const { comment } = await post('make the title bigger');
  const a = await waitAcked('ghost'); // the loop: waits and acks, never answers
  assert.match(a.text, /make the title bigger/);
  assert.ok((await find(comment.id)).handedAt, 'handed to the ghost');
  await sleep(2200);
  const c = await find(comment.id);
  assert.equal(c.handedAt, undefined, 'hand-off taken back');
  assert.ok(c.unanswered, 'marked not answered');
  assert.deepEqual((await state()).silent.map((q) => q.label), ['Claude (ghost)'], 'the ghost is named as not answering');
  // Another session's wait for the same pages gets the pin whole.
  const b = await waitAcked('live');
  assert.match(b.text, /# New comments/);
  assert.match(b.text, /make the title bigger/);
  assert.ok((await find(comment.id)).handedAt, 'handed to the live session');
  // The live session answers in time: nothing comes back.
  const r = await call('/_lab/api/comments', { page: '/design', parent: comment.id, name: 'live', text: 'on it', intent: 'on-it' }, 'live');
  assert.ok(r.status < 300, r.text);
  await sleep(2200);
  assert.ok((await find(comment.id)).handedAt, 'an answered hand-off stays handed');
});

test("a session that isn't answering doesn't end an answering one's wait, and gets pins after it", async () => {
  const live = wait('live', { timeout: 6 });
  await sleep(300);
  const ghost = await wait('ghost', { timeout: 1 }); // the loop re-arms
  assert.equal(ghost.status, 204, 'the ghost heard nothing');
  const { comment } = await post('and the colour');
  const got = await live;
  assert.equal(got.status, 200, `the live wait was not ended: ${got.status} ${got.text}`);
  assert.match(got.text, /and the colour/);
  await call('/_lab/ack', { id: got.delivery }, 'live');
  await call('/_lab/api/comments', { page: '/design', parent: comment.id, name: 'live', text: 'done', intent: 'done' }, 'live');
});

test('a reply from the session that was not answering clears it', async () => {
  const { comment } = await post('ghost talks again');
  const a = await waitAcked('ghost');
  assert.match(a.text, /ghost talks again/);
  assert.equal((await state()).silent.length, 1, 'still named before it says anything');
  await call('/_lab/api/comments', { page: '/design', parent: comment.id, name: 'ghost', text: 'on it', intent: 'on-it' }, 'ghost');
  assert.equal((await state()).silent.length, 0, 'answering again');
});

// A progress line is a sign of work, from the agent (labit reply --progress, signed with its session) or from the plugin's
// hook (the agent's key, no session): the pin stays handed, nobody is named as not answering, and it does not go out again.
test('a progress line inside the window, the agent\'s or the hook\'s, keeps the hand-off: not marked unanswered', async () => {
  const progress = (id, text, who) => (who ? call('/_lab/api/comments', { page: '/design', action: 'progress', id, text }, who) : hook(id, text));
  const hook = (id, text) => fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lab-admin': serverJson(DIR).agent, 'x-lab-agent': '1' }, body: JSON.stringify({ page: '/design', action: 'progress', id, text }) });
  for (const [who, text] of [['lineman', 'drawing 2 of 4'], ['', 'helper: build the page']]) {
    const { comment } = await post(`progress by ${who || 'the hook'}`);
    const a = await waitAcked(who || 'hooked');
    assert.match(a.text, /progress by/);
    await sleep(500);
    const r = await progress(comment.id, text, who);
    assert.ok(r.status < 300, `${r.status}`);
    await sleep(2200); // past ANSWER_MS from the hand-off
    const c = await find(comment.id);
    assert.ok(c.handedAt, 'stays handed to the session working on it');
    assert.equal(c.unanswered, undefined, 'not marked as not answered');
    assert.deepEqual((await state()).silent.map((q) => q.label).filter((l) => /lineman|hooked/.test(l)), [], 'its session is not named as silent');
    await call('/_lab/api/comments', { page: '/design', parent: comment.id, name: 'x', text: 'done', intent: 'done' }, who || 'hooked');
  }
});

test('a batch worked through one pin at a time: a sign on any of its pins restarts the clock for the rest, it never clears it', async () => {
  const pins = [];
  for (const t of ['batch one', 'batch two', 'batch three']) pins.push((await post(t)).comment);
  await sleep(300);
  const a = await waitAcked('batcher');
  for (const t of ['batch one', 'batch two', 'batch three']) assert.match(a.text, new RegExp(t), `${t} in one hand-off`);
  await sleep(1000);
  await call('/_lab/api/comments', { page: '/design', parent: pins[0].id, name: 'batcher', text: 'done', intent: 'done' }, 'batcher');
  await sleep(1000); // 2 s after the hand-off, 1 s after the first answer
  assert.ok((await find(pins[1].id)).handedAt, 'pin two still handed: the session is working through the batch');
  assert.ok((await find(pins[2].id)).handedAt, 'pin three too');
  await call('/_lab/api/comments', { page: '/design', parent: pins[1].id, name: 'batcher', text: 'done', intent: 'done' }, 'batcher');
  await sleep(2600); // nothing more: the clock runs out from the last sign
  const three = await find(pins[2].id);
  assert.equal(three.handedAt, undefined, 'a session that went quiet still loses the pin it never answered');
  assert.ok(three.unanswered);
  assert.ok((await find(pins[1].id)).handedAt, 'an answered one stays');
  await call('/_lab/api/comments', { page: '/design', parent: pins[2].id, name: 'batcher', text: 'done', intent: 'done' }, 'batcher');
});
