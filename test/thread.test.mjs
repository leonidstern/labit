// labit thread <id>: one thread whole, every message, open or resolved, by the thread's id or a reply's (#425).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { site, tmp, rm, spawnLab, up, cli as command } from './harness.mjs';

const HOME = tmp('thread');
const { DIR, PORT, B } = site('thread-lab', 9400, 40);
const base = { ...process.env, XDG_CONFIG_HOME: HOME, PORT: '', LABIT_NO_UPDATE_CHECK: '1', CLAUDE_CODE_SESSION_ID: 'thread-1' };
fs.writeFileSync(path.join(DIR, 'package.json'), '{}');
fs.writeFileSync(path.join(DIR, 'bar.html'), '<!doctype html><title>Bar</title><p id="x">Hi</p>');
const lab = spawnLab(DIR, PORT, { flags: ['--new'], env: base });
after(() => { lab.kill(); rm([HOME, DIR]); });
const cli = (...args) => command(args, { cwd: DIR, env: base, timeout: 30000 });
const post = async (body) => (await (await fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/bar', ...body }) })).json()).comment;
const pinOf = (t) => post({ name: 'leo', text: t, anchor: { kind: 'element', selector: '#x', x: 0.5, y: 0.5 } });

test('setup', async () => {
  await up(B + '/', { fail: false });
});

test('a resolved thread is printed whole, every message, and only that thread', async () => {
  const other = await pinOf('another pin');
  const pin = await pinOf('make it green');
  const replies = [];
  for (let i = 1; i <= 12; i++) replies.push(await post({ name: 'leo', text: i === 1 ? 'actually not green: bold' : `note ${i}`, parent: pin.id }));
  assert.equal((await cli('reply', pin.id, 'Made it bold.', '--done')).code, 0); // closes it
  const out = await cli('thread', pin.id);
  assert.equal(out.code, 0, out.out);
  assert.match(out.out, new RegExp(`id ${pin.id} · resolved `));
  assert.match(out.out, /^comment: make it green$/m);
  assert.match(out.out, /actually not green: bold/, 'the early revision is there');
  assert.match(out.out, /note 12/);
  assert.match(out.out, /Made it bold\./);
  assert.doesNotMatch(out.out, /another pin/, 'only that thread');
  const byReply = await cli('thread', replies[4].id);
  assert.equal(byReply.out, out.out, "a reply's id gives its thread");
  assert.ok(other.id);
});
