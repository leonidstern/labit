// Keys typed in the widget's boxes stay in the widget (Leo, 23 Nov): a page that binds Space to play and pause, like a
// video player, never hears what is typed in a comment, and the comment gets its spaces. The page's own keys still work
// when no widget box has the focus, Esc still closes the box, and ⌘/Control keys still reach the page.
// Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/widgetkeys.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });

const DIR = tmp('labit-widgetkeys-');
const PORT = claimPort(8790, 30);
const B = `http://localhost:${PORT}`;
// A player page: Space toggles play and takes the key (preventDefault), arrows step, every key is counted.
fs.writeFileSync(path.join(DIR, 'index.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Player</title><body style="margin:0;font:16px system-ui"><main style="padding:40px"><h1>Player</h1><p id="state">paused</p><div id="stage" style="height:500px;background:#eee"></div></main><script>
window.__keys = { down: 0, up: 0, press: 0, space: 0, meta: 0 };
let playing = false;
document.addEventListener('keydown', (e) => {
  __keys.down++;
  if (e.metaKey || e.ctrlKey) __keys.meta++;
  if (e.key === ' ') { e.preventDefault(); __keys.space++; playing = !playing; document.getElementById('state').textContent = playing ? 'playing' : 'paused'; }
});
document.addEventListener('keyup', () => __keys.up++);
document.addEventListener('keypress', () => __keys.press++);
</script>`);
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);

const ROOT = `document.querySelector('[data-lab-comments]').shadowRoot`;
try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
      await ctx.addInitScript(() => {
        localStorage.setItem('lab-name', 'leo');
        localStorage.setItem('lab-on', '1');
      });
      const p = await ctx.newPage();
      await p.goto(B + '/');
      await p.waitForFunction(() => document.querySelector('[data-lab-comments]')?.shadowRoot?.querySelector('.bar'), null, { timeout: 10000 });
      await sleep(800);
      const keys = () => p.evaluate('({ ...window.__keys, state: document.getElementById("state").textContent })');
      const box = () => p.evaluate(`(() => { const t = ${ROOT}.querySelector('textarea'); return t ? { value: t.value, focused: ${ROOT}.activeElement === t } : null; })()`);

      // A Space on the page itself is the page's: it plays.
      await p.mouse.click(500, 300);
      await sleep(500);
      let b = await box();
      if (b) await p.keyboard.press('Escape'), await sleep(300); // the click opened a comment box: close it, the page key comes first
      await p.evaluate('document.activeElement?.blur()');
      await p.keyboard.press(' ');
      await sleep(100);
      let k = await keys();
      check(eng, 'a Space on the page still reaches the page', k.space === 1 && k.state === 'playing', JSON.stringify(k));

      // A new comment: what is typed in its box stays in the box, spaces and all, and the page hears none of it.
      await p.mouse.click(500, 350);
      await sleep(600);
      b = await box();
      check(eng, 'a click on the page opens a focused comment box', b?.focused === true, JSON.stringify(b));
      const before = await keys();
      await p.keyboard.type('the plane needs two engines');
      await p.keyboard.press('ArrowLeft');
      await p.keyboard.press('Backspace');
      await sleep(150);
      b = await box();
      k = await keys();
      check(eng, 'the comment keeps its spaces', b?.value === 'the plane needs two engins', JSON.stringify(b));
      check(eng, 'the page hears no key typed in the box', k.down === before.down && k.up === before.up && k.press === before.press && k.state === 'playing', JSON.stringify({ before, after: k }));

      // ⌘/Control combos still go on to the page (its own shortcuts, ⌘K).
      await p.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
      await sleep(100);
      k = await keys();
      check(eng, '⌘/Control keys typed in the box still reach the page', k.meta > before.meta, JSON.stringify(k));

      // Esc still closes the box, as before.
      await p.keyboard.press('Escape');
      await sleep(400);
      b = await box();
      check(eng, 'Esc in the box still closes it', b === null, JSON.stringify(b));
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
finish();
