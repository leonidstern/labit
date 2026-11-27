// A page with no doctype (quirks mode, as an Artifact's HTML often is) reports the whole page's height as html's clientHeight.
// Next new (W) then scrolled short and opened the card off screen (Leo, 26 Nov). On such a page and on a standard one: W, ⌥W and
// ⌥⇧W (back through the ones read, Leo 27 Nov) land with the card and its pin on screen, ⌥⇧W types nothing in the reply box,
// ⇧W does nothing (Shift selects text), and a pin or a new-comment box opened low in the window keeps its card inside it.
// Not part of `npm test`; CI runs it in the `browser` job. Run: node test/browser/quirkspage.mjs (needs playwright).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { claimPort } from './port.mjs';

const require = createRequire(import.meta.url);
const pw = (() => {
  for (const paths of [undefined, (process.env.NODE_PATH || '').split(path.delimiter)]) {
    try {
      return require(require.resolve('playwright', paths && { paths }));
    } catch {}
  }
  console.log('playwright is not installed: skipped');
  process.exit(0);
})();

const LAB = fileURLToPath(new URL('../../local.mjs', import.meta.url));
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'labit-quirks-'));
const PORT = claimPort(8120, 30);
const B = `http://localhost:${PORT}`;
// Three blocks far apart, each a pin's element, on a page 9000 px tall.
const body = '<h1 style="margin:40px">Long page</h1>' + [1500, 4200, 7600].map((top, i) => `<div id="b${i + 1}" style="position:absolute;left:200px;top:${top}px;width:400px;height:200px;background:#ddd">block ${i + 1}</div>`).join('') + '<div style="height:9000px"></div>';
fs.writeFileSync(path.join(DIR, 'quirks.html'), `<title>q</title><meta charset="utf-8">${body}`);
fs.writeFileSync(path.join(DIR, 'standard.html'), `<!doctype html><title>s</title><meta charset="utf-8">${body}`);
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const env = { ...process.env, PORT: '', XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'labit-cfg-')), LABIT_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'labit-home-')), LABIT_NO_UPDATE_CHECK: '1', LABIT_EXIT_WITH_PARENT: '1' };
const server = spawn(process.execPath, [LAB, '--new', '--no-open'], { cwd: DIR, env });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 80; i++) {
  try {
    await fetch(B + '/');
    break;
  } catch {
    await sleep(100);
  }
}
let failed = 0;
const check = (eng, name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${eng.padEnd(8)} ${name}${detail ? ` (${detail})` : ''}`);
};
for (const page of ['/quirks', '/standard']) {
  for (const [i, top] of [1500, 4200, 7600].entries()) {
    await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page, name: 'Leo', text: `pin ${i + 1}`, anchor: { selector: `#b${i + 1}`, x: 0.5, y: 0.5, docX: 400, docY: top + 100, width: 400 } }) });
  }
}
const root = '[...document.querySelectorAll("*")].find((n) => n.shadowRoot?.querySelector(".scrim")).shadowRoot';
// The open card: which pin it is, and whether it and its pin are inside the window.
const state = (p) => p.evaluate(`(() => {
  const r = ${root};
  const card = r.querySelector('.card:not(.out)');
  if (!card) return null;
  const c = card.getBoundingClientRect();
  const n = (card.textContent.match(/pin (\\d)/) || [])[1];
  const pin = [...r.querySelectorAll('.pin')].map((e) => e.getBoundingClientRect()).filter((b) => b.width).sort((a, b) => Math.abs(a.top - c.top) - Math.abs(b.top - c.top))[0];
  return { n, card: [Math.round(c.top), Math.round(c.bottom)], pin: pin && Math.round(pin.top), vh: innerHeight, quirks: document.compatMode === 'BackCompat' };
})()`);
const inView = (s) => s && s.card[0] >= 0 && s.card[1] <= s.vh && s.pin >= 0 && s.pin <= s.vh;
try {
  for (const eng of (process.env.ENGINES || 'webkit,chromium').split(',')) {
    const browser = await pw[eng].launch();
    try {
      for (const page of ['/quirks', '/standard']) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        // A name of its own each time: what one name has read is shared with every browser under it.
        await ctx.addInitScript((name) => {
          localStorage.setItem('lab-on', '1');
          localStorage.setItem('lab-name', name);
        }, `me-${eng}${page.replace('/', '-')}`);
        const p = await ctx.newPage();
        await p.goto(B + page);
        await p.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => /3 new/.test(n.shadowRoot?.querySelector('[aria-label^="next new comment"]')?.getAttribute('aria-label') || '')), null, { timeout: 8000 });
        await p.bringToFront();
        await sleep(1200);
        const tag = `${page.slice(1)}:`;
        check(eng, `${tag} the page is in the mode the test means`, (await p.evaluate('document.compatMode')) === (page === '/quirks' ? 'BackCompat' : 'CSS1Compat'));
        // W from the top: the first new pin, 1500 px down.
        await p.keyboard.press('w');
        await sleep(1400);
        let s = await state(p);
        check(eng, `${tag} W opens the first new pin with its card and pin on screen`, s?.n === '1' && inView(s), JSON.stringify(s));
        // From the reply box the step focused: ⌥W on to the next new ones, down to the last near the page's end.
        const step = async (key, want, what) => {
          await p.keyboard.press(key);
          await sleep(1400);
          s = await state(p);
          check(eng, `${tag} ${what}`, s?.n === want && inView(s), JSON.stringify(s));
        };
        await step('Alt+KeyW', '2', '⌥W steps to the next new pin, on screen');
        await step('Control+KeyD', '3', "⌃D steps on too: the last one, near the page's end, on screen");
        // ⌥⇧W goes back through the ones read, the last read first (Leo, 26 Nov), read or not; at the first it stays.
        await step('Alt+Shift+KeyW', '2', '⌥⇧W goes back to the one read before, on screen');
        await step('Alt+Shift+KeyW', '1', '⌥⇧W again: the first one read, on screen');
        await step('Alt+Shift+KeyW', '1', '⌥⇧W at the first one read stays there');
        const typed = await p.evaluate(`${root}.querySelector('.card textarea')?.value`);
        check(eng, `${tag} ⌥W and ⌥⇧W from the reply box type nothing in it`, typed === '', JSON.stringify(typed));
        // Closed, with nothing open: ⇧W does nothing (Shift is for selecting), ⌥⇧W opens the last one read.
        await p.keyboard.press('Escape');
        await sleep(400);
        await p.evaluate('scrollTo(0, 0)');
        await sleep(300);
        await p.keyboard.press('Shift+KeyW');
        await sleep(800);
        check(eng, `${tag} ⇧W opens nothing`, (await state(p)) === null);
        await step('Alt+Shift+KeyW', '1', 'with no card open, ⌥⇧W opens the last one read, on screen');
        await p.keyboard.press('Escape');
        await sleep(300);
        // A pin low in the window: its card opens above it, inside the window.
        await p.evaluate(`(() => { const b = document.getElementById('b1').getBoundingClientRect(); scrollTo(0, scrollY + b.top + 100 - (innerHeight - 40)); })()`);
        await sleep(400);
        const pt = await p.evaluate(`(() => { const b = [...${root}.querySelectorAll('.pin')].map((e) => e.getBoundingClientRect()).find((b) => b.width && b.top > innerHeight / 2 && b.top < innerHeight); return b && { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
        if (pt) await p.mouse.click(pt.x, pt.y);
        await sleep(600);
        s = await state(p);
        check(eng, `${tag} a pin low in the window opens its card inside the window`, Boolean(pt) && s && s.card[0] >= 0 && s.card[1] <= s.vh, JSON.stringify({ pt, s }));
        await p.keyboard.press('Escape');
        await sleep(300);
        // A new comment near the window's bottom: its box stays inside the window.
        await p.mouse.click(900, 780);
        await sleep(500);
        const box = await p.evaluate(`(() => { const f = ${root}.querySelector('.float:not(.out)'); if (!f) return null; const b = f.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), vh: innerHeight }; })()`);
        check(eng, `${tag} a new-comment box near the window's bottom stays inside it`, box && box.top >= 0 && box.bottom <= box.vh, JSON.stringify(box));
        await ctx.close();
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true });
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
