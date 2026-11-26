// The lab in front of a dev server (--proxy, or a project whose dev server it found). Loaded by local.mjs only then:
// a folder of pages is served from disk and never reads it.
// Pages pass through with the widget added; everything else (scripts, images, the dev server's own live reload
// over a websocket) goes through untouched.
import http from 'node:http';
import net from 'node:net';
import type { IncomingMessage, ServerResponse, OutgoingHttpHeaders } from 'node:http';
import type { Duplex } from 'node:stream';
import { decoderFor } from './dev.ts';
import { isPageLoad } from './pageload.ts';
import { stripTags } from './colabit.ts';

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;

type ProxyOptions = {
  PROXY: URL;
  origin: () => string;
  widget: (key: string, admin: boolean, me: string, framed: boolean, req: IncomingMessage) => string;
  keyFor: (page: string) => string;
  isLoopback: (req: IncomingMessage) => boolean;
  nameFor: (req: IncomingMessage) => string;
  /** Last pass over a page's HTML before it goes out (the lab's reload-holder). */
  dress: (html: string) => string;
};

// PROXY: the dev server's URL. origin(): the lab's own address, known once it listens. widget(page, admin, me, framed, req): the
// script tag that goes into a page. keyFor and isLoopback: the lab's own, so pages get the same keys either way.
// Returns page(req, res, url) for requests and upgrade(req, socket, head) for websockets; who may connect at all
// is checked in local.mjs before either is called.
export function proxy({ PROXY, origin: originNow, widget, keyFor, isLoopback, nameFor, dress }: ProxyOptions) {
  const pageKey = (pathname: string) => keyFor(pathname.replace(/^\/+|\/+$/g, '').replace(/\.html?$/i, '') || 'index');
  // When a page load was first asked for: a dev server that is restarting (a rebuild, a crash and a start) answers a moment
  // later, so a refused page load is asked again for a few seconds before the person is told it is down. Only a GET: it has no body to send twice.
  const tried = new WeakMap<IncomingMessage, number>();
  function proxyTo(req: IncomingMessage, res: ServerResponse, url: URL): void {
    const origin = originNow();
    // Only a page load is asked for uncompressed HTML (the widget goes into it); scripts and styles stay compressed.
    // HTML a script fetches (a fragment, or a whole page for a client router to swap in) is the app's data: left as it is.
    const page = req.method === 'GET' && isPageLoad(req.headers);
    const headers: OutgoingHttpHeaders = { ...req.headers, host: PROXY.host, ...(page ? { 'accept-encoding': 'identity' } : {}) };
    if (headers.origin) headers.origin = PROXY.origin;
    // The lab's own cookie (an id for the browser, local.mjs deviceOf) is not the app's.
    if (headers.cookie) {
      const kept = String(headers.cookie).split(/;\s*/).filter((c) => !/^lab_dev_\d+=/.test(c));
      if (kept.length) headers.cookie = kept.join('; ');
      else delete headers.cookie;
    }
    if (headers.referer) headers.referer = PROXY.origin + new URL(String(headers.referer), origin).pathname;
    const up = http.request({ hostname: PROXY.hostname, port: PROXY.port || 80, path: url.pathname + url.search, method: req.method, headers }, (r) => {
      // No icon at /favicon.ico (a 404, or the app's own page answering any path): the tab wears labit's mark, as a lab's
      // own folder does (local.mjs). The widget asks first so a page that names an icon keeps it; its console stays clean.
      if (url.pathname === '/favicon.ico' && !(r.statusCode! < 300 && /^image\//i.test(r.headers['content-type'] || ''))) {
        r.resume();
        return void res.writeHead(302, { location: '/_lab/favicon.svg' }).end();
      }
      const encoded = r.headers['content-encoding'] && r.headers['content-encoding'] !== 'identity';
      const html = page && /text\/html/i.test(r.headers['content-type'] || '') && !encoded;
      // A redirect to the dev server's own address would take the person off the lab (no widget, no comments).
      // localhost, 127.0.0.1 and [::1] on its port are all it: a server asked for as localhost often redirects to 127.0.0.1.
      const to = r.headers.location && URL.canParse(r.headers.location) ? new URL(r.headers.location) : null;
      if (to && to.protocol === PROXY.protocol && to.port === PROXY.port && (to.host === PROXY.host || (LOCAL.test(to.hostname) && LOCAL.test(PROXY.hostname)))) {
        r.headers.location = origin + to.pathname + to.search + to.hash;
      }
      if (!html) {
        res.writeHead(r.statusCode || 502, r.headers);
        return void r.pipe(res);
      }
      // The page is read in the charset the dev server named and goes on as UTF-8, so the header says so.
      const type = r.headers['content-type'] || '';
      const out = { ...r.headers, 'content-type': type.replace(/;\s*charset=[^;]*/i, '') + '; charset=utf-8', 'cache-control': 'no-store' };
      delete out['content-length'];
      delete out['content-encoding'];
      delete out['content-security-policy']; // it would block the widget's script
      delete out['x-frame-options']; // it would leave a page blank when it sits in a frame (a board)
      // The cookies the lab set on this answer (its own, a guest's) go out with the app's.
      const ours = res.getHeader('set-cookie');
      if (ours) out['set-cookie'] = [...[ours].flat().map(String), ...(r.headers['set-cookie'] || [])];
      res.writeHead(r.statusCode || 502, out);
      // Streamed through as it arrives (Next, Astro and React stream their pages), so nothing waits for the end.
      // The widget's script goes after the page; a copy of it the page already loads is taken out, and so is colabit's
      // (lib/colabit.ts), even when a tag comes split across two pieces: an unfinished <script tag is held back.
      let decoder: TextDecoder | undefined;
      let held = '';
      // The lab's reload-holder has to be the first script on the page, before the dev server's own client, so it
      // goes into the first piece — the page is streamed, and by the last piece the head is long gone.
      let first = true;
      r.on('data', (chunk: Buffer) => {
        decoder ??= decoderFor(chunk, type);
        let t = held + decoder.decode(chunk, { stream: true });
        if (first) {
          first = false;
          t = dress(t);
        }
        const lower = t.toLowerCase();
        const script = lower.lastIndexOf('<script');
        const tag = t.lastIndexOf('<');
        // Hold back an unfinished <script>…</script>, or any tag not closed yet; send the rest now.
        const cut = script !== -1 && lower.indexOf('</script>', script) === -1 ? script : tag > t.lastIndexOf('>') ? tag : t.length;
        res.write(stripTags(t.slice(0, cut)));
        held = t.slice(cut);
      });
      r.on('end', () => {
        const tail = stripTags(held + (decoder?.decode() ?? '')) + widget(pageKey(url.pathname), isLoopback(req), nameFor(req), req.headers['sec-fetch-dest'] === 'iframe', req);
        // A page that arrived in one piece never saw a data event with a head in it; dress it here instead.
        res.end(first ? dress(tail) : tail);
      });
      r.on('error', () => res.destroy());
    });
    up.on('error', (e: NodeJS.ErrnoException) => {
      if (res.headersSent) return void res.destroy();
      const since = tried.get(req) ?? Date.now();
      tried.set(req, since);
      if (page && e.code === 'ECONNREFUSED' && Date.now() - since < 5000 && !res.destroyed) return void setTimeout(() => proxyTo(req, res, url), 100);
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }).end(`[lab] no answer from the dev server at ${PROXY.origin} (${e.code}). Start it, then reload.`);
    });
    // The person left (a closed tab, a cancelled event stream): the dev server's side ends too, not held open for good.
    res.on('close', () => res.writableFinished || up.destroy());
    req.pipe(up);
  }
  function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const up = net.connect(Number(PROXY.port) || 80, PROXY.hostname, () => {
      const lines: string[] = [];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const [k, v] = [req.rawHeaders[i], req.rawHeaders[i + 1]];
        lines.push(`${k}: ${/^host$/i.test(k) ? PROXY.host : /^origin$/i.test(k) ? PROXY.origin : v}`);
      }
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`);
      if (head?.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  }
  return { page: proxyTo, upgrade };
}
