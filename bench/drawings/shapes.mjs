// Mark shapes, in page pixels, from the target's box (and a second box for arrows). Each is a list of strokes.
const wave = (x0, x1, y, amp = 4, per = 3) => Array.from({ length: Math.ceil((x1 - x0) / 3) + 1 }, (_, i) => [x0 + i * 3, y + amp * Math.sin(i * 3 / per)]);
export const SHAPES = {
  x: (b) => [[[b.x, b.y], [b.x + b.w, b.y + b.h]], [[b.x + b.w, b.y], [b.x, b.y + b.h]]],
  strike: (b) => [[[b.x - 4, b.y + b.h * 0.55], [b.x + b.w + 4, b.y + b.h * 0.55]]],
  scribble: (b) => [Array.from({ length: 14 }, (_, i) => [i % 2 ? b.x + b.w : b.x, b.y + (b.h * i) / 13])],
  wavy: (b) => [wave(b.x, b.x + b.w, b.y + b.h + 3)],
  underline: (b) => [[[b.x, b.y + b.h + 2], [b.x + b.w, b.y + b.h + 2]]],
  circle: (b) => {
    const [cx, cy, rx, ry] = [b.x + b.w / 2, b.y + b.h / 2, b.w / 2 + 14, b.h / 2 + 12];
    return [Array.from({ length: 40 }, (_, i) => [cx + rx * Math.cos((i / 36) * 2 * Math.PI), cy + ry * Math.sin((i / 36) * 2 * Math.PI)])];
  },
  box: (b) => {
    const [l, t, r, d] = [b.x - 10, b.y - 10, b.x + b.w + 10, b.y + b.h + 10];
    return [[[l, t], [r, t], [r, d], [l, d], [l, t + 4]]];
  },
  side: (b) => [[[b.x - 12, b.y], [b.x - 12, b.y + b.h]]],
  arrow: (b, to) => [[[b.x + b.w / 2, b.y + b.h / 2], [to.x + to.w / 2, to.y + to.h / 2]], [[to.x + to.w / 2 - 12, to.y + to.h / 2 - 10], [to.x + to.w / 2, to.y + to.h / 2], [to.x + to.w / 2 - 14, to.y + to.h / 2 + 6]]],
  // Under the gap above the item, its tip at the item's top left: add a line here (between this item and the one before).
  caret: (b) => [[[b.x - 8, b.y + 14], [b.x, b.y - 2], [b.x + 8, b.y + 14]]],
};


