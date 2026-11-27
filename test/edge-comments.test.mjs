// Edge cases of the comments API as a local lab serves it: long and odd text, missing and wrong fields, content
// types, the same POST twice, page names (.., encoded slashes, long ones, case), a page deleted under its comments,
// and the same action twice. One lab, no browser.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LAB = fileURLToPath(new URL('../local.mjs', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (n) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `labit-edge-${n}-`)));
const freePort = () => new Promise((done) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)); }); });
const ENV = { ...process.env, LABIT_HOME: tmp('home'), LABIT_NO_UPDATE_CHECK: '1', LABIT_IDLE_MS: '0', LAB_SETTLE_MS: '100', LAB_COMMENTS_PER_HOUR: '100000', PORT: '' };
const labs = [];
const raw = (port, p, { method = 'GET', headers = {}, body, host } = {}) =>
  new Promise((done) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host: host ?? `localhost:${port}`, ...headers } }, (res) => {
      const parts = [];
      res.on('data', (d) => parts.push(d));
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
const startLab = async (dir, port) => {
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
const DIR = tmp('comments');
after(async () => {
  for (const l of labs) await l.stop();
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
});
for (const n of ['index', 'other', 'gone']) fs.writeFileSync(path.join(DIR, `${n}.html`), `<!doctype html><title>${n}</title><h1>${n}</h1>`);
const PORT = await freePort();
let lab = await startLab(DIR, PORT);

const send = (body, { headers = {}, method = 'POST', p = '/_lab/api/comments' } = {}) =>
  raw(PORT, p, { method, body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json', origin: lab.B, ...headers } });
const pin = (page, text, more = {}) => send({ page, name: 'Leo', text, anchor: { selector: 'h1', x: 0.5, y: 0.5 }, ...more });
const list = async (page) => (await raw(PORT, `/_lab/api/comments?page=${encodeURIComponent(page)}`)).json?.comments;
const owner = () => ({ 'x-lab-admin': lab.keys().token });
const stored = async (page, id) => {
  // The page's file is written in the background: give it a moment.
  for (let i = 0; i < 40; i++) {
    for (const n of fs.readdirSync(path.join(DIR, '.lab/comments')).filter((x) => x.endsWith('.json'))) {
      const f = JSON.parse(fs.readFileSync(path.join(DIR, '.lab/comments', n), 'utf8'));
      if (f.page === page && f.comments[id]) return f.comments[id];
    }
    await sleep(50);
  }
  return null;
};
const alive = async () => assert.equal((await raw(PORT, '/')).status, 200, `the lab still answers\n${lab.out().slice(-600)}`);

test('a text over 2000 characters and a name over 60 are cut, not refused; a body just under 256 KB is taken', async () => {
  const r = await pin('/index', 'x'.repeat(5000), { name: 'n'.repeat(200) });
  assert.equal(r.status, 201, r.text.slice(0, 200));
  assert.deepEqual([r.json.comment.text.length, r.json.comment.name.length], [2000, 60]);
  const big = await pin('/index', 'y'.repeat(250 * 1024));
  assert.equal(big.status, 201, 'a 250 KB body is under the cap');
  assert.equal(big.json.comment.text.length, 2000);
});

const ODD = [
  'שלום עולם, זה טקסט מימין לשמאל',
  'مرحبا بالعالم (RTL) with ltr inside',
  '👩‍👩‍👧‍👦 a family, 🏳️‍🌈 a flag, 👍🏽 a skin tone',
  'combining: é ñ Z͑͆a̡l̴g̕o',
  'a NUL \u0000 in the middle',
  'right-to-left override ‮gnp.exe‬ and a zero-width​space',
  'astral 𝔘𝔫𝔦𝔠𝔬𝔡𝔢 𠜎 and a lone-looking "\\ud83d" written as text',
  '<script>alert(1)</script> & "quotes" \' \\ / %00 %2e%2e',
];
const oddIds = [];
test('unicode, emoji, right-to-left, combining marks and a NUL come back exactly as sent: API, file and agent text', async () => {
  for (const text of ODD) {
    const r = await pin('/other', text);
    assert.equal(r.status, 201, text);
    assert.equal(r.json.comment.text, text);
    oddIds.push(r.json.comment.id);
  }
  const all = await list('/other');
  ODD.forEach((text, i) => assert.equal(all.find((c) => c.id === oddIds[i])?.text, text, 'in the list'));
  for (const [i, text] of ODD.entries()) assert.equal((await stored('/other', oddIds[i]))?.text, text, 'in the file');
  const agent = await raw(PORT, '/_lab/agent/other');
  assert.match(agent.headers['content-type'], /^text\/plain; charset=utf-8/);
  for (const text of ODD) assert.ok(agent.text.includes(`comment: ${text}`), `agent text has: ${text}`);
});

test('a text or a name cut at its cap never ends in half an emoji (a lone surrogate)', async () => {
  const r = await pin('/index', 'x'.repeat(1999) + '😀 and more', { name: 'n'.repeat(59) + '😀 Leo' });
  assert.equal(r.status, 201);
  assert.ok(r.json.comment.text.isWellFormed(), `text ends in ${JSON.stringify(r.json.comment.text.slice(-2))}`);
  assert.ok(r.json.comment.name.isWellFormed(), `name ends in ${JSON.stringify(r.json.comment.name.slice(-2))}`);
});

test('missing or wrong-typed fields are the sender\'s mistake (400), never a 500; odd optional fields are dropped', async () => {
  const bad = [
    {}, { page: '/index' }, { page: '/index', name: 'A' }, { page: '/index', text: 'x' }, { page: '/index', name: '   ', text: 'x' }, { page: '/index', name: 'A', text: ' \n\t ' },
    { page: '/index', name: 5, text: 'x' }, { page: '/index', name: 'A', text: {} }, { page: '/index', name: 'A', text: ['x'] }, { page: '/index', name: null, text: null },
    { page: 5, name: 'A', text: 'x' }, { page: null, name: 'A', text: 'x' }, { page: ['/index'], name: 'A', text: 'x' }, { page: { toString: 1 }, name: 'A', text: 'x' },
    'null', '5', '"/index"', '[]', 'true', '[{"page":"/index","name":"A","text":"x"}]',
  ];
  for (const b of bad) {
    const r = await send(b);
    assert.equal(r.status, 400, `${typeof b === 'string' ? b : JSON.stringify(b)} → ${r.status} ${r.text.slice(0, 120)}`);
    assert.doesNotMatch(r.text, /TypeError|SyntaxError|\bat /);
  }
  const before = (await list('/index')).length;
  const odd = [
    { anchor: 'a string' }, { anchor: 7 }, { anchor: [] }, { anchor: null }, { anchor: true },
    { anchor: { selector: {}, x: 'NaN', y: null, docY: '12', width: -5, height: 1e99, dpr: 'x', kind: 'nope', frame: {}, fx: 'a', quote: 'q', ink: { pts: 'no' }, zoneItems: 'x', moment: [], background: 5, block: {}, zw: '1', time: -1 } },
    { anchor: { selector: 'h1', zw: 0.5, zh: 0.5, ink: { mark: 9, pts: [[1e99, -5, 'x', null, {}], 'line', null, [1, 2]] }, zoneItems: [1, null, {}, 'ok'], quote: { exact: 5 }, moment: { kind: 'loop', at: 'x' } } },
    { anchor: { selector: 'h1', quote: { exact: 'w', prefix: 5, suffix: {}, selected: 'yes', tail: [], line: {}, lineNo: 'x' } } },
    { parent: {} }, { parent: 123 }, { parent: ['x'] }, { nonce: 5 }, { nonce: {} }, { to: {} }, { picked: 'x' }, { choices: 'x', recommend: 'y' }, { intent: {} }, { suggest: [] }, { action: 'nuke' }, { action: 5 }, { id: {} },
    { __proto__: null, constructor: 'x' },
  ];
  for (const more of odd) {
    const r = await send({ page: '/index', name: 'A', text: 'odd fields', ...more });
    assert.ok(r.status < 500, `${JSON.stringify(more)} → ${r.status} ${r.text.slice(0, 160)}`);
    assert.doesNotMatch(r.text, /TypeError|RangeError|\bat /, JSON.stringify(more));
  }
  const now = await list('/index');
  assert.ok(Array.isArray(now) && now.length > before, 'the page still lists, with the new ones');
  for (const c of now) {
    assert.equal(typeof c.text, 'string');
    for (const [k, v] of Object.entries(c.anchor || {})) if (typeof v === 'number') assert.ok(Number.isFinite(v), `${k} is a finite number`);
  }
  assert.equal((await raw(PORT, '/_lab/agent/index')).status, 200);
  await alive();
});

test('a body that is not sent as JSON is refused and nothing is saved', async () => {
  const body = JSON.stringify({ page: '/index', name: 'A', text: 'wrong content type' });
  for (const type of [undefined, '', 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonx', 'text/json', 'application/xml']) {
    const r = await raw(PORT, '/_lab/api/comments', { method: 'POST', body, headers: { origin: lab.B, ...(type === undefined ? {} : { 'content-type': type }) } });
    assert.ok(r.status >= 400 && r.status < 500, `${type} → ${r.status}`);
  }
  for (const type of ['application/json', 'application/json; charset=utf-8', 'application/json;charset=UTF-8']) {
    const r = await raw(PORT, '/_lab/api/comments', { method: 'POST', body: body.replace('wrong', 'right'), headers: { origin: lab.B, 'content-type': type } });
    assert.equal(r.status, 201, type);
  }
  const texts = (await list('/index')).map((c) => c.text);
  assert.equal(texts.filter((t) => t === 'wrong content type').length, 0);
  assert.equal(texts.filter((t) => t === 'right content type').length, 3);
});

test('the same POST twice is two comments without a nonce and one with it; a nonce is per page; a deleted first one is not brought back', async () => {
  const same = { page: '/index', name: 'Leo', text: 'sent twice', anchor: { selector: 'h1' } };
  const [a, b] = [await send(same), await send(same)];
  assert.deepEqual([a.status, b.status], [201, 201]);
  assert.notEqual(a.json.comment.id, b.json.comment.id, 'no nonce: nothing says it is a retry');
  const [c, d] = [await send({ ...same, nonce: 'edge-nonce-0001' }), await send({ ...same, nonce: 'edge-nonce-0001' })];
  assert.deepEqual([c.status, d.status], [201, 200]);
  assert.equal(c.json.comment.id, d.json.comment.id);
  assert.equal(d.json.edit, c.json.edit, 'the retry gets the pin\'s key again');
  const e = await send({ ...same, page: '/other', nonce: 'edge-nonce-0001' });
  assert.equal(e.status, 201, 'the same nonce on another page is another comment');
  assert.notEqual(e.json.comment.id, c.json.comment.id);
  // A nonce that is not one (too short, with spaces) counts as none.
  const [f, g] = [await send({ ...same, nonce: 'short' }), await send({ ...same, nonce: 'short' })];
  assert.notEqual(f.json.comment.id, g.json.comment.id);
  // The first one deleted: the retry does not answer with a comment that is gone.
  assert.equal((await send({ page: '/index', action: 'delete', id: c.json.comment.id }, { headers: owner() })).status, 200);
  const h = await send({ ...same, nonce: 'edge-nonce-0001' });
  assert.equal(h.status, 201);
  assert.notEqual(h.json.comment.id, c.json.comment.id);
});

test('ten copies of one POST arriving at once with the same nonce are one comment', async () => {
  const same = { page: '/index', name: 'Leo', text: 'ten at once', anchor: { selector: 'h1' }, nonce: 'edge-nonce-ten-at-once' };
  const got = await Promise.all(Array.from({ length: 10 }, () => send(same)));
  assert.ok(got.every((r) => r.status === 200 || r.status === 201), got.map((r) => r.status).join(' '));
  assert.equal(new Set(got.map((r) => r.json.comment.id)).size, 1, 'one id');
  assert.equal((await list('/index')).filter((c) => c.text === 'ten at once').length, 1);
});

test('page names: .., encoded slashes, other scripts, capitals first, 301 characters and friends are refused, on POST and GET', async () => {
  const bad = ['/../etc/passwd', '/a/../b', '/a/./b', '/a/..', '/..', '/.lab/key', '/%2e%2e/x', '/a%2Fb', '/a%252Fb', '/a//b', '//evil.example/x', '/a\\b', '/a b', '/a\u0000b', '/a\nb', '/', '',
    'index', 'http://evil.example/index', '/a?x=1', '/a#b', '/ä', '/A', '/Index', '/a.b', '/-a', '/' + 'x'.repeat(300), '/' + 'x/'.repeat(200)];
  for (const page of bad) {
    const r = await send({ page, name: 'A', text: 'x' });
    assert.equal(r.status, 400, `POST ${JSON.stringify(page)} → ${r.status}`);
    const g = await raw(PORT, `/_lab/api/comments?page=${encodeURIComponent(page)}`);
    assert.equal(g.status, 400, `GET ${JSON.stringify(page)} → ${g.status}`);
  }
  for (const q of ['', '?format=text', '?page=', '?page=%', '?page=%E0%A4%A', '?page[]=/index']) {
    const g = await raw(PORT, `/_lab/api/comments${q}`);
    assert.ok(g.status >= 400 && g.status < 500, `GET ${q} → ${g.status} ${g.text.slice(0, 100)}`);
  }
  // The agent text of a path that is not a page gives nothing away and is not a 500.
  for (const p of ['/_lab/agent/..%2f..%2fetc%2fpasswd', '/_lab/agent/%2e%2e/%2e%2e/etc/passwd', '/_lab/agent/a%2Fb', '/_lab/agent/']) {
    const r = await raw(PORT, p);
    assert.ok(r.status < 500, `${p} → ${r.status}`);
    assert.doesNotMatch(r.text, /root:|"agent"|"token"/);
  }
  // A trailing slash is the same page; __proto__ and constructor are just names.
  const t = await send({ page: '/other/', name: 'A', text: 'trailing slash', anchor: { selector: 'h1' } });
  assert.equal(t.status, 201);
  assert.ok((await list('/other')).some((c) => c.id === t.json.comment.id));
  for (const page of ['/__proto__', '/constructor', '/hasownproperty/__proto__']) {
    assert.equal((await send({ page, name: 'A', text: 'a name like any other', anchor: { selector: 'h1' } })).status, 201, page);
    assert.equal((await list(page)).length, 1, page);
  }
  assert.equal(({}).text, undefined);
  await alive();
});

const LONG_A = '/' + 'p'.repeat(298) + 'a';
const LONG_B = '/' + 'p'.repeat(298) + 'b';
const apart = {};
test('pages that differ only in case, or only in the last of 300 characters, are apart: own lists, own files', async () => {
  for (const page of ['/a/B', '/a/b', LONG_A, LONG_B]) {
    const r = await send({ page, name: 'A', text: `only on ${page.slice(-3)}`, anchor: { selector: 'h1' } });
    assert.equal(r.status, 201, `${page.slice(0, 20)}… → ${r.status} ${r.text.slice(0, 100)}`);
    apart[page] = r.json.comment.id;
  }
  for (const [page, id] of Object.entries(apart)) {
    assert.deepEqual((await list(page)).map((c) => c.id), [id], page.slice(-3));
    assert.ok(await stored(page, id), `${page.slice(-3)} is in a file`);
  }
  const files = fs.readdirSync(path.join(DIR, '.lab/comments')).filter((n) => n.endsWith('.json'));
  assert.equal(new Set(files.map((n) => n.toLowerCase())).size, files.length, 'no two files that a disk ignoring case takes for one');
  assert.ok(files.every((n) => Buffer.byteLength(n) <= 255), 'every name fits a file name');
});

let goneId;
test('a page whose file is deleted keeps its comments: listed, answered, in the agent text, and new ones still land', async () => {
  const r = await pin('/gone', 'before the file went');
  goneId = r.json.comment.id;
  fs.rmSync(path.join(DIR, 'gone.html'));
  await sleep(600); // the watcher
  assert.equal((await raw(PORT, '/gone')).status, 404, 'the page itself is gone');
  assert.deepEqual((await list('/gone')).map((c) => c.id), [goneId]);
  const text = await raw(PORT, '/_lab/agent/gone');
  assert.equal(text.status, 200);
  assert.match(text.text, /before the file went/);
  const pages = await raw(PORT, '/_lab/pages');
  assert.equal(pages.status, 200);
  assert.ok(!pages.json.pages.some((p) => p.path === '/gone'), 'not offered as a page any more');
  const reply = await send({ page: '/gone', parent: goneId, name: 'Leo', text: 'still here?' });
  assert.equal(reply.status, 201);
  assert.equal((await pin('/gone', 'after the file went')).status, 201);
  const md = fs.readFileSync(path.join(DIR, '.lab/comments.md'), 'utf8');
  assert.match(md, /before the file went/);
  await alive();
});

test('the same action twice: resolve and reopen hold, a second delete is 404, and nothing answers a deleted thread', async () => {
  const { comment } = (await pin('/index', 'twice')).json;
  const act = (action, id = comment.id) => send({ page: '/index', action, id }, { headers: owner() });
  assert.deepEqual([(await act('resolve')).status, (await act('resolve')).status], [200, 200]);
  assert.equal((await list('/index')).find((c) => c.id === comment.id).resolved, true);
  assert.deepEqual([(await act('reopen')).status, (await act('reopen')).status], [200, 200]);
  const reply = (await send({ page: '/index', parent: comment.id, name: 'Bo', text: 'a reply' })).json.comment;
  assert.deepEqual([(await act('delete')).status, (await act('delete')).status], [200, 404]);
  assert.equal((await act('resolve')).status, 404);
  assert.equal((await act('reopen')).status, 404);
  assert.equal((await act('delete', reply.id)).status, 404, 'its reply went with it');
  assert.equal((await send({ page: '/index', action: 'move', id: comment.id, anchor: { selector: 'h1' } }, { headers: owner() })).status, 404);
  // The agent's progress on a pin deleted while it worked is dropped: 410, said apart from a pin that never was.
  assert.equal((await send({ page: '/index', action: 'progress', id: comment.id, text: 'on it' }, { headers: { 'x-lab-admin': lab.keys().agent, 'x-lab-agent': '1' } })).status, 410);
  for (const parent of [comment.id, reply.id, 'nosuchthread', '__proto__', 'constructor']) {
    const r = await send({ page: '/index', parent, name: 'Bo', text: 'to nobody' });
    assert.equal(r.status, 404, `a reply to ${parent} → ${r.status}`);
  }
  assert.ok(!(await list('/index')).some((c) => c.text === 'to nobody'), 'no reply left without a thread');
});

test('after a restart everything is as it was: odd text, the pages apart, the deleted page\'s comments', async () => {
  await lab.stop();
  lab = await startLab(DIR, PORT);
  assert.doesNotMatch(lab.out(), /damaged/);
  const other = await list('/other');
  ODD.forEach((text, i) => assert.equal(other.find((c) => c.id === oddIds[i])?.text, text));
  for (const [page, id] of Object.entries(apart)) assert.deepEqual((await list(page)).map((c) => c.id), [id], page.slice(-3));
  assert.ok((await list('/gone')).some((c) => c.id === goneId));
  assert.equal((await list('/__proto__')).length, 1);
});
