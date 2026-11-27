import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { site, tmp, rm, spawnLab, sleep, up, serverJson, agentCall, pinPost, openTab } from './harness.mjs';

const { DIR, PORT, B } = site('pending', 8990, 9);
for (const n of ['index', 'other', 'third']) fs.writeFileSync(path.join(DIR, n + '.html'), `<!doctype html><title>${n}</title><h1>${n}</h1>`);
const env = { ...process.env, LAB_CLOSE_GRACE: '1', LAB_SETTLE_MS: '100', LAB_ACK_MS: '1500', LABIT_HOME: tmp('home'), LABIT_NO_UPDATE_CHECK: '1' };
const server = spawnLab(DIR, PORT, { env });
after(() => { for (const t of tabs) t.destroy(); server.kill(); rm([DIR]); });
const key = () => serverJson(DIR).agent;

const call = agentCall(PORT, key);
const wait = (who, o = {}) => call('/_lab/wait', { timeout: 3, pages: null, ...o }, who);
const post = pinPost(B);

const tabs = [];
const pending = () => fetch(B + '/_lab/pending', { headers: { 'x-lab-admin': key(), 'x-lab-agent': '1' } });
test('start', async () => { await up(B + '/', { fail: () => assert.fail('no start') }); });

// The labit plugin's wake (hooks/wake.ts) asks /_lab/pending while its session is idle.
test('pending: the agent key only; it says what nobody was handed, who listened last, and takes nothing', async () => {
  assert.equal((await fetch(B + '/_lab/pending')).status, 403);
  let p = await (await pending()).json();
  assert.equal(p.fresh, 0);
  await post('wake me', '/other');
  p = await (await pending()).json();
  assert.equal(p.fresh, 1);
  assert.deepEqual(p.pages, ['/other']);
  assert.equal(p.listening, false);
  const again = await (await pending()).json();
  assert.equal(again.key, p.key, 'a look takes nothing: the same pins, the same key');
  const a = await wait('w1', { ack: true });
  assert.match(a.text, /wake me/);
  await call('/_lab/ack', { id: a.delivery }, 'w1');
  p = await (await pending()).json();
  assert.equal(p.fresh, 0, 'handed over: nothing pending');
  assert.equal(p.last, 'w1', 'the session that listened last');
  assert.ok(p.cmd && p.dir && p.url);
  // The registry names the session that listened last, so the wake hook finds this lab from any folder.
  const reg = JSON.parse(fs.readFileSync(path.join(env.LABIT_HOME, 'servers', `${PORT}.json`), 'utf8'));
  assert.equal(reg.listener, 'w1');
  assert.equal(reg.port, Number(PORT));
});

// A wait names its pages (`wait --pages /a`), ends, and its session goes quiet: a pin there must still wake that
// session. Those pages stay claimed for half an hour (so an all-pages wait elsewhere doesn't take them), which used to
// hide their pins from /_lab/pending too, so the wake never came for the very pages its session listened on.
test('pending: a pin on the pages the last wait named counts once that wait has ended', async () => {
  await wait('w2', { pages: ['/third'], timeout: 1 }); // nothing there: it ends empty
  await post('after the wait', '/third');
  const p = await (await pending()).json();
  assert.equal(p.listening, false);
  assert.equal(p.last, 'w2');
  assert.equal(p.fresh, 1);
  assert.deepEqual(p.pages, ['/third']);
});

// The whole wake path: the wake's turn tells the session to run `wait` with no --pages (its text names no pages). That
// wait must hear the pages the session itself named before; another session's wait for every page still must not.
test("pending: after a wake, the same session's wait for every page gets the pin on its own claimed page; another session's does not", async () => {
  tabs.push(openTab(PORT));
  await sleep(300); // a page open: waits run their time instead of ending with "the page was closed"
  await wait('w3', { pages: ['/other'], timeout: 1 });
  await post('for w3', '/other');
  const p = await (await pending()).json();
  assert.equal(p.listening, false);
  assert.equal(p.last, 'w3');
  assert.ok(p.pages.includes('/other'));
  const stranger = await wait('w4', { timeout: 1, ack: true });
  assert.ok([200, 204].includes(stranger.status), `the other session's wait ran (${stranger.status})`);
  assert.doesNotMatch(stranger.text, /for w3/, "another session's wait doesn't take a page w3 claimed");
  if (stranger.delivery) await call('/_lab/ack', { id: stranger.delivery }, 'w4');
  const own = await wait('w3', { timeout: 1, ack: true });
  assert.equal(own.status, 200);
  assert.match(own.text, /for w3/);
  await call('/_lab/ack', { id: own.delivery }, 'w3');
});
