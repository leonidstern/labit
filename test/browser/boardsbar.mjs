// The page's boards in the bar (Leo, 23 Nov, pick S5): "boards · N" while the page has boards, opening a list of them
// and "new board"; the ⋯ menu has "new board" for a page with none; no +board in the comment box.
// Not part of `npm test`. Run: node test/browser/boardsbar.mjs (needs playwright).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();
const DIR = tmp('labit-boardsbar-');
const PORT = claimPort(8420, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'd.html'), '<!doctype html><meta charset="utf-8"><title>Page d</title>\n<h1>Page d</h1>\n<p id="t">Words</p>\n');
fs.writeFileSync(path.join(DIR, 'e.html'), '<!doctype html><meta charset="utf-8"><title>Page e</title>\n<h1>Page e</h1>\n');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);
const keys = () => JSON.parse(fs.readFileSync(path.join(DIR, '.lab/server.json'), 'utf8'));
const board = (body) => fetch(B + '/_lab/api/board', { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-admin': keys().token }, body: JSON.stringify(body) }).then((r) => r.json());
const boards = async () => (await (await fetch(`${B}/_lab/api/board`)).json()).boards;
const until = async (fn, ms = 6000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await fn()) return true;
  return false;
};

try {
  await board({ action: 'new', topic: 'Hero options', of: '/d' });
  await board({ action: 'new', topic: 'Spacing', of: '/d' });
  for (const eng of engines('chromium,webkit')) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'leo'); localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      const errors = [];
      p.on('pageerror', (e) => errors.push(e.message));
      const shadow = (f) => p.evaluate((src) => new Function('r', src)(document.querySelector('[data-lab-comments]').shadowRoot), f);
      const view = () => p.evaluate(() => Boolean(document.querySelector('[data-lab-board-view]')));
      const btn = () => shadow("const b = r.querySelector('.boards-btn'); return b ? { shown: !b.hidden, text: b.textContent } : null;");
      const menu = () => shadow("const m = r.querySelector('.more-menu'); return { open: m.matches(':popover-open') || !m.hidden, items: [...m.querySelectorAll('button')].filter((b) => !b.hidden).map((b) => b.textContent) };");

      await p.goto(B + '/d');
      await until(async () => (await btn())?.shown, 5000);
      const b0 = await btn();
      check(eng, 'a page with two boards has "boards · 2" in the bar', b0?.shown && b0.text === 'boards · 2', JSON.stringify(b0));
      await shadow("r.querySelector('.boards-btn').click()");
      await sleep(300);
      const m0 = await menu();
      check(eng, 'its click lists the boards by title with their frame counts, and new board', m0.open && m0.items.length === 3 && /^Hero options · 1$/.test(m0.items[0]) && /^Spacing · 1$/.test(m0.items[1]) && m0.items[2] === 'new board', JSON.stringify(m0));
      await shadow("[...r.querySelectorAll('.more-menu button')][1].click()");
      const opened = await until(view, 6000);
      check(eng, 'a board in the list opens over the page', opened && (await p.evaluate(() => location.hash)) === '#board=spacing');
      // WebKit keeps focus on the list's button for a moment after it closes, and an Esc then is the menu's, not the
      // board's: give it the moment a person's hand needs anyway.
      await sleep(600);
      await p.keyboard.press('Escape');
      check(eng, 'Esc closes it', await until(async () => !(await view())));
      await shadow("r.querySelector('.more').click()");
      await sleep(300);
      const m1 = await menu();
      check(eng, 'the ⋯ menu is the whole menu again, with new board in it', m1.open && m1.items.includes('new board') && !m1.items.some((t) => /Hero options/.test(t)), JSON.stringify(m1));
      await p.keyboard.press('Escape');

      // no +board in the comment box
      await p.click('#t');
      await p.waitForFunction(() => document.querySelector('[data-lab-comments]')?.shadowRoot?.querySelector('.float textarea'), null, { timeout: 8000 });
      await sleep(300);
      check(eng, 'no +board in the comment box', (await shadow("return r.querySelectorAll('.float .quick .own').length")) === 0);
      await p.keyboard.press('Escape');

      // a page with none: no bar part; ⋯ → new board makes one of the page, and it opens
      await p.goto(B + '/e');
      await sleep(1500);
      check(eng, 'a page with no boards has no boards part', !(await btn())?.shown, JSON.stringify(await btn()));
      const before = (await boards()).length;
      await shadow("r.querySelector('.more').click()");
      await sleep(300);
      await shadow("[...r.querySelectorAll('.more-menu button')].find((b) => b.textContent === 'new board').click()");
      const made = await until(view, 6000);
      const mine = (await boards()).filter((x) => x.of === '/e');
      check(eng, 'new board makes a board of the page and opens it', made && (await boards()).length === before + 1 && mine.length >= 1, JSON.stringify(mine));
      await p.keyboard.press('Escape');
      await until(async () => !(await view()));
      check(eng, 'then the bar has it', await until(async () => (await btn())?.shown && /^boards · \d+$/.test((await btn()).text), 4000), JSON.stringify(await btn()));
      check(eng, 'no page errors', !errors.length, errors.join(' | '));
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
