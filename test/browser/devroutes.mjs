// An app behind --proxy (a dev server) in real browsers (WebKit and Chrome's engine), from what the torture test found on
// real dev servers: after the app navigates itself (history.pushState, back) the pins shown, and the page a new pin is saved
// on, follow the address (14); <html> gets no class of the widget's, which a framework that hydrates it (Next) reports (18);
// a reload while the dev server is down leaves the page where it is and goes on when the server is back, not on the lab's
// plain 502 (19); no favicon request ends in a 404 in the console (20).
// Not part of `npm test`; CI runs it in the `browser` job. Run: node test/browser/devroutes.mjs (needs playwright;
// NODE_PATH can point at a node_modules that has it). One line per check; exits 1 if any fails.
import fs from 'node:fs';
import http from 'node:http';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });

const DIR = fs.realpathSync(tmp('labit-devroutes-'));
const PORT = claimPort(10800, 60);
const APP_PORT = PORT + 60;
const B = `http://localhost:${PORT}`;
fs.writeFileSync(`${DIR}/labit.json`, JSON.stringify({ port: PORT }));
// One page for every route, as an app with a client-side router serves it; no icon at /favicon.ico.
const app = http.createServer((req, res) => {
  if (req.url === '/favicon.ico') return void res.writeHead(404).end('no');
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><meta charset="utf-8"><title>app</title><body><h1 id="t">App</h1><p id="p">Some words to pin.</p></body>');
});
const appUp = () => new Promise((done) => app.listen(APP_PORT, done));
const appDown = () => new Promise((done) => (app.close(done), app.closeAllConnections()));
await appUp();
const server = startLab(DIR, labEnv(), { args: ['--proxy', String(APP_PORT)] });
await labUp(B);
const until = async (ok, ms = 6000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await ok().catch(() => false)) return true;
  return false;
};
const seed = (page, text) =>
  fetch(`${B}/_lab/api/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: B },
    body: JSON.stringify({ page, name: 'Leo', text, anchor: { selector: '#p', x: 0.2, y: 0.5, docX: 0.2, docY: 20, width: 1000, element: '<p id="p">' } }),
  }).then((r) => r.json());
const saved = async (page) => (await (await fetch(`${B}/_lab/api/comments?page=${encodeURIComponent(page)}`)).json()).comments.map((c) => c.text);
// How many pins the page shows (-1 before the widget is there).
const pins = (p) => p.evaluate(() => [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot.querySelectorAll('.pin').length ?? -1);
const shows = (p, n) => pins(p).then((c) => c === n);

try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    // Routes of this engine's own (the lab is shared): one pin on the first, two on the second.
    const [one, two] = [`/${eng}-one`, `/${eng}-two`];
    await seed(one, 'first route note');
    await seed(two, 'second route note');
    await seed(two, 'second route other note');
    try {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await ctx.addInitScript(() => {
        localStorage.setItem('lab-name', 'leo');
        // Every change to <html>'s own attributes, from the first moment: a framework hydrating the page sees these.
        window.__htmlChanges = [];
        new MutationObserver((m) => m.forEach((r) => r.target === document.documentElement && window.__htmlChanges.push(r.attributeName))).observe(document, { attributes: true, subtree: true });
      });
      const p = await ctx.newPage();
      const bad = [];
      p.on('console', (m) => m.type() === 'error' && bad.push(m.text()));
      p.on('response', (r) => r.status() >= 400 && bad.push(`${r.status()} ${r.url()}`));
      await p.goto(B + one);
      await until(() => shows(p, 1));

      // ---- 18: <html> is left as the page has it ----
      const html = await p.evaluate(() => ({ cls: document.documentElement.className, changes: window.__htmlChanges.length, host: Boolean(document.querySelector('[data-lab-comments][data-lab-pinning]')), cursor: getComputedStyle(document.getElementById('p')).cursor }));
      check(eng, '<html> gets no class and no attribute from comment mode', html.cls === '' && html.changes === 0, JSON.stringify(html));
      check(eng, '...and comment mode still shows its crosshair on the page', html.host && html.cursor === 'crosshair', JSON.stringify(html));

      // ---- 20: no icon at the app: the lab answers, nothing is a 404 ----
      const icon = await p.evaluate(() => fetch('/favicon.ico').then((r) => [r.status, r.headers.get('content-type')]));
      check(eng, 'no favicon at the app: labit\'s mark, no 404 anywhere', icon[0] === 200 && /svg/.test(icon[1]) && bad.length === 0, `${JSON.stringify(icon)} ${JSON.stringify(bad)}`);

      // ---- 14: the app navigates by itself ----
      await p.evaluate((to) => history.pushState({}, '', to), two);
      check(eng, 'pushState to another route: that route\'s two pins, not the first one\'s', await until(() => shows(p, 2)), String(await pins(p)));
      await p.mouse.click(60, 120);
      await sleep(300);
      await p.keyboard.type(`new on the second route in ${eng}`);
      await p.keyboard.press('Enter');
      const there = await until(async () => (await saved(two)).some((t) => t.includes(`second route in ${eng}`)));
      check(eng, 'a new pin is saved on the route the address shows', there && !(await saved(one)).some((t) => t.includes('second route in')), `${JSON.stringify(await saved(two))} ${JSON.stringify(await saved(one))}`);
      await p.keyboard.press('Escape');
      await p.goBack();
      check(eng, 'back: the first route\'s one pin again', await until(() => shows(p, 1)), String(await pins(p)));
      await p.goForward();
      check(eng, 'forward: the second route\'s three pins', await until(() => shows(p, 3)), String(await pins(p)));

      // ---- 19: a reload with the dev server down stays on the page, then goes on when it is back ----
      await p.goto(B + one);
      await until(() => shows(p, 1));
      await p.evaluate(() => {
        window.__kept = 1;
        document.querySelector('script[data-live]').dataset.widget = 'older'; // a new widget script is waiting: the page reloads
      });
      await appDown();
      await seed(one, `another note in ${eng}`); // the lab sends its state again, and the page tries to reload
      await sleep(3500);
      const stay = await p.evaluate(() => ({ kept: window.__kept, text: document.body.innerText.slice(0, 40) }));
      check(eng, 'dev server down: the page is not replaced by the lab\'s 502 text', stay.kept === 1 && !/no answer/.test(stay.text), JSON.stringify(stay));
      await appUp();
      check(eng, 'dev server back: the page reloads by itself, with its widget', await until(() => p.evaluate(() => window.__kept === undefined && Boolean(document.querySelector('[data-lab-comments]'))), 10000));
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  await appDown().catch(() => {});
  await sleep(100);
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
}
finish('all ok');
