// A pin's fingerprint on the lab (src/widget/anchoring.ts makes it, lib/comments-api.mjs keeps it): saved with the pin
// and cleaned, learned again by a proven find (move with found), told to the agent when a pin is unsure, and a pin from
// before fingerprints (none) means what it did.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { site, tmp, rm, spawnLab, up, serverJson } from './harness.mjs';

const HOME = tmp('anchor-fp');
const { DIR, PORT, B } = site('anchor-fp-lab', 10400, 40);
const env = { ...process.env, XDG_CONFIG_HOME: HOME, LABIT_HOME: HOME, PORT: '', LABIT_NO_UPDATE_CHECK: '1', LAB_SETTLE_MS: '100' };
fs.writeFileSync(path.join(DIR, 'package.json'), '{}');
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><title>Home</title><h1>Hi</h1><p>One</p>');
const lab = spawnLab(DIR, PORT, { flags: ['--new'], env });
after(() => {
  lab.kill();
  rm([HOME, DIR]);
});
const api = async (body) => {
  const r = await fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-admin': serverJson(DIR).token }, body: JSON.stringify({ name: 'Leo', page: '/index', ...body }) });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
const FP = { h: 'abc12', t: 'Team', u: 2, k: 1, x: 'zz9', l: 1, o: [0, 1] };
const base = { kind: 'element', selector: 'body > p:nth-of-type(1)', x: 0.5, y: 0.5, element: '<p>', text: 'Team' };

test('setup', async () => {
  await up(B + '/', { fail: false });
});

test('a pin keeps its fingerprint, cleaned: hashes and counts only, capped', async () => {
  const ok = (await api({ text: 'a', anchor: { ...base, fp: { ...FP, b: 'x'.repeat(300), a: 1, s: 3, r: ['ab12', '<b>', 'zz9', 'q'.repeat(20)], junk: 1 } } })).comment.anchor.fp;
  assert.deepEqual([ok.h, ok.t, ok.u, ok.k, ok.x, ok.l, ok.o], ['abc12', 'Team', 2, 1, 'zz9', 1, [0, 1]]);
  assert.equal(ok.b.length, 100);
  assert.deepEqual([ok.a, ok.s, ok.r], [1, 3, ['ab12', 'zz9']], 'twins told apart, look-alikes, who stood around it: hashes only');
  assert.equal(ok.junk, undefined);
  const odd = (await api({ text: 'b', anchor: { ...base, fp: { ...FP, h: '<script>', x: 'A B', l: 99, u: -4, o: [-1, 'x'] } } })).comment.anchor.fp;
  assert.deepEqual([odd.h, odd.x, odd.l, odd.u, odd.o], ['', '', 3, 0, [0, 1]]);
  assert.equal((await api({ text: 'c', anchor: { ...base, fp: 'nope' } })).comment.anchor.fp, undefined, 'not an object: none');
  assert.equal((await api({ text: 'd', anchor: base })).comment.anchor.fp, undefined, 'a pin with none has none');
});

test('a proven find (move with found) learns what the pin is now; nothing else of it changes', async () => {
  const c = (await api({ text: 'learn', anchor: { ...base, fp: FP, section: 'Plans', kind: 'image' } })).comment;
  const now = { ...FP, h: 'new99', t: 'Team plan' };
  const r = await api({ action: 'move', id: c.id, found: true, anchor: { selector: 'body > p:nth-of-type(2)', docX: 0.2, docY: 90, eh: 20, element: '<p class="x">', text: 'Team plan', section: 'Plans 2', fp: now, kind: 'text', x: 0.9, quote: { exact: 'zzz' } } });
  assert.equal(r.status, 200);
  const a = r.comment.anchor;
  assert.deepEqual([a.selector, a.docY, a.element, a.text, a.section, a.fp.h, a.fp.t], ['body > p:nth-of-type(2)', 90, '<p class="x">', 'Team plan', 'Plans 2', 'new99', 'Team plan']);
  assert.deepEqual([a.kind, a.x, a.quote], ['image', 0.5, undefined], 'its kind, share and words stay');
  assert.equal(r.comment.movedAt, undefined, 'a find is no move');
  // A pin from before fingerprints that is only found at another path keeps having none.
  const old = (await api({ text: 'old', anchor: base })).comment;
  const kept = await api({ action: 'move', id: old.id, found: true, anchor: { selector: 'body > p:nth-of-type(3)', docX: 0.1, docY: 30, eh: 10 } });
  assert.deepEqual([kept.comment.anchor.selector, kept.comment.anchor.fp, kept.comment.anchor.text], ['body > p:nth-of-type(3)', undefined, 'Team']);
});

test('an unsure pin is told to the agent as unsure, a lost one as gone', async () => {
  const c = (await api({ text: 'which one', anchor: { ...base, fp: FP } })).comment;
  await api({ action: 'move', id: c.id, found: true, changed: { was: 'Team', now: 'Team', element: '<h3>', alike: true } });
  const text = await (await fetch(`${B}/_lab/api/comments?page=/index&format=text`)).text();
  assert.match(text, /spot changed:[^\n]*it may have moved: its words stand on several elements and it is shown on <h3> "Team"\. Check it is the one, or re-pin\./);
  const gone = (await api({ text: 'gone one', anchor: { ...base, fp: FP } })).comment;
  await api({ action: 'move', id: gone.id, found: true, changed: { was: 'Team', gone: true } });
  assert.match(await (await fetch(`${B}/_lab/api/comments?page=/index&format=text`)).text(), /its words or element are gone from the page/);
});
