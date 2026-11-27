// Agent reply/pin nonce: a retried command makes one comment.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { site, tmp, rm, spawnLab, up, cli as command } from './harness.mjs';

const HOME = tmp('nonce');
const { DIR, PORT, B } = site('nonce-lab', 9300, 40);
const base = { ...process.env, XDG_CONFIG_HOME: HOME, PORT: '', LABIT_NO_UPDATE_CHECK: '1' };
delete base.CLAUDE_CODE_SESSION_ID; delete base.CLAUDE_CODE_REMOTE_SESSION_ID; delete base.LAB_SESSION_NAME;
fs.writeFileSync(path.join(DIR, 'package.json'), '{}');
fs.writeFileSync(path.join(DIR, 'bar.html'), '<!doctype html><title>Bar</title><p id="x">Hi</p>');
const lab = spawnLab(DIR, PORT, { flags: ['--new'], env: base });
after(() => { lab.kill(); rm([HOME, DIR]); });
const cli = (sid, ...args) => {
  const env = { ...base }; if (sid) env.CLAUDE_CODE_SESSION_ID = sid;
  return command(args, { cwd: DIR, env, timeout: 30000 });
};
const post = async (body) => (await (await fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/bar', ...body }) })).json()).comment;
const all = async () => (await (await fetch(`${B}/_lab/api/comments?page=/bar`)).json()).comments;
const pinOf = (t) => post({ name: 'leo', text: t, anchor: { kind: 'element', selector: '#x', x: 0.5, y: 0.5 } });
const agentTexts = async (t) => (await all()).filter((c) => c.session && c.text === t);

test('setup', async () => {
  await up(B + '/', { fail: false });
});

test('retried reply is one comment; variations make new ones', async () => {
  const pin = await pinOf('a'); const pin2 = await pinOf('b');
  const S = 'aaaaaaaa-1111-2222-3333-444444444444';
  assert.equal((await cli(S, 'reply', pin.id, 'Fixed it.')).code, 0);
  const r = await cli(S, 'reply', pin.id, 'Fixed it.');
  assert.equal(r.code, 0, r.out); assert.match(r.out, /Replied/);
  assert.equal((await agentTexts('Fixed it.')).length, 1);
  await cli(S, 'reply', pin.id, 'Fixed it!'); assert.equal((await agentTexts('Fixed it!')).length, 1);
  await cli(S, 'reply', pin2.id, 'Fixed it.'); assert.equal((await agentTexts('Fixed it.')).length, 2);
  await cli('bbbbbbbb-1111-2222-3333-444444444444', 'reply', pin.id, 'Fixed it.'); assert.equal((await agentTexts('Fixed it.')).length, 3);
});

test('no session id falls back to name; passes regex', async () => {
  const pin = await pinOf('c');
  assert.equal((await cli('', 'reply', pin.id, 'Nameless.')).code, 0);
  assert.equal((await cli('', 'reply', pin.id, 'Nameless.')).code, 0);
  assert.equal((await agentTexts('Nameless.')).length, 1);
});

test('reply --resolve retried', async () => {
  const pin = await pinOf('d'); const S = 'cccccccc-1';
  assert.equal((await cli(S, 'reply', pin.id, 'Ok.', '--resolve')).code, 0);
  const r = await cli(S, 'reply', pin.id, 'Ok.', '--resolve');
  assert.equal(r.code, 0, r.out);
  assert.equal((await agentTexts('Ok.')).length, 1);
  assert.equal((await all()).find((c) => c.id === pin.id).resolved, true);
});

test('retried reply --wait still waits', async () => {
  const pin = await pinOf('e'); const S = 'dddddddd-1';
  await cli(S, 'reply', pin.id, 'W.');
  const r = await cli(S, 'reply', pin.id, 'W.', '--wait', '--timeout', '1');
  assert.equal(r.code, 0, r.out); assert.match(r.out, /Replied/);
  assert.equal((await agentTexts('W.')).length, 1);
});

test('replayed --done does not resolve a thread the person reopened; two honest identical Done. replies', async () => {
  const S = 'eeeeeeee-1';
  const pin = await pinOf('f');
  assert.equal((await cli(S, 'reply', pin.id, 'Done.', '--done')).code, 0);
  assert.equal((await all()).find((c) => c.id === pin.id).resolved, true);
  await post({ name: 'leo', text: 'one more', parent: pin.id }); // reopens
  assert.equal((await all()).find((c) => c.id === pin.id).resolved, false);
  const r = await cli(S, 'reply', pin.id, 'Done.', '--done');
  assert.equal(r.code, 0);
  const done = (await all()).filter((c) => c.parent === pin.id && c.session && c.text === 'Done.');
  assert.equal(done.length, 2, 'second honest Done. was swallowed');
  assert.equal((await all()).find((c) => c.id === pin.id).resolved, true, 'thread should be resolved again');
});

test('pin retried', async () => {
  const S = 'ffffffff-1';
  const a = await cli(S, 'pin', '#x', 'Look here', '--page', '/bar');
  const b = await cli(S, 'pin', '#x', 'Look here', '--page', '/bar');
  assert.equal(a.code, 0, a.out); assert.equal(b.code, 0, b.out);
  assert.equal((await agentTexts('Look here')).length, 1);
});

test('a browser retry of a pin closed in between gives back that pin, not a second one (#425)', async () => {
  const body = { name: 'leo', text: 'retried after a lost answer', nonce: 'browser-retry-425', anchor: { kind: 'element', selector: '#x', x: 0.5, y: 0.5 } };
  const first = await post(body);
  assert.equal((await cli('gggggggg-1', 'resolve', first.id)).code, 0);
  const again = await post(body);
  assert.equal(again.id, first.id);
  assert.equal((await all()).filter((c) => !c.parent && c.text === body.text).length, 1);
});
