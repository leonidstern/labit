// A done answer says whether the agent looked at the result (labit reply --done --checked "<how>"): kept on the answer,
// said in the agent text, and "not checked" when it didn't say (#425).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { site, tmp, rm, spawnLab, up, cli as command } from './harness.mjs';

const HOME = tmp('checked');
const { DIR, PORT, B } = site('checked-lab', 9350, 40);
const base = { ...process.env, XDG_CONFIG_HOME: HOME, PORT: '', LABIT_NO_UPDATE_CHECK: '1', CLAUDE_CODE_SESSION_ID: 'checked-1' };
fs.writeFileSync(path.join(DIR, 'package.json'), '{}');
fs.writeFileSync(path.join(DIR, 'bar.html'), '<!doctype html><title>Bar</title><p id="x">Hi</p>');
const lab = spawnLab(DIR, PORT, { flags: ['--new'], env: base });
after(() => { lab.kill(); rm([HOME, DIR]); });
const cli = (...args) => command(args, { cwd: DIR, env: base, timeout: 30000 });
const post = async (body) => (await (await fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/bar', ...body }) })).json()).comment;
const all = async () => (await (await fetch(`${B}/_lab/api/comments?page=/bar`)).json()).comments;
const pinOf = (t) => post({ name: 'leo', text: t, anchor: { kind: 'element', selector: '#x', x: 0.5, y: 0.5 } });

test('setup', async () => {
  await up(B + '/', { fail: false });
});

test('--checked is kept on a done answer and said to the agent; a done answer without it reads not checked', async () => {
  const a = await pinOf('make it blue');
  assert.equal((await cli('reply', a.id, 'Made it blue.', '--done', '--checked', 'opened /bar at 390 px')).code, 0);
  assert.equal((await all()).find((c) => c.parent === a.id && c.session).checked, 'opened /bar at 390 px');
  const b = await pinOf('make it red');
  assert.equal((await cli('reply', b.id, 'Made it red.', '--done')).code, 0);
  assert.equal((await all()).find((c) => c.parent === b.id && c.session).checked, undefined);
  await post({ name: 'leo', text: 'still wrong', parent: a.id }); // reopened: both threads are listed again
  await post({ name: 'leo', text: 'still wrong', parent: b.id });
  const text = await (await fetch(`${B}/_lab/agent/bar`)).text();
  assert.match(text, /Made it blue\. \(checked: opened \/bar at 390 px\)$/m);
  assert.match(text, /Made it red\. \(not checked\)$/m);
});

test('--checked only goes with --done, and takes how', async () => {
  const c = await pinOf('look');
  assert.notEqual((await cli('reply', c.id, 'On it.', '--on-it', '--checked', 'ran tests')).code, 0);
  assert.notEqual((await cli('reply', c.id, 'Done.', '--done', '--checked')).code, 0);
  assert.equal((await all()).filter((x) => x.parent === c.id).length, 0, 'nothing was sent');
});
