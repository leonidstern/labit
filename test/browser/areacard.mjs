// An area's thread card stays by its pin (Leo, 23 Nov: "opening at bottom right but at top is not from the pin"): a tall
// area drawn on a picture, its pin at the bottom right, in a window too short for the card above or below it. The card
// sits beside the pin, close and level, never over it and never at the area's far edge.
// Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/areacard.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });

const DIR = tmp('labit-areacard-');
const PORT = claimPort(8520, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(
  path.join(DIR, 'index.html'),
  '<!doctype html><meta charset="utf-8"><title>a</title><style>body{margin:0;font:16px/1.5 system-ui}main{padding:40px 16px 900px}#shot{display:block;margin:600px 0 0 auto;width:640px;height:360px;background:#c8d4e0}</style><main><h1>Area</h1><div id="shot"></div></main>',
);
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);
// An area over the picture's right part, 0.3 to 0.9 down: drawn from its top left, so its pin is at its bottom right.
const words = 'An area comment with a long enough message to make its card tall. '.repeat(5);
await fetch(B + '/_lab/api/comments', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: B },
  body: JSON.stringify({ page: '/index', name: 'Sam', text: words, anchor: { selector: '#shot', element: '<div>', kind: 'element', x: 0.8, y: 0.3, zw: 0.18, zh: 0.6, pinX: 1, pinY: 1, docX: 0.8, docY: 700, width: 1278, height: 614, eh: 360 } }),
});

try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1278, height: 614 } });
      await ctx.addInitScript(() => {
        localStorage.setItem('lab-name', 'leo');
        localStorage.setItem('lab-on', '1');
      });
      const p = await ctx.newPage();
      await p.goto(B + '/');
      await p.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('button.pin')), null, { timeout: 8000 });
      await sleep(900);
      const shadow = (fn, arg) => p.evaluate(([f, a]) => new Function('r', 'a', `return (${f})(r, a)`)([...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot, a), [fn.toString(), arg]);
      for (const at of [0.35, 0.6]) {
        await p.reload(); // each case from a closed card
        await p.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('button.pin')), null, { timeout: 8000 });
        await sleep(900);
        // The pin can still be on its way to its spot 900 ms after a load on a busy Mac (eight browser jobs at once): measured
        // then, the scroll put it somewhere else and the click missed. Scroll until the pin sits where this case wants it.
        for (let i = 0; i < 30; i++) {
          const pinY = await shadow((r) => r.querySelector('button.pin').getBoundingClientRect().top + scrollY);
          await p.evaluate(([y, f]) => scrollTo(0, y - innerHeight * f), [pinY, at]);
          await sleep(200);
          if (await shadow((r, f) => Math.abs(r.querySelector('button.pin').getBoundingClientRect().top - innerHeight * f) < 2, at)) break;
        }
        await sleep(300);
        const q = await shadow((r) => { const b = r.querySelector('button.pin').getBoundingClientRect(); return [b.x + 14, b.y + 14]; });
        await p.mouse.click(q[0], q[1]);
        await sleep(1000);
        const s = await shadow((r) => {
          const b = r.querySelector('button.pin').getBoundingClientRect();
          const c = [...r.querySelectorAll('.card')].find((n) => !n.classList.contains('out') && n.getBoundingClientRect().width)?.getBoundingClientRect();
          return { pin: [b.left, b.top, b.right, b.bottom], card: c && [c.left, c.top, c.right, c.bottom] };
        });
        const { pin, card } = s;
        const over = card && pin[0] < card[2] && card[0] < pin[2] && pin[1] < card[3] && card[1] < pin[3];
        const dx = card ? Math.max(0, card[0] - pin[2], pin[0] - card[2]) : 1e9;
        const dy = card ? Math.max(0, card[1] - pin[3], pin[1] - card[3]) : 1e9;
        check(eng, `pin ${at * 100}% down a short window: the card is open`, Boolean(card), JSON.stringify(s));
        check(eng, `pin ${at * 100}% down a short window: the card is not over its pin`, card && !over, JSON.stringify(s));
        check(eng, `pin ${at * 100}% down a short window: the card is by its pin`, Math.hypot(dx, dy) < 40, `gap ${dx.toFixed(0)}, ${dy.toFixed(0)} ${JSON.stringify(s)}`);
      }
      await p.close();
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true });
}
finish();
