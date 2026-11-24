// Try co-labit on this computer: npm run build:co, then node co/dev.mjs [port]
// A demo page with the script on it, the comments API with an in-memory store, and invite links to open.
import http from 'node:http';
import fs from 'node:fs';
import { GET, POST, OPTIONS, inviteKey, useRedis } from './api/comments.mjs';
import { memoryRedis } from './memory.mjs';

process.env.CO_SECRET ||= 'dev-secret';
useRedis(memoryRedis());
const port = Number(process.argv[2]) || 4600;
const page = (title) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>
<body style="font: 16px/1.5 system-ui; max-width: 40rem; margin: 3rem auto; padding: 0 1rem">
<h1>${title}</h1><p>A page on one of your sites. Comments show only for people with an invite link.</p>
<p><a href="/">home</a> · <a href="/about">about</a></p>
<script src="/co.js" data-site="demo" defer></script>`;

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/co.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(fs.readFileSync(new URL('./public/co.js', import.meta.url)));
  if (url.pathname === '/api/comments') {
    const body = req.method === 'POST' ? Buffer.concat(await Array.fromAsync(req)) : undefined;
    const request = new Request(url, { method: req.method, headers: req.headers, body });
    const out = await (req.method === 'GET' ? GET : req.method === 'POST' ? POST : OPTIONS)(request);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    return res.end(Buffer.from(await out.arrayBuffer()));
  }
  res.writeHead(200, { 'content-type': 'text/html' }).end(page(url.pathname === '/' ? 'Home' : url.pathname.slice(1)));
}).listen(port, () => {
  console.log(`you (owner): http://localhost:${port}/#co=${inviteKey('You', true)}`);
  console.log(`a guest:     http://127.0.0.1:${port}/#co=${inviteKey('Anna')}`);
});
