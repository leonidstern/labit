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

const { withShift } = await import('../src/widget/sheetmove.ts');

test("the page's shift is added to a block's own translate, its other axes kept", () => {
  assert.equal(withShift('none', 120), '0px 120px');
  assert.equal(withShift('', -40), '0px -40px');
  assert.equal(withShift('50px', 120), '50px calc(0px + 120px)');
  assert.equal(withShift('50px 0px', 120), '50px calc(0px + 120px)');
  assert.equal(withShift('0px 1px', 30), '0px calc(1px + 30px)');
  assert.equal(withShift('10% calc(2px + 1em) 3px', 5), '10% calc(calc(2px + 1em) + 5px) 3px');
});
