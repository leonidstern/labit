// A long chat, opened, knows every message's real height before you scroll it (src/widget/chat.ts warmChat). The chat
// lays out only the messages near the screen (content-visibility), each held at a 64 px guess until first drawn; scrolled
// up the first time, each took its real height above what you read, and Safari (no scroll anchoring) let it all jump
// (Leo's phone, 27 Nov: "open chat and scroll on top its like preloading"). Checks: soon after it opens, the list is as
// tall as with every message drawn, it is still at its newest, and scrolling up through it changes no height.
// Run: node test/browser/chatwarm.mjs (needs playwright). Not part of `npm test`; CI runs it in the `browser` job.
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });
const DIR = tmp('labit-chatwarm-');
const PORT = String(claimPort(6190, 30));
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>C</title><body style="margin:20px;font:16px/1.5 sans-serif"><h1>Chat</h1><p>A page.</p></body>');
const server = startLab(DIR, labEnv({}, { settings: false }), { root: '.', port: PORT });
await labUp(B);
const token = JSON.parse(fs.readFileSync(path.join(DIR, '.lab', 'server.json'), 'utf8')).token;
const post = (body) => fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-admin': token }, body: JSON.stringify({ page: '/index', ...body }) }).then((r) => r.json());
const words = 'a longer line of words that wraps on a phone. ';
for (let i = 0; i < 60; i++) await post({ name: i % 2 ? 'Sam' : 'Claude · session 1234abcd', text: `message ${i}: ${words.repeat(1 + (i % 5))}`, anchor: { kind: 'page', width: 390, height: 700, dpr: 2 } });

try {
  // WebKit: Safari is where it jumped (Chrome anchors the scroll itself, and keeps its own guesses: nothing to check).
  for (const eng of engines('webkit')) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: eng !== 'firefox', deviceScaleFactor: 2 });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'tester'); localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      await p.goto(`${B}/index`);
      await p.waitForFunction(() => document.querySelector('[data-lab-comments]')?.shadowRoot?.querySelector('.chat-btn'), null, { timeout: 8000 });
      await sleep(500);
      await p.evaluate(() => document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.chat-btn').click());
      // The drawing waits while the list still moves (the chat keeps itself at its newest for a second as it opens), then
      // takes a batch a frame: done when no batch is out and the height has held for a few frames (a busy CI runner is slow).
      await p.waitForFunction(() => {
        const box = document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.chatwin .msgs');
        const w = /** @type {any} */ (window);
        const h = box.scrollHeight;
        w.__same = w.__h === h && !box.querySelector('.warm') ? (w.__same || 0) + 1 : 0;
        w.__h = h;
        return w.__same >= 8;
      }, null, { polling: 100, timeout: 8000 }).catch(() => {});
      const got = await p.evaluate(() => {
        const box = document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.chatwin .msgs');
        const now = box.scrollHeight;
        const end = box.scrollHeight - box.clientHeight - box.scrollTop;
        const msgs = [...box.querySelectorAll('.msg')];
        msgs.forEach((m) => (m.style.contentVisibility = 'visible'));
        const full = box.scrollHeight;
        msgs.forEach((m) => (m.style.contentVisibility = ''));
        return { now, full, end, n: msgs.length };
      });
      check(eng, 'opened, the long chat is as tall as with every message drawn', got.n === 60 && Math.abs(got.now - got.full) <= 2, JSON.stringify(got));
      check(eng, '... and still at its newest message', got.end <= 2, JSON.stringify(got));
      const heights = await p.evaluate(async () => {
        const box = document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.chatwin .msgs');
        const hs = new Set([box.scrollHeight]);
        while (box.scrollTop > 0) {
          box.scrollTop -= 250;
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          hs.add(box.scrollHeight);
        }
        return [...hs];
      });
      check(eng, 'scrolling up through it changes no height (nothing jumps)', heights.length === 1, JSON.stringify(heights));
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
finish();
