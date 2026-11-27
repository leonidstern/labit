// Action buttons in real browsers (WebKit and Chrome's engine): a click on a data-lab-action button opens
// a new comment on it with its words in the box, the button's own click doesn't run, the sent pin carries the action
// (and "confirm first" for data-lab-confirm) to the agent; a phone's tap does the same; with comments off the button is the page's own.
// Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/actions.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });

const env = labEnv();
const PAGE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>a</title><h1>PRs</h1>' +
  '<p>#224 <button id="merge" data-lab-action="merge #224" data-lab-confirm onclick="document.title=\'ran\'">merge</button>' +
  ' <button id="explain" data-lab-action="explain #224" data-lab-action-note="in two lines">explain</button></p>';
const labs = [];
const lab = async () => {
  const dir = fs.realpathSync(tmp('labit-actions-'));
  const port = claimPort(7400, 400);
  fs.writeFileSync(path.join(dir, 'index.html'), PAGE);
  fs.writeFileSync(path.join(dir, 'labit.json'), JSON.stringify({ port }));
  labs.push({ dir, server: startLab(dir, env) });
  const b = `http://localhost:${port}`;
  await labUp(b);
  return b;
};
const boxText = (p) => p.evaluate(() => [...document.querySelectorAll('[data-lab-comments]')].map((n) => n.shadowRoot?.querySelector('.float textarea')?.value).find((v) => v !== undefined) ?? null);

try {
  for (const eng of engines()) {
    const B = await lab(); // a lab per engine: no pin from the other one
    const browser = await pw[eng].launch();
    try {
      for (const phone of [true, false]) // the phone first: it sends nothing, so no pin stands over a button
        for (const id of ['explain', 'merge']) {
          const tag = phone ? `${eng}/ph` : eng;
          const ctx = await browser.newContext(phone ? { ...pw.devices['iPhone 13'], defaultBrowserType: undefined } : { viewport: { width: 1000, height: 700 } });
          await ctx.addInitScript(() => (localStorage.setItem('lab-name', 'zz'), localStorage.setItem('lab-on', '1'), localStorage.setItem('lab-hint-seen', '1')));
          const p = await ctx.newPage();
          await p.goto(B + '/');
          await sleep(1200);
          await (phone ? p.tap(`#${id}`) : p.click(`#${id}`));
          await sleep(400);
          if (id === 'explain') check(tag, 'explain opens the box with its words and note', (await boxText(p)) === 'explain #224\nin two lines', String(await boxText(p)));
          else {
            check(tag, "merge opens the box, the button's own click doesn't run", (await boxText(p)) === 'merge #224' && (await p.title()) === 'a', await p.title());
            if (phone) {
              await ctx.close();
              continue;
            }
            const sent = p.waitForRequest((r) => r.url().endsWith('/_lab/api/comments') && r.method() === 'POST');
            await p.evaluate(() => [...document.querySelectorAll('[data-lab-comments]')].map((n) => n.shadowRoot?.querySelector('.float .send')).find(Boolean)?.click());
            const body = (await sent).postDataJSON();
            check(tag, 'the pin carries the action and confirm', body.text === 'merge #224' && body.anchor.act === 'merge #224' && body.anchor.confirm === true, JSON.stringify({ t: body.text, a: body.anchor.act, c: body.anchor.confirm }));
            await sleep(500);
            const agent = await (await fetch(`${B}/_lab/agent${body.page}`)).text();
            check(tag, 'the agent reads the action and confirm first', /action: merge #224 — confirm first: say what will happen and wait for the person's ✓/.test(agent), agent.slice(0, 300));
          }
          await ctx.close();
        }
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await ctx.addInitScript(() => (localStorage.setItem('lab-name', 'zz'), localStorage.setItem('lab-on', '0')));
      const p = await ctx.newPage();
      await p.goto(B + '/');
      await sleep(1200);
      await p.click('#merge');
      await sleep(400);
      check(eng, 'comments off: the button is the page\'s own', (await p.title()) === 'ran' && (await boxText(p)) === null);
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  for (const l of labs) {
    l.server.kill();
    fs.rmSync(l.dir, { recursive: true, force: true, maxRetries: 5 });
  }
}
finish();
