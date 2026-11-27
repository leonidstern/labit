// Phones: a tap on a pin or on the dimmed page acts on the finger's lift (src/widget/lifttap.ts, used by comments.js),
// so iOS holding its click back (something appeared on the page meanwhile) no longer loses the tap. What counts as a tap,
// and which touches it is for: a pin (not one being dragged, nor a drawing's), the dimmed page; nothing else in the widget
// or on the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { isTap, liftTarget, TAP_SLOP, TAP_MS } = await import('../src/widget/lifttap.ts');

const node = (localName, classes = [], attrs = {}) => ({ localName, classList: { contains: (c) => classes.includes(c) }, hasAttribute: (k) => k in attrs });

test('a tap: within the slop and the time, at its edges too', () => {
  const down = { x: 100, y: 200, t: 1000 };
  assert.equal(isTap(down, 100, 200, 1000), true);
  assert.equal(isTap(down, 100 + TAP_SLOP, 200, 1000 + TAP_MS), true);
  assert.equal(isTap(down, 103, 204, 1100), true); // 5 px away
  assert.equal(isTap(down, 104, 204, 1100), false); // past the slop: a drag (a pin's starts past 5 px)
  assert.equal(isTap(down, 100, 200, 1000 + TAP_MS + 1), false); // a hold: a pin's drag, iOS's long press
});

test('a pin or the dimmed page; not a dragged pin, a drawing, another part of the widget, or the page', () => {
  const pin = node('button', ['pin']);
  const scrim = node('div', ['scrim']);
  const host = node('div', [], { 'data-lab-comments': '' });
  const span = node('span', ['ini']);
  assert.equal(liftTarget([span, pin, node('div', ['layer']), {}, host, {}]), pin); // the initial inside the pin
  assert.equal(liftTarget([scrim, {}, host]), scrim);
  assert.equal(liftTarget([node('button', ['pin', 'dragging']), host]), null);
  assert.equal(liftTarget([node('button', ['pin', 'ink']), host]), null);
  assert.equal(liftTarget([node('div', ['pin', 'draft']), host]), null); // the new comment's own pin is no button
  assert.equal(liftTarget([node('button', ['send']), node('div', ['float']), {}, host]), null);
  assert.equal(liftTarget([node('p'), node('body'), node('html'), {}]), null);
  assert.equal(liftTarget([host, node('button', ['pin'])]), null); // past the widget's own element: the page's
});
