// Reuse check: the widget keeps one of each thing (Leo, 18 Nov: "check if we're reusing our things and not creating
// new entities"). It fails when a change brings a second drawer, dimmed page, swipe, keyboard fit, animation or
// copied style instead of using the one that's there. Something genuinely new is listed in ci/parts.json, on purpose.
// Run: node ci/reuse.mjs (npm run reuse). No packages.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const W = path.join(ROOT, 'src/widget');
const parts = JSON.parse(fs.readFileSync(path.join(ROOT, 'ci/parts.json'), 'utf8'));
const read = (f) => fs.readFileSync(f, 'utf8');
const code = [path.join(ROOT, 'src/comments.js'), ...fs.readdirSync(W).filter((f) => /\.(ts|js)$/.test(f) && !f.endsWith('.d.ts')).map((f) => path.join(W, f))];
// Every stylesheet: styles.css, and the ones a part loaded later brings with it (<part>.css), checked as one.
const sheets = fs.readdirSync(W).filter((f) => f.endsWith('.css')).sort((a, b) => (a === 'styles.css' ? -1 : b === 'styles.css' ? 1 : a.localeCompare(b)))
  .map((f) => [f, read(path.join(W, f)).replace(/\/\*[\s\S]*?\*\//g, '')]);
const problems = [];
const say = (what, fix) => problems.push(`✗ ${what}\n  → ${fix}`);
const lineOf = (text, i) => text.slice(0, i).split('\n').length;
const rel = (f) => path.relative(ROOT, f);

// 1. Modules: a new file in src/widget is a new part. Say what it is in ci/parts.json.
for (const f of fs.readdirSync(W)) {
  if (!parts.modules[f]) say(`src/widget/${f} is a new module`, 'use the module that already does it, or add it to "modules" in ci/parts.json with what it is');
}

// 2. Animations: one set of motions. A new @keyframes is listed, or an existing one is used.
for (const [, css] of sheets) for (const m of css.matchAll(/@keyframes\s+([\w-]+)/g)) {
  if (!parts.animations.includes(m[1])) say(`@keyframes ${m[1]} is a new animation`, `use one of ${parts.animations.join(', ')}, or add it to "animations" in ci/parts.json`);
}

// 3. Overlays: one dimmed page, .scrim. A panel shows it (data-sheet on phones, data-labs for labs & pages) instead
//    of drawing its own.
for (const [f, css] of sheets) for (const m of css.matchAll(/([^{}]+)\{/g)) {
  for (const sel of m[1].split(',').map((s) => s.trim())) {
    if (/scrim|backdrop|overlay/i.test(sel.replace(/\.scrim\b/g, ''))) say(`"${sel}" (${f}:${lineOf(css, m.index)}) is a new dimmed page`, 'show the widget\'s own .scrim (see :host([data-sheet]) .scrim)');
  }
}

// 4. Gestures and the keyboard fit live in sheets.ts: a panel on a phone is one of the sheets (swipeDown), not its
//    own touch handling or visualViewport maths.
for (const f of code) {
  const t = read(f);
  const name = path.basename(f);
  for (const m of t.matchAll(/addEventListener\(\s*'touchmove'/g)) {
    if (!parts.gestures.includes(name)) say(`${rel(f)}:${lineOf(t, m.index)} drags with its own touchmove`, 'make the panel a sheet: swipeDown(node, close) from sheets.ts');
  }
  for (const m of t.matchAll(/visualViewport/g)) {
    if (!parts.keyboardFit.includes(name)) say(`${rel(f)}:${lineOf(t, m.index)} fits the keyboard itself (visualViewport)`, 'let the sheets do it: openSheet() returns the panel, and :host([data-kb]) sizes it');
  }
  // A dialog on a phone is a sheet: the file that makes one hands it to swipeDown (directly, or as deps.swipe).
  if (/role:\s*'dialog'/.test(t) && !/swipe(Down)?\(/.test(t)) say(`${rel(f)} makes a dialog that isn't a sheet`, 'pass its panel to swipeDown (sheets.ts) and return it from openSheet()');
}

// 5. Copied styles: the same long declaration (a shadow, a curve, a mask) in two rules is a copy of a look. Share
//    the rule (add the selector to it) instead.
const seen = new Map();
for (const [f, css] of sheets) for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  for (const d of block[2].matchAll(/([\w-]+)\s*:\s*([^;]+)/g)) {
    const val = d[2].trim().replace(/\s+/g, ' ');
    if (val.length < 40 || d[1].startsWith('--')) continue;
    const key = `${d[1]}: ${val}`;
    const at = `${f}:${lineOf(css, block.index)}`;
    if (seen.has(key) && seen.get(key) !== at) say(`"${key}" is in two rules (${seen.get(key)} and ${at})`, 'put both selectors on one rule');
    else seen.set(key, at);
  }
}

// 6. Tokens: a colour, corner, font size or motion comes from the design system (the :host tokens in styles.css, the
//    --lab-* ones in lab.css, docs/motion.md), not a value written into a rule (Leo, 19 Nov: the design census). Custom
//    properties are where tokens are made, so they're not checked; a value a part really needs is listed in
//    ci/parts.json "values" with why.
const allowed = (kind, v) => (parts.values[kind] || {})[v] !== undefined;
const COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)/gi;
const RADIUS = /^(0|50%|inherit|var\(--[\w-]+\)( var\(--[\w-]+\)| 0)*|max\(0px, calc\(var\(--[\w-]+\) - \d+px\)\))( !important)?$/;
const SIZES = /^((10|11|12|13|14|15|16|17|24)px|inherit)( !important)?$/;
const lab = ['lab.css', read(path.join(ROOT, 'src/lab.css')).replace(/\/\*[\s\S]*?\*\//g, '')];
for (const [f, css] of [...sheets, lab]) for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  for (const d of block[2].matchAll(/([\w-]+)\s*:\s*([^;]+)/g)) {
    const [p, v] = [d[1], d[2].trim().replace(/\s+/g, ' ')];
    if (p.startsWith('--')) continue;
    const at = `${f}:${lineOf(css, block.index)}`;
    // Black washes in shadows and masks are the same in both schemes; any other colour is a token.
    for (const c of v.match(COLOUR) || []) {
      const k = c.replace(/\s/g, '');
      if (!/^rgba\(0,0,0,[\d.]+\)$|^#000$/.test(k) && !allowed('colours', k)) say(`${at} writes the colour ${c} (${p})`, 'use a colour token (--_green, --_green-fg, --_red, --_amber, --_fg, --_muted, …), or list it in ci/parts.json "values"');
    }
    if (/radius$/.test(p) && !RADIUS.test(v) && !allowed('radii', v)) say(`${at} writes the corner ${v}`, 'use var(--_radius) / var(--_r-s) (lab: --lab-corner, --lab-corner-s), max(0px, calc(<token> - gap)) inside a box, or 50% for a circle');
    if (p === 'font-size' && !SIZES.test(v)) say(`${at} uses the font size ${v}`, 'use one of 10, 11, 12, 13, 14, 15, 16, 17 or 24 px');
    if (/^(transition|animation)/.test(p) && /\d(m?s)\b|cubic-bezier|\bease(-in|-out|-in-out)?\b/.test(v.replace(/var\([^()]*\)|calc\([^()]*(\([^()]*\)[^()]*)*\)/g, '')) && !allowed('motion', v)) {
      say(`${at} writes its own motion: ${p}: ${v}`, 'use the duration and curve tokens (--_t-quick/-base/-slow, --_ease, --_ease-out, …, --_fade); docs/motion.md');
    }
  }
}
// In scripts: a Web Animation or a timer takes ms('…') and ease('…'); a colour comes from a token.
for (const f of code) {
  const t = read(f);
  for (const m of t.matchAll(/cubic-bezier\(|duration:\s*\d|\b\d+ms\b(?=[^\n]*transition)|#[0-9a-fA-F]{3,8}\b(?=['`;) ])|\brgba?\([^)]*\)/g)) {
    const line = t.slice(0, m.index).split('\n').length, src = t.split('\n')[line - 1];
    if (/^\s*(\/\/|\*)/.test(src) || (parts.values.code || {})[`${path.basename(f)}: ${m[0]}`] !== undefined) continue;
    say(`${rel(f)}:${line} writes ${m[0]} itself`, "use ms('…') / ease('…') (anchoring.ts) or read the token: getComputedStyle(host).getPropertyValue('--_green'), or list it in ci/parts.json \"values\".code");
  }
}

if (problems.length) {
  console.error(`Reuse check: ${problems.length} new part${problems.length === 1 ? '' : 's'} where an existing one would do.\n\n${problems.join('\n\n')}\n`);
  process.exit(1);
}
console.log('Reuse check: one drawer, one dimmed page, shared gestures, keyboard fit, animations and styles; colours, corners, sizes and motion from tokens.');
