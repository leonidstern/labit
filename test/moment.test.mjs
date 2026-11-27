// A pin's moment in plain words (lib/moment.mjs): the chip on a pin and the agent's line say the same thing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanMoment, momentText } from '../lib/moment.mjs';

test('a loop says its second inside one pass and which pass', () => {
  assert.equal(momentText({ kind: 'loop', at: 3.24, of: 4, pass: 209 }), 'loop 3.2 of 4 s · pass 209');
  assert.equal(momentText({ kind: 'anim', at: 1.5, of: 3, pass: 2 }), 'animation 1.5 of 3 s · pass 2');
});

test('a video says its clock, a GIF how long it had been showing', () => {
  assert.equal(momentText({ kind: 'video', at: 4.4, of: 12 }), 'video 0:04.4 of 0:12');
  assert.equal(momentText({ kind: 'video', at: 3725, of: 4000 }), 'video 1:02:05.0 of 1:06:40');
  assert.equal(momentText({ kind: 'video', at: 59.97 }), 'video 1:00.0');
  assert.equal(momentText({ kind: 'gif', at: 2.4 }), 'GIF 2.4 s after it showed');
  assert.equal(momentText(undefined), '');
});

test('a moment from a page is checked', () => {
  assert.deepEqual(cleanMoment({ kind: 'loop', at: 3.247, of: 4, pass: 209.2, what: ' .hero   video ', sel: '#hero > video', ms: 835734.6, extra: 1 }),
    { kind: 'loop', at: 3.2, of: 4, pass: 209, what: '.hero video', sel: '#hero > video', ms: 835735, playing: undefined });
  assert.equal(cleanMoment({ kind: 'nope', at: 1 }), undefined);
  assert.equal(cleanMoment({ kind: 'loop', at: 'x' }), undefined);
  assert.equal(cleanMoment(null), undefined);
  assert.equal(cleanMoment({ kind: 'video', at: 4, pass: 3 }).pass, undefined); // a video has no passes
  assert.equal(cleanMoment({ kind: 'loop', at: -5, of: 4 }).at, 0);
});

test('a moment on something still moving says "at"', () => {
  assert.equal(momentText({ kind: 'loop', at: 2.1, of: 4, pass: 7, playing: true }), 'at loop 2.1 of 4 s · pass 7');
  assert.equal(cleanMoment({ kind: 'video', at: 1, playing: true }).playing, true);
  assert.equal(cleanMoment({ kind: 'gif', at: 1, playing: true }).playing, undefined);
});
