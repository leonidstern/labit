// The quoted words' green (src/widget/anchoring.ts markQuote) is set again only when it changes: each setting makes the
// page's text selectable for two frames (lab-lit on <html>), which restyled the whole page (~10 ms on the iOS 27
// simulator, 27 Nov), and an open thread's card set the same words again on every drawing. sameLit tells the two apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { sameLit } = await import('../src/widget/anchoring.ts');

const text = { isConnected: true };
const other = { isConnected: true };
const range = (sc, so, ec, eo) => ({ startContainer: sc, startOffset: so, endContainer: ec, endOffset: eo });
const lit = (...rs) => ({ size: rs.length, values: () => rs.values() });

test('the same words lit already: nothing to set', () => {
  assert.equal(sameLit(lit(range(text, 2, text, 9)), range(text, 2, text, 9)), true);
});

test('other words, more than one range, none lit, or words gone from the page: set them', () => {
  assert.equal(sameLit(undefined, range(text, 2, text, 9)), false);
  assert.equal(sameLit(lit(range(text, 2, text, 8)), range(text, 2, text, 9)), false);
  assert.equal(sameLit(lit(range(text, 2, other, 9)), range(text, 2, text, 9)), false);
  assert.equal(sameLit(lit(range(text, 2, text, 9), range(other, 0, other, 1)), range(text, 2, text, 9)), false);
  const gone = { isConnected: false };
  assert.equal(sameLit(lit(range(gone, 2, gone, 9)), range(gone, 2, gone, 9)), false);
});
