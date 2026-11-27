// Two sessions listening on different pages (#420): each is woken only for the pins on its own pages, and a wake that
// was not acted on is sent again a bounded number of times. Against a real lab, through /_lab/pending and the
// Codex/Cursor/opencode hook (hooks/agent.mjs) as an agent runs it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { site, tmp, rm, spawnLab, sleep, up, serverJson, agentCall, pinPost, openTab } from './harness.mjs';

const HOOK = fileURLToPath(new URL('../hooks/agent.mjs', import.meta.url));
const { DIR, PORT, B } = site('wake-routing', 10960, 9);
for (const n of ['pricing', 'dashboard', 'about']) fs.writeFileSync(path.join(DIR, n + '.html'), `<!doctype html><title>${n}</title><h1>${n}</h1>`);
const home = tmp('home');
const scratch = tmp('scratch');
const env = { ...process.env, LAB_CLOSE_GRACE: '1', LAB_SETTLE_MS: '100', LAB_ACK_MS: '1500', LABIT_HOME: home, LABIT_NO_UPDATE_CHECK: '1' };
const server = spawnLab(DIR, PORT, { env });
const tabs = [];
after(() => { for (const t of tabs) t.destroy(); server.kill(); rm([DIR, home, scratch]); });
const key = () => serverJson(DIR).agent;
const call = agentCall(PORT, key);
const post = pinPost(B);
const wait = (who, o = {}) => call('/_lab/wait', { timeout: 1, pages: null, ...o }, who);
const pending = async (sid) =>
  (await fetch(B + '/_lab/pending' + (sid ? `?for=${sid}` : ''), { headers: { 'x-lab-admin': key(), 'x-lab-agent': '1' } })).json();
const hook = (mode, event) =>
  new Promise((resolve) => {
    const p = execFile(process.execPath, [HOOK, mode], { env: { ...env, TMPDIR: scratch } }, (_e, out) => resolve(out.trim()));
    p.stdin.end(JSON.stringify(event));
  });
const stop = (sid) => hook('wake', { session_id: sid, cwd: DIR, hook_event_name: 'Stop' });

test('start', async () => {
  await up(B + '/', { fail: () => assert.fail('no start') });
  tabs.push(openTab(PORT));
  await sleep(300); // a page open: waits run their time
});

test('two sessions on two pages: each one is told only of the pins on its own page', async () => {
  await wait('A', { pages: ['/pricing'] }); // A listened first, on /pricing, and went quiet
  await wait('B', { pages: ['/dashboard'] }); // then B, on /dashboard: B listened last
  await post('cheaper plan', '/pricing');
  let a = await pending('A');
  let b = await pending('B');
  assert.equal(a.for, 'A');
  assert.equal(a.fresh, 1, 'the less recent listener still sees the pin on its page');
  assert.deepEqual(a.pages, ['/pricing']);
  assert.equal(b.fresh, 0, 'B is not told of a pin on A\'s page');
  assert.equal((await pending()).last, 'B', 'a look that says no session still answers as before');
  assert.equal((await pending()).fresh, 1);
  await post('chart is wrong', '/dashboard');
  a = await pending('A');
  b = await pending('B');
  assert.equal(a.fresh, 1);
  assert.equal(b.fresh, 1);
  assert.deepEqual(b.pages, ['/dashboard']);
  assert.notEqual(a.key, b.key);
});

test('a page nobody claimed belongs to the session that listened last', async () => {
  await post('typo in the footer', '/about');
  assert.equal((await pending('B')).fresh, 2);
  assert.equal((await pending('A')).fresh, 1);
});

test("another session's open wait doesn't keep a session from being woken", async () => {
  const took = await wait('B', { pages: ['/dashboard'] }); // B listens again: it takes its pin
  assert.match(took.text, /chart is wrong/);
  assert.doesNotMatch(took.text, /cheaper plan/);
  const open = wait('B', { pages: ['/dashboard'], timeout: 3 }); // and keeps listening, with nothing for it
  await sleep(300);
  const a = await pending('A');
  assert.equal(a.listening, false, 'A has no wait open');
  assert.equal(a.fresh, 1);
  assert.equal((await pending('B')).listening, true);
  assert.equal((await pending()).listening, true, 'without a session: any wait, as before');
  assert.equal((await open).status, 204);
});

test('the hook wakes A for its pin, not a session that never listened; A\'s wait for every page then takes it', async () => {
  assert.equal(await stop('C'), '', 'a session that never listened is not woken');
  const out = JSON.parse(await stop('A'));
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /^labit: A new pin /);
  const own = await wait('A', { timeout: 2, ack: true });
  assert.equal(own.status, 200);
  assert.match(own.text, /cheaper plan/);
  await call('/_lab/ack', { id: own.delivery }, 'A');
  assert.equal((await pending('A')).fresh, 0);
});

test('a wake not acted on is sent again at the next stops, three in all (as the Claude Code hook), then not again', async () => {
  await post('bigger button', '/pricing');
  assert.match(JSON.parse(await stop('A')).reason, /A new pin/);
  assert.match(JSON.parse(await stop('A')).reason, /A new pin/, 'the pin is still unhanded: one more wake');
  assert.match(JSON.parse(await stop('A')).reason, /A new pin/, 'and a third');
  assert.equal(await stop('A'), '', 'bounded: no stop-hook loop');
  await post('and the header', '/pricing');
  assert.match(JSON.parse(await stop('A')).reason, /^labit: 2 new pins/, 'a new pin is a new set: woken again');
});

test('a pin handed to a wait with no word back is listed as quiet until the agent says something on it', async () => {
  await wait('B', { pages: ['/dashboard'], ack: true });
  const q = (await pending('B')).quiet || [];
  assert.ok(q.length >= 1, 'handed, not answered: quiet');
  assert.ok(q.every((x) => x.id && x.at));
  const id = q[0].id;
  await call('/_lab/api/comments', { page: '/dashboard', action: 'progress', id, text: 'after the build' }, 'B');
  assert.ok(!(await pending('B')).quiet.some((x) => x.id === id), 'a status line takes it off the list');
});
