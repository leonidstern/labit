// A pin on a board's frame keeps to what it is on in the frame's page, in real browsers (WebKit and Chrome's engine): the
// page changes (more above it, a frame showing only its section) and the pin goes with its element; an element that is gone,
// and an old pin that has only its px in the frame, stay at those px. Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/boardanchor.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish, withAlt } from './harness.mjs';

const pw = playwright();

const DIR = tmp('labit-boardanchor-');
const PORT = claimPort(11200, 30);
const B = `http://localhost:${PORT}`;
const feed = (above, target = '<p id="goal" style="margin:0;font:20px/30px sans-serif">The goal line</p>') =>
  `<!doctype html><meta charset="utf-8"><title>Feed</title><style>body{margin:0}</style><h1 style="margin:0;height:60px">Feed</h1><div style="height:${above}px">above</div>${target}<div style="height:200px"></div>`;
const save = (text) => fs.writeFileSync(path.join(DIR, 'feed.html'), text);
save(feed(100));
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><meta charset="utf-8"><title>k</title><h1>Keys</h1>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);
try {
  for (const eng of engines()) {
    const name = `anc-${eng}`; // a board of its own per engine: the pins of the last one stay on theirs
    const comments = async () => (await (await fetch(`${B}/_lab/api/comments?page=/_board/${name}`)).json()).comments || [];
    save(feed(100));
    await fetch(`${B}/_lab/api/board?name=${name}`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ v: 1, rev: 0, frames: [{ id: 'a', src: '/feed', w: 600, h: 600, x: 0, y: 0 }] }) });
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'tester'); localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => console.log('pageerror', e.message));
      await p.goto(`${B}/_lab/board/${name}`);
      const root = 'document.querySelector("[data-lab-board-view]")?.shadowRoot';
      await p.waitForFunction((r) => new Function(`return ${r}`)()?.querySelector('iframe[name="lab:a"]')?.dataset.ready, root, { timeout: 8000 });
      await sleep(1500);
      // Where the goal line's left middle is on the screen (null: not on the page), and what scale the frame is drawn at.
      const goal = () => p.evaluate((r) => {
        const fr = new Function(`return ${r}`)().querySelector('iframe[name="lab:a"]');
        const g = fr.contentDocument.getElementById('goal');
        if (!g) return null;
        const [f, e] = [fr.getBoundingClientRect(), g.getBoundingClientRect()];
        const k = f.width / fr.contentWindow.innerWidth;
        return { x: f.x + (e.x + 40) * k, y: f.y + (e.y + e.height / 2) * k, k, fx: f.x, fy: f.y };
      }, root);
      // Every pin's tip (its lower left corner) on the screen.
      const tips = () => p.evaluate(() => {
        const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot;
        return [...(r?.querySelectorAll('button.pin') || [])].filter((b) => getComputedStyle(b).visibility !== 'hidden').map((b) => { const q = b.getBoundingClientRect(); return { x: q.x, y: q.y + q.height }; });
      });
      const near = (all, at) => all.some((t) => Math.abs(t.x - at.x) < 14 && Math.abs(t.y - at.y) < 14);

      // ----- a pin on the goal line: kept with its element in the frame's page
      const g0 = await goal();
      await withAlt(p, () => p.mouse.click(g0.x, g0.y));
      await p.waitForFunction(() => Boolean([...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot.querySelector('textarea')), null, { timeout: 4000 }).catch(() => {});
      await p.keyboard.type('fix this line');
      await p.keyboard.press('Enter');
      let pin;
      for (let i = 0; i < 30 && !pin; i++) { await sleep(150); pin = (await comments()).find((c) => c.text === 'fix this line'); }
      const an = pin?.anchor || {};
      check(eng, 'the pin is a board pin on frame a, with its px in the frame', an.kind === 'board' && an.frame === 'a' && Math.abs(an.fx - 40) < 3, JSON.stringify(an));
      check(eng, 'it keeps what it is on in the frame\'s page: the goal line', /#goal|p/.test(an.selector || '') && an.text === 'The goal line' && /<p id="goal"/.test(an.element || ''), JSON.stringify(an));
      const text = await (await fetch(`${B}/_lab/agent/_board/${name}`)).text();
      check(eng, 'the agent reads the frame and the element in its page', /near: frame a/.test(text) && /on the frame's page/.test(text) && /element text: "The goal line"/.test(text), text.slice(0, 600));

      // ----- an old pin with only its px in the frame (before pins kept their element), 300 px down the frame
      await fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: `/_board/${name}`, name: 'old', text: 'old pin', anchor: { kind: 'board', board: name, frame: 'a', fx: 300, fy: 300, selector: '', x: 0, y: 0, docX: 0, docY: 0 } }) });
      await p.reload();
      await p.waitForFunction((r) => new Function(`return ${r}`)()?.querySelector('iframe[name="lab:a"]')?.dataset.ready, root, { timeout: 8000 });
      await sleep(1500);
      const g1 = await goal();
      const old = () => ({ x: g1.fx + 300 * g1.k, y: g1.fy + 300 * g1.k });
      let t1 = await tips();
      check(eng, 'after a reload the pin is on the goal line', near(t1, g1), JSON.stringify([t1, g1]));
      check(eng, 'the old pin is at its px in the frame', near(t1, old()), JSON.stringify([t1, old()]));

      // ----- the page changes: 220 px more above the goal line (a frame showing another part, an edit)
      save(feed(320));
      let g2;
      for (let i = 0; i < 40; i++) { await sleep(150); g2 = await goal(); if (g2 && g2.y > g1.y + 100) break; }
      await sleep(1200);
      const t2 = await tips();
      check(eng, 'the page changed: the goal line moved down', g2 && g2.y > g1.y + 100, JSON.stringify([g1, g2]));
      check(eng, 'the pin went with the goal line', near(t2, g2), JSON.stringify([t2, g2]));
      check(eng, 'the old pin stays at its px', near(t2, old()), JSON.stringify([t2, old()]));

      // ----- the goal line is taken out: the pin waits at the px it was put at
      save(feed(320, ''));
      for (let i = 0; i < 40 && (await goal()); i++) await sleep(150);
      await sleep(1200);
      const t3 = await tips();
      const was = { x: g1.fx + an.fx * g1.k, y: g1.fy + an.fy * g1.k };
      check(eng, 'its element gone, the pin is back at its px in the frame', near(t3, was), JSON.stringify([t3, was]));
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
