// What a phone does when a thread opens and closes, kept cheap (iOS 27 simulator, 27 Nov: opening a thread on a page with
// a pin on a nav hidden at phone width cost 50-80 ms, most of it the page restyled and read again for nothing):
// - a pin on an element that isn't shown at this width is placed by the script, not tied to its element by the browser;
// - the held pins' stylesheet is written only when a rule changes: not on a scroll, an open or a close;
// - writing that stylesheet keeps what was read of the page's words; a change to the page itself does not;
// - the room a sheet made below the page's end shrinks once the scroll rests, not on every scroll event;
// - a resolved thread that isn't shown (done ones hidden) has no spot looked for; shown again, its pin is on its words;
// - only the first sheet after the page loads waits a frame before it slides in (data-opening).
// Run: node test/browser/phoneopen.mjs (needs playwright). Not part of `npm test`; CI runs it in the `browser` job.
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });
const DIR = tmp('labit-phoneopen-');
const PORT = String(claimPort(6130, 30));
const B = `http://localhost:${PORT}`;
const paras = Array.from({ length: 24 }, (_, i) => `<p id="p${i}">paragraph ${i} with some words to read on a phone</p>`).join('');
fs.writeFileSync(path.join(DIR, 'index.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>P</title>
<style>body{margin:0 20px;font:16px/1.5 sans-serif} #side{position:sticky;top:0} #bar{position:sticky;top:0;background:#eee;padding:8px} @media (max-width:600px){#side{display:none}}</style>
<body><nav id="side"><a href="#a">Side nav, hidden on phones</a></nav><header id="bar"><b>Sticky bar</b></header>${paras}<p id="last">The last paragraph of the page.</p></body>`);
const server = startLab(DIR, labEnv({}, { settings: false }), { root: '.', port: PORT });
await labUp(B);
const token = JSON.parse(fs.readFileSync(path.join(DIR, '.lab', 'server.json'), 'utf8')).token;
const post = (body) => fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-admin': token }, body: JSON.stringify({ page: '/index', name: 'Sam', ...body }) }).then((r) => r.json());
const pin = (sel, text, docY) => post({ text, anchor: { selector: sel, x: 0.3, y: 0.5, docX: 60, docY, width: 390, element: `<${sel === '#side' ? 'nav' : sel === '#bar' ? 'header' : 'p'} id="${sel.slice(1)}">` } });
await pin('#side', 'on the hidden nav', 20);
await pin('#bar', 'on the sticky bar', 60);
await pin('#p3', 'an open one', 300);
await pin('#last', 'at the end', 1300);
// The viewer's own (lab-name tester): nothing new in it for them, so with done ones hidden it shows no pin.
const done = (await post({ name: 'tester', text: 'a resolved one', anchor: { selector: '#p8', x: 0.3, y: 0.5, docX: 60, docY: 600, width: 390, element: '<p id="p8">' } })).comment;
await post({ action: 'resolve', id: done.id });

// Pins by their number: 1 the hidden nav, 2 the sticky bar, 3 #p3, 4 the last paragraph (the resolved one has none).
const label = (n) => `[data-lab-comments] .pin[aria-label^="comment ${n} by"]`;
try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: eng !== 'firefox', deviceScaleFactor: 2 });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'tester'); localStorage.setItem('lab-on', '1'); localStorage.setItem('lab-hide-done', '1'); });
      const p = await ctx.newPage();
      await p.goto(`${B}/index`);
      await p.waitForFunction(() => document.querySelector('[data-lab-comments]')?.shadowRoot?.querySelectorAll('.pin').length >= 4, null, { timeout: 8000 });
      await sleep(800);
      // Watches: writes of the held pins' sheet, the page's words read (textContent), the <html> style attribute, and
      // the resolved thread's spot looked for.
      await p.evaluate(() => {
        const w = (window.__w = { sheet: 0, words: 0, html: 0, p8: 0 });
        const own = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
        Object.defineProperty(Node.prototype, 'textContent', { ...own, get() { if (this instanceof Element && document.body.contains(this)) w.words++; return own.get.call(this); } });
        // Its spot is looked for by its selector first (anchoring.ts query).
        const qs = Document.prototype.querySelector;
        Document.prototype.querySelector = function (sel) { if (sel === '#p8') w.p8++; return qs.call(this, sel); };
        new MutationObserver((l) => (w.html += l.length)).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
        const sheetWatch = new MutationObserver((l) => (w.sheet += l.length));
        const hook = () => { const s = document.getElementById('lab-pinhold'); if (s && !s.__watched) { s.__watched = true; sheetWatch.observe(s, { childList: true, characterData: true, subtree: true }); } };
        hook();
        window.__hook = hook;
      });
      const nav = await p.evaluate(() => ({ anchored: document.getElementById('side').hasAttribute('data-lab-anchor'), bar: document.getElementById('bar').hasAttribute('data-lab-anchor') }));
      check(eng, 'a pin on an element not shown at this width is not tied to it (nor, on a phone, the sticky bar\'s: the script places it)', !nav.anchored && !nav.bar, JSON.stringify(nav));
      const navPin = await p.evaluate((sel) => { const n = document.querySelector('[data-lab-comments]').shadowRoot.querySelector(sel.replace('[data-lab-comments] ', '')); return { part: n?.getAttribute('part') || '', vis: n && getComputedStyle(n).visibility }; }, label(1));
      check(eng, 'and its pin is the script\'s, out of sight', !navPin.part && navPin.vis === 'hidden', JSON.stringify(navPin));

      const reset = () => p.evaluate(() => { window.__hook(); Object.assign(window.__w, { sheet: 0, words: 0, html: 0, p8: 0 }); });
      const openClose = async (n) => {
        await p.tap(label(n));
        await sleep(700);
        await p.evaluate(() => document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.scrim').click()); // a tap on the dimmed page
        await sleep(700);
      };
      // Each time a sheet waits its first frame out (data-opening).
      await p.evaluate(() => {
        const host = document.querySelector('[data-lab-comments]');
        window.__openings = [];
        new MutationObserver(() => host.hasAttribute('data-opening') && window.__openings.push(performance.now())).observe(host, { attributes: true, attributeFilter: ['data-opening'] });
      });
      await p.evaluate(() => scrollTo(0, 120));
      await sleep(300);
      await reset();
      await openClose(3);
      await p.evaluate(() => scrollTo(0, 260));
      await sleep(300);
      await openClose(3);
      const w1 = await p.evaluate(() => ({ ...window.__w, openings: window.__openings.length }));
      check(eng, 'scrolling, opening and closing threads leaves the held pins\' sheet unwritten', w1.sheet === 0, JSON.stringify(w1));
      check(eng, 'only the first sheet after the page loads waits a frame to slide in', w1.openings === 1, JSON.stringify(w1));
      check(eng, 'a resolved thread that isn\'t shown has no spot looked for', w1.p8 === 0, JSON.stringify(w1));

      // The page's words: one drawing after the held pins' sheet is written, one after the page itself changed.
      const wordsAfter = async (change) => {
        await p.evaluate(change);
        await reset();
        await openClose(3);
        return p.evaluate(() => window.__w.words);
      };
      const own = await wordsAfter(() => { const s = document.getElementById('lab-pinhold'); s.append(document.createTextNode('/* */')); });
      const page = await wordsAfter(() => document.getElementById('p20').append(' and more words'));
      check(eng, 'the held pins\' sheet written keeps what was read of the page; the page changed reads it again', page > 0 && own * 4 < page, `own ${own}, page ${page}`);

      // The room below the end: a thread at the end opened and closed, then the page scrolled up a step at a time.
      await openClose(4);
      const room0 = await p.evaluate(() => document.documentElement.style.getPropertyValue('--lab-room'));
      await reset();
      for (let i = 0; i < 8; i++) {
        await p.evaluate(() => scrollBy(0, -25));
        await sleep(30);
      }
      const during = await p.evaluate(() => window.__w.html);
      await sleep(400);
      const after = await p.evaluate(() => ({ html: window.__w.html, room: document.documentElement.style.getPropertyValue('--lab-room') }));
      check(eng, 'the room below the page\'s end is not rewritten on each scroll event, and shrinks once the scroll rests', parseFloat(room0) > 0 && during === 0 && after.html >= 1 && parseFloat(after.room || '0') < parseFloat(room0), JSON.stringify({ room0, during, after }));

      // Done ones shown again: the resolved thread's pin is back, on its paragraph.
      await p.evaluate(() => document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.done-btn').click());
      await sleep(600);
      const back = await p.evaluate(() => {
        const pin = [...document.querySelector('[data-lab-comments]').shadowRoot.querySelectorAll('.pin')].find((n) => n.getAttribute('aria-label').includes('done'));
        const r = pin?.getBoundingClientRect();
        const q = document.getElementById('p8').getBoundingClientRect();
        return r ? { top: r.top + r.height, p: q.top, b: q.bottom } : null;
      });
      check(eng, 'shown again, the resolved thread\'s pin is on its paragraph', Boolean(back) && back.top >= back.p - 30 && back.top <= back.b + 30, JSON.stringify(back));
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
finish();
