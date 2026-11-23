// Writing about a video (Leo, 23 Nov, 9b): the moment line above a new comment's box and a reply's box follows the video,
// ⌃ ← → step it a frame while the words stay, ⌃K plays or pauses, the line names the keys while the box has the cursor,
// and each message keeps the moment it was sent at, a reply its own. In WebKit and Chrome's engine. Not part of `npm test`.
// Run: node test/browser/typingframes.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();
const MEDIA = fileURLToPath(new URL('../../bench/', import.meta.url));
const DIR = tmp('labit-typingframes-');
const PORT = claimPort(8020, 30);
const B = `http://localhost:${PORT}`;
fs.copyFileSync(path.join(MEDIA, 'site/media/countdown.webm'), path.join(DIR, 'v.webm')); // 30 frames a second
const PAGE = `<!doctype html><meta charset="utf-8"><title>t</title><style>body { margin: 20px } video { display: block; width: 480px }</style>
<h1>Typing</h1><video id="vid" src="v.webm" muted loop autoplay playsinline></video><p>text</p>`;
for (const eng of ['webkit', 'chromium']) fs.writeFileSync(path.join(DIR, `${eng}.html`), PAGE);
const server = startLab(DIR, labEnv(), { port: PORT });
await labUp(B);
const until = (p, fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms, polling: 'raf' }).catch(() => {});
const ROOT = "[...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot";
const inRoot = (p, js) => p.evaluate(`(() => { const r = ${ROOT}; return ${js}; })()`);
const frame = (p) => p.evaluate(() => Math.floor(document.getElementById('vid').currentTime * 30 + 1e-3) + 1);
const settled = (p) => p.waitForFunction(() => !document.getElementById('vid').seeking, null, { timeout: 2000 }).catch(() => {});
let PG = '/webkit';
const comments = async () => (await (await fetch(`${B}/_lab/api/comments?page=${PG}`)).json()).comments;

try {
  for (const eng of engines()) {
    PG = `/${eng}`;
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
      await ctx.addInitScript(() => localStorage.setItem('lab-name', 'zz-typing'));
      const p = await ctx.newPage();
      await p.goto(B + PG);
      await until(p, () => performance.getEntriesByType('resource').some((e) => /\/_lab\/motion\.js/.test(e.name)), null, 3000);
      await until(p, () => document.getElementById('vid').currentTime > 1, null, 4000);
      if (!(await p.evaluate(() => document.getElementById('vid').readyState >= 2))) {
        console.log(`skip ${eng.padEnd(8)} (this engine can't play the WebM)`);
        continue;
      }
      // Paused, then a pin on it: the box's line is live and names the keys while the box has the cursor.
      await p.mouse.move(700, 700);
      await p.keyboard.press('ArrowRight'); // pauses (3a)
      await settled(p);
      const r = await p.evaluate(() => document.getElementById('vid').getBoundingClientRect().toJSON());
      await p.mouse.click(r.left + 200, r.top + 150);
      await until(p, (src) => Boolean(new Function(`return ${src}`)()?.querySelector('.float textarea')), ROOT, 3000);
      await p.keyboard.type('the logo comes in');
      const line0 = await inRoot(p, "r.querySelector('.float .moment.live')?.textContent || ''");
      const keysShown = await inRoot(p, "getComputedStyle(r.querySelector('.float .moment.live'), '::after').content.includes('frame')");
      check(eng, 'the new box has a live moment line, and it names the keys while typing', /^video .* · frame \d+$/.test(line0) && keysShown, JSON.stringify({ line0, keysShown }));
      const f0 = await frame(p);
      await p.keyboard.press('Control+ArrowRight');
      await settled(p);
      await p.keyboard.press('Alt+.'); // ⌥ > (Leo, 23 Nov)
      await settled(p);
      await sleep(100);
      const f1 = await frame(p);
      const words = await inRoot(p, "r.querySelector('.float textarea')?.value");
      const line1 = await inRoot(p, "r.querySelector('.float .moment.live')?.textContent || ''");
      check(eng, '⌃→ and ⌥. step the video two frames; the words stay', f1 === f0 + 2 && words === 'the logo comes in', JSON.stringify({ f0, f1, words }));
      check(eng, 'the line follows the step', line1.endsWith(`· frame ${f1}`), line1);
      await p.keyboard.down('Control');
      await sleep(50);
      const moreShown = await inRoot(p, "getComputedStyle(r.querySelector('.float .moment.live'), '::after').content.includes('second')");
      await p.keyboard.up('Control');
      check(eng, 'holding ⌃ names the rest', moreShown);
      await p.keyboard.press('Enter');
      let c;
      for (let i = 0; i < 30 && !(c = (await comments()).find((x) => !x.parent)); i++) await sleep(100);
      check(eng, 'the pin keeps the frame the line ended on', c?.anchor?.moment?.frame === f1 && c.anchor.moment.fps === 30, JSON.stringify(c?.anchor?.moment));
      // A reply: its box has the line too, and the reply keeps its own frame.
      for (let i = 0; i < 40 && (await inRoot(p, "Boolean(r.querySelector('.card:not(.out)'))")); i++) await sleep(100);
      await p.keyboard.press('Escape');
      await sleep(300);
      const pin = await inRoot(p, "r.querySelector('.pin')?.getBoundingClientRect().toJSON()");
      await p.mouse.click(pin.left + pin.width / 2, pin.top + pin.height / 2);
      await until(p, (src) => Boolean(new Function(`return ${src}`)()?.querySelector('.card .foot .moment.live')), ROOT, 3000);
      await inRoot(p, "r.querySelector('.card textarea')?.focus()");
      await p.keyboard.type('and here');
      for (let i = 0; i < 5; i++) {
        await p.keyboard.press('Control+ArrowRight');
        await settled(p);
      }
      await sleep(100);
      const f2 = await frame(p);
      await p.keyboard.press('Enter');
      let rep;
      for (let i = 0; i < 30 && !(rep = (await comments()).find((x) => x.parent)); i++) await sleep(100);
      check(eng, 'the reply keeps its own frame', rep?.moment?.frame === f2 && f2 === f1 + 5 && rep.text === 'and here', JSON.stringify({ m: rep?.moment, f2, text: rep?.text }));
      await sleep(300);
      const shown = await inRoot(p, "[...r.querySelectorAll('.card .when .moment')].map((n) => n.textContent)");
      check(eng, 'the thread shows each message\'s moment', shown.length === 2 && shown[1].endsWith(`frame ${f2}`), JSON.stringify(shown));
      const text = await (await fetch(`${B}/_lab/agent${PG}`)).text();
      check(eng, 'the agent reads the reply\'s moment', new RegExp(`\\(at video [\\d:.]+ of [\\d:]+ · frame ${f2}\\): and here`).test(text), text.split('\n').find((l) => /and here/.test(l)));
      // ⌃K plays from the reply box.
      await inRoot(p, "r.querySelector('.card textarea')?.focus()");
      await p.keyboard.press('Control+k');
      await sleep(300);
      check(eng, '⌃K plays it', !(await p.evaluate(() => document.getElementById('vid').paused)));
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
