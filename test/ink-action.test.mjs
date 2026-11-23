// A drawing's quick action (lib/comments-api.mjs INK_ACTIONS) goes to the agent as an order only when the drawing came
// with no words: with words the mark may only point, compare or ask, and the words say what to do (#425).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POST, GET, useStore } from '../lib/comments-api.mjs';

useStore(new Map());
const post = (body) => POST(new Request('http://lab/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: '/ink', name: 'Leo', ...body }) })).then((r) => r.json());
const drawn = (mark) => ({ kind: 'element', selector: '.tag', x: 0, y: 0, zw: 0.5, zh: 0.5, docW: 80, docH: 30, ink: { mark, pts: [[0, 0, 500, 500]] } });
const block = async (id) => (await (await GET(new Request('http://lab/_lab/api/comments?page=/ink&format=text'))).text()).split('\n## ').find((b) => b.includes(`id ${id}`));

test('a drawing sent as it is (its text is the mark) is a quick action', async () => {
  const { comment } = await post({ text: 'crossed out', anchor: drawn('crossed out (likely: X)') });
  assert.match(await block(comment.id), /^action: Remove this\. \(from the drawing: a quick action/m);
});

test('a drawing with a question is not an order: the mark is said as what it would mean alone', async () => {
  const { comment } = await post({ text: 'what is this?', anchor: drawn('circled') });
  const b = await block(comment.id);
  assert.doesNotMatch(b, /^action:/m);
  assert.match(b, /^the mark alone would mean: Fix this\. Here the words say what to do/m);
});

test('words in a reply later count too', async () => {
  const { comment } = await post({ text: 'arrow', anchor: drawn('arrow') });
  assert.match(await block(comment.id), /^action: Move it/m);
  await post({ parent: comment.id, text: 'just compare them, no move' });
  assert.doesNotMatch(await block(comment.id), /^action:/m);
});
