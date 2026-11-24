// Frames (Leo, 23 Nov: 1a 2a 3a 4a 7a, and Space): with comments shown, ← → step the video most in view a frame and ⇧
// a second; an arrow on a playing video pauses it first; Space plays or pauses it; the motion menu's top line counts
// the frame and names the keys; a paused loop steps by 1/60 s. In WebKit and Chrome's engine. Not part of `npm test`.
// Run: node test/browser/framestep.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();
const MEDIA = fileURLToPath(new URL('../../bench/', import.meta.url));
const DIR = tmp('labit-framestep-');
const PORT = claimPort(7990, 30);
const B = `http://localhost:${PORT}`;
fs.copyFileSync(path.join(MEDIA, 'site/media/countdown.webm'), path.join(DIR, 'v.webm')); // 30 frames a second
const PAGE = `<!doctype html><meta charset="utf-8"><title>f</title>
<style>@keyframes slide { to { translate: 200px } } body { margin: 20px } video { display: block; width: 320px }
#loop { width: 40px; height: 40px; background: #333; animation: slide 4s linear infinite; margin-top: 900px }</style>
<h1>Frames</h1><video id="vid" src="v.webm" muted loop autoplay playsinline></video><div id="loop"></div>`;
for (const eng of ['webkit', 'chromium']) fs.writeFileSync(path.join(DIR, `${eng}.html`), PAGE);
const server = startLab(DIR, labEnv(), { port: PORT });
await labUp(B);
const until = (p, fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms, polling: 'raf' }).catch(() => {});
const ROOT = "[...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot";
const inRoot = (p, js) => p.evaluate(`(() => { const r = ${ROOT}; return ${js}; })()`);
const vid = (p) => p.evaluate(() => { const v = document.getElementById('vid'); return { t: v.currentTime, paused: v.paused, f: Math.floor(v.currentTime * 30 + 1e-3) }; });
const settled = (p) => p.waitForFunction(() => !document.getElementById('vid').seeking, null, { timeout: 2000 }).catch(() => {});

try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await ctx.addInitScript(() => localStorage.setItem('lab-name', 'zz-frames'));
      const p = await ctx.newPage();
      await p.goto(`${B}/${eng}`);
      await until(p, () => performance.getEntriesByType('resource').some((e) => /\/_lab\/motion\.js/.test(e.name)), null, 3000);
      await until(p, () => document.getElementById('vid').currentTime > 0.8, null, 4000);
      if (!(await p.evaluate(() => document.getElementById('vid').readyState >= 2 && !document.getElementById('vid').paused))) {
        console.log(`skip ${eng.padEnd(8)} (this engine can't play the WebM)`);
        continue;
      }
      await p.mouse.move(600, 600); // the pointer off the video: the keys find it all the same
      await p.keyboard.press('ArrowRight');
      await sleep(150);
      const a = await vid(p);
      check(eng, 'an arrow on a playing video pauses it, no step yet (3a)', a.paused, JSON.stringify(a));
      await p.keyboard.press('ArrowRight');
      await settled(p);
      const b = await vid(p);
      check(eng, '→ steps one frame (1a)', b.paused && b.f === a.f + 1, JSON.stringify({ a, b }));
      await p.keyboard.press('ArrowLeft');
      await settled(p);
      await p.keyboard.press('ArrowLeft');
      await settled(p);
      const c = await vid(p);
      check(eng, '← steps back a frame each press', c.f === a.f - 1, JSON.stringify({ a, c }));
      await p.keyboard.press('Shift+ArrowRight');
      await settled(p);
      const d = await vid(p);
      check(eng, '⇧→ steps one second', d.f - c.f === 30, JSON.stringify({ c, d }));
      check(eng, 'the page did not scroll', (await p.evaluate(() => scrollX)) === 0);
      // Space plays it and pauses it again (Leo: "space bar to work in comments").
      await p.keyboard.press(' ');
      await sleep(400);
      const e1 = await vid(p);
      await p.keyboard.press(' ');
      await sleep(150);
      const e2 = await vid(p);
      check(eng, 'Space plays, Space pauses', !e1.paused && e1.t > d.t && e2.paused, JSON.stringify({ e1, e2 }));
      check(eng, 'Space did not scroll the page', (await p.evaluate(() => scrollY)) === 0);
      // The menu's top line counts the frame and names the keys (4a), and keeps counting as you step.
      const r = await p.evaluate(() => document.getElementById('vid').getBoundingClientRect().toJSON());
      await p.mouse.click(r.left + 100, r.top + 60, { button: 'right' });
      await sleep(250);
      const head1 = await inRoot(p, "r.querySelector('.motion-menu .lab-head')?.textContent || ''");
      const keys = await inRoot(p, "r.querySelector('.motion-menu .motion-keys')?.textContent || ''");
      await p.keyboard.press('ArrowRight');
      await settled(p);
      await sleep(100);
      const head2 = await inRoot(p, "r.querySelector('.motion-menu .lab-head')?.textContent || ''");
      const f2 = (await vid(p)).f;
      check(eng, 'the menu says the frame and the keys', /· frame \d+$/.test(head1) && keys === 'frame← →', JSON.stringify({ head1, keys }));
      check(eng, 'its top line counts as you step', head2.endsWith(`· frame ${f2 + 1}`) && head2 !== head1, JSON.stringify({ head1, head2, f2 }));
      await p.keyboard.press('Escape');
      // Typing in a comment box keeps its arrows.
      // A paused loop steps by a screen frame (7a): right-click it, pause, then →.
      await p.evaluate(() => document.getElementById('loop').scrollIntoView({ block: 'center' }));
      await sleep(300);
      const lr = await p.evaluate(() => document.getElementById('loop').getBoundingClientRect().toJSON());
      await p.mouse.click(lr.left + 10, lr.top + 10, { button: 'right' });
      await sleep(200);
      await inRoot(p, "[...r.querySelectorAll('.motion-menu button')].find((b) => b.textContent === 'pause')?.click()");
      await sleep(100);
      const l1 = await p.evaluate(() => Number(document.getElementById('loop').getAnimations()[0].currentTime));
      await p.keyboard.press('ArrowRight');
      await p.keyboard.press('ArrowRight');
      const l2 = await p.evaluate(() => ({ t: Number(document.getElementById('loop').getAnimations()[0].currentTime), s: document.getElementById('loop').getAnimations()[0].playState }));
      check(eng, 'a paused loop steps 1/60 s a press (7a)', l2.s === 'paused' && Math.abs(l2.t - l1 - 2000 / 60) < 1, JSON.stringify({ l1, l2 }));
      // Comments hidden: the keys are the page's again.
      await p.keyboard.press('Escape');
      await p.keyboard.press('m');
      await sleep(200);
      const v0 = await vid(p);
      await p.keyboard.press('ArrowRight');
      await settled(p);
      check(eng, 'comments hidden: the arrows are the page\'s', (await vid(p)).f === v0.f);
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
