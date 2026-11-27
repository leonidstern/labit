// A board's page frames show the whole page: the frame is as tall as its page, nothing scrolls inside it, a page sized by
// the window's height (100vh) does not grow without end, and the frames under a grown one move down to keep clear of it
// (Leo, 26 Nov: "dont show pages inside boards pls i cant scroll there zoom or whatever, always show full thing").
// Not part of `npm test`. Run: node test/browser/boardfull.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();
const DIR = tmp('labit-boardfull-');
const PORT = claimPort(8420, 30);
const B = `http://localhost:${PORT}`;
const doc = (t, body) => `<!doctype html><meta charset="utf-8"><title>${t}</title><style>body{margin:0}</style>${body}`;
fs.writeFileSync(path.join(DIR, 'long.html'), doc('Long', '<h1>Long</h1><div style="height:2400px;background:linear-gradient(#cde,#edc)"></div><p id="end">end</p>'));
fs.writeFileSync(path.join(DIR, 'hero.html'), doc('Hero', '<section style="min-height:100vh;background:#dfe">hero</section><div style="height:1000px">rest</div><p id="end">end</p>'));
fs.writeFileSync(path.join(DIR, 'short.html'), doc('Short', '<p>short</p>'));
// a page that grows by itself after it is up, twice by the same 100 px (pictures, fonts)
fs.writeFileSync(path.join(DIR, 'steps.html'), doc('Steps', '<div style="height:1200px;background:#ecd"></div><div id="more"></div><p id="end">end</p><script>let n = 0; const add = () => { const x = document.createElement("div"); x.style.height = "100px"; document.getElementById("more").append(x); if (++n < 2) setTimeout(add, 500); }; setTimeout(add, 1500);</script>'));
// …and one that puts a 100vh section in after it is up: its growth is the frame's own coming back, still not without end
fs.writeFileSync(path.join(DIR, 'latevh.html'), doc('Late', '<div style="height:800px"></div><script>setTimeout(() => document.body.insertAdjacentHTML("beforeend", "<section style=\\"min-height:100vh;background:#dfe\\">late</section>"), 1500);</script>'));
// a page with a script of its own: a save reloads it (not patched in place)
const live = (n) => doc('Live', `<script>window.x = 1</script><h1>Live</h1><div style="height:${n}px;background:#cde"></div><p>end</p>`);
fs.writeFileSync(path.join(DIR, 'live.html'), live(1200));
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);
await fetch(`${B}/_lab/api/board?name=full`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ v: 1, rev: 0, frames: [
  { id: 'a', src: '/long', w: 600, h: 500, x: 0, y: 0 },
  { id: 'b', src: '/hero', w: 600, h: 500, x: 700, y: 0 },
  { id: 'c', src: '/short', w: 600, h: 500, x: 1400, y: 0 },
  { id: 'd', src: '/short', w: 600, h: 300, x: 0, y: 660 }, // under a: moved down as a grows, the gap kept
] }) });
await fetch(`${B}/_lab/api/board?name=steps`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ v: 1, rev: 0, frames: [{ id: 'a', src: '/steps', w: 600, h: 500, x: 0, y: 0 }, { id: 'b', src: '/latevh', w: 600, h: 500, x: 700, y: 0 }] }) });
await fetch(`${B}/_lab/api/board?name=upd`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ v: 1, rev: 0, frames: [{ id: 'a', src: '/live', w: 600, h: 500, x: 0, y: 0 }, { id: 'b', src: '/short', w: 600, h: 300, x: 0, y: 660 }] }) });
try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'tester'); localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => console.log('pageerror', e.message));
      await p.goto(B + '/_lab/board/full');
      await p.waitForFunction(() => ['a', 'b', 'c'].every((i) => document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector(`iframe[name="lab:${i}"]`)?.dataset.ready), null, { timeout: 10000 });
      await sleep(800);
      const read = () => p.evaluate(() => Object.fromEntries(['a', 'b', 'c', 'd'].map((i) => {
        const box = document.querySelector('[data-lab-board-view]').shadowRoot.querySelector(`#lab-board .f[data-id="${i}"]`);
        const fr = box.querySelector('iframe');
        const d = fr?.contentDocument;
        return [i, { boxH: parseFloat(box.style.height), top: parseFloat(box.style.top), frH: fr?.offsetHeight, pageH: d && Math.max(d.documentElement.scrollHeight, d.body.scrollHeight), inner: d && d.documentElement.scrollHeight - d.documentElement.clientHeight, end: d?.getElementById('end')?.getBoundingClientRect().bottom }];
      })));
      const r = await read();
      check(eng, `a long page's frame is as tall as its page`, r.a.boxH === r.a.pageH && r.a.boxH > 2400 && r.a.frH === r.a.boxH, JSON.stringify(r.a));
      check(eng, `nothing scrolls inside it (its end is in the frame)`, r.a.inner <= 0 && r.a.end <= r.a.frH, JSON.stringify(r.a));
      check(eng, `a 100vh page is its device's height plus the rest, not more`, r.b.boxH >= 1500 && r.b.boxH <= 1560 && r.b.end <= r.b.frH, JSON.stringify(r.b));
      check(eng, `a short page keeps its device's height`, r.c.boxH === 500, JSON.stringify(r.c));
      check(eng, `the frame under a grown one moves down, the gap kept`, r.d.top === r.a.boxH + 160, JSON.stringify({ a: r.a, d: r.d }));
      await sleep(1500);
      const r2 = await read();
      check(eng, `the 100vh page does not keep growing`, r2.b.boxH === r.b.boxH, JSON.stringify({ was: r.b.boxH, now: r2.b.boxH }));
      // a reload draws them tall at once (kept per frame), before any page has loaded
      await p.reload();
      await p.waitForFunction(() => document.querySelector('[data-lab-board-view]').shadowRoot.querySelector('#lab-board .f[data-id="a"]'), null, { timeout: 8000 });
      const first = await p.evaluate(() => parseFloat(document.querySelector('[data-lab-board-view]').shadowRoot.querySelector('#lab-board .f[data-id="a"]').style.height));
      check(eng, `after a reload the frame is tall from the start`, first === r.a.boxH, JSON.stringify({ first, was: r.a.boxH }));
      // "fit" shows every frame whole
      await p.waitForFunction(() => document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('iframe[name="lab:a"]')?.dataset.ready, null, { timeout: 8000 });
      await sleep(600);
      const fits = await p.evaluate(() => [...document.querySelector('[data-lab-board-view]').shadowRoot.querySelectorAll('#lab-board .f')].every((f) => { const b = f.getBoundingClientRect(); return b.top >= -1 && b.bottom <= innerHeight + 1; }));
      check(eng, 'fit shows every frame whole', fits);
      // the wheel over an entered frame pans the board
      await p.evaluate(() => { const a = document.querySelector('[data-lab-board-view]').shadowRoot.querySelector('#lab-board .f[data-id="a"]'); a.classList.add('in'); });
      const before = await p.evaluate(() => document.querySelector('[data-lab-board-view]').shadowRoot.querySelector('#lab-board .world').style.transform);
      const box = await p.evaluate(() => { const b = document.querySelector('[data-lab-board-view]')?.shadowRoot?.querySelector('iframe[name="lab:a"]').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + 40 }; });
      await p.mouse.move(box.x, box.y);
      await p.mouse.wheel(0, 200);
      await sleep(500);
      const after = await p.evaluate(() => document.querySelector('[data-lab-board-view]').shadowRoot.querySelector('#lab-board .world').style.transform);
      check(eng, `a wheel over an open frame moves the board`, before !== after, JSON.stringify({ before, after }));
      await p.evaluate(() => document.querySelector('[data-lab-board-view]').shadowRoot.querySelector('#lab-board .f[data-id="a"]').classList.remove('in'));
      // With the pin tool (C) a plain click on a frame comments, at its top and far down its page (Leo, 26 Nov: "cant comment
      // pin on board"); the pin is on frame a, at the page's own px.
      const sr = '[...document.querySelectorAll("*")].find((n) => n.shadowRoot?.querySelector(".scrim"))?.shadowRoot';
      const draft = () => p.evaluate(`Boolean(${sr}?.querySelector('.pin.draft'))`);
      await p.mouse.move(600, 400);
      await p.keyboard.press('c');
      await sleep(300);
      for (const [where, k] of [['top', 0.03], ['far down', 0.95]]) {
        const a = await p.evaluate(() => { const r = document.querySelector('[data-lab-board-view]').shadowRoot.querySelector('#lab-board .f[data-id="a"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y, h: r.height }; });
        const y = a.y + a.h * k;
        const spot = await p.evaluate(([x, y]) => __labBoard.anchor(x, y), [a.x, y]);
        await p.mouse.click(a.x, y);
        await sleep(700);
        check(eng, `with the pin tool a click comments on the frame (${where})`, (await draft()) && spot.frame === 'a' && (k < 0.5 ? spot.fy < 300 : spot.fy > 2200), JSON.stringify(spot));
        await p.keyboard.press('Escape');
        await sleep(500);
      }
      // Next new (W) to a pin far down a tall frame: the board's camera goes there (the frame does not scroll; it can't).
      await fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/_board/full', name: 'Sam', text: 'far down', anchor: { kind: 'board', board: 'full', frame: 'a', fx: 300, fy: 2400, bx: 300, by: 2400, selector: '', x: 0, y: 0, docX: 0, docY: 0, width: 1200, height: 800 } }) });
      await p.reload();
      await p.waitForFunction(() => window.__labBoard?.camera, null, { timeout: 8000 });
      await sleep(1500);
      await p.keyboard.press('Escape');
      await p.mouse.move(600, 400);
      await p.keyboard.press('Shift+Digit2'); // 100%, the top of the board in view: the pin is off the screen
      await sleep(500);
      const far = () => p.evaluate(`(() => { const b = [...${sr}.querySelectorAll('button.pin')].find((x) => !x.classList.contains('draft') && x.getBoundingClientRect().width); if (!b) return null; const q = b.getBoundingClientRect(); return { y: q.y, vis: getComputedStyle(b).visibility }; })()`);
      const off = await far();
      await p.keyboard.press('w');
      await sleep(800);
      const on = await far();
      check(eng, 'next new (W) brings a pin far down a tall frame into view: the camera goes there', on && on.y > 40 && on.y < 760 && on.vis === 'visible', JSON.stringify({ off, on }));
      await p.keyboard.press('Escape');
      // A save of a frame's page (it has a script: the frame is loaded anew): no moment without the page in the frame, and the
      // new height and the frame under it ease there rather than jump (Leo, 26 Nov: "when board opened and page updated can it be more smooth").
      const V = 'document.querySelector("[data-lab-board-view]").shadowRoot';
      await p.goto(B + '/_lab/board/upd');
      await p.waitForFunction(`${V}?.querySelector('iframe[name="lab:a"][data-ready]')`, null, { timeout: 10000 });
      await sleep(1500);
      await p.evaluate(`(() => {
        const out = (window.__seen = []);
        const t0 = performance.now();
        const step = () => {
          const box = ${V}.querySelector('#lab-board .f[data-id="a"]');
          const shown = [...box.querySelectorAll('iframe[data-ready]')].filter((f) => f.style.visibility !== 'hidden' && f.contentDocument?.querySelector('h1'));
          out.push({ h: box.getBoundingClientRect().height, b: ${V}.querySelector('#lab-board .f[data-id="b"]').getBoundingClientRect().top, page: shown.length > 0, cam: __labBoard.camera() });
          if (performance.now() - t0 < 4000) requestAnimationFrame(step);
        };
        step();
      })()`);
      await sleep(300);
      fs.writeFileSync(path.join(DIR, 'live.html'), live(2200));
      await sleep(4200);
      const seen = await p.evaluate(() => window.__seen);
      const hs = seen.map((x) => Math.round(x.h));
      const [h0, h1] = [hs[0], hs.at(-1)];
      check(eng, 'a page saved: its frame never shows without its page', seen.every((x) => x.page), JSON.stringify(seen.filter((x) => !x.page).length));
      check(eng, 'its height never falls back to the device\'s while it loads', Math.min(...hs) >= h0 - 1, JSON.stringify({ h0, min: Math.min(...hs) }));
      check(eng, 'the new height eases there (steps between), and grew', h1 > h0 + 100 && hs.filter((h) => h > h0 + 2 && h < h1 - 2).length >= 3, JSON.stringify({ h0, h1, between: hs.filter((h) => h > h0 + 2 && h < h1 - 2).length }));
      check(eng, 'the camera stays where it was', seen.every((x) => x.cam.x === seen[0].cam.x && x.cam.y === seen[0].cam.y && x.cam.z === seen[0].cam.z), JSON.stringify([seen[0].cam, seen.at(-1).cam]));
      const bs = seen.map((x) => Math.round(x.b));
      check(eng, 'the frame under it eases down with it', bs.at(-1) > bs[0] && bs.filter((v) => v > bs[0] + 2 && v < bs.at(-1) - 2).length >= 3, JSON.stringify({ from: bs[0], to: bs.at(-1) }));
      fs.writeFileSync(path.join(DIR, 'live.html'), live(1200));
      // A page that grows by itself by the same amount twice running: the frame follows every step (a step the same as the
      // last is the 100vh loop only when the page grows with its frame; CodeRabbit on #611).
      await p.goto(B + '/_lab/board/steps');
      await p.waitForFunction(`${V}?.querySelector('iframe[name="lab:a"][data-ready]')`, null, { timeout: 10000 });
      await sleep(3500);
      const st = await p.evaluate(`(() => { const box = ${V}.querySelector('#lab-board .f[data-id="a"]'); const d = box.querySelector('iframe').contentDocument; return { boxH: parseFloat(box.style.height), pageH: Math.max(d.documentElement.scrollHeight, d.body.scrollHeight), more: d.getElementById('more').children.length, end: d.getElementById('end').getBoundingClientRect().bottom }; })()`);
      const lateH = () => p.evaluate(`parseFloat(${V}.querySelector('#lab-board .f[data-id="b"]').style.height)`);
      const l1 = await lateH();
      await sleep(1500);
      const l2 = await lateH();
      check(eng, 'a 100vh section put in later grows the frame once, not without end', l1 > 800 && l1 < 3000 && l2 === l1, JSON.stringify({ l1, l2 }));
      check(eng, 'a page that grows by the same amount twice running: the frame follows each step', st.more === 2 && st.boxH === st.pageH && st.end <= st.boxH, JSON.stringify(st));
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
finish();
