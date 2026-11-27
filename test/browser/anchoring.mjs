// How pins find their spot again after the page changes (src/widget/anchoring.ts), in Safari's engine (WebKit) and
// Chrome's. No lab server: the module is bundled on its own and run on small pages. Not part of `npm test`; CI runs it
// in the `browser` job. Run: node test/browser/anchoring.mjs   (needs playwright; NODE_PATH can point at one).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { playwright, engines, tmp, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });

const WIDGET = fileURLToPath(new URL('../../src/widget/', import.meta.url));
const TMP = tmp('labit-anchoring-');
const OUT = path.join(TMP, 'anchoring.js');
// The anchoring module with the part that tries a question's choices in the page (trial.ts, and its swap, tryout.ts,
// handed over as the widget's part() would), in one bundle: they share the module's state, as they do in the widget.
const SRC = path.join(TMP, 'entry.ts');
fs.writeFileSync(SRC, `export * from ${JSON.stringify(WIDGET + 'anchoring.ts')};\nexport { bindTrial, tryRow, untry } from ${JSON.stringify(WIDGET + 'trial.ts')};\nexport * as tryout from ${JSON.stringify(WIDGET + 'tryout.ts')};\n`);
execFileSync('npx', ['--yes', 'esbuild@0.25.12', SRC, '--bundle', '--format=iife', '--global-name=A', `--outfile=${OUT}`, '--log-level=warning']);
const BUNDLE = fs.readFileSync(OUT, 'utf8');

// A page with the module bound to a stand-in widget, and helpers to pin and to place a pin.
const open = async (ctx, body) => {
  const p = await ctx.newPage();
  await p.setContent(`<!doctype html><meta charset="utf-8"><style>body{margin:20px;font:16px/1.4 sans-serif}</style><body>${body}</body>`);
  await p.addScriptTag({ content: BUNDLE });
  await p.evaluate(() => {
    const host = document.createElement('div');
    document.documentElement.append(host);
    const el = (tag) => document.createElement(tag);
    A.bindAnchoring({ host, layer: host, el, store: { get: () => '', set: () => {} } });
    A.bindTrial({ host, part: async () => A.tryout });
    // The middle of a word on the page, in window pixels.
    window.wordAt = (word, root = document.body) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        const i = t.data.search(new RegExp(`\\b${word}\\b`));
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(t, i);
        r.setEnd(t, i + word.length);
        const b = r.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2, left: b.left + scrollX, right: b.right + scrollX, top: b.top + scrollY, bottom: b.bottom + scrollY };
      }
      return null;
    };
  });
  return p;
};

try {
  for (const eng of engines('chromium,webkit')) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });

      // 1. Cards reordered and the pinned one removed: the card now at the old path is not it.
      let p = await open(ctx, '<div id="list"><div class="card">Alpha card</div><div class="card">Beta card</div><div class="card">Gamma card</div></div>');
      let r = await p.evaluate(() => {
        const b = document.querySelectorAll('.card')[1].getBoundingClientRect();
        const a = A.anchorAt(b.left + 2, b.top + 2);
        a.kind = 'element'; // a click on the card, not on its words
        delete a.quote;
        document.getElementById('list').innerHTML = '<div class="card">Gamma card</div><div class="card">Alpha card</div><div class="card">Delta card</div>';
        return A.position(a);
      });
      check(eng, 'reordered twins: a pin whose card is gone shows as moved', r.moved === true, JSON.stringify(r));
      r = await p.evaluate(() => {
        document.getElementById('list').innerHTML = '<div class="card">Alpha card</div><div class="card">Beta card</div><div class="card">Gamma card</div>';
        const b = document.querySelectorAll('.card')[1].getBoundingClientRect();
        const a = A.anchorAt(b.left + 2, b.top + 2);
        a.kind = 'element';
        delete a.quote;
        document.getElementById('list').innerHTML = '<div class="card">Gamma card</div><div class="card">Alpha card</div><div class="card">Beta card</div>';
        const now = document.querySelectorAll('.card')[2].getBoundingClientRect();
        const at = A.position(a);
        return { at, top: now.top + scrollY, bottom: now.bottom + scrollY };
      });
      check(eng, 'reordered twins: a pin follows its card by its words', !r.at.moved && r.at.top >= r.top && r.at.top <= r.bottom, JSON.stringify(r));
      await p.close();

      // 2. The same words in two sections: the pin stays in its own box, not the nearer twin in the other one.
      p = await open(ctx, `<section id="s1"><ul><li class="item">Same words</li></ul></section>
        <section id="s2"><div id="pad"></div><ul><li class="item">Same words</li></ul></section>`);
      r = await p.evaluate(() => {
        const li = document.querySelector('#s2 li').getBoundingClientRect();
        const a = A.anchorAt(li.left + 2, li.top + 2);
        a.kind = 'element';
        delete a.quote;
        delete a.section;
        // A new item before it (its path now leads to that one), and room pushing it far below the other section's twin.
        document.querySelector('#s2 ul').insertAdjacentHTML('afterbegin', '<li class="item">A new item</li>');
        document.getElementById('pad').style.height = '900px';
        const now = document.querySelectorAll('#s2 li')[1].getBoundingClientRect();
        return { a: { inside: a.inside, block: a.block }, at: A.position(a), top: now.top + scrollY, bottom: now.bottom + scrollY };
      });
      check(eng, 'twins in two sections: searched inside its own box first', !r.at.moved && r.at.top >= r.top && r.at.top <= r.bottom, JSON.stringify(r));
      await p.close();

      // 2b. A word edited ("A" to "a)") while the same word stands in another section: the pin stays in its own section,
      // on its span, and the other section's twin is neither shown nor saved as its new spot.
      p = await open(ctx, `<div id="g"><h2>5 · Letters</h2><div class="card"><span class="k">A</span><span class="k">B</span></div>
        <h2>8 · Letters in rings</h2><div class="card"><span class="k">A</span><span class="k">B</span></div></div>`);
      r = await p.evaluate(() => {
        const first = document.querySelector('#g .card .k').getBoundingClientRect();
        const a = A.anchorAt(first.left + 2, first.top + 2);
        a.kind = 'element';
        delete a.quote;
        document.querySelector('#g .card .k').textContent = 'a)';
        const node = A.findTarget(a);
        const cards = [...document.querySelectorAll('#g .card')];
        return { section: a.section, inside: a.inside, inFirst: cards[0].contains(node), inSecond: cards[1].contains(node), saved: A.foundAt(a), moved: A.position(a).moved || false, told: A.spotChanged(a) };
      });
      check(eng, 'an edited word is told to the lab (was, now, its element), in the same section', r.told?.was === 'A' && r.told.now === 'a)' && r.told.element === '<span class="k">' && !r.told.away && !r.told.gone, JSON.stringify(r.told));
      check(eng, 'an edited word: the pin stays on its span in its own section, not on the twin in another', r.section === '5 · Letters' && r.inFirst && !r.inSecond && r.saved === null && !r.moved, JSON.stringify(r));
      // Its span is gone too (a new first row): the nearest of its kind in the same section, still not the other one.
      r = await p.evaluate(() => {
        const first = document.querySelector('#g .card .k');
        const a = A.anchorAt(first.getBoundingClientRect().left + 2, first.getBoundingClientRect().top + 2);
        a.kind = 'element';
        delete a.quote;
        a.text = 'A';
        first.replaceWith(Object.assign(document.createElement('i'), { textContent: 'x' }));
        const node = A.findTarget(a);
        const cards = [...document.querySelectorAll('#g .card')];
        return { found: node && node.textContent, inFirst: Boolean(node) && cards[0].contains(node), saved: A.foundAt(a), told: A.spotChanged(a) };
      });
      check(eng, 'its span removed: the lab is told its words are gone, and the other section is not named as its place', r.told?.was === 'A' && !r.told.away, JSON.stringify(r.told));
      check(eng, 'its span removed: never the twin in another section, and never the span that came to sit at its path (it is lost, and told so)', r.found === null && r.saved === null && r.told?.was === 'A', JSON.stringify(r));
      // Its section is gone altogether (the heading was removed): then another section's twin may be it.
      r = await p.evaluate(() => {
        const cards = document.querySelectorAll('#g .card');
        const second = cards[1].querySelector('.k').getBoundingClientRect();
        const a = A.anchorAt(second.left + 2, second.top + 2);
        a.kind = 'element';
        delete a.quote;
        a.section = 'A section that was removed';
        a.selector = '#nowhere';
        const node = A.findTarget(a);
        return { found: node && node.textContent, anywhere: Boolean(node) };
      });
      check(eng, 'its section gone: found in another one, as before', r.anywhere, JSON.stringify(r));
      // Untouched words say nothing; removed ones are told as gone.
      r = await p.evaluate(() => {
        const k = document.querySelectorAll('#g .card')[1].querySelector('.k');
        const a = A.anchorAt(k.getBoundingClientRect().left + 2, k.getBoundingClientRect().top + 2);
        a.kind = 'element';
        delete a.quote;
        const same = A.spotChanged(a);
        const card = k.parentElement;
        const sel = a.selector;
        card.remove();
        return { same, gone: A.spotChanged({ ...a, selector: sel }) };
      });
      check(eng, 'words still there: nothing to tell; element gone: told as gone', r.same === null && r.gone?.gone === true && r.gone.was === 'A', JSON.stringify(r));
      await p.close();

      // 3. A pin on a word: words added before it in the same paragraph, the pin stays on the word.
      p = await open(ctx, '<p id="t" style="width:400px">Some words here and the target word sits in the middle of this line of text.</p>');
      r = await p.evaluate(() => {
        const w = wordAt('target');
        const a = A.anchorAt(w.x, w.y, true);
        document.getElementById('t').firstChild.data = 'Lots of brand new words came first, pushing everything on. ' + document.getElementById('t').firstChild.data;
        return { kind: a.kind, at: A.position(a), word: wordAt('target') };
      });
      check(eng, 'a pin on a word stays on the word when text before it changes', r.kind === 'text' && !r.at.moved && r.at.left >= r.word.left && r.at.left <= r.word.right && r.at.top >= r.word.top && r.at.top <= r.word.bottom, JSON.stringify(r));
      await p.close();

      // 6. A pin on words straight in the page (no element of their own): found again by its quote, moved when gone.
      p = await open(ctx, '<div id="top"></div>Loose text with a findme word in it.');
      r = await p.evaluate(() => {
        const w = wordAt('findme');
        const a = A.anchorAt(w.x, w.y, true);
        document.getElementById('top').style.height = '300px';
        const at = A.position(a);
        const word = wordAt('findme');
        document.body.lastChild.data = 'Loose text, the word was taken out.';
        return { selector: a.selector, kind: a.kind, at, word, gone: A.position(a) };
      });
      check(eng, 'a pin on words in the page follows them by its quote', r.kind === 'text' && !r.at.moved && r.at.top >= r.word.top && r.at.top <= r.word.bottom, JSON.stringify(r));
      check(eng, 'a pin on words in the page shows as moved when they are gone', r.gone.moved === true, JSON.stringify(r.gone));
      await p.close();

      // 7. Made-up ids and classes are not the element's identity; a test id is.
      p = await open(ctx, `<button id=":r3:" class="btn svelte-1abc2de _card_1x2y3">Go</button>
        <div data-testid="panel"><span class="note">noted</span></div>`);
      r = await p.evaluate(() => {
        const b = document.querySelector('button').getBoundingClientRect();
        const a = A.anchorAt(b.left + 2, b.top + 2);
        const s = document.querySelector('.note').getBoundingClientRect();
        const n = A.anchorAt(s.left + 2, s.top + 2);
        // An older pin saved the made-up names; the next build makes new ones.
        const old = { ...a, selector: '#\\:r3\\:', element: '<button id=":r3:" class="btn svelte-1abc2de _card_1x2y3">' };
        const btn = document.querySelector('button');
        btn.id = ':r9:';
        btn.className = 'btn svelte-9zz8yy7 _card_8q7w6';
        const now = btn.getBoundingClientRect();
        return { selector: a.selector, element: a.element, named: n.selector, at: A.position(a), old: A.position(old), top: now.top + scrollY, bottom: now.bottom + scrollY };
      });
      check(eng, 'made-up ids are left out of the selector', !/r3/.test(r.selector), r.selector);
      check(eng, 'made-up ids and classes are left out of the tag', r.element === '<button class="btn">', r.element);
      check(eng, 'a test id names the element', r.named.startsWith('[data-testid="panel"]'), r.named);
      check(eng, 'a pin is found again when the made-up names change', !r.at.moved && r.at.top >= r.top && r.at.top <= r.bottom, JSON.stringify(r.at));
      check(eng, 'an older pin with made-up names is found again too', !r.old.moved && r.old.top >= r.top && r.old.top <= r.bottom, JSON.stringify(r.old));
      await p.close();

      // 8. A pin in the space between two blocks stays between them when the page grows above (it showed as moved).
      p = await open(ctx, `<main><div id="top"></div><section class="a"><h2>Alpha</h2><p>one</p></section>
        <section class="b" style="margin-top:80px"><h2>Beta</h2><p>two</p></section></main>`);
      r = await p.evaluate(() => {
        const [a, b] = [document.querySelector('.a'), document.querySelector('.b')];
        const gap = () => ({ top: a.getBoundingClientRect().bottom + scrollY, bottom: b.getBoundingClientRect().top + scrollY });
        const m = document.querySelector('main').getBoundingClientRect();
        const y = a.getBoundingClientRect().bottom + 30;
        const anchor = A.anchorAt(m.left + 200, y);
        const same = A.position(anchor);
        document.getElementById('top').style.height = '500px';
        const grown = { at: A.position(anchor), gap: gap() };
        a.remove();
        return { said: [anchor.gapAbove, anchor.gapBelow], same, put: y + scrollY, grown, alone: A.position(anchor), below: b.getBoundingClientRect().top + scrollY };
      });
      check(eng, 'a gap pin names the blocks above and below it', /Alpha/.test(r.said[0]) && /Beta/.test(r.said[1]), JSON.stringify(r.said));
      check(eng, 'a gap pin on an unchanged page is where it was put', !r.same.moved && Math.abs(r.same.top - r.put) < 1, JSON.stringify(r.same));
      check(eng, 'a gap pin stays between its two blocks when the page grows above', !r.grown.at.moved && r.grown.at.top >= r.grown.gap.top && r.grown.at.top <= r.grown.gap.bottom, JSON.stringify(r.grown));
      check(eng, 'a gap pin whose upper block is gone sits just above the lower one', !r.alone.moved && r.alone.top <= r.below && r.alone.top >= r.below - 16, JSON.stringify([r.alone, r.below]));
      await p.close();

      // A gap pin after the last block (nothing below it) whose block is then removed: it sits at the box's end
      // instead of crashing the widget (one such pin stopped the bar from drawing on its page).
      p = await open(ctx, `<main style="padding-bottom:120px"><section class="a"><h2>Alpha</h2><p>one</p></section>
        <section class="b"><h2>Beta</h2><p>two</p></section></main>`);
      r = await p.evaluate(() => {
        const b = document.querySelector('.b');
        const m = document.querySelector('main').getBoundingClientRect();
        const anchor = A.anchorAt(m.left + 200, b.getBoundingClientRect().bottom + 40);
        b.remove();
        // where the box now holds blocks, and where it ends (its padding under the last one)
        const end = { last: document.querySelector('.a').getBoundingClientRect().bottom + scrollY, box: document.querySelector('main').getBoundingClientRect().bottom + scrollY };
        try {
          return { said: [anchor.gapAbove, anchor.gapBelow], at: A.position(anchor), end };
        } catch (e) {
          return { said: [anchor.gapAbove, anchor.gapBelow], error: String(e) };
        }
      });
      check(eng, 'a gap pin after the last block names only the block above', /Beta/.test(r.said[0]) && !r.said[1], JSON.stringify(r.said));
      check(eng, 'a gap pin after a removed last block does not throw', !r.error && Number.isFinite(r.at?.top), JSON.stringify(r));
      check(eng, '… and sits at the box\'s end, under its last block', r.at?.top >= r.end?.last - 1 && r.at?.top <= r.end?.box + 1, JSON.stringify(r));
      await p.close();

      // A gap between look-alikes (cards with no words of their own) is the one it was put in.
      p = await open(ctx, '<main><div id="top"></div>' + '<div class="card" style="height:40px;margin-bottom:60px;background:#ccc"></div>'.repeat(4) + '</main>');
      r = await p.evaluate(() => {
        const cards = document.querySelectorAll('.card');
        const m = document.querySelector('main').getBoundingClientRect();
        const y = cards[1].getBoundingClientRect().bottom + 20;
        const anchor = A.anchorAt(m.left + 200, y);
        const same = A.position(anchor);
        document.getElementById('top').style.height = '90px';
        return { same, put: y + scrollY, grown: A.position(anchor), top: cards[1].getBoundingClientRect().bottom + scrollY, bottom: cards[2].getBoundingClientRect().top + scrollY };
      });
      check(eng, 'a gap pin between look-alikes is where it was put', !r.same.moved && Math.abs(r.same.top - r.put) < 1, JSON.stringify(r));
      check(eng, 'a gap pin between look-alikes stays in its own gap when the page grows above', !r.grown.moved && r.grown.top >= r.top && r.grown.top <= r.bottom, JSON.stringify(r));
      await p.close();

      // 9. The pinned element is gone (another tag now): its words are looked for in the whole page.
      p = await open(ctx, '<div id="pad"></div><p class="lede">Intro words, then the special phrase sits here, and more after.</p><p>Elsewhere a phrase too.</p>');
      r = await p.evaluate(() => {
        const w = wordAt('special');
        const a = A.anchorAt(w.x, w.y, true);
        const swap = (html) => (document.querySelector('.lede, .intro').outerHTML = html);
        document.getElementById('pad').style.height = '200px';
        swap('<div class="intro">Intro words, then the special phrase sits here, and more after.</div>');
        const sure = { at: A.position(a), word: wordAt('special') };
        swap('<div class="intro">Intro words, then the precious phrase sits here, and more after.</div>');
        const box = document.querySelector('.intro').getBoundingClientRect();
        const guess = { at: A.position(a), word: { top: box.top + scrollY, bottom: box.bottom + scrollY }, node: A.findTarget(a)?.className };
        swap('<div class="intro">Nothing of it is left.</div>');
        return { quote: a.quote, sure, guess, gone: A.position(a) };
      });
      check(eng, 'element gone, words still there in the same company: the pin sits on them', !r.sure.at.moved && r.sure.at.top >= r.sure.word.top && r.sure.at.top <= r.sure.word.bottom && r.sure.at.left >= r.sure.word.left && r.sure.at.left <= r.sure.word.right, JSON.stringify(r.sure));
      check(eng, 'element made another tag and a word edited: the pin follows to it (its words nearly as they were)', r.guess.node === 'intro' && !r.guess.at.moved && r.guess.at.top >= r.guess.word.top && r.guess.at.top <= r.guess.word.bottom, JSON.stringify(r.guess));
      check(eng, 'element and words gone: moved, at its old height', r.gone.moved === true, JSON.stringify(r.gone));
      await p.close();

      // 10. A pin found again on another element says where it is now (to save); one at its own path says nothing.
      p = await open(ctx, '<div id="list"><div class="card">Alpha card</div><div class="card">Beta card</div><div class="card">Gamma card</div></div>');
      r = await p.evaluate(() => {
        const b = document.querySelectorAll('.card')[1].getBoundingClientRect();
        const a = A.anchorAt(b.left + 2, b.top + 2);
        a.kind = 'element';
        delete a.quote;
        const still = A.foundAt(a);
        document.getElementById('list').innerHTML = '<div class="card">Gamma card</div><div class="card">Alpha card</div><div class="card">Beta card</div>';
        const now = A.foundAt(a);
        const healed = now && A.foundAt({ ...a, ...now });
        document.getElementById('list').innerHTML = '<div class="card">Gamma card</div><div class="card">Alpha card</div><div class="card">Delta card</div>';
        return { was: a.selector, still, now, healed, lost: A.foundAt(a), third: document.querySelectorAll('.card')[2].getBoundingClientRect().top + scrollY };
      });
      check(eng, 'a pin at its own path has nothing to save', r.still === null, JSON.stringify(r.still));
      check(eng, 'a pin found again on another element says its new path and place', r.now && r.now.selector !== r.was && /nth-of-type\(3\)/.test(r.now.selector) && Math.abs(r.now.docY - r.third) < 6 && r.now.eh > 0, JSON.stringify(r.now));
      check(eng, 'once saved, it has nothing more to say', r.healed === null, JSON.stringify(r.healed));
      check(eng, 'a pin that is lost saves nothing', r.lost === null, JSON.stringify(r.lost));
      await p.close();
      // 11. A question's choice tried in the sentence (trial.ts) moves no pin: the other pins stay on their words, the
      // page is as it was after, and the quoted words are found again (the words' places are read again, not remembered).
      p = await open(ctx, '<p id="up">Above the claim.</p><p id="claim">labit puts the <a href="#x">full guide</a> on the page, not in chat. And a second sentence.</p><p id="low">A word after: special.</p>');
      r = await p.evaluate(async () => {
        const at = (w) => { const m = wordAt(w); return A.anchorAt(m.x, m.y); };
        const quote = at('guide');
        quote.quote = { exact: 'the full guide on the page', prefix: 'labit puts ', suffix: ', not in chat' };
        const pins = { up: at('Above'), low: at('special') };
        const where = () => Object.fromEntries(Object.entries({ ...pins, quote }).map(([k, a]) => [k, A.position(a)]));
        const html = document.body.innerHTML;
        const before = where();
        await A.tryRow({ id: 'c', anchor: quote }, { id: 'q' }, 0, 'this short guide on the page, which is a longer way to say it and wraps the line', {}); // the first try waits for its part
        const during = where();
        const tried = document.getElementById('claim').textContent;
        const lowWord = wordAt('special');
        A.untry();
        return { before, during, after: where(), same: document.body.innerHTML === html, tried, lowWord, low: A.position(pins.low) };
      });
      const rounded = (o) => JSON.stringify(Object.entries(o).map(([k, v]) => [k, Math.round(v.left), Math.round(v.top), Boolean(v.moved)]));
      check(eng, 'a try moves no pin: the pin above stays, the one below follows its word', /this short guide/.test(r.tried) && rounded({ up: r.before.up }) === rounded({ up: r.during.up }) && !r.during.low.moved && r.during.low.top >= r.lowWord.top - 2 && r.during.low.top <= r.lowWord.bottom + 2 && r.during.low.top > r.before.low.top, JSON.stringify([r.before.low, r.during.low, r.lowWord]));
      check(eng, 'after the try everything is as it was: the page, every pin, the quote found again', r.same && rounded(r.before) === rounded(r.after) && !r.after.quote.moved, JSON.stringify([r.same, rounded(r.before), rounded(r.after)]));
      await p.close();

      // A long list: the pinned row is past the first 400 of its kind, and a row above it is taken out.
      p = await open(ctx, `<div id="list">${Array.from({ length: 520 }, (_, i) => `<div class="row">Row number ${i}</div>`).join('')}</div>`);
      r = await p.evaluate(() => {
        const row = document.querySelectorAll('.row')[450];
        row.scrollIntoView();
        const b = row.getBoundingClientRect();
        const a = A.anchorAt(b.left + 2, b.top + 2);
        a.kind = 'element';
        delete a.quote;
        document.querySelectorAll('.row')[440].remove();
        const now = A.foundAt(a);
        return { now, top: row.getBoundingClientRect().top + scrollY };
      });
      check(eng, 'a pin far down a long list is found again when a row above it goes', r.now && Math.abs(r.now.docY - r.top) < 30, JSON.stringify(r.now));
      await p.close();

      // An area over one row of a panel (Leo, 23 Nov: "u moved this pin wrong"): it is on the panel (the area is taller than
      // the row), as a share of it. Rows above it made shorter: the area stays on its row. Its own words partly changed: on
      // it still, shown unsure. The row and two others deleted: lost, never on the block below the shrunken panel.
      const rowsHtml = (rows) => `<div id="panel" style="width:600px;background:#eee">${rows.map(([n, more]) => `<div class="row" style="padding:8px"><b>${n}</b> <span>${n === 'FERN' ? '18h deep pool: won 1 of 5' : 'day-1 tokens · you won 8 of 11'}</span>${more ? '<p style="margin:0">Organic 77 · typical +40%</p>' : ''}</div>`).join('')}</div><div id="side"><b>Token</b> MC / Liq <span>Price / 24h</span><p>ZEST IRIS WISP CALDA AXL FERN</p></div>`;
      const ROWS = ['ZEST', 'IRIS', 'WISP', 'CALDA', 'AXL', 'FERN'];
      const areaCase = async (after) => {
        const ap = await open(ctx, rowsHtml(ROWS.map((n) => [n, true])));
        const got = await ap.evaluate(([html]) => {
          const fern = () => [...document.querySelectorAll('.row')].find((n) => /FERN/.test(n.textContent));
          const q = fern().getBoundingClientRect();
          const a = A.zoneAnchor({ x0: q.left + 2, y0: q.top - 10, x1: q.left + 300, y1: q.bottom + 10 });
          const same = A.position(a);
          document.body.innerHTML = html;
          const at = A.position(a);
          const f = fern()?.getBoundingClientRect();
          const mid = at.zone && at.zone.top + at.zone.height / 2 - scrollY;
          return { element: a.element, sameOn: same.zone && Math.abs(same.zone.top - (q.top - 10 + scrollY)) < 1 && !same.moved && !same.why, moved: Boolean(at.moved), why: at.why || '', onFern: Boolean(f && mid >= f.top && mid <= f.bottom), told: A.spotChanged(a) };
        }, [after]);
        await ap.close();
        return got;
      };
      r = await areaCase(rowsHtml(ROWS.map((n) => [n, n === 'FERN'])));
      check(eng, 'an area over a row is on its panel, and on an unchanged page stays where it was drawn', r.element === '<div id="panel">' && r.sameOn, JSON.stringify(r));
      check(eng, 'an area over a row: rows above made shorter, it stays on its row', r.onFern && !r.moved && !r.why, JSON.stringify(r));
      r = await areaCase(rowsHtml(ROWS.map((n) => [n, false])));
      check(eng, 'an area over a row: its own words partly changed, on it still, shown unsure', r.onFern && !r.moved && r.why === 'changed', JSON.stringify(r));
      r = await areaCase(rowsHtml(ROWS.filter((n) => !['CALDA', 'AXL', 'FERN'].includes(n)).map((n) => [n, false])));
      check(eng, 'an area over a row: the row deleted, it is lost (not on the block below), and told as gone', r.moved && r.told?.gone === true, JSON.stringify(r));

      // What an agent needs to change the thing: the rules that reach it (with the @media and the file), its box, and Astro's source.
      p = await open(ctx, '<style>.btn{padding:8px 12px}@media (max-width: 600px){.btn{padding:2px}}@media print{.btn{color:red}}.other{color:blue}</style><div data-astro-source-file="/home/me/site/src/pages/index.astro" data-astro-source-loc="12:3"><button class="btn" style="width:5000px">Buy</button></div>');
      r = await p.evaluate(() => {
        const b = document.querySelector('.btn').getBoundingClientRect();
        const a = A.anchorAt(b.left + 2, b.top + 2);
        return { rules: a.rules, box: a.box, source: a.source };
      });
      check(eng, 'the rules that reach a pin: only the ones that apply now', r.rules === '.btn (inline style)', JSON.stringify(r));
      await p.setViewportSize({ width: 500, height: 700 });
      const narrow = await p.evaluate(() => {
        const b = document.querySelector('.btn').getBoundingClientRect();
        return A.anchorAt(b.left + 2, b.top + 2).rules;
      });
      check(eng, 'on a narrow window the @media rule is named, last (it wins)', narrow === '.btn (inline style); .btn @media (max-width: 600px) (inline style)', narrow);
      check(eng, 'the box says size, padding and display', /^\d+×\d+, padding 8 12 8 12, inline-block/.test(r.box || ''), JSON.stringify(r));
      check(eng, 'an Astro dev page names its source file and line', r.source === 'src/pages/index.astro:12:3', JSON.stringify(r));
      await p.close();
      // ----- the state the control was in when the comment was made (#433); never what a field holds
      const sp = await open(ctx, `<button id="menu" aria-expanded="true">Plans</button>
        <div role="tablist"><button role="tab" aria-selected="true">Monthly</button><button role="tab" aria-selected="false">Yearly</button></div>
        <button id="off" disabled>Pay</button><label><input id="tick" type="checkbox" checked> Remember me</label>
        <dialog open aria-label="Delete project"><button id="del" aria-pressed="false">Delete</button></dialog>
        <p id="plain">Plain words</p><input id="pw" type="password" value="hunter2">`);
      const st = await sp.evaluate(() => Object.fromEntries(['#menu', '[role=tab]', '#off', '#tick', '#del', '#plain', '#pw'].map((s) => {
        const b = document.querySelector(s).getBoundingClientRect();
        return [s, A.anchorAt(b.left + 4, b.top + 4).state || ''];
      })));
      check(eng, 'an open menu button says it is open', st['#menu'] === 'button "Plans" open', JSON.stringify(st));
      check(eng, 'the picked tab says it is selected', st['[role=tab]'] === 'tab "Monthly" selected', st['[role=tab]']);
      check(eng, 'a disabled button says it is disabled', st['#off'] === 'button "Pay" disabled', st['#off']);
      check(eng, 'a ticked checkbox says it is checked', st['#tick'] === 'input "Remember me" checked', st['#tick']);
      check(eng, 'inside an open dialog: the button\'s state and the dialog', st['#del'] === 'button "Delete" not pressed; inside open dialog "Delete project"', st['#del']);
      check(eng, 'plain words have no state', st['#plain'] === '', st['#plain']);
      check(eng, 'a password field never gives what it holds', !/hunter2/.test(JSON.stringify(st)), st['#pw']);
      await sp.close();
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 });
}
finish();
