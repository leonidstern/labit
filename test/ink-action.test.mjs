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

test('a drawing of several marks leaves out the box around them all: each mark says what it is on', async () => {
  const anchor = { ...drawn('3 strokes, unclear mark'), zoneText: 'digest Alerts Integrations', zoneItems: ['<h2> · "Alerts"'] };
  anchor.ink.marks = ['arrow from <h2> "Integrations" to <h2> "Weekly digest"', 'circled on <h2> "Alerts"'];
  const { comment } = await post({ text: '3 strokes, unclear mark', anchor });
  const b = await block(comment.id);
  assert.match(b, /^ {2}mark 2: circled on <h2> "Alerts"$/m);
  assert.doesNotMatch(b, /^in the area:|^text in area:/m);
});

test('a quick action keeps the change small but never forbids checking around', async () => {
  const { comment } = await post({ text: 'circled', anchor: drawn('circled') });
  const b = await block(comment.id);
  assert.match(b, /^action: Fix this.*keep the change small/m);
  assert.doesNotMatch(b, /no searching or checking|make the edit and stop/);
});

test("a wifi guest's drawing with no words is no order: a request to weigh", async () => {
  process.env.LAB_STAMP_KEY = 'k';
  const headers = { 'content-type': 'application/json', 'x-lab-stamp-key': 'k', 'x-lab-stamp': encodeURIComponent(JSON.stringify({ from: 'wifi guest' })) };
  const body = { page: '/ink', name: 'Guest', text: 'crossed out', anchor: drawn('crossed out') };
  const { comment } = await (await POST(new Request('http://lab/_lab/api/comments', { method: 'POST', headers, body: JSON.stringify(body) }))).json();
  delete process.env.LAB_STAMP_KEY;
  const b = await block(comment.id);
  assert.match(b, /^from: wifi guest$/m);
  assert.doesNotMatch(b, /^action:/m);
  assert.match(b, /^the mark alone would mean: Remove this\. From a wifi guest: a request to weigh/m);
});
