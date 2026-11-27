// What a phone does around a new comment and a tap, kept cheap and sure (iOS 27 simulator, 27 Nov):
// - the page held still under a new comment's sheet (sheets.ts revealDraft) is shifted by an inline translate on its own
//   blocks, never by custom properties on <html> (each write there restyled the whole page); the blocks' own style
//   comes back as it was;
// - the page's rules for commenting (data-lab-pinning) stay as they are while a sheet covers the page: a new comment or a
//   thread opened and closed flips nothing (each flip restyled the whole page);
// - a tap on a pin or on the dimmed page acts on the finger's lift, so a click the browser holds back (iOS does, when
//   something on the page appears as it sends the tap's mouse events) loses nothing, and no second click does it twice;
// - a finger's few pixels of wobble on the dimmed page is still a tap that closes the sheet, not a pull; a touch in the
//   sheet itself (its messages scrolled, the sheet pulled) is left to the sheet.
// Run: node test/browser/phonenew.mjs (needs playwright). Not part of `npm test`; CI runs it in the `browser` job.
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });
const DIR = tmp('labit-phonenew-');
const PORT = String(claimPort(6160, 30));
const B = `http://localhost:${PORT}`;
const paras = Array.from({ length: 30 }, (_, i) => `<p id="p${i}">paragraph ${i} with some words to read on a phone</p>`).join('');
fs.writeFileSync(path.join(DIR, 'index.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>P</title>
<style>body{margin:0 20px;font:16px/1.5 sans-serif} #bar{position:sticky;top:0;background:#eee;padding:8px}</style>
<body><header id="bar"><b>Sticky bar</b></header><main id="main" style="color: #111">${paras}</main><footer id="foot" style="transition-duration: 123ms !important; translate: 0 1px">The end.</footer></body>`);
const server = startLab(DIR, labEnv({}, { settings: false }), { root: '.', port: PORT });
await labUp(B);
const token = JSON.parse(fs.readFileSync(path.join(DIR, '.lab', 'server.json'), 'utf8')).token;
const post = (body) => fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-admin': token }, body: JSON.stringify({ page: '/index', name: 'Sam', ...body }) }).then((r) => r.json());
await post({ text: 'one on p4', anchor: { selector: '#p4', x: 0.3, y: 0.5, docX: 60, docY: 200, width: 390, element: '<p id="p4">' } });

const pin1 = '[data-lab-comments] .pin[aria-label^="comment 1 by"]';
try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: eng !== 'firefox', deviceScaleFactor: 2 });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'tester'); localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      await p.goto(`${B}/index`);
      await p.waitForFunction(() => document.querySelector('[data-lab-comments]')?.shadowRoot?.querySelectorAll('.pin').length >= 1, null, { timeout: 8000 });
      await sleep(800);
      // Watches: <html>'s style attribute, the commenting attribute on the widget's element, and each shift the page's
      // own blocks get.
      await p.evaluate(() => {
        const host = document.querySelector('[data-lab-comments]');
        const w = (window.__w = { html: [], pinning: 0, shifts: [] });
        new MutationObserver((l) => l.forEach(() => w.html.push(document.documentElement.getAttribute('style') || ''))).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
        new MutationObserver((l) => (w.pinning += l.length)).observe(host, { attributes: true, attributeFilter: ['data-lab-pinning'] });
        new MutationObserver((l) => l.forEach((m) => w.shifts.push(m.target.id + ':' + (m.target.style.translate || '')))).observe(document.getElementById('main'), { attributes: true, attributeFilter: ['style'] });
      });
      const root = 'document.querySelector("[data-lab-comments]").shadowRoot';
      const open = () => p.evaluate(`${root}.querySelector('.card:not(.out), .float:not(.out)')?.className.split(' ')[0] || null`);
      const pinning = () => p.evaluate(() => document.querySelector('[data-lab-comments]').hasAttribute('data-lab-pinning'));

      // A block with only part of a transition inline (a longhand, !important) and its own translate: the shift writes
      // both and must give back exactly what was there (read as a whole `transition`, it was "" and the restore wiped it).
      // Compared as the browser reads it back (cssText, each longhand and its priority): the attribute's own text is
      // reserialized by any style write ("0 1px" becomes "0px 1px").
      const LONG = ['translate', 'transition', 'transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay', 'transition-behavior'];
      const footStyle = () => p.evaluate((LONG) => { const st = document.getElementById('foot').style; return { css: st.cssText, each: LONG.map((k) => `${k}=${st.getPropertyValue(k)}!${st.getPropertyPriority(k)}`) }; }, LONG);
      const footBefore = await footStyle();

      // A new comment held low on the page: the page moves so its pin shows above the sheet, held still by a shift.
      await p.evaluate(() => scrollTo(0, 0));
      await sleep(300);
      const hold = await p.evaluate(async () => {
        const t = document.getElementById('p11');
        const r = t.getBoundingClientRect();
        const at = { pointerType: 'touch', isPrimary: true, clientX: r.left + 30, clientY: r.top + r.height / 2, bubbles: true, composed: true };
        t.dispatchEvent(new PointerEvent('pointerdown', at));
        await new Promise((ok) => setTimeout(ok, 520));
        t.dispatchEvent(new PointerEvent('pointerup', at));
        return Math.round(scrollY);
      });
      const during = await p.evaluate(() => ({ main: document.getElementById('main').style.translate, foot: document.getElementById('foot').style.translate, bar: document.getElementById('bar').style.translate, html: document.documentElement.getAttribute('style') || '' }));
      check(eng, 'a held new comment opens and moves the page', (await open()) === 'float' && hold > 0, `open ${await open()}, scrollY ${hold}`);
      check(eng, 'the page is held still by a translate on its own blocks (not the sticky bar), nothing on <html>', /px/.test(during.main) && !during.bar && !/--lab-shift/.test(during.html), JSON.stringify(during));
      check(eng, 'the commenting rules stay while the new comment is open', (await pinning()) === true, '');
      await sleep(900); // no keyboard comes here: the shift runs out after the lift (sheets.ts liftedDraft)
      await p.evaluate(`${root}.querySelector('.scrim').click()`); // dropped (nothing typed)
      await sleep(1400);
      const after = await p.evaluate(() => ({ main: (({ translate, transition, color }) => ({ translate, transition, color }))(document.getElementById('main').style), html: document.documentElement.getAttribute('style') || '', y: Math.round(scrollY), w: window.__w }));
      check(eng, 'dropped: the page is back where it was and its blocks\' own style is as it was', !after.main.translate && !after.main.transition && after.main.color === 'rgb(17, 17, 17)' && after.y === 0, JSON.stringify(after));
      check(eng, '<html> never got the shift (no custom property written there)', after.w.html.every((s) => !/--lab-shift/.test(s)), JSON.stringify(after.w.html));
      check(eng, 'the shift ran on the page\'s block', after.w.shifts.some((s) => /px/.test(s)), JSON.stringify(after.w.shifts));
      const footAfter = await footStyle();
      check(eng, 'a block with only transition-duration !important and its own translate was shifted too', during.foot !== '0px 1px' && /px/.test(during.foot), during.foot);
      check(eng, '... and its inline style came back exactly as it was (each longhand, its !important)', JSON.stringify(footAfter) === JSON.stringify(footBefore) && /123ms/.test(footBefore.css), `${JSON.stringify(footBefore)} -> ${JSON.stringify(footAfter)}`);

      // Taps with the browser's own clicks let through: each tap on a pin and on the dimmed page acts once, though both
      // the lift and the click the browser makes of the tap could act. What each engine covers: in Chromium (touch through
      // its devtools) and in Playwright's WebKit the tap is real touches (trusted touchstart/touchend, so the lift acts)
      // followed, unless the lift's default is stopped, by a real click: the control below holds both to that, so a lift
      // that acted and let the click through counts 2 here (with the lift's preventDefault taken out, both engines fail:
      // trusted + lift on the pin). Neither engine holds the click back as iOS does: the scenario after this one fakes that.
      await p.evaluate(() => {
        const c = (window.__c = { all: [], on: null });
        c.on = (e) => c.all.push((e.isTrusted ? 'trusted ' : 'lift ') + (e.composedPath()[0]?.className?.split?.(' ')[0] || e.composedPath()[0]?.id || e.composedPath()[0]?.localName));
        addEventListener('click', c.on, true);
      });
      const clicksSince = async (fn) => { await p.evaluate(() => (window.__c.all = [])); await fn(); await sleep(900); return p.evaluate(() => window.__c.all); };
      await p.evaluate(() => scrollTo(0, 0));
      await sleep(300);
      const control = await clicksSince(() => p.tap('#p2'));
      check(eng, 'control: a tap on the page\'s own words gets the browser\'s click (so a lift that let it through would show)', control.length === 1 && /^trusted/.test(control[0]), JSON.stringify(control));
      const pinClicks = await clicksSince(() => p.tap(pin1));
      const pinOpen = await open();
      const scrimClicks = await clicksSince(() => p.tap('body', { position: { x: 200, y: 20 } }));
      const scrimOpen = await open();
      await p.evaluate(() => removeEventListener('click', window.__c.on, true));
      check(eng, 'clicks let through: a tap on a pin acts once and its thread is open', pinClicks.length === 1 && pinOpen === 'card', `${JSON.stringify(pinClicks)}, open ${pinOpen}`);
      check(eng, 'clicks let through: a tap on the dimmed page acts once and the sheet is closed', scrimClicks.length === 1 && scrimOpen === null, `${JSON.stringify(scrimClicks)}, open ${scrimOpen}`);

      // A thread opened and closed by taps, the browser holding back every real click (as iOS does when something on
      // the page appears meanwhile): the lift opens and closes it, once.
      await p.evaluate(() => { window.__clicks = 0; addEventListener('click', (e) => { if (e.isTrusted) { e.stopImmediatePropagation(); e.preventDefault(); } else window.__clicks++; }, true); });
      await p.evaluate(() => scrollTo(0, 0));
      await sleep(300);
      await p.tap(pin1);
      await sleep(800);
      const opened = await open();
      const pinningOpen = await pinning();
      await p.tap('body', { position: { x: 200, y: 20 } }); // the dimmed page, above the sheet's grab zone
      await sleep(900);
      const closed = await open();
      const clicks = await p.evaluate(() => window.__clicks);
      check(eng, 'a tap on a pin opens its thread on the lift, with the browser\'s click held back', opened === 'card', String(opened));
      check(eng, 'a tap on the dimmed page closes it the same way', closed === null, String(closed));
      check(eng, 'each tap did it once (one click each, from the lift)', clicks === 2, String(clicks));
      check(eng, 'the commenting rules stayed through the new comment and the thread', pinningOpen && (await pinning()) && (await p.evaluate(() => window.__w.pinning)) === 0, String(await p.evaluate(() => window.__w.pinning)));

      // A tap that wobbles 3 px on the dimmed page still closes the sheet; a pull of 40 px does not (it is the sheet's).
      const touchOn = async (dy) => p.evaluate(async (dy) => {
        const scrim = document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.scrim');
        let T;
        try { T = (x, y) => new Touch({ identifier: 3, target: scrim, clientX: x, clientY: y }); T(0, 0); } catch { return 'no Touch'; }
        const fire = (type, t, down) => scrim.dispatchEvent(new TouchEvent(type, { bubbles: true, composed: true, cancelable: true, touches: down ? [t] : [], targetTouches: down ? [t] : [], changedTouches: [t] }));
        fire('touchstart', T(200, 30), true);
        await new Promise((ok) => setTimeout(ok, 40));
        fire('touchmove', T(201, 30 + dy), true);
        await new Promise((ok) => setTimeout(ok, 200)); // held still before the lift: no flick
        fire('touchend', T(201, 30 + dy), false);
        return 'ok';
      }, dy);
      await p.tap(pin1);
      await sleep(800);
      // A touch in the open thread itself (where its messages scroll and its sheet is pulled) is left to the sheet: no lift
      // handling, its end not stopped (Leo's phone, 27 Nov: scrolling the chat and pulling a sheet down glitched with it).
      const inSheet = await p.evaluate(async () => {
        const body = document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.card .body');
        try { new Touch({ identifier: 4, target: body, clientX: 1, clientY: 1 }); } catch { return 'no Touch'; }
        const r = body.getBoundingClientRect();
        const t = new Touch({ identifier: 4, target: body, clientX: r.left + 40, clientY: r.top + 40 });
        body.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, composed: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
        const end = new TouchEvent('touchend', { bubbles: true, composed: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [t] });
        body.dispatchEvent(end);
        return end.defaultPrevented ? 'stopped' : 'left alone';
      });
      if (inSheet !== 'no Touch') check(eng, 'a touch inside the open thread is left to the sheet (its end not stopped)', inSheet === 'left alone', inSheet);
      const t1 = await touchOn(40);
      await sleep(900);
      const afterPull = await open();
      const t2 = await touchOn(3);
      await sleep(900);
      const afterWobble = await open();
      if (t1 === 'no Touch') check(eng, 'touch wobble (skipped: no Touch constructor here)', true);
      else {
        check(eng, 'a 40 px pull on the dimmed page is not a tap: the sheet stays', afterPull === 'card', String(afterPull));
        check(eng, 'a tap that wobbles 3 px on the dimmed page closes the sheet', t2 === 'ok' && afterWobble === null, String(afterWobble));
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
finish();
