// The first comments made on a page just after it opened reach it live, without a reload. Before 24 Nov the lab sent
// the new comments version once with no pages changed (the first comment on a page notes its file in between), the
// page skipped it, and the next change fetched only what came after: a question's root never showed, so neither did
// its pin. Also a state that comes before the page's own list is in: what is newer than the list is fetched.
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });
const DIR = tmp('labit-first-');
const PORT = claimPort(8950, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);
const admin = () => JSON.parse(fs.readFileSync(path.join(DIR, '.lab/server.json'), 'utf8')).agent;
const post = (body) => fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lab-admin': admin(), 'x-lab-agent': '1' }, body: JSON.stringify(body) }).then((r) => r.json());
const anchor = { selector: '#a', x: 0.5, y: 0.5, docX: 0.5, docY: 20, width: 1000, element: '<p id="a">' };
try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    for (const [delay, tabs] of [[300, 1], [600, 1], [600, 2], [1500, 1]]) {
      const pg = `/first-${eng}-${delay}-${tabs}`;
      fs.writeFileSync(path.join(DIR, `${pg.slice(1)}.html`), '<!doctype html><title>a</title><p id="a">Some words here.</p>');
      const ctx = await browser.newContext();
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'leo'); localStorage.setItem('lab-on', '1'); });
      if (tabs === 2) await (await ctx.newPage()).goto(B + '/'); // another tab holds the live stream, this one listens to it
      const q = await ctx.newPage();
      await q.goto(B + pg);
      await sleep(delay);
      const root = (await post({ page: pg, name: 'leo', text: 'which reads best?', anchor })).comment;
      await post({ page: pg, name: 'Claude', text: 'Which?', parent: root.id, choices: ['A', 'B'], recommend: 0 });
      let shown = false;
      for (let i = 0; i < 40 && !shown; i++, await sleep(200)) shown = Boolean(await q.evaluate(() => [...document.querySelectorAll('*')].find((x) => x.shadowRoot?.querySelector('.scrim'))?.shadowRoot.querySelector('button.pin')));
      check(eng, `a question made ${delay} ms after the page opened${tabs === 2 ? ' (another tab holds the stream)' : ''} shows its pin, no reload`, shown);
      await ctx.close();
    }
    await browser.close();
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
}
finish();
