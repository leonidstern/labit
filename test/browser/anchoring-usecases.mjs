// Trying to lose pins on purpose (Leo, 27 Nov: "make tests to lost pins intentionally on usecases that user could do"):
// the edits a person or an agent makes to a real page, one at a time, against the three kinds of pin there are:
//   person  a pin a person put on the page (a click: its words, company, section, fingerprint),
//   agent   a pin the agent made from a selector (labit pin) that a browser drew once and filled in (fillAt),
//   placed  a pin the agent placed with labit pin move (a selector and a spot, nothing else; resolved pins stay so).
// Each case pins one thing on a page built like the sites labit is used on (sections with ids, Astro's data-astro-cid
// hashes, React's generated ids, utility classes), makes one edit, and asks anchoring.ts where the pin is now:
// R on its element, W on another element with nothing said (the worst), L lost (shown off the page, or on another
// element but shown as unsure or changed: the agent is told).
// A deleted element must be L, anything else R. Cases that fail today are in KNOWN: listed, they are still run and
// printed, and the run fails on any other failure, or on a W where an L is listed. No lab: anchoring.ts on its own.
// Run: node test/browser/anchoring-usecases.mjs  (needs playwright; NODE_PATH can point at one). USECASES_KNOWN=print
// prints the list this run would need.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { playwright, engines, tmp, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });
const WIDGET = fileURLToPath(new URL('../../src/widget/', import.meta.url));
const TMP = tmp('labit-usecases-');
const OUT = path.join(TMP, 'anchoring.js');
execFileSync('npx', ['--yes', 'esbuild@0.25.12', path.join(WIDGET, 'anchoring.ts'), '--bundle', '--format=iife', '--global-name=A', `--outfile=${OUT}`, '--log-level=warning']);
const BUNDLE = fs.readFileSync(OUT, 'utf8');

// A landing page as an Astro site renders it: sections with ids, every element with its component's data-astro-cid,
// a pricing grid of look-alike cards, a dialog with React-style generated ids, a video tile with no words.
const cid = (c) => `data-astro-cid-${c}=""`;
const LANDING = `
<header class="top" ${cid('h1x2')}><a class="logo" href="/" ${cid('h1x2')}>labit</a><nav ${cid('h1x2')}><a href="#how" ${cid('h1x2')}>How it works</a><a href="#pricing" ${cid('h1x2')}>Pricing</a></nav></header>
<main ${cid('m9k3')}>
  <section id="hero" class="py-24 bg-white" ${cid('m9k3')}><h1 class="text-5xl font-bold" ${cid('m9k3')}>Comments on the page, for your agent</h1>
    <p class="lede text-lg" ${cid('m9k3')}>Pin a note where it applies. Your coding agent reads it and fixes the page while you watch.</p>
    <button class="btn btn-primary" ${cid('m9k3')}>Start a lab</button></section>
  <section id="video" class="py-16" ${cid('v7q1')}><h2 ${cid('v7q1')}>Videos and animations</h2>
    <div class="sv" ${cid('v7q1')}><div class="sv-vid" style="width:260px;height:160px;background:#ddd" ${cid('v7q1')}><i class="sv-ball" ${cid('v7q1')}></i></div><p class="sv-cap" ${cid('v7q1')}>A ball that bounces, paused on a frame</p></div></section>
  <section id="how" class="py-16" ${cid('w2e8')}><h2 ${cid('w2e8')}>How it works</h2>
    <ol class="steps" ${cid('w2e8')}><li ${cid('w2e8')}>Start labit in your project folder.</li><li ${cid('w2e8')}>Click anything on the page and say what to change.</li><li ${cid('w2e8')}>Your agent answers in the thread and edits the files.</li></ol></section>
  <section id="pricing" class="py-16" ${cid('p4r5')}><h2 ${cid('p4r5')}>Pricing</h2>
    <div class="grid grid-cols-3 gap-4" ${cid('p4r5')}>
      <div class="card rounded-xl p-6" ${cid('p4r5')}><h3 ${cid('p4r5')}>Free</h3><p class="price" ${cid('p4r5')}>$0</p><button class="btn" ${cid('p4r5')}>Choose</button></div>
      <div class="card rounded-xl p-6" ${cid('p4r5')}><h3 ${cid('p4r5')}>Team</h3><p class="price" ${cid('p4r5')}>$12</p><button class="btn" ${cid('p4r5')}>Choose</button></div>
      <div class="card rounded-xl p-6" ${cid('p4r5')}><h3 ${cid('p4r5')}>Company</h3><p class="price" ${cid('p4r5')}>$40</p><button class="btn" ${cid('p4r5')}>Choose</button></div>
    </div></section>
  <div role="dialog" id="base-ui-_r_15_" class="dlg" ${cid('d3d3')}><p id="_r_16_" class="dlg-text" ${cid('d3d3')}>Your trial ends in three days. Pick a plan to keep your pins.</p></div>
</main>
<footer class="foot" ${cid('f0f0')}><p ${cid('f0f0')}>Made on a Mac. No account needed.</p></footer>`;

// The things to pin: a selector to the thing as the page has it, and the selector an agent would write for it.
const LANDING_TARGETS = {
  heading: { at: '#hero h1', agent: '#hero h1' },
  lede: { at: '#hero .lede', agent: '#hero .lede' },
  button: { at: '#hero .btn-primary', agent: '#hero .btn-primary' },
  video: { at: '.sv-vid', agent: '#video .sv-vid' },
  step: { at: '#how li:nth-of-type(2)', agent: '#how .steps li:nth-child(2)' },
  card: { at: '#pricing .card:nth-of-type(2)', agent: '#pricing .card:nth-child(2)' },
  price: { at: '#pricing .card:nth-of-type(2) .price', agent: '#pricing .card:nth-child(2) .price' },
  dialog: { at: '#_r_16_', agent: '[role=dialog] p' },
};


// An app's dashboard as React with CSS-in-JS renders it: generated class hashes, live numbers that tick, a table of
// orders, a "3 min ago" stamp, a sidebar.
const DASHBOARD = `
<div class="css-k2j4h1 app"><aside class="css-a81b2c sidebar"><a class="css-n1n1n1 nav" href="/">Overview</a><a class="css-n1n1n1 nav" href="/orders">Orders</a><a class="css-n1n1n1 nav" href="/settings">Settings</a></aside>
<main class="css-m3m3m3"><h1 class="css-t1t1t1">Overview</h1><p class="css-s5s5s5 stamp">Updated 3 min ago</p>
  <div class="css-g7g7g7 kpis"><div class="css-c9c9c9 kpi"><span class="css-l1l1l1">Revenue</span><b class="css-v2v2v2">$12,340</b></div><div class="css-c9c9c9 kpi"><span class="css-l1l1l1">Active users</span><b class="css-v2v2v2">1,204</b></div><div class="css-c9c9c9 kpi"><span class="css-l1l1l1">Refunds</span><b class="css-v2v2v2">7</b></div></div>
  <table class="css-tb1tb1"><thead><tr><th>Order</th><th>Customer</th><th>Amount</th><th>Status</th></tr></thead><tbody>
    <tr><td>#1041</td><td>Ada Byron</td><td>$120.00</td><td><span class="css-bd1bd1 badge">Paid</span></td></tr>
    <tr><td>#1042</td><td>Alan Turing</td><td>$89.50</td><td><span class="css-bd1bd1 badge">Pending</span></td></tr>
    <tr><td>#1043</td><td>Grace Hopper</td><td>$240.00</td><td><span class="css-bd1bd1 badge">Paid</span></td></tr>
  </tbody></table></main></div>`;
const DASHBOARD_TARGETS = {
  kpi: { at: '.kpi:nth-of-type(2)', agent: '.kpis .kpi:nth-child(2)' },
  number: { at: '.kpi:nth-of-type(1) b', agent: '.kpi:first-child b' },
  stamp: { at: '.stamp', agent: '.stamp' },
  row: { at: 'tbody tr:nth-of-type(2)', agent: 'tbody tr:nth-child(2)' },
  badge: { at: 'tbody tr:nth-of-type(2) .badge', agent: 'tbody tr:nth-child(2) .badge' },
  navlink: { at: '.sidebar a:nth-of-type(3)', agent: '.sidebar a[href="/settings"]' },
};
// Docs as a static site generator writes them: heading ids made from their words, code blocks, a callout.
const DOCS = `
<article class="prose"><h1 id="labit">labit</h1>
<h2 id="getting-started">Getting started</h2><p>Install it with npm and start a lab in your project folder.</p>
<pre><code>npx @leonidstern/labit@0.8.5</code></pre>
<div class="callout note"><p>Needs Node 22 or newer.</p></div>
<h2 id="pins">Pins</h2><p>Click anything to leave a pin. Your agent answers in its thread.</p>
<h2 id="boards">Boards</h2><p>Put pages side by side at the sizes you design for.</p></article>`;
const DOCS_TARGETS = {
  h2: { at: '#pins', agent: '#pins' },
  para: { at: '#getting-started + p', agent: '#getting-started + p' },
  code: { at: 'pre code', agent: 'pre code' },
  callout: { at: '.callout', agent: '.callout.note' },
};
// A sign-up form: labels, inputs, a button, a line of small print.
const FORM = `
<form class="signup"><h2>Create your account</h2>
<label for="em">Email</label><input id="em" type="email" placeholder="you@example.com">
<label for="pw">Password</label><input id="pw" type="password" placeholder="At least 8 characters">
<button type="submit" class="submit">Sign up</button><p class="small">By signing up you agree to the terms.</p></form>`;
const FORM_TARGETS = {
  input: { at: '#em', agent: '#em' },
  label: { at: 'label[for=pw]', agent: 'label[for=pw]' },
  submit: { at: '.submit', agent: 'form .submit' },
  small: { at: '.small', agent: '.signup .small' },
};
// A gallery: pictures with hashed file names, captions, as an image pipeline writes them.
const GALLERY = `
<section class="gallery"><h2>Work</h2>
<figure><img src="a.3f9c1e.jpg" alt="A lighthouse at dusk" width="200" height="140" style="background:#cde"><figcaption>Lighthouse</figcaption></figure>
<figure><img src="b.77ab02.jpg" alt="A red tram on a hill" width="200" height="140" style="background:#dce"><figcaption>Tram</figcaption></figure>
<figure><img src="c.e1d4aa.jpg" alt="Snow on a quiet street" width="200" height="140" style="background:#edc"><figcaption>Snow</figcaption></figure></section>`;
const GALLERY_TARGETS = {
  img: { at: 'figure:nth-of-type(2) img', agent: 'img[alt^="A red tram"]' },
  caption: { at: 'figure:nth-of-type(3) figcaption', agent: 'figure:nth-child(4) figcaption' },
};
// A menu that is open: items with words, one dangerous.
const MENU = `
<div class="menu" role="menu"><button role="menuitem" class="item">Rename</button><button role="menuitem" class="item">Duplicate</button><button role="menuitem" class="item">Move to…</button><button role="menuitem" class="item danger">Delete</button></div>`;
const MENU_TARGETS = {
  danger: { at: '.danger', agent: '.menu .danger' },
  item: { at: '.item:nth-of-type(2)', agent: '[role=menu] .item:nth-child(2)' },
};

// Edits that belong to one kind of page, as `(t) => …` like the rest below.
const SCENE_EDITS = {
  dashboard: {
    'numbers-tick': `(t) => { document.querySelectorAll('.kpi b').forEach((b, i) => (b.textContent = ['$12,612', '1,231', '8'][i])); document.querySelectorAll('tbody td:nth-child(3)').forEach((d) => (d.textContent = d.textContent.replace(/\\d/, '9'))); return t; }`,
    'stamp-tick': `(t) => { document.querySelector('.stamp').textContent = 'Updated just now'; return t; }`,
    'rows-sorted': `(t) => { const b = document.querySelector('tbody'); [...b.rows].reverse().forEach((r) => b.append(r)); return t; }`,
    'row-added-top': `(t) => { const b = document.querySelector('tbody'); const r = b.rows[0].cloneNode(true); r.cells[0].textContent = '#1044'; r.cells[1].textContent = 'Katherine Johnson'; b.prepend(r); return t; }`,
    'status-changed': `(t) => { document.querySelectorAll('.badge')[1].textContent = 'Refunded'; return t; }`,
    'class-hashes-new': `(t) => { for (const e of document.querySelectorAll('[class]')) e.className = e.className.replace(/css-(\\w+)/g, (m, h) => 'css-' + h.split('').reverse().join('')); return t; }`,
    'next-page': `(t) => { if (!t.matches('tr')) return false; const b = document.querySelector('tbody'); [...b.rows].forEach((r, i) => { r.cells[0].textContent = '#10' + (51 + i); r.cells[1].textContent = ['Hedy Lamarr', 'Linus Pauling', 'Rosalind Franklin'][i]; }); return null; }`,
  },
  docs: {
    'heading-renamed': `(t) => { const h = document.getElementById('getting-started'); h.textContent = 'Get started'; h.id = 'get-started'; return t; }`,
    'version-bumped': `(t) => { const c = document.querySelector('pre code'); c.textContent = c.textContent.replace('0.8.5', '0.9.0'); return t; }`,
    'translated': `(t) => { const de = { 'Getting started': 'Erste Schritte', 'Install it with npm and start a lab in your project folder.': 'Mit npm installieren und ein Lab im Projektordner starten.', 'Needs Node 22 or newer.': 'Braucht Node 22 oder neuer.', 'Pins': 'Pins', 'Click anything to leave a pin. Your agent answers in its thread.': 'Klicke irgendwo für einen Pin. Dein Agent antwortet im Thread.', 'Boards': 'Boards', 'Put pages side by side at the sizes you design for.': 'Seiten nebeneinander in deinen Größen.' }; for (const e of document.querySelectorAll('h2, p')) if (de[e.textContent]) e.textContent = de[e.textContent]; return t; }`,
    'section-inserted': `(t) => { document.getElementById('pins').insertAdjacentHTML('beforebegin', '<h2 id="config">Config</h2><p>Settings live in labit.json.</p>'); return t; }`,
  },
  form: {
    'error-shown': `(t) => { document.querySelector('.submit').insertAdjacentHTML('beforebegin', '<p class="error">That email is already in use.</p>'); return t; }`,
    'button-renamed': `(t) => { document.querySelector('.submit').textContent = 'Create account'; return t; }`,
    'fields-reordered': `(t) => { const f = document.querySelector('form'); const pw = [f.querySelector('label[for=pw]'), f.querySelector('#pw')]; f.querySelector('label[for=em]').before(...pw); return t; }`,
    'placeholder-changed': `(t) => { document.querySelector('#em').placeholder = 'name@company.com'; return t; }`,
  },
  gallery: {
    'pictures-reordered': `(t) => { const g = document.querySelector('.gallery'); [...g.querySelectorAll('figure')].reverse().forEach((f) => g.append(f)); return t; }`,
    'files-rehashed': `(t) => { document.querySelectorAll('img').forEach((i) => (i.src = i.getAttribute('src').replace(/\\.\\w{6}\\./, '.0a0b0c.'))); return t; }`,
    'picture-wrapped': `(t) => { document.querySelectorAll('img').forEach((i) => { const p = document.createElement('picture'); i.replaceWith(p); p.append(i); }); return t; }`,
    'picture-added-first': `(t) => { document.querySelector('.gallery h2').insertAdjacentHTML('afterend', '<figure><img src="d.112233.jpg" alt="A boat in fog" width="200" height="140" style="background:#cce"><figcaption>Boat</figcaption></figure>'); return t; }`,
  },
  menu: {
    'item-added-top': `(t) => { document.querySelector('.menu').insertAdjacentHTML('afterbegin', '<button role="menuitem" class="item">Open</button>'); return t; }`,
    'icons-added': `(t) => { document.querySelectorAll('.item').forEach((b) => b.insertAdjacentHTML('afterbegin', '<svg width="12" height="12" aria-hidden="true"><rect width="12" height="12"/></svg> ')); return t; }`,
    'wording-changed': `(t) => { document.querySelector('.danger').textContent = 'Delete project'; return t; }`,
  },
};
const SCENES = [
  { name: 'landing', page: LANDING, targets: LANDING_TARGETS, edits: {} },
  { name: 'dashboard', page: DASHBOARD, targets: DASHBOARD_TARGETS, edits: SCENE_EDITS.dashboard },
  { name: 'docs', page: DOCS, targets: DOCS_TARGETS, edits: SCENE_EDITS.docs },
  { name: 'form', page: FORM, targets: FORM_TARGETS, edits: SCENE_EDITS.form },
  { name: 'gallery', page: GALLERY, targets: GALLERY_TARGETS, edits: SCENE_EDITS.gallery },
  { name: 'menu', page: MENU, targets: MENU_TARGETS, edits: SCENE_EDITS.menu },
];

// The edits, each a function run in the page on its DOM: `t` is the pinned element. It returns the element the pin
// belongs on after the edit (null: gone, the pin must be lost), or false when the edit does not apply to this target.
// Done with DOM moves where a site's build would keep the element, so the right answer is the same node.
const EDITS = {
  none: '(t) => t',
  // Ids: a section renamed (#video to #motion), React's generated ids on the next render, an id added to the element.
  'section-id-renamed': `(t) => { const s = t.closest('section[id]'); if (!s) return false; s.id = s.id + '-v2'; return t; }`,
  'generated-ids-new': `(t) => { const d = document.querySelector('.dlg'); if (!d || !d.contains(t)) return false; d.id = 'base-ui-_r_2a_'; d.querySelector('p').id = '_r_2b_'; return t; }`,
  'id-added': '(t) => { t.id = "the-thing"; return t; }',
  // Classes: Astro's cid hashes on the next build, utility classes reworked, a class renamed on the element.
  'astro-rebuild': `(t) => { for (const e of document.querySelectorAll('*')) for (const a of [...e.attributes]) if (a.name.startsWith('data-astro-cid-')) { e.removeAttribute(a.name); e.setAttribute(a.name.slice(0, -4) + 'zz' + a.name.slice(-2), ''); } return t; }`,
  'utility-classes': `(t) => { for (const e of document.querySelectorAll('[class]')) e.className = e.className.replace(/\\b(py-\\d+|text-\\w+|font-\\w+|rounded-\\w+|p-\\d+|gap-\\d+|grid-cols-\\d+|bg-\\w+)\\b/g, (c) => c + '-x').trim(); return t; }`,
  'class-renamed': `(t) => { if (!t.classList.length) return false; t.className = [...t.classList].map((c) => c + '-new').join(' '); return t; }`,
  // Words: a typo fixed, a few words changed, the words rewritten in place (a new text where it stood).
  'words-tweaked': `(t) => { const w = [...t.querySelectorAll('*'), t].find((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && /\\w{4,}/.test(n.data))); if (!w) return false; const n = [...w.childNodes].find((n) => n.nodeType === 3 && /\\w{4,}/.test(n.data)); n.data = n.data.replace(/(\\w{4,})/, '$1s'); return t; }`,
  'prices-changed': `(t) => { const p = document.querySelectorAll('.price'); if (![...p].some((e) => t.contains(e) || e.contains(t))) return false; p.forEach((e, i) => (e.textContent = ['$0', '$15', '$49'][i])); return t; }`,
  // Structure: a section added before, sections reordered, the section wrapped, the element wrapped, moved to
  // another section, its tag changed, a look-alike added before it.
  'section-added-above': `(t) => { const m = document.querySelector('main'); if (!m || !m.querySelector('section')) return false; const s = document.createElement('section'); s.id = 'news'; s.innerHTML = '<h2>News</h2><p>We moved to a new office this month.</p>'; m.prepend(s); return t; }`,
  'sections-reordered': `(t) => { const m = document.querySelector('main'); const l = m ? [...m.querySelectorAll(':scope > section')] : []; if (l.length < 2) return false; l.reverse().forEach((s) => m.append(s)); const d = m.querySelector('.dlg'); if (d) m.append(d); return t; }`,
  'section-wrapped': `(t) => { const s = t.closest('section'); if (!s) return false; const w = document.createElement('div'); w.className = 'container'; s.replaceWith(w); w.append(s); return t; }`,
  'element-wrapped': `(t) => { const w = document.createElement('div'); w.className = 'wrap'; t.replaceWith(w); w.append(t); return t; }`,
  'moved-to-footer': `(t) => { const f = document.querySelector('footer'); if (!f || (t.closest('.grid') && t.matches('.card'))) return false; f.prepend(t); return t; }`,
  'tag-changed': `(t) => { if (/^(li|h1|button|img|input|td|tr|th)$/.test(t.localName)) return false; const n = document.createElement(t.localName === 'p' ? 'div' : 'article'); for (const a of t.attributes) n.setAttribute(a.name, a.value); n.append(...t.childNodes); t.replaceWith(n); return n; }`,
  'lookalike-before': `(t) => { const c = t.cloneNode(true); c.id && c.removeAttribute('id'); if (c.querySelector('h3')) c.querySelector('h3').textContent = 'Starter'; else if (c.childElementCount === 0 && c.textContent.trim()) c.textContent = c.textContent.replace(/\\w+/, 'Another'); t.before(c); return t; }`,
  'item-added-before': `(t) => { const li = t.closest('li'); if (!li) return false; const n = document.createElement('li'); n.textContent = 'Open the page in your browser.'; li.before(n); return t; }`,
  // The window: narrower, as on a phone.
  'phone-width': `(t) => { document.documentElement.style.width = '390px'; return t; }`,
  // Gone: the element taken out (the pin must say so).
  deleted: '(t) => { t.remove(); return null; }',
};

// Cells that fail today ("scene|kind|target|edit": the outcome they get). Run and printed, not counted as a failure.
// placed: a pin no browser has drawn since the agent placed it has only its selector, and a selector that counts
// (li:nth-child(2), .card:nth-child(2)) goes to the next one when one before it goes. Drawn once, it is filled in
// (comments.js) and does as an agent pin does. A twin added before it with nothing to tell them apart (a wordless
// tile, a row or card with the same words): shown unsure. A page translated whole: every word and every neighbour new.
const KNOWN = {
  'dashboard|agent|kpi|lookalike-before': 'L',
  'dashboard|agent|row|lookalike-before': 'L',
  'docs|agent|callout|lookalike-before': 'L',
  'docs|agent|callout|translated': 'L',
  'docs|agent|para|translated': 'L',
  'docs|person|callout|translated': 'L',
  'docs|person|para|translated': 'L',
  'gallery|agent|img|lookalike-before': 'L',
  'gallery|person|img|lookalike-before': 'L',
  'landing|agent|video|lookalike-before': 'L',
  'landing|person|video|lookalike-before': 'L',
  'dashboard|placed|badge|class-renamed': 'L',
  'dashboard|placed|badge|lookalike-before': 'W',
  'dashboard|placed|badge|row-added-top': 'W',
  'dashboard|placed|kpi|class-renamed': 'L',
  'dashboard|placed|kpi|deleted': 'W',
  'dashboard|placed|kpi|element-wrapped': 'L',
  'dashboard|placed|kpi|lookalike-before': 'W',
  'dashboard|placed|navlink|lookalike-before': 'W',
  'dashboard|placed|navlink|tag-changed': 'L',
  'dashboard|placed|number|lookalike-before': 'W',
  'dashboard|placed|number|tag-changed': 'L',
  'dashboard|placed|row|deleted': 'W',
  'dashboard|placed|row|element-wrapped': 'L',
  'dashboard|placed|row|lookalike-before': 'W',
  'dashboard|placed|row|next-page': 'W',
  'dashboard|placed|row|row-added-top': 'W',
  'dashboard|placed|stamp|class-renamed': 'L',
  'dashboard|placed|stamp|lookalike-before': 'W',
  'docs|placed|callout|class-renamed': 'L',
  'docs|placed|callout|lookalike-before': 'W',
  'docs|placed|code|lookalike-before': 'W',
  'docs|placed|code|tag-changed': 'L',
  'docs|placed|h2|id-added': 'L',
  'docs|placed|para|element-wrapped': 'L',
  'docs|placed|para|heading-renamed': 'L',
  'docs|placed|para|lookalike-before': 'W',
  'docs|placed|para|tag-changed': 'L',
  'form|placed|input|id-added': 'L',
  'form|placed|label|lookalike-before': 'W',
  'form|placed|label|tag-changed': 'L',
  'form|placed|small|class-renamed': 'L',
  'form|placed|small|lookalike-before': 'W',
  'form|placed|submit|class-renamed': 'L',
  'form|placed|submit|lookalike-before': 'W',
  'gallery|placed|caption|lookalike-before': 'W',
  'gallery|placed|caption|picture-added-first': 'W',
  'gallery|placed|caption|pictures-reordered': 'W',
  'gallery|placed|caption|tag-changed': 'L',
  'gallery|placed|img|lookalike-before': 'W',
  'landing|placed|button|class-renamed': 'L',
  'landing|placed|button|lookalike-before': 'W',
  'landing|placed|card|class-renamed': 'L',
  'landing|placed|card|deleted': 'W',
  'landing|placed|card|element-wrapped': 'L',
  'landing|placed|card|lookalike-before': 'W',
  'landing|placed|dialog|lookalike-before': 'W',
  'landing|placed|dialog|moved-to-footer': 'L',
  'landing|placed|dialog|tag-changed': 'L',
  'landing|placed|heading|lookalike-before': 'W',
  'landing|placed|lede|class-renamed': 'L',
  'landing|placed|lede|lookalike-before': 'W',
  'landing|placed|price|class-renamed': 'L',
  'landing|placed|price|lookalike-before': 'W',
  'landing|placed|price|moved-to-footer': 'L',
  'landing|placed|step|deleted': 'W',
  'landing|placed|step|element-wrapped': 'L',
  'landing|placed|step|item-added-before': 'W',
  'landing|placed|step|lookalike-before': 'W',
  'landing|placed|step|moved-to-footer': 'W',
  'landing|placed|video|class-renamed': 'L',
  'landing|placed|video|lookalike-before': 'W',
  'menu|placed|danger|class-renamed': 'L',
  'menu|placed|danger|lookalike-before': 'W',
  'menu|placed|item|class-renamed': 'L',
  'menu|placed|item|deleted': 'W',
  'menu|placed|item|element-wrapped': 'L',
  'menu|placed|item|item-added-top': 'W',
  'menu|placed|item|lookalike-before': 'W',
};

const results = [];
try {
  for (const eng of engines('chromium,webkit')) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
      // Pages at an address of their own (pictures resolve against it, as on a real site); nothing is fetched.
      await ctx.route('http://usecases.test/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '' }));
      const p = await ctx.newPage();
      await p.goto('http://usecases.test/');
      for (const scene of SCENES)
      for (const [target, sel] of Object.entries(scene.targets))
        for (const [edit, fn] of Object.entries({ ...EDITS, ...scene.edits }))
          for (const kind of ['person', 'agent', 'placed']) {
            await p.setContent(`<!doctype html><meta charset="utf-8"><style>body{margin:20px;font:16px/1.4 sans-serif}.grid,.kpis,.gallery{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.app{display:flex;gap:24px}.sidebar{display:flex;flex-direction:column}.menu{display:inline-flex;flex-direction:column;border:1px solid #ccc}label,input,button{display:block;margin:4px 0}</style><body>${scene.page}</body>`);
            await p.addScriptTag({ content: BUNDLE });
            const r = await p.evaluate(
              async ({ sel, kind, fn }) => {
                const host = document.createElement('div');
                document.documentElement.append(host);
                A.bindAnchoring({ host, layer: host, el: (tag) => document.createElement(tag) });
                let t = document.querySelector(sel.at);
                t.scrollIntoView({ block: 'center' });
                const b = t.getBoundingClientRect();
                let a;
                if (kind === 'person') {
                  a = A.anchorAt(b.left + Math.min(8, b.width / 2), b.top + Math.min(b.height / 2, 10));
                  a.kind = a.kind === 'image' ? 'image' : 'element';
                  delete a.quote;
                } else {
                  a = { kind: 'element', selector: sel.agent, x: 0.5, y: 0.5, docX: (b.left + b.width / 2) / innerWidth, docY: b.top + scrollY + b.height / 2 };
                  if (kind === 'agent') a = { ...a, ...A.fillAt(a) };
                }
                const was = A.findTarget(a);
                if (kind === 'person') t = was && t.contains(was) ? was : t; // a click lands on what is under it: that is its element
                const want = new Function('t', `return (${fn})(t)`)(t);
                if (want === false) return { skip: true };
                await new Promise((r) => setTimeout(r, 50));
                const fresh = JSON.parse(JSON.stringify(a)); // the page loaded again: nothing kept from before
                const now = A.findTarget(fresh);
                const pos = A.position(fresh) || {};
                const name = (n) => (n ? n.localName + (n.id ? '#' + n.id : '') + (n.className && typeof n.className === 'string' ? '.' + n.className.split(' ')[0] : '') : 'none');
                // On another element but shown as unsure or changed (the agent is told): as good as lost, not silent.
                const out = now && now === want ? 'R' : now ? (pos.why ? 'L' : 'W') : want === null ? 'R' : 'L';
                return { before: was === t, out, got: name(now), want: name(want), why: pos.why || '', selector: a.selector };
              },
              { sel, kind, fn },
            );
            if (r.skip) continue;
            results.push({ eng, scene: scene.name, kind, target, edit, ...r });
          }
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 });
}

// Every pin is on its element before any edit (else the case says nothing).
const unplaced = results.filter((r) => !r.before);
check('all', 'every pin is on its element before the edit', !unplaced.length, unplaced.map((r) => `${r.eng} ${r.scene}|${r.kind}|${r.target}`).filter((x, i, l) => l.indexOf(x) === i).join(', '));
const fails = results.filter((r) => r.out !== 'R');
const cells = new Map();
for (const r of fails) {
  const key = `${r.scene}|${r.kind}|${r.target}|${r.edit}`;
  if (!cells.has(key) || r.out === 'W') cells.set(key, r);
}
if (process.env.USECASES_KNOWN === 'print') console.log(JSON.stringify(Object.fromEntries([...cells].map(([k, r]) => [k, r.out])), null, 2).replace(/\n {2}/g, '\n  '));
const count = (kind) => {
  const all = results.filter((r) => r.kind === kind);
  return `${kind}: ${all.filter((r) => r.out === 'R').length}/${all.length} right, ${all.filter((r) => r.out === 'W').length} wrong, ${all.filter((r) => r.out === 'L').length} lost`;
};
console.log(['person', 'agent', 'placed'].map(count).join(' · '));
for (const [key, r] of cells) {
  const known = KNOWN[key];
  const ok = known && !(r.out === 'W' && known === 'L');
  console.log(`${ok ? 'known' : 'FAIL '} ${key}: ${r.out} (on ${r.got}, belongs on ${r.want}${r.why ? `, shown ${r.why}` : ''}; ${r.eng}; selector ${r.selector})`);
  if (!ok) check(r.eng, `${key}: the pin is on its element`, false, `${r.out}: on ${r.got}, belongs on ${r.want}`);
}
finish();
