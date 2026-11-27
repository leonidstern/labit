// Waste check for the page script and what builds it: a markdown report of what the metrics gate cannot see.
// Report-only: it exits 0 whatever it finds, except when the built comments.js is over its gzip cap (the same cap the
// gate holds, read from ci/metrics.mjs) or isn't built at all.
//
//   npm run waste                 builds the page script, then runs this
//   WASTE_OUT=report.md ...       where the report goes (default waste-report.md in the repo root; gitignored)
//   WASTE_MIN_TOKENS=30 WASTE_MAX_LINES=150 ...   thresholds
//
// Runs through `npx -p esbuild@<pinned> -p typescript@<pinned> node ci/waste.mjs` (package.json), so labit keeps zero
// dependencies. jscpd (duplicate blocks) is its own pinned npx call. Heuristics are marked as such in the report: they
// point at where to look, they are not verdicts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const JSCPD = 'jscpd@4.0.5';
const ROOT = process.cwd();
const OUT = path.resolve(ROOT, process.env.WASTE_OUT || 'waste-report.md');
const MIN_TOKENS = Number(process.env.WASTE_MIN_TOKENS || 30);
const MAX_LINES = Number(process.env.WASTE_MAX_LINES || 150);
const PAGE_SCRIPT = 'public/_lab/comments.js';

const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
const read = (f) => fs.readFileSync(f, 'utf8');
const list = (dir, re) => (fs.existsSync(path.join(ROOT, dir)) ? fs.readdirSync(path.join(ROOT, dir)).filter((f) => re.test(f)).sort().map((f) => `${dir}/${f}`) : []);
const CODE = ['src/comments.js', ...list('src/widget', /\.ts$/).filter((f) => !f.endsWith('.d.ts')), ...list('lib', /\.ts$/), 'local.mjs'].filter((f) => fs.existsSync(path.join(ROOT, f)));
const STYLES = 'src/widget/styles.css';

// A package put on PATH by `npx -p` (its API sits next to its bin), the way scripts/npx-tools.mjs finds esbuild.
const fromNpx = (pkg, bin = pkg) => {
  const dir = (process.env.PATH || '').split(path.delimiter).find((d) => fs.existsSync(path.join(d, bin)) && fs.existsSync(path.join(d, '..', pkg, 'package.json')));
  if (!dir) {
    console.error(`${pkg} not found: run this with npm run waste (npx -p esbuild@… -p typescript@… node ci/waste.mjs)`);
    process.exit(1);
  }
  return createRequire(path.join(dir, '..', pkg, 'package.json'))(pkg);
};
const esbuild = fromNpx('esbuild');
const ts = fromNpx('typescript', 'tsc');

const out = [];
const say = (s = '') => out.push(s);
const table = (head, rows) => {
  say(`| ${head.join(' | ')} |`);
  say(`| ${head.map(() => '---').join(' | ')} |`);
  for (const r of rows) say(`| ${r.map((c) => String(c).replace(/\|/g, '\\|')).join(' | ')} |`);
  say();
};
const kb = (n) => `${(n / 1000).toFixed(1)} KB`;
let failed = false;
/** Run one check; a check that breaks is reported, it doesn't stop the others. */
const section = async (title, fn) => {
  say(`## ${title}`);
  say();
  try { await fn(); } catch (e) { say(`The check itself failed: \`${String(e.message || e).split('\n')[0]}\``); say(); }
};

// ---- parse every file once --------------------------------------------------------------------------------------
const parsed = CODE.map((f) => {
  const text = read(path.join(ROOT, f));
  return { f, text, sf: ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, f.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS) };
});
const lineOf = (sf, pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
const bindingNames = (n) => (ts.isIdentifier(n) ? [n.text] : ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n) ? n.elements.flatMap((e) => (ts.isOmittedExpression(e) ? [] : bindingNames(e.name))) : []);

// Functions: name, size, what they call, which listeners they add.
const FN_KINDS = new Set([ts.SyntaxKind.FunctionDeclaration, ts.SyntaxKind.FunctionExpression, ts.SyntaxKind.ArrowFunction, ts.SyntaxKind.MethodDeclaration, ts.SyntaxKind.GetAccessor, ts.SyntaxKind.SetAccessor]);
// An array or string helper runs its callback right there, so that callback is part of the function around it.
// Anything else (a listener, a timer, a promise) runs later and is a function of its own.
const SYNC = new Set(['forEach', 'map', 'filter', 'sort', 'reduce', 'some', 'every', 'find', 'findIndex', 'flatMap', 'from', 'replace', 'replaceAll', 'toSorted']);
const calleeName = (c) => (ts.isIdentifier(c.expression) ? c.expression.text : ts.isPropertyAccessExpression(c.expression) ? c.expression.name.text : '');
const nameOf = (n, sf) => {
  if (n.name && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))) return n.name.text;
  const p = n.parent;
  if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  if ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) && p.name) return p.name.getText(sf);
  if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken) return p.left.getText(sf).replace(/^this\./, '');
  return null;
};
const inlined = (n) => {
  const p = n.parent;
  if (n.name) return false;
  if (ts.isParenthesizedExpression(p) && ts.isCallExpression(p.parent) && p.parent.expression === p) return true; // (() => {…})()
  return ts.isCallExpression(p) && p.arguments.includes(n) && SYNC.has(calleeName(p));
};
const fns = [];
for (const { f, sf } of parsed) {
  const walk = (node, owner) => {
    let cur = owner;
    if (FN_KINDS.has(node.kind) && !(owner && inlined(node))) {
      const name = nameOf(node, sf);
      cur = { name: name || `(anonymous, line ${lineOf(sf, node.getStart())})`, named: Boolean(name), file: f, line: lineOf(sf, node.getStart()), lines: lineOf(sf, node.getEnd()) - lineOf(sf, node.getStart()) + 1, calls: new Set(), listeners: [], locals: new Set(), params: new Set(), hasRemove: false };
      fns.push(cur);
      for (const p of node.parameters) for (const id of bindingNames(p.name)) cur.params.add(id);
    }
    if (cur) {
      if (ts.isCallExpression(node)) {
        const c = calleeName(node);
        if (c) cur.calls.add(c);
        if (c === 'removeEventListener') cur.hasRemove = true;
        if (c === 'addEventListener' && ts.isPropertyAccessExpression(node.expression)) {
          cur.listeners.push({ line: lineOf(sf, node.getStart()), target: node.expression.expression.getText(sf), type: node.arguments[0]?.getText(sf) || '?', safe: /signal|once/.test(node.arguments[2]?.getText(sf) || '') });
        }
      }
      if (ts.isVariableDeclaration(node)) for (const id of bindingNames(node.name)) cur.locals.add(id);
    }
    ts.forEachChild(node, (c) => walk(c, cur));
  };
  walk(sf, null);
}

const summary = [];
let capExceeded = false;

// ---- 1. gzip vs cap + top contributors --------------------------------------------------------------------------
await section('1. Page script size: gzip against its cap', async () => {
  if (!fs.existsSync(path.join(ROOT, PAGE_SCRIPT))) { say(`\`${PAGE_SCRIPT}\` is not built: run \`npm run build\` first (\`npm run waste\` does).`); failed = true; return; }
  const buf = fs.readFileSync(path.join(ROOT, PAGE_SCRIPT));
  const gz = zlib.gzipSync(buf, { level: 9 }).length;
  const cap = Number(/pageScriptGzipBytes:\s*\{[^}]*?max:\s*([\d_]+)/.exec(read(path.join(ROOT, 'ci/metrics.mjs')))?.[1].replace(/_/g, '')) || 80_000;
  capExceeded = gz > cap;
  say(`**${gz.toLocaleString('en')} B gzip -9** (${buf.length.toLocaleString('en')} B raw) against the gate's cap of ${cap.toLocaleString('en')} B: ${capExceeded ? `**over by ${(gz - cap).toLocaleString('en')} B, this run fails**` : `${(cap - gz).toLocaleString('en')} B (${(((cap - gz) / cap) * 100).toFixed(1)}%) of room`}.`);
  say();
  summary.push(['page script gzip', `${gz.toLocaleString('en')} / ${cap.toLocaleString('en')} B${capExceeded ? ' (OVER)' : ''}`]);
  // The same bundle scripts/build-widget.mjs makes (minified, stylesheet as minified text), with a metafile, before terser renames.
  const cssText = { name: 'css-text', setup(b) { b.onLoad({ filter: /\.css$/ }, async (a) => ({ contents: (await esbuild.transform(read(a.path), { loader: 'css', minify: true })).code, loader: 'text' })); } };
  const res = await esbuild.build({ entryPoints: [path.join(ROOT, 'src/comments.js')], bundle: true, format: 'iife', minify: true, write: false, metafile: true, logLevel: 'silent', plugins: [cssText], define: { 'globalThis.__LAB_DEBUG__': 'false', 'globalThis.__LAB_CO__': 'false' } });
  const inputs = Object.values(res.metafile.outputs)[0].inputs;
  const total = Object.values(inputs).reduce((a, i) => a + i.bytesInOutput, 0);
  const ratio = gz / buf.length;
  say('Biggest contributors. Minified bytes in the bundle; the gzip figure is an estimate (the file\'s bytes times the whole script\'s gzip ratio), not a measurement.');
  say();
  table(['file', 'minified', 'share', 'gzip est.'], Object.entries(inputs).map(([f, i]) => [f, i.bytesInOutput]).sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([f, b]) => [`\`${f}\``, kb(b), `${((b / total) * 100).toFixed(0)}%`, `~${kb(b * ratio)}`]));
});

// ---- 2. duplicated blocks (jscpd) ---------------------------------------------------------------------------------
await section(`2. Duplicated code blocks (jscpd, ${MIN_TOKENS}+ tokens)`, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waste-jscpd-'));
  try {
    execFileSync('npx', ['--yes', '-p', JSCPD, 'jscpd', '--min-tokens', String(MIN_TOKENS), '--min-lines', process.env.WASTE_MIN_LINES || '3', '--format', 'javascript,typescript', '--reporters', 'json', '--output', dir, '--silent', ...CODE], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('npm_'))) }); // not the outer npx's env
  } catch (e) { throw new Error(`jscpd: ${String(e.stderr || e.stdout || e.message).trim().split('\n').slice(-3).join(' ')}`); }
  const rep = JSON.parse(read(path.join(dir, 'jscpd-report.json')));
  const dups = rep.duplicates.map((d) => ({ a: d.firstFile, b: d.secondFile, lines: d.lines, tokens: d.tokens })).sort((x, y) => y.lines - x.lines);
  const t = rep.statistics.total;
  summary.push(['duplicated blocks', `${dups.length} (${t.duplicatedLines} lines, ${t.percentage}% of ${t.lines})`]);
  if (!dups.length) { say(`None at ${MIN_TOKENS}+ tokens.`); say(); return; }
  say(`${dups.length} block${dups.length === 1 ? '' : 's'}, ${t.duplicatedLines} duplicated lines (${t.percentage}% of ${t.lines} lines). Longest first. The same file twice means a copy inside one file.`);
  say();
  table(['lines', 'one copy', 'other copy'], dups.slice(0, 40).map((d) => [d.lines, `\`${d.a.name}:${d.a.start}-${d.a.end}\``, `\`${d.b.name}:${d.b.start}-${d.b.end}\``]));
  if (dups.length > 40) { say(`…and ${dups.length - 40} more (shorter).`); say(); }
});

// ---- 3. long functions --------------------------------------------------------------------------------------------
await section(`3. Functions over ${MAX_LINES} lines`, () => {
  // The wrapper that holds a whole file (comments.js's one big function) is not a function to split.
  const big = fns.filter((f) => f.lines > MAX_LINES && !(!f.named && f.lines > parsed.find((p) => p.f === f.file).sf.getLineAndCharacterOfPosition(parsed.find((p) => p.f === f.file).text.length).line * 0.9)).sort((a, b) => b.lines - a.lines);
  summary.push([`functions > ${MAX_LINES} lines`, String(big.length)]);
  if (!big.length) { say('None.'); say(); return; }
  say('A function inside another one counts in both (the big one includes it).');
  say();
  table(['lines', 'function', 'where'], big.map((f) => [f.lines, `\`${f.name}\``, `\`${f.file}:${f.line}\``]));
});

// ---- 4. CSS custom properties defined and never used -----------------------------------------------------------------
await section('4. CSS custom properties never used', () => {
  const sheet = read(path.join(ROOT, STYLES));
  const stripped = sheet.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const defs = new Map(); // name -> first line
  for (const m of stripped.matchAll(/(--[\w-]+)\s*:/g)) if (!defs.has(m[1])) defs.set(m[1], stripped.slice(0, m.index).split('\n').length);
  for (const m of stripped.matchAll(/@property\s+(--[\w-]+)/g)) if (!defs.has(m[1])) defs.set(m[1], stripped.slice(0, m.index).split('\n').length);
  // Where a property is used: var(--x) or a bare mention anywhere in the checked code or any widget stylesheet, except where
  // it is only being given a value (`--x:` in CSS, `setProperty('--x'` in code). Properties a host page sets for the widget to
  // read are used by var(), so they pass.
  const hay = [...parsed.map((p) => p.text), ...list('src/widget', /\.css$/).map((f) => read(path.join(ROOT, f))), ...(fs.existsSync(path.join(ROOT, 'src/lab.css')) ? [read(path.join(ROOT, 'src/lab.css'))] : [])].join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const unused = [];
  for (const [name, line] of defs) {
    const esc = name.replace(/[-]/g, '\\-');
    const all = [...hay.matchAll(new RegExp(`${esc}(?![\\w-])`, 'g'))];
    const asDef = [...hay.matchAll(new RegExp(`(${esc}\\s*:(?!:))|(setProperty\\(\\s*['"\`]${esc}['"\`])|(@property\\s+${esc})`, 'g'))];
    if (all.length - asDef.length <= 0) unused.push([name, line, all.length]);
  }
  summary.push(['unused CSS custom properties', `${unused.length} of ${defs.size}`]);
  if (!unused.length) { say(`None of the ${defs.size} defined in \`${STYLES}\`.`); say(); return; }
  say(`${unused.length} of ${defs.size} custom properties defined in \`${STYLES}\` are never read (no \`var()\`, no \`getPropertyValue\`, no mention) in the checked code or widget styles. Heuristic: names built by string concatenation in code are missed, so check before deleting.`);
  say();
  table(['property', 'defined at', 'times defined'], unused.map(([n, l, c]) => [`\`${n}\``, `\`${STYLES}:${l}\``, c]));
});

// ---- 5. listeners added in render paths ---------------------------------------------------------------------------
await section('5. Listeners added in render paths without removal (heuristic)', () => {
  // Roots: functions that run on every redraw. Everything they call, by name, anywhere in the checked files, is on the path.
  const ROOT_RE = /^(render|rerender|redraw|repaint|draw[A-Z]\w*|paint[A-Z]?\w*|refresh[A-Z]?\w*)$/;
  const byName = new Map();
  for (const f of fns) if (f.named) (byName.get(f.name.split('.').pop()) || byName.set(f.name.split('.').pop(), []).get(f.name.split('.').pop())).push(f);
  const via = new Map(); // fn -> the chain that reaches it
  const queue = [];
  for (const f of fns) if (f.named && ROOT_RE.test(f.name)) { via.set(f, [f.name]); queue.push(f); }
  while (queue.length) {
    const f = queue.shift();
    for (const c of f.calls) for (const g of byName.get(c) || []) if (!via.has(g)) { via.set(g, [...via.get(f), g.name]); queue.push(g); }
  }
  const found = [];
  for (const [f, chain] of via) {
    if (f.hasRemove) continue;
    for (const l of f.listeners) {
      if (l.safe) continue;
      const base = l.target.replace(/\?/g, '').split(/[.[(]/)[0];
      // A node this function made (or was handed) dies with the redraw; the page, its window and anything kept outside outlive it.
      if (f.locals.has(base) || f.params.has(base)) continue;
      found.push({ f, l, chain });
    }
  }
  summary.push(['listeners in render paths', String(found.length)]);
  if (!found.length) { say(`None. Render roots found: ${[...via.keys()].filter((f) => ROOT_RE.test(f.name)).length}, functions reached from them: ${via.size}.`); say(); return; }
  say(`${found.length} \`addEventListener\` call${found.length === 1 ? '' : 's'} on something that outlives the redraw (window, document, a variable or property kept outside the function), in a function a redraw reaches, with no \`removeEventListener\`, \`once\` or \`signal\` in sight. Reached by name, so a same-named function elsewhere can be a false lead.`);
  say();
  table(['where', 'adds', 'on', 'reached through'], found.map(({ f, l, chain }) => [`\`${f.file}:${l.line}\``, l.type, `\`${l.target}\``, chain.slice(0, 5).map((c) => `\`${c}\``).join(' → ')]));
});

// ---- 6. state keys written and never read ---------------------------------------------------------------------------
await section('6. State keys written but never read (S.x and W.x, heuristic)', () => {
  // S is the widget's state (`S.x` in comments.js, `W.S.x` or the module's own `S = W.S` elsewhere); W is what the parts get
  // from comments.js (`W.x`). A key set somewhere and read nowhere is state nothing looks at.
  const stats = { S: new Map(), W: new Map() }; // key -> { writes: [..], reads: n }
  const note = (kind, key, write, where) => {
    const m = stats[kind];
    if (!m.has(key)) m.set(key, { writes: [], reads: 0 });
    if (write) m.get(key).writes.push(where); else m.get(key).reads++;
  };
  const dynamic = { S: 0, W: 0 };
  for (const { f, sf, text } of parsed) {
    const sIsState = f === 'src/comments.js' || /\bS = W\.S\b/.test(text);
    const kindOf = (e) => {
      if (ts.isIdentifier(e)) return e.text === 'S' && sIsState ? 'S' : e.text === 'W' && f !== 'src/widget/frame.ts' ? 'W' : null;
      if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'W' && e.name.text === 'S') return 'S';
      return null;
    };
    const walk = (n) => {
      if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
        const kind = kindOf(n.expression);
        if (kind) {
          let key = null;
          if (ts.isPropertyAccessExpression(n)) key = n.name.text;
          else if (ts.isStringLiteralLike(n.argumentExpression)) key = n.argumentExpression.text;
          else dynamic[kind]++;
          if (key) {
            const p = n.parent;
            const write = (ts.isBinaryExpression(p) && p.left === n && p.operatorToken.kind === ts.SyntaxKind.EqualsToken) || (ts.isBinaryExpression(p) && p.left === n && [ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken].includes(p.operatorToken.kind) && ts.isExpressionStatement(p.parent)) || (ts.isDeleteExpression(p));
            note(kind, key, write, `${f}:${lineOf(sf, n.getStart())}`);
          }
        }
      }
      // const { a, b } = S;  reads a and b
      if (ts.isVariableDeclaration(n) && n.initializer && ts.isObjectBindingPattern(n.name)) {
        const kind = kindOf(n.initializer);
        if (kind) for (const e of n.name.elements) note(kind, (e.propertyName || e.name).getText(sf), false, '');
      }
      // initial values: const W = { key: …, get key() {…} } in comments.js
      if (f === 'src/comments.js' && ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'W' && n.initializer && ts.isObjectLiteralExpression(n.initializer)) {
        for (const p of n.initializer.properties) if (p.name) note('W', p.name.getText(sf), true, `${f}:${lineOf(sf, p.getStart())}`);
      }
      // Object.assign(S, {…}) writes those keys
      if (ts.isCallExpression(n) && n.expression.getText(sf) === 'Object.assign' && n.arguments[0] && kindOf(n.arguments[0]) && n.arguments[1] && ts.isObjectLiteralExpression(n.arguments[1])) {
        for (const p of n.arguments[1].properties) if (p.name) note(kindOf(n.arguments[0]), p.name.getText(sf), true, `${f}:${lineOf(sf, n.getStart())}`);
      }
      ts.forEachChild(n, walk);
    };
    walk(sf);
  }
  let total = 0;
  for (const kind of ['S', 'W']) {
    const dead = [...stats[kind]].filter(([, v]) => v.writes.length && !v.reads).map(([k, v]) => [`\`${kind}.${k}\``, v.writes.length, `\`${v.writes[0]}\``]);
    total += dead.length;
    say(`**${kind}**: ${stats[kind].size} keys seen, ${dead.length} written and never read.${dynamic[kind] ? ` (${dynamic[kind]} dynamic \`${kind}[…]\` accesses are not followed.)` : ''}`);
    say();
    if (dead.length) table(['key', 'writes', 'first write'], dead);
  }
  summary.push(['state keys written, never read', String(total)]);
});

// ---- report --------------------------------------------------------------------------------------------------------
const head = [];
head.push('# Page-script waste report', '');
const sha = (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return 'unknown'; } })();
head.push(`${process.env.GITHUB_REF_NAME ? `\`${process.env.GITHUB_REF_NAME}\` at ` : ''}\`${sha}\`. Report-only: only a page script over its gzip cap fails the run. Heuristic findings say where to look, not what to delete. Checked ${CODE.length} files (src/comments.js, src/widget/*.ts, ${STYLES}, lib/*.ts, local.mjs).`, '');
head.push('| check | result |', '| --- | --- |', ...summary.map(([k, v]) => `| ${k} | ${v} |`), '');
const report = `${head.join('\n')}\n${out.join('\n')}\n`;
fs.writeFileSync(OUT, report);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
console.log(report);
console.log(`report: ${rel(OUT)}`);
if (capExceeded) console.error('page script is over its gzip cap');
process.exit(capExceeded || failed ? 1 : 0);
