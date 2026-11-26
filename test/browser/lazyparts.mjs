// The motion menu is its own file (public/_lab/motion.js), fetched only when the page uses it. A page with nothing that
// moves never asks for it, headings or no; a looping animation or a video bring it; P or S bring motion on a still page, ⌥ no longer does; a pin with a moment brings it too.
// Not part of `npm test`. Run: node test/browser/lazyparts.mjs (NODE_PATH to a playwright). ENGINES picks the engines.
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();

const DIR = fs.realpathSync(tmp('labit-lazy-'));
const PORT = claimPort(8300, 50);
const B = `http://localhost:${PORT}`;
const write = (f, t) => fs.writeFileSync(path.join(DIR, f), t);
const page = (body, head = '') => `<!doctype html><meta charset="utf-8"><title>t</title><link rel="stylesheet" href="/_lab/lab.css"><style>@keyframes spin { to { rotate: 1turn } }${head}</style><body>${body}</body>`;
const sec = (t) => `<section><h2>${t}</h2><p>Words of ${t}.</p></section>`;
write('labit.json', JSON.stringify({ port: PORT }));
write('still.html', page('<h1>Plan</h1><p>Only words.</p>'));
write('sections.html', page(`<h1>Plan</h1>${sec('Speed')}${sec('Cost')}${sec('Risk')}`));
write('moving.html', page('<h1>Plan</h1><div id="spin" style="width:40px;height:40px;background:#333;animation:spin 1s linear infinite"></div>'));
write('video.html', page('<h1>Plan</h1><video muted loop autoplay playsinline width="120"></video>'));
write('script.html', page('<h1>Plan</h1><div id="box" style="margin:60px;width:60px;height:60px;background:#333"></div>').replace('</body>', '<script>setTimeout(() => document.getElementById("box").animate([{ translate: "0" }, { translate: "40px" }], { duration: 900, iterations: Infinity }), 2000)</script></body>'));
const server = startLab(DIR, labEnv(), { port: PORT });
await labUp(B);

try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await ctx.addInitScript(() => localStorage.setItem('lab-name', 'zz-lazy'));
      // The parts a page asked for, after it has settled.
      const asked = async (file, ms = 2600) => {
        const p = await ctx.newPage();
        const got = [];
        p.on('request', (r) => /\/_lab\/(sections|motion)\.js/.test(r.url()) && got.push(r.url().match(/(sections|motion)/)[1]));
        await p.goto(`${B}/${file}`);
        await sleep(ms);
        return { p, got: [...new Set(got)].sort().join('+') || 'none' };
      };
      const is = (name, got, want) => check(eng, name, got === want, got);

      const still = await asked('still.html');
      is('a page with nothing moving asks for nothing', still.got, 'none');
      is('a page with 3 sections asks for nothing', (await asked('sections.html')).got, 'none');
      is('a page with a looping animation asks for motion only', (await asked('moving.html')).got, 'motion');
      is('a page with a video asks for motion only', (await asked('video.html')).got, 'motion');

      // Still page: ⌥ is for commenting only (Leo, 23 Nov: the motion menu is a right-click), so it asks for nothing.
      await still.p.bringToFront();
      await still.p.keyboard.down('Alt');
      await sleep(600);
      await still.p.keyboard.up('Alt');
      await sleep(200);
      const gotAlt = await still.p.evaluate(() => performance.getEntriesByType('resource').some((e) => /\/_lab\/motion\.js/.test(e.name)));
      check(eng, 'on a still page, ⌥ asks for nothing', !gotAlt);
      await still.p.close();

      // An animation a script starts late (no event says so), on a page that has asked for nothing so far: the pointer
      // moving over it brings motion, and a right-click on it opens its menu.
      const script = await ctx.newPage();
      await script.goto(`${B}/script.html`);
      await sleep(2300);
      const at = await script.evaluate(() => { const r = document.getElementById('box').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await script.mouse.move(at.x - 5, at.y);
      await script.mouse.move(at.x, at.y);
      for (let i = 0; i < 20 && !(await script.evaluate(() => performance.getEntriesByType('resource').some((e) => /\/_lab\/motion\.js/.test(e.name)))); i++) await sleep(50);
      await sleep(200);
      await script.mouse.click(at.x, at.y, { button: 'right' });
      await sleep(200);
      const shown = await script.evaluate(() => { const m = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot.querySelector('.motion-menu'); return Boolean(m && !m.hidden); });
      check(eng, 'a script-started animation: the pointer over it brings motion, and a right-click opens its menu', shown);
      await script.close();

      const keys = await ctx.newPage();
      await keys.goto(`${B}/still.html`);
      await sleep(1500);
      await keys.keyboard.press('s');
      await sleep(800);
      check(eng, 'on a still page, S asks for motion and slows (the next pin says so)', await keys.evaluate(() => performance.getEntriesByType('resource').some((e) => /\/_lab\/motion\.js/.test(e.name))));
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
finish();
