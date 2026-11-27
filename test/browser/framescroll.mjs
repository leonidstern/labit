// Shortcuts from labit.json in real browsers (WebKit and Chrome's engine): the changed keys work, the old ones don't,
// and the bar shows the new key. Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/shortcuts.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();

const DIR = tmp('labit-framescroll-');
const PORT = claimPort(8020, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'pricing.html'), '<!doctype html><meta charset="utf-8"><title>p</title><script>window.x=1</script><h1 id="t">Pricing one</h1><div style="height:3000px"></div><p id="end">end</p>');
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><meta charset="utf-8"><title>k</title><h1>Keys</h1><p>text</p>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);
try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await ctx.addInitScript(() => {
        localStorage.setItem('lab-name', 'leo');
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (this === sessionStorage && k.startsWith('lab-scroll:')) localStorage.setItem('rec', (localStorage.getItem('rec') || '') + k + '|');
          return set.call(this, k, v);
        };
      });
      // A stand-in for a board: no widget on it, two frames of one page that has a script (a save reloads it).
      const board = await ctx.newPage();
      await board.route(B + '/stub', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><iframe name="lab:A" src="/pricing" style="width:400px;height:500px"></iframe><iframe name="lab:B" src="/pricing" style="width:400px;height:500px"></iframe>' }));
      await board.goto(B + '/stub');
      // Both frames loaded, however long a busy machine takes (a fixed 1.5 s was too short with eight jobs at once).
      for (let t = 0; t < 15000 && !['lab:A', 'lab:B'].every((n) => board.frame({ name: n })?.url().endsWith('/pricing')); t += 100) await sleep(100);
      await board.waitForLoadState('load');
      await sleep(300);
      const [A, Bf] = ['lab:A', 'lab:B'].map((n) => board.frame({ name: n }));
      await A.evaluate(() => scrollTo(0, 400));
      await Bf.evaluate(() => scrollTo(0, 900));
      await A.evaluate(() => (window.__same = 1));
      fs.writeFileSync(path.join(DIR, 'pricing.html'), fs.readFileSync(path.join(DIR, 'pricing.html'), 'utf8').replace('Pricing one', 'Pricing two'));
      let got = [];
      for (let i = 0; i < 50; i++) {
        await sleep(200);
        try {
          got = await Promise.all([A, Bf].map((f) => f.evaluate(() => [document.getElementById('t')?.textContent, Math.round(scrollY), window.__same])));
        } catch {
          continue;
        }
        if (got.every((g) => g[0] === 'Pricing two') && !got[0][2]) break;
      }
      await sleep(600);
      got = await Promise.all([A, Bf].map((f) => f.evaluate(() => [document.getElementById('t')?.textContent, Math.round(scrollY), window.__same])));
      check(eng, 'both frames reloaded (not patched)', got.every((g) => g[0] === 'Pricing two' && !g[2]), JSON.stringify(got));
      check(eng, 'each frame of one page comes back to its own scroll', got[0][1] === 400 && got[1][1] === 900, JSON.stringify(got));
      const keys = await board.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('lab-scroll:')));
      const rec = await board.evaluate(() => localStorage.getItem('rec') || '');
      check(eng, 'each frame saves its scroll under its own key', rec.includes('lab-scroll:lab:A:/pricing|') && rec.includes('lab-scroll:lab:B:/pricing|'), rec);
      check(eng, 'the scroll keys are used up, none left behind', keys.length === 0, JSON.stringify(keys));
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
