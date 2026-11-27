// The new comment box stays whole inside the window (top, bottom, a long draft): Send is always in view. Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/boxfits.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
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
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'labit-boxfits-'));
const PORT = claimPort(7960, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><meta charset="utf-8"><title>k</title><h1>Keys</h1><p>text</p><p id="low" style="position:absolute;top:735px;left:100px;margin:0">Low words</p><p id="mid" style="position:absolute;top:690px;left:100px;margin:0">Mid words</p>');
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
try {
  for (const eng of (process.env.ENGINES || 'webkit,chromium').split(',')) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
      await ctx.addInitScript(() => { localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      await p.goto(B + '/');
      await p.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.scrim')), null, { timeout: 5000 });
      await sleep(400);
      const ls = (k) => p.evaluate((x) => localStorage.getItem(x), k);
      const state = () => p.evaluate(() => {
        const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot;
        const f = r.querySelector('.float:not(.out)');
        if (!f) return null;
        const b = f.getBoundingClientRect();
        const send = f.querySelector('.send, button[type=submit], [data-k=send]');
        return { top: b.top, bottom: b.bottom, h: innerHeight, send: send ? send.getBoundingClientRect().bottom : null, ta: f.querySelector('textarea')?.getBoundingClientRect().height };
      });
      const open = async (x, y) => {
        await p.mouse.click(x, y);
        await p.waitForFunction(() => { const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot; return Boolean(r?.querySelector('.float textarea')); }, null, { timeout: 3000 });
        await sleep(500);
        return state();
      };
      const fits = (s) => s && s.top >= 4 && s.bottom <= s.h - 4;
      const close = async () => { await p.keyboard.press('Escape'); await sleep(400); };
      let s = await open(5, 5);
      check(eng, 'click at (5,5): the box is whole inside the window', fits(s), JSON.stringify(s));
      await close();
      for (const y of [700, 730, 750, 790]) {
        s = await open(400, y);
        check(eng, `click at y=${y}: the box is whole inside the window`, fits(s), JSON.stringify(s));
        await p.keyboard.type('a few words typed');
        await sleep(300);
        s = await state();
        check(eng, `click at y=${y}, typing: the box is still whole inside the window`, fits(s), JSON.stringify(s));
        await close();
      }
      s = await open(400, 700);
      await p.keyboard.type(Array.from({ length: 300 }, (_, i) => `word${i}`).join(' '));
      await sleep(400);
      s = await state();
      check(eng, 'a 300-word draft at y=700: the box, Send and the name row stay inside the window', fits(s) && s.send <= s.h - 4, JSON.stringify(s));
      await close();
      await p.evaluate(() => { const t = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot.querySelector('.float textarea'); if (t) t.value = ''; });
      // A short window: the words scroll inside the box, so Send stays in view.
      await p.setViewportSize({ width: 1000, height: 320 });
      await sleep(300);
      await open(400, 250);
      await p.keyboard.type(Array.from({ length: 300 }, (_, i) => `w${i}`).join(' '));
      await sleep(400);
      s = await state();
      check(eng, 'a 320 px window, a 300-word draft: the words scroll in the box and Send stays inside the window', fits(s) && s.send <= s.h - 4 && s.ta < 200, JSON.stringify(s));
      await close();
      // A long paste: the words past the box's tallest scroll (no words cut off at the top without a scrollbar) and the
      // cursor at their end stays in view. In a short window the tallest is under 200 px (180 at 360 px), so a medium paste, 180-200 px of words, counts too.
      const scroller = () => p.evaluate(() => {
        const t = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot.querySelector('.float textarea');
        return { sh: t.scrollHeight, ch: t.clientHeight, st: Math.round(t.scrollTop), ov: getComputedStyle(t).overflowY };
      });
      const scrolls = (t) => t.sh <= t.ch + 1 || (t.ov === 'auto' && t.st + t.ch >= t.sh - 2);
      // A paste of a few lines into a thread's reply box (your name known: text, "as <name>" and Send on one row): the
      // box grows with the words. Safari grew the field but not the box, so the first line stuck out above it (Leo 20 Nov).
      {
        await p.setViewportSize({ width: 1000, height: 800 });
        fs.writeFileSync(path.join(DIR, 'reply.html'), '<!doctype html><meta charset="utf-8"><title>r</title><h1>A thread</h1><p>words</p>');
        await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: '/reply', name: 'Claude', text: 'a thread to reply in', anchor: { selector: 'h1', x: 0.5, y: 0.5, docX: 60, docY: 30, width: 200 } }) });
        await p.evaluate(() => localStorage.setItem('lab-name', 'Leo'));
        await p.goto(B + '/reply');
        await p.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.scrim')), null, { timeout: 5000 });
        await sleep(800);
        const pin = await p.evaluate(() => {
          const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot;
          const b = [...r.querySelectorAll('.pin')].map((e) => e.getBoundingClientRect()).find((b) => b.width && b.top > 0);
          return b && { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        });
        await p.mouse.click(pin.x, pin.y);
        await sleep(600);
        const reply = () => [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot.querySelector('.card textarea');
        await p.evaluate(`(${reply})().focus()`);
        await p.keyboard.insertText('also there is selecting frame that removes ability to comment');
        await sleep(400);
        const r = await p.evaluate(`(() => { const t = (${reply})(); const a = t.getBoundingClientRect(), b = t.closest('.box').getBoundingClientRect();
          return { field: [Math.round(a.top), Math.round(a.bottom)], box: [Math.round(b.top), Math.round(b.bottom)], lines: Math.round(t.scrollHeight / 20) }; })()`);
        check(eng, 'a paste of a few lines in a reply: the box grows around them, no line sticks out above it', r.lines >= 2 && r.field[0] >= r.box[0] && r.field[1] <= r.box[1], JSON.stringify(r));
        await p.evaluate(`(${reply})().value = ''`);
        await close();
        await p.evaluate(() => localStorage.removeItem('lab-name'));
        await p.goto(B + '/');
        await p.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.scrim')), null, { timeout: 5000 });
        await sleep(400);
      }
      for (const [h, words] of [[800, 200], [360, 36]]) {
        await p.setViewportSize({ width: 1000, height: h });
        await sleep(300);
        await p.evaluate(() => { const t = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot.querySelector('.float textarea'); if (t) t.value = ''; });
        await open(400, 200);
        await p.keyboard.insertText(Array.from({ length: words }, (_, i) => `pasted${i}`).join(' '));
        await sleep(400);
        const t = await scroller();
        check(eng, `a ${h} px window, a ${words}-word paste: words past the box's tallest scroll, the cursor at the end in view`, t.sh > t.ch && scrolls(t), JSON.stringify(t));
        await close();
      }
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
