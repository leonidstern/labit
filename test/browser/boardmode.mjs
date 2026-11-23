// Shortcuts from labit.json in real browsers (WebKit and Chrome's engine): the changed keys work, the old ones don't,
// and the bar shows the new key. Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/shortcuts.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();

const DIR = tmp('labit-boardmode-');
const PORT = claimPort(8140, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'pricing.html'), '<!doctype html><meta charset="utf-8"><title>Pricing</title><h1>Pricing one</h1><div style="height:3000px"></div>');
fs.writeFileSync(path.join(DIR, 'checkout.html'), '<!doctype html><meta charset="utf-8"><title>Checkout</title><h1>Checkout</h1>');
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><meta charset="utf-8"><title>k</title><h1>Keys</h1><p>text</p>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);
try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      await ctx.addInitScript(() => localStorage.setItem('lab-name', 'tester'));
      const p = await ctx.newPage();
      await p.goto(B + '/pricing');
      await p.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.scrim')), null, { timeout: 5000 });
      await sleep(500);
      // a page stays a page: no key and no menu entry turns it into a canvas
      await p.keyboard.press('Shift+KeyB');
      await sleep(500);
      check(eng, 'Shift+B does nothing: a page stays a normal page', new URL(p.url()).pathname === '/pricing');
      const items = await p.evaluate(() => { const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot; r.querySelector('.more').click(); return [...r.querySelectorAll('.more-menu button')].map((b) => b.textContent); });
      check(eng, 'the ⋯ menu has no "open as board"', !items.some((t) => /board/.test(t)), JSON.stringify(items));
      await p.keyboard.press('Escape');
      // a board the agent made (labit board new, or the API) is part of its page: no ⌘K row of its own (Leo, 23 Nov:
      // "no own lab for boards"); its page's row says when it needs you
      await fetch(`${B}/_lab/api/board?name=checkout`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ v: 1, rev: 0, frames: [{ id: 'a', src: '/pricing', w: 390, h: 844 }], of: '/pricing' }) });
      await sleep(800);
      await p.keyboard.press('Control+KeyK');
      await sleep(1200);
      const rows = await p.evaluate(() => { const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot; return { boards: r.querySelectorAll('.sw-row[data-kind="board"]').length, pricing: r.querySelector('.sw-row[data-page="/pricing"]')?.textContent || '' }; });
      check(eng, '⌘K has no board rows; the page row says nothing while nothing on its board needs you', rows.boards === 0 && /pricing/i.test(rows.pricing) && !/needs your reply|agent working/.test(rows.pricing), JSON.stringify(rows));
      await p.keyboard.press('Escape');
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
