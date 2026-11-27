// Many writes at the same moment on a local lab: 50 pins at once (none lost, every id once, in the list, the file and
// the delta), 50 replies while their thread is resolved and reopened, moves and resolves mixed in, a wait open through
// it, 60 pages listening, and a lab killed (SIGKILL) right after its last answer. No browser.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { liveState, sseReader } from './harness.mjs';

const LAB = fileURLToPath(new URL('../local.mjs', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (n) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `labit-edge-${n}-`)));
const freePort = () => new Promise((done) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)); }); });
const ENV = { ...process.env, LABIT_HOME: tmp('home'), LABIT_NO_UPDATE_CHECK: '1', LABIT_IDLE_MS: '0', LAB_SETTLE_MS: '300', LAB_COMMENTS_PER_HOUR: '100000', PORT: '' };
const labs = [];
// One connection per request, as 50 tabs would have (the default agent would queue them on a few sockets).
const raw = (port, p, { method = 'GET', headers = {}, body, signal } = {}) =>
  new Promise((done) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, agent: false, signal, headers: { host: `localhost:${port}`, ...headers } }, (res) => {
      const parts = [];
      res.on('data', (d) => parts.push(d));
      res.on('error', (e) => done({ status: 0, text: String(e), json: null, headers: {} })); // cut after the headers
      res.on('end', () => {
        const bytes = Buffer.concat(parts);
        const text = bytes.toString();
        let json = null;
        try { json = JSON.parse(text); } catch {}
        done({ status: res.statusCode, text, json, bytes, headers: res.headers });
      });
    });
    req.on('error', (e) => done({ status: 0, text: String(e), json: null, headers: {} }));
    req.end(body);
  });
// A list read as sent: Brotli when the answer says so.
const listOf = (r) => JSON.parse((r.headers['content-encoding'] === 'br' ? zlib.brotliDecompressSync(r.bytes) : r.bytes).toString());
const DIR = tmp('many');
for (const n of ['index', 'p1', 'p2', 'p3', 'p4', 'p5', 'nums', 'kill']) fs.writeFileSync(path.join(DIR, `${n}.html`), `<!doctype html><title>${n}</title><h1>${n}</h1>`);
const PORT = await freePort();
const startLab = async () => {
  let out = '';
  const proc = spawn(process.execPath, [LAB, '.', '--no-open', '--port', String(PORT)], { cwd: DIR, env: ENV });
  proc.stdout.on('data', (d) => (out += d));
  proc.stderr.on('data', (d) => (out += d));
  const lab = { proc, B: `http://localhost:${PORT}`, out: () => out, keys: () => JSON.parse(fs.readFileSync(path.join(DIR, '.lab/server.json'), 'utf8')),
    stop: (sig) => new Promise((r) => (proc.exitCode !== null || proc.signalCode ? r() : (proc.once('exit', r), proc.kill(sig)))) };
  labs.push(lab);
  for (let i = 0; i < 100 && proc.exitCode === null; i++) {
    if ((await raw(PORT, '/_lab/pages')).status === 200) return lab;
    await sleep(100);
  }
  throw new Error(`the lab did not start: ${out}`);
};
after(async () => {
  for (const l of labs) await l.stop();
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
  fs.rmSync(ENV.LABIT_HOME, { recursive: true, force: true, maxRetries: 5 });
});
let lab = await startLab();
const send = (body, headers = {}) => raw(PORT, '/_lab/api/comments', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', origin: lab.B, ...headers } });
const pin = (page, text) => send({ page, name: 'Leo', text, anchor: { selector: 'h1', x: 0.5, y: 0.5 } });
const list = async (page) => (await raw(PORT, `/_lab/api/comments?page=${page}`)).json.comments;
const owner = () => ({ 'x-lab-admin': lab.keys().token });
const asAgent = (who = 'sess-many') => ({ 'x-lab-admin': lab.keys().agent, 'x-lab-agent': '1', 'x-lab-session': encodeURIComponent(JSON.stringify({ id: who, name: who })) });
const inFiles = () => {
  const all = {};
  for (const n of fs.readdirSync(path.join(DIR, '.lab/comments')).filter((x) => x.endsWith('.json'))) {
    const f = JSON.parse(fs.readFileSync(path.join(DIR, '.lab/comments', n), 'utf8'));
    all[f.page] = f.comments;
  }
  return all;
};
const settled = async (page, n) => {
  for (let i = 0; i < 60; i++) {
    if (Object.keys(inFiles()[page] || {}).length >= n) return;
    await sleep(50);
  }
};

test('50 pins sent at the same moment to one page: 50 answers, 50 ids, all in the list, the file, the delta and comments.md', async () => {
  // A change first (on another page), so the revision below is in the change log and the lab can answer with a delta.
  assert.equal((await pin('/kill', 'before the burst')).status, 201);
  const rev0 = (await liveState(`http://localhost:${PORT}`)).comments;
  const got = await Promise.all(Array.from({ length: 50 }, (_, i) => pin('/index', `at once ${i}`)));
  assert.deepEqual([...new Set(got.map((r) => r.status))], [201]);
  const ids = got.map((r) => r.json.comment.id);
  assert.equal(new Set(ids).size, 50, 'every id once');
  assert.equal(new Set(got.map((r) => r.json.edit)).size, 50, 'every key once');
  const listed = await list('/index');
  assert.deepEqual(listed.map((c) => c.id).sort(), [...ids].sort());
  assert.deepEqual(listed.map((c) => c.text).sort(), Array.from({ length: 50 }, (_, i) => `at once ${i}`).sort());
  await settled('/index', 50);
  assert.deepEqual(Object.keys(inFiles()['/index']).sort(), [...ids].sort(), 'the file has them all');
  const delta = (await raw(PORT, `/_lab/api/changes?page=/index&since=${rev0}`)).json;
  assert.ok(!delta.full, 'a delta, not "pull the whole list"');
  assert.deepEqual(delta.set.map((c) => c.id).sort(), [...ids].sort(), 'a page that pulls only what changed gets all 50');
  const md = fs.readFileSync(path.join(DIR, '.lab/comments.md'), 'utf8');
  for (const id of ids) assert.ok(md.includes(`· id ${id}`), `comments.md has ${id}`);
  assert.equal((await raw(PORT, '/_lab/pages')).json.pages.find((p) => p.path === '/index').open, 50);
});

test('pins made at the same moment each get their own number, and a resolved pin\'s number is not given again', async () => {
  const first = await Promise.all(Array.from({ length: 20 }, (_, i) => pin('/nums', `numbered ${i}`)));
  const nums = first.map((r) => r.json.comment.num);
  assert.equal(new Set(nums).size, 20, `20 numbers, none twice: ${nums.join(',')}`);
  assert.ok(nums.every(Number.isInteger));
  // Resolve the lowest ones, then make three more at once: they come after every number used, not into the gaps.
  const low = first.filter((r) => r.json.comment.num <= 3).map((r) => r.json.comment.id);
  for (const id of low) await send({ page: '/nums', action: 'resolve', id }, owner());
  const more = await Promise.all([1, 2, 3].map((i) => pin('/nums', `later ${i}`)));
  const later = more.map((r) => r.json.comment.num);
  assert.equal(new Set(later).size, 3);
  assert.ok(Math.min(...later) > Math.max(...nums), `${later.join(',')} come after ${Math.max(...nums)}`);
  assert.equal(new Set((await list('/nums')).map((c) => c.num)).size, 23, 'and the list agrees');
});

test('50 pins at once across five pages, with 30 readers in between: each page gets its ten, and every read is a whole list', async () => {
  const pages = ['/p1', '/p2', '/p3', '/p4', '/p5'];
  const writes = Array.from({ length: 50 }, (_, i) => pin(pages[i % 5], `spread ${i}`));
  const reads = Array.from({ length: 30 }, (_, i) => raw(PORT, `/_lab/api/comments?page=${pages[i % 5]}`, { headers: { 'accept-encoding': i % 2 ? 'br' : 'identity' } }));
  const got = await Promise.all(writes);
  assert.deepEqual([...new Set(got.map((r) => r.status))], [201]);
  for (const r of await Promise.all(reads)) {
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(listOf(r).comments), `a whole list (${r.headers['content-encoding'] || 'identity'})`);
  }
  for (const page of pages) {
    const mine = got.filter((_, i) => pages[i % 5] === page).map((r) => r.json.comment.id).sort();
    assert.deepEqual((await list(page)).map((c) => c.id).sort(), mine, page);
    // Asked for again, the kept (compressed) list is the same list.
    const again = await raw(PORT, `/_lab/api/comments?page=${page}`, { headers: { 'accept-encoding': 'br' } });
    assert.equal(again.headers['content-encoding'], 'br');
    assert.deepEqual(listOf(again).comments.map((c) => c.id).sort(), mine, `${page}, the kept list`);
  }
});

test('50 replies at once in one thread while it is resolved and reopened ten times: every reply is there, the thread is whole', async () => {
  const root = (await pin('/p1', 'the busy thread')).json.comment;
  const replies = Array.from({ length: 50 }, (_, i) => send({ page: '/p1', parent: root.id, name: i % 2 ? 'Leo' : 'Mira', text: `reply ${i}` }));
  const flips = Array.from({ length: 10 }, (_, i) => send({ page: '/p1', action: i % 2 ? 'reopen' : 'resolve', id: root.id }, owner()));
  const moves = Array.from({ length: 10 }, (_, i) => send({ page: '/p1', action: 'move', id: root.id, anchor: { selector: `h${i}`, x: 0.1, y: 0.1 } }, owner()));
  const agents = Array.from({ length: 10 }, (_, i) => send({ page: '/p1', parent: root.id, name: 'Claude', text: `On it ${i}`, intent: 'working' }, asAgent(`sess-${i}`)));
  const all = await Promise.all([...replies, ...flips, ...moves, ...agents]);
  assert.deepEqual([...new Set(all.map((r) => r.status))].sort(), [200, 201], all.filter((r) => r.status >= 400).map((r) => `${r.status} ${r.text}`).slice(0, 3).join(' | '));
  const now = await list('/p1');
  const mine = now.filter((c) => c.parent === root.id);
  assert.equal(mine.length, 60);
  assert.equal(new Set(mine.map((c) => c.id)).size, 60);
  assert.deepEqual(mine.filter((c) => !c.session).map((c) => c.text).sort(), Array.from({ length: 50 }, (_, i) => `reply ${i}`).sort());
  const thread = now.find((c) => c.id === root.id);
  assert.equal(thread.text, 'the busy thread');
  assert.equal(typeof thread.resolved, 'boolean');
  assert.match(thread.anchor.selector, /^h\d$/, 'one of the moves stands');
  assert.ok(thread.movedAt);
  await settled('/p1', now.length);
  assert.equal(Object.keys(inFiles()['/p1']).length, now.length, 'and the file agrees');
});

test('50 pins made while a wait is open, and 20 more as it is handed over: every one reaches a wait, none twice', async () => {
  const open = (who) => raw(PORT, '/_lab/wait', { method: 'POST', body: JSON.stringify({ timeout: 4, pages: ['/p2'] }), headers: { 'content-type': 'application/json', ...asAgent(who) } });
  // The ten from before, first.
  const first = await open('sess-w');
  assert.equal(first.status, 200);
  const waiting = open('sess-w');
  await sleep(200);
  const got = await Promise.all(Array.from({ length: 50 }, (_, i) => pin('/p2', `during a wait ${i}`)));
  const late = [];
  for (let i = 0; i < 20; i++) {
    late.push(pin('/p2', `as it is handed over ${i}`));
    await sleep(25); // across the 300 ms the lab lets pins settle
  }
  const ids = [...got, ...(await Promise.all(late))].map((r) => r.json.comment.id);
  const heard = [(await waiting).text];
  for (let i = 0; i < 4; i++) {
    const next = await open('sess-w');
    if (next.status === 200) heard.push(next.text);
    else break;
  }
  const all = heard.join('\n');
  for (const id of ids) assert.equal(all.split(`· id ${id}\n`).length - 1, 1, `${id} was handed over ${all.split(`· id ${id}\n`).length - 1} times in ${heard.length} hand-offs`);
  assert.ok((await list('/p2')).filter((c) => !c.parent).every((c) => c.handedAt));
});

test('60 pages listening at once: each hears a new comment, and the lab is fine when they all go', async () => {
  // Every stream is closed at the end, also when one of them failed to open.
  const reqs = [];
  after(() => reqs.forEach((q) => q.destroy()));
  const streams = await Promise.all(Array.from({ length: 60 }, (_, i) => new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: `/_lab/live?tab=t${i}`, agent: false, headers: { host: `localhost:${PORT}` } }, (res) => {
      const s = { req, seen: [] };
      res.setEncoding('utf8');
      res.on('data', sseReader((d) => d.startsWith('{') && s.seen.push(JSON.parse(d))));
      resolve(s);
    });
    reqs.push(req);
    req.on('error', reject);
  })));
  await sleep(200);
  const before = streams.map((s) => s.seen.at(-1)?.comments);
  assert.ok(before.every((v) => Number.isInteger(v)), 'each got the state');
  const r = await pin('/p3', 'heard by sixty');
  await sleep(300);
  streams.forEach((s, i) => assert.ok(s.seen.at(-1).comments > before[i], `stream ${i} heard it`));
  assert.ok(streams.every((s) => s.seen.at(-1).commentPages.includes('/p3')));
  for (const s of streams) s.req.destroy();
  await sleep(200);
  assert.equal((await raw(PORT, '/')).status, 200);
  assert.ok((await list('/p3')).some((c) => c.id === r.json.comment.id));
  assert.doesNotMatch(lab.out(), /Error|EPIPE|ECONNRESET/);
});

test('a lab killed outright (SIGKILL) the moment its last answer is out: everything it said yes to is there when it starts again', async () => {
  const ids = [];
  for (let round = 0; round < 5; round++) {
    const got = await Promise.all(Array.from({ length: 50 }, (_, i) => pin('/kill', `round ${round} pin ${i}`)));
    assert.deepEqual([...new Set(got.map((r) => r.status))], [201]);
    ids.push(...got.map((r) => r.json.comment.id));
    const last = (await send({ page: '/kill', parent: ids[0], name: 'Leo', text: `the last word of round ${round}` })).json.comment;
    ids.push(last.id);
    await lab.stop('SIGKILL');
    lab = await startLab();
    assert.doesNotMatch(lab.out(), /damaged/, 'no file was left half written');
    const now = new Set((await list('/kill')).map((c) => c.id));
    const lost = ids.filter((id) => !now.has(id));
    assert.deepEqual(lost, [], `round ${round}: ${lost.length} of ${ids.length} acknowledged comments are gone after the kill`);
  }
  assert.equal((await list('/index')).length, 50, 'and the other pages are as they were');
  assert.deepEqual(fs.readdirSync(path.join(DIR, '.lab/comments')).filter((n) => !n.endsWith('.json')), [], 'no .tmp or .broken files left in the store');
});
