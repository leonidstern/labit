// An open comment card with the cursor in its reply box follows the page: a paragraph put in above (a hot update) or a
// narrower window moves the pin and the card with their words, and the words typed so far (and the caret) stay.
// Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/cardfollows.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });

const DIR = tmp('labit-cardfollows-');
const PORT = claimPort(8470, 30);
const B = `http://localhost:${PORT}`;
const words = 'The quick brown fox jumps over the lazy dog while the committee reviews the quarterly figures. ';
const page = (extra) => `<!doctype html><meta charset="utf-8"><title>f</title><style>body{margin:0;font:17px/1.6 Georgia,serif}main{max-width:640px;margin:0 auto;padding:20px 16px 400px}</style><main><h1 id="t">Follows</h1>${Array.from({ length: 12 }, (_, i) => (i === 3 ? extra : '') + `<p id="p${i}">Paragraph ${i}. ${words.repeat(2)}</p>`).join('')}</main>`;
const file = path.join(DIR, 'index.html');
const plain = page('');
const longer = page('<p id="new">A new paragraph put in above the one with the open thread, long enough to wrap onto two lines of the column, so everything below it moves down.</p>');
fs.writeFileSync(file, plain);
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const env = labEnv();
const server = startLab(DIR, env);
await labUp(B);
await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', name: 'Sam', text: 'a thread on p3', anchor: { selector: '#p3', x: 0.5, y: 0.5, docX: 300, docY: 400, width: 600 } }) });

try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      await ctx.addInitScript(() => {
        localStorage.setItem('lab-name', 'leo');
        localStorage.setItem('lab-on', '1');
      });
      const p = await ctx.newPage();
      await p.goto(B + '/');
      await p.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('button.pin')), null, { timeout: 8000 });
      await sleep(900);
      const shadow = (fn, arg) => p.evaluate(([f, a]) => new Function('r', 'a', `return (${f})(r, a)`)([...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot, a), [fn.toString(), arg]);
      // Where the pin's tip and the card's top stand against the text they are on.
      const look = () => shadow((r) => {
        const q = r.querySelector('button.pin')?.getBoundingClientRect();
        const c = r.querySelector('.card:not(.out)')?.getBoundingClientRect();
        const t = document.querySelector('#p3').getBoundingClientRect();
        return { pin: q && [q.left, q.top], card: c && [c.left, c.top, c.right], text: [t.left, t.top], w: document.documentElement.clientWidth };
      });
      const dy = (s) => +(s.pin[1] - s.text[1]).toFixed(1);
      const cardDy = (s) => +(s.card[1] - s.pin[1]).toFixed(1);

      await p.evaluate('scrollTo(0, 200)');
      await sleep(300);
      const pin = await shadow((r) => { const q = r.querySelector('button.pin').getBoundingClientRect(); return [q.x + 14, q.y + 14]; });
      await p.mouse.click(pin[0], pin[1]);
      await sleep(900);
      // The cursor is in the reply box, some words typed and the caret two letters from their end.
      await shadow((r) => { const t = r.querySelector('.card textarea'); t.focus(); t.__mine = 1; });
      await p.keyboard.type('half a reply');
      await p.keyboard.press('ArrowLeft');
      await p.keyboard.press('ArrowLeft');
      await sleep(200);
      const before = await look();
      check(eng, 'the card is open with the cursor in its reply box', Boolean(before.card) && (await shadow((r) => r.activeElement?.localName)) === 'textarea');

      // The page changes under it: a paragraph above.
      fs.writeFileSync(file, longer);
      await sleep(2500);
      let s = await look();
      check(eng, 'the words moved down', s.text[1] - before.text[1] > 30, `${before.text[1]} -> ${s.text[1]}`);
      check(eng, 'the pin moved with its words', Math.abs(dy(s) - dy(before)) < 2, `offset ${dy(before)} -> ${dy(s)}`);
      check(eng, 'the card stays by its pin', Math.abs(cardDy(s) - cardDy(before)) < 2, `${cardDy(before)} -> ${cardDy(s)}`);
      const kept = await shadow((r) => { const t = r.querySelector('.card textarea'); return { mine: t?.__mine, v: t?.value, s: t?.selectionStart, e: t?.selectionEnd, focus: r.activeElement === t }; });
      check(eng, 'the reply box is the same one, with its words, caret and focus', kept.mine === 1 && kept.v === 'half a reply' && kept.s === 10 && kept.e === 10 && kept.focus, JSON.stringify(kept));

      // Closing it does not make the pin jump: it was already there.
      await shadow((r) => {
        window.__tops = [];
        const tick = () => { const q = r.querySelector('button.pin'); if (q) window.__tops.push(q.getBoundingClientRect().top - document.querySelector('#p3').getBoundingClientRect().top); window.__go && requestAnimationFrame(tick); };
        window.__go = true;
        tick();
      });
      await p.keyboard.press('Escape');
      await sleep(500);
      const tops = await p.evaluate('window.__go = false, window.__tops');
      check(eng, 'closing it does not move the pin', Math.max(...tops) - Math.min(...tops) < 2, `range ${(Math.max(...tops) - Math.min(...tops)).toFixed(1)}`);

      // A narrower window, the card open and the cursor in it: the pin and the card come along, on the screen.
      fs.writeFileSync(file, plain);
      await sleep(2500);
      await p.mouse.click(...(await shadow((r) => { const q = r.querySelector('button.pin').getBoundingClientRect(); return [q.x + 14, q.y + 14]; })));
      await sleep(900);
      await shadow((r) => { const t = r.querySelector('.card textarea'); t.focus(); });
      await p.keyboard.type('more words');
      await p.setViewportSize({ width: 500, height: 800 });
      await sleep(600);
      s = await look();
      const [x] = [s.pin[0]];
      check(eng, 'a narrower window: the pin is on the screen with its words', x >= 0 && x < 500 && s.card && s.card[2] <= 500, JSON.stringify(s));
      const typed = await shadow((r) => ({ v: r.querySelector('.card textarea')?.value, focus: r.activeElement?.localName }));
      check(eng, 'a narrower window: the typed words stay', typed.v?.endsWith('more words') && typed.focus === 'textarea', JSON.stringify(typed));
      // On its words as a fresh drawing puts it (the paragraph wraps differently now, so the old offset is no yardstick).
      await shadow((r) => { r.querySelector('.card textarea').blur(); });
      await p.keyboard.press('Escape');
      await sleep(500);
      const fresh = await look();
      check(eng, 'a narrower window: the pin is where a fresh drawing puts it', Math.abs(fresh.pin[1] - s.pin[1]) < 2 && Math.abs(fresh.pin[0] - s.pin[0]) < 2, `${s.pin.map(Math.round)} vs ${fresh.pin.map(Math.round)}`);

      // #467: the pin low in the window, its card open; a tall block put in above pushes the pin past the window's
      // bottom. The card goes with its pin (above or below it), not held mid-window beside a pin that is gone.
      await p.setViewportSize({ width: 1200, height: 800 });
      await sleep(400);
      const pinTop = () => shadow((r) => r.querySelector('button.pin').getBoundingClientRect().top + scrollY);
      await p.evaluate((y) => scrollTo(0, y - 700), await pinTop());
      await sleep(400);
      await p.mouse.click(...(await shadow((r) => { const q = r.querySelector('button.pin').getBoundingClientRect(); return [q.x + 14, q.y + 14]; })));
      await sleep(900);
      fs.writeFileSync(file, page('<div id="new" style="height:600px"></div>'));
      await sleep(2500);
      const low = await shadow((r) => {
        const q = r.querySelector('button.pin').getBoundingClientRect();
        const c = r.querySelector('.card:not(.out)').getBoundingClientRect();
        return { pin: [q.top, q.bottom], card: [c.top, c.bottom], vh: innerHeight };
      });
      const gap = Math.min(Math.abs(low.pin[0] - low.card[1]), Math.abs(low.card[0] - low.pin[1]));
      check(eng, 'pushed past the window: the pin is below it', low.pin[0] > low.vh, JSON.stringify(low));
      check(eng, 'pushed past the window: the card is still next to its pin', gap < 40, `gap ${gap.toFixed(1)} ${JSON.stringify(low)}`);
      await p.keyboard.press('Escape');

      // #467 ("clicking new glitching"): one card open, a click on another pin. The new card is drawn whole from its
      // first frame: same height, no jump (a thread's messages were drawn at a 64 px guess for a frame, then grew).
      fs.writeFileSync(file, plain);
      const long = 'A long message that wraps over several lines of the card so its height is well past the first guess. '.repeat(4);
      for (const sel of ['#p6', '#p8']) await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', name: 'Sam', text: long + sel, anchor: { selector: sel, x: 0.5, y: 0.5, docX: 300, docY: 900, width: 600 } }) });
      await p.reload();
      await p.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelectorAll('button.pin').length >= 3), null, { timeout: 8000 });
      await sleep(900);
      await p.evaluate(() => scrollTo(0, document.querySelector('#p6').getBoundingClientRect().top + scrollY - 300));
      await sleep(400);
      const pinOf = (sel) => shadow((r, s) => {
        const t = document.querySelector(s).getBoundingClientRect();
        const q = [...r.querySelectorAll('button.pin')].map((b) => b.getBoundingClientRect()).sort((a, b) => Math.abs(a.top - t.top) - Math.abs(b.top - t.top))[0];
        return [q.x + 14, q.y + 14];
      }, sel);
      await p.mouse.click(...(await pinOf('#p6')));
      await sleep(900);
      const to = await pinOf('#p8');
      await shadow((r) => {
        window.__frames = [];
        const tick = () => {
          const c = [...r.querySelectorAll('.card')].find((n) => !n.classList.contains('out') && n.getBoundingClientRect().width);
          if (c) window.__frames.push([c.offsetHeight, c.getBoundingClientRect().top]);
          if (window.__frames.length < 120) requestAnimationFrame(tick);
        };
        tick();
      });
      await p.mouse.click(...to);
      await sleep(1500);
      const frames = await p.evaluate('window.__frames');
      const last = frames.at(-1);
      // From the first frame the new card shows: its height is its final one.
      const firstNew = frames.findIndex((f, i) => i > 0 && Math.abs(f[1] - frames[0][1]) > 1);
      const fresh2 = frames.slice(Math.max(firstNew, 0));
      const hs = fresh2.map((f) => f[0]);
      check(eng, 'another pin clicked: its card has its height from the first frame', Math.max(...hs) - Math.min(...hs) < 2, `heights ${[...new Set(hs)].join(", ")}`);
      const jumps = fresh2.slice(1).map((f, i) => Math.abs(f[1] - fresh2[i][1]));
      check(eng, 'another pin clicked: its card does not jump', Math.max(0, ...jumps) < 12, `largest step ${Math.max(0, ...jumps).toFixed(1)}, ends at ${last}`);
      // #467 ("selecting near + cancels my select"): words selected in the reply box by a drag that ends on "+" stay selected.
      for (const end of ['.clip', '.send']) {
        await shadow((r) => { const t = r.querySelector('.card textarea'); t.value = 'select these words please'; t.focus(); t.setSelectionRange(0, 0); });
        const [from, to2] = await shadow((r, e) => {
          const t = r.querySelector('.card textarea').getBoundingClientRect();
          const b = r.querySelector(`.card ${e}`)?.getBoundingClientRect();
          return [[t.left + 3, t.top + t.height / 2], b && [b.left + b.width / 2, b.top + b.height / 2]];
        }, end);
        if (!to2) continue;
        await p.mouse.move(...from);
        await p.mouse.down();
        await p.mouse.move(to2[0], to2[1], { steps: 8 });
        await p.mouse.up();
        await sleep(200);
        const sel = await shadow((r) => { const t = r.querySelector('.card textarea'); return [t.selectionStart, t.selectionEnd]; });
        check(eng, `a drag selecting the reply's words that ends on ${end}: they stay selected`, sel[1] - sel[0] > 5, JSON.stringify(sel));
      }
      await p.keyboard.press('Escape');
      await p.close();
      await ctx.close();
      fs.writeFileSync(file, plain);
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true });
}
finish();
