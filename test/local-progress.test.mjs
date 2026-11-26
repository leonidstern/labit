// `labit reply --progress` against a real lab: the line on a thread, and when a pin with no sign of work comes back.
// Part of the local-mode tests (local.test.mjs), a file of its own so the two run side by side.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { LAB, site, claimPort, tmp, rm, spawnLab, sleep, up as answers, serverJson, cli as command } from './harness.mjs';

const { DIR, PORT, B } = site('test', 4600, 100);
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><title>t</title><h1 id="t">Hello</h1>');

const run = (args, opts = {}) => command(args, { cwd: DIR, ...opts });
const server = spawnLab(DIR, PORT, { env: { ...process.env, PORT } });
after(() => {
  server.kill();
  rm([DIR]);
});

const up = () => answers(B + '/', { tries: 50, fail: 'server did not start' });
const post = (body) =>
  fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify(body) }).then((r) => r.json());

// The lab's live stream (/_lab/live): the newest version of one counter in its first events. One read can hold more
// than one event (the lab sends the version, then a change straight after), or half of one, so whole events only.
const live = async (field) => {
  const ctl = new AbortController();
  const res = await fetch(B + '/_lab/live', { signal: ctl.signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes('\n\n')) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  ctl.abort();
  const events = text.split('\n\n').slice(0, -1).map((e) => e.replace(/^data: /, '').trim()).filter((e) => e.startsWith('{'));
  return JSON.parse(events.at(-1))[field];
};

test('the lab starts', async () => {
  await up();
});

// ---------- never stuck: labit reply --progress ----------
const threadsOf = async () => (await (await fetch(B + '/_lab/api/comments?page=/index')).json()).comments;
const pinFor = async (text) => (await post({ page: '/index', name: 'Leo', text, anchor: { selector: '#t', x: 0.1, y: 0.5, docX: 0.1, docY: 20, width: 1000, element: '<h1 id="t">' } })).comment.id;

test('reply --progress keeps one line on the thread, replaced each time, with its time; no message, nothing done', async () => {
  await up();
  const id = await pinFor('progress thread');
  const before = (await threadsOf()).length;
  const first = await run(['reply', id, '--progress', 'drawing W1–W6 · 1 of 4']);
  assert.equal(first.code, 0, first.out);
  assert.match(first.out, /Progress noted on \/index/);
  let c = (await threadsOf()).find((x) => x.id === id);
  assert.equal(c.progress.text, 'drawing W1–W6 · 1 of 4');
  assert.ok(Math.abs(Date.parse(c.progress.at) - Date.now()) < 15000, 'with the time it was said');
  assert.equal((await threadsOf()).length, before, 'no message bubble');
  assert.ok(!c.resolved, 'not done');
  await run(['reply', id, '--progress', 'drawing W1–W6 · 2 of 4']);
  c = (await threadsOf()).find((x) => x.id === id);
  assert.equal(c.progress.text, 'drawing W1–W6 · 2 of 4', 'the latest replaces the last');
  assert.equal((await threadsOf()).length, before);
  // The page is told: the lab's comments version moves, so open pages fetch the change.
  const rev = () => live('comments');
  // The version is read when the lab has been quiet for a moment (an earlier line's save and its notice may still be
  // landing), and the third line must move it on: by one, or by more when something else of the lab's lands too.
  let was = await rev();
  for (let i = 0; i < 20; i++) {
    await sleep(100);
    const now = await rev();
    if (now === was) break;
    was = now;
  }
  await run(['reply', id, '--progress', 'drawing W1–W6 · 3 of 4']);
  let now = await rev();
  for (let i = 0; i < 30 && now <= was; i++) {
    await sleep(100);
    now = await rev();
  }
  assert.ok(now > was, `the comments version moves on (was ${was}, now ${now})`);
});

test('a --progress line that is a raw command reaches the page as plain words, never the command', async () => {
  await up();
  const id = await pinFor('raw progress thread');
  const shown = async () => (await threadsOf()).find((x) => x.id === id).progress.text;
  await run(['reply', id, '--progress', "cat > src/page.html <<'EOF' <h1>Hi</h1> EOF"]);
  assert.equal(await shown(), 'editing a file');
  await run(['reply', id, '--progress', 'grep -rn heading /home/user/site/pages']);
  assert.equal(await shown(), 'reading the page');
  await run(['reply', id, '--progress', 'node scripts/build.mjs --watch']);
  assert.equal(await shown(), 'running a command');
});

test('an answer, a new message or resolving clears the progress line', async () => {
  await up();
  const get = async (id) => (await threadsOf()).find((x) => x.id === id);
  const a = await pinFor('cleared by an answer');
  await run(['reply', a, '--progress', 'working']);
  assert.ok((await get(a)).progress);
  await run(['reply', a, 'Here is the answer', '--on-it']);
  assert.equal((await get(a)).progress, undefined, 'a reply clears it, on-it too');
  const b = await pinFor('cleared by done');
  await run(['reply', b, '--progress', 'working']);
  await run(['reply', b, 'all done', '--done']);
  assert.equal((await get(b)).progress, undefined, '--done');
  assert.ok((await get(b)).resolved);
  const q = await pinFor('cleared by a question');
  await run(['reply', q, '--progress', 'working']);
  await run(['reply', q, 'green or red?', '--question']);
  assert.equal((await get(q)).progress, undefined, '--question');
  const p = await pinFor('cleared by the person');
  await run(['reply', p, '--progress', 'working']);
  await post({ page: '/index', name: 'Leo', text: 'actually blue', parent: p });
  assert.equal((await get(p)).progress, undefined, 'a person writing on the thread');
  const r = await pinFor('cleared by resolve');
  await run(['reply', r, '--progress', 'working']);
  await run(['resolve', r]);
  assert.equal((await get(r)).progress, undefined, 'resolving');
});

test('--progress takes only its line: no text, no answer flags, an id that exists, and only the agent may say it', async () => {
  await up();
  const id = await pinFor('progress refusals');
  assert.match((await run(['reply', id, '--progress'])).out, /Progress text is missing/);
  assert.match((await run(['reply', id, 'some words', '--progress', 'x'])).out, /--progress is only the line/);
  assert.match((await run(['reply', id, '--progress', 'x', '--done'])).out, /--progress is only the line/);
  assert.notEqual((await run(['reply', 'nope0000', '--progress', 'x'])).code, 0);
  const forged = await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', action: 'progress', id, text: 'from a page' }) });
  assert.equal(forged.status, 403, 'a page cannot write it');
  assert.equal((await threadsOf()).find((x) => x.id === id).progress, undefined);
  // A long line is cut, and one line (no breaks).
  await run(['reply', id, '--progress', `${'long '.repeat(60)}`]);
  assert.ok((await threadsOf()).find((x) => x.id === id).progress.text.length <= 120);
});

test('stale: a pin the agent said it is on, with no sign since, comes back in its next wait with how long and its last line', async () => {
  const dir = fs.realpathSync(tmp('stale'));
  const home = tmp('home');
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>t</title><h1 id="t">Hello</h1>');
  const port = String(claimPort(4810, 90));
  const env = { ...process.env, LABIT_HOME: home, LABIT_NO_UPDATE_CHECK: '1', PORT: '', LAB_REMIND_MS: '1500', LAB_SETTLE_MS: '0' };
  const lab = spawnLab(dir, port, { env });
  const base = `http://localhost:${port}`;
  const cli = (args) => new Promise((resolve) => execFile(process.execPath, [LAB, ...args], { cwd: dir, env }, (err, stdout, stderr) => resolve(stdout + stderr)));
  try {
    await answers(base + '/', { tries: 50, fail: false });
    const { comment } = await (await fetch(base + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ page: '/index', name: 'Leo', text: 'make it red', anchor: { selector: '#t', x: 0.1, y: 0.5, docX: 0.1, docY: 20, width: 1000, element: '<h1 id="t">' } }) })).json();
    assert.match(await cli(['wait', '--timeout', '5']), new RegExp(comment.id), 'handed over');
    await cli(['reply', comment.id, 'On it', '--on-it']);
    await cli(['reply', comment.id, '--progress', 'drawing 2 of 4']);
    assert.doesNotMatch(await cli(['wait', '--timeout', '1']), /Still waiting/, 'a sign just now: nothing to remind of');
    await sleep(1800);
    const out = await cli(['wait', '--timeout', '3']);
    assert.match(out, /^# Still waiting for your answer/m);
    assert.match(out, new RegExp(`id ${comment.id} "make it red" · no sign for 0 min, last: drawing 2 of 4`));
    assert.match(out, /1 still waiting/);
    assert.doesNotMatch(await cli(['wait', '--timeout', '1']), /Still waiting/, 'once, not on every wait (10 minutes between)');
    // An answered thread (a plain reply, not on-it) is not stale however long it is quiet.
    const done = (await (await fetch(base + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ page: '/index', name: 'Leo', text: 'and bigger', anchor: { selector: '#t', x: 0.1, y: 0.5, docX: 0.1, docY: 20, width: 1000, element: '<h1 id="t">' } }) })).json()).comment.id;
    assert.match(await cli(['wait', '--timeout', '5']), new RegExp(done));
    await cli(['reply', done, 'Bigger now']);
    await sleep(1800);
    assert.doesNotMatch(await cli(['wait', '--timeout', '1']), /Still waiting/, 'a plain answer ends the wait for it');
  } finally {
    lab.kill();
    rm([dir, home]);
  }
});

// A progress line counts as a sign of work, whoever wrote it: the agent (labit reply --progress) or the plugin's hook
// (a POST with the agent key and no session). The "no sign" clock restarts at it, for as long as the line is renewed.
test('stale: a progress line, the agent\'s or the hook\'s, is a sign of work: no reminder while it is newer than the window', async () => {
  const dir = fs.realpathSync(tmp('stale-progress'));
  const home = tmp('home');
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>t</title><h1 id="t">Hello</h1>');
  const port = String(claimPort(4810, 90));
  const env = { ...process.env, LABIT_HOME: home, LABIT_NO_UPDATE_CHECK: '1', PORT: '', LAB_REMIND_MS: '2000', LAB_SETTLE_MS: '0' };
  const lab = spawnLab(dir, port, { env });
  const base = `http://localhost:${port}`;
  const cli = (args) => new Promise((resolve) => execFile(process.execPath, [LAB, ...args], { cwd: dir, env }, (err, stdout, stderr) => resolve(stdout + stderr)));
  const anchor = { selector: '#t', x: 0.1, y: 0.5, docX: 0.1, docY: 20, width: 1000, element: '<h1 id="t">' };
  const pin = async (text) => (await (await fetch(base + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ page: '/index', name: 'Leo', text, anchor }) })).json()).comment.id;
  // What the plugin's hook sends: the agent's key, no session.
  const hook = (id, text) => fetch(base + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', host: `localhost:${port}`, 'x-lab-admin': serverJson(dir).agent, 'x-lab-agent': '1' }, body: JSON.stringify({ page: '/index', action: 'progress', id, text }) });
  try {
    await answers(base + '/', { tries: 50, fail: false });
    const id = await pin('make it red');
    assert.match(await cli(['wait', '--timeout', '5']), new RegExp(id), 'handed over');
    // No on-it, no reply: only the hook's lines, each newer than the window when the next wait looks.
    await sleep(1500);
    assert.equal((await hook(id, 'helper: build the page')).status, 200);
    await sleep(1500); // 3 s since the hand-off, 1.5 s since the line
    assert.doesNotMatch(await cli(['wait', '--timeout', '1']), /Still waiting/, 'the hook line is a sign');
    await sleep(1000);
    assert.equal((await hook(id, 'running npm test')).status, 200);
    await sleep(1500);
    assert.doesNotMatch(await cli(['wait', '--timeout', '1']), /Still waiting/, 'a second line, again within the window');
    // Truly no sign for longer than the window: the reminder, with how long and the last line.
    await sleep(2300);
    const out = await cli(['wait', '--timeout', '3']);
    assert.match(out, /^# Still waiting for your answer/m);
    assert.match(out, new RegExp(`id ${id} "make it red" · no sign for 0 min, last: running npm test`));
  } finally {
    lab.kill();
    rm([dir, home]);
  }
});

test('a progress line that is not renewed lapses: it stops counting as a sign (the reminder comes as if it was never there), and /_lab/pending lists only pins somebody claimed', async () => {
  const dir = fs.realpathSync(tmp('lapse'));
  const home = tmp('home');
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>t</title><h1 id="t">Hello</h1>');
  const port = String(claimPort(4810, 90));
  const env = { ...process.env, LABIT_HOME: home, LABIT_NO_UPDATE_CHECK: '1', PORT: '', LAB_REMIND_MS: '2000', LAB_PROGRESS_MS: '500', LAB_SETTLE_MS: '0' };
  const lab = spawnLab(dir, port, { env });
  const base = `http://localhost:${port}`;
  const cli = (args) => new Promise((resolve) => execFile(process.execPath, [LAB, ...args], { cwd: dir, env }, (err, stdout, stderr) => resolve(stdout + stderr)));
  const anchor = { selector: '#t', x: 0.1, y: 0.5, docX: 0.1, docY: 20, width: 1000, element: '<h1 id="t">' };
  const pin = async (text) => (await (await fetch(base + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ page: '/index', name: 'Leo', text, anchor }) })).json()).comment.id;
  const working = async () => (await (await fetch(base + '/_lab/pending', { headers: { host: `localhost:${port}`, 'x-lab-admin': serverJson(dir).agent, 'x-lab-agent': '1' } })).json()).working.map((w) => w.id);
  try {
    await answers(base + '/', { tries: 50, fail: false });
    const id = await pin('make it red');
    assert.match(await cli(['wait', '--timeout', '5']), new RegExp(id), 'handed over');
    assert.deepEqual(await working(), [], 'nobody said anything on it: not listed, so the plugin adds no line');
    await sleep(1500);
    await cli(['reply', id, '--progress', 'building']); // 1.5 s after the hand-off: a sign, for 0.5 s
    assert.deepEqual(await working(), [id], 'a claimed pin is listed');
    await sleep(800); // 2.3 s since the hand-off, 0.8 s since the line: it lapsed, so the hand-off's own time counts
    const out = await cli(['wait', '--timeout', '3']);
    assert.match(out, /^# Still waiting for your answer/m, 'a lapsed line does not hold the reminder back');
    assert.match(out, new RegExp(`id ${id} "make it red" · no sign for 0 min, last: building`));
  } finally {
    lab.kill();
    rm([dir, home]);
  }
});
