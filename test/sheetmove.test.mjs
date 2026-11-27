// A sheet let go leaves at the speed the finger had at the end of the flick (src/widget/sheetmove.ts releaseFrom): measured
// over its last 50 ms, as iOS does, or 100 ms when the touches came too seldom for that.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { releaseFrom, goes } = await import('../src/widget/sheetmove.ts');

test('a flick that speeds up is measured over its last 50 ms', () => {
  const ts = [0, 8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88];
  assert.equal(ts[releaseFrom(ts)], 40); // 88 - 48 would be 40 ms; 40 is the first within 50
});

test('the last 50 ms when they hold a measurable span, else the last 100 ms', () => {
  assert.equal(releaseFrom([0, 23, 45, 66]), 1); // a touch every ~22 ms: the last 50 ms hold two (43 ms)
  assert.equal(releaseFrom([0, 60, 66]), 0); // within 50 only 6 ms apart: too short, so from the last 100 ms
});

test('a short quick flick down closes, a slow short drag and any flick up do not', () => {
  assert.equal(goes(80, 1.6, 393), true);
  assert.equal(goes(80, 0.1, 393), false);
  assert.equal(goes(-30, -2, 393), false);
});
