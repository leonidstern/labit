// A framework's hot update that redraws the page without loading it again (issue 428): the app's DOM is replaced, the
// document stays. The widget, an unsent comment being written and the pins stay, in real browsers (WebKit and Chrome's
// engine). Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/remount.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish, withAlt } from './harness.mjs';

const pw = playwright();

const DIR = tmp('labit-remount-');
const PORT = claimPort(10700, 30);
const B = `http://localhost:${PORT}`;
// The app's own redraw: its markup again, new nodes, as a framework's hot update does (window.redraw(banner)).
const app = `<!doctype html><meta charset="utf-8"><title>r</title><div id="app"></div><script>
const parts = ${JSON.stringify(Array.from({ length: 20 }, (_, i) => `<p id="p${i}">Paragraph number ${i} with some words in it.</p>`))};
// a banner on top (the page grows), or paragraph 8 moved up to the top (the page keeps its size)
const view = (how) => (how === 'banner' ? '<div style="height:120px">New banner</div>' : '') + '<h1>Remount</h1>' + (how === 'up' ? [parts[8], ...parts.filter((_, i) => i !== 8)] : parts).join('');
document.getElementById('app').innerHTML = view('');
window.redraw = (banner, how) => {
  if (how === 'body') document.body.innerHTML = '<div id="app">' + view(banner) + '</div>';
  else if (how === 'swap') { const b = document.createElement('body'); b.innerHTML = '<div id="app">' + view(banner) + '</div>'; document.body.replaceWith(b); }
  else document.getElementById('app').innerHTML = view(banner);
};
</script>`;
fs.writeFileSync(path.join(DIR, 'index.html'), app);
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);
const post = (id) => fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', name: 'tester', text: 'Saved pin', anchor: { selector: '#' + id, x: 0.3, y: 0.5, docX: 0, docY: 0, width: 1000, height: 700 } }) });
await post('p8');
try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'tester'); localStorage.setItem('lab-on', '1'); });
      for (const how of ['app', 'body', 'swap']) {
        const p = await ctx.newPage();
        p.on('pageerror', (e) => console.log('pageerror', e.message));
        await p.goto(B + '/');
        await p.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.scrim')), null, { timeout: 5000 });
        await sleep(1000);
        await p.evaluate(() => (window.__kept = 1));
        const sh = (fn) => p.evaluate((f) => { const h = [...document.querySelectorAll('[data-lab-comments]')].find((n) => n.shadowRoot); return h ? new Function('r', 'h', f)(h.shadowRoot, h) : null; }, fn);
        const pinOf = () => sh('const b = [...r.querySelectorAll("button.pin")][0]; const q = b?.getBoundingClientRect(); return q && { x: q.x, y: q.y };');
        const target = (id) => p.evaluate((i) => { const q = document.getElementById(i).getBoundingClientRect(); return { x: q.x, y: q.y, h: q.height }; }, id);
        const saved0 = await pinOf();
        const t0 = await target('p8');
        // an unsent comment on paragraph 3
        const r3 = await target('p3');
        await withAlt(p, () => p.mouse.click(r3.x + 80, r3.y + r3.h / 2));
        await p.waitForFunction(() => Boolean([...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot.querySelector('textarea')), null, { timeout: 4000 }).catch(() => {});
        await p.keyboard.type('half written');
        await sleep(300);
        await p.evaluate((h) => window.redraw('banner', h), how);
        await sleep(1200);
        const after = await sh('const t = r.querySelector("textarea"); return { on: h.isConnected, hosts: document.querySelectorAll("[data-lab-comments]").length, words: t?.value, focused: r.activeElement === t };');
        check(eng, `${how}: the widget is still on the page, once`, after?.on === true && after.hosts === 1, JSON.stringify(after));
        check(eng, `${how}: the unsent comment and its words are kept`, after?.words === 'half written', JSON.stringify(after));
        check(eng, `${how}: the page was not loaded again`, await p.evaluate(() => window.__kept === 1));
        // the pins stay put while a new comment is written (its box is not drawn again); once it is let go they follow
        await p.keyboard.press('Escape');
        await sleep(300);
        await p.keyboard.press('Escape');
        await sleep(800);
        const t1 = await target('p8');
        const saved1 = await pinOf();
        const moved = t1.y - t0.y;
        check(eng, `${how}: a saved pin follows its paragraph, redrawn lower`, saved0 && saved1 && moved > 50 && Math.abs(saved1.y - saved0.y - moved) < 4, JSON.stringify([saved0, saved1, moved]));
        // redrawn with paragraph 8 moved to the top: the page keeps its size, the pin still follows
        await p.evaluate((h) => window.redraw('up', h), how);
        await sleep(1000);
        const t2 = await target('p8');
        const saved2 = await pinOf();
        check(eng, `${how}: a pin follows its paragraph moved up in a redraw of the same size`, saved2 && Math.abs(saved2.y - saved1.y - (t2.y - t1.y)) < 4 && t2.y < t1.y - 100, JSON.stringify([saved1, saved2, t1.y, t2.y]));
        await p.close();
      }
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
}
finish();
