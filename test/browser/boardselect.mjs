// A board's pointer: a plain drag on the canvas draws a box that picks the frames it touches, Shift-click adds or takes one,
// a click on a frame picks it alone and on the canvas lets go; dragging a picked frame moves all the picked ones (saved, ⌘Z puts
// them back), Delete takes them all off (one ⌘Z brings them all back); Space + drag, the middle button and the wheel pan; a finger
// still pans (Leo, 21 Nov: "Plain drag selects, Space pans", "also moving stuff on board", "deleting them with delete").
// Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/boardselect.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, freshLab, sleep, check, finish } from './harness.mjs';

const pw = playwright();

const PORT = claimPort(8230, 30);
const B = `http://localhost:${PORT}`;
// Each engine on a lab of its own: the one before moved the frames of its boards.
const L = freshLab('labit-boardsel-', (dir) => {
  fs.writeFileSync(path.join(dir, 'pricing.html'), '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pricing</title><h1>Pricing</h1>');
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><title>k</title><h1>Keys</h1>');
  fs.writeFileSync(path.join(dir, 'labit.json'), JSON.stringify({ port: PORT }));
}, { base: B });
// A new board (rev 0): one the lab already has would answer 409 and keep its frames, so a refused put stops the test.
const put = (name, frames, extra = {}) =>
  fetch(`${B}/_lab/api/board?name=${name}`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ v: 1, rev: 0, frames, ...extra }) }).then(async (r) => {
    if (r.status !== 200) throw new Error(`board ${name} not set: ${r.status} ${await r.text()}`);
    return r.json();
  });
const file = (n) => JSON.parse(fs.readFileSync(path.join(L.dir, `.lab/boards/${n}.json`), 'utf8'));
const places = (n) => JSON.stringify(file(n).frames.map((f) => [f.id, f.state, f.x, f.y]));
const three = () => [
  { id: 'a', src: '/pricing', w: 400, h: 500, x: 0, y: 0 },
  { id: 'b', src: '/pricing', w: 400, h: 500, x: 500, y: 0 },
  { id: 'c', src: '/pricing', w: 400, h: 500, x: 1000, y: 0 },
];
try {
  for (const eng of engines()) {
    await L.up();
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      await ctx.addInitScript(() => localStorage.setItem('lab-name', 'tester'));
      const p = await ctx.newPage();
      p.on('pageerror', (e) => console.log('pageerror', e.message));
      const root = '[data-lab-board-view]';
      const rect = (id) => p.evaluate(([r, i]) => { const e = document.querySelector(r)?.shadowRoot?.querySelector(`#lab-board .f[data-id="${i}"]`); const q = e?.getBoundingClientRect(); return q && { x: q.x, y: q.y, w: q.width, h: q.height }; }, [root, id]);
      const picked = () => p.evaluate((r) => [...document.querySelector(r).shadowRoot.querySelectorAll('#lab-board .f.pick')].map((f) => f.dataset.id).sort().join(''), root);
      const shownCount = () => p.evaluate((r) => document.querySelector(r).shadowRoot.querySelectorAll('#lab-board .f').length, root);
      const cam = () => p.evaluate(() => __labBoard.camera());
      const marq = () => p.evaluate((r) => { const m = document.querySelector(r).shadowRoot.querySelector('#lab-board .marq'); return m && !m.hidden ? m.getBoundingClientRect().width : 0; }, root);
      const cursorAt = (x, y) => p.evaluate(([r, x, y]) => { let e = document.elementFromPoint(x, y); for (let i = 0; i < 3 && e?.shadowRoot && e.matches(r); i++) e = e.shadowRoot.elementFromPoint(x, y) || e; return getComputedStyle(e).cursor; }, [root, x, y]);
      const ready = async () => {
        await p.waitForFunction((r) => document.querySelector(r)?.shadowRoot?.querySelector('#lab-board .f[data-id="c"]'), root, { timeout: 8000 });
        await sleep(1200);
      };
      // A drag with the buttons given; the box's width half way is what it returns.
      const drag = async (x0, y0, x1, y1, keys = []) => {
        for (const k of keys) await p.keyboard.down(k);
        await p.mouse.move(x0, y0);
        await p.mouse.down();
        await p.mouse.move(x1, y1, { steps: 8 });
        const mid = await marq();
        await p.mouse.up();
        for (const k of keys) await p.keyboard.up(k);
        await sleep(250);
        return mid;
      };
      await put('sel', three(), { of: '/pricing' });
      await p.goto(`${B}/_lab/board/sel`);
      await ready();
      const start = places('sel');
      const [A, Bb, C] = [await rect('a'), await rect('b'), await rect('c')];
      const z = (await cam()).z;
      const empty = { x: A.x - 4, y: A.y - 14 }; // the canvas above and left of the first frame
      const free = await p.evaluate(([r, x, y]) => { const e = document.querySelector(r).shadowRoot.elementFromPoint(x, y); return e?.id || e?.className; }, [root, empty.x, empty.y]);
      check(eng, 'the canvas is there to start a box on', free === 'lab-board' || free === 'dots', JSON.stringify([free, empty, A]));
      check(eng, 'on the canvas the pointer is the plain arrow', (await cursorAt(empty.x, empty.y)) === 'default', await cursorAt(empty.x, empty.y));

      // ----- a box over two of three
      const c0 = await cam();
      const mid = await drag(empty.x, empty.y, Bb.x + Bb.w - 20, Bb.y + Bb.h / 2);
      const c1 = await cam();
      check(eng, 'a plain drag on the canvas draws a box and does not pan', mid > 100 && c1.x === c0.x && c1.y === c0.y, JSON.stringify([mid, c0, c1]));
      check(eng, 'the box picks the two frames it touches, not the third', (await picked()) === 'ab', await picked());
      check(eng, 'the box is gone when the pointer lifts', (await marq()) === 0);
      check(eng, 'the zoom is as it was', Math.abs(c1.z - z) < 1e-9);
      check(eng, 'over a picked frame the pointer is the move cursor', (await cursorAt(A.x + A.w / 2, A.y + A.h / 2)) === 'move', await cursorAt(A.x + A.w / 2, A.y + A.h / 2));
      check(eng, 'over a frame that is not picked it is the plain arrow', (await cursorAt(C.x + C.w / 2, C.y + C.h / 2)) === 'default');

      // ----- Shift-click adds and takes off
      await p.keyboard.down('Shift');
      await p.mouse.click(C.x + C.w / 2, C.y + C.h / 2);
      await sleep(200);
      const added = await picked();
      await p.mouse.click(A.x + A.w / 2, A.y + A.h / 2);
      await p.keyboard.up('Shift');
      await sleep(500); // (not a double click on the next one)
      check(eng, 'Shift-click adds a frame to the pick, then takes one off', added === 'abc' && (await picked()) === 'bc', JSON.stringify([added, await picked()]));
      // ----- a plain click on a frame picks only it; on the canvas lets go
      await p.mouse.click(A.x + A.w / 2, A.y + A.h / 2);
      await sleep(200);
      check(eng, 'a plain click on a frame picks only that frame', (await picked()) === 'a', await picked());
      await p.mouse.click(empty.x, empty.y);
      await sleep(200);
      check(eng, 'a click on the canvas lets go of the pick', (await picked()) === '');
      await drag(empty.x, empty.y, Bb.x + Bb.w - 20, Bb.y + Bb.h / 2);
      await p.keyboard.press('Escape');
      await sleep(200);
      check(eng, 'Esc lets go of the pick', (await picked()) === '');

      // ----- a press that moves less than 4 px is a pick, not a move
      await p.mouse.move(A.x + 100, A.y + 100);
      await p.mouse.down();
      await p.mouse.move(A.x + 102, A.y + 101);
      await p.mouse.up();
      await sleep(600);
      check(eng, 'a press that moves 2 px picks the frame and moves nothing', (await picked()) === 'a' && places('sel') === start, JSON.stringify([await picked(), places('sel')]));

      // ----- drag the two picked frames
      await drag(empty.x, empty.y, Bb.x + Bb.w - 20, Bb.y + Bb.h / 2);
      const [dx, dy] = [30, 70];
      const camBefore = await cam();
      await drag(A.x + 100, A.y + 200, A.x + 100 + dx, A.y + 200 + dy);
      await sleep(900);
      const f1 = file('sel').frames;
      const near = (f, ox) => Math.abs(f.x - ox - dx / z) <= 1 && Math.abs(f.y - dy / z) <= 1;
      check(eng, 'dragging a picked frame moves both picked frames by the drag, at this zoom', near(f1[0], 0) && near(f1[1], 500) && f1[2].x === 1000 && f1[2].y === 0, JSON.stringify(f1.map((f) => [f.id, f.x, f.y])));
      const camAfter = await cam();
      check(eng, 'moving frames leaves the camera where it is (no refit)', Math.abs(camAfter.x - camBefore.x) < 1 && Math.abs(camAfter.y - camBefore.y) < 1 && Math.abs(camAfter.z - camBefore.z) < 1e-3, JSON.stringify([camBefore, camAfter]));
      check(eng, 'both stay picked', (await picked()) === 'ab', await picked());
      await p.keyboard.press('Control+KeyZ');
      await sleep(900);
      check(eng, '⌘Z puts the two back where they were, one step', places('sel') === start, places('sel'));
      // the same again, now left to be read back after a reload
      await drag(Bb.x + 100, Bb.y + 200, Bb.x + 100 + dx, Bb.y + 200 + dy);
      await sleep(900);
      const moved = places('sel');
      check(eng, 'moved again, the same places as the first time', moved === JSON.stringify(f1.map((f) => [f.id, f.state, f.x, f.y])), moved);
      await p.reload();
      await ready();
      const shown = await p.evaluate((r) => [...document.querySelector(r).shadowRoot.querySelectorAll('#lab-board .f')].map((f) => [f.dataset.id, parseInt(f.style.left), parseInt(f.style.top)]), root);
      check(eng, 'after a reload the frames are where they were put', shown.length === 3 && shown.every(([id, x, y]) => { const f = file('sel').frames.find((g) => g.id === id); return f.x === x && f.y === y; }) && places('sel') === moved, JSON.stringify(shown));
      // a frame that was not picked: dragging it makes it the pick first, and it goes alone
      const C2 = await rect('c');
      await drag(C2.x + 100, C2.y + 200, C2.x + 100, C2.y + 200 + 50);
      await sleep(800);
      const f2 = file('sel').frames;
      check(eng, 'dragging a frame that was not picked moves it alone', f2[2].y !== 0 && f2[0].x === f1[0].x && f2[0].y === f1[0].y && (await picked()) === 'c', JSON.stringify([f2.map((f) => [f.id, f.x, f.y]), await picked()]));
      await p.keyboard.press('Control+KeyZ');
      await sleep(900);
      check(eng, '⌘Z puts that one back', places('sel') === moved, places('sel'));

      // ----- Esc in the middle of a drag cancels it: the frame goes back and nothing is written
      const Ae = await rect('a');
      await p.mouse.move(Ae.x + 100, Ae.y + 200);
      await p.mouse.down();
      await p.mouse.move(Ae.x + 220, Ae.y + 260, { steps: 8 });
      const midway = (await rect('a')).x - Ae.x;
      await p.keyboard.press('Escape');
      await p.mouse.move(Ae.x + 240, Ae.y + 280, { steps: 2 });
      await p.mouse.up();
      await sleep(900);
      check(eng, 'Esc mid-drag puts the frame back and saves no move', midway > 50 && places('sel') === moved && Math.abs((await rect('a')).x - Ae.x) < 1, JSON.stringify([midway, places('sel')]));

      // ----- Delete takes all picked off, one ⌘Z brings them back
      await p.reload();
      await ready();
      const [A3, B3] = [await rect('a'), await rect('b')];
      await drag(A3.x - 4, A3.y - 14, B3.x + B3.w - 20, B3.y + B3.h / 2);
      check(eng, 'two picked again', (await picked()) === 'ab', await picked());
      await p.mouse.move(A3.x + 50, A3.y + 50);
      await p.keyboard.press('Delete');
      await sleep(900);
      const gone = file('sel').frames.map((f) => [f.id, f.state]);
      check(eng, 'Delete archives all the picked frames', JSON.stringify(gone) === JSON.stringify([['a', 'archived'], ['b', 'archived'], ['c', 'live']]), JSON.stringify(gone));
      check(eng, 'the board shows only the third, and nothing is picked', (await shownCount()) === 1 && (await picked()) === '');
      // The first ⌘Z's write is refused (another writer got in first, 409): it stays on the list, and the next ⌘Z does it.
      let refused = 0;
      const once = (route) => (route.request().method() === 'PUT' && !refused++ ? route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"rev"}' }) : route.fallback());
      await p.route('**/_lab/api/board?*', once);
      await p.keyboard.press('Control+KeyZ');
      await sleep(900);
      await p.unroute('**/_lab/api/board?*', once);
      check(eng, 'a ⌘Z whose write is refused changes nothing', refused === 1 && (await shownCount()) === 1 && file('sel').frames.filter((f) => f.state === 'archived').length === 2, JSON.stringify([refused, places('sel')]));
      await p.keyboard.press('Control+KeyZ');
      await sleep(900);
      check(eng, 'one ⌘Z brings both back, in their places (the refused one tried again)', places('sel') === moved, places('sel'));
      check(eng, 'and they are picked again', (await picked()) === 'ab', await picked());

      // ----- the hand: Space + drag, the middle button and the wheel pan, and pick nothing
      await p.keyboard.press('Escape');
      await p.keyboard.press('Shift+Digit2'); // 100 %: the board is bigger than the view, so there is room to pan
      await sleep(400);
      const h0 = await cam();
      await drag(empty.x + 100, 600, empty.x + 40, 560, ['Space']);
      const h1 = await cam();
      check(eng, 'Space + drag pans the board and picks nothing', Math.abs(h1.x - h0.x) > 20 && h1.z === h0.z && (await picked()) === '' && (await marq()) === 0 && places('sel') === moved, JSON.stringify([h0, h1, await picked()]));
      await p.mouse.move(300, 600);
      await p.mouse.down({ button: 'middle' });
      await p.mouse.move(360, 640, { steps: 6 });
      const grabbing = await p.evaluate((r) => document.querySelector(r).shadowRoot.querySelector('#lab-board').classList.contains('grabbing'), root);
      await p.mouse.up({ button: 'middle' });
      await sleep(250);
      const h2 = await cam();
      check(eng, 'the middle button drags the board too, with the hand, and picks nothing', Math.abs(h2.x - h1.x) > 20 && (await picked()) === '' && grabbing && places('sel') === moved, JSON.stringify([h1, h2, grabbing]));
      // A side button (back, forward) drags it too, and its lift steps no page back (Leo, 26 Nov: "mouse side buttons to pan
      // board"). Playwright's mouse has no side buttons: Chromium's own input does.
      const xb = eng === 'chromium' ? await ctx.newCDPSession(p) : null;
      if (xb) {
        const url = p.url();
        await p.evaluate(() => { history.pushState(null, '', location.href); addEventListener('popstate', () => (window.__steps = (window.__steps || 0) + 1)); }); // a step back to take
        for (const button of ['back', 'forward']) {
          const b0 = await cam();
          const at = (type, x, y, buttons) => xb.send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: 1 });
          const bits = button === 'back' ? 8 : 16;
          await at('mousePressed', 300, 600, bits);
          for (let i = 1; i <= 6; i++) await at('mouseMoved', 300 + i * 10, 600 + i * 6, bits);
          const hand = await p.evaluate((r) => document.querySelector(r).shadowRoot.querySelector('#lab-board').classList.contains('grabbing'), root);
          check(eng, `the ${button} button shows the hand while it drags, as the middle one does`, hand);
          await at('mouseReleased', 360, 636, 0);
          await sleep(400);
          const b1 = await cam();
          check(eng, `the ${button} button drags the board, picks nothing and steps no page ${button}`, Math.abs(b1.x - b0.x) > 20 && (await picked()) === '' && p.url() === url && !(await p.evaluate(() => window.__steps)) && places('sel') === moved, JSON.stringify([b0, b1, p.url()]));
        }
        // In a frame opened to use it (a double-click), the middle and side buttons pan the board as well, and step nowhere.
        const F = await rect('c');
        await p.mouse.dblclick((F.x + 80), F.y + 200);
        await p.waitForFunction((r) => document.querySelector(r).shadowRoot.querySelector('#lab-board .f.in'), root, { timeout: 4000 });
        await sleep(300);
        for (const [button, bits] of [['middle', 4], ['back', 8], ['forward', 16]]) {
          const b0 = await cam();
          const at = (type, x, y, buttons) => xb.send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: 1 });
          await at('mousePressed', (F.x + 80), F.y + 200, bits);
          for (let i = 1; i <= 6; i++) await at('mouseMoved', (F.x + 80) - i * 10, F.y + 200 - i * 6, bits);
          const hand = await p.frames().find((f) => f.name().startsWith('lab:c'))?.evaluate(() => getComputedStyle(document.documentElement).cursor);
          check(eng, `in an opened frame the ${button} button shows the hand while it drags`, hand === 'grabbing', hand);
          await at('mouseReleased', (F.x + 80) - 60, F.y + 164, 0);
          await sleep(400);
          const b1 = await cam();
          check(eng, `in an opened frame the ${button} button pans the board and steps no page`, Math.hypot(b1.x - b0.x, b1.y - b0.y) > 20 && p.url() === url && !(await p.evaluate(() => window.__steps)), JSON.stringify([b0, b1, p.url()]));
        }
        await p.keyboard.press('Escape');
        await sleep(300);
      }
      await p.mouse.move(600, 600);
      const w0 = await cam(); // read again here: the side buttons above may have panned it
      await p.mouse.wheel(0, 100);
      await sleep(250);
      const w1 = await cam();
      check(eng, 'the wheel pans', w1.y !== w0.y, JSON.stringify([w0, w1]));

      // ----- a finger still pans
      const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
      const q = await ph.newPage();
      await q.goto(`${B}/_lab/board/sel`);
      await sleep(2500);
      const cdp = await ph.newCDPSession(q).catch(() => null);
      if (cdp) {
        const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
        await q.evaluate(() => __labBoard.key({ key: '@', code: 'Digit2', shiftKey: true })); // 100 %: room to pan
        await sleep(400);
        const t0 = await q.evaluate(() => __labBoard.camera());
        await touch('touchStart', 300, 700);
        for (let i = 1; i <= 8; i++) await touch('touchMove', 300 - i * 25, 700);
        await touch('touchEnd');
        await sleep(600);
        const t1 = await q.evaluate(() => { const s = document.querySelector('[data-lab-board-view]').shadowRoot; return { cam: __labBoard.camera(), picks: s.querySelectorAll('#lab-board .f.pick').length, marq: [...s.querySelectorAll('#lab-board .marq')].filter((m) => !m.hidden).length }; });
        check(eng, 'phone: a finger drag pans the board, draws no box, picks and moves nothing', Math.abs(t1.cam.x - t0.x) > 20 && t1.picks === 0 && t1.marq === 0 && places('sel') === moved, JSON.stringify([t0, t1]));
      } else console.log('skip      phone swipe (no CDP in this engine)');
      // ----- a board whose frames the lab laid out (no x, y): moving one keeps the others where they are drawn
      await put('rows', [0, 1, 2].map((i) => ({ id: 'abc'[i], src: '/pricing', w: 400, h: 500 })), { of: '/pricing' });
      const drawn = (await (await fetch(`${B}/_lab/api/board?name=rows`)).json()).frames.map((f) => [f.id, f.x, f.y]);
      await p.goto(`${B}/_lab/board/rows`);
      await ready();
      const R = await rect('b');
      await drag(R.x + 60, R.y + 100, R.x + 60 + 20, R.y + 100 + 30);
      await sleep(900);
      const rows = (await (await fetch(`${B}/_lab/api/board?name=rows`)).json()).frames.map((f) => [f.id, f.x, f.y]);
      check(eng, 'frames laid out by the lab: the one moved goes, the others stay where they were drawn', rows[0].join() === drawn[0].join() && rows[2].join() === drawn[2].join() && rows[1][1] !== drawn[1][1], JSON.stringify([drawn, rows]));
      await ph.close();
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  await L.stop();
  fs.rmSync(L.dir, { recursive: true, force: true, maxRetries: 5 });
}
finish();
