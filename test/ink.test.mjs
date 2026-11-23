// The live ink (src/widget/ink.ts liveInk): a stroke built a point at a time with add() is, element for element, what
// paint() makes of the same strokes in one go (a stroke made neat or taken back is painted again: the two must agree),
// and its elements stay few however long the stroke. The page is a stand-in: just what the ink calls on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

class El {
  constructor(tag) {
    Object.assign(this, { tag, attrs: {}, style: {}, kids: [], parent: null });
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  remove() {
    if (this.parent) this.parent.kids.splice(this.parent.kids.indexOf(this), 1);
    this.parent = null;
  }
  insertBefore(el, ref) {
    el.remove();
    this.kids.splice(ref ? this.kids.indexOf(ref) : this.kids.length, 0, el);
    el.parent = this;
    return el;
  }
  appendChild(el) {
    return this.insertBefore(el, null);
  }
  append(...els) {
    els.forEach((el) => this.appendChild(el));
  }
  replaceChildren(...els) {
    [...this.kids].forEach((k) => k.remove());
    this.append(...els);
  }
  get count() {
    return this.kids.reduce((n, k) => n + 1 + k.count, 0);
  }
  get innerHTML() {
    return this.kids.map((k) => `<${k.tag}${Object.entries(k.attrs).map(([a, v]) => ` ${a}="${v}"`).join('')}${k.style.strokeWidth ? ` style="stroke-width: ${k.style.strokeWidth};"` : ''}>${k.innerHTML}</${k.tag}>`).join('');
  }
}
globalThis.document = { createElementNS: (_, tag) => new El(tag) };
const { liveInk } = await import('../src/widget/ink.ts');

// A stroke as drag.ts makes it: the first point has no width, each later width is half the one before and half the new.
const stroke = (n, seed, width) => {
  let r = seed;
  const rnd = () => (r = (r * 1103515245 + 12345) % 2147483648) / 2147483648;
  const s = [{ x: 100 + seed, y: 200 }];
  for (let i = 1; i <= n; i++) {
    const q = s.at(-1);
    const want = width(i, rnd());
    s.push({ x: q.x + (rnd() - 0.3) * 9, y: q.y + (rnd() - 0.5) * 9, w: q.w ? (q.w + want) / 2 : want });
  }
  return s;
};
const KINDS = {
  'a pen, its pressure changing slowly': (i) => 1.5 + (0.3 + 0.4 * Math.abs(Math.sin(i / 30))) * 4,
  'a pen, its pressure jumping': (_, r) => 1.5 + r * 4,
  'a mouse at one speed': () => 4.6,
  'a mouse, fast and slow': (i) => Math.max(1.6, Math.min(5, 5 - (0.1 + 1.4 * Math.abs(Math.sin(i / 9))) * 1.8)),
};
const painted = (strokes) => {
  const ink = liveInk();
  ink.strokes.push(...strokes);
  ink.paint();
  return ink.svg.innerHTML;
};

for (const [name, width] of Object.entries(KINDS)) {
  test(`live ink, ${name}: point by point is what paint() makes, at every length`, () => {
    const ink = liveInk();
    const lens = [1, 2, 3, 31, 32, 33, 34, 127, 128, 129, 130, 257, 300, 700];
    lens.forEach((n, k) => {
      const whole = stroke(n, k + 1, width);
      ink.strokes.push([whole[0]]);
      for (const p of whole.slice(1)) {
        ink.strokes.at(-1).push(p);
        ink.add();
        if (ink.strokes.at(-1).length % 97 === 5) assert.equal(ink.svg.innerHTML, painted(ink.strokes), `stroke ${k} at ${ink.strokes.at(-1).length} points`);
      }
      assert.equal(ink.svg.innerHTML, painted(ink.strokes), `after stroke ${k} (${n + 1} points)`);
    });
    // Several points between two add()s (moves that came together), and a paint() in the middle of a stroke.
    const whole = stroke(500, 99, width);
    ink.strokes.push(whole.slice(0, 1));
    for (let i = 1; i < whole.length; i++) {
      ink.strokes.at(-1).push(whole[i]);
      if (i % 7 === 0) ink.add();
      if (i === 250) ink.paint();
    }
    ink.add();
    assert.equal(ink.svg.innerHTML, painted(ink.strokes), 'points added several at a time');
  });
}

test('live ink: every segment is drawn once, whatever path it is in', () => {
  const ink = liveInk();
  ink.strokes.push(stroke(2000, 7, KINDS['a mouse, fast and slow']));
  ink.paint();
  const curves = ink.svg.innerHTML.match(/C/g).length;
  assert.equal(curves, 2000);
});

test('live ink: a long stroke stays a few dozen elements', () => {
  for (const [name, width] of Object.entries(KINDS)) {
    const ink = liveInk();
    ink.strokes.push([{ x: 0, y: 0 }]);
    let most = 0;
    for (const p of stroke(2000, 3, width).slice(1)) {
      ink.strokes[0].push(p);
      ink.add();
      most = Math.max(most, ink.svg.count);
    }
    assert.ok(most <= 160, `${name}: ${most} elements at most over 2,000 points`);
  }
});
