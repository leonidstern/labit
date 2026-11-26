// A board opened over a page with many pins: every pin of the page hides in the first frame the board shows, and stays
// hidden while the view slides in and rests, when the tab comes back to the front and when another board opens over it (Leo, 26 Nov: in Safari they went one by one, and came back over the sliding
// board). The board's own pin shows once it rests, and closing the board brings the page's pins back. Not part of `npm test`.
// Run: node test/browser/boardhidepins.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();
const DIR = tmp('labit-boardhidepins-');
const PORT = claimPort(8360, 30);
const B = `http://localhost:${PORT}`;
const N = 120;
const rows = Array.from({ length: N }, (_, i) => `<p id="r${i}" style="display:inline-block;width:70px;height:40px;margin:2px">row ${i}</p>`).join('');
fs.writeFileSync(path.join(DIR, 'pricing.html'), '<!doctype html><meta charset="utf-8"><title>Pricing</title><h1>Pricing</h1>');
// a sticky header with pins of its own: those the browser holds (anchor positioning), which Safari placed apart
fs.writeFileSync(path.join(DIR, 'canvas.html'), `<!doctype html><meta charset="utf-8"><title>Canvas</title><header style="position:sticky;top:0;background:#fff"><a id="go" href="/_lab/board/pricing?of=%2Fcanvas">open the board</a> <b id="s0">one</b> <b id="s1">two</b></header><div>${rows}</div>`);
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT, flags: { board: true } }));
const server = startLab(DIR, labEnv());
await labUp(B);
const post = (body) => fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/canvas', name: 'Sam', ...body }) });
await fetch(`${B}/_lab/api/board?name=pricing`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ v: 1, rev: 0, of: '/canvas', frames: [{ id: 'a', src: '/pricing', w: 390, h: 600, x: 0, y: 0 }] }) });
const ids = [...Array.from({ length: N }, (_, i) => `#r${i}`), '#s0', '#s1'];
await Promise.all(ids.map((selector, i) => post({ text: `pin ${i}`, anchor: { selector, x: 0.5, y: 0.5, docX: 0, docY: 0, width: 1200 } })));
await fetch(`${B}/_lab/api/board?name=other`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ v: 1, rev: 0, of: '/canvas', frames: [{ id: 'z', src: '/pricing', w: 390, h: 600, x: 0, y: 0 }] }) });
await post({ name: 'Bo', text: 'on the board', anchor: { kind: 'board', board: 'pricing', frame: 'a', fx: 60, fy: 80 } });
const PAGE = ids.length;
try {
  for (const eng of engines('webkit,chromium')) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'leo'); localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => console.log('pageerror', e.message));
      await p.goto(B + '/canvas');
      await p.waitForFunction((n) => [...document.querySelectorAll('*')].find((x) => x.shadowRoot?.querySelector('.scrim'))?.shadowRoot.querySelectorAll('.pin:not(.draft)').length >= n, PAGE, { timeout: 15000 });
      await sleep(800);
      // Each frame from the click on the board's link: the page's pins and the board's that show.
      await p.evaluate(() => {
        const r = [...document.querySelectorAll('*')].find((x) => x.shadowRoot?.querySelector('.scrim')).shadowRoot;
        const shows = (pin) => { const s = getComputedStyle(pin); return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.01 && pin.getBoundingClientRect().width > 0; };
        window.__shown = () => { const pins = [...r.querySelectorAll('.pin:not(.draft)')]; const board = pins.filter((n) => /by Bo\b/.test(n.getAttribute('aria-label') || '')); return { page: pins.filter((n) => !board.includes(n) && shows(n)).length, all: pins.filter(shows).length }; };
        const log = (window.__frames = []);
        const tick = () => { log.push({ view: Boolean(document.querySelector('[data-lab-board-view]')), ...window.__shown() }); if (log.length < 60) requestAnimationFrame(tick); };
        document.getElementById('go').click();
        requestAnimationFrame(tick);
      });
      await sleep(1600);
      const frames = await p.evaluate(() => window.__frames);
      const first = frames.findIndex((f) => f.view);
      const late = frames.slice(first).filter((f) => f.page > 0).length;
      check(eng, `none of the page's ${PAGE} pins shows from the first frame the board shows on (frames with some: ${late})`, first >= 0 && late === 0, JSON.stringify(frames.slice(0, 24).map((f) => [f.view ? 1 : 0, f.page])));
      const rest = await p.evaluate(() => window.__shown());
      check(eng, 'at rest the board\'s own pin shows, the page\'s none', rest.page === 0 && rest.all === 1, JSON.stringify(rest));
      // Away to another tab and back (Leo, 26 Nov: "they also appear if i leave tab and then come later"): the pins are
      // read again as the tab shows, and none of the page's comes up over the board, in any frame.
      const other = await ctx.newPage();
      await other.goto(B + '/pricing');
      await sleep(300);
      await p.bringToFront();
      await p.evaluate(() => {
        const log = (window.__frames = []);
        const tick = () => { log.push(window.__shown().page); if (log.length < 40) requestAnimationFrame(tick); };
        document.dispatchEvent(new Event('visibilitychange')); // headless tabs may not tell: the widget's own reload of the pins, now
        requestAnimationFrame(tick);
      });
      await sleep(900);
      const again = await p.evaluate(() => window.__frames);
      check(eng, 'back from another tab, none of the page\'s pins shows over the board in any frame', again.length && again.every((n) => n === 0), JSON.stringify(again));
      await other.close();
      // One board opened over another (the first closes as the second opens): the page's pins stay hidden.
      await p.evaluate(() => {
        const log = (window.__frames = []);
        const tick = () => { log.push(window.__shown().page); if (log.length < 40) requestAnimationFrame(tick); };
        window.__labBoardView.show('other');
        requestAnimationFrame(tick);
      });
      await sleep(900);
      const swap = await p.evaluate(() => ({ frames: window.__frames, view: document.querySelector('[data-lab-board-view]')?.getAttribute('data-lab-board-view') }));
      check(eng, 'another board over the first: none of the page\'s pins shows in any frame', swap.view === 'other' && swap.frames.every((n) => n === 0), JSON.stringify(swap));
      for (let i = 0; i < 3 && (await p.$('[data-lab-board-view]')); i++) { await p.keyboard.press('Escape'); await sleep(600); } // back goes through the first board
      await p.waitForFunction(() => !document.querySelector('[data-lab-board-view]'), null, { timeout: 4000 });
      await sleep(400);
      const back = await p.evaluate(() => window.__shown());
      check(eng, 'closed, every pin of the page shows again', back.page === PAGE, JSON.stringify(back));
      // A page that comes back reloaded with its board in the address (a save while the tab was away reloads it as it
      // shows): from its first frame on, none of the page's pins shows, as the board opens again over it.
      await p.addInitScript(() => {
        const log = (window.__frames = []);
        const tick = () => {
          const r = [...document.querySelectorAll('*')].find((x) => x.shadowRoot?.querySelector('.scrim'))?.shadowRoot;
          const pins = r ? [...r.querySelectorAll('.pin:not(.draft)')].filter((n) => !/by Bo\b/.test(n.getAttribute('aria-label') || '')) : [];
          log.push(pins.filter((n) => getComputedStyle(n).visibility !== 'hidden' && Number(getComputedStyle(n).opacity) > 0.01 && n.getBoundingClientRect().width > 0).length);
          if (log.length < 150) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await p.goto('about:blank');
      await p.goto(B + '/canvas#board=pricing');
      await p.waitForFunction(() => window.__frames.length >= 150, null, { timeout: 10000 });
      const load = await p.evaluate(() => window.__frames);
      check(eng, 'reloaded with #board: none of the page\'s pins shows in any frame', load.every((n) => n === 0), JSON.stringify(load));
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
finish();
