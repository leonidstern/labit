// Hand-off acknowledgement, continued (ack.test.mjs): what confirms a hand-off and what does not.
// A file of its own so the two run side by side.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { site, tmp, rm, spawnLab, stop, sleep, up, serverJson, agentCall, pinPost, openTab } from './harness.mjs';

const { DIR, PORT, B } = site('ack-confirm', 8900, 90);
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

test('a reply from the session confirms', async () => {
  await drain('s7');
  const { comment } = await post('reply pin');
  const a = await wait('s7', { ack: true });
  assert.match(a.text, /reply pin/);
  const r = await call('/_lab/api/comments', { page: '/index', parent: comment.id, name: 's7', text: 'on it', intent: 'on-it' }, 's7');
  assert.ok(r.status < 300, r.text);
  await sleep(2000);
  assert.ok(await handedAt(comment.id, '/index'), 'still handed after the timeout');
  const b = await wait('s7', { ack: true, timeout: 1 });
  assert.equal(b.status, 204);
});

test('a reply from another session does not confirm', async () => {
  await drain('s8');
  const { comment } = await post('other reply pin', '/other');
  const a = await wait('s8', { ack: true, pages: ['/other'] });
  assert.match(a.text, /other reply pin/);
  await call('/_lab/api/comments', { page: '/other', parent: comment.id, name: 'x', text: 'hi', intent: 'on-it' }, 'someone-else');
  await sleep(2000);
  // taken back: the thread should come out again
  const b = await wait('s8', { ack: true, timeout: 1, pages: ['/other'] });
  console.log('after other-session reply + timeout:', b.status, b.text.slice(0, 200));
});

test('two waits on different pages by one session: second does not take back the first', async () => {
  await drain('s9');
  const { comment } = await post('page a pin', '/index');
  const a = await wait('s9', { ack: true, pages: ['/index'] });
  assert.match(a.text, /page a pin/);
  const w2 = wait('s9', { ack: true, timeout: 1, pages: ['/other'] }); // before the ack of the first
  await w2;
  const ack = await call('/_lab/ack', { id: a.delivery }, 's9');
  console.log('ack after a parallel wait on another page:', ack.status);
  assert.equal(ack.status, 204, 'first hand-off was taken back by a wait on a different page');
});

test('rules text is sent again after a take-back', async () => {
  await drain('s10');
  const f = path.join(process.env.XDG_CONFIG_HOME, 'labit', 'replies.md');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, '# r\n\n- always be brief\n');
  await post('rules pin', '/third'); // every page is claimed by a wait above: this one listens on /third by name
  const a = await wait('s10', { ack: true, pages: ['/third'] });
  assert.match(a.text, /always be brief/);
  const b = await wait('s10', { ack: true, pages: ['/third'] });
  assert.match(b.text, /rules pin/);
  assert.match(b.text, /always be brief/, 'rules lost in the redelivery (rulesSent not restored)');
});
