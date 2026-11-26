import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { site, tmp, rm, spawnLab, stop, sleep, up, serverJson, agentCall, pinPost, openTab } from './harness.mjs';

const { DIR, PORT, B } = site('ack', 8900, 90);
for (const n of ['index', 'other', 'third']) fs.writeFileSync(path.join(DIR, n + '.html'), `<!doctype html><title>${n}</title><h1>${n}</h1>`);
const env = { ...process.env, LAB_CLOSE_GRACE: '1', LAB_SETTLE_MS: '100', LAB_ACK_MS: '1500', LABIT_HOME: tmp('home'), LABIT_NO_UPDATE_CHECK: '1' };
const server = spawnLab(DIR, PORT, { env });
after(async () => {
  for (const t of tabs) t.destroy();
  // The lab writes to .lab as it shuts down: wait for it to exit before removing the folder.
  await stop(server);
  rm([DIR], { maxRetries: 5 });
});
const key = () => serverJson(DIR).agent;

const call = agentCall(PORT, key);
const wait = (who, o = {}) => call('/_lab/wait', { timeout: 3, pages: null, ...o }, who);
const post = pinPost(B);
const list = (page = '/index') => fetch(`${B}/_lab/api/comments?page=${page}`, { headers: { origin: B } }).then((r) => r.json());
const handedAt = async (id, page) => ((await list(page)).comments || []).find((c) => c.id === id)?.handedAt;
const drain = async (who) => { for (let i = 0; i < 3; i++) { const r = await wait(who, { timeout: 1, ack: true }); if (r.delivery) await call('/_lab/ack', { id: r.delivery }, who); } };

const tabs = [];
test('start', async () => { await up(B + '/', { fail: () => assert.fail('no start') }); });
test('open a page', async () => { tabs.push(openTab(PORT)); await sleep(300); });

test('no ack then same session waits again: pins come back whole, handedAt cleared', async () => {
  const { comment } = await post('first pin');
  const a = await wait('s1', { ack: true });
  assert.match(a.text, /first pin/); assert.ok(a.delivery);
  assert.ok(await handedAt(comment.id, '/index'), 'handedAt set');
  const b = await wait('s1', { ack: true });
  assert.match(b.text, /first pin/); assert.match(b.text, /# New comments/);
  assert.notEqual(b.delivery, a.delivery);
  assert.equal((await call('/_lab/ack', { id: a.delivery }, 's1')).status, 404);
  assert.equal((await call('/_lab/ack', { id: b.delivery }, 's1')).status, 204);
  assert.ok(await handedAt(comment.id, '/index'));
  const c = await wait('s1', { ack: true, timeout: 1 });
  assert.equal(c.status, 204);
});

test('ack then wait again: nothing', async () => {
  const { comment } = await post('second pin');
  const a = await wait('s2', { ack: true });
  assert.match(a.text, /second pin/);
  await call('/_lab/ack', { id: a.delivery }, 's2');
  const b = await wait('s2', { ack: true, timeout: 1 });
  assert.equal(b.status, 204);
  assert.ok(await handedAt(comment.id, '/index'));
});

test('timeout takes back; handedAt removed meanwhile; a later wait gets it whole', async () => {
  await drain('s3');
  const { comment } = await post('timeout pin', '/other');
  const a = await wait('s3', { ack: true });
  assert.match(a.text, /timeout pin/);
  assert.ok(await handedAt(comment.id, '/other'));
  await sleep(2000);
  assert.equal(await handedAt(comment.id, '/other'), undefined, 'handedAt cleared');
  const b = await wait('s3', { ack: true });
  assert.match(b.text, /# New comments/); assert.match(b.text, /timeout pin/);
  await call('/_lab/ack', { id: b.delivery }, 's3');
});

test('a different session waiting does not take back; and old client (no ack) never takes back', async () => {
  await drain('s4'); await drain('s5');
  await post('other-session pin', '/third');
  const a = await wait('s4', { ack: true, pages: ['/third'] });
  assert.match(a.text, /other-session pin/);
  const b = await wait('s5', { ack: true, timeout: 1, pages: ['/third'] });
  assert.equal(b.status, 204, 'not handed to s5');
  await call('/_lab/ack', { id: a.delivery }, 's4');
  await post('old client pin', '/third');
  const c = await wait('s6', { pages: ['/third'] });
  assert.match(c.text, /old client pin/); assert.equal(c.delivery, '');
  await sleep(2000);
  const d = await wait('s6', { timeout: 1, pages: ['/third'] });
  assert.equal(d.status, 204);
});
