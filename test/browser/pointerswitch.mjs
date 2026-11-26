// The pin and the arrow in the bar, and folding the bar, in real browsers (WebKit and Chrome's engine). With the pin
// (a lab page's start), a click on a button drops a comment and the button doesn't run, ⌥ click runs it; with the arrow
// the page is the page (its pointers, its clicks) and ⌥ click pins. C and V pick them (not while typing), the pick is kept, a board starts with the
// arrow. › folds the bar into the rabbit, ‹ or H opens it, and a reload keeps it folded.
// Run: node test/browser/pointerswitch.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish, withAlt } from './harness.mjs';

const pw = playwright();

const DIR = tmp('labit-pointer-');
const PORT = claimPort(7990, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><meta charset="utf-8"><title>p</title><h1>Pointers</h1><p><button id="b" type="button">0</button> <input id="f"></p><p id="t" style="padding:20px">plain words</p><script>b.onclick = () => (b.textContent = String(Number(b.textContent) + 1));</script>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
fs.mkdirSync(path.join(DIR, '.lab/boards'), { recursive: true });
fs.writeFileSync(path.join(DIR, '.lab/boards/sw.json'), JSON.stringify({ v: 1, name: 'sw', rev: 1, of: '/index', frames: [{ id: 'a', src: '/index', w: 390, h: 600, state: 'live' }] }));
const server = startLab(DIR, labEnv());
await labUp(B);

const root = 'const r = [...document.querySelectorAll("*")].find((n) => n.shadowRoot?.querySelector(".scrim"))?.shadowRoot;';
// Which pointer is lit, whether a new comment's box is open, the button's count, and the bar's shown parts.
const look = (p) =>
  p.evaluate((src) => new Function(`${src} const bar = r?.querySelector('.bar');
    return { lit: [...(r?.querySelectorAll('.mode button') || [])].find((b) => b.classList.contains('on'))?.dataset.m || '',
      box: Boolean(r?.querySelector('.float')), n: document.getElementById('b')?.textContent,
      shown: [...(bar?.children || [])].filter((n) => !n.hidden && getComputedStyle(n).display !== 'none').length,
      folded: Boolean(r?.host.hasAttribute('data-folded')) };`)(), root);
const until = (p, fn, ms = 1500) => p.waitForFunction(new Function(`${root} return (${fn})(r);`), null, { timeout: ms, polling: 'raf' }).catch(() => {});
const closeBox = async (p) => (await p.keyboard.press('Escape'), await sleep(150), await p.keyboard.press('Escape'), await sleep(150));

try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await ctx.addInitScript(() => localStorage.setItem('lab-name', 'tess'));
      const p = await ctx.newPage();
      await p.goto(B + '/');
      await until(p, (r) => r?.querySelector('.mode') && !r.querySelector('.mode').hidden, 3000);
      await p.mouse.move(500, 400);
      let s = await look(p);
      check(eng, 'a lab page starts with the pin', s.lit === 'comment', JSON.stringify(s));

      await p.click('#b');
      await until(p, (r) => r?.querySelector('.float'));
      s = await look(p);
      check(eng, 'pin: a click on a button opens a new comment, and the button does not run', s.box && s.n === '0', JSON.stringify(s));
      await closeBox(p);

      await withAlt(p, () => p.click('#b', { modifiers: ['Alt'] }));
      await sleep(250);
      s = await look(p);
      check(eng, 'pin: ⌥ click runs the button, no comment', !s.box && s.n === '1', JSON.stringify(s));

      await p.mouse.click(10, 10);
      await p.keyboard.press('v');
      await sleep(150);
      s = await look(p);
      check(eng, 'V picks the arrow', s.lit === 'use', JSON.stringify(s));
      await p.click('#b');
      await sleep(250);
      s = await look(p);
      check(eng, 'arrow: a click runs the button, no comment', !s.box && s.n === '2', JSON.stringify(s));
      await p.click('#t');
      await sleep(250);
      s = await look(p);
      const cur = await p.evaluate(() => getComputedStyle(document.getElementById('t')).cursor);
      check(eng, 'arrow: plain words keep the page\'s own pointer and a click there pins nothing', !s.box && cur !== 'none', `${cur} ${JSON.stringify(s)}`);
      await withAlt(p, () => p.click('#b', { modifiers: ['Alt'] }));
      await until(p, (r) => r?.querySelector('.float'));
      s = await look(p);
      check(eng, 'arrow: ⌥ click pins on the button', s.box && s.n === '2', JSON.stringify(s));
      await closeBox(p);

      await p.click('#f'); // the arrow: the field takes the click
      await p.keyboard.type('cvh');
      await sleep(150);
      s = await look(p);
      const typed = await p.inputValue('#f');
      check(eng, 'C, V and H typed in a field are letters, nothing switches or folds', typed === 'cvh' && s.lit === 'use' && !s.folded, `${typed} ${JSON.stringify(s)}`);
      await p.mouse.click(10, 10);
      await closeBox(p);

      await p.keyboard.press('c');
      await sleep(150);
      s = await look(p);
      check(eng, 'C picks the pin', s.lit === 'comment', JSON.stringify(s));
      await p.reload();
      await until(p, (r) => r?.querySelector('.mode') && !r.querySelector('.mode').hidden, 3000);
      s = await look(p);
      check(eng, 'the pick is kept after a reload', s.lit === 'comment', JSON.stringify(s));

      const open = s.shown;
      await p.evaluate(new Function(`${root} r.querySelector('.fold').click();`));
      await sleep(200);
      s = await look(p);
      check(eng, '› folds the bar down to itself and the rabbit', s.folded && s.shown <= 2 && open > 2, `${open} → ${JSON.stringify(s)}`);
      await p.reload();
      await until(p, (r) => r?.querySelector('.bar') && !r.querySelector('.bar').hidden, 3000);
      s = await look(p);
      check(eng, 'a reload keeps the bar folded', s.folded && s.shown <= 2, JSON.stringify(s));
      await p.mouse.move(500, 400);
      await p.keyboard.press('h');
      await sleep(200);
      s = await look(p);
      check(eng, 'H opens the bar again', !s.folded && s.shown === open, JSON.stringify(s));

      await p.goto('about:blank');
      await p.goto(B + '/index#board=sw');
      await p.waitForFunction(() => Boolean(window.__labBoard), null, { timeout: 5000 }).catch(() => {});
      await sleep(300);
      s = await look(p);
      check(eng, 'a board starts with the arrow, though the page has the pin', s.lit === 'use', JSON.stringify(s));
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
}
finish();
