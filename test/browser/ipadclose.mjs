// A tablet's thread closes from where it is. On an iPad (a coarse pointer, but wide: a computer's card tied to its pin on
// the page, no sheet, no dimmed page) the card still leaves the phone's way, sliding down off the screen; it was held for
// that at the screen's top of it while it sits on the page, so with the page scrolled it jumped up by the scroll on the
// first frame (iPad Pro 11 simulator, 27 Nov: 342 − 466 px) before it slid. Checks, the page scrolled, for a close by a tap
// on the page and for one by a pull down on the card: every frame of the way out, the card is where it was or lower,
// never above, and the page stays where it was. The touches are made up (events with touches, as sheetpan does).
// Run: node test/browser/ipadclose.mjs (needs playwright). Not part of `npm test`; CI runs it in the `browser` job.
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });
const DIR = tmp('labit-ipadclose-');
const PORT = String(claimPort(11700, 30));
const B = `http://localhost:${PORT}`;
const paras = Array.from({ length: 80 }, (_, i) => `<p id="p${i}">paragraph ${i} with some words to read</p>`).join('');
fs.writeFileSync(path.join(DIR, 'index.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>I</title><body style="margin:20px 20px 20px 420px;font:16px/1.5 sans-serif">${paras}</body>`);
const server = startLab(DIR, labEnv({}, { settings: false }), { root: '.', port: PORT });
await labUp(B);
const post = (body) => fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', name: 'Sam', ...body }) }).then((r) => r.json()).then((j) => j.comment);
await post({ text: 'A thread far down the page', anchor: { selector: '#p30', x: 0.1, y: 0.5, docX: 440, docY: 900, width: 834, element: '<p id="p30">' } });

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
      const layout = await p.evaluate(() => ({ coarse: matchMedia('(pointer: coarse)').matches, w: innerWidth }));
      check(eng, 'the emulated iPad has a coarse pointer and its own width', layout.coarse && layout.w === 834, JSON.stringify(layout));

      // Scrolls the page so the pin is 300 px from the top, taps it, and waits for its card.
      const open = async () => {
        await p.evaluate(() => {
          const pin = document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.pin');
          scrollTo(0, pin.getBoundingClientRect().top + scrollY - 300);
        });
        await sleep(300);
        const r = await p.evaluate(() => { const b = document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.pin').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
        await p.touchscreen.tap(r.x, r.y);
        await p.waitForFunction(() => document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.card:not(.out) > .body'), null, { timeout: 10000 });
        await sleep(700); // its way in
        return p.evaluate(() => {
          const card = document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.card:not(.out)');
          return { top: card.getBoundingClientRect().top, fixed: getComputedStyle(card).position === 'fixed', sy: scrollY };
        });
      };
      // Every frame's card top (the leaving one), from now for 900 ms, and the page's scroll.
      const record = () => p.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.__tops = [];
        const t0 = performance.now();
        const f = () => {
          const card = document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.card');
          w.__tops.push({ top: card ? Math.round(card.getBoundingClientRect().top) : null, sy: Math.round(scrollY) });
          if (performance.now() - t0 < 900) requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      });
      const frames = async () => { await sleep(1100); return p.evaluate(() => /** @type {any} */ (window).__tops); };
      const judge = (what, was, tops) => {
        const shown = tops.filter((f) => f.top !== null);
        const above = shown.filter((f) => f.top < was.top - 3);
        check(eng, `${what}: the card is never drawn above where it was`, shown.length > 0 && !above.length, `was ${Math.round(was.top)}, frames ${shown.slice(0, 6).map((f) => f.top).join(' ')}`);
        check(eng, `${what}: ... its first frame of leaving is where it was`, shown.length > 0 && Math.abs(shown[0].top - was.top) <= 3 + (was.dragged || 0), `was ${Math.round(was.top)}, first ${shown[0]?.top}`);
        check(eng, `${what}: ... and the page stays where it was`, tops.every((f) => Math.abs(f.sy - was.sy) <= 1), `was ${was.sy}, ${[...new Set(tops.map((f) => f.sy))].join('/')}`);
        check(eng, `${what}: ... and it is gone in the end`, tops.at(-1)?.top === null || tops.at(-1)?.top > was.top, JSON.stringify(tops.at(-1)));
      };

      // 1. A tap on the page beside the card (its click: what a computer's close is).
      const was = await open();
      check(eng, 'on the iPad a thread is a card on the page, not a sheet', !was.fixed && was.sy > 300, JSON.stringify(was));
      await record();
      await p.evaluate(() => document.querySelector('#p2').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 600, clientY: 20 })));
      judge('closed by a tap on the page', was, await frames());

      // 2. A pull down on the card's top (its first line: nothing there scrolls), let go quickly.
      const was2 = await open();
      await record();
      const pulled = await p.evaluate(() => {
        const card = document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.card:not(.out)');
        const r = card.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const send = (type, y, t) => {
          const e = new Event(type, { bubbles: true, cancelable: true, composed: true });
          const touch = { identifier: 1, clientX: x, clientY: y };
          Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [touch] });
          Object.defineProperty(e, 'changedTouches', { value: [touch] });
          Object.defineProperty(e, 'timeStamp', { value: t });
          card.dispatchEvent(e);
          return e.defaultPrevented;
        };
        const t0 = performance.now();
        const y = r.top + 12;
        send('touchstart', y, t0);
        let taken = false;
        for (let i = 1; i <= 6; i++) taken = send('touchmove', y + i * 20, t0 + i * 16) || taken;
        send('touchend', y + 120, t0 + 100);
        return taken;
      });
      check(eng, 'a pull down on the card\'s top takes the card', pulled);
      judge('closed by a pull down', { ...was2, dragged: 120 }, await frames());
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
}
finish();
