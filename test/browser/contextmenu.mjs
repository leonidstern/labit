// The right-click menu in real browsers (WebKit and Chrome's engine). On plain words: comment here, draw here, and quote
// these words when words are selected; on a button: comment on it and, with the pin, use it (the arrow: only the
// comment row); on something moving: comment at its moment first, then pause; on a pin or a drawing: open, reply,
// resolve, delete. The keys a row shows work while it is open, a press outside only closes it, ⌃ click opens it without
// also clicking what is under it, ⌥ right-click is the browser's. Computers only.
// Run: node test/browser/contextmenu.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();

const DIR = tmp('labit-ctxmenu-');
const PORT = claimPort(8110, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><meta charset="utf-8"><title>m</title><style>@keyframes spin{to{rotate:1turn}}#s{width:48px;height:48px;background:#3c6;animation:spin 3s linear infinite}</style><h1>Menu</h1><p id="t" style="padding:10px">plain words for the menu to sit on, and more words after them</p><p><button id="b" type="button">0</button></p><div id="s"></div><p id="u" style="padding:10px">more plain words down here</p><script>b.onclick = () => (b.textContent = String(Number(b.textContent) + 1));</script>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);

const R = '[...document.querySelectorAll("*")].find((n) => n.shadowRoot?.querySelector(".scrim"))?.shadowRoot';
const rows = (p) => p.evaluate(`(() => { const m = ${R}?.querySelector('.motion-menu'); return m && !m.hidden ? [...m.querySelectorAll('button')].map((b) => b.firstChild?.textContent?.trim()).join('|') : ''; })()`);
const pick = (p, re) => p.evaluate(`[...${R}.querySelectorAll('.motion-menu button')].find((b) => ${re}.test(b.textContent))?.click()`);
const has = (p, sel) => p.evaluate(`Boolean(${R}?.querySelector(${JSON.stringify(sel)}))`);
const mid = async (p, sel, dx = 20) => { const r = await (await p.$(sel)).boundingBox(); return [r.x + dx, r.y + r.height / 2]; };
const right = async (p, at, opts = {}) => { await p.mouse.move(...at); await p.mouse.click(...at, { button: 'right', ...opts }); await sleep(400); };
const esc = async (p) => { await p.keyboard.press('Escape'); await sleep(150); await p.keyboard.press('Escape'); await sleep(150); };
const comments = async () => (await (await fetch(`${B}/_lab/api/comments?page=/index`)).json()).comments.filter((c) => !c.parent);

try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await ctx.addInitScript(() => (localStorage.setItem('lab-name', 'tess'), localStorage.setItem('lab-hint-seen', '1')));
      const p = await ctx.newPage();
      await p.goto(B + '/');
      await p.waitForFunction(`Boolean(${R}?.querySelector('.bar:not([hidden])'))`, null, { timeout: 5000 }).catch(() => {});
      await sleep(1800); // the menu's code comes in once the page has loaded

      const t = await mid(p, '#t');
      await right(p, t);
      check(eng, 'on plain words: comment here, draw here', (await rows(p)) === 'comment here|draw here', await rows(p));
      await pick(p, '/comment here/');
      await sleep(300);
      check(eng, 'comment here opens a new comment', await has(p, '.float textarea'));
      await esc(p);

      await right(p, t);
      await p.mouse.click(t[0] + 300, t[1]);
      await sleep(300);
      check(eng, 'a press outside the menu only closes it, nothing pinned', !(await rows(p)) && !(await has(p, '.float')));
      await esc(p);

      const b = await mid(p, '#b', 8);
      await right(p, b);
      check(eng, 'on a button, with the pin: comment on it, use it', (await rows(p)) === 'comment on this button|use this button', await rows(p));
      await pick(p, '/use this/');
      await sleep(250);
      check(eng, 'use this button runs it', (await p.textContent('#b')) === '1', await p.textContent('#b'));
      await p.keyboard.press('v');
      await sleep(150);
      await right(p, b);
      check(eng, 'with the arrow, only the comment row', (await rows(p)) === 'comment on this button', await rows(p));
      await esc(p);
      await p.keyboard.press('c');

      const s = await mid(p, '#s', 24);
      await right(p, s);
      const moving = await rows(p);
      check(eng, 'on something moving: comment at its moment first, then pause', /^comment at [^|]+\|pause\|/.test(moving), moving);
      await p.keyboard.press('p');
      await sleep(250);
      check(eng, 'P in the open menu pauses it, as its row does', !(await rows(p)) && (await p.evaluate(() => document.getAnimations().some((a) => a.playState === 'paused'))));
      await esc(p);

      await p.keyboard.down('Alt');
      await right(p, t);
      await p.keyboard.up('Alt');
      check(eng, '⌥ right-click is the browser\'s: no menu', !(await rows(p)));

      // a pin, then its menu
      const u = await mid(p, '#u');
      await p.mouse.click(...u);
      await p.waitForFunction(`Boolean(${R}?.querySelector('.float textarea'))`, null, { timeout: 2000 }).catch(() => {});
      await p.keyboard.type('menu pin');
      await p.keyboard.press('Enter');
      await sleep(600);
      await esc(p);
      await sleep(3200); // its undo card has gone
      const pinAt = await p.evaluate(`(() => { const n = [...${R}.querySelectorAll('.pin:not(.draft)')].pop(); const r = n.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
      await right(p, pinAt);
      check(eng, 'on a pin: open, reply, resolve, delete', (await rows(p)) === 'open|reply|resolve|delete', await rows(p));
      await p.keyboard.press('r');
      await sleep(400);
      check(eng, 'R in the open menu opens the thread, the reply box focused', await p.evaluate(`Boolean(${R}.activeElement?.closest?.('.card'))`));
      await esc(p);
      // ⌃ click is a right-click on macOS only, where the browser fires contextmenu for it; on Linux (CI's Chromium)
      // and Windows it is a plain click, so there is no menu to check.
      if (process.platform === 'darwin') {
        await p.keyboard.down('Control');
        await p.mouse.click(...pinAt);
        await p.keyboard.up('Control');
        await sleep(400);
        const ctl = await rows(p);
        await pick(p, '/^open/');
        await sleep(400);
        check(eng, '⌃ click opens the menu and does not click the pin: open then opens it', ctl.startsWith('open|') && (await has(p, '.card')), ctl);
      }
      await esc(p);
      await right(p, pinAt);
      await pick(p, '/^resolve/');
      await sleep(700);
      check(eng, 'resolve resolves the thread', Boolean((await comments()).find((c) => c.text === 'menu pin')?.resolved));
      const made = (await comments()).find((c) => c.text === 'menu pin');
      await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', action: 'reopen', id: made?.id }) });
      await p.reload();
      await sleep(2000);
      await right(p, pinAt);
      await pick(p, '/^delete/');
      await sleep(700);
      check(eng, 'delete takes the thread away (this computer)', !(await comments()).some((c) => c.text === 'menu pin'));

      // a drawing, made from the menu's draw here, then its menu
      await right(p, t);
      await pick(p, '/draw here/');
      await sleep(250);
      await p.mouse.move(200, 600);
      await p.mouse.down();
      await p.mouse.move(420, 630, { steps: 10 });
      await p.mouse.up();
      await sleep(2500);
      const ink = await p.evaluate(`(() => { const n = [...${R}.querySelectorAll('.pin')].filter((x) => x.querySelector('svg')).pop(); const h = n?.querySelector('.hit') || n?.querySelector('path'); const r = h?.getBoundingClientRect(); return r ? [r.x + r.width / 2, r.y + r.height / 2] : null; })()`);
      check(eng, 'draw here draws one drawing and sends it', Boolean(ink) && (await comments()).some((c) => c.anchor?.ink));
      if (ink) {
        await right(p, ink);
        check(eng, 'on a drawing: the same rows as a pin', (await rows(p)) === 'open|reply|resolve|delete', await rows(p));
        await esc(p);
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
finish();
