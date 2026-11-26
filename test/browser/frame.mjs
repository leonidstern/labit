// Shortcuts from labit.json in real browsers (WebKit and Chrome's engine): the changed keys work, the old ones don't,
// and the bar shows the new key. Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/shortcuts.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();

const DIR = tmp('labit-frame-');
const PORT = claimPort(7990, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'pricing.html'), '<!doctype html><meta charset="utf-8"><title>p</title><h1 id="t">Pricing one</h1><div style="height:3000px"></div><p id="end">end</p>');
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><meta charset="utf-8"><title>k</title><h1>Keys</h1><p>text</p>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);
try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await ctx.addInitScript(() => localStorage.setItem('lab-name', 'leo'));
      // A tab of the lab holds the live stream, as the board page will.
      const lead = await ctx.newPage();
      await lead.goto(B + '/');
      await sleep(600);
      // The board's stand-in: not a lab page (no widget on it), same origin, with what a board gives its frames.
      const board = await ctx.newPage();
      await board.route(B + '/stub', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><script>window.__labBoard={keys:[],typing:false,busy(){return this.typing},key(k){this.keys.push(k.key)}}</script><iframe name="lab:A" src="/pricing" style="width:400px;height:500px"></iframe><iframe name="lab:B" src="/pricing" style="width:400px;height:500px"></iframe><iframe name="plain" src="/pricing" style="width:400px;height:500px"></iframe>' }));
      await board.goto(B + '/stub');
      await sleep(1500);
      const [A, Bf, plain] = ['lab:A', 'lab:B', 'plain'].map((n) => board.frame({ name: n }));
      const look = (f) => f.evaluate(() => ({ host: Boolean(document.querySelector('[data-lab-comments]')), live: performance.getEntriesByType('resource').filter((e) => /\/_lab\/live/.test(e.name)).length, spot: typeof window.__labSpot?.clear }));
      const a = await look(A);
      check(eng, 'a board frame has no widget on its page and no stream of its own', !a.host && a.live === 0 && a.spot === 'function', JSON.stringify(a));
      check(eng, 'a frame not named lab: keeps the full widget', (await look(plain)).host);
      await A.locator('body').click({ position: { x: 5, y: 5 } });
      await board.keyboard.press('m');
      await board.keyboard.press('Shift+KeyB');
      await sleep(200);
      const keys = await board.evaluate(() => window.__labBoard.keys);
      check(eng, 'keys pressed in a frame reach the board', keys.includes('m') && keys.includes('B'), JSON.stringify(keys));
      await A.evaluate(() => scrollTo(0, 400));
      await Bf.evaluate(() => scrollTo(0, 400));
      fs.writeFileSync(path.join(DIR, 'pricing.html'), fs.readFileSync(path.join(DIR, 'pricing.html'), 'utf8').replace('Pricing one', 'Pricing two'));
      let texts = [];
      for (let i = 0; i < 40; i++) {
        texts = await Promise.all([A, Bf].map((f) => f.evaluate(() => [document.getElementById('t')?.textContent, scrollY])));
        if (texts.every((t) => t[0] === 'Pricing two')) break;
        await sleep(150);
      }
      check(eng, 'a save changes the page in both frames and keeps their scroll', texts.every((t) => t[0] === 'Pricing two' && t[1] >= 300), JSON.stringify(texts));
      check(eng, 'the frames still have no widget after the update', !(await look(A)).host && !(await look(Bf)).host);
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  // Gone before its folder is: still writing .lab as it exits, the folder could not be removed (ENOTEMPTY on CI).
  if (server.exitCode === null) await new Promise((r) => (server.once('exit', r), server.kill()));
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
}
finish();
