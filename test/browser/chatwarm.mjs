// A long chat, opened, knows every message's real height before you scroll it (src/widget/chat.ts warmChat). The chat
// lays out only the messages near the screen (content-visibility), each held at a 64 px guess until first drawn; scrolled
// up the first time, each took its real height above what you read, and Safari (no scroll anchoring) let it all jump
// (Leo's phone, 27 Nov: "open chat and scroll on top its like preloading"). Checks: soon after it opens, the list is as
// tall as with every message drawn, it is still at its newest, and scrolling up through it changes no height. And a
// finger that goes down within two frames of the chat opening and scrolls it up at once (iPhone 18 Pro simulator, 27 Nov:
// a flick in the first 150 ms ran into undrawn messages, 17-253 px a frame) sees no height change and nothing it reads
// move by other than the scroll. The touch is made up (an event with touches, as sheetrelease does): it lets go of the
// chat's hold at its newest, as a finger does; the scroll is set a frame at a time.
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
for (let i = 0; i < 150; i++) await post({ name: i % 2 ? 'Sam' : 'Claude · session 1234abcd', text: `message ${i}: ${words.repeat(1 + (i % 5))}`, anchor: { kind: 'page', width: 390, height: 700, dpr: 2 } });

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
      // Done when no message is held drawn any more and the height has held for a few frames (a busy CI runner is slow).
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
      check(eng, 'opened, the long chat is as tall as with every message drawn', got.n === 150 && Math.abs(got.now - got.full) <= 2, JSON.stringify(got));
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

      // Opened again in a new page, and scrolled up from its second frame on.
      const q = await ctx.newPage();
      await q.goto(`${B}/index`);
      await q.waitForFunction(() => document.querySelector('[data-lab-comments]')?.shadowRoot?.querySelector('.chat-btn'), null, { timeout: 8000 });
      await sleep(500);
      const quick = await q.evaluate(async () => {
        const root = document.querySelector('[data-lab-comments]').shadowRoot;
        const frame = () => new Promise((r) => requestAnimationFrame(r));
        root.querySelector('.chat-btn').click();
        const box = root.querySelector('.chatwin .msgs');
        await frame();
        await frame();
        const down = new Event('touchstart', { bubbles: true, composed: true });
        Object.defineProperty(down, 'touches', { value: [{ clientX: 200, clientY: 400 }] });
        box.lastElementChild.dispatchEvent(down);
        const out = { heights: [box.scrollHeight], drift: [] };
        for (let i = 0; i < 200 && box.scrollTop > 0; i++) {
          // What is read now: the first message in view, where it is on the screen; after this frame's scroll and the
          // frame drawn, it should have moved by exactly the scroll.
          // In layout px (offsetTop, which the sheet's rise and scale as it opens don't touch): with the scroll set
          // apart, it moves only if something above it changed height.
          const top = box.getBoundingClientRect().top;
          const seen = [...box.children].find((n) => n.getBoundingClientRect().bottom > top + 1);
          const was = seen.offsetTop;
          const st = box.scrollTop;
          box.scrollTop = st - 160;
          await frame();
          out.heights.push(box.scrollHeight);
          out.drift.push(Math.round(seen.offsetTop - was));
        }
        box.lastElementChild.dispatchEvent(Object.defineProperty(new Event('touchend', { bubbles: true, composed: true }), 'touches', { value: [] }));
        return { heights: [...new Set(out.heights)], drift: out.drift.filter((d) => Math.abs(d) > 1), frames: out.drift.length, top: box.scrollTop };
      });
      check(eng, 'scrolled up from its second frame: no height changes on the way', quick.heights.length === 1 && quick.top === 0 && quick.frames > 10, JSON.stringify(quick));
      check(eng, '... and what is read moves by the scroll alone (no jump)', quick.drift.length === 0, JSON.stringify(quick.drift));
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
finish();
