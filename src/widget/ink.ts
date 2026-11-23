// Drawing pins (hold D and drag): the lines of a drawing, as they are drawn and over its saved area, and the drawing as
// an area comment. What the lines read as comes from the draw part (draw.ts), loaded when D is first pressed.
import { zoneAnchor } from './anchoring.ts';

type P = { x: number; y: number; w?: number };
type Ink = { mark: string; from?: string; to?: string; pts: number[][]; w?: number[][]; marks?: string[]; cut?: number };
type Read = { mark: string; from?: string; to?: string; box: { l: number; t: number; r: number; b: number }; lines: P[][]; marks?: string[]; cut?: number };

// The drawing as an area comment: the area (at least min each way), plus the lines as 0–1000 across and down it.
export function inkAnchor({ mark, from, to, box, lines, marks, cut }: Read, min: number) {
  for (const [a, b] of [['l', 'r'], ['t', 'b']] as const) {
    if (box[b] - box[a] >= min) continue;
    const mid = (box[a] + box[b]) / 2;
    [box[a], box[b]] = [mid - min / 2, mid + min / 2];
  }
  const anchor = zoneAnchor({ x0: box.l, y0: box.t, x1: box.r, y1: box.b });
  const fit = (v: number, a: number, b: number) => Math.round(((v - a) / (b - a)) * 1000);
  anchor.ink = { mark, from, to, pts: lines.map((s) => s.flatMap((p) => [fit(p.x, box.l, box.r), fit(p.y, box.t, box.b)])) };
  // The pen's width at each point, in tenths of a px (pressure with a pen, speed otherwise): Leo's pick 4, 20 Nov.
  if (marks?.length) anchor.ink.marks = marks;
  if (cut) anchor.ink.cut = cut;
  if (lines.some((s) => s.some((p) => p.w))) anchor.ink.w = lines.map((s) => s.map((p) => Math.round((p.w || 3) * 10)));
  return anchor;
}

const NS = 'http://www.w3.org/2000/svg';
const path = (d: string) => {
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  return p;
};
const line = (pts: number[]) => pts.reduce((d, v, i) => d + (i % 2 ? ` ${v}` : `${i ? 'L' : 'M'}${v}`), '');

// A drawing over its area: the lines, and a wider see-through copy of them to click (the drawing is the pin).
export function inkSvg(ink: Ink, zone: { left: number; top: number; width: number; height: number }) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 1000 1000');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'ink');
  Object.assign(svg.style, { left: `${zone.left}px`, top: `${zone.top}px`, width: `${zone.width}px`, height: `${zone.height}px` });
  ink.pts.forEach((pts, n) => {
    const hit = path(line(pts));
    hit.setAttribute('class', 'hit');
    svg.append(...widths(pts, ink.w?.[n]), hit);
  });
  if (ink.mark.startsWith('arrow')) svg.append(...head(ink.pts.at(-1) || [], zone.width, zone.height));
  return svg;
}
// A clean arrowhead at the end of the arrow's line: two 12 px strokes at 28° either side of where it was heading,
// worked out on screen and put back into the area's 0–1000 so the stretch of the area doesn't bend it.
function head(pts: number[], w: number, h: number) {
  const n = pts.length / 2;
  if (n < 2 || !w || !h) return [];
  const px = (i: number) => ({ x: (pts[i * 2] / 1000) * w, y: (pts[i * 2 + 1] / 1000) * h });
  const tip = px(n - 1);
  let from = px(n - 2);
  for (let i = n - 2; i >= 0 && Math.hypot(tip.x - from.x, tip.y - from.y) < 14; i--) from = px(i); // a few px back, not the last jitter
  const a = Math.atan2(tip.y - from.y, tip.x - from.x);
  const leg = (k: number) => [Math.round(((tip.x - 12 * Math.cos(a + k)) / w) * 1000), Math.round(((tip.y - 12 * Math.sin(a + k)) / h) * 1000)];
  const t = [Math.round((tip.x / w) * 1000), Math.round((tip.y / h) * 1000)];
  const p = path(line([...leg(0.5), ...t, ...leg(-0.5)]));
  return [p];
}
// A line as one path, or, with widths, a path a segment so each can be as wide as the pen was there.
// Curves through the kept points (Catmull-Rom), from point i to i+1: a thinned line (80 points at most) stops looking
// jagged (Leo's pick G, 20 Nov). The line you click (.hit) stays straight segments.
function curve(pts: number[], i: number) {
  const n = pts.length / 2;
  const P = (k: number) => [pts[Math.max(0, Math.min(n - 1, k)) * 2], pts[Math.max(0, Math.min(n - 1, k)) * 2 + 1]];
  const [a, b, c, e] = [P(i - 1), P(i), P(i + 1), P(i + 2)];
  const r = (v: number) => Math.round(v * 10) / 10;
  return `C${r(b[0] + (c[0] - a[0]) / 6)} ${r(b[1] + (c[1] - a[1]) / 6)} ${r(c[0] - (e[0] - b[0]) / 6)} ${r(c[1] - (e[1] - b[1]) / 6)} ${c[0]} ${c[1]}`;
}
const smooth = (pts: number[]) => {
  const n = pts.length / 2;
  if (n < 3) return line(pts);
  let d = `M${pts[0]} ${pts[1]}`;
  for (let i = 0; i < n - 1; i++) d += curve(pts, i);
  return d;
};
// A pen width, to the half px: the segments of a line that round to one width are drawn as one path.
const half = (tenths: number) => Math.round(tenths / 5) / 2;
// A path for each width the pen had (they are one colour under one opacity, so which lies over which doesn't show):
// a run of segments of that width is a piece of its path, begun again (M) where the run begins.
function widths(pts: number[], w?: number[]) {
  if (!w || w.length * 2 !== pts.length) return [path(smooth(pts))];
  const by = new Map<number, string>();
  let was = -1;
  for (let i = 1; i < w.length; i++) {
    const wv = half((w[i - 1] + w[i]) / 2);
    by.set(wv, (by.get(wv) || '') + (wv === was ? '' : `M${pts[(i - 1) * 2]} ${pts[(i - 1) * 2 + 1]}`) + curve(pts, i - 1));
    was = wv;
  }
  const out = [...by].map(([wv, d]) => {
    const p = path(d);
    p.style.strokeWidth = `${wv}px`;
    return p;
  });
  return out.length ? out : [path(smooth(pts))];
}

// The strokes as they are drawn, in page coordinates (kept that way as they come in, so a scroll mid-stroke leaves the
// part already drawn on the words it was drawn on). One group a stroke. A move adds to the last stroke only: its last
// segment again (its curve leaned on the point that had not come yet) and the new one. Every line was made again on
// every move, 15 ms a move by 2,000 points (bench/drawings/ink-bench.mjs, issue 423).
// The newest segments are runs of one width, a path each, of RUN segments at most: when a path grows the browser
// draws it again whole, and whatever else reaches into its box, so a path that is still growing is kept short. Every
// BLOCK segments the runs are joined into one path a width, as a saved drawing's: fewer elements, and each stays in
// its own stretch of the stroke (one path a width for the whole stroke was 13 elements by 2,000 points, and five to
// ten times the work of drawing them: test/ink.test.mjs holds add() to what paint() makes).
const RUN = 32;
const BLOCK = 128;
export function liveInk() {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'ink live');
  const strokes: P[][] = [];
  const at = (q: P) => [Math.round(q.x), Math.round(q.y)];
  // Segment i of a stroke, from point i - 1 to i: its curve, read on the points around it (two before, one after), and its width.
  const seg = (s: P[], i: number) => {
    const from = Math.max(0, i - 2);
    return { c: curve(s.slice(from, i + 2).flatMap(at), i - 1 - from), w: half((Math.round((s[i - 1].w || 3) * 10) + Math.round((s[i].w || 3) * 10)) / 2) };
  };
  type Run = { el: SVGPathElement; w: number; d: string; n: number };
  // A stroke's group: its settled segments (the runs since the last block was joined), and its last segment on its own
  // (its curve still leans on the point to come).
  type G = { g: SVGGElement; done: number; runs: Run[]; tail: SVGPathElement | null };
  const groups: G[] = [];
  const grow = (G: G, s: P[]) => {
    const write = new Set<Run>(); // the paths that changed: each is written once, however many points came
    for (; G.done < s.length - 2; G.done++) {
      const i = G.done + 1;
      const { c, w } = seg(s, i);
      let r = G.runs.at(-1);
      if (r?.w === w && r.n < RUN) r.d += c;
      else {
        const [x, y] = at(s[i - 1]);
        G.runs.push((r = { el: G.g.insertBefore(path(''), G.tail), w, d: `M${x} ${y}${c}`, n: 0 }));
        r.el.style.strokeWidth = `${w}px`;
      }
      r.n++;
      write.add(r);
      if (i % BLOCK) continue;
      const by = new Map<number, Run>();
      for (const r of G.runs) {
        const first = by.get(r.w);
        if (!first) by.set(r.w, r);
        else {
          first.d += r.d;
          r.el.remove();
          write.delete(r);
          write.add(first);
        }
      }
      G.runs = [];
    }
    for (const r of write) r.el.setAttribute('d', r.d);
    if (s.length < 2) return;
    const { c, w } = seg(s, s.length - 1);
    const [x, y] = at(s[s.length - 2]);
    G.tail ??= G.g.appendChild(path(''));
    G.tail.setAttribute('d', `M${x} ${y}${c}`);
    G.tail.style.strokeWidth = `${w}px`;
  };
  const group = (s: P[]) => {
    const G: G = { g: document.createElementNS(NS, 'g'), done: 0, runs: [], tail: null };
    groups.push(G);
    grow(G, s);
    return G.g;
  };
  // All of it again: a stroke taken back or made neat.
  const paint = () => {
    groups.length = 0;
    svg.replaceChildren(...strokes.map(group));
  };
  // The last stroke's new points (a stroke begun since: its group too).
  const add = () => {
    if (groups.length === strokes.length - 1) svg.append(group([]));
    if (groups.length !== strokes.length) return paint();
    grow(groups[groups.length - 1], strokes[strokes.length - 1]);
  };
  return { svg, strokes, paint, add };
}
