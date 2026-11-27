import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { site, tmp, rm, spawnLab, stop, sleep, up, serverJson, agentCall, pinPost, openTab } from './harness.mjs';

const { DIR, PORT, B } = site('two', 8800, 90);
for (const n of ['index', 'other', 'third']) fs.writeFileSync(path.join(DIR, n + '.html'), `<!doctype html><title>${n}</title><h1>${n}</h1>`);
const env = { ...process.env, LAB_CLOSE_GRACE: '1', LAB_SETTLE_MS: '100', LAB_ACK_MS: '1500', LABIT_HOME: tmp('home'), LABIT_NO_UPDATE_CHECK: '1' };
const server = spawnLab(DIR, PORT, { env });
after(async () => {
  for (const t of tabs) t.destroy();
  // The lab writes to .lab as it shuts down: wait for it to exit before removing the folder.
  await stop(server);
  rm([DIR], { maxRetries: 5 });
});

const call = agentCall(PORT, () => serverJson(DIR).agent);
const wait = (who, o = {}) => call('/_lab/wait', { timeout: 3, pages: null, ...o }, who);
const post = pinPost(B);

const tabs = [];
test('start', async () => { await up(B + '/', { fail: () => assert.fail('no start') }); });
test('open a page', async () => { tabs.push(openTab(PORT)); await sleep(300); });

test('a second session on the same pages: the first is told to leave them, the second gets a heads-up with its pins', async () => {
  const first = wait('sess-a', { timeout: 5, pages: ['/index'] });
  await sleep(200);
  const second = wait('sess-b', { timeout: 5, pages: ['/index'] });
  const a = await first;
  assert.equal(a.status, 409, 'the first wait ended by the second');
  await post('a pin for whoever listens');
  const b = await second;
  assert.equal(b.status, 200);
  assert.match(b.text, /^Heads up: Claude \(sess-a\) also listened on \/index just now\. Two sessions on one page/);
  assert.match(b.text, /a pin for whoever listens/);
});

test('the same session listening again: no heads-up', async () => {
  const again = wait('sess-b', { timeout: 5, pages: ['/index'] });
  await sleep(200);
  await post('second pin');
  const r = await again;
  assert.doesNotMatch(r.text, /Heads up/);
  assert.match(r.text, /second pin/);
});

test('different pages: no heads-up', async () => {
  const w = wait('sess-c', { timeout: 5, pages: ['/other'] });
  await sleep(200);
  await post('on other', '/other');
  const r = await w;
  assert.doesNotMatch(r.text, /Heads up/);
});
