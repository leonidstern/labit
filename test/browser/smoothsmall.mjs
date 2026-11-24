// Browser checks of three small smoothness fixes, in Safari's engine (WebKit) and Chrome's, with Playwright:
// a placed pin cannot be text-selected (a hold on iOS selected its letter); resolving a pin does not pulse its opacity
// (WebKit); the bar's left edge does not move when a count gains a digit (9 -> 10).
// Not part of `npm test`; CI runs it in the `browser` job. Run: node test/browser/smoothsmall.mjs   (needs the playwright
// package; NODE_PATH can point at a node_modules that has it). Prints one line per check and exits 1 if any fails.
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });
const DIR = tmp('labit-smoothsmall-');
const PORT = String(claimPort(5800, 190)); // below 6000: browsers refuse that port (X11), and the page never loads
const B = `http://localhost:${PORT}`;
const env = labEnv({}, { settings: false });
const PAGE = `<!doctype html><meta charset="utf-8"><title>smooth</title>
<style>body{margin:30px;max-width:420px;font:18px/1.6 Georgia,serif}</style>
<p id="t">Plain words in a paragraph, quite a few of them, for a pin to sit on.</p>
<div style="height:900px"></div>`;
const server = startLab(DIR, env, { root: '.', port: PORT, stdio: 'ignore' });
let n = 0;
await labUp(B);
const post = (page, text, name = 'Sam') =>
  fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page, name, text, anchor: { selector: '#t', x: 0.5, y: 0.5, docX: 100 + (n++ % 12) * 25, docY: 120, width: 200 } }) });
const inRoot = (p, fn, arg) =>
  p.evaluate(([src, arg]) => {
    const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot;
    return new Function('r', 'a', `return (${src})(r, a)`)(r, arg);
  }, [fn.toString(), arg]);
const until = (p, fn, ms) => p.waitForFunction(fn, null, { timeout: ms, polling: 'raf' }).catch(() => {});

async function scene(browser, name, run) {
  const PG = `/${name}`;
  fs.writeFileSync(path.join(DIR, `${name}.html`), PAGE);
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await ctx.addInitScript(() => localStorage.setItem('lab-name', 'leo'));
  const p = await ctx.newPage();
  try {
    await run(p, PG);
  } finally {
    await ctx.close();
  }
}
const open = async (p, PG) => {
  await p.goto(B + PG);
  await until(p, () => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.scrim')), 3000);
  await sleep(500);
};

try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      await scene(browser, 'a', async (p, PG) => {
        await post(PG, 'one');
        await open(p, PG);
        await until(p, () => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('button.pin')), 3000);
        const us = await inRoot(p, (r) => { const q = r.querySelector('button.pin'); return [getComputedStyle(q).userSelect, getComputedStyle(q).webkitUserSelect, getComputedStyle(q.firstElementChild || q).userSelect]; });
        check(eng, 'a placed pin and what is in it are user-select: none', us[0] === 'none' && us[2] === 'none' && (eng !== 'webkit' || us[1] === 'none'), JSON.stringify(us));
      });

      await scene(browser, 'd', async (p, PG) => {
        await post(PG, 'one');
        await post(PG, 'two');
        await open(p, PG);
        await until(p, () => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelectorAll('button.pin').length === 2), 3000);
        const b = await inRoot(p, (r) => { const q = r.querySelectorAll('button.pin')[1].getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; });
        await p.mouse.click(b[0], b[1]);
        await sleep(700);
        const btn = await inRoot(p, (r) => { const q = [...r.querySelectorAll('.card .btn')].find((x) => x.textContent === 'resolve')?.getBoundingClientRect(); return q && [q.x + q.width / 2, q.y + q.height / 2]; });
        check(eng, 'the card has a resolve button', Boolean(btn));
        if (btn) {
          await inRoot(p, (r) => {
            window.__op = [];
            const t0 = performance.now();
            const tick = () => {
              const q = r.querySelectorAll('button.pin')[1];
              if (q) window.__op.push(+getComputedStyle(q).opacity);
              if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
            };
            tick();
          });
          await p.mouse.click(btn[0], btn[1]);
          await p.mouse.move(1150, 40);
          await sleep(1700);
          const op = await p.evaluate(() => window.__op);
          const end = op[op.length - 1];
          // A fade from 1 down to the faded .5 is fine; a dip and rise (the pulse) is not: the series must never rise by .02 or more.
          let rises = 0;
          for (let i = 1; i < op.length; i++) if (op[i] > op[i - 1] + 0.02) rises++;
          check(eng, 'resolving a pin settles at .5 and its opacity never pulses', end === 0.5 && rises === 0, `end ${end} rises ${rises} ${[...new Set(op)].join(',')}`);
        }
      });

      await scene(browser, 'f', async (p, PG) => {
        for (let i = 0; i < 9; i++) await post(PG, `r${i}`);
        await open(p, PG);
        const count = () => inRoot(p, (r) => r.querySelector('.list-btn .cnt')?.textContent);
        await until(p, () => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.list-btn .cnt')?.textContent === '9'), 3000);
        const bar = () => inRoot(p, (r) => { const q = r.querySelector('.bar').getBoundingClientRect(); return [q.left, q.width]; });
        const c9 = await count();
        const a = await bar();
        await post(PG, 'ten');
        await until(p, () => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.list-btn .cnt')?.textContent === '10'), 3000);
        await sleep(400);
        const c10 = await count();
        const b = await bar();
        check(eng, 'counts read 9 then 10', c9 === '9' && c10 === '10', `${c9} ${c10}`);
        // Under a pixel: fonts differ between a Mac and Linux by a fraction of one; the growth this guards against was 7.6 px.
        check(eng, 'the bar does not move or widen when a count gains a digit', Math.abs(a[0] - b[0]) < 1 && Math.abs(a[1] - b[1]) < 1, `${a.map((x) => x.toFixed(1))} -> ${b.map((x) => x.toFixed(1))}`);
      });
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
}
finish();
