// Part of the comment widget, built as its own file (public/_lab/draw.js, scripts/build-widget.mjs) that src/comments.js
// loads when D is first pressed: what a drawing reads as. Its lines are drawn by ink.ts.
// Drawing pins: hold D and drag to draw on the page instead of marking a box. The drawing is an area comment (the area
// is the box around the lines, with the words and elements in it, zoneAnchor) plus the lines themselves and what they
// read as: circled, a box, underlined, crossed out, an X, scribbled over, an arrow (where from, where it points), a line, a
// caret (insert here) or a side line (this block). Anything else is sent as an unclear mark: the comment's words win.
// Strokes drawn while D is held make one drawing; one that starts where the last ended joins it into one line.
// The drawing is the pin: no marker, its line is what you click (comments.js).

type P = { x: number; y: number; w?: number };

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
const length = (s: P[]) => s.reduce((n, p, i) => (i ? n + dist(p, s[i - 1]) : 0), 0);
// The line cut to its corners (Ramer–Douglas–Peucker).
const cut = (s: P[], eps: number): P[] => {
  if (s.length < 3) return s;
  const a = s[0];
  const b = s[s.length - 1];
  const d = dist(a, b);
  let max = 0;
  let at = 0;
  for (let i = 1; i < s.length - 1; i++) {
    // Ends on the same spot (a closed loop): how far each point is from it, not from a line that isn't there.
    const h = d < 1 ? dist(a, s[i]) : Math.abs((b.y - a.y) * s[i].x - (b.x - a.x) * s[i].y + b.x * a.y - b.y * a.x) / d;
    if (h > max) [max, at] = [h, i];
  }
  return max <= eps ? [a, b] : [...cut(s.slice(0, at + 1), eps).slice(0, -1), ...cut(s.slice(at), eps)];
};
const turn = (a: P, b: P, c: P) => {
  const d = Math.abs(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x));
  return d > Math.PI ? 2 * Math.PI - d : d;
};
const turns = (s: P[], min: number) => s.slice(2).filter((p, i) => turn(s[i], s[i + 1], p) > min).length;
const winding = (s: P[]) => {
  let sum = 0;
  for (let i = 2; i < s.length; i++) {
    let d = Math.atan2(s[i].y - s[i - 1].y, s[i].x - s[i - 1].x) - Math.atan2(s[i - 1].y - s[i - 2].y, s[i - 1].x - s[i - 2].x);
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    sum += d;
  }
  return Math.abs(sum);
};
// A line lands with every point it was drawn with, so it is the line you saw (Leo, 23 Nov: "i want them land as they
// drawed"; thinning by half a px still moved its curves). Only a line of more than 500 points is thinned, evenly over
// its whole length (cutting the list dropped the end).
const MAX_PTS = 500;
const thin = (s: P[]) => {
  if (s.length <= MAX_PTS) return s;
  let eps = 0.5;
  let c = cut(s, eps);
  while (c.length > MAX_PTS) c = cut(s, (eps *= 1.5));
  return c;
};
// The area a line closes (shoelace): next to none for a line drawn there and back.
const area = (s: P[]) => Math.abs(s.reduce((n, p, i) => n + p.x * s[(i + 1) % s.length].y - s[(i + 1) % s.length].x * p.y, 0)) / 2;
const straight = (s: P[]) => length(s) < dist(s[0], s[s.length - 1]) * 1.15;
const boxOf = (s: P[]) => {
  const xs = s.map((p) => p.x);
  const ys = s.map((p) => p.y);
  return { l: Math.min(...xs), t: Math.min(...ys), r: Math.max(...xs), b: Math.max(...ys) };
};
// Two lines that pass through each other: an end that only touches the other line (a T) is no X.
const cross = (a: P, b: P, c: P, d: P) => {
  const side = (p: P, q: P, r: P) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
};
// The letter under a point, when there is one: underlines and strikes are read against it.
const letterAt = (x: number, y: number) => {
  const d = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  let n: Node | undefined;
  let o = 0;
  // An earlier drawing's line (28 px of it answers the pointer) would be what the browser finds under the point: while
  // the page is asked, those are let through (styles.css, :host([data-lab-probe])).
  const host = document.querySelector('[data-lab-comments]');
  host?.setAttribute('data-lab-probe', '');
  const p = d.caretPositionFromPoint?.(x, y);
  if (p) [n, o] = [p.offsetNode, p.offset];
  else {
    const r = document.caretRangeFromPoint?.(x, y);
    if (r) [n, o] = [r.startContainer, r.startOffset];
  }
  host?.removeAttribute('data-lab-probe');
  if (!(n instanceof Text) || !n.length) return null;
  // The caret stands at the nearer edge of a letter: on the far half of a wide one (a CJK letter, an emoji) it is the next
  // letter's edge, so the letter before it is read too.
  for (const at of [Math.min(o, n.length - 1), o - 1]) {
    if (at < 0) continue;
    const r = document.createRange();
    r.setStart(n, at);
    r.setEnd(n, at + 1);
    const b = r.getBoundingClientRect();
    if (b.height && x >= b.left - 3 && x <= b.right + 3 && y >= b.top && y <= b.bottom) return b;
  }
  return null;
};

// The line with each point the mean of it and its neighbours: a shaky hand's jitter, point to point, is not a wave (a
// shaky straight line read as a wavy underline, issue 423); a wave's few px up and down over a dozen px stay.
const calm = (s: P[]) => s.map((p, i) => (i && i < s.length - 1 ? { ...p, x: (s[i - 1].x + p.x + s[i + 1].x) / 3, y: (s[i - 1].y + p.y + s[i + 1].y) / 3 } : p));

// How often a line turns back across (left to right, then right to left): a wave goes one way, a scribble back and forth.
// A run counts only once it has gone span px one way: a curl at an arrow's end, or a hook at its tip, turns back a few
// px and is not a pass of a scribble (Leo, 23 Nov: an arrow with a curl at its end read as scribbled over).
const backs = (c: P[], k: 'x' | 'y' = 'x', span = 2) => {
  let n = 0;
  let dir = 0;
  let at = c[0]?.[k] ?? 0; // the furthest the current run has gone
  for (const p of c) {
    const d = p[k] - at;
    if (dir && Math.sign(d) === dir) at = p[k];
    else if (Math.abs(d) >= span) {
      if (dir) n++;
      dir = Math.sign(d);
      at = p[k];
    }
  }
  return n;
};

// Shift held as the pen lifts (Leo's pick S2, 20 Nov): a rough box becomes a clean rectangle and a loop a clean ellipse,
// at the size drawn, read the same way as below. Anything else: null, the stroke stays as drawn.
export function neaten(s: P[]): P[] | null {
  if (s.length < 3) return null;
  const b = boxOf(s);
  const diag = Math.hypot(b.r - b.l, b.b - b.t) || 1;
  const run = length(s);
  const closed = dist(s[0], s[s.length - 1]) < diag * 0.3 && run > diag * 1.8;
  const loops = winding(cut(s, Math.max(2, diag * 0.03))) > Math.PI * 1.25 && run > diag * 1.3 && !(turns(cut(s, 6), 1) >= 4);
  if (!closed && !loops) return null;
  const w = s.reduce((n, p) => n + (p.w || 3), 0) / s.length;
  const c = cut(s, Math.max(3, diag * 0.06));
  if (c.length >= 4 && c.length <= 8 && turns(c, 1.1) >= 3)
    return [[b.l, b.t], [b.r, b.t], [b.r, b.b], [b.l, b.b], [b.l, b.t]].map(([x, y]) => ({ x, y, w }));
  const [cx, cy, rx, ry] = [(b.l + b.r) / 2, (b.t + b.b) / 2, (b.r - b.l) / 2, (b.b - b.t) / 2];
  return Array.from({ length: 49 }, (_, i) => ({ x: cx + rx * Math.cos((i / 48) * 2 * Math.PI), y: cy + ry * Math.sin((i / 48) * 2 * Math.PI), w }));
}

// An arrow's head, when one is drawn (Leo, 22 Nov, #429: a hand's lines end in small hooks, and those read as heads): past
// the middle, a sharp turn back with a leg of its own after it, at least 12 px straight across (a hook is smaller). Read on
// the points as drawn, the turn between 16 px before and after: cut, a narrow head is lost.
export const MAX_STROKES = 64;
const LEG = 12;
function headAt(s: P[]) {
  const total = length(s);
  const leg = LEG;
  const near = (i: number, step: number, d: number) => {
    let j = i;
    while (s[j + step] && dist(s[j], s[i]) < d) j += step;
    return s[j];
  };
  let run = 0;
  for (let i = 1; i < s.length - 1; i++) {
    run += dist(s[i], s[i - 1]);
    // (and less after it than before: a line drawn there and back turns as sharply, with as much again after the turn)
    if (run > total * 0.55 && total - run < run * 0.8 && turn(near(i, -1, 16), s[i], near(i, 1, 16)) > 2 && s.slice(i).some((q) => dist(q, s[i]) >= leg)) return s[i];
  }
}

// What the strokes read as, and the box the comment is on (the box around them, or what an underline or side line is about).
export function readInk(strokes: P[][], say: (e: Element | null) => string | undefined) {
  // A stroke that starts where the last one ended is one line (a caret as / then \, a circle in two halves).
  const lines: P[][] = [];
  for (const s of strokes) {
    const last = lines[lines.length - 1];
    if (last && dist(last[last.length - 1], s[0]) < 14) last.push(...s);
    else lines.push([...s]);
  }
  const all = lines.flat();
  const box = boxOf(all);
  const w = box.r - box.l;
  const h = box.b - box.t;
  const diag = Math.hypot(w, h) || 1;
  const out: { mark: string; from?: P; to?: P } = { mark: `${lines.length > 1 ? `${lines.length} strokes, ` : ''}unclear mark (go by the comment's words)` };
  let [s, t] = lines;
  let tip: P | undefined;
  if (lines.length === 1) {
    // A line drawn there and back over itself (two passes, to make it count) is the line out, not a loop round nothing:
    // it encloses next to no area (Leo, 22 Nov, #430: it read as circled).
    const far = s.reduce((k, p, i) => (dist(p, s[0]) > dist(s[k], s[0]) ? i : k), 0);
    if (dist(s[far], s[0]) > 24 && length(s.slice(far)) > Math.max(60, length(s.slice(0, far + 1)) * 0.5) && area(s) < length(s) * 4 && turns(cut(s, 6), 1) < 4) s = s.slice(0, far + 1); // a short arrow's head is no way back (issue 423)
    const ends = dist(s[0], s[s.length - 1]);
    const c = cut(s, Math.max(3, diag * 0.06));
    // Closed, or nearly: ends close, or a loop that goes at least three quarters round one way (a quick hand stops short
    // or runs past its start). Edge tests, 20 Nov: both read as arrows.
    const loops = winding(cut(s, Math.max(2, diag * 0.03))) > Math.PI * 1.25 && length(s) > diag * 1.3 && !(turns(cut(s, 6), 1) >= 4);
    if ((ends < diag * 0.3 && length(s) > diag * 1.8) || loops) out.mark = c.length >= 4 && c.length <= 7 && turns(c, 1.1) >= 3 ? 'box drawn around it' : 'circled';
    // Cut finer for a low band, or a short word's small waves are cut away and it reads as an arrow (sims, 20 Nov).
    else if (turns(cut(calm(s), Math.min(6, Math.max(2, h / 3))), 0.8) >= 4 && w > 40 && h < Math.min(24, Math.max(18, w * 0.2)) && backs(cut(s, 6)) <= 1) {
      // A wavy underline: small waves along a flat band that only goes one way across (a scribble goes back and forth).
      out.mark = 'wavy underline (likely: wrong / check this)';
      for (let up = 4; up <= 18; up += 4) {
        const above = letterAt((box.l + box.r) / 2, (box.t + box.b) / 2 - up);
        if (above) {
          box.t = above.top;
          break;
        }
      }
    // Or back and forth along its long side four times or more: a flat zigzag over a wide note, which a cut to its size
    // straightens into a line (bench scribble-note read as an arrow, 23 Nov).
    } else if (turns(cut(s, Math.max(6, diag * 0.04)), 1) >= 4 || backs(cut(s, 6), w >= h ? 'x' : 'y', Math.max(w, h) * 0.3) >= 4) out.mark = 'scribbled over (likely: remove this)'; // turns cut to its size: a long gentle wave's shake is not a scribble (issue 423)
    else if (c.length === 3 && c[1].y < Math.min(c[0].y, c[2].y) - h * 0.6 && Math.abs(c[0].y - c[2].y) < h * 0.4 && w < 90) {
      out.mark = 'caret (insert here)';
      out.to = c[1];
    } else if ((tip = headAt(s))) {
      // Its head is drawn: an arrow, before it is read as a line under or beside something (a long flat arrow read as
      // underlined, issue 423).
      Object.assign(out, { mark: 'arrow', from: s[0], to: tip });
    } else if (straight(s) && h < Math.max(18, w * 0.06) && w > 24) {
      const y = (box.t + box.b) / 2;
      const mid = (box.l + box.r) / 2;
      // Asked at five places along the line itself, not once at the middle of its box: a hand's line slopes, and its
      // middle may fall on a space or past the words (Leo, 23 Nov: a line through a heading read as underlined).
      const probes = [0.2, 0.35, 0.5, 0.65, 0.8].map((f) => s[Math.round(f * (s.length - 1))]).map((q) => ({ q, on: letterAt(q.x, q.y) }));
      const hits = probes.filter((h) => h.on);
      const through = hits.filter(({ q, on }) => q.y > on!.top + on!.height * 0.25 && q.y < on!.bottom - on!.height * 0.2);
      const on = through[0]?.on;
      if (on && through.length * 2 > hits.length) {
        out.mark = 'crossed out (likely: remove this)';
        [box.t, box.b] = [Math.min(on.top, box.t), Math.max(on.bottom, box.b)]; // the letters' height, and the whole line in it
      } else {
        out.mark = 'underlined';
        for (let up = 4; up <= 18; up += 4) {
          const above = letterAt(mid, y - up);
          if (above) {
            box.t = above.top;
            break;
          }
        }
      }
    } else if (straight(s) && w < Math.max(18, h * 0.06) && h > 24) {
      out.mark = 'side line (about this block)';
      // The block beside it, on whichever side holds words.
      for (const dx of [24, -24]) {
        const e = document.elementsFromPoint(box.l + dx, (box.t + box.b) / 2).find((n) => !n.closest('[data-lab-comments]'))?.getBoundingClientRect();
        if (e && e.width < innerWidth * 0.95) {
          [box.l, box.r] = [Math.min(box.l, e.left), Math.max(box.r, e.right)];
          break;
        }
      }
    } else {
      Object.assign(out, { mark: 'line', from: s[0], to: s[s.length - 1] });
    }
  } else if (lines.length === 2) {
    const [ls, lt] = [length(s), length(t)];
    if (straight(s) && straight(t) && cross(s[0], s[s.length - 1], t[0], t[t.length - 1]) && Math.min(ls, lt) > Math.max(ls, lt) * 0.5) out.mark = 'X drawn over it (likely: remove this)';
    else if (lt < ls * 0.5 && dist(t[0], s[s.length - 1]) < Math.max(30, lt)) {
      Object.assign(out, { mark: 'arrow', from: s[0], to: s[s.length - 1] });
    }
  }
  // What is under a point on the page itself: labit's own bars and layers (data-lab-comments) are skipped.
  // Over a board: the board's own frame there (its view keeps its frames in a shadow root, so the page's lookup stops at the
  // view's box: an arrow read as on "board …" at both ends; Leo's drawings, 21 Nov).
  // On a board's own page the board says which frame is there (the page's lookup found the board's dialog: each mark of a
  // drawing was "on" it, issue 423); between frames, the board itself.
  const board = (window as unknown as { __labBoard?: { anchor?: (x: number, y: number) => { frame?: string }; box?: (id: string) => HTMLElement | null; contains?: (x: number, y: number) => boolean } }).__labBoard;
  const at = (p?: P) => {
    if (!p) return;
    if (board?.anchor && board.box && (!board.contains || board.contains(p.x, p.y))) {
      const id = board.anchor(p.x, p.y).frame;
      const f = id ? board.box(id) : null;
      const r = f?.getBoundingClientRect();
      return r && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom ? say(f) : 'the board, outside any frame';
    }
    const hit = document.elementsFromPoint(p.x, p.y).find((e) => !e.closest('[data-lab-comments]')) || null;
    // Below a short page, or in a margin, the hit is <html> or <body>: empty space, not their text (which was labit's own
    // script, quoted as the page's: "arrow from <html> "try{localStorage…", 23 Nov).
    if (!hit || hit === document.documentElement || hit === document.body) return 'empty space on the page';
    const inView = (hit as HTMLElement | null)?.shadowRoot?.elementsFromPoint(p.x, p.y).find((e) => e.closest('.f[data-id]'));
    return say(inView?.closest('.f[data-id]') || hit);
  };
  // A drawing is kept as it was drawn, an arrow's own head too (Leo, 23 Nov: "still drawing arrows not right", "some draws
  // backwards"): a clean head drawn at the end of the line read as its shaft landed on a barb, or past a jitter, backwards.
  // Up to 64 strokes are kept (16 were, and the rest went without a word, issue 423); past that, the drawing says how many it had.
  const kept = strokes.slice(0, MAX_STROKES);
  // Several marks in one drawing (circle this, arrow that there, cross out those): each is read on its own and said
  // with what it is on, in the order drawn, so the words can refer to them ("move this one first, rename that"). An
  // arrowhead drawn as its own short stroke stays with its arrow. Sims, 20 Nov: with only "3 strokes, unclear" the
  // agent moved the wrong card.
  let marks: string[] | undefined;
  if (lines.length > 1 && /unclear/.test(out.mark)) {
    const groups: P[][][] = [];
    for (const l of lines) {
      const prev = groups.at(-1)?.at(-1);
      if (prev && length(l) < length(prev) * 0.5 && dist(l[0], prev[prev.length - 1]) < Math.max(30, length(l))) groups.at(-1)!.push(l);
      else groups.push([l]);
    }
    if (groups.length > 1)
      marks = groups.slice(0, 12).map((g) => {
        const r = readInk(g, say);
        const mid = boxOf(g.flat());
        const on = at({ x: (mid.l + mid.r) / 2, y: (mid.t + mid.b) / 2 });
        const what = r.mark.replace(/\s*\(likely:.*\)$/, '').replace(/ \(go by the comment's words\)$/, '');
        return r.from || r.to ? `${what} from ${r.from || '?'} to ${r.to || '?'}` : `${what}${on ? ` on ${on}` : ''}`;
      });
  }
  return { mark: out.mark, from: at(out.from), to: at(out.to), box, lines: kept.map(thin), ...(marks ? { marks } : {}), whole: true, ...(strokes.length > kept.length ? { cut: strokes.length } : {}) };
}

