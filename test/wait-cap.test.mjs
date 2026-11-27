// How long a wait may sit open (lib/args.ts). A wait left in an agent's foreground holds the person's turn open, and
// from inside the process a foreground run is indistinguishable from a background one — so the agent promises with
// --bg, and a wait with no promise ends after a minute.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOREGROUND_CAP, WAIT_DEFAULT, parseArgs, waitSeconds } from '../lib/args.ts';

test('with no promise, a long wait is held to a minute', () => {
  assert.deepEqual(waitSeconds({ timeout: '1500' }), { seconds: FOREGROUND_CAP, capped: true });
  assert.deepEqual(waitSeconds({}), { seconds: FOREGROUND_CAP, capped: true });
});

test('a short wait is left alone, and not called capped', () => {
  assert.deepEqual(waitSeconds({ timeout: '50' }), { seconds: 50, capped: false });
  assert.deepEqual(waitSeconds({ timeout: String(FOREGROUND_CAP) }), { seconds: FOREGROUND_CAP, capped: false });
});

test('--bg gets the full wait', () => {
  assert.deepEqual(waitSeconds({ bg: true, timeout: '1500' }), { seconds: 1500, capped: false });
  assert.deepEqual(waitSeconds({ bg: true }), { seconds: WAIT_DEFAULT, capped: false });
});

test('a person at a terminal keeps the full wait', () => {
  assert.deepEqual(waitSeconds({ timeout: '1500' }, true), { seconds: 1500, capped: false });
});

test('LABIT_BACKGROUND=1 says it too, for a wrapper that cannot pass flags', () => {
  process.env.LABIT_BACKGROUND = '1';
  try {
    assert.deepEqual(waitSeconds({ timeout: '1500' }), { seconds: 1500, capped: false });
  } finally {
    delete process.env.LABIT_BACKGROUND;
  }
});

test('--bg is a known flag, not a typo', () => {
  const { opts, unknownFlags } = parseArgs(['wait', '--bg', '--timeout', '1500']);
  assert.equal(opts.bg, true);
  assert.equal(opts.timeout, '1500');
  assert.deepEqual(unknownFlags, []);
});
