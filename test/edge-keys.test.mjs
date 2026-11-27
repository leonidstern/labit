// A pin's edit key (the key its starter's browser keeps) at the edges, on a local lab: wrong, missing and odd-typed
// keys, another pin's and another page's key, a key used again and again, after a delete, after a restart, the other
// keys in its place, bad moves, and where the key must never show up. No browser.
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
const raw = (port, p, { method = 'GET', headers = {}, body } = {}) =>
  new Promise((done) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host: `localhost:${port}`, ...headers } }, (res) => {
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
const DIR = tmp('keys');
after(async () => {
  for (const l of labs) await l.stop();
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
});
for (const n of ['index', 'other']) fs.writeFileSync(path.join(DIR, `${n}.html`), `<!doctype html><title>${n}</title><h1>${n}</h1>`);
const PORT = await freePort();
let lab = await startLab(DIR, PORT);

const send = (body, headers = {}) => raw(PORT, '/_lab/api/comments', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', origin: lab.B, ...headers } });
const pin = async (page, text) => (await send({ page, name: 'Leo', text, anchor: { selector: 'h1', x: 0.5, y: 0.5, docY: 10 } })).json;
const list = async (page) => (await raw(PORT, `/_lab/api/comments?page=${page}`)).json.comments;
const one = async (page, id) => (await list(page)).find((c) => c.id === id);
const anchor = { selector: 'h2', x: 0.2, y: 0.2 };
const ACTIONS = ['resolve', 'reopen', 'delete', 'move'];

test('a pin comes with a key of its own; a reply and a listing never carry one', async () => {
  const a = await pin('/index', 'a');
  const b = await pin('/index', 'b');
  assert.match(a.edit, /^[\w-]{24}$/);
  assert.notEqual(a.edit, b.edit);
  const reply = (await send({ page: '/index', parent: a.comment.id, name: 'Bo', text: 'reply' })).json;
  assert.equal(reply.edit, undefined, 'a reply gets no key');
  const listing = await raw(PORT, '/_lab/api/comments?page=/index');
  assert.equal(listing.json.admin, false, 'a plain read is not the owner');
  assert.ok(!listing.text.includes(a.edit) && !listing.text.includes(b.edit));
});

test('a wrong, missing or odd-typed key opens nothing, and is never a 500', async () => {
  const a = await pin('/index', 'guarded');
  const id = a.comment.id;
  const keys = [undefined, null, '', 'guess', 'A'.repeat(24), a.edit.slice(0, 23), a.edit + 'x', a.edit.toUpperCase() === a.edit ? a.edit.toLowerCase() : a.edit.toUpperCase(), ` ${a.edit}`, 0, 1, true, [a.edit], { edit: a.edit }, { length: 24 }, 'x'.repeat(100000)];
  for (const edit of keys) {
    if (typeof edit === 'string' && edit === a.edit) continue; // a key with no letters to change case on
    for (const action of ACTIONS) {
      const r = await send({ page: '/index', action, id, anchor, ...(edit === undefined ? {} : { edit }) });
      assert.equal(r.status, 403, `${action} with ${JSON.stringify(edit)?.slice(0, 40)} → ${r.status} ${r.text.slice(0, 80)}`);
    }
  }
  // The key in a header or the query is not the key.
  assert.equal((await send({ page: '/index', action: 'resolve', id }, { 'x-lab-edit': a.edit, authorization: `Bearer ${a.edit}` })).status, 403);
  assert.equal((await raw(PORT, `/_lab/api/comments?edit=${a.edit}`, { method: 'POST', body: JSON.stringify({ page: '/index', action: 'resolve', id }), headers: { 'content-type': 'application/json', origin: lab.B } })).status, 403);
  const now = await one('/index', id);
  assert.deepEqual([now.resolved, now.anchor.selector, now.movedAt], [false, 'h1', undefined], 'untouched');
});

test('a key opens its own pin on its own page: not another pin, not the same id asked for on another page, not a reply', async () => {
  const a = await pin('/index', 'mine');
  const b = await pin('/index', 'another on the page');
  const c = await pin('/other', 'on another page');
  const reply = (await send({ page: '/index', parent: a.comment.id, name: 'Bo', text: 'reply' })).json.comment;
  for (const action of ACTIONS) {
    assert.equal((await send({ page: '/index', action, id: b.comment.id, anchor, edit: a.edit })).status, 403, `${action}: another pin`);
    assert.equal((await send({ page: '/other', action, id: c.comment.id, anchor, edit: a.edit })).status, 403, `${action}: a pin on another page`);
    assert.equal((await send({ page: '/other', action, id: a.comment.id, anchor, edit: a.edit })).status, 403, `${action}: its own id, another page`);
    assert.equal((await send({ page: '/index', action, id: reply.id, anchor, edit: a.edit })).status, 403, `${action}: a reply in its thread`);
    assert.equal((await send({ page: '/index', action, id: c.comment.id, anchor, edit: c.edit })).status, 403, `${action}: another page's pin and key, asked for here`);
  }
  for (const [page, id] of [['/index', b.comment.id], ['/other', c.comment.id]]) assert.equal((await one(page, id)).resolved, false);
  assert.ok(await one('/index', reply.id), 'the reply is still there');
});

test('a key works again and again while its pin lives, and for nothing once it is taken back', async () => {
  const a = await pin('/index', 'again and again');
  const id = a.comment.id;
  const act = (action, more = {}) => send({ page: '/index', action, id, edit: a.edit, ...more });
  for (let i = 0; i < 3; i++) {
    assert.equal((await act('resolve')).status, 200);
    assert.equal((await act('reopen')).status, 200);
    assert.equal((await act('move', { anchor: { selector: `h${i + 2}`, x: 0.1, y: 0.1 } })).status, 200);
  }
  const moved = await one('/index', id);
  assert.deepEqual([moved.resolved, moved.anchor.selector, moved.resolvedBy], [false, 'h4', undefined]);
  // Its starter's undo (a fresh pin nobody answered), then the same key again: nothing left to open.
  assert.equal((await act('delete')).status, 200);
  assert.deepEqual([(await act('delete')).status, (await act('resolve')).status, (await act('reopen')).status, (await act('move', { anchor })).status], [404, 404, 404, 404]);
  assert.equal(await one('/index', id), undefined);
  // And the key of a pin that is gone opens no other pin.
  const b = await pin('/index', 'made after');
  assert.equal((await send({ page: '/index', action: 'resolve', id: b.comment.id, edit: a.edit })).status, 403);
});

test('the other keys are not edit keys: the page key and the agent key as "edit", an edit key as the admin header', async () => {
  const { token, agent } = lab.keys();
  const a = await pin('/index', 'key mix');
  const b = await pin('/index', 'key mix 2');
  for (const action of ACTIONS) {
    assert.equal((await send({ page: '/index', action, id: a.comment.id, anchor, edit: token })).status, 403, `${action}: the page key as edit`);
    assert.equal((await send({ page: '/index', action, id: a.comment.id, anchor, edit: agent })).status, 403, `${action}: the agent key as edit`);
    assert.equal((await send({ page: '/index', action, id: b.comment.id, anchor }, { 'x-lab-admin': a.edit })).status, 403, `${action}: an edit key as x-lab-admin`);
    assert.equal((await send({ page: '/index', action, id: b.comment.id, anchor }, { 'x-lab-admin': a.edit, 'x-lab-agent': '1' })).status, 403, `${action}: an edit key as the agent's`);
  }
  // The agent's line of progress is the agent's (or the owner's) alone.
  assert.equal((await send({ page: '/index', action: 'progress', id: a.comment.id, text: 'on it', edit: a.edit })).status, 403);
  assert.equal((await send({ page: '/index', action: 'progress', id: a.comment.id, text: 'on it' }, { 'x-lab-admin': agent, 'x-lab-agent': '1' })).status, 200);
});

test('a move with its key: a spot that is no spot is refused (400), a huge one is cut, a found-again one moves the path and what the pin is now, nothing else', async () => {
  const a = await pin('/index', 'move me');
  const id = a.comment.id;
  for (const bad of [undefined, null, 'h2', 5, true, 0, '']) {
    const r = await send({ page: '/index', action: 'move', id, edit: a.edit, ...(bad === undefined ? {} : { anchor: bad }) });
    assert.equal(r.status, 400, `anchor ${JSON.stringify(bad)} → ${r.status} ${r.text.slice(0, 80)}`);
  }
  assert.equal((await one('/index', id)).movedAt, undefined, 'not moved by any of those');
  const big = await send({ page: '/index', action: 'move', id, edit: a.edit, anchor: { selector: 's'.repeat(100000), x: 9, y: -9, docY: 1e12, text: 't'.repeat(5000), junk: 'j'.repeat(5000) } });
  assert.equal(big.status, 200);
  assert.deepEqual([big.json.comment.anchor.selector.length, big.json.comment.anchor.x, big.json.comment.anchor.y, big.json.comment.anchor.docY, big.json.comment.anchor.text.length, big.json.comment.anchor.junk], [600, 1, 0, 100000, 80, undefined]);
  const found = await send({ page: '/index', action: 'move', id, edit: a.edit, found: true, anchor: { selector: 'main > h1', docX: 0.3, docY: 44, eh: 20, text: 'other words' } });
  assert.equal(found.status, 200);
  assert.deepEqual([found.json.comment.anchor.selector, found.json.comment.anchor.docY, found.json.comment.anchor.text.length], ['main > h1', 44, 11], 'the path, the place and the words it learned; the share of its element stays');
  // A reply can't be moved, by its thread's key or by the owner.
  const reply = (await send({ page: '/index', parent: id, name: 'Bo', text: 'reply' })).json.comment;
  assert.equal((await send({ page: '/index', action: 'move', id: reply.id, anchor }, { 'x-lab-admin': lab.keys().token })).status, 400);
});

let kept;
test('a key is never written where others read: the list, the agent text, comments.md, the store, the live state', async () => {
  kept = await pin('/other', 'kept across a restart');
  await sleep(300);
  const { token, agent } = lab.keys();
  const places = {
    list: (await raw(PORT, '/_lab/api/comments?page=/other')).text,
    'agent text': (await raw(PORT, '/_lab/agent/other')).text,
    state: (await raw(PORT, '/_lab/state')).text,
    pages: (await raw(PORT, '/_lab/pages')).text,
    changes: (await raw(PORT, '/_lab/api/changes?page=/other&since=0')).text,
    'comments.md': fs.readFileSync(path.join(DIR, '.lab/comments.md'), 'utf8'),
    store: fs.readdirSync(path.join(DIR, '.lab/comments')).map((n) => fs.readFileSync(path.join(DIR, '.lab/comments', n), 'utf8')).join('\n'),
    'state.json': fs.existsSync(path.join(DIR, '.lab/state.json')) ? fs.readFileSync(path.join(DIR, '.lab/state.json'), 'utf8') : '',
    'the lab\'s own output': lab.out(),
  };
  for (const [where, text] of Object.entries(places)) {
    assert.ok(!text.includes(kept.edit), `the edit key is not in ${where}`);
    assert.ok(!text.includes(agent), `the agent key is not in ${where}`);
    if (where !== 'the lab\'s own output') assert.ok(!text.includes(token), `the page key is not in ${where}`);
  }
  // The page key is in the page, for this computer; the agent key is in no page.
  const html = (await raw(PORT, '/other')).text;
  assert.ok(html.includes(`data-admin="${token}"`));
  assert.ok(!html.includes(agent));
  for (const f of ['server.json', 'key']) assert.equal((fs.statSync(path.join(DIR, '.lab', f)).mode & 0o777).toString(8), '600', `${f} is the owner's alone`);
});

test('a key still opens its pin after the lab starts again; the agent key of the old run opens nothing', async () => {
  const old = lab.keys().agent;
  await lab.stop();
  lab = await startLab(DIR, PORT);
  assert.notEqual(lab.keys().agent, old);
  assert.equal((await send({ page: '/other', action: 'move', id: kept.comment.id, edit: kept.edit, anchor })).status, 200);
  assert.equal((await send({ page: '/other', action: 'resolve', id: kept.comment.id, edit: kept.edit })).status, 200);
  assert.equal((await one('/other', kept.comment.id)).resolvedBy, 'author');
  assert.equal((await raw(PORT, '/_lab/pending', { headers: { 'x-lab-agent': '1', 'x-lab-admin': old } })).status, 403);
  const stale = await send({ page: '/other', parent: kept.comment.id, name: 'Claude', text: 'Done.' }, { 'x-lab-agent': '1', 'x-lab-admin': old });
  assert.equal(stale.json?.comment?.session, undefined, 'a reply under the old agent key is not the agent\'s');
});
