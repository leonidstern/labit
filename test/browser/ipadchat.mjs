// A pull down on a tablet's chat scrolls its messages; only one that starts with them at their top may close it. On an
// iPad (a coarse pointer, but wide: the chat is a computer's window, bottom right, no sheet) a phone sheet's rule still
// held: a pull down in the window's top quarter took the window, messages and all, and closed it, and the next pulls went
// to the page, which Safari reloaded (pull to refresh; iPad Pro 11 simulator, 27 Nov). Checks: with the messages scrolled
// part way, a pull down in the window's top quarter is left to them (not cancelled) and the chat stays, untouched; one that
// scrolls them up to their top and pulls on is stopped there (cancelled: nothing past them, not the page) and still closes
// nothing; the page can't be pulled while the chat is open (overscroll-behavior); and with the messages at their top a
// pull down still closes it. The touches are made up (events with touches, as sheetpan does); a native scroll can't be,
// so the messages' scroll is set by hand between the moves.
// Run: node test/browser/ipadchat.mjs (needs playwright). Not part of `npm test`; CI runs it in the `browser` job.
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });
const DIR = tmp('labit-ipadchat-');
const PORT = String(claimPort(11780, 30));
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>C</title><body style="margin:20px;font:16px/1.5 sans-serif"><h1>Chat</h1><p>A page.</p></body>');
const server = startLab(DIR, labEnv({}, { settings: false }), { root: '.', port: PORT });
await labUp(B);
const token = JSON.parse(fs.readFileSync(path.join(DIR, '.lab', 'server.json'), 'utf8')).token;
const post = (body) => fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-admin': token }, body: JSON.stringify({ page: '/index', ...body }) }).then((r) => r.json());
for (let i = 0; i < 40; i++) await post({ name: i % 2 ? 'Sam' : 'Claude · session 1234abcd', text: `message ${i}: ${'a line of words in the chat. '.repeat(1 + (i % 4))}`, anchor: { kind: 'page', width: 834, height: 1124, dpr: 2 } });

try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 834, height: 1124 }, isMobile: eng !== 'firefox', hasTouch: true });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'tess'); localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      await p.goto(B + '/');
      await p.waitForFunction(() => document.querySelector('[data-lab-comments]')?.shadowRoot?.querySelector('.chat-btn'), null, { timeout: 20000 });
      await sleep(500);
      const openChat = async () => {
        await p.evaluate(() => document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.chat-btn').click());
        await p.waitForFunction(() => document.querySelector('[data-lab-comments]').hasAttribute('data-sheet'), null, { timeout: 8000 });
        await sleep(1500); // its way in, and its stay at the newest message (comments.js stayAtEnd)
      };
      const isOpen = () => p.evaluate(() => document.querySelector('[data-lab-comments]').hasAttribute('data-sheet'));
      // A pull down from the window's top quarter: `top` is where the messages' scroll is put once the pull has started
      // (null: left as it is). Says which moves were cancelled and where the window was drawn on the way.
      const pull = (scrollAt, top = null) => p.evaluate(async ([scrollAt, top]) => {
        const root = document.querySelector('[data-lab-comments]').shadowRoot;
        const win = root.querySelector('.chatwin');
        const box = win.querySelector('.msgs');
        box.scrollTop = scrollAt;
        await new Promise((r) => setTimeout(r, 250)); // a scroll just before a pull leaves it to the messages (sheets.ts scrolledAt)
        const w = win.getBoundingClientRect();
        const x = w.left + w.width / 2;
        const y = Math.max(w.top + 8, box.getBoundingClientRect().top + 10, w.top + w.height * 0.1);
        const at = root.elementFromPoint ? root.elementFromPoint(x, y) : box;
        const target = box.contains(at) ? at : box;
        const send = (type, yy, t) => {
          const e = new Event(type, { bubbles: true, cancelable: true, composed: true });
          const touch = { identifier: 5, clientX: x, clientY: yy };
          Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [touch] });
          Object.defineProperty(e, 'changedTouches', { value: [touch] });
          Object.defineProperty(e, 'timeStamp', { value: t });
          target.dispatchEvent(e);
          return e.defaultPrevented;
        };
        const t0 = performance.now();
        send('touchstart', y, t0);
        const cancelled = [];
        const drawn = [];
        for (let i = 1; i <= 8; i++) {
          if (i === 3 && top !== null) box.scrollTop = top;
          cancelled.push(send('touchmove', y + i * 25, t0 + i * 16));
          drawn.push(win.style.transform || '');
        }
        send('touchend', y + 200, t0 + 140);
        return { y: Math.round(y - w.top), h: Math.round(w.height), inBox: box.contains(at), cancelled, drawn, scrollTop: box.scrollTop };
      }, [scrollAt, top]);

      await openChat();
      const ov = await p.evaluate(() => {
        const box = document.querySelector('[data-lab-comments]').shadowRoot.querySelector('.chatwin .msgs');
        return { box: getComputedStyle(box).overscrollBehaviorY, page: getComputedStyle(document.documentElement).overscrollBehaviorY, room: box.scrollHeight - box.clientHeight };
      });
      check(eng, 'the chat is a window with messages to scroll', ov.room > 400, JSON.stringify(ov));
      check(eng, 'while it is open, neither its messages nor the page pass a pull on to the browser (no pull to refresh)', ov.box === 'contain' && ov.page === 'none', JSON.stringify(ov));

      // 1. Messages scrolled part way: the pull is theirs.
      const a = await pull(300);
      await sleep(900);
      check(eng, 'messages scrolled part way: a pull down in the top quarter is left to them', a.inBox && a.y < a.h / 4 && a.cancelled.every((c) => !c), JSON.stringify(a));
      check(eng, '... the window doesn\'t move', a.drawn.every((d) => !d), JSON.stringify(a.drawn));
      check(eng, '... and the chat stays open', await isOpen());

      // 2. A pull that scrolls them up to their top and pulls on: stopped there, closes nothing.
      const b = await pull(300, 0);
      await sleep(900);
      check(eng, 'a pull that reaches the messages\' top goes no further (cancelled there: not the page)', b.cancelled.slice(2).every(Boolean), JSON.stringify(b));
      check(eng, '... the window doesn\'t move', b.drawn.every((d) => !d), JSON.stringify(b.drawn));
      check(eng, '... and the chat stays open', await isOpen());

      // 3. Messages at their top: a pull down may close it.
      const c = await pull(0);
      await sleep(1200);
      check(eng, 'messages at their top: a pull down takes the window', c.cancelled.every(Boolean) && c.drawn.some((d) => /translateY\(\d/.test(d)), JSON.stringify(c));
      check(eng, '... and closes the chat', !(await isOpen()));
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
}
finish();
