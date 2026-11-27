// The motion menu can always be reached (Leo, 23 Nov, #421): computers right-click a moving thing and its menu opens at
// the pointer, on screen near the edges, for the thing under the pointer and not its neighbour. Phones: ⋯ → motion opens
// a sheet; "pick on page" then a tap on a video picks it without playing or pausing it and without a pin, and the sheet
// comes back for it. Nothing of labit sits on the page when no menu is open. In WebKit and Chrome's engine.
// Not part of `npm test`. Run: node test/browser/motionreach.mjs (NODE_PATH to a playwright).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();

const DIR = tmp('labit-reach-');
const PORT = claimPort(7990, 30);
const B = `http://localhost:${PORT}`;
fs.copyFileSync(fileURLToPath(new URL('../../bench/site/media/countdown.webm', import.meta.url)), path.join(DIR, 'v.webm'));
fs.writeFileSync(path.join(DIR, 'index.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>r</title>
<style>@keyframes slide { to { translate: 240px } } @keyframes pulse { 50% { scale: 1.4 } }
body { margin: 0; font: 16px sans-serif; min-height: 1400px } .row { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; padding: 20px }
#track { width: 340px; max-width: 80vw; height: 80px; background: #eee } #loop { width: 60px; height: 60px; margin: 10px; background: #333; animation: slide 1.2s linear infinite }
#dot { width: 20px; height: 20px; border-radius: 50%; background: #888; animation: pulse .8s ease-in-out infinite }
video { width: 200px } #edge { position: absolute; right: 0; top: 260px; width: 30px; height: 30px; background: #555; animation: pulse 1s infinite }
#low { position: fixed; left: 120px; bottom: 0; width: 40px; height: 16px; background: #555; animation: pulse 1s infinite }
#n1, #n2 { width: 36px; height: 36px; animation: pulse .9s infinite } #n1 { background: #444 } #n2 { background: #777 }</style>
<div class="row"><div id="track"><div id="loop"></div></div><div id="dot"></div><video id="vid" src="v.webm" muted loop autoplay playsinline></video></div>
<div class="row"><div id="n1"></div><div id="n2"></div></div>
<div class="row"><div id="film" style="width:80px;height:45px;background:#999"></div><div id="flash" style="width:36px;height:36px;background:#bbb"></div></div>
<div id="edge"></div><div id="low"></div><p>text</p>
<script>document.getElementById('film').animate([{ opacity: 1 }, { opacity: 0.99 }], { duration: 120000 }); document.getElementById('flash').animate([{ opacity: 1 }, { opacity: 0.5 }], { duration: 3000 });</script>`);
const server = startLab(DIR, labEnv(), { port: PORT });
await labUp(B);
const ROOT = "[...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot";
const inRoot = (p, js) => p.evaluate(`(() => { const r = ${ROOT}; return ${js}; })()`);
const menu = (p) => inRoot(p, "(() => { const m = r?.querySelector('.motion-menu'); if (!m || m.hidden || (m.popover && !m.matches(':popover-open'))) return null; const l = m.offsetLeft, t = m.offsetTop; return { head: m.querySelector('.lab-head')?.textContent, items: [...m.querySelectorAll(':scope > button')].map((n) => n.textContent), l, t, r: l + m.offsetWidth, btm: t + m.offsetHeight }; })()");
const tapItem = (p, label) => inRoot(p, `[...r.querySelectorAll('.motion-menu button')].find((b) => b.textContent === ${JSON.stringify(label)})?.click()`);
const loaded = (p) => p.waitForFunction(() => performance.getEntriesByType('resource').some((e) => /\/_lab\/motion\.js/.test(e.name)), null, { timeout: 3000 }).catch(() => {});
const box = (p, id) => p.evaluate((i) => document.getElementById(i).getBoundingClientRect().toJSON(), id);

try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await ctx.addInitScript(() => localStorage.setItem('lab-name', 'zz-moment'));
      const p = await ctx.newPage();
      await p.goto(B + '/');
      await loaded(p);
      await sleep(800);
      const canPlay = await p.evaluate(() => document.getElementById('vid').readyState >= 2);
      // Each one, at its own spot: the menu is about that thing, at the pointer or pulled back on screen near an edge.
      for (const [id, want, fx, fy] of [['loop', /^loop /, 0.5, 0.5], ['dot', /^loop /, 0.5, 0.5], ['vid', /^video /, 0.3, 0.7], ['edge', /^loop /, 0.5, 0.5], ['low', /^loop /, 0.5, 0.5], ['n1', /^loop /, 0.3, 0.5], ['n2', /^loop /, 0.7, 0.5], ['film', /^animation /, 0.5, 0.5]]) {
        if (id === 'vid' && !canPlay) continue;
        const r = await box(p, id);
        const x = r.left + r.width * fx, y = r.top + r.height * fy;
        await p.mouse.click(x, y, { button: 'right' });
        await sleep(200);
        const m = await menu(p);
        const onScreen = Boolean(m && m.l >= 0 && m.t >= 0 && m.r <= 1000 && m.btm <= 700);
        const near = Boolean(m && Math.min(Math.abs(m.l - x), Math.abs(m.r - x)) < 3 && Math.min(Math.abs(m.t - y), Math.abs(m.btm - y)) < 3);
        await tapItem(p, 'pause');
        await sleep(200);
        const stopped = await p.evaluate((i) => { const e = document.getElementById(i); return e instanceof HTMLVideoElement ? e.paused : e.getAnimations()[0]?.playState === 'paused'; }, id);
        const others = await p.evaluate((i) => ['loop', 'dot', 'n1', 'n2'].filter((o) => o !== i).every((o) => document.getElementById(o).getAnimations()[0]?.playState === 'running'), id);
        check(eng, `${id}: its menu opens at the pointer, on screen, and its pause stops only it`, Boolean(m) && want.test(m.head || '') && onScreen && near && stopped && others, JSON.stringify({ m, at: [x, y], stopped, others }));
        const now = await box(p, id); // where it stopped
        await p.mouse.click(now.left + now.width * fx, now.top + now.height * fy, { button: 'right' });
        await sleep(200);
        await tapItem(p, 'play');
        await sleep(200);
      }
      // A short animation that ends is a moment, not motion: a right-click on it is the browser's (no labit menu).
      const fr = await box(p, 'flash');
      await p.mouse.click(fr.left + fr.width / 2, fr.top + fr.height / 2, { button: 'right' });
      await sleep(200);
      const short = await menu(p);
      await p.keyboard.press('Escape');
      check(eng, 'a short animation that ends gets no motion menu (the page\'s own right-click menu: no motion head, no pause)', !short?.head && !short?.items.includes('pause'), JSON.stringify(short));
      const none = await inRoot(p, "Boolean(r.querySelector('.motion-ctl, .motions'))") || (await menu(p));
      check(eng, 'no menu open: nothing of labit on the page', !none);
      await ctx.close();

      // Phones: ⋯ → motion → the sheet; pick on page; a tap on the video picks it, does nothing else, and its sheet comes.
      const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      await ph.addInitScript(() => localStorage.setItem('lab-name', 'zz-moment'));
      const q = await ph.newPage();
      await q.goto(B + '/');
      await loaded(q);
      await sleep(1200);
      const more = await inRoot(q, "r.querySelector('.bar .more')?.getBoundingClientRect().toJSON()");
      await q.touchscreen.tap(more.left + more.width / 2, more.top + more.height / 2);
      await sleep(300);
      const row = await inRoot(q, "[...r.querySelectorAll('.more-menu button')].find((b) => b.textContent === 'motion')?.getBoundingClientRect().toJSON()");
      check(eng, 'phone: the ⋯ menu has a motion row', Boolean(row));
      if (row) await q.touchscreen.tap(row.left + row.width / 2, row.top + row.height / 2);
      await sleep(400);
      const first = await menu(q);
      check(eng, 'phone: motion opens its sheet: pick on page, pause all, speed', first?.head === 'motion' && JSON.stringify(first.items) === JSON.stringify(['pick on page', 'pause all']) && (await inRoot(q, "Boolean(r.querySelector('.motion-sheet .motion-speed'))")), JSON.stringify(first));
      await tapItem(q, 'pick on page');
      await sleep(400);
      check(eng, 'phone: picking, the sheet is gone', !(await menu(q)));
      const target = canPlay ? 'vid' : 'loop';
      const before = await q.evaluate(() => ({ paused: document.getElementById('vid').paused, n: [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot.querySelectorAll('.pin').length }));
      const tr = await box(q, target);
      await q.touchscreen.tap(tr.left + tr.width / 2, tr.top + tr.height / 2);
      await sleep(600);
      const picked = await menu(q);
      const after = await q.evaluate(() => ({ paused: document.getElementById('vid').paused, n: [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot.querySelectorAll('.pin').length, draft: Boolean([...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot.querySelector('.float textarea')) }));
      check(eng, 'phone: the tap picks it, its sheet comes, and the tap neither plays, pauses nor pins', Boolean(picked) && (canPlay ? /^video /.test(picked.head) : /^loop /.test(picked.head)) && picked.items[0] === 'pause' && picked.items.some((t) => t.startsWith('comment at')) && after.paused === before.paused && after.n === before.n && !after.draft, JSON.stringify({ picked, before, after }));
      await tapItem(q, 'pause');
      await sleep(300);
      const sheetStays = await menu(q);
      const isPaused = await q.evaluate((i) => { const e = document.getElementById(i); return e instanceof HTMLVideoElement ? e.paused : e.getAnimations()[0]?.playState === 'paused'; }, target);
      check(eng, 'phone: pause in the sheet stops it and the sheet stays, now saying play', isPaused && sheetStays?.items[0] === 'play', JSON.stringify(sheetStays));
      const at = sheetStays?.items.find((t) => t.startsWith('comment at'));
      await tapItem(q, at);
      await sleep(600);
      const draft = await inRoot(q, "({ box: Boolean(r.querySelector('.float textarea')), line: r.querySelector('.float > .moment')?.textContent || '' })");
      check(eng, 'phone: comment at opens a new comment that carries that moment', draft.box && (canPlay ? /video/.test(draft.line) : /loop/.test(draft.line)) && !(await menu(q)), JSON.stringify(draft));
      await ph.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
}
finish();
