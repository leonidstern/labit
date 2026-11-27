// An area (drag) or a drawing (hold D and drag) on a board's frame keeps its shape: stored in the frame's own px (its corner, its
// size as shares of the frame), drawn again over the frame after a reload, and told to the agent as where on the frame, not as an
// element of the board's own boxes. Not part of `npm test`; CI runs it in the `browser` job.
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish, withAlt } from './harness.mjs';

const pw = playwright();
const DIR = tmp('labit-boardzones-');
const PORT = claimPort(8500, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'pricing.html'), '<!doctype html><meta charset="utf-8"><title>Pricing</title><h1>Pricing one</h1><p>some words</p>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);
await fetch(`${B}/_lab/api/board?name=zones`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ v: 1, rev: 0, frames: [{ id: 'a', src: '/pricing', w: 1440, h: 900 }, { id: 'b', src: '/pricing', w: 820, h: 600 }] }) });
const comments = async () => (await (await fetch(`${B}/_lab/api/comments?page=/_board/zones`)).json()).comments || [];
const widget = 'document.querySelector("*") && [...document.querySelectorAll("*")].find((n) => n.shadowRoot?.querySelector(".scrim"))?.shadowRoot';
try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'tester'); localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => console.log('pageerror', e.message));
      const open = async () => {
        await p.goto(`${B}/_lab/board/zones`);
        await p.waitForFunction(() => window.__labBoard?.box?.('a') && [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.scrim')), null, { timeout: 8000 });
        await sleep(1500);
      };
      const rect = (id) => p.evaluate((i) => { const r = window.__labBoard.box(i).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, id);
      const until = async (fn, tries = 40) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(150); } return false; };
      const text = async () => (await fetch(`${B}/_lab/agent/_board/zones`)).text();
      await open();
      const fa = await rect('a');
      // an area: from a quarter to three quarters of frame a
      await withAlt(p, async () => {
        await p.mouse.move(fa.x + fa.w * 0.25, fa.y + fa.h * 0.25);
        await p.mouse.down();
        await p.mouse.move(fa.x + fa.w * 0.5, fa.y + fa.h * 0.5, { steps: 6 });
        await p.mouse.move(fa.x + fa.w * 0.75, fa.y + fa.h * 0.75, { steps: 6 });
        await p.mouse.up();
      });
      await until(async () => (await p.locator('textarea').count()) > 0);
      await p.keyboard.type('this area');
      await p.keyboard.press('Enter');
      const area = await until(async () => (await comments()).find((c) => c.text === 'this area'));
      const a = area?.anchor || {};
      check(eng, 'an area on a frame is stored in the frame: its corner in the frame\'s px, its size as shares of it', a.kind === 'board' && a.frame === 'a' && Math.abs(a.zw - 0.5) < 0.03 && Math.abs(a.zh - 0.5) < 0.03 && Math.abs(a.fx - 360) < 12 && Math.abs(a.fy - 225) < 12 && a.fw === 1440 && a.fh === 900, JSON.stringify(a));
      const t = await text();
      check(eng, 'the agent reads where on the frame, in its px, and no element of the board', /area on frame a: 3[4-7]\d–10[5-9]\d px across, 2[0-4]\d–6[5-9]\d px down, of the frame's 1440×900/.test(t) && !/area on element/.test(t), t.split('\n').filter((l) => /area|type:/.test(l)).join(' | '));
      // a reload: the outline is over the frame again (the pin's card open)
      await open();
      await p.evaluate((r) => { const pin = new Function(`return ${r}`)().querySelector('button.pin'); pin?.click(); }, widget);
      await sleep(900);
      const z = await p.evaluate((r) => { const e = new Function(`return ${r}`)().querySelector('.zone'); const b = e?.getBoundingClientRect(); return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null; }, widget);
      const fa2 = await rect('a');
      check(eng, 'after a reload the area is drawn over the frame at a quarter to three quarters of it', Boolean(z) && Math.abs(z.x - (fa2.x + fa2.w * 0.25)) < 8 && Math.abs(z.w - fa2.w * 0.5) < 10 && Math.abs(z.y - (fa2.y + fa2.h * 0.25)) < 8 && Math.abs(z.h - fa2.h * 0.5) < 10, JSON.stringify([z, fa2]));
      // a zoom with its card open: the outline goes with the frame, not left at its size on the screen (Leo, 26 Nov: "zoom with
      // selection pin works weird")
      await p.mouse.move(600, 400);
      await p.keyboard.down('Meta');
      for (let i = 0; i < 5; i++) await p.mouse.wheel(0, -60);
      await p.keyboard.up('Meta');
      await sleep(500);
      const zz = await p.evaluate((r) => { const e = new Function(`return ${r}`)().querySelector('.zone'); const b = e?.getBoundingClientRect(); return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null; }, widget);
      const fz = await rect('a');
      check(eng, 'zoomed with its card open, the area is still a quarter to three quarters of the frame', Boolean(zz) && fz.w > fa2.w * 1.2 && Math.abs(zz.x - (fz.x + fz.w * 0.25)) < 8 && Math.abs(zz.w - fz.w * 0.5) < 10 && Math.abs(zz.y - (fz.y + fz.h * 0.25)) < 8 && Math.abs(zz.h - fz.h * 0.5) < 10, JSON.stringify([zz, fz]));
      await p.keyboard.press('Escape');
      await p.keyboard.press('Shift+Digit1'); // fitted again, as the rest expects
      await sleep(500);
      // a drawing on frame b: a ring
      await sleep(300);
      const fb = await rect('b');
      const ring = Array.from({ length: 22 }, (_, i) => [fb.x + fb.w * 0.5 + fb.w * 0.25 * Math.cos((i / 20) * 2 * Math.PI), fb.y + fb.h * 0.5 + fb.h * 0.25 * Math.sin((i / 20) * 2 * Math.PI)]);
      await p.keyboard.down('d');
      await p.mouse.move(...ring[0]);
      await p.mouse.down();
      for (const q of ring.slice(1, 12)) await p.mouse.move(...q, { steps: 4 });
      // the lines show as they are drawn, over the board (Leo, 21 Nov: "its not visible until i finish drawing")
      const live = await p.evaluate(([x, y]) => {
        const r = document.querySelector('[data-lab-comments]').shadowRoot;
        const svg = r.querySelector('svg.ink.live, .ink.live');
        const paths = svg ? svg.querySelectorAll('path').length : 0;
        let top = document.elementFromPoint(x, y);
        for (let i = 0; i < 3 && top?.shadowRoot; i++) top = top.shadowRoot.elementFromPoint(x, y) || top;
        const box = svg?.getBoundingClientRect();
        return { paths, box: box && [box.x, box.y, box.width, box.height], vis: svg && getComputedStyle(svg).visibility, op: svg && getComputedStyle(svg).opacity, host: getComputedStyle(document.querySelector('[data-lab-comments]')).zIndex };
      }, ring[6]);
      check(eng, 'a drawing on a board shows its lines while it is drawn', live.paths > 0 && live.vis !== 'hidden' && live.op !== '0', JSON.stringify(live));
      for (const q of ring.slice(12)) await p.mouse.move(...q, { steps: 4 });
      await p.mouse.up();
      await p.keyboard.up('d');
      // sent by itself, with what it reads as (no box: Leo, 21 Nov)
      const draw = await until(async () => (await comments()).find((c) => c.anchor?.ink));
      const d = draw?.anchor || {};
      check(eng, 'a drawing on a frame keeps its lines and sits on that frame', d.frame === 'b' && Boolean(d.ink?.pts?.length) && d.zw > 0.2 && d.zw < 0.7 && d.fw === 820, JSON.stringify({ frame: d.frame, zw: d.zw, fw: d.fw, ink: Boolean(d.ink) }));
      const t2 = await text();
      check(eng, 'the agent reads its lines in the frame\'s px', /type: drawing, \d+×\d+ px on frame b/.test(t2) && /lines \(px from the area's top left\): M/.test(t2) && /area on frame b:/.test(t2), t2.split('\n').filter((l) => /drawing|lines|area on/.test(l)).join(' | ').slice(0, 300));
      // zoomed, the drawing is as big in the frame as it was (Leo, 21 Nov: "zooming board and drawings doesnt work")
      const share = () => p.evaluate((r) => { const svg = new Function(`return ${r}`)().querySelector('.pin.ink svg'); return svg && window.__labBoard.box('b') ? svg.getBoundingClientRect().width / window.__labBoard.box('b').getBoundingClientRect().width : 0; }, widget);
      // …and where it sits on the frame stays where it was drawn (it landed beside it, by its own size, after a zoom: 21 Nov)
      const place = () => p.evaluate((r) => { const svg = new Function(`return ${r}`)().querySelector('.pin.ink svg'); const f = window.__labBoard.box('b')?.getBoundingClientRect(); const q = svg?.getBoundingClientRect(); return q && f ? [Math.round(((q.x - f.x) / f.width) * 100) / 100, Math.round(((q.y - f.y) / f.height) * 100) / 100] : null; }, widget);
      const where0 = await place();
      const before = await share();
      const zb = await rect('b');
      await p.mouse.move(zb.x + zb.w / 2, zb.y + zb.h / 2);
      await p.keyboard.down('Control');
      for (let i = 0; i < 4; i++) { await p.mouse.wheel(0, -120); await sleep(80); }
      await p.keyboard.up('Control');
      await sleep(500);
      const after = await share();
      const zb2 = await rect('b');
      check(eng, 'zoomed in, the drawing grows with its frame', zb2.w > zb.w * 1.3 && before > 0 && Math.abs(after - before) / before < 0.05, JSON.stringify({ before, after, w: [zb.w, zb2.w] }));
      const where1 = await place();
      check(eng, 'zoomed in, the drawing stays over what was circled', Boolean(where0 && where1) && Math.abs(where0[0] - where1[0]) < 0.03 && Math.abs(where0[1] - where1[1]) < 0.03, JSON.stringify({ where0, where1 }));
      await open();
      const inks = await until(async () => p.evaluate((r) => new Function(`return ${r}`)().querySelectorAll('.pin.ink svg path, svg.ink path').length, widget));
      check(eng, 'after a reload the drawing is drawn again', Boolean(inks));
      // D with the keyboard focus inside a live frame's page still draws (it drew nothing there: Mac test, 21 Nov)
      await p.evaluate(() => { const fr = window.__labBoard.frame('b'); fr?.contentWindow?.focus(); fr?.contentDocument?.body?.focus?.(); });
      await sleep(200);
      const inkCount = async () => (await comments()).filter((c) => c.anchor?.ink).length;
      const had = await inkCount();
      const fb2 = await rect('b');
      await p.keyboard.down('d');
      await p.mouse.move(fb2.x + fb2.w * 0.2, fb2.y + fb2.h * 0.2);
      await p.mouse.down();
      for (let i = 1; i <= 12; i++) await p.mouse.move(fb2.x + fb2.w * (0.2 + i * 0.03), fb2.y + fb2.h * (0.2 + (i % 3) * 0.05), { steps: 3 });
      await p.mouse.up();
      await p.keyboard.up('d');
      const drew = await until(async () => ((await inkCount()) > had ? true : null));
      check(eng, 'D with the focus inside a live frame draws', Boolean(drew), JSON.stringify({ had, now: await inkCount() }));
      // #423: holding D, a press that hardly moves is no click. It opened an empty box, the next D typed a "d" into it, and
      // every stroke after that drew nothing.
      await open();
      const had2 = await inkCount();
      let fa3 = await rect('a');
      await p.keyboard.down('d');
      await p.mouse.move(fa3.x + 60, fa3.y + 60);
      await p.mouse.down();
      await p.mouse.move(fa3.x + 63, fa3.y + 62);
      await p.mouse.up();
      await p.keyboard.up('d');
      await sleep(600);
      await p.keyboard.down('d');
      await p.mouse.move(fa3.x + fa3.w * 0.2, fa3.y + fa3.h * 0.6);
      await p.mouse.down();
      for (let i = 1; i <= 12; i++) await p.mouse.move(fa3.x + fa3.w * (0.2 + i * 0.03), fa3.y + fa3.h * (0.6 + (i % 3) * 0.04), { steps: 3 });
      await p.mouse.up();
      await p.keyboard.up('d');
      const drew2 = await until(async () => ((await inkCount()) > had2 ? true : null));
      const typed = await p.evaluate((r) => [...new Function(`return ${r}`)().querySelectorAll('textarea')].map((t) => t.value).join(''), widget);
      check(eng, 'holding D, a tiny press opens no box and the drawing after it is saved', Boolean(drew2) && !typed.includes('d'), JSON.stringify({ had2, typed }));
      // #423: holding D, the wheel doesn't move the board (strokes before and after a pan came apart).
      await open();
      const still0 = await rect('b');
      await p.keyboard.down('d');
      await p.mouse.move(still0.x + still0.w / 2, still0.y + still0.h / 2);
      for (let i = 0; i < 3; i++) { await p.mouse.wheel(0, 120); await sleep(60); }
      await p.keyboard.up('d');
      await sleep(300);
      const still1 = await rect('b');
      check(eng, 'holding D, the wheel leaves the board where it is', Math.abs(still1.x - still0.x) < 1 && Math.abs(still1.y - still0.y) < 1, JSON.stringify([still0, still1]));
      // #423: a drawing from one frame to the other is on the board itself: it keeps its lines (it was a point pin, the lines
      // lost), goes with the zoom, comes back after a reload, and the agent reads it in the board's px.
      await sleep(1200);
      const had3 = (await comments()).length;
      fa3 = await rect('a');
      const fb3 = await rect('b');
      const [ax, bx, ay] = [fa3.x + fa3.w * 0.5, fb3.x + fb3.w * 0.5, Math.min(fa3.y + fa3.h, fb3.y + fb3.h) - 30];
      await p.keyboard.down('d');
      await p.mouse.move(ax, ay);
      await p.mouse.down();
      for (let i = 1; i <= 16; i++) await p.mouse.move(ax + ((bx - ax) * i) / 16, ay - 40 * Math.sin((i / 16) * Math.PI), { steps: 3 });
      await p.mouse.up();
      await p.keyboard.up('d');
      const across = await until(async () => { const c = await comments(); return c.length > had3 ? c.at(-1) : null; });
      const ca = across?.anchor || {};
      check(eng, 'a drawing across two frames keeps its lines, on the board itself', Boolean(ca.ink?.pts?.[0]?.length) && !ca.frame && ca.zw === 1 && ca.docW > 0, JSON.stringify({ frame: ca.frame, zw: ca.zw, docW: ca.docW, ink: Boolean(ca.ink) }));
      const t3 = await text();
      check(eng, 'the agent reads a drawing across frames in the board\'s px', /area on the board: -?\d+–-?\d+ px across/.test(t3), t3.split('\n').filter((l) => /area|type:/.test(l)).join(' | '));
      const onA = () => p.evaluate((r) => { const svgs = [...new Function(`return ${r}`)().querySelectorAll('.pin.ink svg')]; const f = window.__labBoard.box('a').getBoundingClientRect(); const q = svgs.map((s) => s.getBoundingClientRect()).sort((x, y) => y.width - x.width)[0]; return q ? [Math.round(((q.x - f.x) / f.width) * 100) / 100, Math.round((q.width / f.width) * 100) / 100] : null; }, widget);
      await sleep(500);
      const z0 = await onA();
      await p.mouse.move(fb3.x, fb3.y);
      await p.keyboard.down('Control');
      for (let i = 0; i < 3; i++) { await p.mouse.wheel(0, -120); await sleep(80); }
      await p.keyboard.up('Control');
      await sleep(500);
      const z1 = await onA();
      check(eng, 'zoomed in, a drawing across frames stays where it was on them', Boolean(z0 && z1) && Math.abs(z0[0] - z1[0]) < 0.03 && Math.abs(z0[1] - z1[1]) < 0.03 && z0[1] > 0.5, JSON.stringify({ z0, z1 }));
      await open();
      const z2 = await until(onA);
      check(eng, 'after a reload a drawing across frames is drawn again', Boolean(z2) && Math.abs(z2[1] - z0[1]) < 0.03, JSON.stringify({ z0, z2 }));
      // #423: a drawing of many strokes keeps them all (16 were kept, the rest dropped without a word), and each mark in it
      // names the frame it is on (they named the board's dialog).
      await sleep(1200);
      const had4 = (await comments()).length;
      const fa4 = await rect('a');
      await p.keyboard.down('d');
      for (let i = 0; i < 24; i++) {
        await p.mouse.move(fa4.x + fa4.w * 0.1 + i * 9, fa4.y + fa4.h * 0.3);
        await p.mouse.down();
        await p.mouse.move(fa4.x + fa4.w * 0.1 + i * 9, fa4.y + fa4.h * 0.3 + 30, { steps: 3 });
        await p.mouse.move(fa4.x + fa4.w * 0.1 + i * 9 + 3, fa4.y + fa4.h * 0.3 + 60, { steps: 3 });
        await p.mouse.up();
      }
      await p.keyboard.up('d');
      const many = await until(async () => { const c = await comments(); return c.length > had4 ? c.at(-1) : null; });
      const mk = many?.anchor?.ink || {};
      check(eng, 'a drawing of 24 strokes keeps all 24, and its marks name frame a', mk.pts?.length === 24 && Boolean(mk.marks?.length) && mk.marks.every((m) => /data-id="a"/.test(m)), JSON.stringify({ lines: mk.pts?.length, marks: mk.marks?.slice(0, 2) }));
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
finish();
