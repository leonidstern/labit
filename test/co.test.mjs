// co-labit's comments API (co/api/comments.mjs): invite keys, names from the key, sites kept apart, no agent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GET, POST, inviteKey, useRedis } from '../co/api/comments.mjs';
import { memoryRedis } from '../co/memory.mjs';

process.env.CO_SECRET = 'test-secret';
useRedis(memoryRedis());
const owner = inviteKey('Leo', true);
const anna = inviteKey('Anna');
const ask = (key, site = 'demo') => ({ 'content-type': 'application/json', ...(key ? { 'x-co-key': key } : {}), 'x-co-site': site });
const list = async (key, page = '/', site = 'demo') => GET(new Request(`http://co/api/comments?page=${encodeURIComponent(page)}`, { headers: ask(key, site) }));
const post = async (key, body, site = 'demo', extra = {}) => POST(new Request('http://co/api/comments', { method: 'POST', headers: { ...ask(key, site), ...extra }, body: JSON.stringify(body) }));
const pin = { kind: 'element', selector: 'h1', x: 0.5, y: 0.5, docX: 10, docY: 10, width: 1000 };

test('no key, a forged key or a revoked one: nothing', async () => {
  assert.equal((await list('')).status, 401);
  assert.equal((await list(anna.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).status, 401);
  assert.equal((await list(inviteKey('Anna', true).replace('.o.', '.p.'))).status, 401);
  process.env.CO_REVOKED = 'anna';
  assert.equal((await list(anna)).status, 401);
  delete process.env.CO_REVOKED;
  assert.equal((await list(anna)).status, 200);
});

test("a comment is the key's name, whatever the page sends, and never an agent's", async () => {
  const res = await post(anna, { page: '/', name: 'Leo', text: 'too big', anchor: pin, intent: 'done', choices: ['a', 'b'] }, 'demo', { 'x-lab-agent': '1', 'x-lab-admin': 'x' });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const { comment, edit } = await res.json();
  assert.equal(comment.name, 'Anna');
  assert.ok(edit);
  assert.equal(comment.session, undefined);
  assert.equal(comment.choices, undefined);
  const reply = await (await post(owner, { page: '/', name: 'x', text: 'on it', parent: comment.id, intent: 'done' })).json();
  assert.equal(reply.comment.name, 'Leo');
  assert.equal(reply.comment.intent, undefined);
  const seen = await (await list(anna)).json();
  assert.deepEqual(seen.comments.map((c) => c.name), ['Anna', 'Leo']);
  assert.equal(seen.comments[0].resolved, false);
  assert.equal(seen.admin, false);
  assert.equal((await (await list(owner)).json()).admin, true);
});

test('the owner resolves and deletes; a guest only their own pin', async () => {
  const { comment } = await (await post(owner, { page: '/x', text: 'mine', anchor: pin })).json();
  assert.equal((await post(anna, { page: '/x', action: 'resolve', id: comment.id })).status, 403);
  assert.equal((await post(anna, { page: '/x', action: 'delete', id: comment.id })).status, 403);
  const own = await (await post(anna, { page: '/x', text: 'hers', anchor: pin })).json();
  assert.equal((await post(anna, { page: '/x', action: 'resolve', id: own.comment.id, edit: own.edit })).status, 200);
  assert.equal((await post(owner, { page: '/x', action: 'delete', id: comment.id })).status, 200);
  const left = (await (await list(owner, '/x')).json()).comments;
  assert.deepEqual(left.map((c) => [c.text, c.resolved]), [['hers', true]]);
});

test('each site keeps its own pages; no agent text', async () => {
  await post(anna, { page: '/', text: 'on the other site', anchor: pin }, 'other');
  assert.equal((await (await list(anna, '/', 'other')).json()).comments.length, 1);
  assert.equal((await (await list(anna, '/', 'demo')).json()).comments.length, 2);
  assert.equal((await GET(new Request('http://co/api/comments?page=/&format=text', { headers: ask(anna) }))).status, 400);
  assert.equal((await post(owner, { page: '/', action: 'progress', id: 'x', text: 'working' })).status, 400);
  assert.equal((await list(anna, '/', '')).status, 400);
});

test('a retry with the same nonce gives back the first comment', async () => {
  const body = { page: '/n', text: 'once', anchor: pin, nonce: 'abcdefgh12' };
  const first = await (await post(anna, body)).json();
  const again = await (await post(anna, body)).json();
  assert.equal(again.comment.id, first.comment.id);
  assert.equal((await (await list(anna, '/n')).json()).comments.length, 1);
});
