// labit for Codex, Cursor and opencode (hooks/agent.mjs): the status line of a claimed pin, and the wake for pins nobody
// was handed, against a real lab. Same rules as the Claude Code hook (hooks/wake.ts).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { site, tmp, rm, spawnLab, sleep, up, serverJson, agentCall, pinPost, cli } from './harness.mjs';

const HOOK = fileURLToPath(new URL('../hooks/agent.mjs', import.meta.url));
const { DIR, PORT, B } = site('agent-hooks', 9010, 9);
for (const n of ['index', 'other']) fs.writeFileSync(path.join(DIR, n + '.html'), `<!doctype html><title>${n}</title><h1>${n}</h1>`);
const home = tmp('home');
const scratch = tmp('scratch'); // the hook's state files (TMPDIR)
const env = { ...process.env, LAB_CLOSE_GRACE: '1', LAB_SETTLE_MS: '100', LAB_ACK_MS: '1500', LAB_CLAIM_LIFE_MS: '3000', LABIT_HOME: home, LABIT_NO_UPDATE_CHECK: '1' };
const server = spawnLab(DIR, PORT, { env });
after(() => { server.kill(); rm([DIR, home, scratch]); });
const key = () => serverJson(DIR).agent;
const call = agentCall(PORT, key);
const post = pinPost(B);
const comments = async (page = '/index') => (await (await fetch(`${B}/_lab/api/comments?page=${page}`)).json()).comments;
const pending = async () => (await fetch(B + '/_lab/pending', { headers: { 'x-lab-admin': key(), 'x-lab-agent': '1' } })).json();
// The hook as an agent runs it: the event on stdin, the answer on stdout.
const hook = (mode, event) =>
  new Promise((resolve) => {
    const p = execFile(process.execPath, [HOOK, mode], { env: { ...env, TMPDIR: scratch } }, (_e, out) => resolve(out.trim()));
    p.stdin.end(JSON.stringify(event));
  });
const codex = (sid, extra = {}) => ({ session_id: sid, cwd: DIR, hook_event_name: 'PostToolUse', tool_name: 'Bash', ...extra });
const cursor = (sid, extra = {}) => ({ conversation_id: sid, workspace_roots: [DIR], hook_event_name: 'postToolUse', tool_name: 'Shell', ...extra });
const progressAt = async (id) => (await comments()).find((c) => c.id === id).progress?.at || '';

test('start', async () => { await up(B + '/', { fail: () => assert.fail('no start') }); });

test('progress: only the session that listened last, only a pin it claimed, once a minute, a helper never', async () => {
  const id = (await post('fix the heading')).comment.id;
  const free = (await post('another one')).comment.id;
  const w = await call('/_lab/wait', { timeout: 3, pages: null, ack: true }, 'S1');
  assert.equal(w.status, 200);
  await call('/_lab/ack', { id: w.delivery }, 'S1');
  assert.equal(await progressAt(id), '', 'nothing claimed yet');
  assert.equal(await hook('progress', codex('S1')), '');
  assert.equal(await progressAt(id), '', 'a pin nobody claimed gets no line');
  await call('/_lab/api/comments', { page: '/index', action: 'progress', id, text: 'drawing' }, 'S1');
  const first = await progressAt(id);
  assert.ok(first);
  fs.rmSync(path.join(scratch, 'labit-hook-S1.json'), { force: true }); // the list of claimed pins is kept 15 s: ask again now
  await hook('progress', codex('S2'));
  await hook('progress', codex('S1', { agent_id: 'helper-1' }));
  assert.equal(await progressAt(id), first, "another session's and a helper's tool calls renew nothing");
  await sleep(20);
  await hook('progress', codex('S1'));
  const second = await progressAt(id);
  assert.ok(second > first, 'its own tool call renews the line');
  const line = (await comments()).find((c) => c.id === id).progress.text;
  assert.equal(line, 'drawing', "the agent's own words stay: a renewal moves only the time, and never says the command");
  await hook('progress', cursor('S1'));
  assert.equal(await progressAt(id), second, 'within the minute: no second line');
  assert.equal(await progressAt(free), '');
});

test('progress: the hook stops renewing a pin the agent said nothing on for a while, so the page can say no update (#425)', async () => {
  const id = (await post('left behind')).comment.id;
  const w = await call('/_lab/wait', { timeout: 3, pages: null, ack: true }, 'S1');
  await call('/_lab/ack', { id: w.delivery }, 'S1');
  await call('/_lab/api/comments', { page: '/index', action: 'progress', id, text: 'building' }, 'S1');
  assert.ok((await pending()).working.some((p) => p.id === id), 'claimed: listed for renewal');
  await sleep(3200); // LAB_CLAIM_LIFE_MS: nothing from the agent itself since
  assert.ok(!(await pending()).working.some((p) => p.id === id), 'no longer listed: renewals alone do not keep it claimed');
  const before = await progressAt(id);
  fs.rmSync(path.join(scratch, 'labit-hook-S1.json'), { force: true });
  await hook('progress', codex('S1'));
  assert.equal(await progressAt(id), before, 'its tool calls renew nothing now');
  await call('/_lab/api/comments', { page: '/index', action: 'progress', id, text: 'building, step 2' }, 'S1');
  assert.ok((await pending()).working.some((p) => p.id === id), 'a new line of its own claims it again');
});

test('wake: the session that listened last, at most twice per set of pins, no page named; Codex blocks the stop, Cursor follows up', async () => {
  await post('while you were away', '/other');
  assert.equal((await pending()).listening, false);
  assert.equal(await hook('wake', codex('S2', { hook_event_name: 'Stop' })), '', 'another session is not woken');
  const out = JSON.parse(await hook('wake', codex('S1', { hook_event_name: 'Stop' })));
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /^labit: A new pin \(http:\/\/localhost:\d+\) while you weren't listening\. Run `.*wait --timeout 5`/);
  assert.doesNotMatch(out.reason, /\/other/);
  assert.match(JSON.parse(await hook('wake', codex('S1', { hook_event_name: 'Stop' }))).reason, /A new pin/, 'still unhanded at the next stop: once more (#420)');
  assert.equal(await hook('wake', codex('S1', { hook_event_name: 'Stop' })), '', 'then never again for the same pins');
  await post('and another', '/other');
  const next = JSON.parse(await hook('wake', cursor('S1', { hook_event_name: 'stop', status: 'completed' })));
  assert.match(next.followup_message, /^labit: 2 new pins /);
  assert.equal(next.decision, undefined);
});

test('the session is found from any folder through the lab registry', async () => {
  await post('from elsewhere', '/index');
  const elsewhere = tmp('elsewhere');
  try {
    const out = JSON.parse(await hook('wake', { session_id: 'S1', cwd: elsewhere, hook_event_name: 'Stop' }));
    assert.match(out.reason, /new pin/);
  } finally {
    rm([elsewhere]);
  }
});

test('Cursor: the start hook says the session to the shells, and wait signs with it', async () => {
  assert.deepEqual(JSON.parse(await hook('start', cursor('conv-1', { hook_event_name: 'sessionStart' }))), { env: { LAB_SESSION_ID: 'conv-1' } });
  assert.equal(await hook('start', codex('S1', { hook_event_name: 'SessionStart' })), '', 'Codex has its own id');
  const out = await cli(['wait', '--timeout', '1', '--no-open'], { cwd: DIR, env: { ...env, CURSOR_AGENT: '1', LAB_SESSION_ID: 'conv-1' } });
  assert.doesNotMatch(out.out, /Error/i);
  assert.equal((await pending()).last, 'conv-1');
});

// #420, on a real Codex (0.166): Codex has no idle event, and a `wait --bg` it left running took a pin while it sat idle,
// printed it to nobody and confirmed it, so the pin read "picked up" and nothing brought it in again.
test("Codex: a background wait doesn't confirm its hand-off, so the pin comes back; the person's next message brings it in", async () => {
  const sid = 'codex-thread-1';
  const codexEnv = { ...env, LAB_AGENT: '', CODEX_THREAD_ID: sid };
  const listening = cli(['wait', '--bg', '--timeout', '4', '--no-open'], { cwd: DIR, env: codexEnv });
  for (let i = 0; i < 40 && !(await pending()).listening; i++) await sleep(50);
  await post('left while codex sat idle', '/other');
  const got = await listening;
  assert.match(got.out, /left while codex sat idle/, 'the background wait took it');
  await sleep(2000); // LAB_ACK_MS is 1.5 s here: unconfirmed, it goes back
  const p = await (await fetch(`${B}/_lab/pending?for=${sid}`, { headers: { 'x-lab-admin': key(), 'x-lab-agent': '1' } })).json();
  assert.equal(p.fresh, 1, 'not left "picked up" and unread');
  const out = JSON.parse(await hook('prompt', codex(sid, { hook_event_name: 'UserPromptSubmit', prompt: 'hi', turn_id: 't1' })));
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(out.hookSpecificOutput.additionalContext, /^labit: A new pin .*wait --timeout 5/);
  assert.equal(await hook('prompt', cursor(sid, { hook_event_name: 'beforeSubmitPrompt' })), '', 'Cursor: no such context');
  // Other agents' background waits still confirm what they printed.
  const claude = cli(['wait', '--bg', '--timeout', '4', '--no-open'], { cwd: DIR, env: { ...env, LAB_AGENT: '', CLAUDE_CODE_SESSION_ID: 'cc-1' } });
  const back = await claude;
  assert.match(back.out, /left while codex sat idle/);
  await sleep(2000);
  assert.equal((await pending()).fresh, 0);
});
