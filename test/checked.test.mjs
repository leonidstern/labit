// labit reply --done --checked "<how>" was dropped (27 Nov). An agent on an old skill that still passes it keeps its
// reply, and a saved answer that carries checked loads as any other: the field is ignored.
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
// Saved before the drop: a thread, a done answer with checked, and the person's word after it (so the thread is open).
const at = (s) => `2026-11-24T10:00:0${s}.000Z`;
const old = {
  aaaaaaaaaaaa: { id: 'aaaaaaaaaaaa', v: 2, page: '/bar', name: 'leo', text: 'make it blue', createdAt: at(0), anchor: { kind: 'element', selector: '#x', x: 0.5, y: 0.5 } },
  bbbbbbbbbbbb: { id: 'bbbbbbbbbbbb', v: 2, page: '/bar', parent: 'aaaaaaaaaaaa', name: 'Claude', text: 'Made it blue.', createdAt: at(1), session: { agent: 'claude' }, intent: 'done', checked: 'opened /bar at 390 px' },
  cccccccccccc: { id: 'cccccccccccc', v: 2, page: '/bar', parent: 'aaaaaaaaaaaa', name: 'leo', text: 'still wrong', createdAt: at(2) },
};
fs.mkdirSync(path.join(DIR, '.lab/comments'), { recursive: true });
fs.writeFileSync(path.join(DIR, '.lab/comments/bar.json'), JSON.stringify({ v: 2, page: '/bar', comments: old }));
const lab = spawnLab(DIR, PORT, { flags: ['--new'], env: base });
after(() => { lab.kill(); rm([HOME, DIR]); });
const cli = (...args) => command(args, { cwd: DIR, env: base, timeout: 30000 });
const all = async () => (await (await fetch(`${B}/_lab/api/comments?page=/bar`)).json()).comments;

test('setup', async () => {
  await up(B + '/', { fail: false });
});

test('a saved done answer with checked loads, and the agent text says nothing about it', async () => {
  assert.equal((await all()).filter((c) => c.parent === 'aaaaaaaaaaaa').length, 2);
  const text = await (await fetch(`${B}/_lab/agent/bar`)).text();
  assert.match(text, /Made it blue\.$/m);
  assert.doesNotMatch(text, /\((?:not )?checked\b/);
});

test('an old agent passing --checked still answers; the how is not kept', async () => {
  const pin = (await (await fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/bar', name: 'leo', text: 'make it red', anchor: { kind: 'element', selector: '#x', x: 0.5, y: 0.5 } }) })).json()).comment;
  assert.equal((await cli('reply', pin.id, 'Made it red.', '--done', '--checked', 'opened /bar at 390 px')).code, 0);
  const reply = (await all()).find((c) => c.parent === pin.id && c.session);
  assert.equal(reply.text, 'Made it red.');
  assert.equal(reply.checked, undefined);
});
