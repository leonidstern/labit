// colabit's comments API (co/api/comments.mjs): typed names, the owner's key, no agent; sites kept apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GET, POST, useRedis } from '../co/api/comments.mjs';
import { memoryRedis } from '../co/memory.mjs';

process.env.LAB_COMMENTS_ADMIN_TOKEN = 'owner-token';
useRedis(memoryRedis());
const OWNER = 'owner-token';
const ask = (admin, site = 'demo', ip = '1.1.1.1') => ({ 'content-type': 'application/json', 'x-co-site': site, 'x-forwarded-for': ip, ...(admin ? { 'x-lab-admin': admin } : {}) });
const list = async (admin, page = '/', site = 'demo') => GET(new Request(`http://co/api/comments?page=${encodeURIComponent(page)}`, { headers: ask(admin, site) }));
const post = async (admin, body, site = 'demo', extra = {}) => POST(new Request('http://co/api/comments', { method: 'POST', headers: { ...ask(admin, site), ...extra }, body: JSON.stringify(body) }));
const pin = { kind: 'element', selector: 'h1', x: 0.5, y: 0.5, docX: 10, docY: 10, width: 1000 };

test('anyone comments under the name they type, never as an agent', async () => {
  const res = await post('', { page: '/', name: 'Anna', text: 'too big', anchor: pin, intent: 'done', choices: ['a', 'b'] }, 'demo', { 'x-lab-agent': '1' });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const { comment, edit } = await res.json();
  assert.equal(comment.name, 'Anna');
  assert.ok(edit);
  assert.equal(comment.session, undefined);
  assert.equal(comment.choices, undefined);
  const reply = await (await post(OWNER, { page: '/', name: 'Leo', text: 'on it', parent: comment.id, intent: 'done' }, 'demo', { 'x-lab-agent': '1' })).json();
  assert.equal(reply.comment.session, undefined);
  assert.equal(reply.comment.intent, undefined);
  const seen = await (await list('')).json();
  assert.deepEqual(seen.comments.map((c) => c.name), ['Anna', 'Leo']);
  assert.equal(seen.comments[0].resolved, false);
  assert.equal(seen.admin, false);
  assert.equal((await (await list(OWNER)).json()).admin, true);
  assert.equal((await (await list('wrong')).json()).admin, false);
});

test('the owner resolves and deletes; others only their own pin', async () => {
  const { comment } = await (await post(OWNER, { page: '/x', name: 'Leo', text: 'mine', anchor: pin })).json();
  assert.equal((await post('', { page: '/x', action: 'resolve', id: comment.id })).status, 403);
  assert.equal((await post('', { page: '/x', action: 'delete', id: comment.id })).status, 403);
  const own = await (await post('', { page: '/x', name: 'Anna', text: 'hers', anchor: pin })).json();
  assert.equal((await post('', { page: '/x', action: 'resolve', id: own.comment.id, edit: own.edit })).status, 200);
  assert.equal((await post(OWNER, { page: '/x', action: 'delete', id: comment.id })).status, 200);
  const left = (await (await list(OWNER, '/x')).json()).comments;
  assert.deepEqual(left.map((c) => [c.text, c.resolved]), [['hers', true]]);
});

test('each site keeps its own pages; no agent text', async () => {
  await post('', { page: '/', name: 'Sam', text: 'on the other site', anchor: pin }, 'other');
  assert.equal((await (await list('', '/', 'other')).json()).comments.length, 1);
  assert.equal((await (await list('', '/', 'demo')).json()).comments.length, 2);
  assert.equal((await GET(new Request('http://co/api/comments?page=/&format=text', { headers: ask('') }))).status, 400);
  assert.equal((await post(OWNER, { page: '/', action: 'progress', id: 'x', text: 'working' })).status, 400);
  assert.equal((await list('', '/', '')).status, 400);
});

test('a retry with the same nonce gives back the first comment', async () => {
  const body = { page: '/n', name: 'Anna', text: 'once', anchor: pin, nonce: 'abcdefgh12' };
  const first = await (await post('', body)).json();
  const again = await (await post('', body)).json();
  assert.equal(again.comment.id, first.comment.id);
  assert.equal((await (await list('', '/n')).json()).comments.length, 1);
});

test('new comments are limited per address and hour, the owner never', async () => {
  process.env.CO_PER_HOUR = '2';
  const from = (ip, admin = '') => POST(new Request('http://co/api/comments', { method: 'POST', headers: ask(admin, 'demo', ip), body: JSON.stringify({ page: '/r', name: 'Bo', text: 'hi', anchor: pin }) }));
  assert.equal((await from('9.9.9.9')).status, 201);
  assert.equal((await from('9.9.9.9')).status, 201);
  assert.equal((await from('9.9.9.9')).status, 429);
  assert.equal((await from('8.8.8.8')).status, 201);
  assert.equal((await from('9.9.9.9', OWNER)).status, 201);
  delete process.env.CO_PER_HOUR;
});

test(`data-site "lab": the colabit's own paths as they are, kept apart from a site of your own`, async () => {
  await post('', { page: '/anna/home', name: 'Sam', text: 'on Anna’s page', anchor: pin }, 'lab');
  assert.equal((await (await list('', '/anna/home', 'lab')).json()).comments.length, 1);
  assert.equal((await (await list('', '/anna/home', 'anna')).json()).comments.length, 0);
  assert.equal((await (await list('anna.anna.signedkeysnotkept', '/anna/home', 'lab')).json()).admin, false);
});

test('co/colabit.mjs adds, lists and removes a person as two rewrites', async () => {
  const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'colabit-'));
  for (const f of ['colabit.mjs', 'vercel.json']) fs.copyFileSync(new URL(`../co/${f}`, import.meta.url), path.join(dir, f));
  const run = (...args) => execFileSync(process.execPath, [path.join(dir, 'colabit.mjs'), ...args], { env: { ...process.env, LAB_COMMENTS_ADMIN_TOKEN: OWNER }, encoding: 'utf8' });
  const out = run('add', 'anna', 'https://anna.example.com/x', '--lab', 'https://lab.example.com');
  assert.match(out, /base path \/anna/);
  const rw = JSON.parse(fs.readFileSync(path.join(dir, 'vercel.json'), 'utf8')).rewrites;
  assert.deepEqual(rw.filter((r) => !r.source.startsWith('/_lab/')), [{ source: '/anna', destination: 'https://anna.example.com/anna' }, { source: '/anna/:path*', destination: 'https://anna.example.com/anna/:path*' }]);
  assert.deepEqual(rw.filter((r) => r.source.startsWith('/_lab/')).map((r) => r.source), ['/_lab/co.js', '/_lab/co/comments']);
  assert.match(run('list'), /\/anna\s+→\s+https:\/\/anna\.example\.com/);
  run('remove', 'anna');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'vercel.json'), 'utf8')).rewrites.length, 2);
  fs.rmSync(dir, { recursive: true });
});
