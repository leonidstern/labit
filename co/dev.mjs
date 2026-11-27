// Try your colabit on this computer: node co/dev.mjs [port]
// The lab on <port>, as Vercel runs it: /_lab/co.js, the comments API (an in-memory store) and each person's path from
// co/vercel.json, proxied to their site. With no one added yet, a demo site on <port + 1> stands in as /demo.
import http from 'node:http';
import fs from 'node:fs';
import { GET, POST, OPTIONS, useRedis } from './api/comments.mjs';
import { memoryRedis } from './memory.mjs';

process.env.LAB_COMMENTS_ADMIN_TOKEN ||= 'dev-admin';
useRedis(memoryRedis());
const port = Number(process.argv[2]) || 4600;
const lab = `http://localhost:${port}`;

// Each person: /<name> and /<name>/… go to their site (co/vercel.json, written by co/colabit.mjs).
const people = new Map();
for (const r of JSON.parse(fs.readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')).rewrites || []) {
  const name = /^\/([a-z0-9][a-z0-9-]*)$/.exec(r.source)?.[1];
  if (name) people.set(name, r.destination.replace(new RegExp(`/${name}$`), ''));
}
if (!people.size) {
  const demo = port + 1;
  people.set('demo', `http://localhost:${demo}`);
  const page = (title) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>
<body style="font: 16px/1.5 system-ui; max-width: 40rem; margin: 3rem auto; padding: 0 1rem">
<h1>${title}</h1><p>A page on Demo's site, built under the base path /demo.</p>
<p><a href="/demo">home</a> · <a href="/demo/about">about</a></p>
<script src="${lab}/_lab/co.js" data-site="lab" defer></script>`;
  http.createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(page(req.url === '/demo' ? 'Home' : req.url.split('/').pop()))).listen(demo);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, lab);
  if (url.pathname === '/_lab/co.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(fs.readFileSync(new URL('./co.js', import.meta.url)));
  if (url.pathname === '/_lab/co/comments') {
    const body = req.method === 'POST' ? Buffer.concat(await Array.fromAsync(req)) : undefined;
    const out = await (req.method === 'GET' ? GET : req.method === 'POST' ? POST : OPTIONS)(new Request(url, { method: req.method, headers: req.headers, body }));
    res.writeHead(out.status, Object.fromEntries(out.headers));
    return res.end(Buffer.from(await out.arrayBuffer()));
  }
  const to = people.get(url.pathname.split('/')[1]);
  if (!to) return res.writeHead(404, { 'content-type': 'text/plain' }).end(`No one at this path. People: ${[...people.keys()].map((n) => '/' + n).join(', ')}`);
  // The way it was asked: a form's POST goes on as a POST, with its body and type.
  const sends = req.method !== 'GET' && req.method !== 'HEAD';
  const body = sends ? Buffer.concat(await Array.fromAsync(req)) : undefined;
  const got = await fetch(to + url.pathname + url.search, { method: req.method, body, headers: sends && req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {} }).catch(() => null);
  if (!got) return res.writeHead(502).end(`${to} did not answer`);
  res.writeHead(got.status, { 'content-type': got.headers.get('content-type') || 'text/html' });
  res.end(Buffer.from(await got.arrayBuffer()));
}).listen(port, () => {
  const first = [...people.keys()][0];
  console.log(`you (owner): ${lab}/${first}#lab-admin=${process.env.LAB_COMMENTS_ADMIN_TOKEN}`);
  console.log(`a guest:     http://127.0.0.1:${port}/${first}`);
});
