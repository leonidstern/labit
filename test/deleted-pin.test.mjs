// A pin the person deletes while the agent writes its answer stays deleted: the answer that comes after is dropped,
// not posted, and labit says so instead of "Replied" (Leo, 27 Nov: "if i delete pin and answer not came yet pls
// ignore it and keep deleted").
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { site, tmp, rm, spawnLab, up, serverJson, cli as command } from './harness.mjs';

const HOME = tmp('deleted-pin');
const { DIR, PORT, B } = site('deleted-pin-lab', 9420, 40);
const base = { ...process.env, XDG_CONFIG_HOME: HOME, PORT: '', LABIT_NO_UPDATE_CHECK: '1', CLAUDE_CODE_SESSION_ID: 'deleted-1' };
fs.writeFileSync(path.join(DIR, 'package.json'), '{}');
fs.writeFileSync(path.join(DIR, 'bar.html'), '<!doctype html><title>Bar</title><p id="x">Hi</p>');
const lab = spawnLab(DIR, PORT, { flags: ['--new'], env: base });
after(() => { lab.kill(); rm([HOME, DIR]); });
const cli = (...args) => command(args, { cwd: DIR, env: base, timeout: 30000 });
const api = (body, headers = {}) => fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, ...headers }, body: JSON.stringify({ page: '/bar', ...body }) });
const all = async () => (await (await fetch(`${B}/_lab/api/comments?page=/bar`)).json()).comments;
const pinOf = async (t) => (await (await api({ name: 'leo', text: t, anchor: { kind: 'element', selector: '#x', x: 0.5, y: 0.5 } })).json()).comment;
const remove = (id) => api({ action: 'delete', id }, { 'x-lab-admin': serverJson(DIR).token }); // the person, from the page
const state = () => JSON.parse(fs.readFileSync(path.join(DIR, '.lab/state.json'), 'utf8'));

test('setup', async () => {
  await up(B + '/', { fail: false });
});

test('a reply, a question, progress or a resolve on a deleted pin is dropped, and the pin stays deleted', async () => {
  const p = await pinOf('more');
  assert.equal((await remove(p.id)).status, 200);
  for (const args of [['reply', p.id, 'More of what?', '--choice', 'A', '--choice', 'B'], ['reply', p.id, 'Done.', '--done'], ['reply', p.id, '--progress', 'looking'], ['resolve', p.id]]) {
    const out = await cli(...args);
    assert.equal(out.code, 0, out.out);
    assert.match(out.out, /Dropped: the person deleted that pin/, args.join(' '));
    assert.doesNotMatch(out.out, /Replied|Resolved|Progress noted/);
  }
  assert.ok(!(await all()).some((c) => c.id === p.id || c.parent === p.id), 'nothing came back');
  assert.ok(state().deleted?.[p.id], 'kept in state.json');
});

test('an answer sent straight to the lab after the delete is refused: 410, nothing posted', async () => {
  const p = await pinOf('again');
  assert.equal((await remove(p.id)).status, 200);
  const agent = { 'x-lab-admin': serverJson(DIR).agent, 'x-lab-agent': '1' };
  const res = await api({ parent: p.id, name: 'Claude', text: 'More of what?' }, agent);
  assert.equal(res.status, 410);
  assert.equal((await res.json()).dropped, true);
  assert.ok(!(await all()).some((c) => c.id === p.id || c.parent === p.id));
});

test('other pins are answered as before', async () => {
  const p = await pinOf('keep');
  const out = await cli('reply', p.id, 'On it.', '--on-it');
  assert.equal(out.code, 0, out.out);
  assert.match(out.out, /Replied/);
  assert.ok((await all()).some((c) => c.parent === p.id));
});
