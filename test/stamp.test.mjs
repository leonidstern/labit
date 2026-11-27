// One write for a new comment: who wrote it, intent and auto-resolve are saved by the API itself.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { H1 as anchor, site, rm, spawnLab, sleep, up, serverJson } from './harness.mjs';

const { DIR, PORT, B } = site('stamp', 8500, 90);
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><h1>Hi</h1>');
const server = spawnLab(DIR, PORT, { env: { ...process.env, LABIT_NO_UPDATE_CHECK: '1' } });
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));
after(() => { server.kill(); rm([DIR]); });
await up(B + '/', { fail: false });
const srv = serverJson(DIR);
const session = encodeURIComponent(JSON.stringify({ id: 's1', name: 'Sess', agent: 'Claude', model: 'm', kind: '', url: 'https://claude.ai/x', resume: 'r' }));
const send = (body, h = {}, raw) => fetch(B + '/_lab/api/comments?page=%2Fp', { method: 'POST', headers: { 'content-type': 'application/json', origin: B, ...h }, body: raw ?? JSON.stringify(body) });
const person = async (body, h) => (await (await send(body, h)).json()).comment;
const agent = async (body) => (await (await send(body, { 'x-lab-admin': srv.agent, 'x-lab-agent': '1', 'x-lab-session': session })).json()).comment;
const list = async (page = '/p') => (await (await fetch(`${B}/_lab/api/comments?page=${encodeURIComponent(page)}`)).json()).comments;
const get = async (id, page) => (await list(page)).find((c) => c.id === id);
const thread = (text, page = '/p', a = anchor) => person({ name: 'Leo', text, page, anchor: a });

test('person: from this computer, no session; agent: session without url/resume, no from', async () => {
  const t = await thread('red');
  assert.equal(t.from, 'this computer');
  assert.equal(t.session, undefined);
  const r = await agent({ name: 'Claude', text: 'hi', parent: t.id, page: '/p' });
  assert.deepEqual(r.session, { id: 's1', name: 'Sess', agent: 'Claude', model: 'm' });
  assert.equal(r.from, undefined);
  assert.equal(r.intent, undefined);
});

test('intent from words, explicit intent wins, a person never gets one', async () => {
  const t = await thread('red');
  assert.equal((await agent({ name: 'C', text: 'On it, soon', parent: t.id, page: '/p' })).intent, 'working');
  assert.equal((await agent({ name: 'C', text: 'Done: x', parent: t.id, page: '/p', intent: 'question' })).intent, 'question');
  assert.equal((await agent({ name: 'C', text: 'Doner', parent: t.id, page: '/p' })).intent, undefined);
  // "On it" opening a real answer is not a status: only a short line without a full stop reads as one.
  assert.equal((await agent({ name: 'C', text: 'On it, fixed by moving the header up. Reload to see it.', parent: t.id, page: '/p' })).intent, undefined);
  assert.equal((await agent({ name: 'C', text: `On it, ${'x'.repeat(80)}`, parent: t.id, page: '/p' })).intent, undefined);
  assert.equal((await agent({ name: 'C', text: 'On it, rebuilding', parent: t.id, page: '/p' })).intent, 'working');
  const p = await person({ name: 'Leo', text: 'Done thanks', parent: t.id, page: '/p', intent: 'done' });
  assert.equal(p.intent, undefined);
  assert.equal((await get(t.id)).resolved, false);
});

test('auto-resolve: implicit Done with one ask; explicit done with several; list; page chat; question', async () => {
  const one = await thread('one');
  await agent({ name: 'C', text: 'Done.', parent: one.id, page: '/p' });
  const g = await get(one.id);
  assert.equal(g.resolved, true); assert.equal(g.resolvedBy, 'agent');

  const two = await thread('a'); await person({ name: 'Leo', text: 'b', parent: two.id, page: '/p' });
  await agent({ name: 'C', text: 'Done both', parent: two.id, page: '/p' });
  assert.equal((await get(two.id)).resolved, false, 'implicit with 2 asks stays open');
  await agent({ name: 'C', text: 'both', parent: two.id, page: '/p', intent: 'done' });
  assert.equal((await get(two.id)).resolved, true, 'explicit closes');

  const lst = await thread('1) a\n2) b');
  await agent({ name: 'C', text: 'Done', parent: lst.id, page: '/p' });
  assert.equal((await get(lst.id)).resolved, false, 'list stays open on implicit');
  await agent({ name: 'C', text: 'ok', parent: lst.id, page: '/p', intent: 'done' });
  assert.equal((await get(lst.id)).resolved, true);

  const pg = await thread('chat', '/p', { ...anchor, kind: 'page' });
  const pr = await agent({ name: 'C', text: 'ok', parent: pg.id, page: '/p', intent: 'done' });
  assert.equal(pr.intent, 'done');
  assert.equal((await get(pg.id)).resolved, false, 'page chat never');

  const q = await thread('q');
  await agent({ name: 'C', text: 'Which?', parent: q.id, page: '/p', intent: 'question' });
  assert.equal((await get(q.id)).resolved, false);
  const w = await thread('w');
  await agent({ name: 'C', text: 'On it', parent: w.id, page: '/p' });
  assert.equal((await get(w.id)).resolved, false);
});

test('reply to a reply resolves the root; asks since the agent last spoke; already resolved keeps resolvedAt; person reopens', async () => {
  const t = await thread('x');
  const r1 = await agent({ name: 'C', text: 'On it', parent: t.id, page: '/p' });
  await person({ name: 'Leo', text: 'more', parent: t.id, page: '/p' });
  await agent({ name: 'C', text: 'Done', parent: r1.id, page: '/p' }); // parent is a reply
  const g = await get(t.id);
  assert.equal(g.resolved, true, 'one ask since the agent last spoke');
  const at = g.resolvedAt;
  await sleep(10);
  await agent({ name: 'C', text: 'Done again', parent: t.id, page: '/p', intent: 'done' });
  assert.equal((await get(t.id)).resolvedAt, at, 'not when already resolved');
  await person({ name: 'Leo', text: 'still broken', parent: t.id, page: '/p' });
  const re = await get(t.id);
  assert.equal(re.resolved, false); assert.equal(re.resolvedBy, undefined);
});

test('forgery: browser stamp headers are replaced; no key, wrong key, bad JSON', async () => {
  const forged = { 'x-lab-stamp-key': 'guess', 'x-lab-stamp': encodeURIComponent(JSON.stringify({ session: { name: 'Claude' }, from: 'wifi guest' })) };
  const t = await person({ name: 'Leo', text: 'f', page: '/p', anchor }, forged);
  assert.equal(t.from, 'this computer'); assert.equal(t.session, undefined);
  // person claiming agent
  const r = await person({ name: 'Leo', text: 'Done', parent: t.id, page: '/p', intent: 'done' }, { ...forged, 'x-lab-agent': '1' });
  assert.equal(r.session, undefined); assert.equal(r.intent, undefined);
  assert.equal((await get(t.id)).resolved, false);
  // agent with forged stamp
  const a = await (await send({ name: 'C', text: 'x', parent: t.id, page: '/p' }, { 'x-lab-admin': srv.agent, 'x-lab-agent': '1', 'x-lab-session': session, 'x-lab-stamp': encodeURIComponent(JSON.stringify({ session: { name: 'evil' } })) })).json();
  assert.equal(a.comment.session.name, 'Sess');
  // bad json / bad session header
  const bad = await send(null, {}, '{nope');
  assert.equal(bad.status, 400);
  const bs = await (await send({ name: 'C', text: 'y', parent: t.id, page: '/p' }, { 'x-lab-admin': srv.agent, 'x-lab-agent': '1', 'x-lab-session': '%E0%A4%A' })).json();
  assert.equal(bs.comment.session.name, 'Claude');
  // direct to the API module: missing/empty key, bad stamp
  process.env.LAB_STAMP_KEY = 'k'.repeat(16);
});

test('agent text and console announce work for a person comment', async () => {
  await thread('announce me please');
  await sleep(300);
  assert.match(log, /comment \d+ on .*Leo \(this computer\): announce me please/);
  const txt = await (await fetch(`${B}/_lab/agent/p`, { headers: { 'x-lab-admin': srv.agent, 'x-lab-agent': '1' } })).text();
  assert.match(txt, /announce me please/);
  assert.match(txt, /this computer/);
});
