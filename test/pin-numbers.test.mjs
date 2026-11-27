// A pin's number: the one stored when it was made, or for a pin from before that, its place among the open older ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numberOf } from '../lib/schema.mjs';

const pin = (id, at, more = {}) => ({ id, createdAt: `2026-11-20T10:00:0${at}Z`, ...more });

test('a stored number is the pin\'s number, whatever else is open or resolved', () => {
  const all = [pin('a', 1, { num: 7 }), pin('b', 2, { num: 8, resolved: true }), pin('c', 3, { num: 9 })];
  assert.deepEqual(all.map((c) => numberOf(c, all)), [7, 8, 9]);
});

test('older pins keep the numbers they showed: their place among the open older ones', () => {
  const old = [pin('a', 1), pin('b', 2), pin('c', 3)];
  assert.deepEqual(old.map((c) => numberOf(c, old)), [1, 2, 3]);
  const all = [...old, pin('d', 4, { num: 4 }), pin('r', 5, { parent: 'a' })];
  assert.deepEqual(old.map((c) => numberOf(c, all)), [1, 2, 3], 'new pins and replies change nothing');
  old[0].resolved = true;
  assert.equal(numberOf(old[1], all), 1, 'an older pin resolved: the rest close up as before');
});
