// colabit stays off on a page a labit lab serves (src/comments.js, lib/colabit.ts): where the lab's widget tag or its
// reload holder (window.__lab) is, colabit's script draws nothing and says so in the console, also when the page adds
// colabit's script by itself, after the lab took its tag out. On a page of its own, colabit starts as always.
// Not part of `npm test`; CI runs it in the `browser` job. Run: node test/browser/colabitoff.mjs (needs playwright).
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { playwright, engines, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });
const CO = fs.readFileSync(fileURLToPath(new URL('../../co/co.js', import.meta.url)));
const page = (body) => `<!doctype html><meta charset="utf-8"><title>c</title><h1 id="t">Hello</h1>${body}`;
const PAGES = {
  '/own': page('<script src="/_lab/co.js" data-site="demo" defer></script>'),
  '/lab': page('<script src="/_lab/co.js" data-site="demo" defer></script><script src="/_lab/comments.js" defer></script>'),
  '/hold': page('<script>window.__lab = { writing: 0, held: [] };</script><script src="/_lab/co.js" data-site="demo" defer></script>'),
  '/added': page('<script src="/_lab/comments.js" defer></script><script>addEventListener("load", () => { const s = document.createElement("script"); s.src = "/_lab/co.js"; s.dataset.site = "demo"; document.body.append(s); });</script>'),
};
// A plain server, no lab: colabit's script, an empty stand-in for the lab's widget, and an empty comment list.
const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  if (p === '/_lab/co.js') return void res.writeHead(200, { 'content-type': 'text/javascript' }).end(CO);
  if (p === '/_lab/comments.js') return void res.writeHead(200, { 'content-type': 'text/javascript' }).end('');
  if (p.startsWith('/_lab/co/')) return void res.writeHead(200, { 'content-type': 'application/json' }).end('{"comments":[],"admin":false}');
  if (PAGES[p]) return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGES[p]);
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const B = `http://127.0.0.1:${server.address().port}`;
// Whether colabit drew its layer: an element with a shadow root holding its bar.
const drawn = (p) => p.evaluate(() => [...document.querySelectorAll('*')].some((x) => x.shadowRoot && x.shadowRoot.childElementCount > 0));

try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    for (const [path, on, what] of [
      ['/own', true, 'on a page of its own, colabit starts'],
      ['/lab', false, 'beside the lab\'s widget tag, colabit stays off'],
      ['/hold', false, 'where the lab\'s reload holder is, colabit stays off'],
      ['/added', false, 'added by the page after load, beside the lab\'s widget, colabit stays off'],
    ]) {
      const p = await browser.newPage();
      const said = [];
      p.on('console', (m) => said.push(m.text()));
      await p.goto(B + path);
      await p.waitForTimeout(1200);
      const isOn = await drawn(p);
      const note = said.some((t) => t.includes('[colabit] off'));
      check(eng, what, isOn === on && note === !on, `drawn ${isOn}, note ${note}`);
      await p.close();
    }
    await browser.close();
  }
} finally {
  server.close();
}
finish();
