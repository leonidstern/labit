// Walkie-talkie: talk while you point (Leo, 25 Nov). Part of the comment widget, its own file (public/_lab/walkie.js),
// loaded on the first press of the bar's "walkie-talkie" or K. The words come from the computer's own dictation into the
// pill's box: labit records no sound (the 19 Nov decision). The pointer, clicks, scrolls, circles, shakes and words
// dragged over are logged with their times; send puts the whole walk in the page's chat as one message, each part with
// what was said and the element it was about (selector, label, where on a picture). The agent reads it as the chat.
//
// How words find their spot (benched on the lab page /walk, 38/38 simulated walks, Apple's engine and Whisper):
// a word keeps the moment it first showed up (about 0.3 s after it was said); the talk is cut at pauses, clicks and
// full stops; each piece goes to what the pointer rested on longest while it was said (pointing leads the words by
// ~0.4 s). Dictation that lands words in bursts or all at the end is spread back over the walk, and whole sentences are
// matched to the rests in order. A "this" or "that" gets its own spot. Comparing, "move this there", a sweep over a
// group and selected words need both the pointer and the words to say so.
import css from './walkie.css';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let W: any;
const PAUSE = 1.0; // s between words that cuts a piece
const CLICK_LAG = 0.6; // s: words that land this soon after a click were said before it
const LAG = 0.3; // s from saying a word to its first guess showing up
const WORD_S = 0.35; // s a spoken word takes, to guess when a phrase started
const JOIN = 4; // s of pause a move or a sweep can still carry on over, while the hand travels
// "move this … there", and "all these … rows": what to move or which many, then where to or what they are
const MOVE = /\b(move|put|drag|place|shift)\b[^.]*\b(there|here|next to|below|above|under|before|after|into|between|to the (left|right|top|bottom))\b/;
const MOVE_VERB = /\b(move|put|drag|place|shift)\b/;
const MOVE_ON = /^(and |then )?(over |right |down |up )?(there|here|next to|below|above|under|before|after|into|between|to the (left|right|top|bottom))\b/;
const MANY = /\b(all (of )?(these|those|the)|these|those|every|each)\b/;
const THING = /\b(rows?|cards?|items?|buttons?|links?|columns?|lines?|ones|all|them|fields?|chips?|tabs?|icons?)\b/;
const THING_ON = /^(rows?|cards?|items?|buttons?|links?|columns?|lines?|ones|fields?|chips?|tabs?|icons?)\b/;
// The next piece finishes the sentence the pause cut: only when it starts with the missing half and no full stop was said.
function carries(a, b) {
  if (b.first - a.end > JOIN || /[.!?]$/.test(a.words[a.words.length - 1])) return false;
  const one = a.words.join(' ').toLowerCase(), next = b.words.join(' ').toLowerCase();
  if (MOVE_VERB.test(one) && !MOVE.test(one) && MOVE_ON.test(next)) return true;
  return MANY.test(one) && !THING.test(one.replace(MANY, '')) && THING_ON.test(next);
}

let on = false;
let t0 = 0;
let words = [];
let hovers = [];
let clicks = [];
let scrolls = [];
let gestures = [];
let moves = [];
let quotes = [];
let trail = [];
let drawn = []; // what the ink shows: the trail as moved, not cut when a gesture counts
let drag = null;
let cur = null;
let curCell = null;
let drifting = false;
let lastX = -1;
let lastY = -1;
let timer = 0;
let scrollIdle = 0;
let quietUntil = 0;
let keptQuote = null;
let ring = null; // a circle waiting to see where the pointer lands (gesture, below)
let bodyOff = false; // the page had data-lab-off on its body itself
let unsent = []; // walks the lab didn't take, in order: tal(k) sends them again
let resending = false;
let btnWas = null; // tal(k)'s own label, while the button says something else
let btnT = 0;
let shots = new Map(); // element -> what it was when seen: [{ t, label, sel }]
let pill: HTMLElement;
let ta: HTMLTextAreaElement;
let tm: HTMLElement;
let ink: HTMLCanvasElement;
const now = () => (performance.now() - t0) / 1000;

// Which element a spot is about: the nearest meaningful one, never labit's own parts.
const PICK = 'button,a,input,select,textarea,label,img,svg,video,canvas,h1,h2,h3,h4,p,li,tr,th,td,blockquote,pre,figure,[role=button],[id]';
function target(el) {
  if (!el?.closest || el.closest('[data-lab-comments]')) return null;
  const off = el.closest('[data-lab-off]');
  if (off && off !== el.ownerDocument.body) return null; // a board's labels, the zoom box: labit's, not the page's
  let t = el.closest(PICK);
  t = t && t !== t.ownerDocument.body ? t : null;
  return t && !tooBig(t) ? t : null;
}
// A whole panel or section is not what anyone points at: its blank space, or the gap between two cards, is no spot.
function tooBig(t) {
  if (/^(img|canvas|svg|video|picture|textarea|input|button|a|p|li|tr|td|th|h1|h2|h3|h4|label|select)$/.test(t.localName)) return false;
  const r = t.getBoundingClientRect(), win = t.ownerDocument.defaultView;
  return r.width * r.height > 0.3 * win.innerWidth * win.innerHeight || t.querySelectorAll(PICK).length > 6;
}
// Every frame on the page, the ones inside shadow roots too (a board shows its pages in frames under its own layer).
function allFrames(): HTMLIFrameElement[] {
  const out = [];
  const walk = (root) => {
    for (const n of root.querySelectorAll('*')) {
      if (n.localName === 'iframe') out.push(n);
      if (n.shadowRoot && n !== W.host) walk(n.shadowRoot);
    }
  };
  walk(document);
  return out;
}
const framePath = new WeakMap();
function frameOf(el) {
  if (el.ownerDocument === document) return '';
  if (framePath.has(el.ownerDocument)) return framePath.get(el.ownerDocument);
  const f = allFrames().find((x) => {
    try {
      return x.contentDocument === el.ownerDocument;
    } catch {
      return false;
    }
  });
  const out = f ? `frame ${new URL(f.src, location.href).pathname} › ` : 'frame › ';
  framePath.set(el.ownerDocument, out);
  return out;
}
const selectorOf = (el) => frameOf(el) + selectorIn(el);
function selectorIn(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts = [];
  while (el && el !== el.ownerDocument.body) {
    if (el.id) {
      parts.unshift(`#${CSS.escape(el.id)}`);
      break;
    }
    let i = 1;
    for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (s.localName === el.localName) i++;
    parts.unshift(`${el.localName}:nth-of-type(${i})`);
    el = el.parentElement;
  }
  return parts.join(' > ');
}
function label(el) {
  const cap = el.querySelector?.(':scope > figcaption b, :scope > h2, :scope > h3');
  if (cap) return cap.textContent.trim();
  const t = (el.getAttribute('aria-label') || el.getAttribute('alt') || el.placeholder || el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  return (el.localName === 'tr' ? 'row ' : '') + (t.length > 40 ? `${t.slice(0, 39)}…` : t || el.localName);
}
// What an element was when it was seen, not when the walk is sent: a list that reuses its rows (a virtual list) shows
// other words in the same element by then.
function snap(el) {
  if (!el) return el;
  const d = { t: now(), label: label(el), sel: selectorOf(el) }, list = shots.get(el), last = list?.[list.length - 1];
  if (!list) shots.set(el, [d]);
  else if (last.label !== d.label || last.sel !== d.sel) list.push(d);
  return el;
}
// What it was at time t (seconds into the walk); an element first met at the end (a group) is described now.
function desc(el, t) {
  const list = shots.get(el);
  return list ? list.filter((d) => d.t <= t + 0.5).pop() || list[0] : { label: label(el), sel: selectorOf(el) };
}

// The pointer: logged only when the element under it changes. On a picture (a screenshot, a canvas, a video) the spot
// is also where on it, in shares of its size.
function spotOn(t, x?: number, y?: number) {
  if (!t || !/^(img|canvas|svg|video|picture)$/.test(t.localName) || x == null || t.ownerDocument !== document) return null;
  const r = t.getBoundingClientRect();
  return { x: Math.max(0, Math.min(1, (x - r.left) / r.width)), y: Math.max(0, Math.min(1, (y - r.top) / r.height)) };
}
function point(el, x?: number, y?: number) {
  const t = target(el), pos = spotOn(t, x, y), cell = pos && `${Math.round(pos.x * 10)},${Math.round(pos.y * 10)}`;
  if (t === cur && cell === curCell) return;
  curCell = cell;
  cur = t;
  hovers.push({ t: now(), el: snap(t), pos, drift: drifting || undefined });
}
// What is under a point, looking into same-origin frames: the frame's page is asked at the matching spot, scaled the
// way the board shows it. Found by its box, as a board's frames don't take the pointer.
function frameAt(x, y) {
  const fs = allFrames();
  for (let i = fs.length - 1; i >= 0; i--) {
    const f = fs[i], r = f.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom || !r.width) continue;
    let d: Document | null = null;
    try {
      d = f.contentDocument;
    } catch {}
    if (!d) continue;
    return { f, el: d.elementFromPoint((x - r.left) * (f.clientWidth / r.width), (y - r.top) * (f.clientHeight / r.height)) || null };
  }
  return null;
}
// Everything under a point, top first, inside shadow roots too (not labit's own).
function stackAt(x, y) {
  const out = [];
  const add = (root) => {
    for (const n of root.elementsFromPoint(x, y)) {
      if (out.includes(n) || (root !== document && n.getRootNode() !== root)) continue;
      if (n.shadowRoot && n !== W.host) add(n.shadowRoot);
      out.push(n);
    }
  };
  add(document);
  return out;
}
// a holds b, across shadow roots
function holds(a, b) {
  for (let n = b; n; n = n.parentElement || n.getRootNode().host) if (n === a) return true;
  return false;
}
function at(x, y, fallback?) {
  const fr = frameAt(x, y);
  if (fr) {
    // a meaningful thing over the frame (a button on top of it) is what is pointed at, not the frame's page under it
    const top = stackAt(x, y).find((n) => n === fr.f || holds(n, fr.f) || target(n));
    if (!top || top === fr.f || holds(top, fr.f)) return fr.el;
    return top;
  }
  const el = fallback && fallback !== W.host ? fallback : document.elementFromPoint(x, y);
  if (target(el)) return el;
  // a layer with nothing meaningful on top (a site's overlay, an animation wrapper): the first thing under it that is
  return document.elementsFromPoint(x, y).find((n) => target(n)) || el;
}
const ours = (e) => e.composedPath().includes(W.host);
function onMove(e) {
  if (!on || e.pointerType === 'touch') return;
  lastX = e.clientX;
  lastY = e.clientY;
  point(at(e.clientX, e.clientY, e.target), e.clientX, e.clientY);
  const lm = moves[moves.length - 1];
  if (!lm || Math.hypot(e.clientX - lm.x, e.clientY - lm.y) > 6) moves.push({ x: e.clientX, y: e.clientY, t: now() });
  if (drag && e.buttons & 1) return showQuote(e.clientX, e.clientY); // selecting words: no circle or shake
  gesture(e.clientX, e.clientY);
}
// Words dragged over (selected). A real selection would take the focus from the box and stop dictation, so the walk
// draws its own, with labit's quote highlight, from where the button went down to the pointer.
function caretAt(x, y) {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
  const c = document.caretPositionFromPoint?.(x, y);
  if (!c) return null;
  const r = document.createRange();
  r.setStart(c.offsetNode, c.offset);
  r.collapse(true);
  return r;
}
function rangeOf(x, y) {
  const a = caretAt(drag.x, drag.y), b = caretAt(x, y);
  if (!a || !b) return null;
  const r = document.createRange();
  try {
    const [s, f] = a.compareBoundaryPoints(Range.START_TO_START, b) <= 0 ? [a, b] : [b, a];
    r.setStart(s.startContainer, s.startOffset);
    r.setEnd(f.startContainer, f.startOffset);
  } catch {
    return null;
  }
  return r;
}
const lit = (r) => {
  if (!window.CSS?.highlights) return;
  if (r) CSS.highlights.set('lab-quote', new Highlight(r));
  else CSS.highlights.delete('lab-quote');
};
function showQuote(x, y) {
  if (Math.hypot(x - drag.x, y - drag.y) < 8) return;
  drag.range = rangeOf(x, y);
  lit(drag.range);
}
function onUp() {
  if (!on || !drag) return;
  const r = drag.range, d = drag;
  drag = null;
  const text = r ? r.toString().replace(/\s+/g, ' ').trim() : '';
  const far = Math.hypot(lastX - d.x || 0, lastY - d.y || 0);
  if (far >= 30 && (text.split(' ').length >= 2 || text.length >= 12)) {
    clicks = clicks.filter((c) => c.t < d.t - 0.01); // a drag is not a click: no cut, no click spot
    let from = r.startContainer;
    if (from.nodeType !== 1) from = from.parentElement; // where the selection began
    quotes.push({ t: d.t, end: now(), el: snap(target(from)), text: text.length > 160 ? `${text.slice(0, 159)}…` : text });
  } else lit(null);
}

// Mouse language: a shake (back and forth, fast) marks a spot as important or wrong; a circle says "this area".
function gesture(x, y) {
  const t = performance.now(), last = trail[trail.length - 1];
  if (last && Math.hypot(x - last.x, y - last.y) < 3) return;
  trail.push({ x, y, t });
  drawn.push({ x, y, t });
  while (drawn.length && t - drawn[0].t > 600) drawn.shift();
  while (trail.length && t - trail[0].t > 4500) trail.shift(); // slow, careful circles take a few seconds
  if (t < quietUntil) return;
  const g = shake(t) || circle();
  if (!g) return;
  trail = [];
  quietUntil = t + 600;
  if (g.kind !== 'circle') return commit(g, now());
  // A loop can be a hook: overshooting and coming round to land on something. So wait a moment and look where the
  // pointer settles: on a thing the loop mostly lies outside of, it was a landing, not a ring round it.
  settle(); // one waiting already: decided now
  ring = { g, when: now(), id: window.setTimeout(settle, 300) };
}
// Decide the waiting circle: also when the walk ends before its moment is up, so it neither goes missing nor lands in
// the next walk.
function settle() {
  if (!ring) return;
  const { g, when, id } = ring;
  ring = null;
  clearTimeout(id);
  const endEl = target(document.elementFromPoint(lastX, lastY)), er = endEl?.getBoundingClientRect(), bx = g.box;
  const ov = er ? Math.max(0, Math.min(er.right, bx.r) - Math.max(er.left, bx.l)) * Math.max(0, Math.min(er.bottom, bx.b) - Math.max(er.top, bx.t)) : 0;
  const area = (bx.r - bx.l) * (bx.b - bx.t);
  if (endEl && area > 0 && ov < 0.4 * area && bx.r - bx.l < 220 && bx.b - bx.t < 220) return;
  commit(g, when);
}
function commit(g, when) {
  let el = g.kind === 'circle' ? inside(g.box) : target(at(g.x, g.y));
  if (el && tooBig(el)) el = null;
  gestures.push({ t: when, kind: g.kind, el: snap(el) });
}
// A deliberate shake: 5+ quick reversals of 32 px or more along one line (sideways, up-down or slanted), within 0.9 s,
// staying close to that line (a small wiggle while resting is not one).
function shake(t) {
  const pts = trail.filter((p) => t - p.t <= 900);
  if (pts.length < 6) return null;
  const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length, my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) {
    const dx = p.x - mx, dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(ang), uy = Math.sin(ang);
  const along = pts.map((p) => (p.x - mx) * ux + (p.y - my) * uy);
  if (Math.max(...pts.map((p) => Math.abs(-(p.x - mx) * uy + (p.y - my) * ux))) > 40) return null; // a shake stays on its line
  let turns = 0, dir = 0, from = along[0];
  for (let i = 1; i < along.length; i++) {
    const d = along[i] - from;
    if (Math.abs(d) < 32) continue;
    const s = d > 0 ? 1 : -1;
    if (dir && s !== dir) turns++;
    dir = s;
    from = along[i];
  }
  return turns < 5 ? null : { kind: 'shake', pts, x: mx, y: my, box: null };
}
// A deliberate circle: one way round (not hairpins back and forth, as when reading rows or hooking onto a target),
// roughly round, ending near where it began. Walk back from now adding up the turning, and take the stretch that makes
// one full turn whose start is nearest the end: the loop itself, not the approach before it.
function circle() {
  let turned = 0, bent = 0, full = -1, fb = 0, ft = 0, bestGap = Infinity;
  for (let i = trail.length - 2; i > 0; i--) {
    const a = Math.atan2(trail[i + 1].y - trail[i].y, trail[i + 1].x - trail[i].x), b = Math.atan2(trail[i].y - trail[i - 1].y, trail[i].x - trail[i - 1].x);
    let d = a - b;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    if (Math.abs(d) > 2.3) break; // a hairpin: the loop can't reach back past it
    turned += d;
    bent += Math.abs(d);
    if (Math.abs(turned) > 2.2 * Math.PI) break;
    if (Math.abs(turned) >= 1.6 * Math.PI) {
      const gap = Math.hypot(trail[i].x - trail[trail.length - 1].x, trail[i].y - trail[trail.length - 1].y);
      if (full < 0 || gap < bestGap) [full, fb, ft, bestGap] = [i, bent, turned, gap];
    }
  }
  if (full < 0 || Math.abs(ft) < 0.8 * fb) return null; // no full turn, or it wobbled both ways
  const pts = trail.slice(full - 1), xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const box = { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys) };
  const w = box.r - box.l, h = box.b - box.t, end = pts[pts.length - 1];
  if (w < 20 || h < 14 || w > 10 * h || h > 10 * w) return null; // too small, or flat
  // closed: the end comes back near the start (to any of the first quarter of the loop)
  const near0 = Math.min(...pts.slice(0, Math.max(2, Math.ceil(pts.length / 4))).map((q) => Math.hypot(end.x - q.x, end.y - q.y)));
  if (near0 > 0.6 * Math.max(w, h)) return null;
  const cx = (box.l + box.r) / 2, cy = (box.t + box.b) / 2, rs = pts.map((p) => Math.hypot((p.x - cx) / (w / 2), (p.y - cy) / (h / 2)));
  const mean = rs.reduce((a, b) => a + b, 0) / rs.length, sd = Math.sqrt(rs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / rs.length);
  if (sd / mean > 0.35) return null; // not round: a wander, an arc, a U-turn
  if (rs[rs.length - 1] < 0.5 * mean) return null; // ends in the middle: hooking back onto a target, not going round it
  return { kind: 'circle', pts, box, x: cx, y: cy };
}
// What a circle went round: the things mostly inside it, or the one thing they all sit in.
function inside(box) {
  const hit = [...document.body.querySelectorAll(PICK)].filter((el) => {
    const r = el.getBoundingClientRect(), iw = Math.max(0, Math.min(r.right, box.r) - Math.max(r.left, box.l)), ih = Math.max(0, Math.min(r.bottom, box.b) - Math.max(r.top, box.t));
    return r.width * r.height > 0 && iw * ih >= 0.7 * r.width * r.height && !W.host.contains(el);
  }).filter((el, _, all) => !all.some((o) => o !== el && o.contains(el)));
  if (!hit.length) return target(at((box.l + box.r) / 2, (box.t + box.b) / 2));
  let c = hit[0];
  while (c && !hit.every((el) => c.contains(el))) c = c.parentElement;
  return c && c !== document.body ? c : hit.length === 1 ? hit[0] : null;
}
// The pointer's trail, faint: one smooth stroke, not dots. A gesture that counts doesn't change it (Leo, 25 Nov: no flash);
// the message says so.
function inkLoop() {
  const dpr = devicePixelRatio || 1, cx = ink.getContext('2d');
  if (!cx) return;
  if (ink.width !== innerWidth * dpr || ink.height !== innerHeight * dpr) [ink.width, ink.height] = [innerWidth * dpr, innerHeight * dpr];
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx.clearRect(0, 0, innerWidth, innerHeight);
  const t = performance.now();
  cx.lineCap = cx.lineJoin = 'round';
  cx.strokeStyle = getComputedStyle(W.host).getPropertyValue('--_green-fg').trim() || 'green';
  const pts = drawn.filter((p) => t - p.t < 600);
  if (pts.length > 2 && words.length) {
    cx.globalAlpha = 0.35;
    cx.lineWidth = 2;
    cx.beginPath();
    cx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) cx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
    cx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    cx.stroke();
  }
  cx.globalAlpha = 1;
  if (on) requestAnimationFrame(inkLoop);
  else cx.clearRect(0, 0, innerWidth, innerHeight);
}
function onDown(e) {
  if (!on || ours(e)) return;
  const t = target(at(e.clientX, e.clientY, e.target));
  if (e.pointerType === 'mouse') {
    e.preventDefault(); // the box keeps the focus, so dictation keeps going
    drag = { x: e.clientX, y: e.clientY, t: now() };
  }
  if (t) {
    clicks.push({ t: now(), el: snap(t), pos: spotOn(t, e.clientX, e.clientY) }); // on a picture, where on it
    point(t, e.clientX, e.clientY);
  }
}
function onScroll() {
  if (!on) return;
  clearTimeout(scrollIdle);
  scrollIdle = window.setTimeout(() => {
    // With a mouse the page moved under a still pointer: what is under it now, weakly. Without one: the middle.
    if (lastX >= 0) {
      drifting = true;
      point(at(lastX, lastY));
      drifting = false;
      return;
    }
    scrolls.push({ t: now(), y: Math.round(scrollY), el: snap(target(document.elementFromPoint(innerWidth / 2, innerHeight / 2))) });
  }, 250);
}
// The screen's own buttons and links do nothing while walking: a click is pointing.
const onClick = (e) => on && !ours(e) && (e.preventDefault(), e.stopPropagation());
// Words: each keeps the moment it first showed up, even when dictation corrects it later ("their" → "there"). The
// same words at the start and at the end keep theirs; the ones between take the old ones' times in order, so a word
// taken out or put in the middle doesn't shift the times of the words after it.
function onInput() {
  const next = ta.value.split(/\s+/).filter(Boolean), t = now();
  let a = 0, z = 0;
  while (a < next.length && a < words.length && next[a] === words[a].w) a++;
  while (z < next.length - a && z < words.length - a && next[next.length - 1 - z] === words[words.length - 1 - z].w) z++;
  words = next.map((w, i) => {
    const old = i < a ? words[i] : i >= next.length - z ? words[words.length - (next.length - i)] : words[i] && i < words.length - z ? words[i] : null;
    return { w, t: old ? old.t : t };
  });
  ta.scrollTop = ta.scrollHeight; // the newest line shows
}
const onKey = (e) => {
  if (!on) return;
  if (e.key === 'Escape') return (e.preventDefault(), e.stopPropagation(), stop(false));
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) return (e.preventDefault(), e.stopPropagation(), stop(true));
};
// The clock counts from the first word: until words come, nothing looks like recording (the pointer is still noted,
// as it leads the words).
const clock = () => {
  const s = words.length ? Math.floor(now() - words[0].t) : 0;
  tm.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function mount() {
  if (pill) return;
  W.root.append(Object.assign(document.createElement('style'), { textContent: css }));
  const mk = (tag, attrs = {}, ...kids) => {
    const n = W.el(tag, attrs);
    n.append(...kids);
    return n;
  };
  ink = mk('canvas', { class: 'wk-ink', 'aria-hidden': 'true' });
  tm = mk('span', {}, '0:00');
  ta = mk('textarea', { placeholder: 'Tap dictation key, talk', 'aria-label': "what you say: your computer's own dictation types it here" });
  const send = mk('button', { type: 'button', class: 'wk-send' }, 'Send');
  const x = mk('button', { type: 'button', class: 'wk-x', 'aria-label': 'cancel' }, 'esc');
  pill = mk('div', { class: 'walkie', role: 'group', 'aria-label': 'walkie-talkie', hidden: '' }, mk('span', { class: 'wk-tm' }, mk('i', { class: 'wk-dot' }), tm), ta, send, x);
  W.root.append(ink, pill);
  send.addEventListener('click', () => stop(true));
  x.addEventListener('click', () => stop(false));
  // A press on the pill (not its buttons) keeps the cursor in the box.
  pill.addEventListener('pointerdown', (e) => e.target === pill && (e.preventDefault(), ta.focus()));
  ta.addEventListener('input', onInput);
  ta.addEventListener('keydown', onKey);
  addEventListener('keydown', onKey, true);
  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('click', onClick, true);
  addEventListener('scroll', onScroll, { capture: true, passive: true });
}

function start() {
  mount();
  on = true;
  t0 = performance.now();
  words = [];
  hovers = [];
  clicks = [];
  scrolls = [];
  gestures = [];
  trail = [];
  drawn = [];
  moves = [];
  quotes = [];
  drag = null;
  cur = null;
  shots = new Map();
  clearTimeout(scrollIdle);
  if (ring) clearTimeout(ring.id);
  ring = null;
  keptQuote = window.CSS?.highlights?.get('lab-quote') || null; // an open pin's quote, back after the walk
  ta.value = '';
  // No pins anywhere while walking (Leo, 25 Nov): the page is labit's off-limits, the pointer the plain arrow.
  bodyOff = document.body.hasAttribute('data-lab-off');
  document.body.setAttribute('data-lab-off', '');
  W.host.setAttribute('data-walking', '');
  pill.hidden = false;
  clock();
  ta.focus({ preventScroll: true });
  timer = window.setInterval(clock, 500);
  inkLoop();
}
function stop(send: boolean) {
  if (send) settle();
  if (ring) clearTimeout(ring.id);
  ring = null;
  clearTimeout(scrollIdle);
  on = false;
  clearInterval(timer);
  if (!bodyOff) document.body.removeAttribute('data-lab-off');
  W.host.removeAttribute('data-walking');
  pill.hidden = true;
  ta.blur();
  if (keptQuote) CSS.highlights.set('lab-quote', keptQuote);
  else lit(null);
  if (!send) return;
  // How exact the times are: words that showed up one by one (live dictation) or many at once (a whole sentence).
  // Counted before cut(), which spreads words that came in bursts.
  const alone = words.filter((w) => words.filter((x) => x.t === w.t).length <= 2).length;
  const live = words.length ? Math.round((100 * alone) / words.length) : 0;
  const pieces = cut();
  if (!pieces.length) return void W.say?.('nothing was said');
  void post(pieces, live);
}
export const walking = () => on;
export function toggle(w: unknown) {
  W = w;
  if (!on && unsent.length && !resending) return void retry(); // a walk the lab didn't take: this press sends it again
  return on ? stop(true) : start();
}

// Cut the words at long pauses and just after clicks, then put each piece on what it was about.
function cut() {
  // Dictation that hands words over in bursts (a speech engine every few seconds, Safari all at the end): the times are
  // when bursts landed, not when words were said.
  let quick = 0;
  for (let i = 1; i < words.length; i++) if (words[i].t - words[i - 1].t < 0.25) quick++;
  if (words.length > 4 && quick / (words.length - 1) > 0.6) {
    const bursts = [];
    for (const w of words) {
      const b = bursts[bursts.length - 1];
      if (b && w.t - b.t < 0.25) {
        b.ws.push(w);
        b.t = w.t;
      } else bursts.push({ t: w.t, ws: [w] });
    }
    // Full stops say where sentences end; when the engine gives them (2+ inside the talk), sentence order is the surer
    // guide, so treat the talk as landing at once. Without them, each burst's words were said between the burst
    // before it and this one: spread them evenly over that stretch, so they act like live words.
    const stopsInside = words.slice(0, -1).filter((w) => /[.!?]$/.test(w.w)).length;
    if (bursts.length >= 3 && stopsInside < 2) {
      let prevA = Math.max(0, bursts[0].t - bursts[0].ws.length * WORD_S - 0.6);
      words = [];
      for (const b of bursts) {
        const from = prevA, to = b.t - LAG, n = b.ws.length;
        b.ws.forEach((w, j) => words.push({ w: w.w, t: from + ((j + 0.5) / n) * Math.max(0.3, to - from) + LAG }));
        prevA = to;
      }
    } else {
      const lastT = words[words.length - 1].t;
      words = words.map((w) => ({ w: w.w, t: lastT }));
    }
  }
  const out = [];
  let piece = null, last = -1;
  const splits = clicks.map((c) => c.t + CLICK_LAG);
  for (const w of words) {
    const split = !piece || w.t - last > PAUSE || splits.some((s) => s > last && s <= w.t) || (piece.words.length && /[.!?]$/.test(piece.words[piece.words.length - 1]) && w.t !== last);
    if (split) out.push((piece = { words: [], said: [], first: w.t, end: w.t }));
    piece.words.push(w.w);
    piece.said.push({ w: w.w, t: w.t });
    piece.end = w.t;
    last = w.t;
  }
  for (let i = out.length - 1; i > 0; i--) {
    const [a, b] = [out[i - 1], out[i]];
    if (!carries(a, b)) continue;
    a.words.push(...b.words);
    a.said.push(...b.said);
    a.end = b.end;
    out.splice(i, 1);
  }
  const log = [...hovers, ...scrolls].sort((a, b) => a.t - b.t);
  let prevEnd = 0;
  for (const p of out) {
    const firstChunk = words.filter((w) => w.t === p.first).length;
    p.from = Math.max(prevEnd, p.first - firstChunk * WORD_S - LAG - 0.4); // pointing leads the words
    p.to = p.end;
    // a click shortly before the talk started is what the talk is about (point, then say)
    const reach = Math.max(prevEnd, p.from - PAUSE);
    prevEnd = p.end;
    const near = (g) => g.t >= reach && g.t <= p.to;
    p.shook = gestures.some((g) => g.kind === 'shake' && near(g));
    const click = clicks.filter((g) => near(g) && g.t <= p.from + 0.6).pop();
    const ring = gestures.filter((g) => g.kind === 'circle' && near(g)).pop();
    const jolt = gestures.filter((g) => g.kind === 'shake' && near(g)).pop();
    const pick = click ? [click, 'clicked'] : ring ? [ring, 'circled'] : jolt ? [jolt, 'shook it'] : null;
    if (pick?.[0].el) {
      p.el = pick[0].el;
      p.pos = pick[0].pos;
      p.why = pick[1] + (p.shook && pick[1] !== 'shook it' ? ', shook it' : '');
      continue;
    }
    // else the element held longest while it was said (hover, or where a scroll settled on a phone)
    const held = new Map();
    log.forEach((h, i) => {
      const a = Math.max(h.t, p.from), b = Math.min(log[i + 1] ? log[i + 1].t : p.to, p.to);
      if (h.el && b > a) held.set(h.el, (held.get(h.el) || 0) + (b - a) * (h.drift ? 0.3 : 1)); // scrolled under a still pointer: weak
    });
    let best = null, most = 0;
    held.forEach((v, k) => v > most && ([most, best] = [v, k]));
    if (best && most < 0.5) best = null; // passed over, not pointed at
    if (!best && !log.some((h) => h.t <= p.to && h.t >= p.from - 0.5)) best = log.filter((h) => h.t <= p.to).pop()?.el; // where the pointer last was
    p.el = best;
    p.why = (best ? `pointed ${most.toFixed(1)}s` : 'no spot') + (p.shook ? ', shook it' : '');
    const lastOn = log.filter((h) => h.el === best && h.pos && h.t <= p.to).pop();
    if (lastOn) p.pos = lastOn.pos;
  }
  // Stops: where the pointer came to rest (0.3 s or more), and every click, circle and shake. Pointing settles on a
  // thing before its word is said (hand ~0.37 s, eyes ~0.9 s ahead), so a word looks back for its stop.
  const stops = [];
  log.forEach((h, i) => {
    const end = log[i + 1] ? log[i + 1].t : now();
    if (h.el && end - h.t >= 0.3) stops.push({ t: h.t, end, el: h.el, w: (end - h.t) * (h.drift ? 0.3 : 1), pos: h.pos });
  });
  for (const g of [...clicks, ...gestures]) if (g.el) stops.push({ t: g.t - 0.2, end: g.t + 0.4, el: g.el, w: 5, pos: g.pos });
  for (const g of quotes) if (g.el) stops.push({ t: g.t, end: g.end + 0.3, el: g.el, w: 5 });
  stops.sort((a, b) => a.t - b.t);
  let lastLand = 0;
  for (const p of out) {
    const deictic = p.said.filter((w) => /^(this|that|these|those|here|there)[.,!?]?$/i.test(w.w));
    // one "this" in a piece is the piece's spot; several need one spot each
    if (deictic.length < 2) {
      lastLand = p.end;
      continue;
    }
    // Group the words by the moment they landed: live dictation lands them one by one, other dictation a sentence at once.
    const groups = [];
    for (const w of p.said) {
      const g = groups[groups.length - 1];
      if (g && g.t === w.t) g.words.push(w);
      else groups.push({ t: w.t, words: [w] });
    }
    for (const g of groups) {
      const ds = g.words.filter((w) => deictic.includes(w));
      if (!ds.length) {
        lastLand = g.t;
        continue;
      }
      if (g.words.length <= 2) {
        // live: where the pointer rested about 0.37 s before the word was said; a click or gesture over a plain rest
        for (const w of ds) {
          const T = w.t - LAG - 0.37;
          const near = stops.filter((s) => s.t <= T + 0.3 && s.end >= T - 0.1);
          const best = near.filter((s) => s.w >= 5).pop() || near.pop()
            || stops.filter((s) => s.t > T && s.t <= T + 1.2 && s.w >= 0.4)[0] // the pointer still on its way
            || stops.filter((s) => s.t <= T).pop();
          if (best) [w.at, w.pos] = [best.el, best.pos];
        }
      } else if ((p.words.join(' ').match(/[.!?](\s|$)/g) || []).length < 2) {
        // a sentence at once: the n strongest stops since the last words landed, in time order, go to the n words in order
        const strongest = stops.filter((s) => s.end > lastLand && s.t < g.t).sort((x, y) => y.w - x.w).slice(0, ds.length).sort((x, y) => x.t - y.t);
        ds.forEach((w, i) => strongest[i] && ([w.at, w.pos] = [strongest[i].el, strongest[i].pos]));
      }
      lastLand = g.t;
    }
  }
  // A whole talk that landed at once (tap dictation in a web page commits at the end): cut it into sentences; the
  // rests while it was said go to the sentences in order.
  const fin = [];
  let prevLand = 0;
  for (const p of out) {
    const lumps = {};
    for (const w of p.said) lumps[w.t] = (lumps[w.t] || 0) + 1;
    const big = Math.max(...Object.values(lumps).map(Number));
    const sentences = [];
    let part = [];
    for (const w of p.said) {
      part.push(w);
      if (/[.!?]$/.test(w.w)) {
        sentences.push(part);
        part = [];
      }
    }
    if (part.length) sentences.push(part);
    if (big < 6 || sentences.length < 2) {
      fin.push(p);
      prevLand = p.to;
      continue;
    }
    // The rests while it was said: one per place (two stops in a row on one thing are one); clicked, circled and
    // shaken ones weigh more.
    const end = p.to - LAG, rests = [];
    for (const st of stops.filter((s) => s.end > prevLand && s.t < end)) {
      const r = rests[rests.length - 1];
      if (r && r.el === st.el && !st.pos && !r.pos) {
        r.end = st.end;
        r.w += st.w;
      } else rests.push({ t: st.t, end: st.end, w: st.w, el: st.el, pos: st.pos, hit: st.w >= 5 });
    }
    const start = rests.length ? Math.max(prevLand, Math.min(rests[0].t - 2.5, end - p.said.length * WORD_S)) : prevLand; // talk often starts a little before the first stop
    // Each sentence gets its share of the talk by its words; the order is kept (sentence k never goes back to an
    // earlier place than sentence k-1). Best total fit wins.
    let done = 0;
    const spans = sentences.map((ws) => {
      const a = start + ((end - start) * done) / p.said.length;
      done += ws.length;
      return [a - 0.37, start + ((end - start) * done) / p.said.length - 0.37];
    });
    const fit = (k, j) => {
      const r = rests[j], o = Math.max(0, Math.min(r.end, spans[k][1]) - Math.max(r.t, spans[k][0])) / Math.max(0.3, spans[k][1] - spans[k][0]);
      return o + (0.15 * Math.min(r.w, 3)) / 3 + (r.hit ? 0.3 : 0);
    };
    let pickJ = [];
    if (rests.length === sentences.length) pickJ = sentences.map((_, i) => i); // as many places as sentences: one each, in order
    else if (rests.length) {
      const best = sentences.map(() => rests.map(() => -1)), from = sentences.map(() => rests.map(() => 0));
      for (let k = 0; k < sentences.length; k++) {
        for (let j = 0; j < rests.length; j++) {
          let prev = 0, pj = 0;
          if (k) for (let jj = 0; jj <= j; jj++) if (best[k - 1][jj] > prev) [prev, pj] = [best[k - 1][jj], jj];
          best[k][j] = prev + fit(k, j);
          from[k][j] = pj;
        }
      }
      const K = sentences.length - 1;
      let bj = 0;
      for (let j = 0; j < rests.length; j++) if (best[K][j] > best[K][bj]) bj = j;
      for (let k = K; k >= 0; k--) {
        pickJ[k] = bj;
        bj = from[k][bj];
      }
    }
    sentences.forEach((ws, k) => {
      let r = rests.length ? rests[pickJ[k]] : null;
      // fewer places than sentences: a sentence said where the pointer rested nowhere (a hello first) gets no spot
      if (r && rests.length < sentences.length && Math.min(r.end, spans[k][1]) <= Math.max(r.t, spans[k][0]) && !r.hit) r = null;
      // the first sentence sharing its place with the next and said mostly before the pointer got there: a preamble
      if (r && k === 0 && sentences.length > 1 && pickJ[1] === pickJ[0] && !r.hit) {
        const ov = Math.max(0, Math.min(r.end, spans[0][1]) - Math.max(r.t, spans[0][0])) / Math.max(0.3, spans[0][1] - spans[0][0]);
        if (ov < 0.5) r = null;
      }
      // a sentence that ran over several places names them all
      const also = r ? rests.filter((x) => x.t < spans[k][1] && x.end > spans[k][0] && x !== r && x.w >= 0.6 && x.el !== r.el).map((x) => x.el) : [];
      fin.push({
        words: ws.map((w) => w.w), said: ws, from: spans[k][0] + 0.37, to: spans[k][1] + 0.37, first: p.first, end: p.end, also,
        el: r ? r.el : rests.length ? null : p.el, pos: r?.pos,
        why: r ? `${r.hit ? 'clicked or gesture' : `rested ${r.w.toFixed(1)}s`}, guessed from sentence order` : rests.length ? 'said before pointing' : p.why,
      });
    });
    prevLand = p.to;
  }
  const seenIn = (q) => {
    const seen = [];
    for (const st of stops) if (st.el && st.end > (q.from || 0) - 1 && st.t < (q.to || q.end) + 0.5 && !seen.includes(st.el)) seen.push(st.el);
    return seen;
  };
  // Back and forth between two things (A, B, A within ~4.5 s) while the words compare: "this vs that".
  const pairs = [];
  for (let i = 0; i + 2 < stops.length; i++) {
    const [A, B, A2] = [stops[i], stops[i + 1], stops[i + 2]];
    if (A.el && B.el && A.el !== B.el && A2.el === A.el && A2.end - A.t <= 4.5 && A.w < 5 && B.w < 5) pairs.push({ t: A.t, end: A2.end, a: A.el, b: B.el });
  }
  const COMPARE = /\b(this|that)( one)? (vs|versus|or) (this|that)( one)?\b|\bwhich (one )?(is|looks|reads|works) (better|worse|bigger|smaller|clearer|nicer)\b|\bcompare\b|\bcompared to\b|\b(these|the|those) two\b|\bdifference between\b|\b(bigger|smaller|better|worse|clearer|darker|lighter) than (this|that)\b|\b(should|to|must) be the same\b|\bmatch (this|that|each other)\b/;
  for (const q of fin) {
    if (!COMPARE.test((q.words || []).join(' ').toLowerCase().replace(/[.,!?]/g, ''))) continue; // only when the words clearly compare
    const hit = pairs.find((pr) => Math.min(pr.end, (q.to || q.end) + 0.5) - Math.max(pr.t, (q.from || 0) - 0.5) >= 0.5 * (pr.end - pr.t));
    const seen = seenIn(q);
    q.compare = hit ? [hit.a, hit.b] : seen.length >= 2 ? seen.slice(0, 2) : null;
    // "this ... that": the first pointing word is the first thing, the second the other
    const dx = (q.said || []).filter((w) => /^(this|that)[.,!?]?$/i.test(w.w));
    if (q.compare && dx.length === 2) [dx[0].at, dx[1].at, dx[0].pos, dx[1].pos] = [q.compare[0], q.compare[1], null, null];
  }
  const mostlyIn = (a, b, q) => Math.min(b, (q.to || q.end) + 0.8) - Math.max(a, (q.from || 0) - 0.8) >= 0.5 * Math.max(0.2, b - a);
  // Words dragged over while it was said: quoted, and the spot.
  for (const q of fin) {
    const qt = quotes.filter((g) => mostlyIn(g.t, g.end, q) && !stops.some((st) => st.el && st.el !== g.el && st.t > g.end + 0.1 && st.t < (q.from || 0) + 0.8 && st.w >= 0.3 && st.w < 5));
    if (!qt.length) continue;
    q.quotes = qt.map((g) => g.text);
    if (qt[0].el) [q.el, q.why] = [qt[0].el, 'words selected'];
  }
  // "Move this there": rest on A, a quick straight dash, rest on B, and the words say so. Both needed.
  const dashes = [];
  for (let i = 0; i + 1 < stops.length; i++) {
    const [A, B] = [stops[i], stops[i + 1]];
    if (!A.el || !B.el || A.el === B.el || A.w < 0.4 || B.w < 0.4) continue;
    const path = moves.filter((m) => m.t >= A.end - 0.05 && m.t <= B.t + 0.05);
    if (path.length < 2) continue;
    let len = 0;
    for (let k = 1; k < path.length; k++) len += Math.hypot(path[k].x - path[k - 1].x, path[k].y - path[k - 1].y);
    const straight = Math.hypot(path[path.length - 1].x - path[0].x, path[path.length - 1].y - path[0].y), took = path[path.length - 1].t - path[0].t;
    if (straight > 120 && took < 0.8 && len / straight < 1.35) dashes.push({ t: A.t, end: B.end, a: A.el, b: B.el });
  }
  for (const q of fin) {
    const talk = (q.words || []).join(' ').toLowerCase();
    // a move word and a place in the same talk ("there are too many buttons" is no move); "swap" counts on its own
    if (!MOVE.test(talk) && !/\bswap\b/.test(talk)) continue;
    const d = dashes.find((x) => mostlyIn(x.t, x.end, q)), seen = seenIn(q);
    q.move = d ? [d.a, d.b] : seen.length >= 2 ? seen.slice(0, 2) : null;
    if (!q.move) continue;
    delete q.compare; // "swap these two" is a move, not a comparison
    // "move this there": the first pointing word is what moves, the last is where to
    const dm = (q.said || []).filter((w) => /^(this|that|there|here|it)[.,!?]?$/i.test(w.w));
    if (dm.length >= 2) [dm[0].at, dm[0].pos, dm[dm.length - 1].at, dm[dm.length - 1].pos] = [q.move[0], null, q.move[1], null];
  }
  // A sweep over a group: the words speak of many ("all these rows", "every button") and the pointer went over 3+
  // things side by side, each held a moment: the spot is the group that holds them.
  for (const q of fin) {
    const talk = (q.words || []).join(' ').toLowerCase();
    if (!MANY.test(talk) || !THING.test(talk)) continue;
    const seen = [];
    hovers.forEach((h, i) => {
      const dur = (hovers[i + 1] ? hovers[i + 1].t : now()) - h.t;
      if (h.el && dur >= 0.12 && h.t >= (q.from || 0) - 1.5 && h.t <= (q.to || q.end) + 0.3 && !seen.includes(h.el)) seen.push(h.el);
    });
    // siblings: the same parent, or their parents are siblings (cells in rows)
    const by = new Map();
    for (const e of seen) {
      for (const x of [e, e.parentElement, e.parentElement?.parentElement]) {
        if (!x?.parentElement) continue;
        const list = by.get(x.parentElement) || [];
        if (!list.includes(x)) list.push(x);
        by.set(x.parentElement, list);
      }
    }
    let group = null, n = 0;
    by.forEach((list, k) => list.length >= 3 && list.length > n && k !== document.body && ([n, group] = [list.length, k]));
    if (!group) continue;
    const huge = (x) => {
      const r = x.getBoundingClientRect();
      return r.width * r.height > 0.5 * innerWidth * innerHeight;
    };
    let g = group.closest('table, ul, ol, nav') || group;
    if (huge(g)) g = huge(group) ? null : group;
    if (g) [q.el, q.why] = [snap(g), `swept over ${n}`];
  }
  return fin;
}

// "sent ✓" on the bar's talk button for a moment, no line over the bar (Leo, 25 Nov); as wide as it was, so the bar
// doesn't move (the longer word takes some of the button's own padding). "retry" stays until a kept walk is sent.
function mark(word: string | null) {
  const b = W.root.querySelector('.walkie-btn') as HTMLElement | null;
  if (!b) return;
  clearTimeout(btnT);
  if (!word) {
    if (btnWas) b.replaceChildren(...btnWas);
    b.style.cssText = '';
    btnWas = null;
    return;
  }
  if (!btnWas) {
    btnWas = [...b.childNodes];
    b.style.cssText = `width:${b.getBoundingClientRect().width}px;padding:0;justify-content:center`;
  }
  b.replaceChildren(word);
}
function sent() {
  mark('sent ✓');
  btnT = window.setTimeout(() => mark(unsent.length ? 'retry' : null), 1800);
}

// The whole walk goes to the page's chat as one message: each part with its spot (words + selector), each spot as it
// was when it was pointed at.
async function post(pieces, live) {
  const where = (q) => (q ? ` at ${Math.round(q.x * 100)}% across, ${Math.round(q.y * 100)}% down` : '');
  const named = (el, t) => {
    const d = desc(el, t);
    return `"${d.label}" (${d.sel})`;
  };
  const text = `Walkie-talkie, ${pieces.length} ${pieces.length === 1 ? 'part' : 'parts'} (timing: ${live}% of words came live, ${live >= 70 ? 'within about half a second' : 'rough, the words came in whole sentences'}):\n` + pieces.map((p, i) => {
    const d = p.el && desc(p.el, p.to);
    let spot = d ? `On "${d.label}"${where(p.pos)} (${d.sel}, ${p.why})` : 'On the page';
    if (p.move) spot += `, move from ${named(p.move[0], p.to)} to ${named(p.move[1], p.to)}`;
    if (p.quotes) spot += `, quoting ${p.quotes.map((t) => `"${t}"`).join(' and ')}`;
    if (p.compare) spot += `, comparing ${named(p.compare[0], p.to)} and ${named(p.compare[1], p.to)}`;
    if (p.also?.length) spot += `, passing ${p.also.map((el) => named(el, p.to)).join(', ')}`;
    return `${i + 1}. ${spot} ${p.from.toFixed(1)}–${p.to.toFixed(1)}s: ${p.said.map((w) => {
      if (!w.at) return w.w;
      const a = desc(w.at, w.t);
      return `${w.w} [${a.label}${where(w.pos)} · ${a.sel}]`;
    }).join(' ')}`;
  }).join('\n');
  // its own nonce, kept with it: a retry after a lost answer can't save it twice
  const payload = { name: W.store.get('lab-name') || 'walkie-talkie', text, anchor: { kind: 'page', width: innerWidth, height: innerHeight, dpr: devicePixelRatio || 1 }, nonce: Math.random().toString(36).slice(2) + Date.now().toString(36) };
  if (await deliver(payload)) return;
  unsent.push(payload); // kept: the next press of tal(k) sends it again
  mark('retry');
}
async function deliver(payload) {
  try {
    const { comment } = await W.send(payload);
    W.addComment(comment, 1);
    W.render();
    sent();
    return true;
  } catch (err) {
    W.say?.(`${err.message || "couldn't reach the lab"} · retry sends the walk again`);
    return false;
  }
}
async function retry() {
  resending = true;
  while (unsent.length && (await deliver(unsent[0]))) unsent.shift();
  resending = false;
  if (unsent.length) mark('retry');
}
