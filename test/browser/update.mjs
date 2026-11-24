// A newer release in real browsers (WebKit and Chrome's engine): a lab run from npm offers it as "update" at the foot of
// the ⋯ menu, for this computer's browser only (a page without the lab's key has none), and pressing it asks the agent
// in the chat: a page comment "update labit to <version>" carrying the action. Nothing updates from the page itself.
// Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/update.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });

const DIR = tmp('labit-upd-');
const HOME = tmp('labit-home-');
const PORT = claimPort(7940, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><meta charset="utf-8"><title>u</title><h1 id="t">Update</h1><p>text</p>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
// npm's newest, as the lab's daily check keeps it: newer than any labit, so this lab has one to offer.
fs.writeFileSync(path.join(HOME, 'latest.json'), JSON.stringify({ version: '9.9.9', at: Date.now() }));
// npx stand-in that says it was asked: the page must never run it.
const NPX = path.join(HOME, 'npx');
fs.writeFileSync(NPX, `#!/bin/sh\necho "$2" > "${path.join(HOME, 'asked')}"\n`, { mode: 0o755 });
const server = startLab(DIR, labEnv({ LABIT_HOME: HOME, LABIT_NO_UPDATE_CHECK: '', LABIT_OFFER_UPDATE: '1', LABIT_NPX: NPX }));
// The offer is in the page once the lab has looked for what changed (a few seconds at most, offline).
let offered = false;
for (let i = 0; i < 100 && !offered; i++) {
  try {
    offered = /data-update=/.test(await (await fetch(B + '/')).text());
  } catch {}
  if (!offered) await sleep(100);
}
const comments = async () => (await (await fetch(B + '/_lab/api/comments?page=/index')).json()).comments;

try {
  check('lab', 'the lab offers 9.9.9 in the page', offered);
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await ctx.addInitScript(() => {
        localStorage.setItem('lab-name', 'tester');
        localStorage.setItem('lab-on', '1');
      });
      const r = (p) => p.evaluateHandle(() => [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.more-menu'))?.shadowRoot);
      const openMenu = async (p) =>
        (await r(p)).evaluate(async (root) => {
          root.querySelector('.more').click();
          await new Promise((res) => setTimeout(res, 300));
          const m = root.querySelector('.more-menu');
          const b = m.querySelector('.labit-version .update-btn');
          return { open: !m.hidden, version: m.querySelector('.labit-version')?.textContent || '', btn: b?.textContent || '', title: b?.title || '' };
        });

      // A guest: the same page without the lab's key (data-admin), as a browser on another device gets it.
      const guest = await ctx.newPage();
      await guest.route(B + '/', async (route) => {
        const res = await route.fetch();
        route.fulfill({ response: res, body: (await res.text()).replace(/ data-admin="[^"]*"/, '') });
      });
      await guest.goto(B + '/');
      await sleep(1500);
      const g = await openMenu(guest);
      check(eng, "a guest's ⋯ menu has the version line", g.open && /labit /.test(g.version), g.version);
      check(eng, 'and no update in it', !g.btn, JSON.stringify(g));
      await guest.close();

      // This computer's browser: update beside the version.
      const p = await ctx.newPage();
      await p.goto(B + '/');
      await sleep(1500);
      const own = await openMenu(p);
      check(eng, "the owner's ⋯ menu offers update to 9.9.9", own.open && own.btn === 'update' && /9\.9\.9/.test(own.title), JSON.stringify(own));
      const before = (await comments()).length;
      const sent = p.waitForRequest((q) => q.url().endsWith('/_lab/api/comments') && q.method() === 'POST', { timeout: 5000 }).catch(() => null);
      const after = await (await r(p)).evaluate(async (root) => {
        root.querySelector('.labit-version .update-btn')?.click();
        await new Promise((res) => setTimeout(res, 800));
        return { menuOpen: !root.querySelector('.more-menu').hidden };
      });
      const req = await sent;
      const body = req ? JSON.parse(req.postData() || '{}') : {};
      check(eng, 'pressing it posts a chat comment asking the agent', body.text === 'update labit to 9.9.9' && body.anchor?.kind === 'page' && body.anchor?.act === 'update labit to 9.9.9', JSON.stringify(body));
      check(eng, 'and closes the menu', !after.menuOpen);
      const list = await comments();
      const saved = list.find((c) => c.text === 'update labit to 9.9.9' && !c.parent);
      check(eng, 'the lab keeps it, with the action', list.length === before + 1 && saved?.anchor?.kind === 'page' && saved?.anchor?.act === 'update labit to 9.9.9', JSON.stringify(saved));
      check(eng, 'nothing updated from the page', !fs.existsSync(path.join(HOME, 'asked')));
      await p.goto('about:blank');
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
  fs.rmSync(HOME, { recursive: true, force: true, maxRetries: 5 });
}
finish();
