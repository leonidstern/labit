// What the browsers can do natively that labit could use (Leo, 20 Nov: "to check if something native is available on
// safari or chromium and can be used"). Each feature is probed in Safari's engine (WebKit) and Chrome's, and the
// widget's source is searched for it. The report lists, for each feature:
// - in both engines and not used yet: a candidate (the browser could do what a script does now);
// - used, but missing in an engine: that engine gets labit's fallback, or nothing. This one fails the check, so a feature
//   labit relies on can't go missing from Safari or Chrome unnoticed.
// Run: node ci/native.mjs (needs playwright; NODE_PATH can point at a node_modules that has it). ENGINES=webkit,chromium.
// In CI the table goes to the job's summary ($GITHUB_STEP_SUMMARY).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pw = (() => {
  for (const paths of [undefined, (process.env.NODE_PATH || '').split(path.delimiter)]) {
    try {
      return require(require.resolve('playwright', paths && { paths }));
    } catch {}
  }
  console.log('playwright is not installed: skipped');
  process.exit(0);
})();

// probe: an expression run in a blank page, true when the engine has it. use: what it looks like in labit's source.
// Only things that could replace a script or a workaround in a widget like this one; nothing the widget can't use.
const FEATURES = [
  { name: 'CSS anchor positioning', probe: `CSS.supports('anchor-name: --a')`, use: /anchor-name|position-anchor/, what: 'tie pins and cards to an element: no script on scroll' },
  { name: 'position-try fallbacks', probe: `CSS.supports('position-try-fallbacks: flip-block')`, use: /position-try/, what: 'a card flips above its pin when there is no room' },
  { name: 'position-visibility', probe: `CSS.supports('position-visibility: anchors-visible')`, use: /position-visibility/, what: 'a tied pin hides when its element is scrolled out of a box' },
  { name: 'anchor-size()', probe: `CSS.supports('width: anchor-size(width)')`, use: /anchor-size\(/, what: 'size a box from the element it is tied to' },
  { name: 'popover', probe: `'showPopover' in HTMLElement.prototype`, use: /popover/, what: 'menus in the top layer, closed by a press elsewhere or Esc' },
  { name: 'popover="hint"', probe: `(() => { const d = document.createElement('div'); d.popover = 'hint'; return d.popover === 'hint'; })()`, use: /popover\s*=\s*['"]hint|'hint'/, what: 'tooltips that do not close an open menu' },
  { name: 'interest invokers (interestfor)', probe: `'interestForElement' in HTMLButtonElement.prototype`, use: /interestfor/i, what: 'hover / focus cards with no script (a preview of a pin)' },
  { name: 'invoker commands (commandfor)', probe: `'commandForElement' in HTMLButtonElement.prototype`, use: /commandfor/i, what: 'buttons that open and close popovers and dialogs with no script' },
  { name: 'dialog closedby', probe: `'closedBy' in HTMLDialogElement.prototype`, use: /closedby/i, what: 'a dialog closed by a press outside, with no script' },
  { name: 'CloseWatcher', probe: `'CloseWatcher' in window`, use: /CloseWatcher/, what: 'Esc and Android back close the open sheet' },
  { name: 'field-sizing', probe: `CSS.supports('field-sizing: content')`, use: /field-sizing/, what: 'a text box that grows with its words' },
  { name: 'scrollend', probe: `'onscrollend' in window`, use: /scrollend/, what: 'when a scroll ended, without a timer' },
  { name: 'Navigation API', probe: `'navigation' in window`, use: /currententrychange|navigation\.addEventListener/, what: 'route changes without patching history' },
  { name: 'view transitions', probe: `'startViewTransition' in document`, use: /startViewTransition/, what: 'animate between two states of the widget' },
  { name: 'scroll-driven animations', probe: `CSS.supports('animation-timeline: scroll()')`, use: /animation-timeline/, what: 'edges and bars that follow a scroll, with no script' },
  { name: 'scroll-state container queries', probe: `CSS.supports('container-type: scroll-state')`, use: /scroll-state/, what: 'style a bar when it is stuck or can scroll' },
  { name: '@starting-style', probe: `'CSSStartingStyleRule' in window`, use: /@starting-style/, what: 'enter animations with no script' },
  { name: 'transition-behavior: allow-discrete', probe: `CSS.supports('transition-behavior: allow-discrete')`, use: /allow-discrete/, what: 'exit animations for display and the top layer' },
  { name: 'interpolate-size', probe: `CSS.supports('interpolate-size: allow-keywords')`, use: /interpolate-size/, what: 'animate to and from height: auto' },
  { name: 'calc-size()', probe: `CSS.supports('height: calc-size(auto, size)')`, use: /calc-size\(/, what: 'animate to and from height: auto, one property' },
  { name: 'content-visibility', probe: `CSS.supports('content-visibility: auto')`, use: /content-visibility/, what: 'lay out only what is near the screen (a long chat)' },
  { name: 'CSS Highlight API', probe: `'highlights' in CSS`, use: /CSS\.highlights|::highlight/, what: 'paint words without wrapping them in elements' },
  { name: 'text-box trim', probe: `CSS.supports('text-box: trim-both cap alphabetic')`, use: /text-box/, what: 'centre text on its letters, not its line box' },
  { name: 'text-wrap: pretty', probe: `CSS.supports('text-wrap: pretty')`, use: /text-wrap/, what: 'no lone last word in a comment' },
  { name: 'corner-shape: squircle', probe: `CSS.supports('corner-shape: squircle')`, use: /corner-shape/, what: 'Apple-style continuous corners' },
  { name: 'shape()', probe: `CSS.supports('clip-path: shape(from 0 0, line to 10px 10px)')`, use: /shape\(from/, what: 'responsive shapes in CSS' },
  { name: 'light-dark()', probe: `CSS.supports('color: light-dark(red, blue)')`, use: /light-dark\(/, what: 'one token for both themes' },
  { name: '@scope', probe: `'CSSScopeRule' in window`, use: /@scope/, what: 'styles kept to one part' },
  { name: 'CSS if()', probe: `CSS.supports('color: if(style(--x: 1): red; else: blue)')`, use: /:\s*if\(/, what: 'a value chosen by a custom property, with no class' },
  { name: 'sibling-index()', probe: `CSS.supports('width: calc(sibling-index() * 1px)')`, use: /sibling-index\(/, what: 'staggered animations with no --i set by script' },
  { name: 'typed attr()', probe: `CSS.supports('width: attr(data-w type(<length>))')`, use: /attr\([^)]*type\(/, what: 'sizes and colours from data- attributes' },
  { name: 'customizable select', probe: `CSS.supports('appearance: base-select')`, use: /base-select/, what: 'a styled select with no custom menu' },
  { name: 'moveBefore()', probe: `'moveBefore' in Element.prototype`, use: /moveBefore/, what: 'move a node and keep its state (focus, an iframe)' },
  { name: 'hidden="until-found"', probe: `'onbeforematch' in window`, use: /until-found|beforematch/, what: 'folded text that find-in-page opens' },
  { name: 'scheduler.yield()', probe: `'scheduler' in window && 'yield' in scheduler`, use: /scheduler\.yield/, what: 'long work that lets a tap through' },
  { name: 'EditContext', probe: `'EditContext' in window`, use: /EditContext/, what: 'own text editing on any element' },
];

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const files = [];
for (const dir of ['src']) {
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|js|css)$/.test(e.name)) files.push(p);
    }
  };
  walk(path.join(ROOT, dir));
}
// Comments say what a feature does without using it: only code counts.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
const source = files.map((f) => strip(fs.readFileSync(f, 'utf8'))).join('\n');

const engines = (process.env.ENGINES || 'webkit,chromium').split(',');
const has = {};
const versions = {};
for (const eng of engines) {
  const browser = await pw[eng].launch();
  try {
    versions[eng] = browser.version();
    const p = await browser.newPage();
    await p.setContent('<!doctype html><title>probe</title>');
    has[eng] = await p.evaluate((probes) => probes.map((code) => { try { return Boolean((0, eval)(code)); } catch { return false; } }), FEATURES.map((f) => f.probe));
  } finally {
    await browser.close();
  }
}

const rows = FEATURES.map((f, i) => ({ ...f, used: f.use.test(source), in: Object.fromEntries(engines.map((e) => [e, has[e][i]])) }));
const yes = (b) => (b ? 'yes' : '—');
const label = { webkit: 'Safari (WebKit)', chromium: 'Chrome (Chromium)' };
const all = (r) => engines.every((e) => r.in[e]);
const candidates = rows.filter((r) => !r.used && all(r));
const missing = rows.filter((r) => r.used && !all(r));
const lines = [
  '## Native features labit could use',
  '',
  engines.map((e) => `${label[e] || e} ${versions[e]}`).join(' · '),
  '',
  `| feature | ${engines.map((e) => label[e] || e).join(' | ')} | labit uses it | what for |`,
  `| --- | ${engines.map(() => '---').join(' | ')} | --- | --- |`,
  ...rows.map((r) => `| ${r.name} | ${engines.map((e) => yes(r.in[e])).join(' | ')} | ${yes(r.used)} | ${r.what} |`),
  '',
  `**In ${engines.length > 1 ? 'both' : 'the'} engine${engines.length > 1 ? 's' : ''}, not used yet (${candidates.length}):** ${candidates.map((r) => r.name).join(', ') || 'none'}`,
  '',
  `**Used, but missing in an engine (${missing.length}):** ${missing.map((r) => `${r.name} (no ${engines.filter((e) => !r.in[e]).join(', ')})`).join(', ') || 'none'}`,
];
const report = lines.join('\n');
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
process.exit(missing.length ? 1 : 0);
