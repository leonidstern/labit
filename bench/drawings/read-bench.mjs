// What drawings read as (src/widget/draw.ts readInk), over many hand-like variants of each mark: angles, sizes, a shaky
// hand, an arrowhead drawn in the same stroke or as its own. Prints, per mark, how often it read as meant, and what else
// it read as. No lab, no agent: the reading part alone, in Chromium, on a page with a line of words (underline vs strike).
//   node bench/drawings/read-bench.mjs [repo root to read draw.ts from, default this one]
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('playwright-core'); }
const code = execFileSync('npx', ['--yes', 'esbuild@0.25.12', join(ROOT, 'src/widget/draw.ts'), '--bundle', '--format=iife', '--global-name=Draw'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

// A seeded random, so every run draws the same hands.
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const shake = (s, amt) => s.map(([x, y]) => [x + (rnd() - 0.5) * amt, y + (rnd() - 0.5) * amt]);
// Points along a polyline every ~4 px, as pointer events come in.
const walk = (pts) => {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
};
const rot = (s, cx, cy, ang) => s.map(([x, y]) => [cx + (x - cx) * Math.cos(ang) - (y - cy) * Math.sin(ang), cy + (x - cx) * Math.sin(ang) + (y - cy) * Math.cos(ang)]);
const ANG = [0, 0.5, 1.2, Math.PI / 2, 2.5, Math.PI, -0.7];
const LEN = [90, 260, 700];
const C = [600, 500]; // the middle of the space the marks are drawn in, away from the words
const head = (tip, ang, leg = 16) => [[tip[0] - leg * Math.cos(ang - 0.5), tip[1] - leg * Math.sin(ang - 0.5)], tip, [tip[0] - leg * Math.cos(ang + 0.5), tip[1] - leg * Math.sin(ang + 0.5)]];
// Leo's one-stroke arrow (23 Nov, as it landed): out to the tip, a long stroke back for the head, a small curl at its end.
const LEO_ARROW = [[0, 75], [16, 81], [44, 79], [87, 73], [178, 54], [273, 40], [356, 34], [419, 38], [416, 34], [382, 32], [337, 22], [282, 6], [245, 0], [214, 1], [196, 8], [197, 11], [207, 14]];
const cases = [];
const add = (mark, want, strokes) => cases.push({ mark, want, strokes: strokes.map((s) => s.map(([x, y]) => ({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }))) });
for (const a of ANG) for (const L of LEN) for (const k of [1.5, 4]) {
  const from = [C[0] - (L / 2) * Math.cos(a), C[1] - (L / 2) * Math.sin(a)];
  const tip = [C[0] + (L / 2) * Math.cos(a), C[1] + (L / 2) * Math.sin(a)];
  const h = head(tip, a);
  // arrow, head in the same stroke: up to the tip, back along one leg, across to the other leg's end
  add(`arrow, head in one stroke`, /^arrow/, [shake(walk([from, tip, h[0], tip, h[2]]), k)]);
  add('arrow, head as its own stroke', /^arrow/, [shake(walk([from, tip]), k), shake(walk(h), k)]);
  // a line with no head, and one whose end curls in a small hook (a hand's, not a head)
  const flat = Math.abs(Math.sin(a)) < 0.1, up = Math.abs(Math.cos(a)) < 0.1;
  const plain = flat ? /^underlined/ : up ? /^side line/ : /^line/;
  add('line, no head', plain, [shake(walk([from, tip]), k)]);
  for (const hook of [6, 10]) add(`line, ${hook} px hook at its end`, plain, [shake(walk([from, tip, [tip[0] - hook * Math.cos(a - 1.2), tip[1] - hook * Math.sin(a - 1.2)]]), k)]);
  add('line there and back', plain, [shake(walk([from, tip, from]), k)]);
}
for (const [w, hh] of [[60, 30], [200, 60], [500, 200]]) for (const k of [1.5, 4]) for (const over of [0.8, 1, 1.15]) {
  add('circle', /^circled/, [shake(Array.from({ length: 60 }, (_, i) => { const t = (i / 59) * over * 2 * Math.PI; return [C[0] + (w / 2) * Math.cos(t), C[1] + (hh / 2) * Math.sin(t)]; }), k)]);
  add('box', /^box drawn/, [shake(walk([[C[0] - w / 2, C[1] - hh / 2], [C[0] + w / 2, C[1] - hh / 2], [C[0] + w / 2, C[1] + hh / 2], [C[0] - w / 2, C[1] + hh / 2], [C[0] - w / 2, C[1] - hh / 2 + 4]]), k)]);
  add('scribble', /^scribbled/, [shake(walk(Array.from({ length: 12 }, (_, i) => [i % 2 ? C[0] + w / 2 : C[0] - w / 2, C[1] - hh / 2 + (hh * i) / 11])), k)]);
  // An arrow in one stroke whose head is one long stroke back with a small curl at its end (Leo's, 23 Nov: read as scribbled over).
  if (w >= 200) add('arrow, long head stroke with a curl', /^arrow/, [shake(walk(LEO_ARROW.map(([x, y]) => [C[0] - w + (x * w) / 210, C[1] - 40 + (y * w) / 210])), k)]);
  // Flat: back and forth over a wide, low note (the drawing bench's scribble-note read as an arrow, 23 Nov).
  if (w >= 200) add('flat zigzag over a wide line', /^scribbled/, [shake(walk(Array.from({ length: 14 }, (_, i) => [i % 2 ? C[0] + w * 0.8 : C[0] - w * 0.8, C[1] + (40 * i) / 13])), k)]);
  add('X', /^X drawn/, [shake(walk([[C[0] - w / 2, C[1] - hh / 2], [C[0] + w / 2, C[1] + hh / 2]]), k), shake(walk([[C[0] + w / 2, C[1] - hh / 2], [C[0] - w / 2, C[1] + hh / 2]]), k)]);
  add('wavy underline', /^wavy underline/, [shake(Array.from({ length: Math.ceil(w / 3) + 1 }, (_, i) => [C[0] - w / 2 + i * 3, C[1] + 4 * Math.sin(i)]), Math.min(k, 2))]);
  // A long gentle wave (25 px up and down over 400 px or more) is not a scribble: whatever it reads as, never as "remove this".
  if (w >= 200) add('long gentle wave (not remove)', /^(?!scribbled|crossed|X )/, [shake(Array.from({ length: 120 }, (_, i) => [C[0] - w + (i * 2 * w) / 119, C[1] + 25 * Math.sin((i / 119) * 4 * Math.PI)]), k)]);
  add('caret', /^caret/, [shake(walk([[C[0] - 10, C[1] + 18], [C[0], C[1] - 2], [C[0] + 10, C[1] + 18]]), 1)]);
}
const browser = await pw.chromium.launch();
try {
  const p = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await p.setContent('<!doctype html><body style="margin:0;font:16px sans-serif"><p style="position:absolute;left:40px;top:40px;margin:0">Some words to underline or strike</p></body>');
  await p.addScriptTag({ content: code });
  const got = await p.evaluate((cs) => cs.map((c) => window.Draw.readInk(c.strokes, () => undefined).mark), cases);
  const rows = new Map();
  cases.forEach((c, i) => {
    const r = rows.get(c.mark) || { n: 0, ok: 0, other: new Map() };
    r.n++;
    if (c.want.test(got[i])) r.ok++;
    else { const k = got[i].replace(/\s*\(.*$/, ''); r.other.set(k, (r.other.get(k) || 0) + 1); }
    rows.set(c.mark, r);
  });
  let [n, ok] = [0, 0];
  for (const [m, r] of rows) {
    n += r.n; ok += r.ok;
    console.log(`${m.padEnd(34)} ${String(r.ok).padStart(3)}/${String(r.n).padEnd(3)} ${r.other.size ? `misread as: ${[...r.other].map(([k, v]) => `${k} ×${v}`).join(', ')}` : ''}`);
  }
  console.log(`${'all'.padEnd(34)} ${ok}/${n} (${Math.round((ok / n) * 100)}%)`);
} finally {
  await browser.close();
}
