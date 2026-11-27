// A phone's open thread keeps the page where it is (Leo, 20 Nov: "comments not fixed to pin and can scroll with me"). With
// the keyboard up Safari pans the page under a sheet whatever its overflow says, and the pin the thread belongs to leaves
// the screen: so a finger moving up or down on the sheet where nothing in it scrolls is the sheet's, never the page's.
// A thread that does scroll still scrolls. The touches are made up (no engine Playwright drives pans like Safari does):
// the check is that the move is cancelled, the one thing that stops the pan. Run: node test/browser/sheetpan.mjs
// (needs playwright). Not part of `npm test`; CI runs it in the `browser` job.
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });

const DIR = tmp('labit-sheetpan-');
const PORT = String(claimPort(6040, 30));
const B = `http://localhost:${PORT}`;
const paras = Array.from({ length: 60 }, (_, i) => `<p id="p${i}">paragraph ${i} with some words to read</p>`).join('');
fs.writeFileSync(path.join(DIR, 'index.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>S</title><body style="margin:20px">${paras}</body>`);
const server = startLab(DIR, labEnv({}, { settings: false }), { root: '.', port: PORT });
await labUp(B);

const post = (body) => fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', name: 'Sam', ...body }) }).then((r) => r.json()).then((j) => j.comment);
const spot = (id) => ({ selector: `#${id}`, x: 0.2, y: 0.5, docX: 40, docY: 100, width: 390, element: `<p id="${id}">` });
await post({ text: 'A short one', anchor: spot('p3') });
const long = await post({ text: 'A long thread', anchor: spot('p9') });
for (let i = 0; i < 14; i++) await post({ text: `Reply number ${i}. ` + 'Some words that wrap onto more than one line. '.repeat(3), parent: long.id });

for (const eng of engines()) {
  const browser = await pw[eng].launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => localStorage.setItem('lab-name', 'tess'));
  // Counts the touch listeners added to the dimmed page (the scrim): they are for the page's whole life.
  await ctx.addInitScript(() => {
    /** @type {any} */ (window).__scrimTouch = 0;
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, ...rest) {
      if (/^touch/.test(type) && /** @type {any} */ (this).classList?.contains?.('scrim')) /** @type {any} */ (window).__scrimTouch++;
      return add.call(this, type, ...rest);
    };
  });
  const p = await ctx.newPage();
  await p.goto(B + '/');
  await p.waitForFunction(() => document.querySelector('[data-lab-comments]')?.shadowRoot?.querySelector('.pin'), null, { timeout: 20000 });
  await p.waitForTimeout(400);
  // Opens the thread whose pin is nth (a tap on it) and waits for its sheet. swipe moves a made-up finger over the thread's
  // body, from one share of its height to another; it says whether the move was cancelled.
  const open = async (nth) => {
    await p.evaluate(() => scrollTo(0, 0));
    await p.evaluate((n) => {
      const pin = document.querySelector('[data-lab-comments]').shadowRoot.querySelectorAll('.pin')[n];
      scrollTo(0, Math.max(0, pin.getBoundingClientRect().top + scrollY - 200));
    }, nth);
    await p.waitForTimeout(300);
    const r = await p.evaluate((n) => { const b = document.querySelector('[data-lab-comments]').shadowRoot.querySelectorAll('.pin')[n].getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, nth);
    await p.touchscreen.tap(r.x, r.y);
    await p.waitForFunction(() => document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.card:not(.out) > .body'), null, { timeout: 10000 });
    await p.waitForTimeout(900); // the sheet slides in and the page scrolls to the pin
  };
  const swipe = (from, to) => p.evaluate(([f, t]) => {
    const body = document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.card:not(.out) > .body');
    const r = body.getBoundingClientRect();
    const at = (share) => ({ clientX: r.left + r.width / 2, clientY: r.top + r.height * share });
    const send = (type, share, last) => {
      const e = new Event(type, { bubbles: true, cancelable: true, composed: true });
      Object.defineProperty(e, 'touches', { value: last ? [] : [at(share)] });
      body.dispatchEvent(e);
      return e.defaultPrevented;
    };
    const y0 = scrollY;
    send('touchstart', f);
    const cancelled = send('touchmove', t);
    send('touchend', t, true);
    return { cancelled, moved: scrollY - y0 };
  }, [from, to]);
  const close = async () => {
    await p.keyboard.press('Escape').catch(() => {});
    await p.evaluate(() => document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.scrim')?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })));
    await p.waitForFunction(() => !document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.card'), null, { timeout: 10000 }).catch(() => {});
    await p.waitForTimeout(500);
  };

  await open(0);
  const a = await swipe(0.8, 0.5); // up, where a one-message thread has nothing to scroll
  check(eng, 'a thread with nothing to scroll: a move up on it is cancelled', a.cancelled, JSON.stringify(a));
  const b = await swipe(0.5, 0.52);
  check(eng, '... and a tiny move down in its middle', b.cancelled, JSON.stringify(b));
  await close();

  await open(1);
  const c = await swipe(0.5, 0.7); // down: the messages scroll up (they open at the newest, so there is room above)
  check(eng, 'a long thread scrolls under a finger moving down', !c.cancelled, JSON.stringify(c));
  const d = await swipe(0.8, 0.5); // up at the end of the messages: nothing further to scroll
  check(eng, 'at the end of a long thread, a move up is cancelled', d.cancelled, JSON.stringify(d));
  // Every redraw while a sheet is open (a reply arriving) draws the sheet again: the scrim gets no more listeners.
  const scrims = () => p.evaluate(() => /** @type {any} */ (window).__scrimTouch);
  const n1 = await scrims();
  for (let i = 0; i < 3; i++) {
    await post({ text: `Another reply ${i}`, parent: long.id });
    await p.waitForTimeout(800);
  }
  const n2 = await scrims();
  // (6: the four of swipeDown, the scrim's own touchmove that keeps iOS's sheet curve, and its touchstart that lets a tap act
  // on the lift, comments.js liftFrom; before, each draw added four more)
  check(eng, 'the dimmed page gets no more touch listeners however often the sheet is drawn', n1 === 6 && n2 === n1, `${n1} then ${n2}`);
  // And a pull on the dimmed page still moves the open sheet (a made-up finger on the scrim, above the sheet).
  const pulled = await p.evaluate(() => {
    const root = document.querySelector('[data-lab-comments]').shadowRoot;
    const scrim = root.querySelector('.scrim');
    const send = (type, y, last) => {
      const e = new Event(type, { bubbles: true, cancelable: true, composed: true });
      Object.defineProperty(e, 'touches', { value: last ? [] : [{ clientX: 100, clientY: y }] });
      scrim.dispatchEvent(e);
    };
    send('touchstart', 20);
    send('touchmove', 60);
    send('touchmove', 140);
    const moved = root.querySelector('.card:not(.out)')?.style.transform || '';
    send('touchend', 140, true);
    return moved;
  });
  check(eng, 'a pull on the dimmed page still pulls the open sheet', /translateY\(\d/.test(pulled), pulled);
  await close();
  await browser.close();
}
server.kill();
fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
finish();
