// Local lab for the benchmark: serves public/ and bench/site at /bench, runs the comments API (lib/comments-api.mjs) with an in-memory store.
// BENCH_SITE and BENCH_AT serve another folder at another path (bench/situations.mjs: bench/situations at /sit).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { apiOn, callApi, sendFile } from '../lib/dev.ts';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
process.env.LAB_COMMENTS_ADMIN_TOKEN ??= 'admintoken';
const api = await apiOn(new Map());
const port = Number(process.env.PORT || 4321);
const SITE = path.resolve(REPO, process.env.BENCH_SITE || 'bench/site');
const AT = process.env.BENCH_AT || '/bench';
export const ready = new Promise((r) => (globalThis.__ready = r));
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/_lab/api/comments' || url.pathname.startsWith('/_lab/agent/')) {
      const target = new URL(url);
      if (url.pathname.startsWith('/_lab/agent/')) {
        target.search = `?format=text&page=${encodeURIComponent(url.pathname.slice('/_lab/agent'.length))}`;
      }
      const out = api[req.method] ? await callApi(api[req.method], req, target) : new Response('method not allowed', { status: 405 });
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(Buffer.from(await out.arrayBuffer()));
      return;
    }
    const bench = url.pathname === AT || url.pathname.startsWith(AT + '/');
    const root = bench ? SITE : path.join(REPO, 'public');
    let file = path.join(root, decodeURIComponent(bench ? url.pathname.slice(AT.length) || '/' : url.pathname));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
    if (!fs.existsSync(file)) { res.writeHead(404).end('not found'); return; }
    sendFile(req, res, file);
  } catch (e) {
    console.error(e);
    if (res.headersSent) res.destroy();
    else res.writeHead(500).end(String(e));
  }
}).listen(port, () => { console.log(`http://localhost:${port}${AT}/`); globalThis.__ready(); });
