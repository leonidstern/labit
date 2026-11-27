// lib/cut.mjs: text cut to a size ends where a character ends, never in half an emoji (a lone surrogate prints as U+FFFD).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cut, whole } from '../lib/cut.mjs';

test('cut: whole characters only', () => {
  const E = '\u{1F600}';
  assert.equal(cut('abc', 5), 'abc');
  assert.equal(cut('abcdef', 3), 'abc');
  assert.equal(cut(`ab${E}cd`, 3), 'ab', 'a pair that would be cut in half goes whole');
  assert.equal(cut(`ab${E}cd`, 4), `ab${E}`);
  assert.equal(cut(`ab${'\u{1F468}‍\u{1F469}‍\u{1F467}'}`, 6), 'ab', 'a family stays one character');
  assert.equal(cut('ab\u{1F1E9}\u{1F1EA}', 5), 'ab', 'a flag too');
  assert.equal(cut('ééé', 3), 'é', 'a letter keeps its accent');
  assert.equal(cut(`a${'́'.repeat(100)}`, 10), 'a'.padEnd(10, '́'), 'one character longer than the room is cut by code points');
  assert.equal(cut(`${E}${'\u0301'.repeat(100)}`, 5), `${E}\u0301\u0301\u0301`, 'and never through a pair');
  assert.equal(cut(`${E}${'\u0301'.repeat(100)}`, 1), '', 'room for less than a pair: nothing');
  assert.equal(cut('x'.repeat(100000), 40).length, 40);
});

test('whole: a half of an emoji is taken out, whole ones stay', () => {
  assert.equal(whole('a\uD83Db'), 'ab');
  assert.equal(whole('a\uDE00b'), 'ab');
  assert.equal(whole('a\u{1F600}b'), 'a\u{1F600}b');
  assert.equal(cut('a\uD83D', 10), 'a', 'also when nothing is cut');
});
