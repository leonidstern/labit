// A board pin's new mark and its done look (Leo, 26 Nov). One open of an unread pin on a board reads it: its new mark goes
// and stays gone after a reload ("i needed to read new twice" was two pins on one spot, each new). A done (resolved) pin has
// no white disc over the frame or the board under it ("should be transparent"), on a page as on a board, but is not see-through
// either (27 Nov, "why so transparent"): frosted pale green, faded like any done pin.
// Not part of `npm test`. Run: node test/browser/boarddone.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();
const DIR = tmp('labit-boarddone-');
const PORT = claimPort(8450, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'pricing.html'), '<!doctype html><meta charset="utf-8"><title>Pricing</title><h1>Pricing</h1><p id="p">Plan</p>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);
const json = { 'content-type': 'application/json', origin: B };
await fetch(`${B}/_lab/api/board?name=done`, { method: 'PUT', headers: json, body: JSON.stringify({ v: 1, rev: 0, of: '/pricing', frames: [{ id: 'a', src: '/pricing', w: 600, h: 400, x: 0, y: 0 }] }) });
const post = (body) => fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: json, body: JSON.stringify({ page: '/pricing', ...body }) }).then((r) => r.json());
const anchor = (fx, fy) => ({ kind: 'board', board: 'done', frame: 'a', fx, fy, bx: fx, by: fy, selector: '', x: 0, y: 0, docX: 0, docY: 0, width: 1200, height: 800 });
const open = await post({ name: 'Sam', text: 'an unread pin', anchor: anchor(120, 100) });
const done = await post({ name: 'Sam', text: 'a done pin', anchor: anchor(400, 100) });
await post({ action: 'resolve', id: done.comment.id, edit: done.edit });
await post({ name: 'Sam', text: 'a done pin on the page', anchor: { selector: '#p', x: 0.5, y: 0.5, docX: 300, docY: 80, width: 1200, element: '<p>', kind: 'element' } }).then((r) => post({ action: 'resolve', id: r.comment.id, edit: r.edit }));
try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', `leo-${navigator.userAgent.includes('Chrome') ? 'c' : 'w'}`); localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => console.log('pageerror', e.message));
      const R = '[...document.querySelectorAll("*")].find((n) => n.shadowRoot?.querySelector(".scrim")).shadowRoot';
      // the open (unread) one: the only board pin that is not done
      const pin = () => p.evaluate(`(() => { const b = ${R}.querySelector('button.pin.onb:not(.resolved)'); if (!b) return null; const q = b.getBoundingClientRect(); const cs = getComputedStyle(b); return { cls: b.className, x: q.x + q.width / 2, y: q.y + q.height / 2, bg: cs.backgroundColor }; })()`);
      const pins = () => p.evaluate(`[...${R}.querySelectorAll('button.pin')].map((b) => ({ id: b.dataset.id, cls: b.className, bg: getComputedStyle(b).backgroundColor, op: getComputedStyle(b).opacity }))`);
      // a done pin on the page itself
      await p.goto(B + '/pricing');
      await p.waitForFunction(`Boolean(${R}?.querySelector('button.pin'))`, null, { timeout: 8000 });
      await sleep(600);
      const onPage = (await pins()).find((x) => /resolved/.test(x.cls) && !/\bonb\b/.test(x.cls));
      // frosted: a colour with some alpha, never white, never clear
      const frosted = (x) => x && /\/ 0\.\d+\)|rgba\(\d+, \d+, \d+, 0\.\d+\)/.test(x.bg) && !/rgba\(0, 0, 0, 0\)|transparent/.test(x.bg);
      check(eng, 'a done pin on a page is frosted (no white disc, not see-through)', frosted(onPage), JSON.stringify(onPage));
      await p.goto(B + '/pricing#board=done');
      await p.reload();
      await p.waitForFunction(() => document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('#lab-board .f[data-id="a"] iframe[data-ready]'), null, { timeout: 10000 });
      await sleep(1200);
      const all = await pins();
      const d = all.find((x) => /resolved/.test(x.cls) && /\bonb\b/.test(x.cls));
      check(eng, 'a done pin on a board is frosted (no white disc, not see-through)', frosted(d), JSON.stringify(all));
      const n0 = await pin();
      check(eng, 'an unread board pin wears the new mark', n0 && /\bnew\b/.test(n0.cls), JSON.stringify(n0));
      await p.mouse.click(n0.x, n0.y);
      await sleep(700);
      await p.keyboard.press('Escape');
      await sleep(500);
      const n1 = await pin();
      check(eng, 'opened once, its new mark is gone', n1 && !/\bnew\b/.test(n1.cls), JSON.stringify(n1));
      await p.reload();
      await p.waitForFunction(() => document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('#lab-board'), null, { timeout: 10000 });
      await sleep(1500);
      const n2 = await pin();
      check(eng, '…and stays gone after a reload', n2 && !/\bnew\b/.test(n2.cls), JSON.stringify(n2));
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
finish();
