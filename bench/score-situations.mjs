// Scores an agent's answer to bench/situations-task.md (or situations-2-task.md) against the truth written by situations.mjs.
// Run: node bench/score-situations.mjs bench/results/situations-answer-<name>.json
//      node bench/score-situations.mjs bench/results/situations-2-answer-<name>.json     (batch 2)
// The batch is the one whose comments the answer holds; --batch 2 says it outright.
// An agent answering the task must not read this file.
import fs from 'node:fs';
import path from 'node:path';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const flag = args.indexOf('--batch');
const batch = flag >= 0 ? args.splice(flag, 2)[1] : null;
if (!args[0]) { console.error('usage: node bench/score-situations.mjs <answer.json> [--batch 2]'); process.exit(2); }
const raw = JSON.parse(fs.readFileSync(args[0], 'utf8'));
const answers = Array.isArray(raw) ? raw : raw.answers || Object.entries(raw).map(([comment, a]) => ({ comment, ...a }));

const key = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
// Which truth: the named batch, or the one with the most comments in common with the answer.
const truthFile = (n) => (String(n) === '1' ? 'situations-truth.json' : `situations-${n}-truth.json`);
const truths = (batch ? [truthFile(batch)] : fs.readdirSync(HERE).filter((f) => /^situations(-\d+)?-truth\.json$/.test(f)).sort())
  .map((f) => ({ f, situations: JSON.parse(fs.readFileSync(path.join(HERE, f), 'utf8')).situations }))
  .map((t) => ({ ...t, hits: t.situations.filter((x) => answers.some((a) => key(a.comment) === key(x.comment))).length }));
const picked = truths.sort((a, b) => b.hits - a.hits)[0];
const { situations } = picked;
console.log(`truth: bench/${picked.f} (${picked.hits} of its ${situations.length} comments are in the answer)\n`);
const file = (f) => String(f || '').replace(/\\/g, '/').replace(/^https?:\/\/[^/]+\/sit\//, '').replace(/^.*bench\/situations\//, '').replace(/^\.?\/+/, '');
const tokens = (s) => String(s || '').toLowerCase().replace(/[’‘]/g, "'").split(/\s+/).map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const overlap = (a, b) => {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (!(w > 0 && h > 0)) return 0;
  const area = (r) => (r[2] - r[0]) * (r[3] - r[1]);
  return (w * h) / (area(a) + area(b) - w * h);
};

// One situation: which parts of the answer are right. A situation passes when all its parts are.
function score(t, a) {
  const e = t.expect;
  const parts = [];
  const part = (name, ok, got, want) => parts.push({ name, ok: Boolean(ok), got, want });
  const f = file(a.file);
  part('file', e.files ? f in e.files : f === e.file, f || '—', e.files ? Object.keys(e.files).join(' | ') : e.file);
  if (e.lines) part('line', num(a.line) >= Math.min(...e.lines) && num(a.line) <= Math.max(...e.lines), a.line ?? '—', [...new Set(e.lines)].join('–'));
  if (e.words) {
    // The words under the pin or inside the area: nearly all of them, and not much around them
    // (so naming the whole paragraph for a comment on three words does not count).
    const want = tokens(e.words), got = tokens(a.words), left = [...got];
    const found = want.filter((w) => { const i = left.indexOf(w); if (i < 0) return false; left.splice(i, 1); return true; }).length;
    part('words', found / want.length >= 0.8 && got.length <= Math.max(want.length + 4, Math.round(want.length * 1.5)), `${got.length} words, ${found}/${want.length} of the right ones`, `${want.length} words`);
  }
  // Text without spaces between words (Japanese): the answer has to hold the word and little around it.
  if (e.phrase) part('words', String(a.words || '').includes(e.phrase) && [...String(a.words || '').trim()].length <= [...e.phrase].length + 6, a.words ? `"${a.words}"` : '—', `"${e.phrase}" and at most 6 more characters`);
  if (e.box) {
    // Pixels are in the answered file's own size; the box is in e.size pixels (a srcset variant is the same picture, scaled).
    const size = e.files ? e.files[f] : e.size;
    const k = size ? e.size[0] / size[0] : NaN;
    const [x, y] = [num(a.x) * k, num(a.y) * k];
    part('spot', x >= e.box[0] && x <= e.box[2] && y >= e.box[1] && y <= e.box[3], `${a.x ?? '—'},${a.y ?? '—'}`, `inside ${e.box.map((v) => Math.round(v / k) || v).join(',')}`);
  }
  if (e.area) part('area', overlap([a.x, a.y, a.x2, a.y2].map(num), e.area) >= 0.5, [a.x, a.y, a.x2, a.y2].map((v) => v ?? '—').join(','), `overlaps ${e.area.join(',')} by half or more`);
  if (e.from !== undefined) part('time', num(a.seconds) >= e.from && num(a.seconds) < e.to, a.seconds ?? '—', `${e.from}–${e.to} s`);
  if (e.color_scheme) part('colour scheme', key(a.color_scheme) === e.color_scheme, a.color_scheme ?? '—', e.color_scheme);
  return parts;
}

const rows = situations.map((t) => {
  const a = answers.find((x) => key(x.comment) === key(t.comment));
  const parts = score(t, a || {});
  return { t, answered: Boolean(a), parts, pass: parts.every((p) => p.ok) };
});

const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad('situation', 30)} ${pad('group', 7)} ${pad('result', 6)} parts`);
for (const r of rows) {
  const parts = r.answered ? r.parts.map((p) => (p.ok ? `${p.name} ok` : `${p.name} MISS (${p.got}; want ${p.want})`)).join(', ') : 'no answer for this comment';
  console.log(`${pad(r.t.id, 30)} ${pad(r.t.group, 7)} ${pad(r.pass ? 'pass' : 'MISS', 6)} ${parts}${r.t.expected_gap ? '  [expected gap]' : ''}`);
}
const sum = (list) => ({
  pass: list.filter((r) => r.pass).length, of: list.length,
  points: list.reduce((n, r) => n + r.parts.filter((p) => p.ok).length, 0), max: list.reduce((n, r) => n + r.parts.length, 0),
});
console.log(`\n${pad('group', 8)} ${pad('passed', 8)} ${pad('parts right', 12)} without expected gaps`);
for (const g of [...new Set(rows.map((r) => r.t.group))]) {
  const all = sum(rows.filter((r) => r.t.group === g)), clean = sum(rows.filter((r) => r.t.group === g && !r.t.expected_gap));
  console.log(`${pad(g, 8)} ${pad(`${all.pass}/${all.of}`, 8)} ${pad(`${all.points}/${all.max}`, 12)} ${clean.pass}/${clean.of}`);
}
const all = sum(rows), clean = sum(rows.filter((r) => !r.t.expected_gap)), gaps = sum(rows.filter((r) => r.t.expected_gap));
console.log(`\ntotal: ${all.pass}/${all.of} situations, ${all.points}/${all.max} parts`);
console.log(`without the ${gaps.of} expected gaps: ${clean.pass}/${clean.of} situations · expected gaps solved anyway: ${gaps.pass}/${gaps.of}`);
const extra = answers.filter((x) => !situations.some((t) => key(t.comment) === key(x.comment)));
if (extra.length) console.log(`${extra.length} answer(s) match no comment: ${extra.map((x) => JSON.stringify(x.comment)).join(', ')}`);
