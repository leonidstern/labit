// A board's frames when one page is saved, and when a frame is put to sleep and woken again (issue 428), in real browsers
// (WebKit and Chrome's engine). Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/boardframes.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
//
// What a frame keeps: a frame put back to its card (more than 8 alive, 3 on a phone) loads its page again when it is
// woken, so whatever that page held only in itself (a scroll, a typed field, a script's state) starts over. Its pins do
// not: they are stored on the board by frame and spot, not in the frame's page, and the board, its camera and the other
// frames are not touched.
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish, withAlt } from './harness.mjs';

const pw = playwright();

const DIR = tmp('labit-boardframes-');
const PORT = claimPort(8290, 30);
const B = `http://localhost:${PORT}`;
const page = (title, h1) => `<!doctype html><meta charset="utf-8"><title>${title}</title><h1>${h1}</h1><div style="height:600px"></div>`;
fs.writeFileSync(path.join(DIR, 'pricing.html'), page('Pricing', 'Pricing one'));
fs.writeFileSync(path.join(DIR, 'checkout.html'), page('Checkout', 'Checkout one'));
fs.writeFileSync(path.join(DIR, 'index.html'), page('k', 'Keys'));
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);
const put = (name, frames) => fetch(`${B}/_lab/api/board?name=${name}`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ v: 1, rev: 0, frames }) }).then((r) => r.json());
await put('two', [{ id: 'a', src: '/pricing', w: 400, h: 400, x: 0, y: 0 }, { id: 'b', src: '/checkout', w: 400, h: 400, x: 500, y: 0 }]);
// a on its own at the left, nine more far to the right: going to those puts a to sleep
await put('many', [{ id: 'a', src: '/pricing', w: 300, h: 300, x: 0, y: 0 }, ...Array.from({ length: 9 }, (_, i) => ({ id: 'n' + i, src: '/checkout', w: 300, h: 300, x: 5000 + (i % 3) * 340, y: Math.floor(i / 3) * 340 }))]);
const save = (f, text) => fs.writeFileSync(path.join(DIR, f), text);
try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'tester'); localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => console.log('pageerror', e.message));
      const view = 'document.querySelector("[data-lab-board-view]").shadowRoot';
      const frameDoc = (id) => p.evaluate(([v, i]) => { const f = new Function(`return ${v}`)().querySelector(`iframe[name="lab:${i}"]`); return f?.dataset.ready ? { kept: f.contentWindow.__kept === 1, h1: f.contentDocument.querySelector('h1')?.textContent } : null; }, [view, id]);
      const keep = (id) => p.evaluate(([v, i]) => { new Function(`return ${v}`)().querySelector(`iframe[name="lab:${i}"]`).contentWindow.__kept = 1; }, [view, id]);
      const cam = () => p.evaluate(() => __labBoard.camera());

      // ----- one changed frame: only it reloads; the other frame, the board and its camera stay as they were
      await p.goto(B + '/_lab/board/two');
      await p.waitForFunction((v) => [...new Function(`return ${v}`)().querySelectorAll('iframe')].filter((f) => f.dataset.ready).length === 2, view, { timeout: 8000 });
      await sleep(800);
      await p.evaluate(() => (window.__kept = 1));
      await keep('a');
      await keep('b');
      const c0 = await cam();
      save('pricing.html', page('Pricing', 'Pricing two'));
      let a1;
      for (let i = 0; i < 40 && a1?.h1 !== 'Pricing two'; i++) { await sleep(150); a1 = await frameDoc('a'); }
      await sleep(800);
      const b1 = await frameDoc('b');
      check(eng, 'the saved page\'s frame shows the change', a1?.h1 === 'Pricing two', JSON.stringify(a1));
      check(eng, 'the other frame is not reloaded', b1?.kept === true && b1.h1 === 'Checkout one', JSON.stringify(b1));
      check(eng, 'the board page is not reloaded', await p.evaluate(() => window.__kept === 1));
      check(eng, 'the camera did not move', JSON.stringify(await cam()) === JSON.stringify(c0), JSON.stringify([c0, await cam()]));

      // ----- a frame put to sleep and woken: its page loads again, its pin stays on its spot
      await p.goto(B + '/_lab/board/many');
      await sleep(1500);
      // the board's box on the screen, and a zoom about a world point until the camera is at z
      const box = await p.evaluate((v) => { const r = new Function(`return ${v}`)().querySelector('#lab-board').getBoundingClientRect(); return [r.x, r.y]; }, view);
      const zoomTo = async (wx, wy, z) => {
        for (let i = 0; i < 80; i++) {
          const c = await cam();
          if (Math.abs(c.z - z) / z < 0.08) break;
          await p.mouse.move(box[0] + (wx + c.x) * c.z, box[1] + (wy + c.y) * c.z);
          await p.keyboard.down('Control');
          await p.mouse.wheel(0, c.z < z ? -20 : 20);
          await p.keyboard.up('Control');
          await sleep(30);
        }
        await sleep(400);
      };
      await p.keyboard.press('Shift+Digit1');
      await sleep(300);
      await zoomTo(150, 150, 1);
      await p.waitForFunction((v) => new Function(`return ${v}`)().querySelector('iframe[name="lab:a"]')?.dataset.ready, view, { timeout: 8000 });
      const rect = (id) => p.evaluate(([v, i]) => { const r = new Function(`return ${v}`)().querySelector(`#lab-board .f[data-id="${i}"]`).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; }, [view, id]);
      const ra = await rect('a');
      await withAlt(p, () => p.mouse.click(ra.x + ra.w * 0.6, ra.y + ra.w * 0.4));
      await p.waitForFunction(() => Boolean([...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot.querySelector('textarea')), null, { timeout: 4000 }).catch(() => {});
      await p.keyboard.type('pin on a');
      await p.keyboard.press('Enter');
      let saved;
      for (let i = 0; i < 30 && !saved; i++) { await sleep(150); saved = (await (await fetch(`${B}/_lab/api/comments?page=/_board/many`)).json()).comments?.[0]; }
      check(eng, 'the pin is stored on the board by frame', saved?.anchor?.frame === 'a', JSON.stringify(saved?.anchor));
      await p.keyboard.press('Escape');
      await keep('a');
      // to the nine on the right, close enough to wake them all: a is the one put to sleep
      await p.keyboard.press('Shift+Digit1');
      await sleep(300);
      await zoomTo(5500, 500, 0.7);
      let slept = false;
      for (let i = 0; i < 40 && !slept; i++) { await sleep(150); slept = !(await p.evaluate(() => __labBoard.live().includes('a'))); }
      check(eng, 'with nine others in view, a is put to sleep (the cap)', slept, JSON.stringify(await p.evaluate(() => __labBoard.live())));
      // back to a
      await p.keyboard.press('Shift+Digit1');
      await sleep(300);
      await zoomTo(150, 150, 1);
      let back;
      for (let i = 0; i < 40 && !back; i++) { await sleep(150); back = await frameDoc('a'); }
      check(eng, 'woken again, a loads its page anew (what it held only in itself starts over)', back && back.kept === false && back.h1 === 'Pricing two', JSON.stringify(back));
      const rb = await rect('a');
      const pin = await p.evaluate(() => { const b = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot.querySelector('button.pin'); const q = b?.getBoundingClientRect(); return q && { x: q.x, y: q.y + q.height }; });
      const s = rb.w / 300;
      check(eng, 'its pin is still on its spot', pin && Math.abs(pin.x - (rb.x + saved.anchor.fx * s)) < 14 && Math.abs(pin.y - (rb.y + saved.anchor.fy * s)) < 14, JSON.stringify([pin, rb, saved?.anchor]));
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
