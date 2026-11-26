// A board pin's board (+board, src/widget/boardcam.ts): made once by the lab as board pin-<id> about the page at
// #pin-<id>, never made again over itself, no list of its own, nothing written into the page's file, and what is put on
// it said with its pin in the agent's text.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { claimPort, tmp, rm, spawnLab, stop, up as answers } from './harness.mjs';

const DIR = fs.realpathSync(tmp('pinboard'));
const PORT = claimPort(9800, 100);
const B = `http://localhost:${PORT}`;
const write = (rel, body) => {
  fs.mkdirSync(path.dirname(path.join(DIR, rel)), { recursive: true });
  fs.writeFileSync(path.join(DIR, rel), typeof body === 'string' ? body : JSON.stringify(body));
};
const ID = 'a1b2c3d4e5f6';
write('pricing.html', '<!doctype html><title>Pricing</title><h1>Pricing</h1>');
write('cart.html', '<!doctype html><title>Cart</title><h1>Cart</h1>');
write('labit.json', { flags: {} });
write('.lab/comments/pricing.json', { page: '/pricing', comments: { [ID]: { id: ID, name: 'Leo', text: 'make the hero like these', createdAt: '2026-11-21T09:00:00.000Z', num: 1, anchor: { kind: 'element', selector: 'h1', x: 0.5, y: 0.5 } } } });
// A closed board pin two months old whose board still has an open thread, and a plain closed pin as old: the lab archives
// old done threads as it starts, the board pin's way in kept.
const OLD = '2026-09-01T09:00:00.000Z';
write('.lab/comments/cart.json', { page: '/cart', comments: {
  b0b0b0b0b0b0: { id: 'b0b0b0b0b0b0', name: 'Leo', text: 'refs', createdAt: OLD, resolved: true, resolvedAt: OLD, num: 1, anchor: { kind: 'element', selector: 'h1', x: 0.5, y: 0.5 } },
  c0c0c0c0c0c0: { id: 'c0c0c0c0c0c0', name: 'Leo', text: 'like this one', createdAt: OLD, num: 2, anchor: { kind: 'board', board: 'pin-b0b0b0b0b0b0', fx: 1, fy: 1 } },
  d0d0d0d0d0d0: { id: 'd0d0d0d0d0d0', name: 'Leo', text: 'old', createdAt: OLD, resolved: true, resolvedAt: OLD, num: 3, anchor: { kind: 'element', selector: 'h1', x: 0.5, y: 0.5 } },
} });
const lab = spawnLab(DIR, PORT);
after(async () => {
  await stop(lab);
  rm([DIR], { maxRetries: 5 });
});
const keys = () => JSON.parse(fs.readFileSync(path.join(DIR, '.lab/server.json'), 'utf8'));
const post = (body, headers) => fetch(`${B}/_lab/api/board`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', origin: B, ...headers } });
const agentText = async () => (await fetch(`${B}/_lab/agent/pricing`)).text();
const name = `pin-${ID}`;

test('the card makes the pin its board: about the page at the pin, opened over the page', async () => {
  await answers(`${B}/_lab/state`);
  const r = await post({ action: 'new', name, of: `/pricing#${name}` }, { 'x-lab-admin': keys().token });
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.equal(out.board.name, name);
  assert.equal(out.board.of, `/pricing#${name}`);
  assert.equal(out.home, '/pricing');
  assert.deepEqual(out.board.frames, [], 'a new board starts empty');
});

test('with nothing on it yet, the pin says it holds a board with nothing on it yet', async () => {
  const t = await agentText();
  assert.match(t, new RegExp(`^board: ${name} — this pin holds the person's references; its words name the board, they are not a request\\..* Nothing on it yet\\.$`, 'm'));
  assert.doesNotMatch(t, /^ {2}frame a:/m);
});

test('what is put on it is said with the page, the page itself left out', async () => {
  const add = await post({ action: 'add', name, target: '/cart', label: 'like this' }, { 'x-lab-admin': keys().agent, 'x-lab-agent': '1' });
  assert.equal(add.status, 200);
  const t = await agentText();
  // inside the pin's own block, under its words (a hand-off of that pin carries it), not at the end of the page
  const block = t.split('\n\n## ').find((x) => x.includes(`id ${ID}`)) || '';
  assert.match(block, new RegExp(`^board: ${name} — `, 'm'));
  assert.match(block, /^ {2}frame a: page \/cart "like this"$/m);
  assert.equal((t.match(/^ {2}frame /gm) || []).length, 1);
});

test('asked again, it is the same board, not a new one over it', async () => {
  const r = await post({ action: 'new', name, of: `/pricing#${name}` }, { 'x-lab-admin': keys().token });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).board.frames.map((f) => f.id), ['a']);
});

test('a guest or a page without the key cannot make one', async () => {
  assert.equal((await post({ action: 'new', name: 'pin-0000000000ff', of: '/pricing#pin-0000000000ff' }, {})).status, 403);
  assert.equal(fs.existsSync(path.join(DIR, '.lab/boards/pin-0000000000ff.json')), false);
});

test('boards have no list of their own in the lab (a board is part of its page)', async () => {
  const pages = await (await fetch(`${B}/_lab/pages`)).json();
  assert.equal(pages.boards, undefined);
});

test('nothing is written into the page\'s file: the section writer is gone', async () => {
  const r = await post({ action: 'place', name, of: `/pricing#${name}`, path: [['h1', 1]], words: 'Pricing' }, { 'x-lab-admin': keys().token });
  assert.notEqual(r.status, 200);
  assert.equal(fs.readFileSync(path.join(DIR, 'pricing.html'), 'utf8'), '<!doctype html><title>Pricing</title><h1>Pricing</h1>');
});

test('a deleted pin takes its board with it, and the page\'s file is as it was', async () => {
  const file = () => fs.readFileSync(path.join(DIR, 'pricing.html'), 'utf8');
  const del = await fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-admin': keys().token }, body: JSON.stringify({ page: '/pricing', action: 'delete', id: ID }) });
  assert.equal(del.status, 200);
  assert.equal(file(), '<!doctype html><title>Pricing</title><h1>Pricing</h1>');
  assert.equal(fs.existsSync(path.join(DIR, `.lab/boards/${name}.json`)), false);
  assert.equal((await fetch(`${B}/_lab/api/board?name=${name}`)).status, 404);
});

test('a closed board pin is not archived while its board has an open thread; a plain old one is', async () => {
  await answers(`${B}/_lab/state`);
  const ids = ((await (await fetch(`${B}/_lab/api/comments?page=/cart`)).json()).comments || []).map((c) => c.id);
  assert.ok(ids.includes('b0b0b0b0b0b0'), 'the board pin stays');
  assert.ok(ids.includes('c0c0c0c0c0c0'), 'its open board thread stays');
  assert.ok(!ids.includes('d0d0d0d0d0d0'), 'a plain old closed pin is archived');
});
