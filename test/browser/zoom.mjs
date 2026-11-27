// A phone pinch-zoomed in: the bar and the chat stay their usual size, inside what the screen shows, and the page between
// them still takes taps (Leo, 19 Nov: "on mobile zooms breaks our windows"). The page starts zoomed in (initial-scale), as
// a pinch leaves it: no engine Playwright drives can pinch. Run: node test/browser/zoom.mjs (needs playwright).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, check, finish } from './harness.mjs';

const pw = playwright();

const DIR = tmp('labit-zoom-');
const PORT = String(claimPort(6010, 30));
const B = `http://localhost:${PORT}`;
const ZOOM = 2.5;
const paras = Array.from({ length: 60 }, (_, i) => `<p id="p${i}">paragraph ${i} with some words to read</p>`).join('');
fs.writeFileSync(path.join(DIR, 'index.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=${ZOOM}"><title>Z</title><body style="margin:20px">${paras}</body>`);
const server = startLab(DIR, labEnv({}, { settings: false }), { root: '.', port: PORT });
await labUp(B);

for (const eng of engines()) {
  const browser = await pw[eng].launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto(B + '/');
  await p.waitForFunction(() => document.querySelector('[data-lab-comments]')?.shadowRoot?.querySelector('.bar button:not([hidden])'), null, { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(300);
  // A part's box on the screen, in the visual viewport's own frame whichever frame the engine measures boxes in.
  const seen = (sel) => p.evaluate((s) => {
    const v = visualViewport;
    const h = document.querySelector('[data-lab-comments]');
    const n = h.shadowRoot.querySelector(s);
    const r = n.getBoundingClientRect();
    const inside = (x, y) => x >= -1 && y >= -1 && x + r.width <= v.width + 1 && y + r.height <= v.height + 1;
    return { scale: v.scale, zoom: h.hasAttribute('data-zoom'), w: r.width, h: r.height, vw: v.width, vh: v.height, laid: n.offsetWidth,
      inside: inside(r.left - v.offsetLeft, r.top - v.offsetTop) || inside(r.left, r.top) };
  }, sel);
  const bar = await seen('.bar');
  // Playwright's desktop WebKit ignores a page's initial-scale (scale stays 1, on Linux and on a Mac): nothing to check
  // there. Safari in the iOS simulator does zoom (test/phone).
  if (Math.abs(bar.scale - 1) < 0.01 && eng === 'webkit') {
    console.log(`skip ${eng.padEnd(8)} this engine does not zoom a page (scale 1)`);
    await browser.close();
    continue;
  }
  check(eng, 'the page is zoomed in', Math.abs(bar.scale - ZOOM) < 0.05, `scale ${bar.scale}`);
  check(eng, 'the bar keeps its usual size', Math.abs(bar.w * bar.scale - bar.laid) < 2, `${Math.round(bar.w)} px of ${Math.round(bar.vw)} shown, laid out ${bar.laid}`);
  check(eng, 'the bar is inside what the screen shows', bar.inside, JSON.stringify(bar));
  const free = await p.evaluate(() => {
    const e = document.elementFromPoint(visualViewport.width / 2, visualViewport.height / 3);
    return e?.closest('[data-lab-comments]') ? 'widget' : e?.localName;
  });
  check(eng, 'the page between takes taps', free && free !== 'widget', free);
  await p.keyboard.press('t');
  // A chat that never opened measures 0 × 0, which would pass the size checks: it must have opened, with a size.
  const opened = await p.waitForFunction(() => !document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.chatwin').hidden, null, { timeout: 2000 }).then(() => true, () => false);
  await p.waitForTimeout(500);
  const chat = await seen('.chatwin');
  check(eng, 'the chat opens at its usual size, inside what the screen shows', opened && chat.w > 0 && chat.laid > 0 && Math.abs(chat.w * chat.scale - chat.laid) < 2 && chat.inside, JSON.stringify({ opened, ...chat }));
  await browser.close();
}
server.kill();
fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
finish();
