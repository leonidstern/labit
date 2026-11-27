// On a phone, the screen getting shorter with nothing to type in focused is Safari's own bar, not a keyboard: an open
// sheet stays where it is (iPhone 18 Pro simulator, 27 Nov: a flick that began on the page as the chat opened scrolled the
// page to its top, Safari's visible height dropped 62 px for one frame, the widget took that for a keyboard and the chat
// jumped from 234 to 16 px from the top and slid back to 192). The visible height is made up (visualViewport.height, read
// by the widget on its resize event). Checks: 62 px shorter with no field focused doesn't mark a keyboard or move the
// chat; with the chat's box focused 300 px shorter does (a keyboard still counts); the box let go while the keyboard is
// still there keeps it until the screen is tall again (the keyboard's way down is unchanged).
// Run: node test/browser/barnotkeys.mjs (needs playwright). Not part of `npm test`; CI runs it in the `browser` job.
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });
const DIR = tmp('labit-barnotkeys-');
const PORT = String(claimPort(11600, 30));
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>K</title><body style="margin:20px;font:16px/1.5 sans-serif"><h1>Bar</h1><p>A page.</p></body>');
const server = startLab(DIR, labEnv({}, { settings: false }), { root: '.', port: PORT });
await labUp(B);
const token = JSON.parse(fs.readFileSync(path.join(DIR, '.lab', 'server.json'), 'utf8')).token;
for (let i = 0; i < 6; i++) {
  await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-admin': token },
    body: JSON.stringify({ page: '/index', name: 'Sam', text: `message ${i}`, anchor: { kind: 'page', width: 390, height: 700, dpr: 2 } }) });
}

// In the page: sets the visible height (or puts the real one back, with null), fires its resize, waits two frames.
const SHORTEN = `window.__vh = async (h) => {
  if (h == null) delete visualViewport.height;
  else Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => h });
  visualViewport.dispatchEvent(new Event('resize'));
  for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(r));
}`;
const state = () => {
  const host = document.querySelector('[data-lab-comments]');
  const chat = host.shadowRoot.querySelector('.chatwin:not(.out)');
  return { kb: host.hasAttribute('data-kb'), top: chat ? Math.round(chat.getBoundingClientRect().top) : null, ih: innerHeight };
};

try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: eng !== 'firefox', deviceScaleFactor: 2 });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'tester'); localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      await p.goto(`${B}/index`);
      await p.waitForFunction(() => document.querySelector('[data-lab-comments]')?.shadowRoot?.querySelector('.chat-btn'), null, { timeout: 8000 });
      await sleep(500);
      await p.evaluate(SHORTEN);
      await p.evaluate(() => document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.chat-btn').click());
      // The chat done sliding in: its top the same for a few frames.
      await p.waitForFunction(() => {
        const c = document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.chatwin:not(.out)');
        const w = /** @type {any} */ (window);
        const t = c ? Math.round(c.getBoundingClientRect().top) : null;
        w.__same = t != null && t === w.__t ? (w.__same || 0) + 1 : 0;
        w.__t = t;
        return w.__same >= 8;
      }, null, { polling: 100, timeout: 8000 });
      const before = await p.evaluate(state);
      await p.evaluate(() => /** @type {any} */ (document.activeElement)?.blur?.());
      await p.evaluate(() => /** @type {any} */ (document.querySelector('[data-lab-comments]').shadowRoot.activeElement)?.blur?.());
      await sleep(150);

      await p.evaluate((ih) => /** @type {any} */ (window).__vh(ih - 62), before.ih);
      await sleep(100);
      const bar = await p.evaluate(state);
      check(eng, '62 px shorter, nothing focused: no keyboard', !bar.kb, JSON.stringify(bar));
      check(eng, '... and the chat stays where it was', bar.top === before.top, `${bar.top} vs ${before.top}`);
      await p.evaluate(() => /** @type {any} */ (window).__vh(null));
      await sleep(100);

      await p.evaluate(() => document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.chatwin textarea').focus());
      await sleep(150);
      await p.evaluate((ih) => /** @type {any} */ (window).__vh(ih - 300), before.ih);
      await sleep(100);
      const keys = await p.evaluate(state);
      check(eng, 'the chat\'s box focused, 300 px shorter: a keyboard', keys.kb, JSON.stringify(keys));

      await p.evaluate(() => /** @type {any} */ (document.querySelector('[data-lab-comments]').shadowRoot.activeElement)?.blur?.());
      await sleep(150);
      await p.evaluate((ih) => /** @type {any} */ (window).__vh(ih - 290), before.ih);
      await sleep(100);
      const going = await p.evaluate(state);
      check(eng, 'the box let go, the keyboard still there: still a keyboard', going.kb, JSON.stringify(going));
      await p.evaluate(() => /** @type {any} */ (window).__vh(null));
      await sleep(100);
      const gone = await p.evaluate(state);
      check(eng, '... and none once the screen is tall again', !gone.kb, JSON.stringify(gone));
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
}
finish();
