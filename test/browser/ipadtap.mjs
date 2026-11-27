// A tap on the page outside an open thread or new comment closes it on a tablet, click or no click. On an iPad (a coarse
// pointer, but wide: a computer's cards, no dimmed page to tap) the close waited for the click iOS makes of a tap, and iOS
// often makes none: 2 of 17 thread closes and 3 of 12 new comments did nothing, and an empty column never got a click at
// all (iPad Pro 11 simulator, 27 Nov). Checks: a short, still touch on the page (touchstart, touchend, no click) closes an
// open thread and a new comment; a touch that moves (a scroll) or is held closes nothing; and the click that may still come
// after such a tap acts on nothing a second time (it would pin there). The touches are made up (events with touches).
// Run: node test/browser/ipadtap.mjs (needs playwright). Not part of `npm test`; CI runs it in the `browser` job.
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });
const DIR = tmp('labit-ipadtap-');
const PORT = String(claimPort(11740, 30));
const B = `http://localhost:${PORT}`;
const paras = Array.from({ length: 40 }, (_, i) => `<p id="p${i}">paragraph ${i} with some words to read</p>`).join('');
// The text in a right column; the left one is empty, as the page Leo's iPad missed the most taps on.
fs.writeFileSync(path.join(DIR, 'index.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>T</title><body style="margin:20px 20px 20px 420px;font:16px/1.5 sans-serif">${paras}</body>`);
const server = startLab(DIR, labEnv({}, { settings: false }), { root: '.', port: PORT });
await labUp(B);
const post = (body) => fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', name: 'Sam', ...body }) }).then((r) => r.json()).then((j) => j.comment);
await post({ text: 'A thread', anchor: { selector: '#p3', x: 0.1, y: 0.5, docX: 440, docY: 120, width: 834, element: '<p id="p3">' } });

try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 834, height: 1124 }, isMobile: eng !== 'firefox', hasTouch: true });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'tess'); localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      await p.goto(B + '/');
      await p.waitForFunction(() => document.querySelector('[data-lab-comments]')?.shadowRoot?.querySelector('.pin'), null, { timeout: 20000 });
      await sleep(400);
      const state = () => p.evaluate(() => {
        const root = document.querySelector('[data-lab-comments]').shadowRoot;
        return { card: Boolean(root.querySelector('.card:not(.out)')), draft: Boolean(root.querySelector('.float:not(.out)')) };
      });
      const openCard = async () => {
        const r = await p.evaluate(() => { const b = document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.pin').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
        await p.touchscreen.tap(r.x, r.y);
        await p.waitForFunction(() => document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.card:not(.out)'), null, { timeout: 10000 });
        await sleep(600);
      };
      // A new comment: a finger held on the page pins (made up: the hold's pointer events, then its lift).
      const openDraft = async () => {
        await p.evaluate(async () => {
          const at = document.elementFromPoint(600, 400);
          const ptr = (type) => at.dispatchEvent(new PointerEvent(type, { bubbles: true, composed: true, pointerType: 'touch', clientX: 600, clientY: 400, isPrimary: true }));
          ptr('pointerdown');
          await new Promise((r) => setTimeout(r, 600));
          ptr('pointerup');
          const e = new Event('touchend', { bubbles: true, cancelable: true, composed: true });
          Object.defineProperty(e, 'touches', { value: [] });
          Object.defineProperty(e, 'changedTouches', { value: [{ identifier: 3, clientX: 600, clientY: 400 }] });
          at.dispatchEvent(e);
        });
        await p.waitForFunction(() => document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.float:not(.out)'), null, { timeout: 10000 });
        await sleep(600);
      };
      // A made-up touch at (x, y) on whatever of the page is there: down, moved by `by` px, up `ms` later. No click.
      const touch = (x, y, { by = 0, ms = 60 } = {}) => p.evaluate(async ([x, y, by, ms]) => {
        const at = document.elementFromPoint(x, y) || document.body;
        const send = (type, dy) => {
          const e = new Event(type, { bubbles: true, cancelable: true, composed: true });
          const t = { identifier: 7, clientX: x, clientY: y + dy, target: at };
          Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [t] });
          Object.defineProperty(e, 'changedTouches', { value: [t] });
          at.dispatchEvent(e);
        };
        send('touchstart', 0);
        if (by) send('touchmove', by);
        await new Promise((r) => setTimeout(r, ms));
        send('touchend', by);
        return at.localName;
      }, [x, y, by, ms]);
      const lateClick = (x, y) => p.evaluate(([x, y]) => (document.elementFromPoint(x, y) || document.body).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y })), [x, y]);

      // A thread: taps in the empty left column and on the text, without the click.
      for (const [x, y, where] of [[120, 700, 'the empty left column'], [600, 900, 'the page\'s text']]) {
        await openCard();
        const on = await touch(x, y);
        await sleep(500);
        const s = await state();
        check(eng, `a tap on ${where} (no click) closes the open thread`, !s.card, `${on}: ${JSON.stringify(s)}`);
        await lateClick(x, y);
        await sleep(500);
        const s2 = await state();
        check(eng, '... and the click that comes late does nothing more (no new comment there)', !s2.card && !s2.draft, JSON.stringify(s2));
      }
      // Touches that aren't taps leave it open.
      await openCard();
      await touch(120, 700, { by: 40 });
      await sleep(400);
      check(eng, 'a touch that moves (a scroll) leaves the thread open', (await state()).card);
      await touch(120, 700, { ms: 600 });
      await sleep(400);
      check(eng, 'a touch held still for long leaves it open too', (await state()).card);
      await touch(120, 700);
      await sleep(500);

      // A new comment: dropped by a tap beside it, without the click.
      await openDraft();
      await touch(120, 900);
      await sleep(500);
      const d = await state();
      check(eng, 'a tap on the page (no click) drops an open new comment', !d.draft, JSON.stringify(d));
      await lateClick(120, 900);
      await sleep(500);
      check(eng, '... and its late click starts no other one', !(await state()).draft);
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
}
finish();
