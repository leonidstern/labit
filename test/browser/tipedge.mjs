// A working pin's tip (what the agent is doing, shown on hover) stays inside the window: on a 390 px page a pin by the
// right edge had its tip laid out past it, and the page scrolled sideways to 587 px (shown or not, the tip is laid out).
// Its tip opens toward the wider side, as wide as the room there. Not part of `npm test`.
// Run: node test/browser/tipedge.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { claimPort } from './port.mjs';
import { playwright, engines, LAB, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();
const DIR = tmp('labit-tipedge-');
const PORT = claimPort(8420, 30);
const B = `http://localhost:${PORT}`;
const env = labEnv({ LAB_SETTLE_MS: '0' }, { settings: false });
// three spots on a row: the left edge, the middle, the right edge
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>t</title><body style="margin:0"><div style="display:flex;justify-content:space-between;padding:60px 4px 0"><b id="l">left</b><b id="m">middle</b><b id="r">right</b></div><p style="margin:16px">words</p>');
const server = startLab(DIR, env, { root: '.', port: PORT });
await labUp(B);
const cli = (...args) => new Promise((done) => execFile(process.execPath, [LAB, ...args], { cwd: DIR, env }, (err, out, errOut) => done({ code: err?.code ?? 0, out: out + errOut })));
const post = (sel, x) => fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', name: 'Leo', text: `pin ${sel}`, anchor: { selector: sel, x, y: 0.5, docX: 0, docY: 60, width: 390, element: `<b id="${sel.slice(1)}">` } }) }).then((r) => r.json()).then((j) => j.comment.id);
const ids = [await post('#l', 0.1), await post('#m', 0.5), await post('#r', 0.95)];
await cli('wait', '--timeout', '5');
for (const id of ids) await cli('reply', id, '--progress', 'checking every row of the table against the file, then the spacing between them');
try {
  for (const eng of engines('webkit,chromium')) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 700 } });
      await ctx.addInitScript(() => localStorage.setItem('lab-name', 'leo'));
      const p = await ctx.newPage();
      p.on('pageerror', (e) => console.log('pageerror', e.message));
      await p.goto(B + '/');
      await p.waitForFunction(() => [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot.querySelectorAll('button.pin .tip').length === 3, null, { timeout: 8000 });
      await sleep(400);
      const wide = await p.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      check(eng, 'at 390 px with working pins by both edges, the page does not scroll sideways', wide.scroll === wide.client, JSON.stringify(wide));
      const tips = [];
      for (const i of [0, 1, 2]) {
        const pin = await p.evaluate((n) => { const b = [...[...document.querySelectorAll('*')].find((x) => x.shadowRoot?.querySelector('.scrim')).shadowRoot.querySelectorAll('button.pin')][n].getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, i);
        await p.mouse.move(pin.x, pin.y);
        await sleep(350);
        tips.push(await p.evaluate((n) => { const t = [...[...document.querySelectorAll('*')].find((x) => x.shadowRoot?.querySelector('.scrim')).shadowRoot.querySelectorAll('button.pin')][n].querySelector('.tip'); const r = t.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), shown: getComputedStyle(t).opacity }; }, i));
      }
      check(eng, 'each tip, hovered, is inside the window', tips.every((t) => t.left >= 0 && t.right <= 390 && t.w > 60), JSON.stringify(tips));
      const hovered = await p.evaluate(() => document.documentElement.scrollWidth);
      check(eng, 'and hovering one widens nothing', hovered === wide.client, String(hovered));
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
finish();
