// Any agent: labit tells which one runs wait / reply, signs and labels with its name, gives Codex and Amp their way
// back to the session, and hints when Codex's sandbox blocks it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LAB, claimPort, tmp as folder, rm, spawnLab, sleep, up, serverJson } from './harness.mjs';

// No agent of our own: these tests run inside agents too.
const AGENT_VARS = /^(CLAUDE|CODEX|CURSOR|AMP_|ANTIGRAVITY|GEMINI|OPENCODE|LAB_AGENT|AGENT$|AI_AGENT$)/;
const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !AGENT_VARS.test(k)));
const home = folder('home');
const kids = [];
const dirs = [];
after(() => {
  kids.forEach((k) => k.kill());
  rm(dirs);
});
const tmp = (name) => {
  const d = fs.realpathSync(folder(name));
  dirs.push(d);
  return d;
};
const site = (name) => {
  const d = tmp(name);
  fs.writeFileSync(path.join(d, 'index.html'), '<!doctype html><title>t</title><h1 id="t">Hello</h1>');
  return d;
};
async function lab(dir, args = [], env = {}) {
  const p = claimPort(6100, 260);
  const child = spawnLab(dir, p, { args, env: { ...clean, LABIT_HOME: home, ...env } });
  kids.push(child);
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  const B = `http://localhost:${p}`;
  await up(B + '/', { tries: 60, fail: false });
  return { B, log: () => log };
}
const pin = async (B, text) =>
  (await (await fetch(B + '/_lab/api/comments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: B },
    body: JSON.stringify({ page: '/index', name: 'Leo', text, anchor: { selector: '#t', x: 0.1, y: 0.5, docX: 0.1, docY: 20, width: 1000, element: '<h1 id="t">' } }),
  })).json()).comment.id;
const replies = async (B, id, wantOne = true) => {
  for (let i = 0; i < (wantOne ? 60 : 25); i++) {
    const list = (await (await fetch(B + '/_lab/api/comments?page=/index')).json()).comments;
    const r = list.filter((c) => c.parent === id);
    if (r.length || !wantOne) return r;
    await sleep(100);
  }
  return [];
};
const cli = (dir, args, env) =>
  new Promise((resolve) => execFile(process.execPath, [LAB, ...args], { cwd: dir, env: { ...clean, LABIT_HOME: home, ...env } }, (e, out, err) => resolve(out + err)));

test('replies are signed by the agent that runs reply', async () => {
  const dir = site('sign');
  const { B } = await lab(dir);
  const cases = [
    [{}, 'Claude'],
    [{ CLAUDECODE: '1' }, 'Claude'],
    [{ CODEX_THREAD_ID: 'abc12345-6789' }, 'Codex · session abc12345'],
    [{ AMP_CURRENT_THREAD_ID: 'T-1', CLAUDECODE: '1' }, 'Amp · session T-1'], // Amp also sets CLAUDECODE
    [{ CURSOR_AGENT: '1' }, 'Cursor'],
    [{ OPENCODE_CLIENT: 'cli' }, 'opencode'],
    [{ CURSOR_AGENT: '1', CURSOR_CONVERSATION_ID: 'conv-1234567' }, 'Cursor · session conv-123'], // what the Cursor CLI sets in its shells
    [{ OPENCODE: '1', OPENCODE_SESSION_ID: 'ses_df7ace91' }, 'opencode · session ses_df7a'], // what opencode 2 sets in its shells
    [{ ANTIGRAVITY_AGENT: '1' }, 'Antigravity'],
    [{ LAB_AGENT: 'copilot' }, 'Copilot'],
    [{ LAB_AGENT: 'My Bot' }, 'My Bot'],
    [{ AGENT: 'amp' }, 'Amp'],
    [{ CODEX_THREAD_ID: 'abc', AI_AGENT: 'claude-code_2_agent' }, 'Codex · session abc'], // a Codex run inside a Claude Code shell
    [{ AGENT: 'something-else' }, 'Claude'], // AGENT only counts when it names an agent labit knows
    [{ CODEX_THREAD_ID: 'abc', LAB_AGENT_NAME: 'Robot' }, 'Robot · session abc'],
  ];
  for (const [env, name] of cases) {
    const id = await pin(B, 'hello');
    await cli(dir, ['reply', id, 'Done: ok'], env);
    const [r] = await replies(B, id);
    assert.equal(r?.name, name, JSON.stringify(env));
  }
});

test("the pages' waiting count reads who wrote last from the reply's session, not from a name", async () => {
  const dir = site('waiting');
  const { B } = await lab(dir);
  const waiting = async () => (await (await fetch(B + '/_lab/pages')).json()).pages.find((p) => p.path === '/index')?.waiting;
  const id = await pin(B, 'hello');
  assert.equal(await waiting(), 1);
  await cli(dir, ['reply', id, 'Looking at it', '--on-it'], { LAB_AGENT: 'aider' }); // an agent labit does not list
  assert.equal(await waiting(), 0, 'the agent answered last');
  await fetch(B + '/_lab/api/comments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: B },
    body: JSON.stringify({ page: '/index', parent: id, name: 'Campbell', text: 'and the footer?' }), // a person, with an agent-like name
  });
  assert.equal(await waiting(), 1, 'a person named Campbell wrote last');
});

test('a listening Codex session is shown by name, with its resume command', async () => {
  const dir = site('listen');
  await lab(dir);
  const wait = spawn(process.execPath, [LAB, 'wait', '--timeout', '30'], { cwd: dir, env: { ...clean, LABIT_HOME: home, CODEX_THREAD_ID: '0199a-codex' } });
  kids.push(wait);
  let s = null;
  for (let i = 0; i < 50 && !s; i++) {
    await sleep(100);
    s = serverJson(dir).session;
  }
  assert.equal(s.agent, 'Codex');
  assert.equal(s.kind, 'codex');
  assert.equal(s.resume, 'codex resume 0199a-codex');
  wait.kill();
});

test("Codex's sandbox: a blocked call says so and how to get around it", async () => {
  const dir = tmp('sandbox');
  fs.mkdirSync(path.join(dir, '.lab'));
  fs.writeFileSync(path.join(dir, '.lab/server.json'), JSON.stringify({ port: 9, token: 'x' }));
  // \`pin\`, not \`wait\`: both say the same line when the lab can't be reached, but a wait holds on two minutes for a lab
  // coming back before it says so (and this ran two of them, four minutes of the whole unit run). A pin gives up after 5 s.
  const [out, plain] = await Promise.all([
    cli(dir, ['pin', '#t', 'hi'], { CODEX_SANDBOX_NETWORK_DISABLED: '1', CODEX_THREAD_ID: 't' }),
    cli(dir, ['pin', '#t', 'hi'], {}),
  ]);
  assert.match(out, /Codex's sandbox blocks/);
  assert.match(out, /network_access=true/);
  assert.match(plain, /isn't running/);
});

// ---------- plugin files ----------
test('the plugin files agree with the package (name, version)', () => {
  const read = (f) => JSON.parse(fs.readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), 'utf8'));
  const { version } = read('package.json');
  for (const f of ['plugin.json', '.claude-plugin/plugin.json', '.cursor-plugin/plugin.json']) {
    assert.equal(read(f).name, 'labit', f);
    assert.equal(read(f).version, version, `${f} is at ${version}`);
  }
  assert.equal(read('plugin.json').$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.equal(read('.agents/plugins/marketplace.json').plugins[0].source.path, './');
});

test('a pin handed to the agent is marked, so the page can show it as being worked on until the agent answers', async () => {
  const dir = site('handed');
  const { B } = await lab(dir);
  const id = await pin(B, 'make it red');
  await cli(dir, ['wait', '--timeout', '5'], {});
  const get = async () => (await (await fetch(B + '/_lab/api/comments?page=/index')).json()).comments;
  const handed = (await get()).find((c) => c.id === id);
  assert.ok(handed.handedAt, 'marked when handed over');
  await cli(dir, ['reply', id, 'Done: red'], { CODEX_THREAD_ID: 't1' });
  const reply = (await get()).find((c) => c.parent === id);
  assert.ok(reply.session && reply.createdAt >= handed.handedAt, "the agent's answer comes after it");
});

test('each comment is marked when handed over: one left out of a batch still comes, even if older than the rest', async () => {
  const dir = site('marks');
  const { B } = await lab(dir);
  const a = await pin(B, 'make it red');
  await cli(dir, ['wait', '--timeout', '5'], {});
  const get = async () => (await (await fetch(B + '/_lab/api/comments?page=/index')).json()).comments;
  const first = (await get()).find((c) => c.id === a);
  assert.ok(!('deliveredAt' in first) && !('deliveredTo' in first), 'the mark is not in the comment (so a wait does not change what pages load)');
  await sleep(500);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.lab/state.json'), 'utf8')).handed[a][0], first.createdAt, 'marked beside the comments, with the stamp it was handed over at');
  const b = await pin(B, 'and bigger');
  const out = await cli(dir, ['wait', '--timeout', '5'], {});
  assert.match(out, new RegExp(`id ${b}`), 'the new one comes');
  assert.doesNotMatch(out, new RegExp(`id ${a}`), 'the one handed over before does not come again');
  assert.ok(!fs.readFileSync(path.join(dir, '.lab/seen'), { encoding: 'utf8', flag: 'a+' }).trim(), 'no single "seen up to" time moves past comments');
});

test('a pin handed to the agent but never answered comes back in a later wait, once', async () => {
  const dir = site('missed');
  const { B } = await lab(dir, [], { LAB_REMIND_MS: '0' });
  const id = await pin(B, 'make it red');
  const first = await cli(dir, ['wait', '--timeout', '5'], {});
  assert.match(first, new RegExp(`id ${id}`));
  // The agent read nothing and waits again: the pin comes back as a reminder.
  const again = await cli(dir, ['wait', '--timeout', '5'], {});
  assert.match(again, /^# Still waiting for your answer/m);
  assert.match(again, new RegExp(`id ${id} "make it red"`));
  const third = await cli(dir, ['wait', '--timeout', '3'], {});
  assert.doesNotMatch(third, /Still waiting/, 'not again within 10 minutes');
});

test('a page claim survives a lab restart', async () => {
  const dir = site('claim-restart');
  fs.writeFileSync(path.join(dir, 'other.html'), '<!doctype html><title>o</title><h1 id="t">Other</h1>');
  await lab(dir);
  await cli(dir, ['wait', '--pages', 'other', '--timeout', '1'], { LAB_SETTLE_MS: '0' });
  kids.at(-1).kill();
  await sleep(300);
  const { B } = await lab(dir);
  await fetch(B + '/_lab/api/comments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: B },
    body: JSON.stringify({ page: '/other', name: 'Leo', text: 'pin after restart', anchor: { selector: '#t', x: 0.1, y: 0.5, docX: 0.1, docY: 20, width: 1000, element: '<h1 id="t">' } }),
  });
  const plain = await cli(dir, ['wait', '--timeout', '2'], { LAB_SETTLE_MS: '0' });
  assert.doesNotMatch(plain, /pin after restart/, 'the claiming session keeps its page across the restart');
  const mine = await cli(dir, ['wait', '--pages', 'other', '--timeout', '2'], { LAB_SETTLE_MS: '0' });
  assert.match(mine, /pin after restart/);
});

test('two sessions share one lab by page: wait --pages takes only its pages, a plain wait the rest', async () => {
  const dir = site('pages');
  fs.writeFileSync(path.join(dir, 'other.html'), '<!doctype html><title>o</title><h1 id="t">Other</h1>');
  const { B } = await lab(dir);
  const pinOn = async (page, text) =>
    (await (await fetch(B + '/_lab/api/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: B },
      body: JSON.stringify({ page, name: 'Leo', text, anchor: { selector: '#t', x: 0.1, y: 0.5, docX: 0.1, docY: 20, width: 1000, element: '<h1 id="t">' } }),
    })).json()).comment.id;
  const mine = cli(dir, ['wait', '--pages', 'other', '--timeout', '6'], { LAB_SETTLE_MS: '0' });
  await sleep(400);
  const rest = cli(dir, ['wait', '--timeout', '6'], { LAB_SETTLE_MS: '0' });
  await sleep(400);
  await pinOn('/other', 'pin on other');
  await pinOn('/index', 'pin on index');
  const [a, b] = await Promise.all([mine, rest]);
  assert.match(a, /pin on other/);
  assert.doesNotMatch(a, /pin on index/);
  assert.match(b, /pin on index/);
  assert.doesNotMatch(b, /pin on other/, 'a plain wait leaves pages another session listens on');
  assert.doesNotMatch(a + b, /Another session is listening/);
  // Between its waits (working on the pins), the page stays with that session.
  await pinOn('/other', 'second on other');
  const later = await cli(dir, ['wait', '--timeout', '2'], { LAB_SETTLE_MS: '0' });
  assert.doesNotMatch(later, /second on other/, 'later: ' + later);
  const again = await cli(dir, ['wait', '--page', '/other.html', '--timeout', '2'], { LAB_SETTLE_MS: '0' });
  assert.match(again, /second on other/, 'again: ' + again);
});

test('an agent answer that starts with "Done" closes its thread; another answer leaves it open; a person writing reopens it', async () => {
  const dir = site('autodone');
  const { B } = await lab(dir);
  const get = async (id) => (await (await fetch(B + '/_lab/api/comments?page=/index')).json()).comments.find((c) => c.id === id);
  const a = await pin(B, 'make it red');
  const q = await pin(B, 'nicer title');
  await cli(dir, ['reply', a, 'Done: made it red'], {});
  await cli(dir, ['reply', q, 'Which one, the h1 or the tab title?'], {});
  assert.equal((await get(a)).resolved, true);
  assert.equal(Boolean((await get(q)).resolved), false);
  await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', name: 'Leo', text: 'still orange', parent: a }) });
  assert.equal(Boolean((await get(a)).resolved), false, 'writing in it reopens it');
});

test('a "Done" answer leaves the thread open when several things are going on (two messages since, or a list)', async () => {
  const dir = site('autodone2');
  const { B } = await lab(dir);
  const get = async (id) => (await (await fetch(B + '/_lab/api/comments?page=/index')).json()).comments.find((c) => c.id === id);
  const say = (parent, text) => fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', name: 'Leo', text, parent }) });
  const two = await pin(B, 'make it red');
  await say(two, 'and bigger too');
  await cli(dir, ['reply', two, 'Done: red'], {});
  assert.equal(Boolean((await get(two)).resolved), false, 'two asks since the agent spoke');
  const list = await pin(B, '1) red title\n2) smaller logo');
  await cli(dir, ['reply', list, 'Done: the title is red'], {});
  assert.equal(Boolean((await get(list)).resolved), false, 'a list of asks');
});

test('reply --done / --on-it / --question store the intent; --done closes whatever the words; the state follows it', async () => {
  const dir = site('intent');
  const { B } = await lab(dir);
  const all = async () => (await (await fetch(B + '/_lab/api/comments?page=/index')).json()).comments;
  const get = async (id) => (await all()).find((c) => c.id === id);
  const list = await pin(B, '1) red title\n2) smaller logo');
  await cli(dir, ['reply', list, '--done', 'Both changed.'], {});
  const closed = await get(list);
  assert.equal(closed.resolved, true, 'the agent said done: closed, list or not');
  assert.equal(closed.resolvedBy, 'agent');
  assert.ok(closed.resolvedAt, 'and when');
  const answer = (await all()).find((c) => c.parent === list);
  assert.equal(answer.intent, 'done');
  assert.equal(answer.v, 2);
  assert.equal('resolved' in answer, false, 'a reply carries no resolved state');
  const q = await pin(B, 'nicer title');
  await cli(dir, ['reply', q, '--question', 'Done how, the h1 or the tab title?'], {});
  assert.equal(Boolean((await get(q)).resolved), false, 'a question stays open, whatever its first word');
  assert.equal((await all()).find((c) => c.parent === q).intent, 'question');
  const w = await pin(B, 'slower');
  await cli(dir, ['reply', w, '--on-it', 'Looking'], {});
  assert.equal((await all()).find((c) => c.parent === w).intent, 'working');
  const both = await cli(dir, ['reply', w, '--done', '--question', 'x'], {});
  assert.match(both, /one of --done, --on-it, --question/);
  // A person can't set an intent.
  await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', name: 'Leo', text: 'hm', parent: w, intent: 'done' }) });
  assert.equal((await all()).find((c) => c.parent === w && c.text === 'hm').intent, undefined);
});

test('labit resolve records the agent and when; reopening clears both', async () => {
  const dir = site('resolveby');
  const { B } = await lab(dir);
  const get = async (id) => (await (await fetch(B + '/_lab/api/comments?page=/index')).json()).comments.find((c) => c.id === id);
  const a = await pin(B, 'make it red');
  await cli(dir, ['resolve', a], {});
  const done = await get(a);
  assert.equal(done.resolvedBy, 'agent');
  assert.ok(Date.parse(done.resolvedAt) > 0);
  await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', name: 'Leo', text: 'still orange', parent: a }) });
  const open = await get(a);
  assert.equal(Boolean(open.resolved), false);
  assert.equal(open.resolvedBy, undefined);
  assert.equal(open.resolvedAt, undefined);
});
