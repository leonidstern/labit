// Experiments in real browsers (WebKit and Chrome's engine): talk (K) is off by default, so the bar has no tal(k) and K
// does nothing; the ⋯ menu's experiments section has a talk row reading "off"; a click turns it on at once (the menu
// stays open, the row reads "on", tal(k) shows on this page and on another open one, K starts a walk, your settings
// file has it), and a click again turns it off. Not part of `npm test`. Run: node test/browser/flags.mjs (NODE_PATH to a playwright).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });

const DIR = fs.realpathSync(tmp('labit-flags-'));
const CFG = tmp('labit-flags-cfg-');
const PORT = claimPort(11000, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><meta charset="utf-8"><title>f</title><h1 id="t">Flags</h1><p>text</p>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv({ XDG_CONFIG_HOME: CFG }), { port: PORT });
await labUp(B);
const mine = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(CFG, 'labit', 'settings.json'), 'utf8')).flags || {};
  } catch {
    return {};
  }
};

try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
      await ctx.addInitScript(() => {
        localStorage.setItem('lab-name', 'tester');
        localStorage.setItem('lab-on', '1');
      });
      const p = await ctx.newPage();
      const other = await ctx.newPage();
      for (const page of [other, p]) {
        await page.goto(B + '/');
        await page.waitForFunction(() => document.querySelector('[data-lab-comments]')?.shadowRoot?.querySelector('.more-menu'), null, { timeout: 15000 });
      }
      await sleep(400);
      const state = (page) => page.evaluate(() => {
        const root = document.querySelector('[data-lab-comments]').shadowRoot;
        const menu = root.querySelector('.more-menu');
        const row = menu.querySelector('[data-flag="talk"]');
        const pill = root.querySelector('.walkie');
        return {
          talk: !root.querySelector('.walkie-btn').hidden,
          pill: Boolean(pill && !pill.hidden),
          loaded: performance.getEntriesByType('resource').some((e) => /\/_lab\/walkie\.js/.test(e.name)),
          menuOpen: menu.matches(':popover-open') || !menu.hidden,
          head: row?.parentElement?.firstChild?.textContent || '',
          role: row?.getAttribute('role') || '',
          checked: row?.getAttribute('aria-checked') || '',
          end: row?.querySelector('kbd')?.textContent || '',
          words: row?.firstChild?.textContent || '',
        };
      });
      const root = (page) => page.evaluateHandle(() => document.querySelector('[data-lab-comments]').shadowRoot);

      // Off by default: no tal(k) in the bar, and K does nothing.
      let s = await state(p);
      check(eng, 'off by default: no tal(k) in the bar', !s.talk, JSON.stringify(s));
      await p.keyboard.press('k');
      await sleep(400);
      s = await state(p);
      check(eng, 'off: K does nothing (no walk, its part not even loaded)', !s.pill && !s.loaded, JSON.stringify(s));

      // The ⋯ menu: an experiments section with the talk row, reading off.
      await (await root(p)).evaluate((r) => r.querySelector('.more').click());
      await sleep(300);
      s = await state(p);
      check(eng, 'the ⋯ menu has an experiments section with a talk switch reading off', s.menuOpen && s.head === 'experiments' && s.role === 'switch' && s.checked === 'false' && s.words === 'talk' && s.end === 'off', JSON.stringify(s));

      // On: at once, here and on the other open page, and saved in your settings.
      await (await root(p)).evaluate((r) => r.querySelector('[data-flag="talk"]').click());
      await sleep(600);
      s = await state(p);
      check(eng, 'a click turns talk on: the menu stays open, the row reads on, tal(k) is in the bar', s.menuOpen && s.checked === 'true' && s.end === 'on' && s.talk, JSON.stringify(s));
      check(eng, 'saved in your own settings', mine().talk === true, JSON.stringify(mine()));
      const o = await state(other);
      check(eng, 'another open page hears it: tal(k) there too', o.talk && o.checked === 'true', JSON.stringify(o));

      // On, K starts a walk; Esc drops it.
      await (await root(p)).evaluate((r) => r.querySelector('.more').click());
      await sleep(300);
      await p.keyboard.press('k');
      await sleep(500);
      s = await state(p);
      check(eng, 'on: K starts a walk', s.pill && s.loaded, JSON.stringify(s));
      await p.keyboard.press('Escape');
      await sleep(400);

      // Off again: tal(k) gone, K inert, nothing left in your settings.
      await (await root(p)).evaluate((r) => r.querySelector('.more').click());
      await sleep(300);
      await (await root(p)).evaluate((r) => r.querySelector('[data-flag="talk"]').click());
      await sleep(600);
      s = await state(p);
      check(eng, 'a click again turns it off: the row reads off, no tal(k)', s.checked === 'false' && s.end === 'off' && !s.talk, JSON.stringify(s));
      check(eng, 'off: none on in your settings', !mine().talk, JSON.stringify(mine()));
      await (await root(p)).evaluate((r) => r.querySelector('.more').click());
      await sleep(300);
      await p.keyboard.press('k');
      await sleep(500);
      s = await state(p);
      check(eng, 'off again: K does nothing', !s.pill, JSON.stringify(s));
      await p.goto('about:blank');
      await other.goto('about:blank');
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.rmSync(CFG, { recursive: true, force: true });
}
finish();
