// Pause, comment, the moment kept (Leo, 19 Nov): a pin written while the page is paused carries where the paused thing
// stood (a CSS loop's second inside one pass and which pass, a video's time; a GIF how long it had been showing), shows
// it as a quiet line while written and under the sent pin's first message (Leo, 23 Nov), the page stays paused after sending, and the chip on a pin takes the
// page back to that moment. In WebKit and Chrome's engine. Not part of `npm test`.
// Run: node test/browser/moment.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();

const MEDIA = fileURLToPath(new URL('../../bench/', import.meta.url));
const DIR = tmp('labit-moment-');
const PORT = claimPort(7960, 30);
const B = `http://localhost:${PORT}`;
fs.copyFileSync(path.join(MEDIA, 'site/media/countdown.webm'), path.join(DIR, 'v.webm'));
fs.copyFileSync(path.join(MEDIA, 'situations/media/b2-sync.gif'), path.join(DIR, 'g.gif'));
// As on the lab's page (canvas-proposals#moment): a track holding a 4 s loop, a pulsing dot, a video and a GIF side by
// side in one row, so a pin on each must take its own motion, not its neighbour's.
const PAGE = `<!doctype html><meta charset="utf-8"><title>m</title>
<style>@keyframes slide { to { translate: 200px } } @keyframes pulse { 50% { scale: 1.25 } }
body { margin: 20px; font: 16px sans-serif } .demo { display: flex; flex-wrap: wrap; gap: 16px; align-items: center }
#track { width: 400px; height: 100px; padding: 10px; box-sizing: border-box; background: #eee }
#loop { width: 60px; height: 60px; background: #333; animation: slide 4s linear infinite }
#dot { width: 24px; height: 24px; border-radius: 50%; background: #888; animation: pulse 1.5s ease-in-out infinite }
video, img { display: block; width: 200px }</style>
<h1>Moment</h1><div class="demo"><div id="track"><div id="loop"></div></div><div id="dot"></div><video id="vid" src="v.webm" muted loop autoplay playsinline></video><img id="gif" src="g.gif" alt="gif"></div><p>text</p>`;
// One page per engine: the pins of one never sit under the clicks of the other.
for (const eng of ['webkit', 'chromium']) for (const n of ['', '-b', '-c']) fs.writeFileSync(path.join(DIR, `${eng}${n}.html`), PAGE);
const server = startLab(DIR, labEnv(), { port: PORT });
await labUp(B);
const until = (p, fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms, polling: 'raf' }).catch(() => {});
const ROOT = "[...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot";
const inRoot = (p, js) => p.evaluate(`(() => { const r = ${ROOT}; return ${js}; })()`);
let PG = '/webkit';
const comments = async () => (await (await fetch(`${B}/_lab/api/comments?page=${PG}`)).json()).comments;
const loopState = (p) => p.evaluate(() => { const a = document.getElementById('loop').getAnimations()[0]; return { play: a.playState, t: Number(a.currentTime) }; });

try {
  for (const eng of engines()) {
    PG = `/${eng}`;
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
      await ctx.addInitScript(() => localStorage.setItem('lab-name', 'zz-moment'));
      const p = await ctx.newPage();
      await p.goto(B + PG);
      await until(p, () => performance.getEntriesByType('resource').some((e) => /\/_lab\/motion\.js/.test(e.name)), null, 3000);
      await until(p, () => document.getElementById('vid').currentTime > 0.5, null, 4000);
      await sleep(1200);
      const videoOk = await p.evaluate(() => document.getElementById('vid').readyState >= 2);
      // A loop that has been going a long while (Leo's 835734 ms): the moment is inside one pass, and which pass.
      await p.evaluate(() => (document.getElementById('loop').getAnimations()[0].currentTime = 835734));
      await p.keyboard.press('p');
      await until(p, () => document.getElementById('loop').getAnimations()[0]?.playState === 'paused', null, 1000);
      // A pin on the loop: the chip while writing, the moment in the payload.
      const pin = async (id, words, fx = 0, fy = 0.75) => {
        const r = await p.evaluate((i) => (document.getElementById(i).scrollIntoView({ block: 'center' }), document.getElementById(i).getBoundingClientRect().toJSON()), id);
        await sleep(300);
        const open = async () => {
          for (let i = 0; i < 20 && !(await inRoot(p, "Boolean(r.querySelector('.float textarea'))")); i++) await sleep(100);
        };
        // A busy machine: a click as the last card goes can be taken by it; click again.
        for (let i = 0; i < 3 && !(await inRoot(p, "Boolean(r.querySelector('.float textarea'))")); i++) {
          if (i) await sleep(500);
          if (await inRoot(p, "Boolean(r.querySelector('.card:not(.out)'))")) { // a card in the way: let it go first
            await inRoot(p, 'r.activeElement?.blur()');
            await p.keyboard.press('Escape');
            await sleep(400);
          }
          await p.mouse.click(fx ? r.left + r.width * fx : r.left + Math.min(20, r.width / 2), r.top + r.height * fy);
          await open();
        }
        const chip = await inRoot(p, "r.querySelector('.float .moment')?.textContent || ''");
        await p.keyboard.type(words);
        await p.keyboard.press('Enter');
        let c;
        for (let i = 0; i < 30 && !(c = (await comments()).find((x) => x.text === words)); i++) await sleep(100);
        // The sent card (with its undo) closes on its own after 3 s; the next pin waits for it.
        for (let i = 0; i < 40 && (await inRoot(p, "Boolean(r.querySelector('.card:not(.out)'))")); i++) await sleep(100);
        // Touched meanwhile, it stays open: its pin closes it.
        const openPin = await inRoot(p, "r.querySelector('.pin.open')?.getBoundingClientRect().toJSON()");
        if (openPin && (await inRoot(p, "Boolean(r.querySelector('.card:not(.out)'))"))) await p.mouse.click(openPin.left + openPin.width / 2, openPin.top + openPin.height / 2);
        for (let i = 0; i < 3 && (await inRoot(p, "Boolean(r.querySelector('.card:not(.out)'))")); i++) {
          await inRoot(p, 'r.activeElement?.blur()'); // Escape closes it, once no box holds the keys
          await p.keyboard.press('Escape');
          await sleep(300);
        }
        await sleep(1000); // the card's way out and the undo's end settle before the next press
        return { chip, c };
      };
      const before = await loopState(p);
      const loop = await pin('loop', 'on the loop');
      const m = loop.c?.anchor?.moment;
      const want = (before.t % 4000) / 1000;
      check(eng, 'the box says the loop\'s moment in a quiet line (every kind, Leo 23 Nov)', /^loop [\d.]+ of 4 s · pass \d+$/.test(loop.chip), loop.chip);
      check(eng, 'the pin carries the loop\'s second inside one pass and its pass', m?.kind === 'loop' && m.of === 4 && Math.abs(m.at - want) < 0.11 && m.pass === Math.floor(before.t / 4000) + 1 && /loop/.test(m.what || ''), JSON.stringify({ m, want, t: before.t }));
      check(eng, 'the page stays paused after sending', (await loopState(p)).play === 'paused');
      // The track's empty end, the dot: each its own motion.
      const track = await pin('track', 'on the track', 0.95, 0.5);
      const tm = track.c?.anchor?.moment;
      check(eng, 'a pin on the track (no motion of its own but the loop inside) takes the loop', tm?.kind === 'loop' && tm.sel === '#loop' && tm.of === 4 && /^loop /.test(track.chip), JSON.stringify({ tm, chip: track.chip }));
      const dot = await pin('dot', 'on the dot', 0.5, 0.5);
      const dm = dot.c?.anchor?.moment;
      check(eng, 'a pin on the dot takes the dot\'s own loop, not its neighbour\'s', dm?.kind === 'loop' && dm.sel === '#dot' && dm.of === 1.5 && /^loop [\d.]+ of 1\.5 s/.test(dot.chip), JSON.stringify({ dm, chip: dot.chip }));
      const gif = await pin('gif', 'on the gif');
      check(eng, 'a pin on a GIF keeps how long it had been showing, said in its line', gif.c?.anchor?.moment?.kind === 'gif' && /^GIF [\d.]+ s after it showed$/.test(gif.chip), JSON.stringify({ m: gif.c?.anchor?.moment, chip: gif.chip }));
      let vidPin = null;
      if (videoOk) {
        const vt = await p.evaluate(() => { const v = document.getElementById('vid'); return { t: v.currentTime, d: v.duration, paused: v.paused }; });
        const vid = await pin('vid', 'on the video');
        const vm = vid.c?.anchor?.moment;
        vidPin = { vm };
        check(eng, 'a pin on the paused video carries its time and length', vt.paused && vm?.kind === 'video' && Math.abs(vm.at - vt.t) < 0.11 && Math.abs(vm.of - vt.d) < 0.11 && /^video \d:\d\d\.\d of \d:\d\d( · frame \d+)?$/.test(vid.chip), JSON.stringify({ vm, vt, chip: vid.chip }));
      } else console.log(`skip ${eng.padEnd(8)} video (this engine can't play the WebM)`);
      const page = await pin('loop', 'second on the loop');
      check(eng, 'pause, comment, again: the second pin has the same moment', page.c?.anchor?.moment?.at === m?.at, JSON.stringify(page.c?.anchor?.moment));
      // The agent's text says it in words.
      const text = await (await fetch(`${B}/_lab/agent${PG}`)).text();
      check(eng, 'the agent reads the moment in words', /page paused at loop [\d.]+ of 4 s · pass \d+ \(div#loop\)/.test(text), text.split('\n').find((l) => /paused/.test(l)));
      // Play on, then the sent pin's moment takes the page back to it: a quiet line under its first message (Leo, 23 Nov).
      await p.keyboard.press('p');
      await until(p, () => document.getElementById('loop').getAnimations()[0]?.playState === 'running', null, 1000);
      await sleep(900);
      await p.reload();
      await until(p, (src) => Boolean(new Function(`return ${src}`)()?.querySelectorAll('.pin').length >= 3), ROOT, 8000);
      await sleep(300);
      const near = async (id) => {
        const r = await p.evaluate((i) => document.getElementById(i).getBoundingClientRect().toJSON(), id);
        // The pins nearest the thing, in order: on a busy machine (eight jobs at once) the nearest may still be settling,
        // so a card that does not open is closed and the next one tried.
        return inRoot(p, `[...r.querySelectorAll('.pin')].map((n) => n.getBoundingClientRect().toJSON()).sort((a, b) => Math.hypot(a.left - ${r.left + 20}, a.bottom - ${r.top + r.height / 2}) - Math.hypot(b.left - ${r.left + 20}, b.bottom - ${r.top + r.height / 2})).slice(0, 4)`);
      };
      const openNear = async (id, sel) => {
        for (const pinBox of await near(id)) {
          await p.mouse.click(pinBox.left + pinBox.width / 2, pinBox.top + pinBox.height / 2);
          if (await until(p, (src) => Boolean(new Function(`return ${src}`)()?.querySelector('.card .body')), ROOT, 3000) && (!sel || (await inRoot(p, `Boolean(r.querySelector(${JSON.stringify(sel)}))`)))) return true;
          await p.keyboard.press('Escape');
          await sleep(300);
        }
        return false;
      };
      await openNear('loop', '.card .msg .when button.moment');
      const loopLine = await inRoot(p, "r.querySelector('.card .msg .when button.moment')?.textContent || ''");
      check(eng, 'the sent pin on the loop shows its moment under the first message', /^loop [\d.]+ of 4 s · pass \d+$/.test(loopLine), loopLine);
      await inRoot(p, "r.querySelector('.card .msg .when button.moment')?.click()");
      await sleep(300);
      const loopBack = await loopState(p);
      check(eng, 'clicked, the loop goes back to that moment, paused', loopBack.play === 'paused' && Math.abs(((loopBack.t % 4000) / 1000) - m?.at) < 0.11, JSON.stringify({ loopBack, at: m?.at }));
      await p.keyboard.press('p');
      await p.keyboard.press('Escape');
      await sleep(300);
      if (videoOk) {
        const got = await openNear('vid', '.card .msg .when button.moment');
        const shown = await inRoot(p, "r.querySelector('.card .msg .when button.moment')?.textContent || ''");
        check(eng, 'the sent pin on the paused video shows its moment', got && /^video \d:\d\d\.\d of \d:\d\d( · frame \d+)?$/.test(shown), shown);
        await p.evaluate(() => { const v = document.getElementById('vid'); v.play?.(); });
        await sleep(500);
        await inRoot(p, "r.querySelector('.card button.moment').click()");
        await sleep(300);
        const back = await p.evaluate(() => { const v = document.getElementById('vid'); return { paused: v.paused, t: v.currentTime }; });
        check(eng, 'its chip pauses the page at that moment', back.paused && Math.abs(back.t - vidPin.vm.at) < 0.11, JSON.stringify({ back, at: vidPin.vm?.at }));
      }
      // The other ways (Leo, 19 Nov: "it says only if i pause one"). Nothing paused: a pin on a moving thing still
      // keeps the moment it showed as the pin went down, said "at …", with no ⏸.
      PG = `/${eng}-c`;
      await p.goto(B + PG);
      await until(p, () => performance.getEntriesByType('resource').some((e) => /\/_lab\/motion\.js/.test(e.name)), null, 3000);
      await sleep(1200);
      const cDot = await pin('dot', 'moving dot', 0.5, 0.5);
      const cdm = cDot.c?.anchor?.moment;
      check(eng, 'nothing paused: a pin on the dot keeps its moment, "at …"', cdm?.kind === 'loop' && cdm.sel === '#dot' && cdm.playing === true && /^at loop /.test(cDot.chip) && !cDot.c?.anchor?.paused, JSON.stringify({ cdm, chip: cDot.chip }));
      const cTrack = await pin('track', 'moving track', 0.95, 0.5);
      check(eng, 'nothing paused: a pin on the track keeps the loop\'s moment', cTrack.c?.anchor?.moment?.sel === '#loop' && cTrack.c.anchor.moment.playing === true && /^at loop /.test(cTrack.chip), JSON.stringify({ m: cTrack.c?.anchor?.moment, chip: cTrack.chip }));
      if (videoOk) {
        const cVid = await pin('vid', 'moving video');
        check(eng, 'nothing paused: a pin on the video keeps its time', cVid.c?.anchor?.moment?.kind === 'video' && cVid.c.anchor.moment.playing === true && /^at video /.test(cVid.chip), JSON.stringify({ m: cVid.c?.anchor?.moment, chip: cVid.chip }));
      }
      const text2 = await (await fetch(`${B}/_lab/agent${PG}`)).text();
      check(eng, 'the agent reads a moving moment as such', /moment: at loop [\d.]+ of 1\.5 s · pass \d+ \(div#dot\) \(it was moving/.test(text2), text2.split('\n').find((l) => /moment:/.test(l)));
      // One thing paused from its menu (a right-click): a pin on it has its paused moment, a pin on the dot beside it its
      // moving one.
      PG = `/${eng}-b`;
      await p.goto(B + PG);
      await until(p, () => performance.getEntriesByType('resource').some((e) => /\/_lab\/motion\.js/.test(e.name)), null, 3000);
      await sleep(800);
      const lr2 = await p.evaluate(() => document.getElementById('loop').getBoundingClientRect().toJSON());
      await p.mouse.click(lr2.left + 10, lr2.bottom - 10, { button: 'right' });
      await sleep(200);
      await inRoot(p, "[...r.querySelectorAll('.motion-menu button')].find((b) => b.textContent === 'pause')?.click()");
      await until(p, () => document.getElementById('loop').getAnimations()[0]?.playState === 'paused', null, 1000);
      await sleep(400);
      const bLoop = await pin('loop', 'one paused loop', 0, 0.85);
      const blm = bLoop.c?.anchor?.moment;
      check(eng, 'one paused: a pin on it has its paused moment', blm?.sel === '#loop' && !blm.playing && /^loop /.test(bLoop.chip), JSON.stringify({ blm, chip: bLoop.chip }));
      const bDot = await pin('dot', 'dot beside it', 0.5, 0.5);
      check(eng, 'one paused: a pin on the dot beside it has the dot\'s moving moment', bDot.c?.anchor?.moment?.sel === '#dot' && bDot.c.anchor.moment.playing === true && /^at loop /.test(bDot.chip), JSON.stringify({ m: bDot.c?.anchor?.moment, chip: bDot.chip }));
      await ctx.close();
      const key = JSON.parse(fs.readFileSync(path.join(DIR, '.lab/server.json'), 'utf8')).agent;
      for (const c of (await comments()).filter((c) => !c.parent)) await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-admin': key, 'x-lab-agent': '1' }, body: JSON.stringify({ page: PG, action: 'delete', id: c.id }) });
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
}
finish();
