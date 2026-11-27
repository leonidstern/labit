// The agent's side at the edges, through the real commands: two sessions answering one pin at once, answers to a
// thread that is gone, a delete racing a reply, a wait with nothing and with 150 pins, a wait killed in the middle,
// two waits at once, odd words in a reply, and commands run where the lab's own file is damaged. No browser.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LAB = fileURLToPath(new URL('../local.mjs', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (n) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `labit-edge-${n}-`)));
const freePort = () => new Promise((done) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)); }); });
const ENV = { ...process.env, LABIT_HOME: tmp('home'), LABIT_NO_UPDATE_CHECK: '1', LABIT_IDLE_MS: '0', LAB_SETTLE_MS: '100', LAB_COMMENTS_PER_HOUR: '100000', PORT: '',
  CLAUDE_CODE_SESSION_ID: '', CLAUDE_CODE_REMOTE_SESSION_ID: '', CODEX_THREAD_ID: '', AMP_CURRENT_THREAD_ID: '', LAB_SESSION_NAME: '', LAB_AGENT: '', LAB_AGENT_NAME: '', LABIT_BACKGROUND: '' };
const labs = [];
const dirs = [];
const raw = (port, p, { method = 'GET', headers = {}, body } = {}) =>
  new Promise((done) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host: `localhost:${port}`, ...headers } }, (res) => {
      const parts = [];
      res.on('data', (d) => parts.push(d));
      res.on('error', (e) => done({ status: 0, text: String(e), json: null, headers: {} })); // cut after the headers
      res.on('end', () => {
        const text = Buffer.concat(parts).toString();
        let json = null;
        try { json = JSON.parse(text); } catch {}
        done({ status: res.statusCode, text, json, headers: res.headers });
      });
    });
    req.on('error', (e) => done({ status: 0, text: String(e), json: null, headers: {} }));
    req.end(body);
  });
const startLab = async (name) => {
  const dir = tmp(name);
  dirs.push(dir);
  for (const n of ['index', 'other', 'third']) fs.writeFileSync(path.join(dir, `${n}.html`), `<!doctype html><title>${n}</title><h1>${n}</h1>`);
  const port = await freePort();
  let out = '';
  const proc = spawn(process.execPath, [LAB, '.', '--no-open', '--port', String(port)], { cwd: dir, env: ENV });
  proc.stdout.on('data', (d) => (out += d));
  proc.stderr.on('data', (d) => (out += d));
  const lab = { proc, port, dir, B: `http://localhost:${port}`, out: () => out, keys: () => JSON.parse(fs.readFileSync(path.join(dir, '.lab/server.json'), 'utf8')),
    stop: () => new Promise((r) => (proc.exitCode !== null || proc.signalCode ? r() : (proc.once('exit', r), proc.kill()))) };
  labs.push(lab);
  for (let i = 0; i < 100 && proc.exitCode === null; i++) {
    if ((await raw(port, '/_lab/state')).status === 200) return lab;
    await sleep(100);
  }
  throw new Error(`the lab did not start: ${out}`);
};
const running = [];
after(async () => {
  for (const p of running) p.kill('SIGKILL');
  for (const l of labs) await l.stop();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 });
  fs.rmSync(ENV.LABIT_HOME, { recursive: true, force: true, maxRetries: 5 });
});
// A labit command as session `who` runs it, in the lab's folder: its exit code and everything it printed.
const cli = (lab, who, ...args) => {
  let proc;
  const done = new Promise((resolve) => {
    proc = execFile(process.execPath, [LAB, ...args], { cwd: lab.dir ?? lab, env: { ...ENV, CLAUDE_CODE_SESSION_ID: who }, maxBuffer: 32e6 }, (err, stdout, stderr) => resolve({ code: err ? (err.code ?? `signal ${err.signal}`) : 0, out: stdout + stderr }));
  });
  running.push(proc);
  return Object.assign(done, { proc });
};
const send = (lab, body, headers = {}) => raw(lab.port, '/_lab/api/comments', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', origin: lab.B, ...headers } });
const pin = async (lab, page, text) => (await send(lab, { page, name: 'Leo', text, anchor: { selector: 'h1', x: 0.5, y: 0.5 } })).json.comment;
const list = async (lab, page) => (await raw(lab.port, `/_lab/api/comments?page=${page}`)).json.comments;
const owner = (lab) => ({ 'x-lab-admin': lab.keys().token });
const asAgent = (lab, who = 'http') => ({ 'x-lab-admin': lab.keys().agent, 'x-lab-agent': '1', 'x-lab-session': encodeURIComponent(JSON.stringify({ id: who, name: who })) });
const pending = async (lab) => (await raw(lab.port, '/_lab/pending', { headers: asAgent(lab) })).json;
// The store's file for a page has this comment (the commands read the files, written a moment after the answer).
const saved = async (lab, id) => {
  for (let i = 0; i < 60; i++) {
    const dir = path.join(lab.dir, '.lab/comments');
    if (fs.readdirSync(dir).some((n) => n.endsWith('.json') && fs.readFileSync(path.join(dir, n), 'utf8').includes(`"${id}"`))) return;
    await sleep(50);
  }
  assert.fail(`${id} never reached the store`);
};
const noStack = (out) => assert.doesNotMatch(out, /\n\s+at .+\(.+:\d+:\d+\)|node:internal|TypeError|SyntaxError|ReferenceError/, out.slice(0, 400));

const lab = await startLab('sessions');

test('two sessions answer the same pin at the same moment: both answers are kept, each with its session, and the thread closes once', async () => {
  const p = await pin(lab, '/index', 'who takes this?');
  await saved(lab, p.id);
  const [a, b] = await Promise.all([cli(lab, 'sess-a', 'reply', p.id, 'Done by A', '--done'), cli(lab, 'sess-b', 'reply', p.id, 'Done by B', '--done')]);
  assert.deepEqual([a.code, b.code], [0, 0], a.out + b.out);
  const all = await list(lab, '/index');
  const replies = all.filter((c) => c.parent === p.id);
  // Each answer with the session that sent it, as pairs: sorted apart, swapped names would pass.
  assert.deepEqual(replies.map((c) => [c.text, c.session?.id]).sort(), [['Done by A', 'sess-a'], ['Done by B', 'sess-b']]);
  assert.equal(new Set(replies.map((c) => c.id)).size, 2);
  const thread = all.find((c) => c.id === p.id);
  assert.deepEqual([thread.resolved, thread.resolvedBy], [true, 'agent']);
  // The person writes again (reopens); one session resolves while the other says it is on it.
  await send(lab, { page: '/index', parent: p.id, name: 'Leo', text: 'not quite' });
  assert.equal((await list(lab, '/index')).find((c) => c.id === p.id).resolved, false);
  await sleep(150);
  const [c, d] = await Promise.all([cli(lab, 'sess-a', 'resolve', p.id), cli(lab, 'sess-b', 'reply', p.id, 'Looking again', '--on-it')]);
  assert.deepEqual([c.code, d.code], [0, 0], c.out + d.out);
  const after = await list(lab, '/index');
  assert.equal(after.find((x) => x.id === p.id).resolved, true, 'an agent\'s word does not reopen what an agent closed');
  assert.equal(after.filter((x) => x.parent === p.id && x.text === 'Looking again' && x.intent === 'working').length, 1);
});

test('the same words from one session twice at once are one answer; from two sessions they are two', async () => {
  const p = await pin(lab, '/index', 'say it once');
  await saved(lab, p.id);
  const got = await Promise.all([cli(lab, 'sess-a', 'reply', p.id, 'Fixed.'), cli(lab, 'sess-a', 'reply', p.id, 'Fixed.'), cli(lab, 'sess-a', 'reply', p.id, 'Fixed.'), cli(lab, 'sess-b', 'reply', p.id, 'Fixed.')]);
  assert.deepEqual(got.map((g) => g.code), [0, 0, 0, 0], got.map((g) => g.out).join(''));
  const replies = (await list(lab, '/index')).filter((c) => c.parent === p.id);
  assert.deepEqual(replies.map((c) => c.session.id).sort(), ['sess-a', 'sess-b']);
});

test('an answer to a thread that was deleted is dropped with a plain word, and leaves nothing behind', async () => {
  const p = await pin(lab, '/other', 'soon gone');
  const reply = (await send(lab, { page: '/other', parent: p.id, name: 'Leo', text: 'and its reply' })).json.comment;
  await saved(lab, reply.id);
  assert.equal((await send(lab, { page: '/other', action: 'delete', id: p.id }, owner(lab))).status, 200);
  await sleep(300);
  for (const args of [['reply', p.id, 'Done.'], ['reply', reply.id, 'Done.'], ['resolve', p.id], ['reply', p.id, '--progress', 'on it']]) {
    const r = await cli(lab, 'sess-a', ...args);
    assert.equal(r.code, 0, `${args.join(' ')}: ${r.out}`);
    assert.match(r.out, /Dropped: the person deleted that pin/);
    noStack(r.out);
  }
  // The same over the API, where the command's own look at the files can't stop it.
  for (const parent of [p.id, reply.id]) assert.equal((await send(lab, { page: '/other', parent, name: 'Claude', text: 'Done.' }, asAgent(lab))).status, 410);
  assert.equal((await send(lab, { page: '/other', action: 'resolve', id: p.id }, asAgent(lab))).status, 410);
  assert.deepEqual(await list(lab, '/other'), []);
});

test('a delete racing a reply, 40 times: no reply is ever left without its thread, and the lab never answers 500', async () => {
  const codes = new Set();
  const roots = [];
  for (let i = 0; i < 40; i++) {
    const p = await pin(lab, '/third', `race ${i}`);
    roots.push(p.id);
    const [leo, del, claude] = await Promise.all([
      send(lab, { page: '/third', parent: p.id, name: 'Leo', text: `reply ${i}` }),
      send(lab, { page: '/third', action: 'delete', id: p.id }, owner(lab)),
      send(lab, { page: '/third', parent: p.id, name: 'Claude', text: `Done ${i}`, intent: 'done' }, asAgent(lab, 'racer')),
    ]);
    assert.equal(del.status, 200, `race ${i}: the delete went through (${del.text.slice(0, 120)})`);
    for (const r of [leo, claude]) codes.add(r.status);
  }
  assert.ok([...codes].every((c) => [201, 404, 410].includes(c)), [...codes].join(' ')); // 410: the agent's answer after the delete, dropped
  const left = await list(lab, '/third');
  const ids = new Set(left.map((c) => c.id));
  assert.deepEqual(left.filter((c) => c.parent && !ids.has(c.parent)).map((c) => c.text), [], 'replies whose thread is gone');
  assert.deepEqual(left.filter((c) => roots.includes(c.id) || roots.includes(c.parent)).map((c) => c.text), [], 'every raced thread is gone, replies and all');
  assert.equal((await raw(lab.port, '/_lab/agent/third')).status, 200);
});

test('commands that name nothing, or something that is not there, say so in a line and exit 1', async () => {
  const p = await pin(lab, '/index', 'for the odd commands');
  await saved(lab, p.id);
  for (const [args, said] of [
    [['reply'], /No open comment/], [['reply', 'nosuchid00000', 'x'], /No open comment/], [['reply', '99999', 'x'], /No open comment/], [['reply', '0', 'x'], /No open comment/],
    [['reply', '-1', 'x'], /No open comment|Unknown option/], [['reply', '__proto__', 'x'], /No open comment|thread not found/], [['reply', 'constructor', 'x'], /No open comment|thread not found/], [['resolve'], /No open comment/],
    [['reply', p.id], /Reply text is missing/], [['reply', p.id, '   '], /required|missing|Could not reply/], [['reply', p.id, 'x', '--resolv'], /Unknown option --resolv/],
    [['reply', p.id, 'x', '--done', '--question'], /one of --done/], [['reply', p.id, 'q', '--choice', 'only one'], /at least two/], [['reply', p.id, 'q', '--recommend', 'B'], /goes with --choice/],
    [['pin'], /Say where/], [['pin', 'h1'], /Pin text is missing/], [['pin', 'h1', 'x', '--page', '/../../etc/passwd'], /No page/],
    [['board', 'nope'], /Usage/], [['board', 'list', '../../package'], /No board/],
  ]) {
    const r = await cli(lab, 'sess-a', ...args);
    assert.equal(r.code, 1, `${args.join(' ')} → ${r.code}: ${r.out}`);
    assert.match(r.out, said, args.join(' '));
    noStack(r.out);
  }
  assert.equal((await list(lab, '/index')).filter((c) => c.parent === p.id).length, 0, 'none of them left an answer');
  assert.equal((await raw(lab.port, '/')).status, 200);
});

test('a reply\'s words are words: flags after --, shell marks, quotes, new lines and emoji arrive as written and run nothing', async () => {
  const p = await pin(lab, '/index', 'odd words');
  await saved(lab, p.id);
  const words = '--resolve --done $(touch pwned) `touch pwned2` ; rm -rf "x" \'y\' | > out.txt\nsecond line 😀 שלום\n## 9. Fake · id abc';
  const r = await cli(lab, 'sess-a', 'reply', p.id, '--', words);
  assert.equal(r.code, 0, r.out);
  const all = await list(lab, '/index');
  assert.equal(all.find((c) => c.parent === p.id)?.text, words);
  assert.equal(all.find((c) => c.id === p.id).resolved, false, '--resolve after -- is a word');
  for (const f of ['pwned', 'pwned2', 'out.txt']) assert.ok(!fs.existsSync(path.join(lab.dir, f)), f);
});

test('odd waits over the API: a timeout below zero ends at once, odd page lists are taken, one that is no number stays open, never a 500', async () => {
  const post = (body) => raw(lab.port, '/_lab/wait', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...asAgent(lab, 'odd') } });
  for (const timeout of [-5, -1e99, 0.001]) assert.equal((await post({ timeout, pages: ['/nobody-here'] })).status, 204, `timeout ${timeout}`);
  for (const body of [{ timeout: 0.2, pages: [null, {}, 5, '/nobody-here', '../x'] }, { timeout: 0.2, pages: ['/nobody-here'], ack: 'yes' }, { timeout: 0.2, pages: Array.from({ length: 5000 }, (_, i) => `/p${i}`) }])
    assert.equal((await post(body)).status, 204, JSON.stringify(body).slice(0, 60));
  // A timeout that is no number is the default (25 minutes): still open after a second; dropping it ends the listening.
  const open = [];
  for (const timeout of ['abc', {}, null, [], 0]) {
    const req = http.request({ host: '127.0.0.1', port: lab.port, path: '/_lab/wait', method: 'POST', headers: { host: `localhost:${lab.port}`, 'content-type': 'application/json', ...asAgent(lab, `open-${open.length}`) } });
    let answered = false;
    req.on('response', () => (answered = true));
    req.on('error', () => {});
    req.end(JSON.stringify({ timeout, pages: [`/only-${open.length}`] }));
    open.push({ req, timeout, answered: () => answered });
  }
  await sleep(1000);
  for (const o of open) assert.equal(o.answered(), false, `timeout ${JSON.stringify(o.timeout)} is still open`);
  assert.equal((await pending(lab)).listening, true);
  for (const o of open) o.req.destroy();
  await sleep(300);
  assert.equal((await pending(lab)).listening, false, 'dropped waits are gone');
  assert.equal(JSON.parse((await raw(lab.port, '/_lab/state')).text).mode, 'away');
  assert.equal((await raw(lab.port, '/')).status, 200);
});

// ---------- waits ----------
const W = await startLab('waits');
const wait = (who, ...more) => cli(W, who, 'wait', '--bg', ...more);

test('a wait with nothing to hear ends on time, says so and exits 0', async () => {
  const t = Date.now();
  const r = await wait('sess-a', '--timeout', '1');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^No new comments yet\. Run wait again to keep listening\.\s*$/);
  assert.ok(Date.now() - t < 5000);
  assert.equal(JSON.parse((await raw(W.port, '/_lab/state')).text).session?.id, 'sess-a', 'the lab knows who listened');
});

test('a wait with 150 pins on three pages gets every one, once, and says how many; the next wait gets none', async () => {
  const ids = [];
  for (let i = 0; i < 150; i++) ids.push((await pin(W, ['/index', '/other', '/third'][i % 3], `pin number ${i} of 150`)).id);
  const r = await wait('sess-many', '--timeout', '10');
  assert.equal(r.code, 0, r.out.slice(0, 300));
  assert.ok(/(^|\n\n)In this message: 150 new\./.test(r.out.slice(0, 400)), r.out.slice(0, 300));
  for (const id of ids) assert.equal(r.out.split(`· id ${id}\n`).length - 1, 1, `${id} is in it once`);
  for (let i = 0; i < 150; i += 37) assert.ok(r.out.includes(`comment: pin number ${i} of 150`));
  const again = await wait('sess-many', '--timeout', '1');
  assert.match(again.out, /^No new comments yet/);
  const other = await wait('sess-other', '--timeout', '1');
  assert.match(other.out, /No new comments yet/, 'nor does another session get them a second time');
  for (const page of ['/index', '/other', '/third']) assert.ok((await list(W, page)).every((c) => c.handedAt), `${page}: all marked as handed over`);
  // Answered in one go by id: 150 resolves, none lost.
  for (const page of ['/index', '/other', '/third']) await Promise.all((await list(W, page)).map((c) => send(W, { page, action: 'resolve', id: c.id }, asAgent(W, 'sess-many'))));
  for (const page of ['/index', '/other', '/third']) assert.ok((await list(W, page)).every((c) => c.resolved));
});

test('a wait killed in the middle: the lab sees it go, and the pin made after reaches the next wait, once', async () => {
  const w = wait('sess-k', '--timeout', '60');
  for (let i = 0; i < 40 && !(await pending(W)).listening; i++) await sleep(50);
  assert.equal((await pending(W)).listening, true);
  w.proc.kill('SIGKILL');
  assert.match(String((await w).code), /signal SIGKILL|null|137/);
  for (let i = 0; i < 40 && (await pending(W)).listening; i++) await sleep(50);
  assert.equal((await pending(W)).listening, false, 'no wait is open any more');
  const p = await pin(W, '/index', 'made after the kill');
  assert.equal((await pending(W)).fresh, 1, 'it waits, handed to nobody');
  const next = await wait('sess-k', '--timeout', '5');
  assert.ok(next.out.includes(`· id ${p.id}`), next.out.slice(0, 300));
  assert.match((await wait('sess-k', '--timeout', '1')).out, /No new comments yet/);
});

test('a wait killed while its pin is on the way: nothing is lost, the pin goes out again', async () => {
  // The pin is posted and the wait killed in the same moment, 8 times: wherever the kill lands, the pin ends with a session.
  for (let i = 0; i < 8; i++) {
    const w = wait(`sess-kill-${i}`, '--timeout', '60');
    for (let n = 0; n < 40 && !(await pending(W)).listening; n++) await sleep(50);
    const p = await pin(W, '/other', `in flight ${i}`);
    await sleep(60 + i * 15); // around the 100 ms the lab lets pins settle
    w.proc.kill('SIGKILL');
    const first = await w;
    let got = first.out.includes(`· id ${p.id}`);
    // Not printed by the killed one: the same session's next wait has it (at once, or after the unconfirmed hand-off is taken back).
    for (let n = 0; n < 3 && !got; n++) got = (await wait(`sess-kill-${i}`, '--timeout', '3')).out.includes(`· id ${p.id}`);
    assert.ok(got, `round ${i}: the pin reached a wait that lived to print it`);
  }
});

test('two waits at once: a second session asking for every page is told to name its pages; the open wait keeps them and gets the pin', async () => {
  const a = wait('sess-a', '--timeout', '30');
  await sleep(500);
  const b = await wait('sess-b', '--timeout', '30');
  assert.match(b.out, /^Claude \(session sess-a\) already listens on every page of this lab, so this wait did not start/);
  assert.match(b.out, /wait --bg --pages /);
  const p = await pin(W, '/index', 'for whoever listens');
  const first = await a;
  assert.equal(first.code, 0, first.out);
  assert.equal(first.out.split(`· id ${p.id}\n`).length - 1, 1, first.out.slice(0, 200));
  // With --pages, the second session listens beside the first.
  const mine = wait('sess-b', '--pages', '/b-only', '--timeout', '2'); // a page of its own (a claim holds after the wait)
  const rest = wait('sess-a', '--timeout', '2');
  assert.doesNotMatch((await mine).out + (await rest).out, /already listens|Another session is listening/);
  // The first session's wait ended: the next session's wait on every page starts, and the one after it is told.
  const c = wait('sess-d', '--timeout', '2');
  await sleep(500);
  assert.match((await wait('sess-e', '--timeout', '1')).out, /already listens on every page/);
  await c;
  // Pins earlier tests left in flight come back on their own clock: taken now, so the next part sees only its own.
  for (let i = 0; i < 5 && !/No new comments yet/.test((await wait('sess-c', '--timeout', '1')).out); i++);
  // Started in the same instant by one session: one of them ends up with the pin, the other is told it was replaced.
  const both = [wait('sess-c', '--timeout', '30'), wait('sess-c', '--timeout', '30')];
  await sleep(700);
  const q = await pin(W, '/index', 'for one of two');
  const outs = await Promise.all(both);
  assert.deepEqual(outs.map((o) => o.code), [0, 0]);
  assert.equal(outs.filter((o) => o.out.includes(`· id ${q.id}`)).length, 1, outs.map((o) => o.out.slice(0, 80)).join(' | '));
  assert.equal(outs.filter((o) => /^Another session is listening/.test(o.out)).length, 1);
  assert.match((await wait('sess-c', '--timeout', '1')).out, /No new comments yet/);
});

test('a command where there is no lab, a lab that is gone, or a damaged server.json: one plain line, exit 1', async () => {
  const empty = tmp('nolab');
  dirs.push(empty);
  for (const args of [['wait', '--timeout', '1'], ['reply', 'abc', 'x'], ['resolve', 'abc'], ['pin', 'h1', 'x'], ['invite'], ['board', 'list']]) {
    const r = await cli(empty, 'sess-a', ...args);
    assert.equal(r.code, 1, args.join(' '));
    assert.match(r.out, /^No lab server for this folder\. Start one: /);
    noStack(r.out);
  }
  // A lab that crashed leaves its file behind: its process is gone, so it is not a lab.
  fs.mkdirSync(path.join(empty, '.lab'));
  fs.writeFileSync(path.join(empty, '.lab/server.json'), JSON.stringify({ port: 9, pid: 2 ** 22 + 12345, token: 'x'.repeat(24), agent: 'y'.repeat(32) }));
  const gone = await cli(empty, 'sess-a', 'wait', '--timeout', '1');
  assert.equal(gone.code, 1);
  assert.match(gone.out, /^No lab server for this folder/);
  // A server.json cut short (a full disk, a crash while it was written) or holding something else.
  const bad = [];
  for (const text of ['{"port": 44', '', 'null', '[]', '"x"', '{"port":"x","pid":"y"}']) {
    fs.writeFileSync(path.join(empty, '.lab/server.json'), text);
    // (a wait on a file that parses but names no lab holds on for 20 s before it gives up: only the reply there)
    for (const args of [['wait', '--timeout', '1'], ['reply', 'abc', 'x']].slice(/^(\[\]|"x"|\{"port":"x")/.test(text) ? 1 : 0)) {
      const r = await cli(empty, 'sess-a', ...args);
      if (r.code !== 1 || /\n\s+at .+:\d+:\d+|SyntaxError|TypeError/.test(r.out)) bad.push(`server.json ${JSON.stringify(text)}, ${args[0]} → exit ${r.code}: ${r.out.split('\n').find((l) => /Error/.test(l)) || r.out.slice(0, 80)}`);
    }
  }
  assert.deepEqual(bad, []);
});
