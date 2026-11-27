// A page behind a dev server can sit in a frame: the lab drops the dev server's x-frame-options (and its content
// security policy) on pages, and leaves other files as they are.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { claimPort, tmp, rm, spawnLab, up as answers } from './harness.mjs';

const DIR = tmp('frames');
const UP = claimPort(9500, 100);
const PORT = claimPort(9650, 100);
const B = `http://localhost:${PORT}`;
const guard = { 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" };
const upstream = http
  .createServer((q, r) =>
    q.url === '/app.js'
      ? r.writeHead(200, { 'content-type': 'text/javascript', ...guard }).end('1')
      : r.writeHead(200, { 'content-type': 'text/html', ...guard }).end('<!doctype html><html><body><h1>dev</h1></body></html>'),
  )
  .listen(UP);
const server = spawnLab(DIR, PORT, { args: ['--proxy', String(UP)] });
after(() => {
  server.kill();
  upstream.close();
  rm([DIR]);
});
const up = () => answers(B + '/_lab/state');

test('a proxied page can be framed; other files keep their headers', async () => {
  await up();
  const page = await fetch(B + '/', { headers: { accept: 'text/html' } });
  assert.equal(page.headers.get('x-frame-options'), null);
  assert.equal(page.headers.get('content-security-policy'), null);
  assert.match(await page.text(), /_lab\/comments\.js/);
  const js = await fetch(B + '/app.js');
  assert.equal(js.headers.get('x-frame-options'), 'DENY');
});
