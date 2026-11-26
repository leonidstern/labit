// A torture suite for how a pin finds its spot again (src/widget/anchoring.ts), in Safari's engine (WebKit) and Chrome's:
// how often a pin is found right, lands silently on the WRONG element, or is lost (flagged as moved), after ONE change to
// the page. Its numbers are what a redesign of the anchoring is judged by.
//
// What it does, per engine:
// 1. Pages are generated from a seed in five flavours (plain classes, ids on sections, no classes at all, made-up
//    classes like css-1x2y3z, and look-alike content), each with eleven things to pin: a paragraph, a word (Shift +
//    double-click), a few words (Shift + drag), an area (a drag), a list item, a table cell, a card in a grid, a heading,
//    a picture, a button, and a button whose words every card repeats (the last two by Option-click).
// 2. Each pin is put on its page through the real widget in a real lab (a click, a drag, typed words, Enter), and the
//    anchor the lab saved is read back: 11 pins a page, 110 an engine.
// 3. Each mutation (a pure function on the page's HTML text, MUTATIONS below) is applied to the page. The result is
//    written to a page of the lab that carries that same saved pin (put there through the comments API), and the page
//    is opened: what a reload after the edit shows. A sample is also run the other way the lab changes a page: open on
//    the old file, the file rewritten, patched in place.
// 4. Where the widget draws the pin is read from the widget's own DOM (its tip, or "moved · N" when it took the pin off
//    the page) and compared with where the pin belongs: the same logical element or word, which the generator tracks
//    through the mutation. Nothing in the page marks it: the page a browser gets is the plain HTML.
// 5. anchoring.ts on its own runs beside the widget in every page and is asked the same question: it must put the pin
//    where the widget drew it (a check of this test's reading), and it says what the widget would tell the lab about
//    the pin ("its words changed", which the agent reads on its next wait; a person sees nothing of it).
// 6. ROOTS: twelve very small pages, one cause of failure each, run on anchoring.ts alone.
//
// Outcomes: R right (drawn on its element or word), W wrong (drawn, not flagged, on something else: the worst), L lost
// (flagged: off the page, counted as "moved · N"). A deleted element must give L; anything else must give R. Either is
// fair where the page cannot say: the pinned words deleted from a paragraph that stays, or every word of the element
// rewritten (which reads exactly like a new element in its place).
//
// Cells that fail today are listed in KNOWN at the end of this file, so CI stays green while the numbers are tracked:
// a cell that fails and is not listed, or fails worse than listed (W where L is listed), fails the run. Nothing is
// skipped or loosened: a listed cell is still run, measured, counted in the matrix and printed as `known`. The list is
// for seeds 1 and 2; with other seeds the matrix is printed and only the test's own checks can fail.
//
// Not part of `npm test`. Run: node test/browser/anchoring-torture.mjs   (needs playwright; NODE_PATH can point at one).
// About 2 min for both engines on the Mac (9,668 cases), 6 tabs at most.
//   ENGINES=webkit,chromium   the engines (both by default, side by side)
//   TORTURE_SEEDS=1,2         the seeds of the generated pages
//   TORTURE_JOBS=6            browser tabs at once, over all engines (6 at most)
//   TORTURE_HOT=16            every Nth case is also run as a live patch (0: none)
//   TORTURE_OUT=<folder>      writes anchor-torture.md (the matrix) and anchor-torture.json (every case) there
//   TORTURE_CASE='sib-before|li|plain|1'   one case: its anchor and reading are printed, and with TORTURE_OUT its page
//                             before and after the change is written there (case-before.html, case-after.html)
//   TORTURE_KNOWN=print       prints the KNOWN list this run would need
//   TORTURE_STRICT=1          a listed cell that passes now fails the run (the list has to be trimmed)
//   TEST_PART=2/3             one part of the cases, split by kind of pin (CI runs the parts side by side)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });
const KNOWN = knownToday(); // the cells that fail today, at the end of this file

// ---------- seeded choices ----------
const hash = (s) => {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};
const rng = (seed) => {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const pick = (r, a) => a[Math.floor(r() * a.length)];
const shuffled = (r, a) => {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

// ---------- a small HTML model ----------
// The generated pages are plain, well-formed HTML (every tag closed, attributes in double quotes, no entities), so a
// few lines parse and write them. A mutation takes HTML text and gives HTML text; inside it works on this tree.
const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link']);
const T = (text) => ({ text });
const isEl = (n) => Boolean(n && n.tag);
/** h('p', { class: 'x' }, 'words', h('b', {}, 'bold')) */
const h = (tag, attrs = {}, ...kids) => ({ tag, attrs: Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined && v !== null)), kids: kids.flat().filter((k) => k !== null && k !== undefined && k !== false).map((k) => (typeof k === 'string' ? T(k) : k)) });
/** The same, its children each on a line of their own (the whitespace a hand-written or generated page has). */
const block = (tag, attrs, ...kids) => {
  const list = kids.flat().filter(Boolean);
  return h(tag, attrs, '\n', ...list.flatMap((k) => [k, '\n']));
};
const write = (n) => {
  if (!isEl(n)) return n.text;
  const attrs = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${v}"`).join('');
  return VOID.has(n.tag) ? `<${n.tag}${attrs}>` : `<${n.tag}${attrs}>${n.kids.map(write).join('')}</${n.tag}>`;
};
function parse(html) {
  const m = /^([\s\S]*?<body>)([\s\S]*)(<\/body>[\s\S]*)$/.exec(html);
  if (!m) throw new Error('a page without <body>');
  const body = { tag: 'body', attrs: {}, kids: [] };
  const stack = [body];
  const re = /<(\/?)([a-z][a-z0-9]*)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*>|([^<]+)/g;
  for (let t = re.exec(m[2]); t; t = re.exec(m[2])) {
    const top = stack[stack.length - 1];
    if (t[4] !== undefined) top.kids.push(T(t[4]));
    else if (t[1]) {
      if (top.tag !== t[2]) throw new Error(`</${t[2]}> closes <${top.tag}>`);
      stack.pop();
    } else {
      const node = { tag: t[2], attrs: {}, kids: [] };
      for (const a of t[3].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) node.attrs[a[1]] = a[2] ?? '';
      top.kids.push(node);
      if (!VOID.has(node.tag)) stack.push(node);
    }
  }
  if (stack.length !== 1) throw new Error(`<${stack[stack.length - 1].tag}> is not closed`);
  return { pre: m[1], body, post: m[3] };
}
const unparse = (d) => d.pre + d.body.kids.map(write).join('') + d.post;
const walk = (n, fn, parent = null) => {
  fn(n, parent);
  if (isEl(n)) for (const k of [...n.kids]) walk(k, fn, n);
};
const all = (n, test) => {
  const out = [];
  walk(n, (x) => isEl(x) && x !== n && test(x) && out.push(x));
  return out;
};
const textOf = (n) => (isEl(n) ? n.kids.map(textOf).join('') : n.text);
const els = (n) => n.kids.filter(isEl);
const parentOf = (root, node) => {
  let found = null;
  walk(root, (x, p) => x === node && (found = p));
  return found;
};
const up = (root, node, test) => {
  for (let p = parentOf(root, node); p; p = parentOf(root, p)) if (test(p)) return p;
  return null;
};
// A copy with nothing in it that says which element or words the pin is on.
const OPEN = '⟦';
const CLOSE = '⟧';
const plain = (s) => s.replaceAll(OPEN, '').replaceAll(CLOSE, '');
const clone = (n) => (isEl(n) ? { tag: n.tag, attrs: Object.fromEntries(Object.entries(n.attrs).filter(([k]) => k !== 'data-t')), kids: n.kids.map(clone) } : T(plain(n.text)));
// Children in and out, with the line break that follows each one.
const putAt = (parent, at, node) => {
  const i = at ? parent.kids.indexOf(at) : parent.kids.length;
  parent.kids.splice(i < 0 ? parent.kids.length : i, 0, node, T('\n'));
};
const putAfter = (parent, at, node) => parent.kids.splice(parent.kids.indexOf(at) + 1, 0, T('\n'), node);
const take = (parent, node) => {
  const i = parent.kids.indexOf(node);
  if (i < 0) return;
  parent.kids.splice(i, 1);
  if (parent.kids[i] && !isEl(parent.kids[i]) && !parent.kids[i].text.trim()) parent.kids.splice(i, 1);
};
// The element children put in a new order, the text between them left where it was.
const reorder = (parent, order) => {
  let i = 0;
  parent.kids = parent.kids.map((k) => (isEl(k) ? order[i++] : k));
};

// ---------- the pages ----------
const WORDS = ('amber anchor april arrow atlas autumn basket beacon berry birch blanket bridge bronze butter cabin candle canvas canyon carbon castle cedar chapter cherry cinder circle citrus clover cobalt comet copper coral cotton course crater cricket crystal dagger daisy delta desert dolphin dragon drift eagle ember engine fabric falcon feather fender fiddle flint forest fossil garden ginger glacier granite gravel hammer harvest hazel helmet hollow honey island ivory jacket jasper jungle kettle ladder lagoon lantern lemon linen magnet maple marble meadow mirror monsoon mortar muffin needle nickel north nutmeg ocean olive onyx orbit otter paddle panther pepper pillow planet pocket prairie pumice quartz rabbit radar raven ribbon river rocket saddle saffron salmon shadow signal silver sparrow spruce summit sunset thimble thunder timber tunnel velvet violet walnut willow winter zephyr').split(' ');
// Words only a pin's quote is made of: no other text on a plain page says them.
const RARE = 'harlequin juniper kestrel lodestar mandolin nightjar obsidian pinwheel quicksilver rosewood sandpiper tamarind'.split(' ');
const KINDS = ['para', 'word', 'quote', 'area', 'li', 'cell', 'card', 'heading', 'img', 'button', 'cardbtn'];
const FLAVOURS = ['plain', 'ids', 'bare', 'hashed', 'twins'];
const PICTURES = ['harbor', 'orchard', 'glasshouse', 'quarry', 'viaduct', 'boathouse'];
const madeUp = (name, salt = '') => {
  const n = hash(name + salt);
  const s = n.toString(36).padStart(6, 'k');
  return `css-${n % 10}${'abcdefghjkmnpqrstuvwxyz'[n % 23]}${s.slice(0, 4)}`;
};
const fileHash = (name, salt = '') => {
  const s = (hash(`f${name}${salt}`).toString(36) + hash(`g${name}${salt}`).toString(36)).padEnd(8, 'q');
  return `B${s.slice(0, 6)}Z`;
};
const STYLE = (cls) => `
body{margin:0;font:16px/1.5 system-ui,sans-serif;color:#222;background:#fff}
header,main,footer{max-width:880px;margin:0 auto;padding:0 24px;box-sizing:border-box}
section{margin:28px 0}
h1{font-size:30px}h2{font-size:22px;margin:0 0 12px}h3{font-size:17px;margin:0 0 6px}
p{margin:0 0 12px}ul{margin:0 0 12px;padding-left:22px}li{margin:4px 0}
${cls.grid}{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px}
${cls.card}{border:1px solid #bbb;border-radius:8px;padding:16px}
${cls.shots}{display:flex;flex-wrap:wrap;gap:16px}
figure{margin:0;width:220px}figure img{display:block;width:100%;height:auto}figcaption{font-size:13px;color:#555}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:8px 12px;text-align:left}
${cls.toolbar}{display:flex;flex-wrap:wrap;gap:8px}
button,a${cls.btnOnly}{font:inherit;padding:8px 14px;border:1px solid #888;border-radius:6px;background:#f4f4f4;color:#222;text-decoration:none;display:inline-block}
.banner{padding:36px 24px;background:#eef;margin:0 0 8px}
`;

/** One page: the eleven things to pin are marked (data-t="kind …" on the element, ⟦k:words⟧ around words); a case keeps
 *  one of them (only) and finalize() takes every mark out before a browser sees the page. */
function basePage(flavour, seed) {
  const r = rng(`page ${flavour} ${seed}`);
  const twins = flavour === 'twins';
  const role = (name) => (flavour === 'bare' ? undefined : flavour === 'hashed' ? madeUp(name) : name);
  const css = (name, bare) => (flavour === 'bare' ? bare : `.${role(name)}`);
  const cls = { grid: css('grid', 'div:has(> * > h3)'), card: css('card', 'div:has(> h3),article:has(> h3)'), shots: css('shots', 'div:has(> figure)'), toolbar: css('toolbar', 'div:has(> button),div:has(> a)'), btnOnly: flavour === 'bare' ? ':not([href^="h"])' : `.${role('btn')}` };
  const id = (name) => (flavour === 'ids' ? name : undefined);
  const pool = shuffled(r, WORDS);
  let at = 0;
  const word = () => pool[at++ % pool.length];
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  const sentence = (n) => `${cap(Array.from({ length: n }, word).join(' '))}.`;
  const title = (n = 2) => cap(Array.from({ length: n }, word).join(' '));
  const mark = (node, kinds) => ((node.attrs['data-t'] = kinds), node);

  // About: paragraphs, one of them pinned.
  const paras = Array.from({ length: int(r, 3, 4) }, () => h('p', {}, `${sentence(int(r, 9, 13))} ${sentence(int(r, 7, 11))}`));
  const para = paras[int(r, 1, paras.length - 1)];
  mark(para, 'para');

  // Features: a list, one item pinned (never the first: there is one before it to remove).
  const items = Array.from({ length: int(r, 5, 7) }, () => h('li', { class: role('feature') }, title(int(r, 2, 4))));
  const li = items[int(r, 2, items.length - 2)];
  mark(li, 'li');
  if (twins) items[items.indexOf(li) < 3 ? items.length - 1 : 0].kids = [T(textOf(li))]; // the same words, not next to it

  // Pricing: cards in a grid; one pinned (and an area drawn on it), the button of another pinned.
  const cardCount = int(r, 3, 4);
  const cards = Array.from({ length: cardCount }, (_, i) =>
    block('div', { class: role('card') },
      h('h3', {}, title(1 + (i % 2))),
      h('p', { class: role('price') }, `Price $${10 * (i + 1)}`),
      h('p', {}, sentence(int(r, 5, 8))),
      h('button', { class: role('btn') }, 'Choose plan')));
  const card = cards[int(r, 1, cardCount - 1)];
  mark(card, 'card area');
  const btnCard = cards[int(r, 1, cardCount - 1)];
  mark(els(btnCard)[3], 'cardbtn');
  if (twins) {
    // "Price $10" twice: another card says the same but for its title.
    const other = cards[cards.indexOf(card) === 1 ? cardCount - 1 : 1];
    for (const i of [1, 2]) els(other)[i].kids = [T(textOf(els(card)[i]))];
  }

  // Compare plans: a table, one cell pinned.
  const cols = 4;
  const rows = int(r, 4, 5);
  const units = ['GB', 'seats', 'projects', 'hours', 'pages', 'builds'];
  let n = int(r, 2, 9);
  const value = () => (twins ? pick(r, ['Yes', 'No']) : `${(n += int(r, 1, 7))} ${pick(r, units)}`);
  const trs = Array.from({ length: rows }, () => h('tr', {}, h('td', {}, title(2)), ...Array.from({ length: cols - 1 }, () => h('td', {}, value()))));
  const cell = els(trs[int(r, 1, rows - 2)])[int(r, 1, cols - 1)];
  mark(cell, 'cell');
  const table = block('table', { class: role('plans') }, block('thead', {}, h('tr', {}, ...Array.from({ length: cols }, () => h('th', {}, title(1))))), block('tbody', {}, ...trs));

  // Gallery: pictures with captions, one picture pinned.
  const names = shuffled(r, PICTURES).slice(0, 3);
  if (twins) names[2] = names[0]; // the same file twice
  const src = (name) => (flavour === 'hashed' ? `${name}.${fileHash(name)}.svg` : `${name}.svg`);
  const alts = names.map(() => title(3));
  if (twins) alts[2] = alts[0];
  const figures = names.map((name, i) => block('figure', { class: role('shot') }, h('img', { src: src(name), alt: alts[i], width: '220', height: '140' }), h('figcaption', {}, sentence(4))));
  mark(els(figures[twins ? pick(r, [0, 2]) : int(r, 0, 2)])[0], 'img');

  // Team notes: words pinned. One word (it stands once on a plain page, three times and in two paragraphs on a
  // look-alike one), and a few words in a row.
  const [w, q1, q2, q3] = shuffled(r, RARE);
  const say = (n) => Array.from({ length: n }, word).join(' ');
  const wordText = twins
    ? `${cap(say(3))} ${w} ${say(4)} ${OPEN}w:${w}${CLOSE} ${say(5)}. ${cap(say(3))} ${w} ${say(4)}.`
    : `${cap(say(int(r, 5, 9)))} ${OPEN}w:${w}${CLOSE} ${say(int(r, 4, 8))}. ${sentence(int(r, 6, 9))}`;
  const quoteText = `${sentence(int(r, 6, 9))} ${cap(say(int(r, 3, 6)))} ${OPEN}q:${q1} ${q2} ${q3}${CLOSE} ${say(int(r, 4, 7))}.`;
  const notes = [mark(h('p', {}, quoteText), 'quote'), mark(h('p', {}, wordText), 'word'), h('p', {}, twins ? `${cap(say(4))} ${w} ${say(2)} ${q1} ${q2} ${q3} ${say(3)}.` : sentence(int(r, 8, 12)))];
  if (twins) notes.push(h('p', {}, plain(textOf(para)))); // the pinned paragraph's words again, in other company

  // Actions: buttons in a row, one pinned.
  const labels = shuffled(r, ['Save draft', 'Publish', 'Discard', 'Preview', 'Share']).slice(0, 3);
  const buttons = labels.map((l) => h('button', { class: role('btn') }, l));
  mark(buttons[1], 'button');

  // Headings: one pinned. On a look-alike page two sections share their heading.
  const heads = { about: 'About the project', features: 'Features', pricing: 'Pricing', compare: 'Compare plans', gallery: twins ? 'Details' : 'Gallery', notes: twins ? 'Details' : 'Team notes', actions: 'Actions' };
  const h2 = Object.fromEntries(Object.entries(heads).map(([k, v]) => [k, h('h2', {}, v)]));
  mark(h2[twins ? 'notes' : 'pricing'], 'heading');
  const section = (name, ...kids) => block('section', { id: id(name), class: role('block') }, h2[name], ...kids);

  const body = [
    block('header', {}, h('h1', {}, `${title(2)} studio`), h('p', { class: role('lead') }, sentence(10))),
    block('main', {},
      section('about', ...paras),
      section('features', block('ul', { class: role('features') }, ...items)),
      section('pricing', block('div', { class: role('grid') }, ...cards), twins && block('div', { class: role('toolbar') }, h('button', { class: role('btn') }, labels[1]), h('button', { class: role('btn') }, 'Compare'))),
      section('compare', table),
      section('gallery', block('div', { class: role('shots') }, ...figures)),
      section('notes', ...notes),
      section('actions', block('div', { class: role('toolbar') }, ...buttons))),
    block('footer', {}, h('p', {}, sentence(8))),
  ];
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>torture ${flavour} ${seed}</title>\n<style>${STYLE(cls)}</style>\n</head>\n<body>\n${body.map(write).join('\n')}\n</body>\n</html>\n`;
}

/** A page with one pin's marks only: its element is data-t (no value), its words ⟦…⟧. */
function only(html, kind) {
  const d = parse(html);
  const letter = { word: 'w', quote: 'q' }[kind];
  walk(d.body, (n) => {
    if (!isEl(n)) n.text = n.text.replace(new RegExp(`${OPEN}([wq]):([^${CLOSE}]*)${CLOSE}`, 'g'), (_, k, words) => (k === letter ? OPEN + words + CLOSE : words));
    else if ('data-t' in n.attrs) {
      if (n.attrs['data-t'].split(' ').includes(kind)) n.attrs['data-t'] = '';
      else delete n.attrs['data-t'];
    }
  });
  return unparse(d);
}

/** The page as a browser gets it (no marks), and where the pin belongs on it: the element's place among the body's
 *  elements in document order, its tag, and the pinned words with which of their occurrences in the element they are.
 *  truth is null when the element is gone. */
function finalize(marked) {
  const d = parse(marked);
  let ord = -1;
  let truth = null;
  walk(d.body, (n) => {
    if (!isEl(n) || n === d.body) return;
    ord++;
    if (!('data-t' in n.attrs)) return;
    delete n.attrs['data-t'];
    truth = { ord, tag: n.tag };
    const text = textOf(n);
    const a = text.indexOf(OPEN);
    if (a < 0) return;
    const s = text.slice(a + 1, text.indexOf(CLOSE));
    let nth = 0;
    for (let i = text.indexOf(s); i !== -1 && i < a; i = text.indexOf(s, i + 1)) nth++;
    truth.word = { s, nth };
  });
  walk(d.body, (n) => !isEl(n) && (n.text = plain(n.text)));
  return { html: unparse(d), truth };
}

// ---------- the mutations ----------
// Each is (html, c) → html, or null when it does not apply to that pin. c: { kind, flavour, r (seeded choices) }.
// Inside, m is what a mutation needs of the page: t the pinned element; unit the repeating thing it is or sits in (the
// list item, the table row, the card, the figure, the paragraph; a heading's is its section) and home, the unit's
// parent; sec its section; blk the block of that section it is in (the list, the table, the grid; a paragraph itself).
const UNIT = { cell: 'tr', cardbtn: 'card', img: 'figure' };
const edit = (fn) => (html, c) => {
  const d = parse(html);
  const t = all(d.body, (n) => 'data-t' in n.attrs)[0];
  if (!t) return null;
  const root = d.body;
  const sec = t.tag === 'section' ? t : up(root, t, (n) => n.tag === 'section');
  const main = parentOf(root, sec);
  let unit = t;
  if (c.kind === 'heading') unit = sec;
  else if (UNIT[c.kind]) unit = parentOf(root, t);
  const home = parentOf(root, unit);
  let blk = t;
  while (blk !== sec && parentOf(root, blk) !== sec) blk = parentOf(root, blk);
  const m = { d, root, t, sec, main, unit, home, blk, sibs: els(home), at: els(home).indexOf(unit), secs: els(main), ...c };
  return fn(m) === false ? null : unparse(d);
};
// New words where the old ones were: a new item, row, card or paragraph that says something else. A card's button
// says what every card's button says.
const fresh = (node, r, top = true) => {
  if (!isEl(node)) return T(plain(node.text).replace(/[A-Za-z]{2,}/g, (w) => (/^[A-Z]/.test(w) ? pick(r, WORDS).replace(/^./, (x) => x.toUpperCase()) : pick(r, WORDS))).replace(/\d+/g, (n) => String(Number(n) + int(r, 11, 80))));
  if (node.tag === 'button' && !top) return clone(node);
  const copy = clone(node);
  copy.kids = node.kids.map((k) => fresh(k, r, false));
  if (copy.tag === 'img') Object.assign(copy.attrs, { src: copy.attrs.src.replace(/^[a-z]+/, 'lighthouse'), alt: 'Lighthouse at dusk' });
  return copy;
};
// The pinned element's words, as places to change: [text node, the pieces of its text, the indexes of the pieces that
// are words outside the pin's quote].
const slots = (t) => {
  const out = [];
  walk(t, (n) => {
    if (isEl(n) || !n.text.trim()) return;
    const parts = n.text.split(new RegExp(`(${OPEN}[^${CLOSE}]*${CLOSE}|[^A-Za-z${OPEN}]+)`)).filter((p) => p !== '');
    parts.forEach((p, i) => /^[A-Za-z]{2,}$/.test(p) && out.push([n, parts, i]));
  });
  return out;
};
const settle = (list) => {
  for (const [n, parts] of list) n.text = parts.join('');
};
const typo = (w) => (w.length > 3 ? w.slice(0, 1) + w[2] + w[1] + w.slice(3) : `${w}x`).replace(/^(.)(.)\2/, '$1$2x');
const other = (r, w) => {
  const n = pick(r, WORDS.filter((x) => x !== w.toLowerCase()));
  return /^[A-Z]/.test(w) ? n[0].toUpperCase() + n.slice(1) : n;
};
const words = (fn, least = 1) => edit((m) => {
  if (m.kind === 'img') return false; // a picture has no words (its alt has a mutation of its own)
  const list = slots(m.t);
  if (list.length < least) return false;
  if (fn(list, m) === false) return false;
  settle(list);
});
const quoted = (fn) => edit((m) => {
  if (m.kind !== 'word' && m.kind !== 'quote') return false;
  const node = m.t.kids.find((k) => !isEl(k) && k.text.includes(OPEN));
  if (!node) return false;
  const [, before, quote, after] = new RegExp(`^([\\s\\S]*)${OPEN}([^${CLOSE}]*)${CLOSE}([\\s\\S]*)$`).exec(node.text);
  const out = fn({ before, quote, after }, m);
  if (out === false) return false;
  node.text = out;
});
const Q = (s) => OPEN + s + CLOSE;
const retagged = { p: 'div', h2: 'h3', td: 'th', div: 'article', button: 'a' };
const moveUnit = (to) => edit((m) => {
  const order = to(m);
  if (!order || order.every((x, i) => x === m.sibs[i])) return false;
  reorder(m.home, order);
});

const MUTATIONS = {
  // Nothing changed: every pin must be where it was put.
  none: (html) => html,

  // An identical twin of the pinned thing, right before it, right after it, or apart from it.
  'sib-before': edit((m) => putAt(m.home, m.unit, clone(m.unit))),
  'sib-after': edit((m) => putAfter(m.home, m.unit, clone(m.unit))),
  'sib-apart': edit((m) => (m.at >= 2 ? putAt(m.home, m.sibs[0], clone(m.unit)) : m.at + 2 < m.sibs.length ? putAfter(m.home, m.sibs[m.sibs.length - 1], clone(m.unit)) : false)),
  // A new, different one: before it (a list item added above, a table row inserted), first of all, after it.
  'new-before': edit((m) => putAt(m.home, m.unit, fresh(m.unit, m.r))),
  'new-first': edit((m) => (m.at === 0 ? false : putAt(m.home, m.sibs[0], fresh(m.unit, m.r)))),
  'new-after': edit((m) => putAfter(m.home, m.unit, fresh(m.unit, m.r))),
  // A table column inserted before the pinned cell's.
  'col-before': edit((m) => {
    if (m.kind !== 'cell') return false;
    const col = els(m.unit).indexOf(m.t);
    for (const tr of all(m.blk, (n) => n.tag === 'tr')) els(tr)[col] && tr.kids.splice(tr.kids.indexOf(els(tr)[col]), 0, fresh(els(tr)[col], m.r));
  }),

  // Neighbours removed: the one before it, the one after it, the first of them, all of them.
  'rm-prev': edit((m) => (m.at < 1 ? false : take(m.home, m.sibs[m.at - 1]))),
  'rm-next': edit((m) => (m.at + 1 >= m.sibs.length ? false : take(m.home, m.sibs[m.at + 1]))),
  'rm-first': edit((m) => (m.at < 2 ? false : take(m.home, m.sibs[0]))),
  'rm-others': edit((m) => (m.sibs.length < 2 || m.kind === 'heading' ? false : m.sibs.forEach((s) => s !== m.unit && s.tag === m.unit.tag && take(m.home, s)))),

  // Its siblings in another order.
  reverse: moveUnit((m) => (m.kind === 'heading' ? [...m.sibs].reverse() : (() => { const same = m.sibs.filter((s) => s.tag === m.unit.tag).reverse(); return m.sibs.map((s) => (s.tag === m.unit.tag ? same.shift() : s)); })())),
  shuffle: moveUnit((m) => {
    for (let i = 0; i < 6; i++) {
      const same = shuffled(m.r, m.sibs.filter((s) => s.tag === m.unit.tag));
      const order = m.sibs.map((s) => (s.tag === m.unit.tag ? same.shift() : s));
      if (order.indexOf(m.unit) !== m.at) return order;
    }
    return null;
  }),
  'to-first': moveUnit((m) => { const first = m.sibs.findIndex((s) => s.tag === m.unit.tag); return first === m.at ? null : [...m.sibs.slice(0, first), m.unit, ...m.sibs.slice(first).filter((s) => s !== m.unit)]; }),
  'to-last': moveUnit((m) => (m.at === m.sibs.length - 1 ? null : [...m.sibs.filter((s) => s !== m.unit), m.unit])),

  // Wrapped in another box: the element itself (a cell can't be), or the block it is in.
  wrap: edit((m) => {
    if (m.kind === 'cell') return false;
    const p = parentOf(m.root, m.t);
    p.kids[p.kids.indexOf(m.t)] = h('div', {}, m.t);
  }),
  'wrap-block': edit((m) => void (m.sec.kids[m.sec.kids.indexOf(m.blk)] = block('div', { class: m.flavour === 'bare' ? undefined : m.flavour === 'hashed' ? madeUp('wrapper') : 'wrapper' }, m.blk))),

  // Its words changed a little, or a lot.
  'typo-start': words((list) => void (list[0][1][list[0][2]] = typo(list[0][1][list[0][2]]))),
  'typo-end': words((list) => { const [, parts, i] = list[list.length - 1]; parts[i] = typo(parts[i]); }, 2),
  'word-swap': words((list, m) => { const [, parts, i] = list[Math.floor(list.length / 2)]; parts[i] = other(m.r, parts[i]); }, 3),
  'half-words': words((list, m) => list.slice(0, Math.ceil(list.length / 2)).forEach(([, parts, i]) => (parts[i] = other(m.r, parts[i]))), 2),
  prepend: words((list) => void list[0][1].unshift('Updated: ')),
  rewrite: words((list, m) => list.forEach(([, parts, i]) => (parts[i] = other(m.r, parts[i])))),
  // A picture: its alt rewritten, its file renamed (a new export of the same picture).
  'alt-rewrite': edit((m) => (m.kind === 'img' ? void (m.t.attrs.alt = 'Lighthouse at dusk') : false)),
  'src-rename': edit((m) => (m.kind === 'img' ? void (m.t.attrs.src = m.t.attrs.src.replace(/^([a-z]+)/, '$1-v2')) : false)),

  // The pinned words themselves (a pin on a word or on a few): a typo in them, the same words again earlier or later in
  // the paragraph, moved to its end, the words around them changed, taken out.
  'q-typo': quoted(({ before, quote, after }) => before + Q(quote.replace(/[A-Za-z]{3,}/, typo)) + after),
  'q-twin-before': quoted(({ before, quote, after }) => `${quote} ${before}${Q(quote)}${after}`),
  'q-twin-after': quoted(({ before, quote, after }) => `${before}${Q(quote)}${after} ${quote}`),
  'q-moved': quoted(({ before, quote, after }) => `${before.trimEnd()}${after} ${Q(quote)}`),
  'q-around': quoted(({ before, quote, after }, m) => `${before.replace(/([A-Za-z]+)(\s*)$/, (_, w, s) => other(m.r, w) + s)}${Q(quote)}${after.replace(/^(\s*)([A-Za-z]+)/, (_, s, w) => s + other(m.r, w))}`),
  'q-deleted': quoted(({ before, after }) => before.trimEnd() + after),

  // Its classes and ids.
  'class-add': edit((m) => void (m.t.attrs.class = `${m.t.attrs.class || ''} is-active`.trim())),
  'class-swap': edit((m) => void (m.t.attrs.class = m.flavour === 'hashed' ? madeUp(`${m.t.tag} new`) : 'entry-v2')),
  'class-drop': edit((m) => (m.t.attrs.class ? void delete m.t.attrs.class : false)),
  'id-add': edit((m) => void (m.t.attrs.id = `the-${m.kind}`)),
  'box-id-add': edit((m) => { const p = m.kind === 'heading' ? m.sec : parentOf(m.root, m.t); return p.attrs.id ? false : void (p.attrs.id = `box-${m.kind}`); }),
  'box-id-change': edit((m) => { const p = up(m.root, m.t, (n) => n.attrs.id); return p ? void (p.attrs.id = `${p.attrs.id}-2`) : false; }),

  // Its tag renamed (p → div, h2 → h3, td → th, a card → article, button → a; a list item with its list → div), or its
  // section's (section → div).
  retag: edit((m) => {
    if (m.t.tag === 'li') return void ((m.t.tag = 'div'), (m.home.tag = 'div'), m.sibs.forEach((s) => (s.tag = 'div')));
    if (!retagged[m.t.tag]) return false;
    m.t.tag = retagged[m.t.tag];
    if (m.t.tag === 'a') m.t.attrs.href = '#go';
  }),
  'sec-retag': edit((m) => void (m.sec.tag = 'div')),

  // Things added above it: words in its section, a banner on top of the page, a whole section.
  'text-above': edit((m) => { for (let i = 0; i < 3; i++) putAfter(m.sec, els(m.sec)[0], h('p', {}, textOf(fresh(h('p', {}, 'Amber anchor april arrow atlas autumn basket beacon berry birch blanket bridge.'), m.r)))); }),
  'banner-top': edit((m) => void m.root.kids.unshift(h('div', { class: 'banner' }, 'A notice about maintenance this weekend, placed on top of the page.'), T('\n'))),
  'sec-above': edit((m) => putAt(m.main, m.sec, block('section', {}, h('h2', {}, 'Release notes'), h('p', {}, 'Timber tunnel velvet violet walnut willow winter zephyr.'), h('p', {}, 'Saddle saffron salmon shadow signal silver sparrow.')))),

  // Its whole section twice (the copy before it, after it), moved to the end, swapped with the one before.
  'dup-sec-before': edit((m) => putAt(m.main, m.sec, clone(m.sec))),
  'dup-sec-after': edit((m) => putAfter(m.main, m.sec, clone(m.sec))),
  'sec-to-end': edit((m) => (m.secs.indexOf(m.sec) === m.secs.length - 1 ? false : reorder(m.main, [...m.secs.filter((s) => s !== m.sec), m.sec]))),
  'sec-swap': edit((m) => { const i = m.secs.indexOf(m.sec); if (i < 1) return false; const order = [...m.secs]; [order[i - 1], order[i]] = [order[i], order[i - 1]]; reorder(m.main, order); }),

  // Moved into another section: the thing itself (a table row can't leave its table), or the block it is in.
  'move-unit': edit((m) => {
    if (m.kind === 'cell' || m.kind === 'heading') return false;
    const to = m.secs[(m.secs.indexOf(m.sec) + 2) % m.secs.length];
    take(m.home, m.unit);
    putAt(to, null, m.unit);
  }),
  'move-block': edit((m) => {
    if (m.kind === 'heading') return false;
    const to = m.secs[(m.secs.indexOf(m.sec) + m.secs.length - 2) % m.secs.length];
    take(m.sec, m.blk);
    putAt(to, null, m.blk);
  }),

  // Gone: the element, replaced by a new and different one, its block, its section. The pin must say so (L).
  delete: edit((m) => take(parentOf(m.root, m.t), m.t)),
  replace: edit((m) => { const p = parentOf(m.root, m.t); p.kids[p.kids.indexOf(m.t)] = fresh(m.t, m.r); }),
  'delete-unit': edit((m) => (m.unit === m.t ? false : take(m.home, m.unit))),
  'delete-block': edit((m) => (m.blk === m.t ? false : take(m.sec, m.blk))),
  'delete-sec': edit((m) => take(m.main, m.sec)),

  // Every made-up class and file hash is new (the next build), alone and with a new item before the pinned one.
  rehash: (html, c) => (c.flavour === 'hashed' ? html.replace(/css-[a-z0-9]{6}/g, (x) => madeUp(x, 'build 2')).replace(/\.B[a-z0-9]{6}Z\.svg/g, (x) => `.${fileHash(x, 'build 2')}.svg`) : null),
  'rehash+new-before': (html, c) => (c.flavour === 'hashed' ? MUTATIONS.rehash(MUTATIONS['new-before'](html, c), c) : null),

  // The same page in a window of another width (the pin was made at 1000 px).
  'width-1400': (html) => html,
  'width-600': (html) => html,
  'width-390': (html) => html,
};
const WIDTH = { 'width-1400': 1400, 'width-600': 600, 'width-390': 390 };
// Mutations after which the pinned element (or its words) is gone.
const GONE = new Set(['delete', 'replace', 'delete-unit', 'delete-block', 'delete-sec']);
// An identical copy right beside the pinned thing: the page alone cannot say which of the two was pinned (the same
// HTML comes out of sib-before and sib-after), only the change itself can.
const AMBIGUOUS = new Set(['sib-before', 'sib-after', 'dup-sec-before', 'dup-sec-after']);

// ---------- the cases ----------
const SEEDS = (process.env.TORTURE_SEEDS || '1,2').split(',').map((s) => s.trim()).filter(Boolean);
const ONE = process.env.TORTURE_CASE || '';
const JUDGED = SEEDS.join() === '1,2'; // KNOWN lists what fails with these seeds
const bases = [];
const cases = [];
for (const flavour of FLAVOURS) {
  for (const seed of SEEDS) {
    const page = basePage(flavour, seed);
    for (const kind of KINDS) {
      const marked = only(page, kind);
      const base = { key: `${kind}|${flavour}|${seed}`, flavour, seed, kind, ...finalize(marked) };
      if (!base.truth) throw new Error(`no ${kind} on the ${flavour} page`);
      bases.push(base);
      for (const [mut, fn] of Object.entries(MUTATIONS)) {
        const key = `${mut}|${kind}|${flavour}|${seed}`;
        if (ONE && ONE !== key) continue;
        const out = fn(marked, { kind, flavour, r: rng(key) });
        if (out === null) continue;
        const done = finalize(out);
        // What passes: a pin whose element is gone must be flagged; one whose words are gone may stay on their element.
        const wordGone = Boolean(base.truth.word) && Boolean(done.truth) && !done.truth.word;
        // An element whose every word is new reads exactly like a new element in its place (replace): staying on it
        // and saying it is gone are both fair.
        const accept = !done.truth ? 'L' : wordGone || (mut === 'rewrite' && !done.truth.word) ? 'RL' : 'R';
        if (GONE.has(mut) !== !done.truth) throw new Error(`${key}: the pinned element is ${done.truth ? 'still there' : 'gone'}`);
        cases.push({ key, mut, kind, flavour, seed, base, html: done.html, truth: done.truth, accept, width: WIDTH[mut] || 1000 });
        if (ONE && process.env.TORTURE_OUT) {
          fs.mkdirSync(process.env.TORTURE_OUT, { recursive: true });
          fs.writeFileSync(path.join(process.env.TORTURE_OUT, 'case-before.html'), base.html);
          fs.writeFileSync(path.join(process.env.TORTURE_OUT, 'case-after.html'), done.html);
        }
      }
    }
  }
}
// TEST_PART=i/n (ci/browser-run.mjs sets it for anchoring-torture@i/n): only the i-th of n parts, so CI can run the
// parts side by side. The parts go by kind of pin, so each base page and each cell of the matrix (mutation × kind,
// what KNOWN judges) sits whole in one part; the kinds are dealt largest first onto the smallest part. The live patch
// keeps the cases it picks from the whole list, and the smallest pages run in part 1.
const [PART, PARTS] = ONE ? [1, 1] : (process.env.TEST_PART || '1/1').split('/').map(Number);
if (!(PARTS >= 1 && PART >= 1 && PART <= PARTS)) throw new Error(`TEST_PART=${process.env.TEST_PART}: give it as i/n`);
const allCases = cases.splice(0);
{
  const sizes = Object.groupBy(allCases, (c) => c.kind);
  const parts = Array.from({ length: PARTS }, () => ({ kinds: new Set(), n: 0 }));
  for (const kind of [...KINDS].sort((a, b) => (sizes[b]?.length || 0) - (sizes[a]?.length || 0) || a.localeCompare(b))) {
    const part = parts.reduce((lo, p) => (p.n < lo.n ? p : lo));
    part.kinds.add(kind);
    part.n += sizes[kind]?.length || 0;
  }
  const mine = parts[PART - 1].kinds;
  cases.push(...allCases.filter((c) => mine.has(c.kind)));
  bases.splice(0, bases.length, ...bases.filter((b) => mine.has(b.kind)));
}

// ---------- the smallest pages that show it ----------
// Each failure of the matrix comes down to a few causes. These are the smallest pages that show one cause each, run on
// anchoring.ts alone (the module beside the widget): the pin is made where `pin` says (a click 5 px into the element,
// an area over it, or the word `word`), `change` is done to the page (`pinned` is the pinned element), and the pin is
// placed again. should: where it must be (R on its element or word, L flagged as moved). today: what it does now.
const CARDS = '<h2>Pricing</h2><div class="grid"><div class="card"><h3>Starter</h3><p>Price $10</p></div><div class="card"><h3>Team</h3><p>Price $20</p></div><div class="card"><h3>Studio</h3><p>Price $30</p></div></div>';
const ROOTS = [
  { id: 'twin-before', says: 'an identical item added right before the pinned one', should: 'R', today: 'W',
    html: '<ul><li>Alpha</li><li>Beta</li><li>Gamma</li></ul>', pin: 'li:nth-child(2)',
    change: 'pinned.before(pinned.cloneNode(true))' },
  { id: 'repeated-button', says: 'every card has the same button; a card added before the pinned button\'s card', should: 'R', today: 'R',
    html: '<div class="grid"><div class="card"><h3>Starter</h3><button>Choose plan</button></div><div class="card"><h3>Team</h3><button>Choose plan</button></div></div>', pin: '.card:nth-child(2) button',
    change: 'pinned.parentElement.insertAdjacentHTML("beforebegin", "<div class=\\"card\\"><h3>Solo</h3><button>Choose plan</button></div>")' },
  { id: 'card-with-heading', says: 'cards with a heading each; a card added before the pinned card', should: 'R', today: 'R',
    html: CARDS, pin: '.card:nth-child(2)',
    change: 'pinned.insertAdjacentHTML("beforebegin", "<div class=\\"card\\"><h3>Solo</h3><p>Price $5</p></div>")' },
  { id: 'area-on-card', says: 'an area drawn over a card that has a heading; the card before it removed', should: 'R', today: 'R',
    html: CARDS.replaceAll('</p></div>', '</p><p>Billed monthly.</p><p>Cancel any time.</p></div>'), pin: '.card:nth-child(2)', how: 'area',
    change: 'pinned.previousElementSibling.remove()' },
  { id: 'deleted-card', says: 'the pinned card deleted (cards with a heading each)', should: 'L', today: 'L',
    html: CARDS, pin: '.card:nth-child(2)',
    change: 'pinned.remove()' },
  { id: 'deleted-with-twin', says: 'the pinned paragraph deleted; the same words stand under another heading', should: 'L', today: 'L',
    html: '<h2>Plans</h2><p>Free shipping on every order.</p><p>Cancel any time.</p><h2>Checkout</h2><p>Free shipping on every order.</p>', pin: 'p',
    change: 'pinned.remove()' },
  { id: 'moved-section', says: 'the pinned paragraph moved under another heading', should: 'R', today: 'R',
    html: '<h2>Today</h2><p>Write the release notes.</p><p>Call the printer.</p><h2>Done</h2><p>Order the paper.</p>', pin: 'p',
    change: 'document.body.append(pinned)' },
  { id: 'typo', says: 'one typo fixed in the pinned item\'s first word', should: 'R', today: 'R',
    html: '<ul><li>Fats setup in minutes</li><li>Works offline</li><li>Free for teams</li></ul>', pin: 'li',
    change: 'pinned.textContent = "Fast setup in minutes"' },
  { id: 'id-added', says: 'the pinned paragraph given an id', should: 'R', today: 'R',
    html: '<p>One paragraph.</p><p>Another paragraph, the pinned one.</p><p>A third.</p>', pin: 'p:nth-child(2)',
    change: 'pinned.id = "intro"' },
  { id: 'tag-renamed', says: 'the pinned paragraph made a div (same words, same place)', should: 'R', today: 'R',
    html: '<p>One paragraph.</p><p>Another paragraph, the pinned one.</p><p>A third.</p>', pin: 'p:nth-child(2)',
    change: 'const d = document.createElement("div"); d.textContent = pinned.textContent; pinned.replaceWith(d); d.__pinned = true' },
  { id: 'word-rewritten-around', says: 'a pinned word that stands once on the page; the words around it rewritten', should: 'R', today: 'R',
    html: '<p>We ship the lighthouse edition every spring to all members.</p><p>Other words stand here.</p>', pin: 'p', how: 'word', word: 'lighthouse',
    change: 'pinned.textContent = "Our team mails a lighthouse issue each autumn to subscribers."' },
  { id: 'picture-twice', says: 'the same picture twice; a figure added before the pinned (second) one', should: 'R', today: 'R',
    html: '<figure><img src="harbor.svg" alt="Harbor" width="220" height="140"></figure><figure><img src="orchard.svg" alt="Orchard" width="220" height="140"></figure><figure><img src="harbor.svg" alt="Harbor" width="220" height="140"></figure>', pin: 'figure:nth-child(3) img',
    change: 'document.body.insertAdjacentHTML("afterbegin", "<figure><img src=\\"quarry.svg\\" alt=\\"Quarry\\" width=\\"220\\" height=\\"140\\"></figure>")' },
];
const rootPage = (r) => `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>root ${r.id}</title>\n<style>body{margin:24px;font:16px/1.5 system-ui,sans-serif}.grid{display:flex;gap:16px}.card{border:1px solid #bbb;padding:16px;width:180px}.card p{margin:0}figure{margin:0 0 12px}img{display:block}</style>\n</head>\n<body>\n${r.html}\n</body>\n</html>\n`;
// In the page: the pin made, the change done, the pin placed again.
const rootRun = (r) => {
  const lib = window.__anchoring;
  const host = document.querySelector('[data-lab-comments]');
  lib.bindAnchoring({ host, layer: host, el: (tag) => document.createElement(tag) });
  const pinned = document.querySelector(r.pin);
  pinned.__pinned = true;
  const q = pinned.getBoundingClientRect();
  const wordBox = (el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const i = t.data.indexOf(r.word);
      if (i < 0) continue;
      const range = document.createRange();
      range.setStart(t, i);
      range.setEnd(t, i + r.word.length);
      return range.getBoundingClientRect();
    }
    return null;
  };
  let anchor;
  if (r.how === 'area') anchor = lib.zoneAnchor({ x0: q.left + q.width * 0.08, y0: q.top + q.height * 0.08, x1: q.left + q.width * 0.92, y1: q.top + q.height * 0.92 });
  else if (r.how === 'word') {
    const w = wordBox(pinned);
    anchor = lib.anchorAt(w.left + w.width / 2, w.top + w.height / 2, true);
  } else anchor = lib.anchorAt(q.left + (pinned.localName === 'button' ? q.width / 2 : 5), q.top + (pinned.localName === 'button' ? q.height / 2 : 5));
  new Function('pinned', r.change)(pinned);
  const now = [...document.body.querySelectorAll('*')].find((e) => e.__pinned && e.isConnected) || null;
  const at = lib.position(anchor);
  const say = (e) => (e ? `<${e.localName}${e.id ? `#${e.id}` : ''}> "${(e.textContent || e.getAttribute('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 40)}"` : 'nothing');
  const saved = { selector: anchor.selector, element: anchor.element, text: anchor.text, section: anchor.section, quote: anchor.quote?.exact };
  if (at.moved) return { outcome: 'L', saved, told: lib.spotChanged(anchor) };
  const [x, y] = [at.left - scrollX, at.top - scrollY];
  const box = !now ? null : r.how === 'word' ? wordBox(now) : now.getBoundingClientRect();
  const on = Boolean(box) && x >= box.left - 4 && x <= box.right + 4 && y >= box.top - 4 && y <= box.bottom + 4;
  let under = null;
  for (const e of document.body.querySelectorAll('*')) {
    const b = e.getBoundingClientRect();
    if (!e.closest('[data-lab-comments]') && e.localName !== 'script' && b.width && x >= b.left - 1 && x <= b.right + 1 && y >= b.top - 1 && y <= b.bottom + 1) under = e;
  }
  return { outcome: on ? 'R' : 'W', under: say(under), saved, told: lib.spotChanged(anchor) };
};
const rootResults = [];

// ---------- the lab ----------
// One lab in a throwaway folder. A base page is a file of its own (the pin is put on it once). The cases share a few
// files: each browser tab has two pages it rewrites in turn (the one it is not showing), with the case's pin put on
// that page through the comments API, so the lab never holds more than a handful of comments (it rewrites
// .lab/comments.md on every one: five thousand pages each with a pin took minutes to set up).
const DIR = tmp('labit-torture-');
const PORT = claimPort(10400, 100);
const B = `http://localhost:${PORT}`;
const ENG = engines();
const JOBS = Math.max(1, Math.floor(Math.min(6, Number(process.env.TORTURE_JOBS) || 6) / ENG.length));
const HOT_EVERY = Number(process.env.TORTURE_HOT ?? 16); // every Nth case is also run as a live patch (0: none)
const short = { webkit: 'wk', chromium: 'cr', firefox: 'ff' };
const fileOf = (page) => path.join(DIR, `${page.slice(1)}.html`);
const titled = (html, title) => html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
const inPart = new Set(cases);
const hot = allCases.filter((c, i) => HOT_EVERY && !WIDTH[c.mut] && (ONE || i % HOT_EVERY === 0) && inPart.has(c));
// Every picture a page names is a file in the lab, beside the pages (they name it by file name alone).
const pictures = new Set([...bases, ...cases, ...ROOTS.map((r) => ({ html: `${r.html} ${r.change.replaceAll('\\"', '"')}` }))].flatMap((x) => [...x.html.matchAll(/ src="([^"]+)"/g)].map((m) => m[1])));
for (const eng of ENG) {
  const dir = path.join(DIR, short[eng] || eng);
  fs.mkdirSync(dir, { recursive: true });
  for (const src of pictures) {
    const hue = hash(src.replace(/\..*$/, '')) % 360;
    fs.writeFileSync(path.join(dir, src), `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280" viewBox="0 0 440 280"><rect width="440" height="280" fill="hsl(${hue} 55% 62%)"/><circle cx="150" cy="120" r="60" fill="hsl(${(hue + 40) % 360} 60% 45%)"/></svg>`);
  }
  for (const b of bases) fs.writeFileSync(fileOf(`/${short[eng] || eng}/b-${b.key.replaceAll('|', '-')}`), b.html);
  for (const r of ROOTS) fs.writeFileSync(fileOf(`/${short[eng] || eng}/root-${r.id}`), rootPage(r));
  for (let w = 0; w < JOBS; w++) for (const ab of 'abh') fs.writeFileSync(fileOf(`/${short[eng] || eng}/w${w}${ab}`), titled(bases[0].html, 'empty'));
}

// The lab takes 600 comments an hour from one address; the cases are thousands of pins.
const server = startLab(DIR, labEnv({ LAB_COMMENTS_PER_HOUR: '1000000' }, { settings: false }), { root: '.', port: PORT, stdio: 'ignore' });
await labUp(B);
const ADMIN = JSON.parse(fs.readFileSync(path.join(DIR, '.lab/server.json'), 'utf8')).agent;
const api = async (body, admin = false) => (await fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, ...(admin ? { 'x-lab-admin': ADMIN, 'x-lab-agent': '1' } : {}) }, body: JSON.stringify(body) })).json();
const commentsOf = async (page) => (await (await fetch(`${B}/_lab/api/comments?page=${encodeURIComponent(page)}`)).json()).comments || [];
/** The one pin of a page of the lab: the pin it had is deleted, this one put on it. */
const pinned = new Map();
async function setPin(page, kind, anchor) {
  if (pinned.has(page)) await api({ page, action: 'delete', id: pinned.get(page) }, true);
  const said = await api({ page, name: 'leo', text: `pin ${kind}`, anchor });
  if (!said.comment) throw new Error(`the lab did not take the pin on ${page}: ${JSON.stringify(said).slice(0, 200)}`);
  pinned.set(page, said.comment.id);
}
const pool = async (n, items, fn) => {
  let next = 0;
  await Promise.all(Array.from({ length: n }, async (_, w) => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i, w);
    }
  }));
};

// The anchoring module on its own (as test/browser/anchoring.mjs bundles it), beside the widget in every page: it is
// asked what the widget tells the lab about a pin once the page has settled (spotChanged: "its words changed", which
// the agent's next wait says; foundAt: the new path it saves), and where it would put the pin, to check the reading
// of the widget's own drawing against it. The widget itself tells the lab only 3 s after a page loads.
const BUILD = tmp('labit-torture-build-');
fs.writeFileSync(path.join(BUILD, 'entry.ts'), `export * from ${JSON.stringify(fileURLToPath(new URL('../../src/widget/anchoring.ts', import.meta.url)))};\n`);
execFileSync('npx', ['--yes', 'esbuild@0.25.12', path.join(BUILD, 'entry.ts'), '--bundle', '--format=iife', '--global-name=__anchoring', `--outfile=${path.join(BUILD, 'anchoring.js')}`, '--log-level=warning']);
const BUNDLE = fs.readFileSync(path.join(BUILD, 'anchoring.js'), 'utf8');
fs.rmSync(BUILD, { recursive: true, force: true, maxRetries: 5 });

// ---------- in the page ----------
// What the test reads in the page, set up before the page's own scripts: the element a place among the body's elements
// names, the boxes of words in it, and the reading of a case (where the pin is drawn against where it belongs).
const inPage = () => {
  const root = () => document.querySelector('[data-lab-comments]')?.shadowRoot || null;
  const elAt = (ord) => [...document.body.querySelectorAll('*')].filter((e) => !e.closest('[data-lab-comments]'))[ord] || null;
  const wordBoxes = (el, word) => {
    const nodes = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let text = '';
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      nodes.push([t, text.length]);
      text += t.data;
    }
    let i = text.indexOf(word.s);
    for (let k = 0; k < word.nth && i !== -1; k++) i = text.indexOf(word.s, i + 1);
    if (i === -1) return null;
    const spot = (at) => {
      const [t, from] = [...nodes].reverse().find(([, from]) => from <= at);
      return [t, at - from];
    };
    const range = document.createRange();
    range.setStart(...spot(i));
    const [end, k] = spot(i + word.s.length - 1);
    range.setEnd(end, k + 1);
    return [...range.getClientRects()].filter((b) => b.width && b.height).map((b) => ({ left: b.left, top: b.top, right: b.right, bottom: b.bottom }));
  };
  const say = (e) => (e ? `<${e.localName}${e.id ? `#${e.id}` : ''}> "${(e.textContent || e.getAttribute('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 48)}"` : 'nothing');
  // What the widget tells the lab about this pin (the module beside it, bound to the widget's own host).
  const asked = (anchor) => {
    const lib = window.__anchoring;
    const host = document.querySelector('[data-lab-comments]');
    if (!lib || !host || !anchor) return {};
    try {
      lib.bindAnchoring({ host, layer: host, el: (tag) => document.createElement(tag) });
      const at = lib.position(anchor);
      const changed = lib.spotChanged(anchor);
      return { calc: { left: Math.round(at.left * 10) / 10, top: Math.round(at.top * 10) / 10, moved: Boolean(at.moved) }, told: changed ? (changed.gone ? 'gone' : changed.away ? 'away' : 'changed') : '', saved: lib.foundAt(anchor)?.selector || '' };
    } catch (err) {
      return { asked: String(err).slice(0, 120) };
    }
  };
  /** truth: { ord, tag, word? } or null. */
  const read = (truth, anchor) => {
    const r = root();
    if (!r) return null;
    const pins = [...r.querySelectorAll('button.pin')];
    const movedBtn = r.querySelector('.moved-btn');
    const flagged = Boolean(movedBtn) && !movedBtn.hidden;
    const out = { pins: pins.length, flagged, movedText: flagged ? movedBtn.textContent : '', ...asked(anchor) };
    const el = truth ? elAt(truth.ord) : null;
    if (truth) {
      out.truthOk = Boolean(el) && el.localName === truth.tag;
      out.truth = say(el);
    }
    const boxes = !el ? [] : truth.word ? wordBoxes(el, truth.word) : [el.getBoundingClientRect()];
    if (truth?.word && !boxes) out.truthOk = false;
    const pin = pins[0];
    if (!pin) return out;
    const b = pin.getBoundingClientRect();
    const tip = { x: pin.classList.contains('flip') ? b.right : b.left, y: b.bottom };
    Object.assign(out, { tip: [Math.round(tip.x * 10) / 10, Math.round((tip.y + scrollY) * 10) / 10], cls: pin.className, movedPin: pin.classList.contains('moved'), hidden: getComputedStyle(pin).visibility === 'hidden' });
    // How far the tip is from where it belongs (0: on it). Words get a few px of room: a pin on words sits at their edge.
    const room = truth?.word ? 4 : 1.5;
    const far = (q) => Math.hypot(Math.max(q.left - tip.x, 0, tip.x - q.right), Math.max(q.top - tip.y, 0, tip.y - q.bottom));
    out.far = boxes?.length ? Math.round(Math.min(...boxes.map(far)) * 10) / 10 : null;
    out.on = out.far !== null && out.far <= room;
    // What it is on instead: the innermost element of the page under the tip.
    let under = null;
    for (const e of document.body.querySelectorAll('*')) {
      if (e.closest('[data-lab-comments]') || e.localName === 'script') continue;
      const q = e.getBoundingClientRect();
      if (tip.x >= q.left - 1 && tip.x <= q.right + 1 && tip.y >= q.top - 1 && tip.y <= q.bottom + 1 && q.width && q.height) under = e;
    }
    out.under = say(under);
    return out;
  };
  // The pins as drawn, to tell when they stand still.
  const drawn = () => {
    const r = root();
    if (!r || document.readyState !== 'complete') return '';
    const pins = [...r.querySelectorAll('button.pin')];
    const movedBtn = r.querySelector('.moved-btn');
    if (!pins.length && !(movedBtn && !movedBtn.hidden)) return '';
    return pins.map((p) => { const b = p.getBoundingClientRect(); return `${p.className} ${Math.round(b.left + scrollX)} ${Math.round(b.top + scrollY)}`; }).join(';') + (movedBtn && !movedBtn.hidden ? movedBtn.textContent : '');
  };
  let last = '';
  let same = 0;
  /** The reading, once the pins have stood still for a few frames (false until then). */
  const settled = (truth, anchor, frames = 1) => {
    const now = drawn();
    same = now && now === last ? same + 1 : 0;
    last = now;
    return same >= frames ? { ...read(truth, anchor), ms: Math.round(performance.now()) } : false;
  };
  window.__torture = { root, elAt, wordBoxes, read, settled, reset: () => void ((last = ''), (same = 0)) };
};

// ---------- pins put down through the widget ----------
const untilFn = (p, fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms, polling: 'raf' }).then((v) => v.jsonValue(), () => null);
const cardUp = (p, ms = 2500) => untilFn(p, () => { const r = window.__torture.root(); const f = r?.querySelectorAll('.float'); return Boolean(f) && f.length === 1 && r.activeElement?.localName === 'textarea'; }, null, ms);
async function drag(p, [x0, y0], [x1, y1]) {
  await p.mouse.move(x0, y0);
  await p.mouse.down();
  for (let i = 1; i <= 8; i++) await p.mouse.move(x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * i) / 8);
  await p.mouse.up();
}
/** Puts the pin of a base page on it, as a person does, and gives the anchor the lab saved. */
async function pinDown(p, page, b) {
  await p.goto(B + page);
  await untilFn(p, () => document.readyState === 'complete' && Boolean(window.__torture.root()?.querySelector('.scrim')), null, 5000);
  await sleep(250); // the widget's handlers are in place a moment after its markup
  // The element in the middle of the window, then its box (and its words' boxes) there.
  await p.evaluate((ord) => window.__torture.elAt(ord).scrollIntoView({ block: 'center' }), b.truth.ord);
  const at = await p.evaluate((truth) => {
    const el = window.__torture.elAt(truth.ord);
    const q = el.getBoundingClientRect();
    return { box: { left: q.left, top: q.top, width: q.width, height: q.height }, words: truth.word ? window.__torture.wordBoxes(el, truth.word) : null, tag: el.localName };
  }, b.truth);
  if (at.tag !== b.truth.tag) throw new Error(`${b.key}: the page's element ${b.truth.ord} is <${at.tag}>, not <${b.truth.tag}>`);
  const { box, words } = at;
  const mid = box.top + box.height / 2;
  if (b.kind === 'word') {
    const w = words[0];
    await p.keyboard.down('Shift');
    await untilFn(p, (ord) => { const c = getComputedStyle(window.__torture.elAt(ord)); return c.userSelect !== 'none' && c.webkitUserSelect !== 'none'; }, b.truth.ord, 1500);
    await p.mouse.dblclick((w.left + w.right) / 2, (w.top + w.bottom) / 2);
    await p.keyboard.up('Shift');
  } else if (b.kind === 'quote') {
    const [first, last] = [words[0], words[words.length - 1]];
    await p.keyboard.down('Shift');
    await untilFn(p, (ord) => { const c = getComputedStyle(window.__torture.elAt(ord)); return c.userSelect !== 'none' && c.webkitUserSelect !== 'none'; }, b.truth.ord, 1500);
    await drag(p, [first.left + 1, (first.top + first.bottom) / 2], [last.right - 1, (last.top + last.bottom) / 2]);
    await p.keyboard.up('Shift');
  } else if (b.kind === 'area') {
    await drag(p, [box.left + box.width * 0.08, box.top + box.height * 0.08], [box.left + box.width * 0.92, box.top + box.height * 0.92]);
  } else {
    // A click: in a card's own padding (the card, not what is in it), in the middle of a button or a picture, on the
    // first words of anything else. (A plain click on words is a pin on their element: only Shift quotes words.)
    const [x, y] = b.kind === 'card' ? [box.left + 5, box.top + 5]
      : b.kind === 'button' || b.kind === 'cardbtn' ? [box.left + box.width / 2, mid]
      : b.kind === 'img' ? [box.left + box.width * 0.4, box.top + box.height * 0.4]
      : b.kind === 'para' ? [box.left + 30, box.top + 12]
      : [box.left + Math.min(14, box.width / 2), mid];
    // The page's own control keeps a plain click (it is the page's); Option-click pins it.
    const control = b.kind === 'button' || b.kind === 'cardbtn';
    if (control) await p.keyboard.down('Alt');
    await p.mouse.click(x, y);
    if (control) await p.keyboard.up('Alt');
  }
  if (!(await cardUp(p))) throw new Error(`no comment box opened: ${JSON.stringify(await p.evaluate(() => { const r = window.__torture.root(); return { floats: r?.querySelectorAll('.float').length, active: r?.activeElement?.localName, on: localStorage.getItem('lab-on'), cls: document.documentElement.className, sel: String(getSelection()) }; }))} at ${JSON.stringify(at)}`);
  await p.keyboard.type(`pin ${b.kind}`);
  await p.keyboard.press('Enter');
  for (const end = Date.now() + 3000; Date.now() < end; await sleep(40)) {
    const c = (await commentsOf(page))[0];
    if (c) return c.anchor;
  }
  throw new Error(`the comment was not saved on ${page}`);
}
// What the widget must have saved for each kind (a pin put on the wrong thing would make every case after it mean nothing).
const savedRight = (b, a) =>
  Boolean(a) && (b.kind === 'word' || b.kind === 'quote' ? a.kind === 'text' && a.quote?.exact === b.truth.word.s
    : b.kind === 'area' ? typeof a.zw === 'number' && a.element?.startsWith(`<${b.truth.tag}`)
    : a.element?.startsWith(`<${b.truth.tag}`) && !a.quote && a.zw === undefined && (b.kind !== 'img' || a.kind === 'image'));

// ---------- a case read ----------
const outcomeOf = (c, got) => {
  if (!got) return { outcome: 'L', note: 'nothing drawn and nothing flagged' };
  if (c.truth && !got.truthOk) return { outcome: '?', note: `the test lost the element: ${got.truth}` };
  // Drawn as a pin on the page (a pin shown as moved is drawn only while open, which none is here).
  if (got.pins && !got.movedPin && !got.hidden) return { outcome: c.truth && got.on ? 'R' : 'W' };
  return { outcome: 'L', note: got.flagged ? '' : 'not drawn, and not counted as moved' };
};
const row = (c, eng, mode, got) => {
  const { outcome, note } = outcomeOf(c, got);
  // The module beside the widget must put the pin where the widget drew it (or both say it moved).
  const calc = got?.calc;
  const agrees = !calc || (calc.moved ? outcome === 'L' : outcome !== 'L' && Boolean(got.tip) && Math.hypot(calc.left - got.tip[0], calc.top - got.tip[1]) < 3);
  if (!agrees || got?.asked) notes.push(`${eng} ${c.key} (${mode}): the widget drew ${got.tip ? got.tip.join(',') : 'no pin'}${got.flagged ? ' (moved)' : ''}, anchoring.ts alone says ${JSON.stringify(calc || got.asked)}`);
  return { key: c.key, eng, mode, mut: c.mut, kind: c.kind, flavour: c.flavour, seed: c.seed, accept: c.accept, outcome, pass: c.accept.includes(outcome), told: got?.told || '', saved: got?.saved || '', far: got?.far ?? null, tip: got?.tip, under: got?.under, truth: got?.truth, flagged: got?.flagged || false, ...(note ? { note } : {}) };
};

const results = [];
const hotResults = [];
const notes = [];
const t0 = Date.now();
const took = () => `${((Date.now() - t0) / 1000).toFixed(1)} s`;

async function runEngine(eng) {
  const e = short[eng] || eng;
  const browser = await pw[eng].launch();
  try {
    const tabs = [];
    for (let i = 0; i < JOBS; i++) {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await ctx.addInitScript(() => {
        localStorage.setItem('lab-name', 'leo');
        localStorage.setItem('lab-on', '1');
      });
      await ctx.addInitScript(inPage);
      await ctx.addInitScript({ content: `${BUNDLE};window.__anchoring = __anchoring;` });
      tabs.push(await ctx.newPage());
    }
    // 1. The pins, through the widget.
    const anchors = new Map();
    const needed = bases.filter((b) => cases.some((c) => c.base === b));
    await pool(JOBS, needed, async (b, _, w) => {
      const page = `/${e}/b-${b.key.replaceAll('|', '-')}`;
      let anchor = null;
      for (let tries = 0; tries < 3 && !savedRight(b, anchor); tries++) anchor = await pinDown(tabs[w], page, b).catch((err) => (notes.push(`${eng} ${b.key}: ${String(err).slice(0, 200)}`), null));
      if (savedRight(b, anchor)) anchors.set(b, anchor);
      else notes.push(`${eng} ${b.key}: the widget saved ${JSON.stringify(anchor)?.slice(0, 300)}`);
    });
    check(eng, `pins put down through the widget: ${anchors.size} of ${needed.length}`, anchors.size === needed.length, took());
    // The base pages' pins are read; they go, so the lab holds only the pins of the cases being read.
    for (const b of needed) for (const c of await commentsOf(`/${e}/b-${b.key.replaceAll('|', '-')}`)) await api({ page: `/${e}/b-${b.key.replaceAll('|', '-')}`, action: 'delete', id: c.id }, true);
    // 2. Each case: the page as it is after the change, with the pin on it, opened and read. A tab takes one pin at a
    // time: it puts it on its two pages once, then writes each of that pin's cases to the page it is not showing and
    // opens it. The cases in a window of another width follow, one width after the other.
    const mine = cases.filter((c) => anchors.has(c.base));
    const turn = tabs.map(() => 0);
    const spent = { goto: 0, settle: 0, inPage: 0 };
    const open = async (c, w) => {
      const p = tabs[w];
      const page = `/${e}/w${w}${'ab'[turn[w]++ % 2]}`; // the page this tab is not showing
      fs.writeFileSync(fileOf(page), titled(c.html, c.key));
      let got = null;
      for (let tries = 0; tries < 2 && !got; tries++) {
        const t1 = Date.now();
        await p.goto(B + page, { waitUntil: 'commit' }).catch(() => {});
        const t2 = Date.now();
        got = await untilFn(p, ([truth, title, anchor]) => document.title.endsWith(title) && window.__torture?.settled(truth, anchor), [c.truth, c.key, anchors.get(c.base)], 4000);
        spent.goto += t2 - t1;
        spent.settle += Date.now() - t2;
        if (got) spent.inPage += got.ms;
      }
      results.push(row(c, eng, 'reload', got));
      if (ONE) console.log(JSON.stringify({ anchor: anchors.get(c.base), truth: c.truth, got }, null, 1));
    };
    const both = async (w, c) => {
      for (const ab of 'ab') await setPin(`/${e}/w${w}${ab}`, c.kind, anchors.get(c.base));
    };
    await pool(JOBS, needed.filter((b) => anchors.has(b)), async (b, _, w) => {
      const list = mine.filter((c) => c.base === b && c.width === 1000);
      if (list.length) await both(w, list[0]);
      for (const c of list) await open(c, w);
    });
    for (const wide of [...new Set(Object.values(WIDTH))]) {
      await Promise.all(tabs.map((p) => p.setViewportSize({ width: wide, height: 700 })));
      await pool(JOBS, mine.filter((c) => c.width === wide), async (c, _, w) => {
        await both(w, c);
        await open(c, w);
      });
    }
    await Promise.all(tabs.map((p) => p.setViewportSize({ width: 1000, height: 700 })));
    check(eng, `cases read: ${results.filter((x) => x.eng === eng).length}`, results.filter((x) => x.eng === eng).length === mine.length, `${took()}; per case ${Object.entries(spent).map(([k, v]) => `${k} ${Math.round(v / mine.length)} ms`).join(', ')}`);
    // 3. A sample as a live patch: the page open on the old file, the file rewritten, the lab patches it in place.
    await pool(JOBS, hot.filter((c) => anchors.has(c.base)), async (c, i, w) => {
      const p = tabs[w];
      const page = `/${e}/w${w}h`;
      await p.goto('about:blank').catch(() => {});
      fs.writeFileSync(fileOf(page), titled(c.base.html, `old ${i}`));
      await setPin(page, c.kind, anchors.get(c.base));
      await p.goto(B + page, { waitUntil: 'commit' }).catch(() => {});
      const before = await untilFn(p, ([truth, title]) => document.title.endsWith(title) && window.__torture?.settled(truth, null, 3), [c.base.truth, `old ${i}`], 4000);
      fs.writeFileSync(fileOf(page), titled(c.html, `new ${i}`));
      await untilFn(p, (title) => document.title.endsWith(title), `new ${i}`, 5000);
      await p.evaluate(() => window.__torture.reset()).catch(() => {});
      await sleep(120); // the patch cross-fades; the pins are drawn again after it
      const got = await untilFn(p, ([truth, title, anchor]) => document.title.endsWith(title) && window.__torture?.settled(truth, anchor, 6), [c.truth, `new ${i}`, anchors.get(c.base)], 3000);
      hotResults.push({ ...row(c, eng, 'hot', got), before: before ? (before.on ? 'R' : 'W') : 'L' });
    });
    // 4. The smallest pages, on anchoring.ts alone.
    for (const r of ONE || PART !== 1 ? [] : ROOTS) {
      const p = tabs[0];
      await p.goto(`${B}/${e}/root-${r.id}`).catch(() => {});
      await untilFn(p, () => document.readyState === 'complete' && Boolean(window.__torture.root()?.querySelector('.scrim')), null, 5000);
      const got = await p.evaluate(rootRun, r).catch((err) => ({ outcome: '?', note: String(err).slice(0, 200) }));
      rootResults.push({ id: r.id, eng, ...got });
    }
    await Promise.all(tabs.map((p) => p.context().close()));
  } finally {
    await browser.close();
  }
}

try {
  await Promise.all(ENG.map(runEngine));
} finally {
  server.kill();
  if (!process.env.TORTURE_KEEP) fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
  else console.log(`pages kept in ${DIR}`);
}

// ---------- the numbers ----------
const count = (list) => ({ R: list.filter((x) => x.outcome === 'R').length, W: list.filter((x) => x.outcome === 'W').length, L: list.filter((x) => x.outcome === 'L').length, n: list.length, pass: list.filter((x) => x.pass).length });
const pct = (a, n) => (n ? `${((100 * a) / n).toFixed(1)}%` : '–');
const muts = Object.keys(MUTATIONS).filter((m) => results.some((x) => x.mut === m));
const cellOf = (list) => {
  const k = count(list);
  return k.n ? `${k.R}·${k.W}·${k.L}` : '';
};
const table = (head, lines) => [`| ${head.join(' | ')} |`, `| ${head.map((_, i) => (i ? '--:' : ':--')).join(' | ')} |`, ...lines.map((l) => `| ${l.join(' | ')} |`)].join('\n');
const rate = (name, list) => { const k = count(list); return [name, k.n, `${k.R} (${pct(k.R, k.n)})`, `${k.W} (${pct(k.W, k.n)})`, `${k.L} (${pct(k.L, k.n)})`, `${k.pass} (${pct(k.pass, k.n)})`]; };
const RATES = ['', 'cases', 'right', 'WRONG', 'lost', 'as it should be'];
const kept = results.filter((x) => !GONE.has(x.mut) && x.accept === 'R');
const gone = results.filter((x) => GONE.has(x.mut));
const wordsGone = results.filter((x) => x.accept === 'RL');
const report = () => {
  const out = [];
  out.push('# Anchoring torture: how often a pin finds its spot again after one change to the page', '');
  out.push(`Run ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · labit ${commit()} · engines ${ENG.join(', ')} · seeds ${SEEDS.join(', ')} · ${results.length} cases (${cases.length} per engine) in ${took()}.`, '');
  out.push('Each cell is right·WRONG·lost. Right: the pin is drawn on its element (or word). WRONG: drawn on something else, with nothing to say so. Lost: flagged (off the page, counted as "moved · N").', '');
  out.push('## Overall', '');
  out.push(table(RATES, [
    rate('element still on the page (should be right)', kept),
    rate('the same, without the ‡ rows (an identical copy right beside it)', kept.filter((x) => !AMBIGUOUS.has(x.mut))),
    rate('element deleted or replaced (should be lost)', gone),
    rate('either is fair: the pinned words deleted from their paragraph, or every word of the element rewritten', wordsGone),
    rate('all', results),
    ...ENG.map((eng) => rate(`all, ${eng}`, results.filter((x) => x.eng === eng))),
  ]), '');
  const wrong = results.filter((x) => x.outcome === 'W');
  const toldOf = (list) => list.filter((x) => x.told).length;
  out.push(`The person sees nothing on a WRONG pin. The agent may: the widget tells the lab when a pin's words changed ("spot changed … check it still fits"), and that is read here too. Of the ${wrong.length} WRONG pins ${toldOf(wrong)} are told to the agent that way; **${wrong.length - toldOf(wrong)} are silent to everyone** (${pct(wrong.length - toldOf(wrong), results.length)} of all cases). Of the ${count(results).R} right pins ${toldOf(results.filter((x) => x.outcome === 'R'))} are also told as changed, and of the ${count(results).L} lost ones ${results.filter((x) => x.outcome === 'L' && x.told === 'gone').length} as gone. For ${wrong.filter((x) => x.saved).length} of the WRONG pins the widget also saves the wrong element as the pin's new path (3 s after the page loads), so the next look starts from there.`, '');
  out.push('## By kind of page', '');
  out.push(table(RATES, FLAVOURS.map((f) => rate(f, results.filter((x) => x.flavour === f)))), '');
  out.push('## By kind of pin', '');
  out.push(table(RATES, KINDS.map((k) => rate(k, results.filter((x) => x.kind === k)))), '');
  out.push('## Mutation × kind of pin', '');
  out.push('Rows marked † delete the pinned element: lost is the right outcome there, and any pin drawn is WRONG. Rows marked ‡ add an identical copy right beside the pinned thing: the page alone cannot say which of the two it was.', '');
  out.push(table(['mutation', ...KINDS, 'all'], muts.map((m) => [`${m}${GONE.has(m) ? ' †' : AMBIGUOUS.has(m) ? ' ‡' : ''}`, ...KINDS.map((k) => cellOf(results.filter((x) => x.mut === m && x.kind === k))), cellOf(results.filter((x) => x.mut === m))])), '');
  out.push('## Mutation × kind of page', '');
  out.push(table(['mutation', ...FLAVOURS], muts.map((m) => [m, ...FLAVOURS.map((f) => cellOf(results.filter((x) => x.mut === m && x.flavour === f)))])), '');
  if (rootResults.length) {
    out.push('## The smallest pages that show it', '');
    out.push('One cause each, on anchoring.ts alone (ROOTS in the test file has each page and change).', '');
    out.push(table(['page', 'what changes', 'should', ...ENG], ROOTS.map((r) => [r.id, r.says, r.should, ...ENG.map((eng) => { const x = rootResults.find((y) => y.id === r.id && y.eng === eng); return x ? `${x.outcome}${x.under ? ` on ${x.under.replaceAll('|', '/')}` : ''}` : ''; })])), '');
  }
  if (hotResults.length) {
    const differs = hotResults.filter((x) => results.find((y) => y.key === x.key && y.eng === x.eng)?.outcome !== x.outcome);
    out.push('## Live patch against reload', '');
    out.push(`${hotResults.length} cases were also run as the lab changes an open page (the file rewritten under it, patched in place). ${hotResults.length - differs.length} gave the same outcome as opening the changed page; ${differs.length} differed${differs.length ? ':' : '.'}`, '');
    if (differs.length) out.push(table(['case', 'engine', 'reload', 'live patch'], differs.map((x) => [x.key.replaceAll('|', ' / '), x.eng, results.find((y) => y.key === x.key && y.eng === x.eng)?.outcome, x.outcome])), '');
    out.push(table(RATES, [rate('live patch, all', hotResults), rate('the same cases, reload', results.filter((y) => hotResults.some((x) => x.key === y.key && x.eng === y.eng)))]), '');
  }
  return out.join('\n');
};
function commit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: import.meta.dirname, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

// ---------- the checks ----------
// One line per mutation × kind of pin and engine. A cell passes when every case in it came out as it should; a cell
// that fails as KNOWN lists is printed as `known`.
const flavourOf = (list) => {
  const bad = new Map();
  for (const x of list.filter((y) => !y.pass)) bad.set(x.flavour, bad.get(x.flavour) === 'W' || x.outcome === 'W' ? 'W' : x.outcome);
  return bad;
};
const knownOf = (mut, kind, eng) => {
  const out = new Map();
  for (const part of (KNOWN[mut]?.[kind] || '').split(' ').filter(Boolean)) {
    const [, worst, flavours, only] = /^([WL]):([a-z,]+)(?:@(\w+))?$/.exec(part) || [];
    if (worst && (!only || only === eng)) for (const f of flavours.split(',')) out.set(f, out.get(f) === 'W' ? 'W' : worst);
  }
  return out;
};
let knownCells = 0;
const fixed = [];
const wanted = {};
for (const eng of ENG) {
  for (const x of results.filter((y) => y.eng === eng && y.outcome === '?')) check(eng, `${x.key}: the test itself`, false, x.note);
  for (const mut of muts) {
    for (const kind of KINDS) {
      const list = results.filter((x) => x.eng === eng && x.mut === mut && x.kind === kind && x.outcome !== '?');
      if (!list.length) continue;
      const bad = flavourOf(list);
      const known = knownOf(mut, kind, eng);
      const k = count(list);
      const detail = `right ${k.R} wrong ${k.W} lost ${k.L}${bad.size ? `; fails on ${[...bad].map(([f, o]) => `${f} ${o}`).join(', ')}` : ''}`;
      for (const [f, o] of bad) ((wanted[mut] ||= {})[kind] ||= []).push([o, f, eng]);
      const worse = [...bad].filter(([f, o]) => !known.has(f) || (o === 'W' && known.get(f) === 'L'));
      const better = JUDGED ? [...known.keys()].filter((f) => !bad.has(f) && list.some((x) => x.flavour === f)) : [];
      if (better.length) fixed.push(`${eng} ${mut} × ${kind}: ${better.join(', ')}`);
      const name = `${mut} × ${kind}`;
      if (!JUDGED && bad.size) console.log(`fails ${eng.padEnd(8)} ${name} (${detail})`);
      else if (worse.length || (better.length && process.env.TORTURE_STRICT)) check(eng, name, false, `${detail}${worse.length ? `; not in KNOWN: ${worse.map(([f, o]) => `${f} ${o}`).join(', ')}` : `; listed in KNOWN but passes: ${better.join(', ')}`}`);
      else if (bad.size) {
        knownCells++;
        console.log(`known ${eng.padEnd(8)} ${name} (${detail})`);
      } else check(eng, name, true, detail);
    }
  }
}
// The smallest pages: each must come out as it should, or as it is known to today.
for (const x of rootResults) {
  const r = ROOTS.find((y) => y.id === x.id);
  const name = `smallest page ${r.id}: ${r.says}`;
  const detail = `should be ${r.should}, is ${x.outcome}${x.under ? ` on ${x.under}` : ''}${x.note ? ` ${x.note}` : ''}`;
  if (x.outcome === r.should) {
    if (r.today !== r.should) fixed.push(`${x.eng} ${name}`);
    check(x.eng, name, !(process.env.TORTURE_STRICT && r.today !== r.should), detail);
  } else if (x.outcome === r.today) {
    knownCells++;
    console.log(`known ${x.eng.padEnd(8)} ${name} (${detail})`);
  } else check(x.eng, name, false, `${detail}; known as ${r.today}`);
}
// The cases the live patch read differently from a reload are told, not judged (the matrix is the reload's).
for (const x of hotResults.filter((y) => y.outcome === '?')) check(x.eng, `${x.key} (live patch): the test itself`, false, x.note);

const md = report();
console.log(`\n${md}\n`);
if (notes.length) console.log(`notes:\n${notes.join('\n')}\n`);
if (fixed.length) console.log(`listed in KNOWN but passing now (trim the list):\n${fixed.join('\n')}\n`);
if (process.env.TORTURE_OUT) {
  fs.mkdirSync(process.env.TORTURE_OUT, { recursive: true });
  fs.writeFileSync(path.join(process.env.TORTURE_OUT, 'anchor-torture.md'), `${md}\n`);
  fs.writeFileSync(path.join(process.env.TORTURE_OUT, 'anchor-torture.json'), JSON.stringify({ at: new Date().toISOString(), commit: commit(), engines: ENG, seeds: SEEDS, part: `${PART}/${PARTS}`, took: took(), results, hot: hotResults, roots: rootResults, notes }, null, 1));
  console.log(`written to ${path.join(process.env.TORTURE_OUT, 'anchor-torture.md')} and anchor-torture.json`);
}
if (process.env.TORTURE_KNOWN === 'print' && PARTS > 1) console.log('TORTURE_KNOWN=print needs the whole run: leave TEST_PART out');
else if (process.env.TORTURE_KNOWN === 'print') {
  // The list this run needs: per mutation and kind, the worst outcome per flavour, with @engine when only one fails.
  const lines = [];
  for (const mut of Object.keys(wanted)) {
    const kinds = [];
    for (const kind of Object.keys(wanted[mut])) {
      const by = new Map();
      for (const [o, f, eng] of wanted[mut][kind]) {
        const had = by.get(f) || { o: 'L', engs: new Set() };
        by.set(f, { o: had.o === 'W' || o === 'W' ? 'W' : 'L', engs: had.engs.add(eng) });
      }
      const groups = new Map();
      for (const [f, { o, engs }] of by) {
        const g = `${o}${engs.size < ENG.length ? `@${[...engs][0]}` : ''}`;
        groups.set(g, [...(groups.get(g) || []), f]);
      }
      kinds.push(`${/^\w+$/.test(kind) ? kind : `'${kind}'`}: '${[...groups].map(([g, fl]) => `${g[0]}:${fl.join(',')}${g.slice(1)}`).join(' ')}'`);
    }
    lines.push(`  '${mut}': { ${kinds.join(', ')} },`);
  }
  console.log(`const KNOWN = {\n${lines.join('\n')}\n};`);
}
const k = count(results);
finish(`${results.length} cases: right ${k.R}, wrong ${k.W}, lost ${k.L}; as it should be ${k.pass} (${pct(k.pass, k.n)}); ${knownCells} cells fail as KNOWN lists, none other`);


// ---------- what fails today ----------
// mutation → kind of pin → 'W:flavour,flavour L:flavour' (the worst outcome seen there: W a pin silently on the wrong
// element, L a pin flagged as moved whose element is still on the page), with @engine when only that engine fails.
// From the run of 20 Nov 2026 on the scored search (anchoring stage 2; stage 1 and main 0659390 had many more cells) (both
// engines, seeds 1 and 2); print it again with TORTURE_KNOWN=print.
function knownToday() {
  return {
    'sib-before': { para: 'W:plain,ids,bare,hashed,twins', word: 'W:plain,ids,bare,hashed,twins', quote: 'W:plain,ids,bare,hashed,twins', area: 'W:plain,ids,bare,hashed,twins', li: 'W:plain,ids,bare,hashed,twins', cell: 'W:plain,ids,bare,hashed,twins', card: 'W:plain,ids,bare,hashed,twins', heading: 'W:plain,ids,bare,hashed,twins', img: 'W:plain,ids,bare,hashed,twins', button: 'W:plain,ids,bare,hashed,twins', cardbtn: 'W:plain,ids,bare,hashed,twins' },
    'sib-apart': { para: 'L:twins', cell: 'L:twins', heading: 'W:ids L:twins', img: 'W:plain,ids,bare,hashed', cardbtn: 'L:ids,hashed,twins' },
    'rm-others': { li: 'L:twins' },
    'reverse': { li: 'W:twins', img: 'W:twins' },
    'shuffle': { li: 'W:twins' },
    'to-first': { li: 'W:twins' },
    'to-last': { img: 'W:twins' },
    'half-words': { para: 'L:plain,ids,bare,hashed,twins' },
    'alt-rewrite': { img: 'L:plain,ids,bare,hashed W:twins' },
    'q-typo': { word: 'W:twins', quote: 'W:twins' },
    'q-moved': { word: 'W:twins' },
    'q-around': { word: 'W:twins' },
    'q-deleted': { quote: 'W:twins' },
    'retag': { cell: 'W:twins' },
    'dup-sec-before': { para: 'W:plain,ids,bare,hashed,twins', word: 'W:plain,ids,bare,hashed,twins', quote: 'W:plain,ids,bare,hashed,twins', area: 'W:plain,ids,bare,hashed,twins', li: 'W:plain,ids,bare,hashed,twins', cell: 'W:plain,ids,bare,hashed,twins', card: 'W:plain,ids,bare,hashed,twins', heading: 'W:plain,ids,bare,hashed,twins', img: 'W:plain,ids,bare,hashed,twins', button: 'W:plain,ids,bare,hashed,twins', cardbtn: 'W:plain,ids,bare,hashed,twins' },
    'move-unit': { img: 'W:twins', button: 'W:twins' },
    'move-block': { para: 'W:twins' },
    'delete': { img: 'W:twins' },
    'replace': { cell: 'W:plain,hashed,twins', img: 'W:twins', cardbtn: 'W:ids' },
    'delete-unit': { cell: 'W:twins', cardbtn: 'W:plain,ids,bare,hashed' },
  };
}
