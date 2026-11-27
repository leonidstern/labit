// Class-name check: a class the widget's script names must have a rule in the CSS, and a class the CSS styles must be
// named by the script. CSS can't be typed, and the widget names classes in HTML strings, selectors and classList calls
// that no TypeScript type reaches, so this reads both sides at build time. Nothing is shipped: no wrapper, no
// generated types, no bytes in the package.
//
// A class only the script looks at (a hook for querySelector, a marker on <html>) has no rule on purpose: list it in
// ci/parts.json "classes" with what it is for. Run: node ci/classes.mjs (npm run classes). No packages.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const parts = JSON.parse(read('ci/parts.json'));
const hooks = parts.classes || {};

const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const src = walk('src');
const sheets = src.filter((f) => f.endsWith('.css')); // src/lab.css is the lab's stylesheet; public/_lab/lab.css is its built copy
const code = src.filter((f) => /\.(ts|js)$/.test(f) && !f.endsWith('.d.ts'));

const NAME = String.raw`-?[_a-zA-Z][\w-]*`;
const uncomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const lineOf = (text, i) => text.slice(0, i).split('\n').length;

// What the CSS styles: every .class in a selector, in the sheets and in the style strings inside the script (the board
// view's, the page-level rules in comments.js).
const styled = new Map(); // class -> where
const styledAt = (c, at) => styled.has(c) || styled.set(c, at);
for (const f of sheets) {
  const css = uncomment(read(f)).replace(/\{[^{}]*\}/g, '{}').replace(/\{[^{}]*\}/g, '{}');
  for (const m of css.matchAll(new RegExp(String.raw`\.(${NAME})`, 'g'))) if (!/^\d/.test(m[1])) styledAt(m[1], `${f}:${lineOf(css, m.index)}`);
}
for (const f of code) {
  const t = read(f);
  for (const [i, line] of t.split('\n').entries()) {
    if (!/[{,]/.test(line) || !/[;}]\s*[`'"+)]*[,;]?\s*$|\{[^{}]*:[^{}]*\}/.test(line)) continue;
    if (!/\{[^{}]*:[^{}]*[;}]/.test(line) && !/(^|[`'"\s])(html|:host|\[data-lab)[^{]*\{/.test(line)) continue;
    for (const sel of line.matchAll(/([^{}'"`]*)\{/g)) for (const m of sel[1].matchAll(new RegExp(String.raw`\.(${NAME})`, 'g'))) styledAt(m[1], `${f}:${i + 1}`);
  }
}

// What the script names: class="…", class: '…', className = '…', setAttribute('class', '…'), classList calls, and the
// .classes of a selector handed to querySelector, querySelectorAll, closest or matches. A name cut by ${…} is a
// prefix (tied-${kind}): the CSS classes that start with it count as named.
const named = new Map(); // class -> where
const prefixes = new Set();
const nameIn = (str, f, at) => {
  for (const tok of str.split(/\s+/)) {
    if (!tok) continue;
    const dyn = tok.indexOf('${');
    if (dyn >= 0) { if (dyn > 0) prefixes.add(tok.slice(0, dyn)); continue; }
    if (new RegExp(`^${NAME}$`).test(tok) && !named.has(tok)) named.set(tok, at);
  }
};
for (const f of code) {
  const t = read(f);
  const at = (i) => `${f}:${lineOf(t, i)}`;
  for (const m of t.matchAll(/\bclass(?:Name)?\s*[=:]\s*(["'`])((?:(?!\1)[^\\])*)\1/g)) nameIn(m[2].replace(/\$\{[^}]*\}/g, (e) => (/^\$\{[^}]*['"`][^}]*\}$/.test(e) ? ` ${[...e.matchAll(/['"`]([^'"`]*)['"`]/g)].map((q) => q[1]).join(' ')} ` : '${')), f, at(m.index));
  for (const m of t.matchAll(/setAttribute\(\s*'class'\s*,\s*(["'`])((?:(?!\1)[^\\])*)\1/g)) nameIn(m[2], f, at(m.index));
  for (const m of t.matchAll(/classList\.(add|remove|toggle|contains|replace)\(([^)]*)\)/g)) {
    const args = m[1] === 'add' || m[1] === 'remove' || m[1] === 'replace' ? [...m[2].matchAll(/(["'`])((?:(?!\1)[^\\])*)\1/g)] : [m[2].match(/^\s*(["'`])((?:(?!\1)[^\\])*)\1/)].filter(Boolean);
    for (const q of args) nameIn(q[2], f, at(m.index));
  }
  for (const m of t.matchAll(/(?:querySelector(?:All)?|closest|matches)\(\s*(["'`])((?:(?!\1)[^\\])*)\1/g)) {
    for (const c of m[2].split('${')[0].matchAll(new RegExp(String.raw`\.(${NAME})`, 'g'))) if (!named.has(c[1])) named.set(c[1], at(m.index));
  }
}

const problems = [];
const say = (what, fix) => problems.push(`✗ ${what}\n  → ${fix}`);
for (const [c, at] of named) {
  if (styled.has(c) || c in hooks) continue;
  say(`.${c} is named at ${at} but no CSS rule styles it`, `fix the name (a typo?), add the rule, or list it in ci/parts.json "classes" if only the script looks at it`);
}
// "Mentioned" is deliberately loose: the class's name anywhere in the script, the server or the tests (they look up hooks).
const others = [...walk('lib'), ...walk('test'), 'local.mjs'].filter((f) => /\.(m?js|ts|html)$/.test(f));
const allCode = [...code, ...others].map(read).join('\n');
const mentioned = (c) => new RegExp(`(?<![\\w-])${c.replace(/[-]/g, '\\-')}(?![\\w-])`).test(allCode);
// src/lab.css is the stylesheet pages the agent writes use too, so its classes need no use in the script.
for (const [c, at] of styled) {
  if (at.startsWith('src/lab.css:') || named.has(c) || [...prefixes].some((p) => c.startsWith(p)) || mentioned(c)) continue;
  say(`.${c} is styled at ${at} but the script never names it`, 'remove the rule, or use the class');
}
for (const c of Object.keys(hooks)) {
  if (styled.has(c)) say(`"${c}" in ci/parts.json "classes" has a CSS rule now`, 'take it off the list');
  else if (!named.has(c) && !mentioned(c)) say(`"${c}" in ci/parts.json "classes" is not used by the script`, 'take it off the list');
}

if (problems.length) {
  console.error(`Class check: ${problems.length} problem${problems.length === 1 ? '' : 's'}.\n\n${problems.join('\n\n')}\n`);
  process.exit(1);
}
console.log(`Class check: ${styled.size} styled classes, ${named.size} named by the script, every one on both sides (or listed as a script-only hook).`);
