// The agent that changed the page settles a pin the page was unsure of: `pin move <id> <selector>` puts it on the element
// it means (and on words with --quote), `pin gone <id>` says its spot was removed (the page draws a ghost). Both end the
// "spot changed" note; the note itself tells the agent these commands exist.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { numberOf } from '../lib/schema.mjs';
import { site, tmp, rm, spawnLab, up, serverJson, cli as command } from './harness.mjs';

const HOME = tmp('pin-settle');
const { DIR, PORT, B } = site('pin-settle-lab', 10500, 40);
const env = { ...process.env, XDG_CONFIG_HOME: HOME, LABIT_HOME: HOME, PORT: '', LABIT_NO_UPDATE_CHECK: '1', LAB_SETTLE_MS: '100' };
delete env.CLAUDE_CODE_SESSION_ID;
delete env.CLAUDE_CODE_REMOTE_SESSION_ID;
delete env.LAB_SESSION_NAME;
fs.writeFileSync(path.join(DIR, 'package.json'), '{}');
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><title>Home</title><h1 id="t">Plans</h1><p id="p">The quick brown fox jumps over the lazy dog.</p><ul id="l"><li>one<li>two</ul>');
const lab = spawnLab(DIR, PORT, { flags: ['--new'], env });
after(() => {
  lab.kill();
  rm([HOME, DIR]);
});
const S = 'bbbbbbbb-1';
const cli = (...args) => command(args, { cwd: DIR, env: { ...env, CLAUDE_CODE_SESSION_ID: S }, timeout: 30000 });
const post = async (body) => {
  const r = await fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-admin': serverJson(DIR).token }, body: JSON.stringify({ name: 'Leo', ...body }) });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
const get = async (id) => (await (await fetch(`${B}/_lab/api/comments?page=/index`)).json()).comments.find((c) => c.id === id);
const made = async (text = 'check this') => (await post({ page: '/index', text, anchor: { kind: 'element', selector: '#t', x: 0.5, y: 0.5, docX: 0.2, docY: 40, width: 1000, element: '<h1 id="t">', text: 'Plans', fp: { h: 'abc', t: 'Plans', u: 1, k: 0, x: '', l: 1, o: [0, 1] } } })).comment;

test('setup', async () => {
  await up(B + '/', { fail: false });
});

test('the note for a changed spot tells the agent the two commands, with its own command in front', async () => {
  const c = await made();
  await cli('wait', '--bg', '--timeout', '5');
  const said = await post({ page: '/index', action: 'move', id: c.id, found: true, changed: { was: 'Plans', now: 'Pricing', element: '<h1>' } });
  assert.equal(said.status, 200);
  const heard = await cli('wait', '--bg', '--timeout', '5');
  assert.match(heard.out, /spot changed: /);
  assert.match(heard.out, new RegExp(`^settle: .*local\\.mjs pin move ${c.id} <selector> \\[--quote "words"\\].*pin gone ${c.id}`, 'm'));
  await post({ page: '/index', action: 'resolve', id: c.id });
});

test('pin move: the pin goes to the element, forgets what it knew of the old one, and the note is over', async () => {
  const c = await made();
  await post({ page: '/index', action: 'move', id: c.id, found: true, changed: { was: 'Plans', now: 'Pricing', element: '<h1>' } });
  assert.ok((await get(c.id)).spotChange);
  const r = await cli('pin', 'move', c.id, '#p', '--page', '/index');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Moved to #p on \/index/);
  const now = await get(c.id);
  assert.deepEqual([now.anchor.kind, now.anchor.selector, now.anchor.x, now.anchor.y, now.anchor.docY], ['element', '#p', 0.5, 0.5, 40]);
  assert.equal(now.anchor.fp, undefined, 'the old fingerprint is not carried to the new element');
  assert.equal(now.anchor.element, undefined);
  assert.equal(now.spotChange, undefined);
  assert.ok(now.movedAt);
  assert.equal(now.resolved, false, 'the pin stays open');
});

test('pin move by the number on the card, with --quote: a pin on those words', async () => {
  const c = await made();
  const all = (await (await fetch(`${B}/_lab/api/comments?page=/index`)).json()).comments;
  const n = numberOf(all.find((x) => x.id === c.id), all);
  const r = await cli('pin', 'move', String(n), '#p', '--quote', 'lazy dog', '--page', '/index');
  assert.equal(r.code, 0, r.out);
  const now = await get(c.id);
  assert.deepEqual([now.anchor.kind, now.anchor.selector, now.anchor.quote.exact], ['text', '#p', 'lazy dog']);
});

test('pin gone: the pin says its spot was removed, keeps where it stood, and the agent text says so', async () => {
  const c = await made();
  await post({ page: '/index', action: 'move', id: c.id, found: true, changed: { was: 'Plans', gone: true } });
  const r = await cli('pin', 'gone', c.id, '--page', '/index');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Marked gone on \/index/);
  const now = await get(c.id);
  assert.equal(now.anchor.gone, true);
  assert.deepEqual([now.anchor.selector, now.anchor.docY, now.spotChange, now.resolved], ['#t', 40, undefined, false]);
  const text = await (await fetch(`${B}/_lab/api/comments?page=/index&format=text`)).text();
  const block = text.split('\n## ').find((b) => b.includes(`id ${c.id}`));
  assert.match(block, /^spot gone: .*you marked its element as removed/m);
  assert.doesNotMatch(block, /pin moved:/);
  // A person dragging it somewhere puts it back on the page (the browser sends a whole new anchor).
  const back = await post({ page: '/index', action: 'move', id: c.id, anchor: { kind: 'element', selector: '#p', x: 0.5, y: 0.5, docX: 0.1, docY: 90 } });
  assert.equal(back.comment.anchor.gone, undefined);
});

test('settling asks for what it needs and refuses what has no element', async () => {
  const c = await made();
  const noSel = await cli('pin', 'move', c.id, '--page', '/index');
  assert.notEqual(noSel.code, 0);
  assert.match(noSel.out, /Say where: .* pin move <id> <selector>/);
  const extra = await cli('pin', 'gone', c.id, 'now', '--page', '/index');
  assert.notEqual(extra.code, 0);
  assert.match(extra.out, /takes no more words/);
  const none = await cli('pin', 'gone', 'nosuchid', '--page', '/index');
  assert.notEqual(none.code, 0);
  assert.match(none.out, /No open comment nosuchid/);
  const whole = (await post({ page: '/index', text: 'about the page', anchor: { kind: 'page', selector: '', x: 0, y: 0, docX: 0, docY: 0 } })).comment;
  const page = await cli('pin', 'gone', whole.id, '--page', '/index');
  assert.notEqual(page.code, 0);
  assert.match(page.out, /page as a whole/);
  // A selector called "move" is not a thing; a pin on an element still takes its selector and text as before.
  const plain = await cli('pin', '#t', 'a point', '--page', '/index', '--no-check');
  assert.equal(plain.code, 0, plain.out);
  assert.match(plain.out, /Pinned \w+ on \/index at #t/);
});
