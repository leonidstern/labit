// Area 2, HOTSWAP: a lab's pages are saved, replaced, cut short, deleted, made again, linked and touched in every way a
// person, an editor, a build or an agent saves files, while devices hold the pages open; afterwards every device must
// show what is on disk, and must not have reloaded for a save that has nothing to do with its page.
//
// The oracle is the disk: after the last step the files are read back, and what each device shows of its page and of
// every file that page loads is compared with those bytes. Nothing of the lab's own bookkeeping (its counters, its
// change lists) is used to decide what a device should show.
import fs from 'node:fs';
import path from 'node:path';
import { Lab, Device, rq, sleep, until, writeAtomicly } from './lib.mjs';

export const name = 'hotswap';

// ---------- the site ----------
// Every file carries a token (8 characters) that says which version it is; a page's own part is its <main>.
const TOK = (n) => `v${String(n).padStart(7, '0')}`;
const PAGES = {
  index: { file: 'index.html', urls: ['/', '/index.html', '/index'], css: ['s.css'], img: 'pic.svg' },
  deep: { file: 'sub/deep/page.html', urls: ['/sub/deep/page.html', '/sub/deep/page'], css: ['../../s.css', 'p.css'] },
  odd: { file: 'odd/we ird é(1).html', urls: ['/odd/we%20ird%20%C3%A9(1).html'], css: ['/s.css'] },
  caps: { file: 'Caps.html', urls: ['/Caps.html', '/caps.html'], css: ['s.css'] },
  dir: { file: 'docs/index.html', urls: ['/docs/'], css: ['../s.css', 'd.css'] },
};
const ASSETS = ['s.css', 'base.css', 'pic.svg', 'app.js', 'mod/main.js', 'mod/dep.js', 'sub/deep/p.css', 'docs/d.css'];
const UNRELATED = ['notes.md', 'other.js', 'other.html', 'tools/build.py'];
const ALL = [...Object.values(PAGES).map((p) => p.file), ...ASSETS, ...UNRELATED];
const pad = (n) => 'x'.repeat(n);

/** A file's text at version `tok`. `site`: what the index page loads (script: a plain script; module: one that imports
 *  another) and whether s.css pulls in base.css. `fill` pads it (past 1 KB the lab sends it packed). */
function content(file, tok, site, fill = 0) {
  const page = Object.values(PAGES).find((p) => p.file === file);
  if (page) {
    const links = page.css.map((h) => `<link rel="stylesheet" href="${h}">`).join('');
    const scripts = file !== 'index.html' ? '' : site.variant === 'script' ? '<script src="app.js"></script>' : site.variant === 'module' ? '<script type="module" src="mod/main.js"></script>' : '';
    return `<!doctype html><html><head><meta charset="utf-8"><title>${tok}</title>${links}</head><body><main id="m" data-v="${tok}"><h1 id="t">${file}</h1><p id="p1">text of ${tok} ${pad(fill)}</p>${page.img ? `<img id="i" src="${page.img}" alt="">` : ''}</main>${scripts}</body></html>`;
  }
  if (file === 's.css') return `${site.cssImport ? '@import "base.css";\n' : ''}:root{--v:${tok}}\nmain{outline:0 solid}/* ${pad(fill)} */\n`;
  if (file === 'base.css') return `:root{--b:${tok}}/* ${pad(fill)} */\n`;
  if (file.endsWith('.css')) return `:root{--p:${tok}}/* ${pad(fill)} */\n`;
  if (file === 'app.js') return `document.documentElement.dataset.js="${tok}";// ${pad(fill)}\n`;
  if (file === 'mod/main.js') return `import "./dep.js";\ndocument.documentElement.dataset.mod="${tok}";// ${pad(fill)}\n`;
  if (file === 'mod/dep.js') return `document.documentElement.dataset.dep="${tok}";// ${pad(fill)}\n`;
  if (file.endsWith('.svg')) return `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><!--${tok} ${pad(fill)}--><rect width="8" height="8"/></svg>`;
  if (file.endsWith('.html')) return `<!doctype html><title>${tok}</title><main data-v="${tok}">${pad(fill)}</main>`;
  return `${tok} ${pad(fill)}\n`;
}

// ---------- the plan ----------
const HOWS = [[30, 'write'], [22, 'atomic'], [8, 'append'], [6, 'truncate'], [5, 'touch'], [4, 'same'], [5, 'keepmtime'], [7, 'swapin'], [5, 'symlink'], [8, 'delre']];
export function plan(rng, opts) {
  const site = { variant: rng.weighted([[5, 'plain'], [3, 'script'], [2, 'module']]), cssImport: rng.bool(0.35) };
  const roll = rng.float();
  const engine = rng.pick(['chromium', 'webkit']);
  const browser = opts.browser && roll < opts.browserShare ? engine : null;
  const kind = rng.weighted([[40, 'edits'], [14, 'offline'], [12, 'loading'], [10, 'draft'], [10, 'restart'], [8, 'gone'], [6, 'bulk']]);
  const devices = Array.from({ length: rng.between(1, 3) }, (_, i) => {
    const key = i === 0 ? rng.weighted([[6, 'index'], [2, 'deep'], [1, 'odd'], [1, 'caps'], [1, 'dir']]) : rng.pick(Object.keys(PAGES));
    const urls = PAGES[key].urls;
    return { page: key, url: rng.bool(0.7) ? urls[0] : rng.pick(urls) };
  });
  // The files worth saving: the ones the open pages load, mostly.
  const used = new Set();
  for (const d of devices) {
    used.add(PAGES[d.page].file);
    used.add('s.css');
    if (d.page === 'index') for (const f of ['pic.svg', ...(site.variant === 'script' ? ['app.js'] : site.variant === 'module' ? ['mod/main.js', 'mod/dep.js'] : []), ...(site.cssImport ? ['base.css'] : [])]) used.add(f);
    if (d.page === 'deep') used.add('sub/deep/p.css');
    if (d.page === 'dir') used.add('docs/d.css');
  }
  const aFile = () => (rng.bool(0.8) ? rng.pick([...used]) : rng.pick(ALL));
  const ops = [];
  let r = 0;
  let n = 0; // versions made so far: each save gets the next token
  const edit = (how = rng.weighted(HOWS), f = aFile()) => ({ t: 'edit', how, f, tok: TOK(++n), fill: rng.weighted([[5, rng.int(40)], [2, 1200 + rng.int(300)], [1, 0]]), gap: rng.pick([0, 0, 5, 30, 120, 300]), cut: rng.pick([0, 0.5]) });
  const push = (op, same = false) => ops.push({ ...op, r: same ? r : ++r, delay: same ? rng.int(40) : 0 });
  // Every device opens its page first, except in a 'loading' case, where saves land while a page is on its way in.
  devices.forEach((d, i) => push({ t: 'open', d: i }, i > 0));
  if (kind === 'loading') for (let k = rng.between(1, 3); k--; ) push(edit(rng.pick(['write', 'atomic'])), true);
  const steps = rng.between(3, 12);
  const off = new Set();
  const drafts = new Set();
  let down = false;
  for (let k = 0; k < steps; k++) {
    const d = rng.int(devices.length);
    const what = rng.weighted([
      [50, 'edit'], [12, 'burst'], [10, 'wait'],
      [kind === 'offline' ? 25 : 2, 'offline'], [kind === 'loading' ? 25 : 3, 'reload'], [kind === 'draft' ? 25 : 2, 'draft'],
      [kind === 'restart' ? 20 : 0, 'restart'], [kind === 'bulk' ? 25 : 1, 'bulk'], [kind === 'gone' ? 25 : 2, 'gone'], [3, 'newfile'],
    ]);
    if (what === 'edit') push(edit(), rng.bool(0.25));
    else if (what === 'burst') for (let j = 0, m = rng.between(2, 5); j < m; j++) push({ ...edit(rng.pick(['write', 'atomic', 'write', 'append'])), gap: 0 }, j > 0);
    else if (what === 'wait') push({ t: 'wait', ms: rng.pick([30, 90, 150, 450, 700]) });
    else if (what === 'offline') {
      if (off.has(d)) (off.delete(d), push({ t: 'online', d }));
      else (off.add(d), push({ t: 'offline', d }));
    } else if (what === 'reload') {
      push({ t: 'reload', d });
      if (rng.bool(0.7)) push(edit(rng.pick(['write', 'atomic'])), true);
    } else if (what === 'draft') {
      if (drafts.has(d)) (drafts.delete(d), push({ t: 'draft', d, on: false }));
      else (drafts.add(d), push({ t: 'draft', d, on: true }));
    } else if (what === 'restart') {
      if (down) push({ t: 'up' });
      else push({ t: 'down', sig: rng.pick(['SIGTERM', 'SIGTERM', 'SIGKILL']) });
      down = !down;
      if (down && rng.bool(0.6)) push(edit(rng.pick(['write', 'atomic'])));
    } else if (what === 'bulk') push({ t: 'bulk', n: rng.pick([20, 55, 80]), with: rng.bool(0.6) ? edit('write') : null });
    else if (what === 'gone') push({ ...edit('delre'), gap: rng.pick([0, 20, 150, 400, 900, 2500]) }); // 2.5 s: a build that clears its output and writes it again
    else if (what === 'newfile') push({ t: 'newfile', tok: TOK(++n), ext: rng.pick(['css', 'html', 'md', 'js']) });
  }
  return { kind, site, browser, devices, ops };
}
export const planLine = (p) => `index page: ${p.site.variant}${p.site.cssImport ? ', s.css imports base.css' : ''}; devices: ${p.devices.map((d, i) => `d${i} on ${d.url}`).join(', ')}`;
export const describe = (op) =>
  !op ? '(left out)'
  : op.t === 'edit' ? `${op.how} ${op.f}${op.how === 'delre' ? ` (${op.gap} ms gone)` : ''}${op.how === 'truncate' ? ` to ${op.cut ? 'half' : '0'}` : ''} [${op.tok}]${op.delay ? ` +${op.delay}ms` : ''}`
  : op.t === 'wait' ? `wait ${op.ms} ms`
  : op.t === 'bulk' ? `${op.n} other files saved at once${op.with ? ` with ${op.with.f} [${op.with.tok}]` : ''}`
  : op.t === 'newfile' ? `a new .${op.ext} file in a new folder`
  : op.t === 'draft' ? `d${op.d} ${op.on ? 'opens a draft' : 'closes its draft'}`
  : op.t === 'down' ? `the lab stops (${op.sig})`
  : op.t === 'up' ? 'the lab starts again'
  : `d${op.d} ${op.t}${op.delay ? ` +${op.delay}ms` : ''}`;

// ---------- a real browser as the device ----------
const LAB_BITS = [
  '<link rel="icon" href="/_lab/favicon.svg">',
  /<script src="\/_lab\/comments\.js"[^>]*><\/script>\n/,
];
/** A page as the lab served it, without what the lab put into it: the file's own text. */
const stripLab = (html) => LAB_BITS.reduce((t, bit) => t.replace(bit, ''), html);

class BrowserDevice {
  constructor(lab, engine, taken, url, id) {
    Object.assign(this, { lab, engine, taken, url, id, reloads: -1, held: false, dead: false, real: true });
  }
  async open() {
    this.ctx = await this.taken.browser.newContext({ viewport: { width: 1000, height: 700 } });
    await this.ctx.addInitScript(() => {
      try {
        localStorage.setItem('lab-name', 'Leo');
        localStorage.setItem('lab-on', '1');
      } catch {}
    });
    this.page = await this.ctx.newPage();
    this.page.on('load', () => this.reloads++);
    await this.page.goto(this.lab.base + this.url, { waitUntil: 'load' });
    await sleep(400); // the widget's script is deferred: its stream opens a moment after the page
  }
  async reloadByHand() {
    await this.page.reload({ waitUntil: 'load' }).catch(() => {});
  }
  async goOffline() {
    await this.ctx.setOffline(true);
  }
  async online() {
    await this.ctx.setOffline(false);
  }
  // A draft: a click on the page's text opens an empty comment box, and words are typed into it.
  async hold(on) {
    if (on) {
      const box = await this.page.locator('#p1').boundingBox().catch(() => null);
      if (!box) return;
      await this.page.mouse.click(box.x + 20, box.y + box.height / 2);
      await sleep(300);
      await this.page.keyboard.type('draft words kept');
      this.held = true;
      this.draft = await this.draftText();
    } else if (this.held) {
      this.held = false;
      // Each draft with what its box held as it closed: a later draft must not stand in for a lost one.
      (this.drafts ||= []).push([this.draft, await this.draftText()]);
      await this.page.keyboard.press('Escape').catch(() => {}); // closes the box and lets its words go: a waiting reload may happen
      await sleep(100);
    }
  }
  draftText() {
    return this.page.evaluate(() => [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.more'))?.shadowRoot.querySelector('.card textarea, .float textarea')?.value ?? null).catch(() => null);
  }
  /** What the page shows right now: the tokens of its HTML, its stylesheets and its scripts. */
  async shown() {
    return this.page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      const v = (k) => css.getPropertyValue(k).trim() || null;
      return {
        html: document.querySelector('main')?.dataset.v ?? null, title: document.title, s: v('--v'), b: v('--b'), p: v('--p'),
        js: document.documentElement.dataset.js ?? null, mod: document.documentElement.dataset.mod ?? null, dep: document.documentElement.dataset.dep ?? null,
        widget: Boolean([...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.more'))), notFound: /not found/i.test(document.title),
        links: [...document.querySelectorAll('link[rel~="stylesheet"]')].map((l) => l.getAttribute('href')).join(' '), url: location.pathname,
      };
    }).catch((e) => ({ error: String(e) }));
  }
  async idle() {
    return true;
  }
  async close() {
    await this.page?.goto('about:blank').catch(() => {});
    await this.ctx?.close().catch(() => {});
    this.taken.release();
  }
}

// ---------- one case ----------
export async function run(plan, ctx, opts) {
  const { site } = plan;
  // How long a device may take to show a save. ~100 ms is usual (the lab waits 80 ms for a burst to end); a save that
  // needs a reload waits until the page was left alone for 1.5 s (so does a page's first 1.5 s), looked at every 500 ms.
  const BOUND = (plan.browser ? 9000 : 5000) * opts.slow;
  const abs = (f) => path.join(ctx.dir, f);
  for (const f of ALL) {
    fs.mkdirSync(path.dirname(abs(f)), { recursive: true });
    fs.writeFileSync(abs(f), content(f, TOK(0), site, 10));
  }
  const lab = new Lab(ctx);
  const started = await lab.start();
  if (!started.ok) return ctx.add('harness', 'lab-did-not-start', lab.log.slice(-400));

  let taken = null;
  if (plan.browser) {
    try {
      taken = await opts.browser.take(plan.browser);
    } catch (e) {
      return ctx.add('harness', 'browser-did-not-start', `${plan.browser}: ${e.message}`);
    }
  }
  // With a real browser the case has one device (the first); the others stay raw clients beside it.
  const devices = plan.devices.map((d, i) => (taken && i === 0 ? new BrowserDevice(lab, plan.browser, taken, d.url, `d${i}`) : new Device(lab, { id: `d${i}`, url: d.url })));
  ctx.onEnd(() => Promise.all(devices.map((d) => d.close())));
  const st = devices.map(() => ({ open: false, offline: false, draft: false, loading: -1, wasOffline: false, sawRestart: false }));
  let down = false;
  let restarted = false;
  let lastSave = Date.now();
  const last = {}; // file -> how it was last saved, and what each device was doing then
  const gone = {}; // file -> the longest it was missing (deleted, then written again), ms
  const cut = new Set(); // files that were cut short at some point (a half-written page)
  const bulks = []; // when more than 50 files were saved at once
  let drafted = false;
  const saved = (f, how, r) => {
    lastSave = Date.now();
    // What each device was doing as this save landed: it names the situation in the failure's signature.
    last[f] = { how, at: Date.now(), cond: st.map((s, i) => (down ? 'lab-down' : !s.open ? 'not-open' : devices[i].real ? (s.offline ? 'offline' : s.loading === r ? 'loading' : s.draft ? 'draft' : 'live') : !devices[i].heard ? 'before-first-live-message' : s.offline ? 'offline' : s.draft ? 'draft' : 'live')) };
  };

  const save = async (op) => {
    const file = abs(op.f);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const text = content(op.f, op.tok, site, op.fill);
    let measured = 0;
    const exists = fs.existsSync(file);
    if (op.how === 'write' || !exists) fs.writeFileSync(file, text);
    else if (op.how === 'atomic') writeAtomicly(file, text);
    else if (op.how === 'append') fs.appendFileSync(file, /\.html?$/.test(op.f) ? `<!--${op.tok}-->` : /\.(css|js)$/.test(op.f) ? `/*${op.tok}*/` : `\n${op.tok}`);
    else if (op.how === 'truncate') (cut.add(op.f), fs.truncateSync(file, Math.floor(fs.statSync(file).size * op.cut)));
    else if (op.how === 'touch') fs.utimesSync(file, new Date(), new Date());
    else if (op.how === 'same') fs.writeFileSync(file, fs.readFileSync(file));
    else if (op.how === 'keepmtime') {
      // New words, the same size and the same time on the file: what cp -p, rsync -t or an unpacked archive leave.
      const was = fs.statSync(file);
      const old = fs.readFileSync(file, 'utf8');
      const next = old.includes('v0') ? old.replace(/v\d{7}/g, op.tok) : text;
      fs.writeFileSync(file, next);
      fs.utimesSync(file, was.atime, was.mtime);
    } else if (op.how === 'swapin') {
      fs.writeFileSync(`${file}.next`, text);
      fs.renameSync(`${file}.next`, file);
    } else if (op.how === 'symlink') {
      // The file becomes a link to another one in the folder (a theme, a build's output).
      const target = path.join(ctx.dir, '_alt', `${op.tok}-${path.basename(op.f)}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, text);
      fs.symlinkSync(path.relative(path.dirname(file), target), `${file}.lnk`);
      fs.renameSync(`${file}.lnk`, file);
    } else if (op.how === 'delre') {
      const t1 = Date.now();
      fs.rmSync(file, { force: true });
      if (op.gap) await sleep(op.gap);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      // The gap the lab really had, not the one asked for: a 5 ms wait can overshoot on a loaded machine (the buckets and
      // the failure's detail use this).
      measured = Date.now() - t1;
    }
    if (op.how === 'delre') gone[op.f] = Math.max(gone[op.f] || 0, measured);
    saved(op.f, op.as || op.how, op.r);
  };

  const step = async (op) => {
    if (op.delay) await sleep(op.delay);
    const d = devices[op.d];
    const s = st[op.d];
    ctx.note(describe(op));
    if (op.t === 'open') {
      s.loading = op.r;
      s.open = true;
      await d.open();
    } else if (op.t === 'reload') {
      if (!s.open || s.offline || down) return;
      s.loading = op.r;
      if (d.real) await d.reloadByHand();
      else await d.open();
    } else if (op.t === 'offline') {
      if (!s.open) return;
      s.offline = s.wasOffline = true;
      await d.goOffline();
    } else if (op.t === 'online') {
      if (!s.open) return;
      s.offline = false;
      await d.online();
    } else if (op.t === 'draft') {
      if (!s.open || s.offline || down) return;
      s.draft = op.on;
      drafted = true;
      await d.hold(op.on);
    } else if (op.t === 'edit') await save(op);
    else if (op.t === 'wait') await sleep(op.ms);
    else if (op.t === 'bulk') {
      if (op.n > 50) bulks.push(Date.now());
      fs.mkdirSync(abs('bulk'), { recursive: true });
      for (let i = 0; i < op.n; i++) fs.writeFileSync(abs(`bulk/f${i}.css`), `/* ${i} ${Date.now()} */`);
      if (op.with) await save({ ...op.with, how: 'write', as: op.n > 50 ? 'write-among-50+-files' : 'write-among-many-files', r: op.r });
    } else if (op.t === 'newfile') {
      const f = `new-${op.tok}/deep/x.${op.ext}`;
      fs.mkdirSync(path.dirname(abs(f)), { recursive: true });
      fs.writeFileSync(abs(f), content(f, op.tok, site, 5));
    } else if (op.t === 'down') {
      if (down) return;
      down = true;
      await lab.stop(op.sig);
    } else if (op.t === 'up') {
      if (!down) return;
      const again = await lab.start();
      if (!again.ok) throw new Error(`the lab did not start again: ${lab.log.slice(-300)}`);
      down = false;
      restarted = true;
      st.forEach((x) => x.open && (x.sawRestart = true));
    }
  };
  // Steps of one round go together (a save while a page loads, two saves in one moment); rounds go one after another.
  const rounds = new Map();
  for (const op of plan.ops) if (op) rounds.set(op.r, [...(rounds.get(op.r) || []), op]);
  for (const [, ops] of [...rounds].sort((a, b) => a[0] - b[0])) await Promise.all(ops.map(step));

  // ---------- the end: everything back, then what does each device show? ----------
  if (down) {
    const again = await lab.start();
    if (!again.ok) return ctx.add('loud', 'lab-did-not-start-again', lab.log.slice(-400), {});
    restarted = true;
    st.forEach((x) => x.open && (x.sawRestart = true));
  }
  for (const [i, d] of devices.entries()) {
    if (!st[i].open) continue;
    if (st[i].offline) await d.online();
    if (st[i].draft) await d.hold(false);
  }
  const read = (f) => {
    try {
      return fs.readFileSync(abs(f), 'utf8');
    } catch {
      return null;
    }
  };
  // What a page on disk loads, read from the files themselves: [{ kind, file }], with what its sheets and scripts pull in.
  const loadsOf = (pageFile) => {
    const html = read(pageFile) ?? '';
    const out = [];
    const at = (from, ref) => path.posix.normalize(ref.startsWith('/') ? ref.slice(1) : path.posix.join(path.posix.dirname(from), ref));
    const pull = (kind, file, depth = 0) => {
      if (out.some((o) => o.file === file) || depth > 4) return;
      out.push({ kind, file });
      const text = read(file) ?? '';
      if (file.endsWith('.css')) for (const m of text.matchAll(/@import "([^"]+)"/g)) pull('css-import', at(file, m[1]), depth + 1);
      if (file.endsWith('.js')) for (const m of text.matchAll(/^import "([^"]+)"/gm)) pull('js-import', at(file, m[1]), depth + 1);
    };
    for (const m of html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)) pull('css', at(pageFile, m[1]));
    for (const m of html.matchAll(/<script(?: type="module")? src="([^"]+)"><\/script>/g)) pull('js', at(pageFile, m[1]));
    for (const m of html.matchAll(/<img id="i" src="([^"]+)"/g)) pull('img', at(pageFile, m[1]));
    return out;
  };
  // How long the page's file was really missing (measured around the delete and the write), as a bucket for the signature.
  const goneBucket = (f) => ((gone[f] || 0) >= 2000 ? 'over-2s' : (gone[f] || 0) >= 100 ? '100ms-to-1s' : gone[f] !== undefined ? 'under-100ms' : 'never');
  // A file cut inside a tag ends where the lab's widget tag, which it appends, can't work: no page, no widget, whatever the lab does.
  const endsInOpenTag = (h) => h.lastIndexOf('<') > h.lastIndexOf('>');
  const tokIn = (text, re) => re.exec(text ?? '')?.[1] ?? null;
  // What is wrong with what device i shows, or null: [check, detail, tags].
  const wrong = async (i) => {
    const d = devices[i];
    const pageFile = PAGES[plan.devices[i].page].file;
    const html = read(pageFile);
    if (html === null) return null; // its page is gone: nothing it could show is right or wrong
    // One word for the situation the stale file was saved in, the most telling first: it names the bug in the signature.
    // (How the file was written and what the device was doing stay in the tags only where nothing else explains it.)
    const why = (f, res) => {
      const l = last[f] || { how: 'never-saved', cond: [] };
      const cond = l.cond[i] || 'live';
      const cause = plan.devices[i].url === '/caps.html' ? "page-opened-in-another-letter-case"
        : bulks.some((t) => Math.abs(t - (l.at || 0)) < 400) ? 'saved-among-over-50-files'
        : cond === 'lab-down' || st[i].sawRestart ? 'lab-stopped-or-restarted-around-the-save'
        : cond === 'before-first-live-message' || cond === 'loading' ? "saved-before-the-page's-first-live-message"
        : res === 'js-import' ? 'file-is-imported-by-a-script'
        : l.how === 'keepmtime' ? 'same-size-and-time-as-before'
        : st[i].wasOffline ? 'device-was-offline'
        : null;
      return cause ? { cause } : { cause: 'other', last: l.how, cond };
    };
    if (d.real) {
      const s = await d.shown();
      if (s.error) return ['browser-page-unreadable', s.error, { browser: plan.browser }];
      if (!s.widget && endsInOpenTag(html)) return null; // (the disk bytes end inside a tag: no widget tag can work)
      if (!s.widget) return ['dead-page', `the page has no widget (title "${s.title}") though ${pageFile} is on disk${gone[pageFile] !== undefined ? ` (it was really missing for ${gone[pageFile]} ms)` : ''}`, { shows: s.notFound ? 'not-found' : 'other', gone: goneBucket(pageFile), ...(cut.has(pageFile) ? { cut: 'page-was-cut-short' } : {}), browser: plan.browser }];
      const want = { html: tokIn(html, /<main id="m" data-v="(\w+)"/) };
      const onDisk = new Set(); // the stylesheets that are there (maybe cut short or empty), not deleted
      for (const { file } of loadsOf(pageFile)) {
        const text = read(file);
        if (text !== null && file.endsWith('.css')) onDisk.add(file);
        if (file === 's.css') want.s = tokIn(text, /--v:(\w+)/);
        else if (file === 'base.css') want.b = tokIn(text, /--b:(\w+)/);
        else if (file.endsWith('.css')) want.p = tokIn(text, /--p:(\w+)/);
        else if (file === 'app.js') want.js = tokIn(text, /dataset\.js="(\w+)"/);
        else if (file === 'mod/main.js') want.mod = tokIn(text, /dataset\.mod="(\w+)"/);
        else if (file === 'mod/dep.js') want.dep = tokIn(text, /dataset\.dep="(\w+)"/);
      }
      const fileOf = { html: pageFile, s: 's.css', b: 'base.css', p: PAGES[plan.devices[i].page].css.find((c) => /[pd]\.css$/.test(c)) ? (plan.devices[i].page === 'deep' ? 'sub/deep/p.css' : 'docs/d.css') : 's.css', js: 'app.js', mod: 'mod/main.js', dep: 'mod/dep.js' };
      const kindOf = { html: 'html', s: 'css', b: 'css-import', p: 'css', js: 'js', mod: 'js', dep: 'js-import' };
      // A file cut short may hold no token at all: then only a token of an older version showing is wrong. A stylesheet
      // still there with no token (cut, or emptied) must not keep showing its old one.
      for (const [k, tok] of Object.entries(want)) if (tok ? s[k] !== tok : kindOf[k].startsWith('css') && onDisk.has(fileOf[k]) && s[k] != null) return [kindOf[k].startsWith('css') && !s.links ? 'page-lost-its-stylesheets' : 'stale-content', `${plan.browser} shows ${k}=${s[k]} of ${fileOf[k]}, the disk has ${tok}${kindOf[k].startsWith('css') ? ` (its stylesheets now: ${s.links || 'none'}; at ${s.url})` : ''}`, kindOf[k].startsWith('css') && !s.links ? { browser: plan.browser } : { res: kindOf[k], ...why(fileOf[k], kindOf[k]), browser: plan.browser }];
      return null;
    }
    if ((d.dead || d.status !== 200) && d.status === 200 && endsInOpenTag(html)) return null; // (cut inside a tag: no widget tag can work)
    if (d.dead || d.status !== 200) return ['dead-page', `it is on a page with no widget (status ${d.status}: ${d.status === 404 ? 'the lab\'s "not found"' : d.status === 200 ? 'the lab\'s page list' : 'no answer'}) though ${pageFile} is on disk; nothing can update it${gone[pageFile] !== undefined ? ` (it was really missing for ${gone[pageFile]} ms)` : ''}`, { shows: d.status === 404 ? 'not-found' : d.status === 200 ? 'page-list' : 'no-answer', gone: goneBucket(pageFile), ...(cut.has(pageFile) ? { cut: 'page-was-cut-short' } : {}), ...(st[i].sawRestart ? { restart: 1 } : {}) }];
    if (stripLab(d.html) !== html) return ['stale-content', `html of ${pageFile}: shows ${JSON.stringify(stripLab(d.html).slice(0, 150))}, the disk has ${JSON.stringify(html.slice(0, 150))}`, { res: 'html', ...why(pageFile, 'html') }];
    for (const { kind, file } of loadsOf(pageFile)) {
      const text = read(file);
      const got = d.res.get(`/${file}`);
      if (text === null ? got && got.status === 200 && got.text : !got || got.text !== text)
        return ['stale-content', `${kind} ${file}: shows ${JSON.stringify((got?.text ?? '(never fetched)').slice(0, 90))} (status ${got?.status}), the disk has ${JSON.stringify((text ?? '(no file)').slice(0, 90))}`, { res: kind, ...why(file, kind) }];
    }
    return null;
  };
  const open = devices.map((_, i) => i).filter((i) => st[i].open);
  const t0 = Date.now();
  let bad = [];
  const settled = await until(async () => {
    for (const i of open) await devices[i].idle(200);
    bad = [];
    for (const i of open) {
      const w = await wrong(i);
      if (w) bad.push([i, w]);
    }
    return !bad.length;
  }, BOUND, plan.browser ? 150 : 40);
  if (settled) ctx.time(`hotswap: from the last save to every device showing it${plan.browser ? ' (a real browser)' : ''}`, Math.max(0, Date.now() - lastSave));
  for (const [i, [check, detail, tags]] of bad) {
    ctx.note(`d${i} FAILED ${check}: ${detail}`);
    if (!devices[i].real) ctx.note(`d${i} log:\n      ${devices[i].log.slice(-25).join('\n      ')}`);
    ctx.add('silent', check, `d${i} on ${plan.devices[i].url} after ${Date.now() - t0} ms: ${detail}`, tags);
  }
  // A draft's words must still be in its box after every save that happened while it was open.
  // Every draft closed during the case, and one still open at its end.
  for (const d of devices) {
    if (!d.real) continue;
    const drafts = [...(d.drafts || []), ...(d.held ? [[d.draft, await d.draftText()]] : [])];
    const lost = drafts.find(([typed, held]) => typed && held !== typed);
    if (lost) ctx.add('silent', 'draft-lost', `typed ${JSON.stringify(lost[0])}, the box held ${JSON.stringify(lost[1])} after the saves`, { browser: plan.browser });
  }
  // The lab must also serve the disk's bytes to anyone who asks now.
  if (!bad.length) {
    for (const f of new Set(open.flatMap((i) => [PAGES[plan.devices[i].page].file, ...loadsOf(PAGES[plan.devices[i].page].file).map((o) => o.file)]))) {
      const text = read(f);
      if (text === null) continue;
      const r = await rq(lab, { path: `/${f.split('/').map(encodeURIComponent).join('/')}`, headers: { 'accept-encoding': 'gzip' } }).catch((e) => ({ status: 0, text: String(e) }));
      const got = /\.html$/.test(f) ? stripLab(r.text) : r.text;
      if (r.status !== 200 || got !== text) ctx.add('silent', 'served-bytes-differ', `${f}: the lab serves ${JSON.stringify(got.slice(0, 80))} (${r.status}), the disk has ${JSON.stringify(text.slice(0, 80))}`, { res: path.extname(f).slice(1), last: last[f]?.how || 'never-saved' });
    }
  }
  if (bad.length || ctx.findings.length) return;
  // (Not with a real browser after a restart: it finds the lab again seconds later, and a page with scripts then
  // reloads to catch up, which is no reload for the quiet saves.)
  if (plan.browser && restarted) return;

  // ---------- nothing a page uses changes: nothing may reload ----------
  // The lab has said every save by now (it says one ~100 ms after it), so a reload from here on is for the quiet saves.
  await sleep(Math.max(0, lastSave + 600 * opts.slow - Date.now()));
  for (const i of open) await devices[i].idle(3000);
  // A reload that waited for a draft happens up to 2 s after the last key (the widget holds it 1.5 s after a touch).
  if (plan.browser) await sleep(drafted ? 2600 : 2100); // (and a page's first 1.5 s count as a touch)
  const count = (d) => (d.real ? d.reloads : d.reloads * 1000 + d.morphs);
  const quiet = [
    ['md', () => fs.writeFileSync(abs('notes.md'), `note ${Date.now()}`)],
    ['dot-folder', () => (fs.mkdirSync(abs('.cache'), { recursive: true }), fs.writeFileSync(abs('.cache/x.css'), 'a{}'))],
    ['node_modules', () => (fs.mkdirSync(abs('node_modules/pkg'), { recursive: true }), fs.writeFileSync(abs('node_modules/pkg/index.js'), '1'))],
    ['unrelated-script', () => fs.writeFileSync(abs('other.js'), `// ${Date.now()}`)],
    ['source-file', () => fs.writeFileSync(abs('tools/build.py'), `# ${Date.now()}`)],
    ['comment', () => rq(lab, { method: 'POST', path: '/_lab/api/comments', body: { page: '/other', name: 'Leo', text: 'a comment on another page', anchor: { selector: 'h1', x: 0.5, y: 0.5 } } })],
  ];
  for (const [what, act] of quiet) {
    const before = open.map((i) => count(devices[i]));
    await act();
    await sleep(250 * opts.slow); // the lab says a save ~100 ms after it
    for (const i of open) await devices[i].idle(500);
    open.forEach((i, k) => {
      const d = devices[i];
      // (After a restart a raw device finds the lab again some seconds later and catches up, as a real browser does: its
      // reload or fetch then lands in whichever quiet save is running, and is no reload for that save.)
      if (!restarted && count(d) !== before[k]) ctx.add('silent', 'spurious-reload', `d${i} on ${plan.devices[i].url} ${d.real || Math.floor(count(d) / 1000) > Math.floor(before[k] / 1000) ? 'reloaded' : 'fetched its page again'} after a save of ${what}, which it does not use`, { what, ...(d.real ? { browser: plan.browser } : {}) });
    });
  }
  // A file the page uses is touched, its bytes the same (a build that writes its output again, a checkout): a reload
  // then changes nothing. The contract doesn't say whether that counts as a change.
  const scripts = new Set(open.flatMap((i) => loadsOf(PAGES[plan.devices[i].page].file).filter((o) => o.kind === 'js').map((o) => o.file)));
  for (const f of scripts) {
    if (read(f) === null) continue;
    const before = open.map((i) => devices[i].reloads);
    fs.writeFileSync(abs(f), fs.readFileSync(abs(f)));
    await sleep(400 * opts.slow);
    if (open.some((i, k) => devices[i].reloads !== before[k])) ctx.add('unclear', 'reload-for-same-bytes', `${f} was written again with the same bytes and the page reloaded`, {});
  }
  // And after all that the devices still show the disk.
  for (const i of open) {
    await devices[i].idle(500);
    const w = await wrong(i);
    if (w) ctx.add('silent', w[0], `d${i} after the quiet saves: ${w[1]}`, { ...w[2], phase: 'quiet' });
  }
}
