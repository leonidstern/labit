// Browser checks of how a drag on a page with comments on is read, in Safari's engine (WebKit) and Chrome's, with
// Playwright: a plain drag marks an area wherever it starts (over words too) and never selects the page's text; Shift-drag
// selects words and shows the actions bar; Shift shows the text cursor; a click pins a point; a double-click selects a
// word only with Shift; the page's own fields and links keep their drags.
// Not part of `npm test`; CI runs it in the `browser` job. Run: node test/browser/selection.mjs   (needs the playwright
// package; NODE_PATH can point at a node_modules that has it). Prints one line per check and exits 1 if any fails.
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });

const DIR = tmp('labit-selection-');
const PORT = String(claimPort(5800, 190)); // below 6000: browsers refuse that port (X11), and the page never loads
const B = `http://localhost:${PORT}`;
const env = labEnv({}, { settings: false });
const PAGE = `<!doctype html><meta charset="utf-8"><title>selection</title>
<style>body{margin:30px;max-width:420px;font:18px/1.6 Georgia,serif}</style>
<p id="t">Plain words to drag across in this paragraph of text, quite a few of them.</p>
<p id="u">Another paragraph with <a id="lnk" href="#x">a link right here</a> inside it.</p>
<p><input id="field" value="field text typed here"></p>
<div style="height:900px"></div>`;
let scenes = 0;
let PG = '/index';

const server = startLab(DIR, env, { root: '.', port: PORT, stdio: 'ignore' }); // its log is not read: a full pipe would stop it
fs.writeFileSync(path.join(DIR, 'index.html'), PAGE);
await labUp(B);
const missed = []; // changes to what the page shows that no redraw followed (window.__labDebug)
const comments = async () => (await (await fetch(`${B}/_lab/api/comments?page=${PG}`)).json()).comments;
const inRoot = (p, fn) =>
  p.evaluate((src) => {
    const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot;
    return new Function('r', `return (${src})(r)`)(r);
  }, fn.toString());
// Waits on the condition the next step needs; `ms` is the longest it waits, and it never throws (the check after it reports the real failure).
const until = (p, fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms, polling: 'raf' }).catch(() => {});
const untilRoot = (p, fn, ms) =>
  until(p, (src) => {
    const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot;
    return Boolean(r) && new Function('r', `return (${src})(r)`)(r);
  }, fn.toString(), ms);
// The comment card on selected words is up and still, the cursor in its box.
const cardUp = (p, ms = 700) => untilRoot(p, (r) => { const f = r.querySelectorAll('.float'); return f.length === 1 && f[0].getAnimations().length === 0 && r.activeElement?.localName === 'textarea'; }, ms);
// Until the page has a comment with this text (sent).
async function untilSent(text, ms) {
  for (const end = Date.now() + ms; Date.now() < end && !(await comments()).some((x) => x.text === text); ) await sleep(40);
}
// What the widget shows: a comment card on lit (selected) words, an area drawn, a pin or box for a point.
const look = (p) =>
  inRoot(p, (r) => {
    const box = r.querySelectorAll('.float').length;
    const lit = Boolean(globalThis.CSS?.highlights?.has('lab-quote'));
    return { dlg: box === 1 && lit, zone: r.querySelectorAll('.zone.draft').length, draftPin: r.querySelectorAll('.pin.draft').length, box };
  });
const span = (p, sel, text) =>
  p.evaluate(([sel, text]) => {
    const w = document.createTreeWalker(document.querySelector(sel), NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode()); ) {
      const i = n.data.indexOf(text);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + text.length);
      const rs = [...r.getClientRects()].map((b) => b.toJSON());
      return { first: rs[0], last: rs[rs.length - 1] };
    }
  }, [sel, text]);
async function dragTo(p, [x0, y0], [x1, y1]) {
  await p.mouse.move(x0, y0);
  await p.mouse.down();
  for (let i = 1; i <= 8; i++) await p.mouse.move(x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * i) / 8);
  await p.mouse.up();
}
async function dragWords(p, sel, text, shift = false) {
  const s = await span(p, sel, text);
  if (shift) await p.keyboard.down('Shift');
  await dragTo(p, [s.first.left + 1, s.first.top + s.first.height / 2], [s.last.right - 1, s.last.top + s.last.height / 2]);
  if (shift) await p.keyboard.up('Shift');
  return s;
}

async function scene(browser, run) {
  PG = `/s${++scenes}`;
  fs.writeFileSync(path.join(DIR, `${PG.slice(1)}.html`), PAGE);
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  await ctx.addInitScript(() => localStorage.setItem('lab-name', 'leo'));
  // Debug: every change to what the page shows must be followed by a redraw (window.__labDebug in src/comments.js);
  // a miss is reported here as it happens, so a reload doesn't lose it.
  await ctx.exposeFunction('__labMiss', (s) => missed.push(s));
  await ctx.addInitScript(() => Object.assign(window, { __labDebug: true, __labMissed: { push: (s) => window.__labMiss(s) } }));
  const p = await ctx.newPage();
  await p.goto(B + PG);
  await untilRoot(p, () => true, 1100);
  await sleep(300); // the widget's handlers are in place a moment after its markup
  try {
    await run(p);
  } finally {
    await sleep(100); // two frames for the last change
    await ctx.close();
  }
}

try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      await scene(browser, async (p) => {
        await dragWords(p, '#t', 'words to drag');
        await untilRoot(p, (r) => r.querySelectorAll('.zone.draft').length === 1, 500);
        const l = await look(p);
        check(eng, 'a plain drag over words marks an area, no card on the words', l.zone === 1 && !l.dlg, JSON.stringify(l));
        check(eng, '…and selects none of the page\'s text', (await p.evaluate(() => String(getSelection()))) === '');
        await p.keyboard.type('over words');
        await p.keyboard.press('Enter');
        await untilSent('over words', 700);
        const c = (await comments()).find((x) => x.text === 'over words');
        check(eng, '…saved as an area anchor, not a quote', typeof c?.anchor?.zw === 'number' && !c.anchor.quote?.selected, JSON.stringify(c?.anchor?.kind));
      });
      await scene(browser, async (p) => {
        const s = await dragWords(p, '#t', 'words to drag', true);
        await cardUp(p);
        const l = await look(p);
        check(eng, 'Shift-drag over words opens the comment card at once on them, no area', l.dlg && !l.zone && l.draftPin === 1, JSON.stringify(l));
        await p.keyboard.type('shifted');
        await cardUp(p);
        await p.keyboard.press('Enter');
        await untilSent('shifted', 700);
        const c = (await comments()).find((x) => x.text === 'shifted');
        check(eng, '…its comment is a text anchor quoting exactly the words', c?.anchor?.kind === 'text' && c.anchor.quote?.exact === 'words to drag', JSON.stringify(c?.anchor?.quote));
        check(eng, '…the page\'s text is not left selected', (await p.evaluate(() => String(getSelection()))) === '' && Boolean(s));
      });
      await scene(browser, async (p) => {
        const s = await span(p, '#t', 'drag across');
        const x = s.first.left + 20;
        const y = s.first.top + s.first.height / 2;
        const IBEAM = 'data:image/svg+xml'; // the drawn I-beam with a low ink band at its foot (C3), falling back to text
        const cursor = () => p.evaluate(([x, y]) => ({ shift: document.documentElement.classList.contains('lab-shift-cur'), selectable: document.documentElement.classList.contains('lab-shift'), cursor: getComputedStyle(document.elementFromPoint(x, y)).cursor }), [x, y]);
        await p.mouse.move(x - 5, y);
        await p.mouse.move(x, y);
        await sleep(200);
        const off = await cursor();
        check(eng, 'no Shift: the pin pointer, not the text cursor', !off.shift && !off.cursor.includes(IBEAM), JSON.stringify(off));
        await p.keyboard.down('Shift');
        await until(p, ([x, y]) => document.documentElement.classList.contains('lab-shift-cur') && getComputedStyle(document.elementFromPoint(x, y)).cursor.includes('data:image/svg+xml'), [x, y], 400);
        const on = await cursor();
        check(eng, 'Shift held over words: the drawn I-beam with the ink band at its foot, no pin tip (text as fallback)', on.shift && on.cursor.includes(IBEAM) && on.cursor.includes('%23f0b70a') && !on.cursor.includes('%2324a046') && /,\s*text$/.test(on.cursor), JSON.stringify(on));
        await p.keyboard.up('Shift');
        const quick = await cursor(); // no waiting: the cursor follows the key at once, the text stays selectable a moment longer
        check(eng, '…right after Shift is let go the cursor is no longer the I-beam (text still selectable for the selection)', !quick.shift && !quick.cursor.includes(IBEAM) && quick.selectable, JSON.stringify(quick));
        await until(p, () => !document.documentElement.classList.contains('lab-shift'), null, 700);
        const back = await cursor();
        check(eng, '…Shift let go: the pin pointer again', !back.shift && !back.cursor.includes(IBEAM), JSON.stringify(back));
        const field = await p.locator('#field').boundingBox();
        await p.keyboard.down('Shift');
        await p.mouse.move(field.x + 10, field.y + 5);
        await sleep(200);
        const inField = await p.evaluate(() => getComputedStyle(document.querySelector('#field')).cursor);
        await p.keyboard.up('Shift');
        check(eng, '…and over the page\'s own input its own cursor stays', inField !== 'crosshair' && inField !== 'none', inField);
      });
      await scene(browser, async (p) => {
        await dragWords(p, '#t', 'ords to dra', true); // starts and ends inside words
        await cardUp(p);
        await p.keyboard.type('snap');
        await cardUp(p);
        await p.keyboard.press('Enter');
        await untilSent('snap', 700);
        const c = (await comments()).find((x) => x.text === 'snap');
        check(eng, 'a Shift-drag from inside a word to inside another takes both whole words', c?.anchor?.quote?.exact === 'words to drag', JSON.stringify(c?.anchor?.quote));
      });
      await scene(browser, async (p) => {
        await dragWords(p, '#t', 'aragra', true); // inside "paragraph" only
        await cardUp(p);
        await p.keyboard.type('inside');
        await cardUp(p);
        await p.keyboard.press('Enter');
        await untilSent('inside', 700);
        const c = (await comments()).find((x) => x.text === 'inside');
        check(eng, '…a Shift-drag inside one word keeps exactly its letters', c?.anchor?.quote?.exact === 'aragra', JSON.stringify(c?.anchor?.quote));
      });
      await scene(browser, async (p) => {
        await dragTo(p, [700, 40], [900, 120]); // right of the column: nothing to select there
        await untilRoot(p, (r) => r.querySelectorAll('.zone.draft').length === 1, 400);
        const l = await look(p);
        check(eng, 'a drag from empty space marks an area, no card on the words', l.zone === 1, JSON.stringify(l));
        await p.keyboard.type('area');
        await p.keyboard.press('Enter');
        await untilSent('area', 700);
        const c = (await comments()).find((x) => x.text === 'area');
        check(eng, '…saved as an area anchor', typeof c?.anchor?.zw === 'number' && c.anchor.kind !== 'text', JSON.stringify(c?.anchor?.kind));
      });
      await scene(browser, async (p) => {
        const s = await span(p, '#t', 'drag across');
        await p.mouse.click(s.first.left + 10, s.first.top + 10);
        await untilRoot(p, (r) => r.querySelectorAll('.float').length === 1, 500);
        const l = await look(p);
        check(eng, 'a plain click on words places a point pin, no card on the words', l.box === 1 && !l.dlg, JSON.stringify(l));
        await p.keyboard.type('point');
        await p.keyboard.press('Enter');
        await untilSent('point', 700);
        const c = (await comments()).find((x) => x.text === 'point');
        check(eng, '…saved as a point (no quote selected)', Boolean(c) && !c.anchor.quote && c.anchor.kind !== 'text' && c.anchor.zw === undefined, JSON.stringify(c?.anchor?.kind));
      });
      // A click on a word, the mouse moving a pixel or two between down and up: still a point pin, never a quote, nothing lit
      await scene(browser, async (p) => {
        const s = await span(p, '#t', 'paragraph');
        const [x, y] = [(s.first.left + s.first.right) / 2, s.first.top + s.first.height / 2];
        for (const [dx, dy] of [[0, 0], [2, 1], [-2, 0], [1, -2]]) {
          await p.mouse.move(x, y);
          await p.mouse.down();
          await p.mouse.move(x + dx, y + dy);
          await p.mouse.up();
          await sleep(600);
          const lit = await p.evaluate(() => Boolean(CSS.highlights?.get('lab-quote')?.size));
          const l = await look(p);
          check(eng, `a click on a word with ${dx},${dy} px of jitter is a point pin: no quote lit, no dialog row`, !lit && l.box === 1 && !l.dlg, JSON.stringify([lit, l]));
          await p.keyboard.type(`jit${dx}${dy}`);
          await p.keyboard.press('Enter');
          await sleep(700);
          const c = (await comments()).find((q) => q.text === `jit${dx}${dy}`);
          check(eng, '…saved with no quote', Boolean(c) && !c.anchor.quote && c.anchor.kind !== 'text', JSON.stringify(c?.anchor?.kind));
          await p.keyboard.press('Escape'); // the sent pin's undo card: a click outside it would only close it (undo.mjs)
          await sleep(200);
        }
      });
      await scene(browser, async (p) => {
        const s = await span(p, '#t', 'paragraph');
        await p.mouse.dblclick((s.first.left + s.first.right) / 2, s.first.top + s.first.height / 2);
        await sleep(300);
        const l = await look(p);
        check(eng, 'a double-click on a word without Shift selects nothing and shows no card on the words', !l.dlg && (await p.evaluate(() => String(getSelection()))) === '', JSON.stringify(l));
      });
      await scene(browser, async (p) => {
        const s = await span(p, '#t', 'quite a few');
        await p.mouse.click(s.first.left + 10, s.first.top + 10, { clickCount: 3 });
        await sleep(300);
        const l = await look(p);
        check(eng, 'a triple-click without Shift opens no card on the words', !l.dlg, JSON.stringify(l));
      });
      await scene(browser, async (p) => {
        const s = await span(p, '#t', 'paragraph');
        await p.keyboard.down('Shift');
        // The words must be selectable before the press: WebKit restyles a moment after Shift goes down (reading the style
        // forces it), and a double-click's first press selects the word at once.
        await p.waitForFunction(() => { const c = getComputedStyle(document.querySelector('#t')); return c.userSelect !== 'none' && c.webkitUserSelect !== 'none'; }, null, { timeout: 1500, polling: 'raf' }).catch(() => {});
        await p.mouse.dblclick((s.first.left + s.first.right) / 2, s.first.top + s.first.height / 2);
        await p.keyboard.up('Shift');
        await cardUp(p, 900);
        const l = await look(p);
        check(eng, 'Shift + double-click on a word opens the comment card (one box, none left from the first click)', l.dlg && l.box === 1 && l.draftPin === 1, JSON.stringify(l));
        await p.keyboard.type('word');
        await cardUp(p);
        await p.keyboard.press('Enter');
        await untilSent('word', 700);
        const c = (await comments()).find((x) => x.text === 'word');
        check(eng, '…quoting that word', c?.anchor?.quote?.exact === 'paragraph', JSON.stringify(c?.anchor?.quote));
      });
      await scene(browser, async (p) => {
        const s = await span(p, '#t', 'quite a few');
        await p.keyboard.down('Shift');
        // A triple-click is one press (clickCount 3), so unlike the double-click's first press there is no earlier one to let the
        // engine restyle: wait until the words are really selectable (reading the style forces it to be current) before pressing.
        await p.waitForFunction(() => { const c = getComputedStyle(document.querySelector('#t')); return c.userSelect !== 'none' && c.webkitUserSelect !== 'none'; }, null, { timeout: 1500, polling: 'raf' }).catch(() => {});
        await p.mouse.click(s.first.left + 10, s.first.top + 10, { clickCount: 3 });
        await p.keyboard.up('Shift');
        await cardUp(p, 1500);
        const l = await look(p);
        check(eng, 'Shift + triple-click selects the paragraph and opens the comment card at once', l.dlg, JSON.stringify(l));
      });
      await scene(browser, async (p) => {
        const f = await p.locator('#field').boundingBox();
        await dragTo(p, [f.x + 5, f.y + f.height / 2], [f.x + 90, f.y + f.height / 2]);
        await sleep(500);
        const l = await look(p);
        const picked = await p.evaluate(() => document.querySelector('#field').value.slice(document.querySelector('#field').selectionStart, document.querySelector('#field').selectionEnd));
        check(eng, 'a drag inside the page\'s own input selects its text and is not touched', picked.length > 3 && !l.zone, `${picked} ${JSON.stringify(l)}`);
      });
      await scene(browser, async (p) => {
        const s = await span(p, '#lnk', 'link right');
        await dragTo(p, [s.first.left + 2, s.first.top + 8], [s.last.right, s.last.top + 8]);
        await sleep(500);
        const l = await look(p);
        check(eng, 'a drag that starts on a link leaves the page\'s own drag (no bar, no area)', !l.zone, JSON.stringify(l));
      });
      check(eng, 'every change to what the page shows was redrawn', !missed.length, missed.splice(0).join('\n'));
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
}
finish();
