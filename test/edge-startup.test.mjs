// Starting a lab on things that are not as they should be: comment files cut short, empty, or holding what is no
// comment; a stale lock and damaged key files; a port somebody else holds; ports that are no ports; a settings.json of
// broken types or no JSON at all; a labit.json with unknown and invalid settings. A warning is fine, a line that says
// what is wrong is fine; a stack trace, or a lab that does not start over a file it could put aside, is not.
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
const ENV = { ...process.env, LABIT_HOME: tmp('home'), LABIT_NO_UPDATE_CHECK: '1', LABIT_IDLE_MS: '0', LAB_SETTLE_MS: '100', LAB_COMMENTS_PER_HOUR: '100000', PORT: '' };
const procs = [];
const dirs = [];
const raw = (port, p, { method = 'GET', headers = {}, body, to = '127.0.0.1' } = {}) =>
  new Promise((done) => {
    const req = http.request({ host: to, port, path: p, method, headers: { host: `localhost:${port}`, ...headers } }, (res) => {
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
const folder = (name) => {
  const dir = tmp(name);
  dirs.push(dir);
  for (const n of ['index', 'other']) fs.writeFileSync(path.join(dir, `${n}.html`), `<!doctype html><title>${n}</title><h1>${n}</h1>`);
  return dir;
};
// Starts a lab (always --no-open) and waits until it answers or exits. port: where it is expected; without one, the
// port it wrote into .lab/server.json.
const attempt = async (dir, args = [], { env = {}, port, wait = 6000 } = {}) => {
  let out = '';
  const proc = spawn(process.execPath, [LAB, ...args, '--no-open'], { cwd: dir, env: { ...ENV, ...env } });
  procs.push(proc);
  proc.stdout.on('data', (d) => (out += d));
  proc.stderr.on('data', (d) => (out += d));
  const gone = () => proc.exitCode !== null || proc.signalCode !== null;
  const t = Date.now();
  let at = 0;
  while (Date.now() - t < wait && !gone() && !at) {
    let p = port;
    if (!p) {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(dir, '.lab/server.json'), 'utf8'));
        if (s.pid === proc.pid) p = s.port;
      } catch {}
    }
    if (p && (await raw(p, '/_lab/state')).status === 200) at = p;
    else await sleep(100);
  }
  if (gone()) await sleep(50); // the last of its output
  return { proc, up: Boolean(at), port: at, out: () => out, code: () => proc.exitCode, stop: () => new Promise((r) => (gone() ? r() : (proc.once('exit', r), proc.kill()))) };
};
const run = (dir, args, env = {}) => new Promise((done) => execFile(process.execPath, [LAB, ...args], { cwd: dir, env: { ...ENV, ...env } }, (err, stdout, stderr) => done({ code: err?.code ?? 0, out: stdout + stderr })));
after(async () => {
  for (const p of procs) if (p.exitCode === null) p.kill('SIGKILL');
  await sleep(100);
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 });
});
const STACK = /\n\s+at .+:\d+:\d+\)?|Node\.js v\d+|TypeError|RangeError|SyntaxError/;
const trace = (out) => (STACK.test(out) ? out.split('\n').find((l) => /Error/.test(l)) || 'a stack trace' : '');
const record = (id, text, more = {}) => ({ v: 2, id, parent: null, name: 'Leo', text, createdAt: new Date().toISOString(), resolved: false, anchor: { selector: 'h1', x: 0.5, y: 0.5 }, ...more });
const store = (dir, name, text) => {
  fs.mkdirSync(path.join(dir, '.lab/comments'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.lab/comments', name), text);
};

test('a comments file cut short, an empty one and one of another shape are put aside as they were; the other pages load', async () => {
  const dir = folder('cut');
  const good = JSON.stringify({ v: 2, page: '/other', comments: { good00000001: record('good00000001', 'still here') } });
  store(dir, 'other.json', good);
  store(dir, 'index.json', good.replace('/other', '/index').slice(0, 90)); // cut in the middle
  store(dir, 'empty.json', '');
  store(dir, 'list.json', '[1,2,3]');
  store(dir, 'nopage.json', '{"v":2,"comments":{}}');
  store(dir, 'badpage.json', '{"v":2,"page":"../../etc/passwd","comments":{}}');
  store(dir, 'strings.json', '{"v":2,"page":"/x","comments":"none"}');
  store(dir, 'half.json.tmp', '{"v":2,"page":"/index","comm'); // a write that never finished
  const port = await freePort();
  const lab = await attempt(dir, ['.', '--port', String(port)], { port });
  assert.ok(lab.up, lab.out());
  assert.equal(trace(lab.out()), '');
  assert.deepEqual((await raw(port, '/_lab/api/comments?page=/other')).json.comments.map((c) => c.text), ['still here']);
  assert.deepEqual((await raw(port, '/_lab/api/comments?page=/index')).json.comments, []);
  const names = fs.readdirSync(path.join(dir, '.lab/comments'));
  for (const n of ['index.json', 'empty.json', 'list.json', 'nopage.json', 'badpage.json', 'strings.json']) {
    assert.ok(names.some((x) => x.startsWith(`${n}.broken-`)), `${n} was put aside: ${names.join(' ')}`);
    assert.match(lab.out(), new RegExp(`comments/${n.replace('.', '\\.')} was damaged`));
  }
  assert.equal(fs.readFileSync(path.join(dir, '.lab/comments', names.find((x) => x.startsWith('index.json.broken-'))), 'utf8'), good.replace('/other', '/index').slice(0, 90), 'kept as it was');
  // A new comment on the page whose file was damaged starts a fresh file; the damaged copy stays beside it.
  const r = await raw(port, '/_lab/api/comments', { method: 'POST', body: JSON.stringify({ page: '/index', name: 'Leo', text: 'after the damage', anchor: { selector: 'h1' } }), headers: { 'content-type': 'application/json', origin: `http://localhost:${port}` } });
  assert.equal(r.status, 201);
  await sleep(300);
  await lab.stop();
  const again = await attempt(dir, ['.', '--port', String(port)], { port });
  assert.deepEqual((await raw(port, '/_lab/api/comments?page=/index')).json.comments.map((c) => c.text), ['after the damage']);
  assert.doesNotMatch(again.out(), /damaged/, 'nothing is put aside twice');
  await again.stop();
});

test('a comments file that is JSON but holds what is no comment does not keep the lab from starting, or its pages from listing', async () => {
  const bad = [];
  for (const [what, comments] of [
    ['a comment that is null', { abc000000001: null }],
    ['a comment that is a string', { abc000000001: 'hello' }],
    ['a comment that is a number', { abc000000001: 5 }],
    ['a comment with no date', { abc000000001: { v: 2, id: 'abc000000001', name: 'Leo', text: 'x', parent: null, resolved: false, anchor: {} } }],
    ['a comment whose date is a number', { abc000000001: record('abc000000001', 'x', { createdAt: 1700000000000 }) }],
    ['a comment with no text or name', { abc000000001: { v: 2, id: 'abc000000001', parent: null, createdAt: new Date().toISOString(), resolved: false } }],
    ['a comment whose anchor is a string', { abc000000001: record('abc000000001', 'x', { anchor: 'h1' }) }],
    ['a reply whose thread is not there', { abc000000001: record('abc000000001', 'orphan', { parent: 'nosuchthread' }) }],
    ['an old record (v 0) that is mostly missing', { abc000000001: { id: 'abc000000001', parent: 'zzz', session: 5, rule: 7, anchor: { text: 9 } } }],
  ]) {
    const dir = folder('shape');
    store(dir, 'other.json', JSON.stringify({ v: 2, page: '/other', comments: { good00000001: record('good00000001', 'still here') } }));
    store(dir, 'index.json', JSON.stringify({ v: 2, page: '/index', comments }));
    const port = await freePort();
    const lab = await attempt(dir, ['.', '--port', String(port)], { port, wait: 4000 });
    if (!lab.up) {
      bad.push(`${what}: the lab does not start (${trace(lab.out()) || `exit ${lab.code()}`})`);
      continue;
    }
    const tries = { 'the list': '/_lab/api/comments?page=/index', 'the other page\'s list': '/_lab/api/comments?page=/other', 'labs & pages': '/_lab/pages', 'the agent text': '/_lab/agent/index', 'the page': '/' };
    for (const [name, p] of Object.entries(tries)) {
      const r = await raw(port, p);
      if (r.status !== 200) bad.push(`${what}: ${name} → ${r.status} ${r.text.slice(0, 70)}`);
    }
    const post = await raw(port, '/_lab/api/comments', { method: 'POST', body: JSON.stringify({ page: '/index', name: 'Leo', text: 'a new one', anchor: { selector: 'h1' } }), headers: { 'content-type': 'application/json', origin: `http://localhost:${port}` } });
    if (post.status !== 201) bad.push(`${what}: a new comment → ${post.status} ${post.text.slice(0, 70)}`);
    await sleep(150);
    if (lab.code() !== null) bad.push(`${what}: the lab went down after a new comment (${trace(lab.out())})`);
    await lab.stop();
  }
  assert.deepEqual(bad, []);
});

test('a lock nobody holds, a damaged server.json and a key file of the wrong shape do not stop a start; the key is made again, owner-only', async () => {
  const dir = folder('lock');
  fs.mkdirSync(path.join(dir, '.lab'));
  fs.writeFileSync(path.join(dir, '.lab/lock'), '{"pid": 12'); // cut short, and old
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(path.join(dir, '.lab/lock'), old, old);
  fs.writeFileSync(path.join(dir, '.lab/server.json'), '{"port": 44');
  fs.writeFileSync(path.join(dir, '.lab/key'), 'not a key at all\n', { mode: 0o600 });
  fs.writeFileSync(path.join(dir, '.lab/state.json'), '');
  const port = await freePort();
  const t = Date.now();
  const lab = await attempt(dir, ['.', '--port', String(port)], { port });
  assert.ok(lab.up, lab.out());
  assert.ok(Date.now() - t < 5000, `started in ${Date.now() - t} ms`);
  assert.equal(trace(lab.out()), '');
  const key = fs.readFileSync(path.join(dir, '.lab/key'), 'utf8').trim();
  assert.match(key, /^[0-9a-f]{24}$/);
  const s = JSON.parse(fs.readFileSync(path.join(dir, '.lab/server.json'), 'utf8'));
  assert.deepEqual([s.port, s.pid, s.token], [port, lab.proc.pid, key]);
  for (const f of ['server.json', 'key', 'lock']) assert.equal((fs.statSync(path.join(dir, '.lab', f)).mode & 0o777).toString(8), '600', f);
  await lab.stop();
  assert.ok(!fs.existsSync(path.join(dir, '.lab/lock')), 'the lock goes with the lab');
  assert.ok(!fs.existsSync(path.join(dir, '.lab/server.json')), 'and its server.json');
});

test('a port another program holds: with --port the lab takes the next one and says where it is; with only PORT it says why it can\'t start', async () => {
  const taken = net.createServer((s) => s.end('HTTP/1.1 200 OK\r\ncontent-length: 5\r\n\r\nother'));
  const port = await new Promise((r) => taken.listen(0, '127.0.0.1', () => r(taken.address().port)));
  try {
    const dir = folder('port');
    const lab = await attempt(dir, ['.', '--port', String(port)]);
    assert.ok(lab.up, lab.out());
    assert.ok(lab.port > port && lab.port <= port + 20, `on ${lab.port}, after ${port}`);
    assert.match(lab.out(), new RegExp(`\\[lab\\] http://localhost:${lab.port} `));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.lab/server.json'), 'utf8')).port, lab.port);
    assert.equal((await raw(port, '/')).text, 'other', 'the other program is left alone');
    await lab.stop();
    // The preview pane's port (PORT, no --port) is the one it opens: the lab does not move off it.
    const fixed = await attempt(dir, ['.'], { env: { PORT: String(port) }, wait: 4000 });
    assert.equal(fixed.up, false);
    assert.equal(fixed.code(), 1, fixed.out());
    assert.match(fixed.out(), /^\[lab\] could not start: listen EADDRINUSE/m);
    assert.equal(trace(fixed.out()), '');
    assert.ok(!fs.existsSync(path.join(dir, '.lab/lock')), 'no lock left behind');
  } finally {
    taken.close();
  }
});

test('a port another program holds on ::1 (as "localhost" dev servers do) counts as taken too', { todo: 'the lab probes 127.0.0.1 only' }, async (t) => {
  const taken = net.createServer((s) => s.end('HTTP/1.1 200 OK\r\ncontent-length: 5\r\n\r\nother'));
  const port = await new Promise((r) => taken.once('error', () => r(0)).listen(0, '::1', () => r(taken.address().port)));
  if (!port) return t.skip('no ::1 on this computer');
  try {
    const lab = await attempt(folder('port6'), ['.', '--port', String(port)]);
    assert.ok(lab.up, lab.out());
    await lab.stop();
    assert.notEqual(lab.port, port, `the lab says it is at http://localhost:${port}, where a browser (::1 first) finds the other program`);
  } finally {
    taken.close();
  }
});

test('a port another lab holds: a lab for another folder takes the next one, and both keep their own pages', async () => {
  const [a, b] = [folder('lab-a'), folder('lab-b')];
  fs.writeFileSync(path.join(b, 'index.html'), '<!doctype html><title>b</title><h1>the second</h1>');
  const port = await freePort();
  const first = await attempt(a, ['.', '--port', String(port)], { port });
  assert.ok(first.up, first.out());
  const second = await attempt(b, ['.', '--port', String(port)]);
  assert.ok(second.up, second.out());
  assert.notEqual(second.port, port);
  assert.match((await raw(port, '/')).text, /<h1>index<\/h1>/);
  assert.match((await raw(second.port, '/')).text, /the second/);
  assert.equal((await raw(port, '/_lab/pages')).json.root, a);
  // The same folder again: it says where the lab is and goes, starting nothing.
  const again = await run(a, ['.', '--no-open', '--port', String(port)]);
  assert.equal(again.code, 0);
  assert.match(again.out, new RegExp(`already running for this folder: http://localhost:${port}`));
  await first.stop();
  await second.stop();
});

test('--port with something that is no port says so in a line, with no stack trace', async () => {
  const bad = [];
  for (const value of ['abc', '70000', '99999999', '1.5', '0x50', '']) {
    const lab = await attempt(folder('badport'), ['.', '--port', value], { wait: 2500 });
    await lab.stop();
    if (trace(lab.out())) bad.push(`--port ${JSON.stringify(value)}: ${trace(lab.out())}`);
  }
  assert.deepEqual(bad, []);
});

const BROKEN_TYPES = { port: 'abc', open: 'yes', batchSeconds: -1, stopListeningAfterMinutes: 'x', remindAfterMinutes: null, archiveAfterDays: 0, updateCheck: 'no', name: 5, model: {}, pagesFolder: [], shortcuts: ['m'], flags: 'on', actions: { name: 'x' }, wifi: 'yes', nope: 1, proxy: '3000', folder: 'x' };
test('a settings.json of broken types: each one is said and skipped, and the lab runs on the defaults', async () => {
  const cfg = tmp('cfg');
  dirs.push(cfg);
  fs.mkdirSync(path.join(cfg, 'labit'));
  const file = path.join(cfg, 'labit/settings.json');
  fs.writeFileSync(file, JSON.stringify(BROKEN_TYPES));
  const dir = folder('settings');
  const port = await freePort();
  const lab = await attempt(dir, ['.', '--port', String(port)], { port, env: { XDG_CONFIG_HOME: cfg } });
  assert.ok(lab.up, lab.out());
  assert.equal(trace(lab.out()), '');
  const said = lab.out().split('\n').filter((l) => l.startsWith('[labit] ') && /ignored/.test(l));
  // (port, open, folder, batchSeconds and updateCheck are set by this start's own flags and variables, which win: the file's are not looked at)
  // (actions that are not a list are the form of before: a start writes today's list in their place, by design)
  const given = ['port', 'open', 'folder', 'batchSeconds', 'updateCheck', 'actions'];
  for (const key of Object.keys(BROKEN_TYPES).filter((k) => !given.includes(k))) assert.ok(said.some((l) => l.includes(`: ${key} `)), `${key} is said:\n${said.join('\n')}`);
  assert.match((await raw(port, '/')).text, /<h1>index<\/h1>/);
  assert.equal((await raw(port, '/_lab/pages')).json.wifi, false);
  assert.equal((await raw(port, '/', { to: '127.0.0.1' })).status, 200);
  const post = await raw(port, '/_lab/api/comments', { method: 'POST', body: JSON.stringify({ page: '/index', name: 'Leo', text: 'works', anchor: { selector: 'h1' } }), headers: { 'content-type': 'application/json', origin: `http://localhost:${port}` } });
  assert.equal(post.status, 201);
  // The name the page gives is still saved beside the broken ones, which stay as they are for the person to fix.
  assert.equal((await raw(port, '/_lab/me', { method: 'POST', body: '{"name":"Leo"}', headers: { 'content-type': 'application/json', origin: `http://localhost:${port}` } })).status, 204);
  const now = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual([now.name, now.port, now.flags, now.shortcuts], ['Leo', 'abc', 'on', ['m']]);
  await lab.stop();
  // With no flag or variable in the way, `labit settings` names every one of them, and shows the defaults in force.
  const shown = await run(dir, ['settings'], { XDG_CONFIG_HOME: cfg, LAB_SETTLE_MS: '', LABIT_NO_UPDATE_CHECK: '' });
  assert.equal(shown.code, 1, 'labit settings fails on a problem');
  assert.equal(trace(shown.out), '');
  for (const key of Object.keys(BROKEN_TYPES).filter((k) => k !== 'actions' && k !== 'name')) assert.match(shown.out, new RegExp(`^\\[labit\\] .*settings\\.json: ${key} .*ignored$`, 'm'), key);
  assert.match(shown.out, /^port\s+4400\s+default$/m);
  assert.match(shown.out, /^name\s+Leo\s+your settings$/m, 'the name given on the page is the one in force');
  assert.match(shown.out, /^batchSeconds\s+2\s+default$/m);
});

test('a settings.json that is no settings at all (cut short, empty, a list, null, bytes, a folder): said, left exactly as it is, and the lab runs', async () => {
  const bad = [];
  for (const [what, content] of [['cut short', '{"port": 44'], ['empty', ''], ['a list', '[1,2]'], ['null', 'null'], ['a string', '"settings"'], ['bytes', Buffer.from([0xff, 0xfe, 0x00, 0x7b, 0x80])], ['a folder', null], ['with a BOM', '﻿{"name":"Leo"}']]) {
    const cfg = tmp('cfg');
    dirs.push(cfg);
    fs.mkdirSync(path.join(cfg, 'labit'));
    const file = path.join(cfg, 'labit/settings.json');
    if (content === null) fs.mkdirSync(file);
    else fs.writeFileSync(file, content);
    const dir = folder('nosettings');
    const port = await freePort();
    const lab = await attempt(dir, ['.', '--port', String(port)], { port, env: { XDG_CONFIG_HOME: cfg }, wait: 4000 });
    if (!lab.up) bad.push(`${what}: the lab does not start (${trace(lab.out()) || `exit ${lab.code()}`})`);
    else {
      if (trace(lab.out())) bad.push(`${what}: ${trace(lab.out())}`);
      if ((await raw(port, '/')).status !== 200) bad.push(`${what}: no page`);
      // The page names the person (saved to settings): refused or skipped, never a 500 and never written over the file.
      const me = await raw(port, '/_lab/me', { method: 'POST', body: '{"name":"Leo"}', headers: { 'content-type': 'application/json', origin: `http://localhost:${port}` } });
      if (me.status >= 500) bad.push(`${what}: naming yourself → ${me.status} ${me.text.slice(0, 60)}`);
      if (lab.code() !== null) bad.push(`${what}: the lab went down`);
    }
    await lab.stop();
    if (content !== null && what !== 'with a BOM' && Buffer.compare(fs.readFileSync(file), Buffer.from(content)) !== 0) bad.push(`${what}: the file was written over`);
    if (content === null && !fs.statSync(file).isDirectory()) bad.push('a folder: replaced');
    const shown = await run(dir, ['settings'], { XDG_CONFIG_HOME: cfg });
    if (trace(shown.out)) bad.push(`${what}: labit settings → ${trace(shown.out)}`);
  }
  assert.deepEqual(bad, []);
});

test('a labit.json with unknown settings, wrong types, the old flags and settings that are not a project\'s to give: said, skipped, and the lab runs', async () => {
  const dir = folder('labitjson');
  fs.writeFileSync(path.join(dir, 'labit.json'), JSON.stringify({ $schema: 'x', zoom: 2, nope: { deep: [1] }, port: 'x', proxy: 5, folder: 7, open: 'no', wifi: true, name: 'Mallory', model: 'evil-model', pagesFolder: '/tmp/x',
    flags: { nope: true, inkOnText: true }, shortcuts: { toggle: 'mm', nope: 'x', next: 5, chat: 'q' }, batchSeconds: '2' }));
  const port = await freePort();
  const lab = await attempt(dir, ['.', '--port', String(port)], { port });
  assert.ok(lab.up, lab.out());
  assert.equal(trace(lab.out()), '');
  const said = lab.out().split('\n').filter((l) => l.startsWith('[labit] '));
  for (const key of ['zoom', 'nope', 'proxy']) assert.ok(said.some((l) => l.includes(`labit.json: ${key} `) && /ignored/.test(l)), `${key}:\n${said.join('\n')}`);
  for (const key of ['wifi', 'name', 'model', 'pagesFolder']) assert.ok(said.some((l) => l.includes(`labit.json: ${key} can only be set in your own settings`)), `${key} is yours alone:\n${said.join('\n')}`);
  assert.ok(!said.some((l) => /flags/.test(l)), `the old flags are skipped without a word:\n${said.join('\n')}`);
  for (const part of ['shortcuts .toggle must be one letter or digit', 'shortcuts .nope is not an action', 'shortcuts .next must be one letter or digit']) assert.ok(said.some((l) => l.includes(part)), `${part}:\n${said.join('\n')}`);
  const info = (await raw(port, '/_lab/pages')).json;
  assert.deepEqual([info.wifi, info.port, info.proxy], [false, port, null]);
  const html = (await raw(port, '/')).text;
  assert.doesNotMatch(html, /Mallory|evil/);
  await lab.stop();
  // A labit.json that is not an object of settings, or not JSON, or a folder: said, and the lab runs.
  for (const [what, content] of [['cut short', '{"port": 44'], ['a list', '[]'], ['null', 'null'], ['empty', ''], ['a folder', null]]) {
    fs.rmSync(path.join(dir, 'labit.json'), { recursive: true, force: true });
    if (content === null) fs.mkdirSync(path.join(dir, 'labit.json'));
    else fs.writeFileSync(path.join(dir, 'labit.json'), content);
    const one = await attempt(dir, ['.', '--port', String(port)], { port });
    assert.ok(one.up, `${what}: ${one.out()}`);
    assert.equal(trace(one.out()), '', what);
    assert.match(one.out(), /\[labit\] .*labit\.json: not (valid JSON|an object of settings)/, what);
    await one.stop();
  }
});

test('a labit.json whose values have the right type but can\'t be used says so in a line, with no stack trace', async () => {
  const bad = [];
  for (const [what, json, args] of [
    ['a proxy that is no address', { proxy: 'nonsense' }, ['.', '--port', '0']],
    ['a proxy port past the last one', { proxy: '99999' }, ['.', '--port', '0']],
    ['a port past the last one', { port: 99999 }, ['.']],
    ['a port and a half', { port: 4400.5 }, ['.']],
    ['a folder that is not there', { folder: 'missing-folder' }, []],
    ['a folder that is a file', { folder: 'index.html' }, []],
  ]) {
    const dir = folder('unusable');
    fs.writeFileSync(path.join(dir, 'labit.json'), JSON.stringify(json));
    const lab = await attempt(dir, args, { wait: 2500 });
    await lab.stop();
    if (trace(lab.out())) bad.push(`${what} (${JSON.stringify(json)}): ${trace(lab.out())}`);
    else if (!lab.up && !/\S/.test(lab.out())) bad.push(`${what}: it went without a word`);
  }
  assert.deepEqual(bad, []);
});
