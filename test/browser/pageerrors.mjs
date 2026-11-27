// What goes wrong on a page reaches the agent: an uncaught error, a picture that failed to load, a rejected promise, and the
// agent's text for that page says so. The widget's own work is not the page's.
// Run: node test/browser/pageerrors.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();
const DIR = tmp('labit-pageerrors-');
const PORT = claimPort(10800, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'index.html'), `<!doctype html><meta charset="utf-8"><title>t</title><h1>Page</h1>
<script>
setTimeout(() => { throw new Error('boom from the page'); }, 200);
setTimeout(() => Promise.reject(new Error('rejected on purpose')), 300);
setTimeout(() => document.body.append(Object.assign(new Image(), { src: '/late-missing.png' })), 400);
</script>`);
fs.writeFileSync(path.join(DIR, 'clean.html'), '<!doctype html><meta charset="utf-8"><title>c</title><h1>Clean</h1>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);
try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 900, height: 600 } });
      await ctx.addInitScript(() => localStorage.setItem('lab-name', 'tester'));
      const pg = await ctx.newPage();
      await pg.goto(B + '/');
      await sleep(2500); // the widget posts a second after the last one
      const text = await (await fetch(`${B}/_lab/agent/index`)).text();
      const line = text.match(/^Page errors .*$/m)?.[0] || '';
      check(eng, 'an uncaught error reaches the agent, with where', /boom from the page \(page:3\)/.test(line), line);
      check(eng, 'a picture that failed to load after the page was up', /failed to load .*late-missing\.png/.test(line), line);
      check(eng, 'a rejected promise', /unhandled rejection: rejected on purpose/.test(line), line);
      check(eng, 'nothing of the widget\'s own', !/_lab\//.test(line.replace(/failed to load [^|]*/g, '')), line);
      const clean = await ctx.newPage();
      await clean.goto(B + '/clean.html');
      await sleep(2200);
      check(eng, 'a clean page says nothing', !/Page errors/.test(await (await fetch(`${B}/_lab/agent/clean`)).text()));
      await pg.reload();
      await sleep(600);
      const again = (await (await fetch(`${B}/_lab/agent/index`)).text()).match(/^Page errors .*$/m)?.[0] || '';
      check(eng, 'a reload starts the list again (the errors come again once)', (again.match(/boom from the page/g) || []).length <= 1, again);
    } finally {
      await browser.close();
    }
  }
  finish();
} finally {
  server.kill();
}
