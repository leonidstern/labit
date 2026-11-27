// The board API at the edges: frame sources that are no page of this lab, sizes and places that are no numbers (or
// huge, or negative), 500 frames, a stale rev in every spelling, two saves made from the same rev at once, odd names,
// bodies of the wrong shape, and the agent's board commands with names that reach outside .lab/boards. No browser.
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
  for (const n of ['index', 'pricing']) fs.writeFileSync(path.join(dir, `${n}.html`), `<!doctype html><title>${n}</title><h1>${n}</h1>`);
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
after(async () => {
  for (const l of labs) await l.stop();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 });
  fs.rmSync(ENV.LABIT_HOME, { recursive: true, force: true, maxRetries: 5 });
});
const lab = await startLab('board');
const PORT = lab.port;
const put = (q, body, headers = {}) => raw(PORT, `/_lab/api/board?${q}`, { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json', origin: lab.B, ...headers } });
const get = (q) => raw(PORT, `/_lab/api/board${q ? `?${q}` : ''}`);
const post = (body, headers = {}) => raw(PORT, '/_lab/api/board', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', origin: lab.B, ...headers } });
const fileOf = (name) => path.join(lab.dir, '.lab/boards', `${name}.json`);
const frame = (id, more = {}) => ({ id, src: '/index', w: 800, h: 600, ...more });
const alive = async () => assert.equal((await raw(PORT, '/')).status, 200, `the lab still answers\n${lab.out().slice(-600)}`);

test('a frame\'s src is a page of this lab or one of the board\'s own variants: anything else is refused and no board is made', async () => {
  const bad = ['http://evil.example/', 'https://evil.example/x', '//evil.example/x', 'javascript:alert(1)', 'data:text/html,<h1>x</h1>', 'file:///etc/passwd', 'pricing', '', ' /index', '/a/../b', '/..', '/../etc/passwd', '/a/./b',
    '/a b', '/x"onload="alert(1)', "/x'y", '/x<y', '/x>y', '/\\evil.example', '\\\\evil.example\\x', '/a\\b', '/' + 'x'.repeat(300), 5, null, true, {}, ['/index'],
    '/_lab/board/other/a', '/_lab/api/comments?page=/index', '/_lab/agent/index', '/_lab/j/abcdef', '/_lab/board/srcs', '/_lab/'];
  for (const src of bad) {
    const r = await put('name=srcs', { v: 1, rev: 0, frames: [{ id: 'a', src, w: 800, h: 600 }] });
    assert.equal(r.status, 422, `src ${JSON.stringify(src)?.slice(0, 50)} → ${r.status} ${r.text.slice(0, 100)}`);
    assert.doesNotMatch(r.text, /TypeError|\bat /);
  }
  assert.equal((await get('name=srcs')).status, 404, 'nothing was saved');
  assert.ok(!fs.existsSync(fileOf('srcs')));
  const good = await put('name=srcs', { v: 1, frames: [frame('a', { src: '/index' }), frame('b', { src: '/pricing#hero' }), frame('c', { src: '/sub/page?x=1&y=2' }), frame('d', { src: '/_lab/board/srcs/d' })] });
  assert.equal(good.status, 200, good.text);
  assert.deepEqual(good.json.frames.map((f) => f.src), ['/index', '/pricing#hero', '/sub/page?x=1&y=2', '/_lab/board/srcs/d']);
});

test('a size or a place that is no number, negative, a fraction or huge is brought into bounds: never NaN, never out of range, in the answer and in the file', async () => {
  const sizes = [[null, null], [-5, -5], [0, 0], [1e9, 1e12], ['500', '700'], [0.4, 199.6], [true, false], [[800], { h: 600 }], [390, null], [820.5, 1180.49], [Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]];
  const places = [[1e12, -1e12], ['5', 5], [null, null], [3.7, 9.2], [-0, 0], [1e308, 1e308], [{}, []], [100, null]];
  const frames = [...sizes.map(([w, h], i) => ({ id: `s${i}`, src: '/index', w, h })), ...places.map(([x, y], i) => ({ id: `p${i}`, src: '/index', w: 800, h: 600, x, y }))];
  // 1e400 is JSON a parser reads as Infinity; NaN can't be written in JSON at all.
  const body = JSON.stringify({ v: 1, frames }).replace('"w":null,"h":null', '"w":1e400,"h":-1e400');
  const r = await put('name=sizes', body);
  assert.equal(r.status, 200, r.text.slice(0, 200));
  const check = (f, where) => {
    for (const k of ['w', 'h']) assert.ok(Number.isInteger(f[k]) && f[k] >= 200 && f[k] <= 4000, `${where} ${f.id}.${k} = ${f[k]}`);
    for (const k of ['x', 'y']) if (f[k] !== undefined) assert.ok(Number.isInteger(f[k]) && Math.abs(f[k]) <= 1e6, `${where} ${f.id}.${k} = ${f[k]}`);
  };
  r.json.frames.forEach((f) => check(f, 'answer'));
  for (const f of r.json.frames) assert.ok(Number.isFinite(f.x) && Number.isFinite(f.y), `${f.id} is placed`);
  const by = Object.fromEntries(r.json.frames.map((f) => [f.id, f]));
  assert.deepEqual([by.s0.w, by.s0.h, by.s1.w, by.s1.h, by.s3.w, by.s3.h, by.s4.w, by.s4.h, by.s8.w, by.s8.h], [1280, 800, 200, 200, 4000, 4000, 1280, 800, 390, 844]);
  assert.deepEqual([by.p0.x, by.p0.y, by.p3.x, by.p3.y, by.p5.x, by.p5.y], [1e6, -1e6, 4, 9, 1e6, 1e6]);
  assert.equal(by.p1.auto, true, 'a place that is half a number is the lab\'s to choose');
  const stored = JSON.parse(fs.readFileSync(fileOf('sizes'), 'utf8'));
  stored.frames.forEach((f) => check(f, 'file'));
  assert.doesNotMatch(fs.readFileSync(fileOf('sizes'), 'utf8'), /null|NaN|Infinity/);
  assert.equal((await get('name=sizes')).json.frames.length, frames.length);
});

test('500 frames, and 61, are refused; 60 are taken, placed apart, and none may be dropped or doubled afterwards', async () => {
  const many = (n) => Array.from({ length: n }, (_, i) => frame(`f${i}`));
  for (const n of [500, 61]) {
    const r = await put('name=many', { v: 1, frames: many(n) });
    assert.equal(r.status, 422, `${n} frames → ${r.status}`);
    assert.match(r.json.error, /at most 60 frames/);
  }
  const r = await put('name=many', { v: 1, frames: many(60) });
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.equal(r.json.frames.length, 60);
  assert.equal(new Set(r.json.frames.map((f) => `${f.x},${f.y}`)).size, 60, 'no two frames on one spot');
  const rev = r.json.rev;
  const tries = [
    ['one dropped', many(59), /cannot be removed/],
    ['one twice', [...many(60).slice(0, 59), frame('f0')], /each once/],
    ['an id in capitals', [...many(59), frame('F59')], /lowercase/],
    ['an id that starts with a digit', [...many(59), frame('9f')], /lowercase/],
    ['an id too long', [...many(59), frame('toolong')], /lowercase/],
    ['an empty id', [...many(59), frame('')], /lowercase/],
    ['an id called __proto__', [...many(59), frame('__proto__')], /lowercase/],
    ['an id that is a number', [...many(59), frame(59)], /lowercase/],
    ['a frame that is null', [...many(59), null], /lowercase/],
    ['a frame that is a string', [...many(59), 'f59'], /lowercase/],
  ];
  for (const [what, frames, why] of tries) {
    const bad = await put('name=many', { v: 1, rev, frames });
    assert.equal(bad.status, 422, `${what} → ${bad.status} ${bad.text.slice(0, 100)}`);
    assert.match(bad.json.error, why, what);
  }
  assert.equal((await get('name=many')).json.rev, rev, 'none of those saved anything');
  // The agent's add stops at 60 too.
  const add = await post({ action: 'add', name: 'many', target: '/pricing' }, { 'x-lab-admin': lab.keys().agent, 'x-lab-agent': '1' });
  assert.equal(add.status, 422);
  assert.match(add.json.error, /at most 60 frames/);
  await alive();
});

test('a save made from an older rev is refused with the board as it is now, in every spelling of "older"', async () => {
  const first = await put('name=revs', { v: 1, frames: [frame('a')] });
  assert.deepEqual([first.status, first.json.rev], [200, 1]);
  const second = await put('name=revs', { v: 1, rev: 1, frames: [frame('a', { label: 'second' })] });
  assert.deepEqual([second.status, second.json.rev], [200, 2]);
  const before = fs.readFileSync(fileOf('revs'), 'utf8');
  for (const rev of [1, 0, -1, 3, 999, 2.5, '2', null, undefined, true, [2], { rev: 2 }]) {
    const r = await put('name=revs', { v: 1, ...(rev === undefined ? {} : { rev }), frames: [frame('a', { label: 'stale' })] });
    assert.equal(r.status, 409, `rev ${JSON.stringify(rev)} → ${r.status}`);
    assert.deepEqual([r.json.board.rev, r.json.board.frames[0].label], [2, 'second'], 'it carries the board as it is');
  }
  assert.equal(fs.readFileSync(fileOf('revs'), 'utf8'), before, 'the file did not change');
  const third = await put('name=revs', { v: 1, rev: 2, frames: [frame('a', { label: 'third' })] });
  assert.deepEqual([third.status, third.json.rev, third.json.frames[0].label], [200, 3, 'third']);
});

test('20 saves made from the same rev and sent at once: one is taken, the others are told the board changed', async () => {
  const made = await put('name=burst', { v: 1, frames: [frame('a')] });
  const got = await Promise.all(Array.from({ length: 20 }, (_, i) => put('name=burst', { v: 1, rev: made.json.rev, frames: [frame('a', { label: `save ${i}` })] })));
  const codes = got.map((r) => r.status);
  assert.equal(codes.filter((c) => c === 200).length, 1, codes.join(' '));
  assert.equal(codes.filter((c) => c === 409).length, 19, codes.join(' '));
  const now = (await get('name=burst')).json;
  assert.equal(now.rev, made.json.rev + 1);
  assert.equal(now.frames[0].label, got.find((r) => r.status === 200).json.frames[0].label, 'and the board is the one that was taken');
});

test('two saves from the same rev whose requests are both open before either body arrives (two tabs, a slow link): one is taken, not both', async () => {
  const made = await put('name=slow', { v: 1, frames: [frame('a')] });
  const open = (label) => {
    const body = JSON.stringify({ v: 1, rev: made.json.rev, frames: [frame('a', { label })] });
    let finish;
    const done = new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: PORT, path: '/_lab/api/board?name=slow', method: 'PUT', headers: { host: `localhost:${PORT}`, 'content-type': 'application/json', origin: lab.B, 'content-length': Buffer.byteLength(body) } }, (res) => {
        let text = '';
        res.on('data', (d) => (text += d));
        res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(text) }));
      });
      req.on('error', () => resolve({ status: 0 }));
      req.flushHeaders(); // the request is there; its body follows
      finish = () => req.end(body);
    });
    return { done, finish };
  };
  const [one, two] = [open('from tab one'), open('from tab two')];
  await sleep(300); // both requests have reached the lab, neither body has
  one.finish();
  const first = await one.done;
  two.finish();
  const second = await two.done;
  const now = (await get('name=slow')).json;
  assert.deepEqual([first.status, second.status], [200, 409], `both were made from rev ${made.json.rev}; the board is now rev ${now.rev} with "${now.frames[0].label}" (tab one's save ${now.frames[0].label === 'from tab one' ? 'stands' : 'was written over'})`);
  assert.equal(now.frames[0].label, 'from tab one', 'the refused save wrote nothing');
  assert.equal(now.rev, made.json.rev + 1, 'one save on top of the first');
});

test('names and pages that are none: refused before anything is read or written', async () => {
  for (const q of ['name=../x', 'name=..%2F..%2Fpackage', 'name=A', 'name=a/b', 'name=.hidden', 'name=a.json', 'name=a%00b', `name=${'n'.repeat(81)}`, 'name=-a', 'name=__proto__', 'name=a%20b',
    'page=//evil.example', 'page=/a/../b', 'page=index', 'page=http://evil.example/', 'page=/a%20b', `page=/${'p'.repeat(300)}`, 'name=ok&page=//evil.example']) {
    for (const r of [await get(q), await put(q, { v: 1, frames: [frame('a')] })]) assert.equal(r.status, 400, `${q} → ${r.status} ${r.text.slice(0, 80)}`);
  }
  assert.equal((await put('name=', { v: 1, frames: [frame('a')] })).status, 400, 'a save with no name');
  assert.equal((await get('name=nosuchboard')).status, 404);
  const none = await get('page=/pricing');
  assert.deepEqual([none.status, none.json.exists, none.json.name], [200, false, 'pricing'], 'a page with no board yet gets one to start from, unsaved');
  assert.ok(!fs.existsSync(fileOf('pricing')));
  const all = await get('');
  assert.equal(all.status, 200);
  assert.ok(all.json.boards.every((b) => typeof b.name === 'string' && Number.isInteger(b.frames)));
  assert.deepEqual(fs.readdirSync(path.join(lab.dir, '.lab/boards')).filter((n) => !/^(srcs|sizes|many|revs|burst|slow)\.json$/.test(n)), [], 'only the boards these tests saved are in .lab/boards');
});

test('a body of the wrong shape is 422 with its reason; a title and a label are cut to a line of 80', async () => {
  for (const body of ['[]', '{}', '{"frames":"a"}', '{"frames":{}}', '{"frames":[[]]}', '{"frames":[5]}', '{"frames":[{}]}', '{"v":1,"frames":[{"id":"a","src":null}]}', '5', '"board"', 'true']) {
    const r = await put('name=shape', body);
    assert.equal(r.status, 422, `${body} → ${r.status} ${r.text.slice(0, 100)}`);
    assert.doesNotMatch(r.text, /TypeError|\bat /);
  }
  for (const of of ['http://evil.example/', '//evil.example', 5, '', 'pricing', '/a/../b']) assert.equal((await put('name=shape', { v: 1, of, frames: [frame('a')] })).status, 422, `of ${JSON.stringify(of)}`);
  assert.ok(!fs.existsSync(fileOf('shape')));
  const r = await put('name=shape', { v: 1, title: `  a title\nwith a second line ${'t'.repeat(200)}`, of: '/pricing#hero', frames: [frame('a', { label: `<script>alert(1)</script>\n${'l'.repeat(200)}`, state: 'nonsense', variantOf: 'zz', auto: 'yes', extra: { deep: true } })] });
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.equal(r.json.title.length, 80);
  assert.doesNotMatch(r.json.title, /\n/);
  const f = r.json.frames[0];
  assert.deepEqual([f.label.length, f.state, f.variantOf, f.extra], [80, 'live', undefined, undefined]);
  // A board about a page goes to that page. The board page of one with no page puts only its name in the HTML, never the title or a label.
  assert.equal((await raw(PORT, '/_lab/board/shape')).status, 302);
  assert.equal((await put('name=plain', { v: 1, title: 'a title', frames: [frame('a', { label: '<script>alert(1)</script>' })] })).status, 200);
  const page = await raw(PORT, '/_lab/board/plain');
  assert.equal(page.status, 200);
  assert.doesNotMatch(page.text, /<script>alert\(1\)|a title/);
  await alive();
});

test('the agent\'s board commands: the keys they take, and an action that is none', async () => {
  const { agent, token } = lab.keys();
  assert.equal((await post({ action: 'list' })).status, 403, 'no key');
  assert.equal((await post({ action: 'list' }, { 'x-lab-admin': 'f'.repeat(24) })).status, 403, 'a wrong key');
  assert.equal((await post({ action: 'list' }, { 'x-lab-admin': agent })).status, 403, 'the agent key without its mark');
  assert.equal((await post({ action: 'list' }, { 'x-lab-admin': token })).status, 200, 'the page key, on this computer');
  assert.equal((await post({ action: 'list' }, { 'x-lab-admin': agent, 'x-lab-agent': '1' })).status, 200, 'the agent');
  const as = { 'x-lab-admin': agent, 'x-lab-agent': '1' };
  for (const body of [{}, { action: 'nuke' }, { action: 5 }, { action: ['nuke'] }, { action: 'constructor' }, { action: '__proto__' }, { action: 'pick', name: 'revs' }, { action: 'pick', name: 'revs', frames: ['zz'] }, { action: 'move', name: 'revs', frame: 'zz' },
    { action: 'add', name: 'revs' }, { action: 'add', name: 'revs', target: '../../../../etc/passwd' }, { action: 'add', name: 'revs', target: '/index', width: 'wide' }, { action: 'new', name: '../x' }, { action: 'new', topic: 'x', of: '//evil.example' }, { action: 'new', topic: 'x', of: '/index', variants: 99 }, { action: 'new', topic: 'x', of: '/nosuchpage', variants: 2 }]) {
    const r = await post(body, as);
    assert.equal(r.status, 422, `${JSON.stringify(body)} → ${r.status} ${r.text.slice(0, 100)}`);
    assert.ok(typeof r.json.error === 'string' && r.json.error.length > 0);
  }
  await alive();
});

test('a board named with ../ in a command reads and moves nothing outside .lab/boards', async () => {
  // A board file that can't be read is "put aside" (renamed .broken-…): that must never reach a file that is not a board's.
  const lab = await startLab('board-out');
  const post = (body, headers = {}) => raw(lab.port, '/_lab/api/board', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', origin: lab.B, ...headers } });
  const victims = ['package.json', 'tsconfig.json', 'data.json'].map((n) => path.join(lab.dir, n));
  for (const f of victims) fs.writeFileSync(f, '{"name":"not a board"}');
  const as = { 'x-lab-admin': lab.keys().agent, 'x-lab-agent': '1' };
  const tried = [
    await post({ action: 'list', name: '../../package' }, as),
    await post({ action: 'add', name: '../../tsconfig', target: '/index' }, as),
    await post({ action: 'pick', name: '../../data', frames: ['a'] }, { 'x-lab-admin': lab.keys().token }),
  ];
  await sleep(100);
  assert.equal((await raw(lab.port, '/')).status, 200, 'the lab is up');
  const names = fs.readdirSync(lab.dir).filter((n) => /json/.test(n)).sort();
  assert.deepEqual(names, ['data.json', 'package.json', 'tsconfig.json'], `the project's files after ${tried.map((r) => r.status).join(' ')}`);
});

test('a frame sent with no src at all is refused like any other bad src, and the lab keeps running', async () => {
  const one = await startLab('board-nosrc');
  const r = await raw(one.port, '/_lab/api/board?name=nosrc', { method: 'PUT', body: '{"v":1,"frames":[{"id":"a","w":800,"h":600}]}', headers: { 'content-type': 'application/json', origin: one.B } });
  await sleep(200);
  const still = (await raw(one.port, '/')).status;
  assert.ok(one.proc.exitCode === null && still === 200, `the lab went down (exit ${one.proc.exitCode}): ${one.out().split('\n').find((l) => /Error/.test(l))}`);
  assert.equal(r.status, 422);
});
