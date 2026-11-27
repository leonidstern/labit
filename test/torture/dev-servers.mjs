// Area 4, REAL DEV SERVERS: the lab in front of a real framework's dev server (Vite, Vite + React, Vite + Vue, Astro,
// webpack-dev-server, Next.js, a plain static server), each on a small project of its own (dev-servers-templates.mjs).
// A case starts one dev server and one lab in front of it (`labit . --proxy <port>`, or with no flag: the lab finds
// it), opens the pages on a laptop and a phone, and does a random list of steps: source files saved, saved in bursts,
// broken and fixed, routes made, deleted and renamed, pins and replies through the widget and the API, reloads,
// links, the dev server restarted under the lab, the lab restarted over the dev server, an agent that waits and
// answers, the same request asked directly and through the lab, the dev server's own live-reload socket.
//
// The oracle is this file's own model, never the lab's bookkeeping:
//  - the disk: every file a step saves holds one version token, and a page must show the tokens of the files its
//    route uses (dev-servers-templates.mjs says which mark shows which file);
//  - a control: in a real-browser case the same page is open a second time straight on the dev server (no lab), gets
//    the same clicks and reloads, and says what the framework does by itself. Only what goes wrong through the lab
//    and right on the control is counted against the lab;
//  - the same request asked of the dev server directly: an answer through the lab must be the dev server's, byte for
//    byte (a page: the same bytes plus the widget and the reload holder);
//  - the comments said yes to (ids from 2xx answers), each on the page whose address the device showed.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Lab, Device, rq, agentRq, runCli, sleep, until, LAN, writeAtomicly, diffComments } from './lib.mjs';
import { FRAMEWORKS, ensureInstalled, isInstalled, projectFiles, homeOf, binOf, CACHE } from './dev-servers-templates.mjs';

export const name = 'dev-servers';
/** A case may take this long (a dev server's start, real browsers, two restarts): run.mjs reads it. */
export const caseMs = 240000;
/** At most this many more runs to make a failing case smaller (a case takes ~20 s): run.mjs reads it. */
export const shrinkBudget = 6;
const TOK = (n) => `v${String(n).padStart(7, '0')}`;
// How the cases are shared among the frameworks.
const WEIGHTS = [[20, 'vite'], [22, 'react'], [18, 'astro'], [14, 'webpack'], [12, 'next'], [8, 'vue'], [6, 'static']];
export const FRAMEWORK_NAMES = WEIGHTS.map(([, f]) => f);
const SESSION = { id: 'sess-dev-servers', name: 'sA', agent: 'Claude', kind: 'claude' };
const SIGNED = 'Claude · sA';

// ---------- before a run: the installs, and how many cases at once ----------
const failedInstall = new Map();
/** Installs what the run's frameworks need (once per machine: see dev-servers-templates.mjs). */
export async function prepare(opts) {
  const list = opts.frameworks?.length ? opts.frameworks : FRAMEWORK_NAMES;
  const missing = list.filter((f) => !isInstalled(f));
  if (missing.length) console.error(`dev-servers: installing ${missing.join(', ')} into ${CACHE} (once; later runs use it)`);
  const out = await ensureInstalled(list, (m) => console.error(`dev-servers: ${m}`));
  for (const [fw, r] of Object.entries(out)) if (!r.ok) (failedInstall.set(fw, r.error), console.error(`dev-servers: could not install ${fw}: ${r.error}`));
}
// Dev servers are heavy: at most this many cases of this area run at once, whatever --concurrency says.
let slots = null;
const waiting = [];
/** A turn to run a case; the function it gives ends the turn. */
export async function gate(opts) {
  slots ??= Math.max(1, Number(opts.devConcurrency) || 5);
  if (slots > 0) slots--;
  else await new Promise((r) => waiting.push(r));
  return () => (waiting.length ? waiting.shift()() : slots++);
}
/** What a replay line needs besides the seed, so the same seed makes the same case. */
export const replayFlags = (opts) => (opts.frameworks?.length ? ` --frameworks ${opts.frameworks.join(',')}` : '');

// Every case's project folder, removed when the case ends and when the run ends in any way.
const liveDirs = new Set();
process.on('exit', () => {
  for (const d of liveDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {}
  }
});

// ---------- the plan ----------
export function plan(rng, opts) {
  const roll = rng.float();
  const engine = rng.pick(['chromium', 'webkit']);
  const allowed = opts.frameworks?.length ? WEIGHTS.filter(([, f]) => opts.frameworks.includes(f)) : WEIGHTS;
  const fw = rng.weighted(allowed);
  const F = FRAMEWORKS[fw];
  // Real browsers in ~40% of the cases (the widget on a real framework's page is the point); --browser-share 1 on a replay.
  const share = opts.browserShare >= 1 ? 1 : (opts.devBrowserShare ?? 0.4);
  const browser = opts.browser && roll < share ? engine : null;
  const detect = rng.bool(0.1); // the lab is started with no --proxy: it has to find the dev server itself
  const csp = Boolean(F.csp) && rng.bool(0.3);
  const favicon = rng.bool(0.85); // most projects have a tab icon; some have none
  const routes = Object.keys(F.pages);
  const devices = [{ kind: 'laptop', name: 'Leo', route: 'home' }, { kind: 'phone', name: 'Mira', route: rng.pick(routes) }];
  const cli = rng.bool(0.3); // the agent speaks through `labit wait` / `labit reply`, or the same API
  const ops = [];
  let r = 0;
  let n = 0; // versions made so far
  const push = (op, same = false) => ops.push({ ...op, r: same && r ? r : ++r });
  const files = ['comp', 'mod', 'css', ...routes.map((x) => `page:${x}`)];
  const breakable = [...(F.comp.broken ? ['comp'] : []), ...(F.mod.broken ? ['mod'] : []), ...(F.pageBroken ? routes.map((x) => `page:${x}`) : [])];
  const edit = (file = rng.pick(files)) => ({ t: 'edit', file, how: rng.weighted([[6, 'write'], [4, 'atomic']]), tok: TOK(++n) });
  const threads = []; // steps that make a thread
  const extras = new Set();
  let extraN = 0;
  const word = () => rng.pick(['tighten this', 'more room here', 'wrong colour', 'typo', 'make it bold', 'move left', 'too long', 'why this?']);
  const pin = (d = rng.int(2), more = {}) => {
    push({ t: 'pin', d, via: d === 0 ? rng.weighted([[6, 'widget'], [4, 'api']]) : 'api', on: rng.weighted([[7, 'anchor-a'], [3, 'tok-page']]), slot: threads.length % 8, text: `m${ops.length} ${word()}`, ...more });
    threads.push(ops.length - 1);
  };
  const fill = () => {
    const what = rng.weighted([[5, 'edit'], [2, 'burst'], [1, 'wait']]);
    if (what === 'edit') push(edit());
    else if (what === 'wait') push({ t: 'wait', ms: rng.pick([100, 400, 900]) });
    else for (let j = 0, f = rng.pick(files), m = rng.between(3, 6); j < m; j++) push(edit(rng.bool(0.7) ? f : rng.pick(files)), j > 0);
  };
  const block = (what) => {
    if (what === 'edit') push(edit());
    else if (what === 'burst') for (let j = 0, f = rng.pick(files), m = rng.between(3, 6); j < m; j++) push(edit(rng.bool(0.7) ? f : rng.pick(files)), j > 0);
    else if (what === 'break') {
      if (!breakable.length) return push(edit());
      const file = rng.pick(breakable);
      push({ t: 'break', file, tok: TOK(++n) });
      for (let j = rng.int(3); j--; ) push(rng.bool(0.6) ? edit(rng.pick(files.filter((f) => f !== file))) : { t: 'wait', ms: 500 });
      push({ t: 'fix', file, how: 'write', tok: TOK(++n) });
    } else if (what === 'pin') pin();
    else if (what === 'reply') {
      if (!threads.length) return pin();
      const d = rng.int(2);
      push({ t: 'reply', d, to: rng.pick(threads), via: d === 0 && rng.bool(0.5) ? 'widget' : 'api', text: `m${ops.length} ${word()}` });
    } else if (what === 'resolve') {
      if (!threads.length) return pin();
      push({ t: 'resolve', to: rng.pick(threads) });
    } else if (what === 'agent') {
      // A pin, a moment for the lab to hand it to the wait, the agent's answer.
      if (!threads.length || rng.bool(0.5)) pin(0);
      push({ t: 'wait', ms: 500 });
      push({ t: 'areply', to: rng.pick(threads), intent: rng.weighted([[5, null], [3, 'done'], [2, 'question']]), text: `a${ops.length} answer` });
    } else if (what === 'reload') {
      push({ t: 'reload', d: rng.int(2), hard: rng.bool(0.4) });
      if (rng.bool(0.3)) push(edit(), true); // a save while the page loads
    } else if (what === 'nav') {
      if (routes.length < 2) return push(edit());
      push({ t: 'nav', d: rng.int(2), to: rng.pick(routes) });
    } else if (what === 'back') push({ t: 'back', d: rng.int(2) });
    else if (what === 'draft') {
      push({ t: 'draft', on: true, text: `draft ${ops.length} kept` });
      for (let j = rng.between(1, 2); j--; ) fill();
      push({ t: 'draft', on: false, send: rng.bool(0.4) });
    } else if (what === 'count') push({ t: 'count', d: rng.int(2), k: rng.between(1, 3) });
    else if (what === 'dev-restart') push({ t: 'dev-restart', sig: fw === 'next' || fw === 'astro' ? 'SIGTERM' : rng.pick(['SIGTERM', 'SIGTERM', 'SIGKILL']), down: rng.pick([0, 300, 1200]), tok: rng.bool(0.5) ? TOK(++n) : null, file: rng.pick(files) });
    else if (what === 'lab-restart') push({ t: 'lab-restart', sig: rng.pick(['SIGTERM', 'SIGTERM', 'SIGKILL']) });
    else if (what === 'fetch') push({ t: 'fetch', seed: rng.int(1e9), n: rng.between(2, 5) });
    else if (what === 'ws') {
      if (!F.hmr) return push({ t: 'fetch', seed: rng.int(1e9), n: 3 });
      push({ t: 'ws', tok: TOK(++n), from: rng.bool(0.3) ? 'lan' : 'local' });
    } else if (what === 'route') {
      // A route's own file made, pinned on, then renamed, or deleted and made again, or saved.
      if (!F.newRoute) return push(edit());
      const k = ++extraN;
      push({ t: 'route-new', n: k, tok: TOK(++n) });
      extras.add(k);
      push({ t: 'pin-route', n: k, text: `m${ops.length} on the new route` });
      if (rng.bool(0.5)) push({ t: 'goto', d: rng.int(2), n: k });
      const then = rng.weighted([[4, 'mv'], [3, 'recreate'], [2, 'edit'], [1, 'del']]);
      if (then === 'mv') (push({ t: 'route-mv', n: k, to: ++extraN }), extras.delete(k), extras.add(extraN));
      else if (then === 'recreate') (push({ t: 'route-del', n: k }), push({ t: 'wait', ms: rng.pick([0, 200, 1200]) }), push({ t: 'route-new', n: k, tok: TOK(++n) }));
      else if (then === 'edit') push({ t: 'edit', file: `extra:${k}`, how: 'write', tok: TOK(++n) });
      else (push({ t: 'route-del', n: k }), extras.delete(k));
    } else if (what === 'wait') push({ t: 'wait', ms: rng.pick([100, 400, 900]) });
  };
  // Both devices open first (the phone a little later in some cases, while steps already run).
  push({ t: 'open', d: 0 });
  const phoneLater = rng.bool(0.35);
  if (!phoneLater) push({ t: 'open', d: 1 }, true);
  // Every case has these; the rest is drawn.
  const must = ['burst', 'dev-restart', 'lab-restart', 'agent', ...(phoneLater ? ['open-phone'] : [])];
  const table = [[18, 'edit'], [5, 'burst'], [8, 'break'], [12, 'pin'], [6, 'reply'], [4, 'resolve'], [4, 'agent'], [6, 'reload'], [12, 'nav'], [3, 'back'], [5, 'draft'], [5, 'count'], [2, 'dev-restart'], [2, 'lab-restart'], [8, 'fetch'], [5, 'ws'], [7, 'route'], [3, 'wait']];
  const drawn = Array.from({ length: rng.between(6, 12) }, () => rng.weighted(table));
  for (const what of rng.shuffle([...must, ...drawn])) {
    if (what === 'open-phone') push({ t: 'open', d: 1 });
    else block(what);
  }
  return { kind: fw, fw, browser, detect, csp, favicon, cli, devices, ops };
}
export const planLine = (p) => `${p.fw}${p.csp ? ' with a Content-Security-Policy header' : ''}${p.favicon ? '' : ' with no favicon'}; the lab ${p.detect ? 'finds the dev server itself' : 'is given --proxy'}; d0 laptop on home, d1 phone on ${p.devices[1].route}${p.browser ? ` (both real ${p.browser}, and a control tab straight on the dev server)` : ' (raw clients)'}; the agent ${p.cli ? 'runs labit wait / reply' : 'speaks the API'}`;
export const describe = (op) =>
  !op ? '(left out)'
  : op.t === 'open' ? `d${op.d} opens its page`
  : op.t === 'edit' ? `${op.how} ${op.file} [${op.tok}]`
  : op.t === 'break' ? `${op.file} saved with a syntax error [${op.tok}]`
  : op.t === 'fix' ? `${op.file} fixed [${op.tok}]`
  : op.t === 'pin' ? `d${op.d} pins on #${op.on} (${op.via}) ${JSON.stringify(op.text)}`
  : op.t === 'pin-route' ? `a pin on the route extra${op.n} (API)`
  : op.t === 'reply' ? `d${op.d} replies in the thread of step ${op.to} (${op.via})`
  : op.t === 'resolve' ? `d0 resolves or reopens the thread of step ${op.to}`
  : op.t === 'areply' ? `the agent answers step ${op.to}${op.intent ? ` --${op.intent}` : ''}`
  : op.t === 'reload' ? `d${op.d} reloads${op.hard ? ' (address opened again)' : ''}`
  : op.t === 'nav' ? `d${op.d} clicks the link to ${op.to}`
  : op.t === 'back' ? `d${op.d} goes back`
  : op.t === 'goto' ? `d${op.d} opens the route extra${op.n}`
  : op.t === 'draft' ? (op.on ? `d0 opens a new comment and types ${JSON.stringify(op.text)}` : `d0 ${op.send ? 'sends' : 'closes'} its draft`)
  : op.t === 'count' ? `d${op.d} clicks the page's counter ${op.k} times`
  : op.t === 'dev-restart' ? `the dev server stops (${op.sig}), ${op.down} ms${op.tok ? `, ${op.file} saved meanwhile [${op.tok}]` : ''}, starts again`
  : op.t === 'lab-restart' ? `the lab restarts (${op.sig}), the dev server stays`
  : op.t === 'fetch' ? `${op.n} requests asked directly and through the lab`
  : op.t === 'ws' ? `the dev server's live-reload socket, directly and through the lab (${op.from}), with a save of comp [${op.tok}]`
  : op.t === 'route-new' ? `a new route file extra${op.n} [${op.tok}]`
  : op.t === 'route-del' ? `the route file extra${op.n} deleted`
  : op.t === 'route-mv' ? `the route file extra${op.n} renamed to extra${op.to}`
  : op.t === 'wait' ? `wait ${op.ms} ms`
  : JSON.stringify(op);

// ---------- plain requests, with the bytes as they came ----------
function ask({ port, host = 'localhost', name: hostName, method = 'GET', path: p, headers = {}, body, timeout = 10000 }) {
  return new Promise((resolve) => {
    const fail = (e) => resolve({ status: 0, error: String(e?.code || e?.message || e), headers: {}, raw: Buffer.alloc(0), buf: Buffer.alloc(0) });
    const req = http.request({ host, port, path: p, method, agent: false, timeout, headers: { host: hostName || `localhost:${port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', fail);
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let buf = raw;
        try {
          const enc = res.headers['content-encoding'];
          if (raw.length && enc === 'gzip') buf = zlib.gunzipSync(raw);
          else if (raw.length && enc === 'br') buf = zlib.brotliDecompressSync(raw);
          else if (raw.length && enc === 'deflate') buf = zlib.inflateSync(raw);
        } catch {
          buf = null; // the bytes are not what the header says
        }
        resolve({ status: res.statusCode, headers: res.headers, raw, buf });
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', fail);
    req.end(body);
  });
}
const viaLab = (lab, o, from = 'local', cookie = '') => ask({ ...o, port: lab.port, host: from === 'lan' ? LAN : '127.0.0.1', name: `${from === 'lan' ? LAN : 'localhost'}:${lab.port}`, headers: { ...(cookie ? { cookie } : {}), ...o.headers } });

// A websocket as a browser opens one, read frame by frame: { open, status, messages: [{ at, text }], closed, close() }.
function wsOpen({ port, host = 'localhost', name: hostName, path: p, protocol, cookie, ms = 4000 }) {
  return new Promise((resolve) => {
    const w = { open: false, status: 0, messages: [], closed: false, close: () => s.destroy() };
    const s = net.connect({ port, host }, () => {
      s.write(`GET ${p} HTTP/1.1\r\nHost: ${hostName}\r\nOrigin: http://${hostName}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\n${protocol ? `Sec-WebSocket-Protocol: ${protocol}\r\n` : ''}${cookie ? `Cookie: ${cookie}\r\n` : ''}\r\n`);
    });
    let buf = Buffer.alloc(0);
    let head = false;
    let parts = [];
    const timer = setTimeout(() => (head || s.destroy(), resolve(w)), ms);
    const done = () => (clearTimeout(timer), resolve(w));
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!head) {
        const at = buf.indexOf('\r\n\r\n');
        if (at < 0) return;
        w.status = Number(/^HTTP\/1\.1 (\d+)/.exec(buf.subarray(0, at).toString('latin1'))?.[1] || 0);
        head = true;
        buf = buf.subarray(at + 4);
        w.open = w.status === 101;
        done();
        if (!w.open) return void s.destroy();
      }
      for (;;) {
        if (buf.length < 2) return;
        const fin = buf[0] & 0x80;
        const opcode = buf[0] & 0x0f;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          off = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          len = Number(buf.readBigUInt64BE(2));
          off = 10;
        }
        if (buf.length < off + len) return;
        const payload = buf.subarray(off, off + len);
        buf = buf.subarray(off + len);
        if (opcode === 9) s.write(Buffer.from([0x8a, 0x80, 0, 0, 0, 0])); // a pong (no payload) for a ping
        else if (opcode === 8) return void ((w.closed = true), s.destroy());
        else if (opcode <= 2) {
          parts.push(payload);
          if (fin) (w.messages.push({ at: Date.now(), text: Buffer.concat(parts).toString('utf8') }), (parts = []));
        }
      }
    });
    s.on('error', () => ((w.closed = true), done()));
    s.on('close', () => ((w.closed = true), done()));
  });
}
const kindOfMessage = (text) => {
  try {
    const j = JSON.parse(text);
    return String(j.type || j.action || j.event || 'json');
  } catch {
    return 'text';
  }
};

// ---------- the dev server ----------
class Dev {
  constructor(ctx, fw, dir) {
    Object.assign(this, { ctx, fw, dir, F: FRAMEWORKS[fw], port: ctx.port(), proc: null, log: '' });
  }
  get base() {
    return `http://localhost:${this.port}`;
  }
  /** Starts it and waits until its first page answers 200. */
  async start() {
    const [cmd, ...args] = this.F.start(this.port, binOf(this.fw));
    // In a process group of its own, so that everything it starts (Next's server process, esbuild) ends with it.
    const proc = spawn(cmd, args, { cwd: this.dir, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: this.ctx.env({ ...(this.F.env || {}), FORCE_COLOR: '0', NO_COLOR: '1', BROWSER: 'none', CI: '' }) });
    const plain = proc.kill.bind(proc);
    proc.kill = (sig = 'SIGTERM') => {
      try {
        process.kill(-proc.pid, sig);
        return true;
      } catch {
        return plain(sig);
      }
    };
    this.proc = this.ctx.track(proc);
    const take = (d) => (this.log = (this.log + d).slice(-20000));
    proc.stdout.on('data', take);
    proc.stderr.on('data', take);
    let gone = false;
    proc.once('exit', () => (gone = true));
    proc.once('error', () => (gone = true));
    for (const end = Date.now() + (this.F.slowStart || 30000); Date.now() < end; await sleep(100)) {
      if (gone) return false;
      const r = await ask({ port: this.port, path: this.F.pages.home.url, headers: { accept: 'text/html' }, timeout: 20000 });
      if (r.status === 200) return true;
    }
    return false;
  }
  async stop(sig = 'SIGTERM') {
    const p = this.proc;
    if (!p || p.exitCode !== null || p.signalCode !== null) return;
    await new Promise((r) => {
      p.once('exit', r);
      p.kill(sig);
      setTimeout(() => p.kill('SIGKILL'), 4000).unref();
    });
    // The port is free again when nothing answers on it.
    await until(async () => (await ask({ port: this.port, path: '/', timeout: 500 })).status === 0, 3000, 50);
  }
}

// ---------- a real browser as a device ----------
// What a page shows, read in the page: the widget (how many), its pins, the marks, the counter, a draft's words.
const INFO = () => {
  const hosts = [...new Set([...document.querySelectorAll('[data-lab-comments]'), ...[...document.querySelectorAll('*')].filter((n) => n.shadowRoot?.querySelector('.more'))])];
  const r = hosts[0]?.shadowRoot;
  const rect = (e) => {
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return [b.left, b.top, b.width, b.height].map((x) => Math.round(x * 10) / 10);
  };
  const el = (id) => document.getElementById(id);
  const moved = r?.querySelector('.moved-btn');
  return {
    hosts: hosts.length,
    scripts: document.querySelectorAll('script[src*="/_lab/comments.js"]').length,
    pins: r ? [...r.querySelectorAll('button.pin')].map((p) => ({ label: p.getAttribute('aria-label') || '', cls: p.className, rect: rect(p) })) : null,
    moved: moved && !moved.hidden ? moved.textContent.trim() : '',
    els: { 'anchor-a': rect(el('anchor-a')), 'tok-page': rect(el('tok-page')), 'tok-comp': rect(el('tok-comp')) },
    route: el('tok-page')?.dataset.route ?? null,
    v: { page: el('tok-page')?.dataset.v ?? null, comp: el('tok-comp')?.dataset.v ?? null, mod: el('tok-mod')?.dataset.v ?? null, css: getComputedStyle(document.documentElement).getPropertyValue('--v').trim() || null },
    count: el('count')?.textContent ?? null,
    draft: r?.querySelector('.card textarea, .float textarea')?.value ?? null,
    overlay: Boolean(document.querySelector('vite-error-overlay, #webpack-dev-server-client-overlay')),
    url: location.pathname,
    title: document.title,
    text: document.body ? document.body.innerText.slice(0, 140) : '',
  };
};
// What every console error is reduced to before two pages' errors are compared (ports, hosts, hashes and times differ).
const tidyError = (t) => t.replace(/https?:\/\/[^/\s)]+/g, 'ORIGIN').replace(/wss?:\/\/[^/\s)]+/g, 'WS').replace(/[?&](t|v|ts|id|token)=[\w.-]+/g, '').replace(/\d{3,}/g, '#').replace(/\s+/g, ' ').slice(0, 300);
const errorKind = (t) => (/hydrat/i.test(t) ? 'hydration-mismatch' : /status of 404.*\/favicon\.ico/.test(t) ? 'favicon-asked-for-by-the-widget' : /_lab\//.test(t) ? 'the-widget-own-file' : /websocket|wss?:\/\//i.test(t) ? 'websocket' : /content security policy|refused to/i.test(t) ? 'csp' : /status of 5\d\d/.test(t) ? 'http-5xx' : /status of 4\d\d/.test(t) ? 'http-4xx' : 'other');

class Real {
  constructor(o) {
    Object.assign(this, o, { real: true, loads: 0, cloads: 0, errors: [], cerrors: [], navAt: null, draft: null, said: new Set(), page: null, control: null, opened: false });
  }
  /** The page shown was reached by a navigation with no page load (a router's link), and has not loaded since. */
  get clientNav() {
    return this.navAt !== null && this.loads === this.navAt;
  }
  set clientNav(on) {
    this.navAt = on ? this.loads : null;
  }
  watch(page, mine) {
    page.on('load', () => (mine ? this.loads++ : this.cloads++));
    const list = mine ? this.errors : this.cerrors;
    page.on('console', (m) => m.type() === 'error' && list.push({ at: Date.now(), text: `${m.text()} @${m.location()?.url || ''}` }));
    page.on('pageerror', (e) => list.push({ at: Date.now(), text: `uncaught: ${e.message}` }));
  }
  info(control = false) {
    const p = control ? this.control : this.page;
    return p ? p.evaluate(INFO).catch((e) => ({ error: String(e).slice(0, 160) })) : Promise.resolve({ error: 'no page' });
  }
  /** The same thing done on the lab's page and on the control. */
  async both(fn) {
    await fn(this.page).catch((e) => this.note?.(`${this.id}: ${String(e).split('\n')[0].slice(0, 140)}`));
    if (this.control) await fn(this.control).catch(() => {});
  }
  async close() {
    await this.page?.goto('about:blank').catch(() => {});
    await this.control?.goto('about:blank').catch(() => {});
    await this.bctx?.close().catch(() => {});
  }
}
// A raw device (lib.mjs) that follows the comments of its page and leaves the page's own files alone (a framework's
// page loads megabytes of scripts; what they hold is the real browsers' and the direct requests' to judge).
class PageDevice extends Device {
  uses() {
    return [];
  }
}

const ANCHOR = (on, slot = 0) => ({ selector: `#${on}`, x: Math.round((0.06 + slot * 0.05) * 1000) / 1000, y: 0.5, docX: 0.1, docY: 56, width: 1000, kind: 'element', element: on === 'anchor-a' ? '<h1 id="anchor-a">' : `<p id="${on}">`, text: on === 'anchor-a' ? 'Stable heading' : '' });
// What the lab puts into a page: its reload holder after <head>, its widget tag at the end (lib/proxy.ts, local.mjs).
const HOLD = /<script>\(\(\)=>\{const L=window\.__lab=\{writing[\s\S]*?<\/script>/g;
const WIDGET = /<script src="\/_lab\/comments\.js"[^>]*><\/script>\n/g;
// A page's key in the lab, from its address: no slashes around it, no .html, / is /index, lower case (lib/proxy.ts pageKey, lib/labs.ts keyFor).
const keyOfPath = (p) => `/${decodeURIComponent(p).replace(/^\/+|\/+$/g, '').replace(/\.html?$/i, '').toLowerCase() || 'index'}`;

// ---------- one case ----------
let caseN = 0;
export async function run(plan, ctx, opts) {
  const { fw } = plan;
  const F = FRAMEWORKS[fw];
  if (failedInstall.has(fw) || !isInstalled(fw)) return ctx.add('harness', 'framework-not-installed', `${fw}: ${failedInstall.get(fw) || `not in ${CACHE} (run.mjs installs it before the cases start)`}`, { fw });
  const slow = opts.slow || 1;
  const BOUND = (fw === 'next' ? 15000 : 10000) * slow; // how long a page may take to show a save (a framework's own update is ~100 ms to 2 s)
  const note = (...w) => ctx.note(...w);

  // ----- the project: only its source files; node_modules is one folder up, in the cache -----
  const dir = path.join(homeOf(fw), 'cases', `c${ctx.seed}-${process.pid}-${++caseN}`);
  liveDirs.add(dir);
  // (The last thing a case does: its servers are ended first, or they would write into the folder again.)
  ctx.onEnd(async () => {
    const going = [...ctx.procs].map((p) => new Promise((r) => (p.exitCode !== null || p.signalCode !== null ? r() : p.once('exit', r))));
    ctx.killAll();
    await Promise.race([Promise.all(going), sleep(3000)]);
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    liveDirs.delete(dir);
  });
  const abs = (f) => path.join(dir, f);
  const write = (f, text, how = 'write') => {
    fs.mkdirSync(path.dirname(abs(f)), { recursive: true });
    if (how === 'atomic' && fs.existsSync(abs(f))) writeAtomicly(abs(f), text);
    else fs.writeFileSync(abs(f), text);
  };
  // (Where the lab has to find the dev server itself, the project holds no .html beyond what its framework needs: the
  // lab takes a project with pages in it for a folder of pages.)
  for (const [f, text] of Object.entries(projectFiles(fw, () => TOK(0), { csp: plan.csp, favicon: plan.favicon }))) if (!(plan.detect && f.endsWith('partial.html'))) write(f, text);
  const extras = new Map(); // n -> { file, url, key }: the routes made by steps
  const everKeys = new Set(Object.values(F.pages).map((p) => p.key));
  const broken = new Set(); // file ids saved with a syntax error and not fixed yet
  const fileOf = (id) => (id === 'comp' || id === 'mod' || id === 'css' ? F[id].file : id.startsWith('page:') ? F.pages[id.slice(5)]?.file : extras.get(Number(id.slice(6)))?.file);
  const textOf = (id, tok, bad = false) =>
    id === 'comp' || id === 'mod' || id === 'css' ? (bad ? F[id].broken : F[id].text)(tok)
    : id.startsWith('page:') ? (bad ? F.pageBroken : F.pageText)(tok, id.slice(5))
    : F.pageText(tok, `extra${id.slice(6)}`);
  /** The version a file holds on disk now (each holds one token), or null. */
  const onDisk = (id) => {
    try {
      return /v\d{7}/.exec(fs.readFileSync(abs(fileOf(id)), 'utf8'))?.[0] ?? null;
    } catch {
      return null;
    }
  };
  /** The route a page address shows: 'home', 'about', 'extra3', or null. */
  const routeOf = (pathname) => {
    const key = keyOfPath(pathname);
    for (const [route, p] of Object.entries(F.pages)) if (p.key === key) return route;
    for (const [n, e] of extras) if (e.key === key) return `extra${n}`;
    if (F.spa && !F.newRoute) return 'home'; // a single-page app shows its first route for any address
    return fw === 'webpack' ? 'home' : null;
  };
  const urlOf = (route) => (F.pages[route] || extras.get(Number(route.slice(5))))?.url;
  /** What a page on this route must show, read from the disk: { page, comp, mod, css }. */
  const wantOn = (route) => ({ page: onDisk(F.pages[route] ? `page:${route}` : `extra:${route.slice(5)}`), comp: onDisk('comp'), mod: onDisk('mod'), css: onDisk('css') });

  // ----- the dev server, and the lab in front of it -----
  const dev = new Dev(ctx, fw, dir);
  if (!(await dev.start())) return ctx.add('harness', 'dev-server-did-not-start', `${fw}: ${dev.log.trim().slice(-500)}`, { fw });
  const wifi = Boolean(LAN);
  const lab = new Lab(ctx, { dir, flags: ['--new', ...(wifi ? ['--wifi'] : [])], args: plan.detect ? [] : ['--proxy', String(dev.port)], env: { LAB_SETTLE_MS: '120', LAB_ACK_MS: '1200', LAB_ANSWER_MS: '600000', LAB_REMIND_MS: '600000' } });
  const started = await lab.start();
  if (plan.detect) {
    // "It finds your running dev server (Astro, Next, Vite…) or serves plain HTML" (README.md).
    if (!started.ok) return ctx.add(/dev server/i.test(lab.log) ? 'loud' : 'harness', /dev server/i.test(lab.log) ? 'dev-server-not-found' : 'lab-did-not-start', `${fw} runs on :${dev.port} in the project's folder and the lab, started with no --proxy, said: ${lab.log.trim().slice(-300)}`, { fw });
    const found = (await rq(lab, { path: '/_lab/pages' }).catch(() => null))?.json().proxy ?? null;
    if (found !== dev.base) {
      // A project of plain pages with a server of its own that only serves them (python3 -m http.server): the lab
      // serving the folder itself is the documented other half ("or serves plain HTML").
      if (!found && fw === 'static') return void ctx.add('unclear', 'static-server-not-put-in-front', `a static server runs in the folder on :${dev.port}; the lab serves the folder itself`, {});
      return ctx.add('silent', found ? 'wrong-dev-server-found' : 'dev-server-not-found', `${fw}'s dev server runs on :${dev.port} in the project's folder (package.json has a dev script); the lab, started with no --proxy, ${found ? `went in front of ${found}` : 'serves the folder as plain pages instead (its index.html without the framework: raw source, no widget on what the dev server builds)'}`, found ? {} : { why: fs.existsSync(abs('index.html')) ? 'index.html-at-the-top-of-the-project' : 'an-html-file-inside-the-project' });
    }
  } else if (!started.ok) return ctx.add('harness', 'lab-did-not-start', lab.log.slice(-400));
  const lanBase = `http://${LAN}:${lab.port}`;

  // ----- the model: comments said yes to -----
  const M = new Map(); // id -> { id, key, parent, text, agent, op, via }
  const byOp = new Map(); // a step -> the thread it made
  const toggled = new Map(); // thread -> resolved, as the steps left it
  let labRestarts = 0;
  let devRestarts = 0;
  let labDown = false;
  let devDown = false;
  const quietFrom = []; // [from, to]: windows in which a server was down (console errors in them are expected)
  const add = (c, key, op, more = {}) => {
    M.set(c.id, { id: c.id, key, parent: c.parent || null, text: c.text, agent: Boolean(more.agent), op, via: more.via || 'api', at: Date.now() });
    if (!c.parent) toggled.set(c.id, false);
  };
  const list = async (key) => (await rq(lab, { path: `/_lab/api/comments?page=${encodeURIComponent(key)}` })).json().comments;
  const everything = async () => (await Promise.all([...everKeys].map(async (k) => (await list(k)).map((c) => ({ ...c, key: k }))))).flat();
  const loud = (check, detail, tags) => (note(`LOUD ${check}: ${detail}`), ctx.add('loud', check, detail, tags));
  const silent = (check, detail, tags) => (note(`SILENT ${check}: ${detail}`), ctx.add('silent', check, detail, tags));

  // ----- the agent: one session that waits, gets pins and answers -----
  const handed = new Set();
  let ending = false;
  let waitOpen = null;
  const listen = async () => {
    while (!ending) {
      if (plan.cli) {
        const run = runCli(ctx, lab, ['wait', '--bg', '--timeout', '30', '--name', SESSION.name], { env: { CLAUDE_CODE_SESSION_ID: SESSION.id, LABIT_BACKGROUND: '1' } });
        waitOpen = () => run.proc.kill('SIGKILL');
        const { code, out } = await run;
        for (const m of out.matchAll(/· id ([0-9a-f]{12})/g)) handed.add(m[1]);
        if (ending) return;
        if (code !== 0 && !labDown && !/No lab server|isn't running|No new comments/.test(out)) note(`labit wait ended ${code}: ${out.trim().slice(0, 200)}`);
        if (code !== 0) await sleep(300);
      } else {
        const abort = new AbortController();
        waitOpen = () => abort.abort();
        const r = await agentRq(lab, SESSION, '/_lab/wait', { timeout: 30, ack: true }, { signal: abort.signal, timeout: 60000 }).catch(() => null);
        if (ending) return;
        if (!r) await sleep(250); // the lab went away under it: asked again, as labit wait does
        else if (r.status === 200) {
          for (const m of r.text.matchAll(/· id ([0-9a-f]{12})/g)) handed.add(m[1]);
          await agentRq(lab, SESSION, '/_lab/ack', { id: r.headers['x-lab-delivery'] }).catch(() => {});
        } else if (r.status !== 204) await sleep(300);
      }
    }
  };
  const listening = listen();
  ctx.onEnd(() => {
    ending = true;
    waitOpen?.();
  });

  // ----- the devices -----
  let taken = null;
  if (plan.browser) {
    try {
      taken = await opts.browser.take(plan.browser);
    } catch (e) {
      return ctx.add('harness', 'browser-did-not-start', `${plan.browser}: ${e.message}`);
    }
    ctx.onEnd(() => taken.release());
  }
  const devices = plan.devices.map((spec, i) => (taken ? new Real({ id: `d${i}`, kind: spec.kind, name: spec.name, spec, note }) : Object.assign(new PageDevice(lab, { id: `d${i}`, kind: spec.kind === 'phone' && wifi ? 'phone' : 'laptop', name: spec.name, url: F.pages[spec.route].url }), { spec, opened: false, said: new Set() })));
  ctx.onEnd(() => Promise.all(devices.map((d) => d.close())));
  const invite = async (spec) => {
    const inv = await agentRq(lab, SESSION, '/_lab/invite', { name: spec.name });
    return inv.status === 200 ? inv.json().links.find((l) => l.includes(`//${LAN}:`)) : null;
  };
  const openDevice = async (d) => {
    const url = F.pages[d.spec.route].url;
    if (d.real) {
      const phone = d.kind === 'phone';
      d.bctx = await taken.browser.newContext(phone ? { ...(plan.browser === 'webkit' ? taken.devices['iPhone 13'] : taken.devices['Pixel 7']) } : { viewport: { width: 1000, height: 700 } });
      await d.bctx.addInitScript(([who]) => {
        try {
          localStorage.setItem('lab-name', who);
          localStorage.setItem('lab-on', '1');
        } catch {}
      }, [d.name]);
      d.page = await d.bctx.newPage();
      d.watch(d.page, true);
      d.base = phone && wifi ? lanBase : lab.base;
      if (phone && wifi) {
        const link = await invite(d.spec);
        if (!link) return ctx.add('harness', 'phone-not-let-in', 'no invite link for the phone');
        await d.page.goto(link, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
      }
      await d.page.goto(d.base + url, { waitUntil: 'load', timeout: 30000 }).catch((e) => note(`${d.id} open: ${String(e).split('\n')[0]}`));
      if (!phone) {
        // The control: the same page straight on the dev server, in the same browser.
        d.control = await d.bctx.newPage();
        d.watch(d.control, false);
        await d.control.goto(dev.base + url, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
        await d.page.bringToFront().catch(() => {});
      }
    } else {
      if (d.kind === 'phone') {
        const link = await invite(d.spec);
        const got = link && (await rq(lab, { from: 'lan', path: new URL(link).pathname + new URL(link).search }));
        d.cookie = (got?.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
        if (!d.cookie) return ctx.add('harness', 'phone-not-let-in', `the invite link answered ${got?.status}`);
      }
      await d.open();
    }
    d.opened = true;
  };

  // ----- checks used while the steps run and at the end -----
  const where = (d) => ({ device: d.kind, ...(d.real ? { browser: plan.browser } : {}) });
  // The widget is on the page, once. Polled: after a load its script (deferred) starts a moment later.
  const checkWidget = async (d, when) => {
    if (!d.real || !d.opened || devDown || labDown) return null;
    let i = null;
    const ok = await until(async () => {
      i = await d.info();
      return !i.error && i.hosts === 1;
    }, 6000 * slow, 150);
    if (ok) {
      if (i.scripts > 1 && !d.said.has('tag-twice')) (d.said.add('tag-twice'), ctx.add('unclear', 'widget-script-tag-twice', `${d.id} after ${when}: the page holds ${i.scripts} widget script tags (one widget is mounted)`, { when }));
      return i;
    }
    if (i.error) return void note(`${d.id} after ${when}: the page could not be read (${i.error})`);
    // The lab's own "no answer from the dev server" page says what is wrong: that is loud, and a person reloads.
    if (/no answer from the dev server/.test(i.text)) {
      loud('page-left-on-the-labs-502', `${d.id} after ${when}: the tab shows the lab's "no answer from the dev server" page though the dev server is up again; nothing reloads it`, { when, ...where(d) });
      await d.page.reload({ waitUntil: 'load', timeout: 20000 }).catch(() => {});
      return null;
    }
    const key = `${i.hosts > 1 ? 'twice' : 'missing'}:${when}`;
    if (d.said.has(key)) return i;
    d.said.add(key);
    if (i.hosts > 1) silent('widget-mounted-twice', `${d.id} after ${when}: ${i.hosts} widgets are mounted on ${i.url} (${i.scripts} script tags)`, { when, ...where(d) });
    else {
      // What the framework's page is with no lab in front, if this device has a control: an error page is still a page.
      silent('widget-missing', `${d.id} after ${when}: no widget on ${i.url} (title "${i.title}", ${i.scripts} widget script tags, the page says: ${JSON.stringify(i.text.slice(0, 80))})`, { when, shows: i.overlay ? 'error-overlay' : i.route ? 'the-page' : 'another-page', ...where(d) });
    }
    return i;
  };
  // The pins a real browser draws: one numbered pin per open thread of the page whose address it shows, each on its element.
  const checkPins = async (d, when) => {
    if (!d.real || !d.opened || devDown || labDown || d.draft || broken.size) return;
    let i = null;
    let want = [];
    let got = [];
    let off = [];
    const same = await until(async () => {
      i = await d.info();
      if (i.error || !i.pins) return false;
      const key = keyOfPath(i.url);
      const truth = everKeys.has(key) ? await list(key) : [];
      // (A pin can only be drawn where its element is: on the framework's "not found" or error page nothing is judged.)
      want = truth.filter((c) => !c.parent && !c.resolved && c.anchor?.kind !== 'page' && i.els[/^#([\w-]+)$/.exec(c.anchor?.selector || '')?.[1]]);
      got = i.pins.map((p) => ({ ...p, num: Number(/^comment (\d+) by /.exec(p.label)?.[1] || 0) })).filter((p) => p.num);
      off = [];
      for (const c of want) {
        const p = got.find((x) => x.num === c.num);
        const on = /^#([\w-]+)$/.exec(c.anchor?.selector || '')?.[1];
        const el = on && i.els[on];
        if (!p || !el || /\bdragging\b/.test(p.cls)) continue;
        // The widget draws a pin with its left edge and its foot on the spot (x and y are fractions of the element).
        const [x, y] = [el[0] + c.anchor.x * el[2], el[1] + c.anchor.y * el[3]];
        const [dx, dy] = [p.rect[0] - x, p.rect[1] + p.rect[3] - y];
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) off.push({ c, on, dx: Math.round(dx), dy: Math.round(dy) });
      }
      return !off.length && want.length === got.length && want.every((c) => got.some((p) => p.num === c.num));
    }, (when === 'the-end' ? 6000 : 3000) * slow, 200);
    if (same || !i || i.error || !i.pins) return;
    const nav = d.clientNav ? 'client-side' : 'page-load';
    const missing = want.filter((c) => !got.some((p) => p.num === c.num));
    const extra = got.filter((p) => !want.some((c) => c.num === p.num));
    const say = (key, fn) => d.said.has(key) || (d.said.add(key), fn());
    const idOf = (c) => /^#([\w-]+)$/.exec(c.anchor?.selector || '')?.[1];
    // The marks' own words hold the version, so a save changes them: a pin on one is then "moved" for the widget (its
    // words changed under it). Whether such a pin should stay is not said anywhere; one on the heading no step touches must.
    const detached = i.moved ? missing.filter((c) => i.els[idOf(c)]) : [];
    const real = detached.filter((c) => idOf(c) === 'anchor-a');
    if (real.length) say(`detached:${when}`, () => silent('pin-lost-anchor', `${d.id} after ${when} on ${i.url}: pin ${real.map((c) => c.num).join(', ')} is no longer on its element, though #anchor-a is on the page, unchanged (the widget lists it as "${i.moved}")`, { what: 'detached', when, ...where(d) }));
    else if (detached.length && detached.length === missing.length && !extra.length) say('moved-words', () => ctx.add('unclear', 'pin-shown-as-moved-after-its-words-changed', `${d.id} after ${when}: pin ${detached.map((c) => c.num).join(', ')} on ${detached.map(idOf).join(', ')} is off the page ("${i.moved}") once a save changed that element's words`, {}));
    else if (missing.length || extra.length)
      say(`pins:${missing.length ? 'm' : 'x'}:${nav}`, () => silent('browser-pins-differ', `${d.id} after ${when}: on ${i.url} it draws pins [${got.map((p) => p.label).join(' | ')}], the page's open threads are [${want.map((c) => `${c.num} by ${c.name}`).join(' | ')}]`, { what: missing.length ? 'pin-missing' : 'pin-of-another-page', reached: nav, ...(d.real ? { browser: plan.browser } : {}) }));
    for (const o of off.filter((x) => x.on === 'anchor-a')) say(`jumped:${when}`, () => silent('pin-lost-anchor', `${d.id} after ${when} on ${i.url}: pin ${o.c.num} sits ${o.dx} px right and ${o.dy} px below its spot on #${o.on}`, { what: 'jumped', when, ...where(d) }));
  };
  const after = async (d, when) => {
    await checkWidget(d, when);
    await checkPins(d, when);
  };
  const reals = () => devices.filter((d) => d.real && d.opened);
  // A write from a real browser's page, as the widget makes it (same cookies, the page's own key). A page that is
  // loading at that moment can't send: tried again a moment later, as a person would.
  const inPage = async (d, body) => {
    let r = null;
    for (let n = 0; n < 4; n++) {
      r = await d.page.evaluate(async (b) => {
        const s = document.querySelector('script[src*="/_lab/comments.js"]');
        const res = await fetch('/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', ...(s?.dataset.admin ? { 'x-lab-admin': s.dataset.admin } : {}) }, body: JSON.stringify(b) });
        return { status: res.status, json: await res.json().catch(() => null) };
      }, body).catch((e) => ({ status: 0, error: String(e).split('\n')[0] }));
      if (r.status) return r;
      await sleep(600);
    }
    return r;
  };

  // Is `lab` the dev server's Content-Type with only `charset=utf-8` put on (or its spelling tidied: `text/html;charset=UTF-8` -> `text/html; charset=utf-8`)?
  // The media type must be text/html and the same; the dev server's charset, if it sent one, must already be utf-8; any other parameter is kept as it was.
  const htmlCharsetOnly = (dev, lab) => {
    const parse = (v) => String(v ?? '').split(';').map((x) => x.trim()).filter(Boolean);
    const [dt, ...dp] = parse(dev);
    const [lt, ...lp] = parse(lab);
    if (!dt || !lt || dt.toLowerCase() !== lt.toLowerCase() || dt.toLowerCase() !== 'text/html') return false;
    const charset = (ps) => ps.filter((x) => /^charset\s*=/i.test(x)).map((x) => x.replace(/^charset\s*=\s*/i, '').replace(/^"|"$/g, '').toLowerCase());
    const [dc, lc] = [charset(dp), charset(lp)];
    if (dc.length > 1 || lc.length !== 1 || lc[0] !== 'utf-8' || (dc.length && !/^utf-?8$/.test(dc[0]))) return false;
    const rest = (ps) => ps.filter((x) => !/^charset\s*=/i.test(x)).join(';');
    return rest(dp) === rest(lp);
  };
  // The same request asked of the dev server directly (twice, around the one through the lab) and through the lab.
  const HOP = ['connection', 'keep-alive', 'date', 'transfer-encoding'];
  const compare = async (spec, from = 'local', cookie = '') => {
    if (devDown || labDown) return;
    const o = { method: spec.method || 'GET', path: spec.path, headers: spec.headers || {}, body: spec.body };
    const d1 = await ask({ ...o, port: dev.port });
    const l = await viaLab(lab, { ...o, headers: { ...o.headers, ...(o.headers.origin ? { origin: lab.base } : {}) } }, from, cookie);
    const d2 = await ask({ ...o, port: dev.port });
    if (!d1.status || !d2.status) return void note(`   ${spec.what} ${spec.path}: the dev server did not answer directly (${d1.error || d2.error})`);
    const tags = { what: spec.what };
    const bad = (field, detail) => silent('proxy-mangled-response', `${o.method} ${spec.path} (${spec.what}${Object.keys(o.headers).length ? `; ${Object.entries(o.headers).map(([k, v]) => `${k}: ${v}`).join(', ').slice(0, 160)}` : ''}): ${detail}`, { ...tags, field });
    if (!l.status) return loud('request-dropped-by-the-lab', `${o.method} ${spec.path} (${spec.what}): the dev server answers ${d1.status} directly, through the lab the connection ended (${l.error})`, tags);
    const stable = (f) => JSON.stringify(f(d1)) === JSON.stringify(f(d2));
    if (stable((x) => x.status) && l.status !== d1.status) return bad('status', `status ${l.status} through the lab, ${d1.status} directly`);
    if (l.buf === null) return bad('content-encoding', `the bytes through the lab are not ${l.headers['content-encoding']} as its header says`);
    const isPage = o.method === 'GET' && (o.headers['sec-fetch-dest'] === 'document' || /text\/html/.test(o.headers.accept || ''));
    const html = /text\/html/i.test(l.headers['content-type'] || '') && o.method === 'GET' && l.status !== 304 && l.status !== 206;
    if (l.headers['content-length'] !== undefined && o.method !== 'HEAD' && l.status !== 304 && Number(l.headers['content-length']) !== l.raw.length) return bad('content-length', `content-length says ${l.headers['content-length']}, ${l.raw.length} bytes came`);
    if (isPage && html) {
      // A page: the dev server's bytes, with the lab's reload holder and one widget tag.
      const text = l.buf.toString('utf8');
      const widgets = (text.match(/<script src="\/_lab\/comments\.js"/g) || []).length;
      if (widgets !== 1) return silent(widgets ? 'widget-mounted-twice' : 'widget-missing', `GET ${spec.path} through the lab (${l.status}): the page's HTML holds ${widgets} widget tags`, { when: 'as-served', ...(widgets ? {} : { shows: l.status >= 400 ? 'an-error-page' : 'the-page' }) });
      if (stable((x) => x.buf?.toString('base64')) && d1.buf) {
        // The holder is there, once: taking out one that isn't there would leave the page as it was and pass.
        const holders = (text.match(HOLD) || []).length;
        if (holders !== 1) return bad('reload-holder', `GET ${spec.path} through the lab (${l.status}): the page's HTML holds ${holders} reload holders, not one`);
        const [a, b] = [text.replace(HOLD, '').replace(WIDGET, ''), d1.buf.toString('utf8')];
        if (a !== b) {
          const at = [...a].findIndex((ch, k) => ch !== b[k]);
          return bad('page-body', `the page without the lab's two tags differs from the dev server's at ${at}: ${JSON.stringify(a.slice(Math.max(0, at - 30), at + 50))} for ${JSON.stringify(b.slice(Math.max(0, at - 30), at + 50))}`);
        }
      }
      // (cache-control, content-length, content-encoding and the Content-Security-Policy are the lab's to change on a page: lib/proxy.ts.)
      for (const h of ['content-type', 'location']) if (stable((x) => x.headers[h]) && l.headers[h] !== d1.headers[h]) {
        // lib/proxy.ts: a page load's HTML is read in the dev server's charset and goes on as UTF-8, so the lab writes `; charset=utf-8`
        // (same media type, same other parameters, the spacing of the parameters its own). Only that is accepted; anything else is a finding.
        if (h === 'content-type' && htmlCharsetOnly(d1.headers[h], l.headers[h])) {
          note(`   ${spec.path}: content-type ${d1.headers[h]} directly, ${l.headers[h]} through the lab (the lab's charset=utf-8 on a page, as lib/proxy.ts does)`);
          continue;
        }
        return bad(h, `${h}: ${l.headers[h]} through the lab, ${d1.headers[h]} directly`);
      }
      return;
    }
    // HTML a script asked for (fetch, not a page load): did it come back with the lab's tags in it? A whole page
    // (what a client-side router fetches to swap in) may well carry the widget, the contract does not say; a piece
    // of HTML that is no page is the app's data, and must be the dev server's bytes.
    if (html && !isPage && d1.buf && /\/_lab\/comments\.js|__lab=\{writing/.test(l.buf.toString('utf8')) && !/\/_lab\/comments\.js/.test(d1.buf.toString('utf8'))) {
      const text = l.buf.toString('utf8');
      const whole = /<html[\s>]/i.test(d1.buf.toString('utf8'));
      return ctx.add(whole ? 'unclear' : 'silent', whole ? 'page-fetched-by-a-script-gets-the-widget' : 'proxy-mangled-response', `GET ${spec.path} asked by a script (sec-fetch-dest: ${o.headers['sec-fetch-dest'] || 'none'}, accept: ${o.headers.accept || 'none'}): ${d1.raw.length} bytes directly, ${l.raw.length} through the lab, which added ${(text.match(/\/_lab\/comments\.js/g) || []).length} widget tag and ${(text.match(/__lab=\{writing/g) || []).length} reload holder: ${JSON.stringify(text.slice(0, 60))} … ${JSON.stringify(text.slice(-90))}`, whole ? {} : { ...tags, field: 'body-of-html-that-is-no-page' });
    }
    // Anything else: the same bytes and the same headers.
    if (stable((x) => x.raw.toString('base64')) && !l.raw.equals(d1.raw)) {
      const same = l.buf && d1.buf && l.buf.equals(d1.buf);
      return bad(same ? 'bytes-packed-differently' : 'body', `${l.raw.length} bytes through the lab, ${d1.raw.length} directly${same ? ' (the same once unpacked)' : `; first difference at ${[...l.raw].findIndex((x, k) => x !== d1.raw[k])}`}`);
    }
    for (const h of new Set([...Object.keys(d1.headers), ...Object.keys(l.headers)])) {
      if (HOP.includes(h) || h === 'set-cookie' || !stable((x) => x.headers[h])) continue;
      // A redirect to the dev server's own address may come back as the lab's: only that origin may change, the path,
      // query and fragment stay.
      if (h === 'location' && d1.headers[h] !== undefined) {
        const devOrigin = new RegExp(`^https?://(localhost|127\\.0\\.0\\.1|\\[::1\\]):${dev.port}(?=[/?#]|$)`);
        const asLab = [lab.base, `http://${from === 'lan' ? LAN : 'localhost'}:${lab.port}`].map((o) => String(d1.headers[h]).replace(devOrigin, o));
        if (l.headers[h] === d1.headers[h] || asLab.includes(l.headers[h])) continue;
      }
      if (JSON.stringify(l.headers[h]) !== JSON.stringify(d1.headers[h])) return bad(`header-${h}`, `${h}: ${JSON.stringify(l.headers[h])} through the lab, ${JSON.stringify(d1.headers[h])} directly (status ${l.status})`);
    }
  };
  // The addresses a page loads, read from the dev server's own HTML.
  const assetsOf = async (routeUrl) => {
    const r = await ask({ port: dev.port, path: routeUrl, headers: { accept: 'text/html', 'accept-encoding': 'identity' } });
    const out = new Set();
    for (const m of (r.buf?.toString('utf8') || '').matchAll(/\b(?:src|href)="(\/[^"/][^"]*)"/g)) if (!m[1].startsWith('/_lab/') && !/\.html?$/.test(m[1]) && m[1].length < 300) out.add(m[1].replace(/&amp;/g, '&'));
    return [...out];
  };
  const NAVIGATE = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'none', 'accept-encoding': 'gzip, deflate, br' };
  const BY_SCRIPT = { accept: '*/*', 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin' };
  const pub = (f) => `/${f}`;
  const fetches = async (seed, count) => {
    const r = mulberry(seed);
    const routeUrl = r.pick(Object.values(F.pages)).url;
    const assets = [...(await assetsOf(routeUrl)), pub('big.txt'), pub('pic.bin')];
    for (let k = 0; k < count; k++) {
      const u = r.pick(assets);
      const what = r.pick(['asset', 'asset-gzip', 'asset-br', 'asset-identity', 'range', 'range-tail', 'range-past-the-end', 'if-none-match', 'if-modified-since', 'head', 'page', 'page', 'page-if-none-match', 'html-piece-fetched-by-a-script', 'page-fetched-by-a-script', 'not-found', 'post', 'query']);
      note(`   ${what} ${what.startsWith('page') || what === 'post' ? routeUrl : what.startsWith('html-piece') ? pub('partial.html') : u}`);
      if (what === 'asset') await compare({ what, path: u, headers: { accept: '*/*' } });
      else if (what === 'asset-gzip') await compare({ what, path: u, headers: { 'accept-encoding': 'gzip' } });
      else if (what === 'asset-br') await compare({ what, path: u, headers: { 'accept-encoding': 'br' } });
      else if (what === 'asset-identity') await compare({ what, path: u, headers: { 'accept-encoding': 'identity' } });
      else if (what === 'range') await compare({ what, path: r.pick([u, pub('pic.bin')]), headers: { range: 'bytes=0-99' } });
      else if (what === 'range-tail') await compare({ what, path: pub('pic.bin'), headers: { range: 'bytes=-50' } });
      else if (what === 'range-past-the-end') await compare({ what, path: pub('pic.bin'), headers: { range: 'bytes=99999999-' } });
      else if (what === 'if-none-match' || what === 'if-modified-since') {
        const first = await ask({ port: dev.port, path: u });
        const h = what === 'if-none-match' ? first.headers.etag && { 'if-none-match': first.headers.etag } : first.headers['last-modified'] && { 'if-modified-since': first.headers['last-modified'] };
        if (h) await compare({ what, path: u, headers: h });
      } else if (what === 'head') await compare({ what, method: 'HEAD', path: u });
      else if (what === 'page') await compare({ what, path: routeUrl, headers: NAVIGATE });
      else if (what === 'page-if-none-match') {
        const first = await ask({ port: dev.port, path: routeUrl, headers: { accept: 'text/html' } });
        if (first.headers.etag) await compare({ what, path: routeUrl, headers: { ...NAVIGATE, 'if-none-match': first.headers.etag } });
      } else if (what === 'html-piece-fetched-by-a-script') await compare({ what, path: pub('partial.html'), headers: BY_SCRIPT });
      else if (what === 'page-fetched-by-a-script') await compare({ what, path: routeUrl, headers: BY_SCRIPT });
      else if (what === 'not-found') await compare({ what, path: `/no-such-page-${k}`, headers: NAVIGATE });
      else if (what === 'post') await compare({ what, method: 'POST', path: routeUrl, headers: { 'content-type': 'text/plain', origin: dev.base, 'content-length': '2' }, body: 'hi' });
      else if (what === 'query') await compare({ what, path: `${u}${u.includes('?') ? '&' : '?'}x=%E2%9C%93&y=a+b`, headers: { accept: '*/*' } });
    }
  };

  // The dev server's live-reload socket: what it says to a page directly and to one through the lab must be the same.
  const hmrSocket = async (op, phoneCookie) => {
    if (devDown || labDown || !F.hmr) return;
    let p = '/';
    let protocol = '';
    if (F.hmr === 'vite') {
      const client = await ask({ port: dev.port, path: '/@vite/client' });
      const token = /wsToken\s*=\s*"([^"]*)"/.exec(client.buf?.toString('utf8') || '')?.[1];
      p = `/${token ? `?token=${token}` : ''}`;
      protocol = 'vite-hmr';
    } else if (F.hmr === 'webpack') p = '/ws';
    else if (F.hmr === 'next') {
      const page = await ask({ port: dev.port, path: '/', headers: { accept: 'text/html', 'accept-encoding': 'identity' } });
      p = `/_next/hmr?id=${/__next_r\s*=\s*\\?"([\w-]+)/.exec(page.buf?.toString('utf8') || '')?.[1] || 'torture'}`;
    }
    const lan = op.from === 'lan' && wifi && phoneCookie;
    const [a, b] = await Promise.all([
      wsOpen({ port: dev.port, name: `localhost:${dev.port}`, path: p, protocol }),
      wsOpen({ port: lab.port, host: lan ? LAN : '127.0.0.1', name: `${lan ? LAN : 'localhost'}:${lab.port}`, path: p, protocol, cookie: lan ? phoneCookie : '' }),
    ]);
    const tags = { from: lan ? 'phone' : 'this-computer' };
    try {
      if (!a.open) return void note(`   the dev server did not open the socket directly (${a.status}): not judged`);
      if (!b.open) return loud('hmr-socket-refused', `${fw}'s live-reload socket ${p.split('?')[0]} opens directly (101) and not through the lab (${b.status || 'the connection ended'})`, tags);
      await sleep(500);
      const saveAt = Date.now();
      write(F.comp.file, F.comp.text(op.tok));
      broken.delete('comp');
      // Until the dev server has said something about the save to the direct socket, then a moment for the other.
      const n0 = a.messages.length;
      await until(() => a.messages.length > n0, 5000 * slow, 50);
      await sleep(800);
      // The two sockets open a few milliseconds apart, and a dev server broadcasts what an earlier save (a rebuild, a restart, a
      // watcher that fires late) is still producing to whoever is connected at that moment: a Vite full-reload or a webpack
      // invalid/built right after the upgrade reached one socket and not the other, in either order of opening (checked by
      // opening them the other way round: the lab's socket got it and the direct one did not). So only what the save of this
      // step caused is compared (messages from the save on); before it, each socket's first message, the greeting of the connection.
      const after = (w) => w.messages.filter((m) => m.at >= saveAt);
      const kinds = (w, list) => [...new Set(list.map((m) => kindOfMessage(m.text)).filter((k) => k !== 'ping' && k !== 'pong'))].sort();
      const [ka, kb] = [kinds(a, after(a)), kinds(b, after(b))];
      const greeting = [a, b].map((w) => (w.messages[0] ? kindOfMessage(w.messages[0].text) : ''));
      note(`   after the save, directly: ${ka.join(' ') || 'nothing'}; through the lab: ${kb.join(' ') || 'nothing'}`);
      // Vite and webpack-dev-server say the same to every page. Next speaks to each page on its own (what it says
      // depends on what that page has asked for), so there only "something after the save, as directly" is judged.
      const lost = F.hmr === 'next' ? (a.messages.length > n0 && b.messages.every((m) => m.at < a.messages[n0].at - 1500) ? ['anything after the save'] : !b.messages.length && a.messages.length ? ['anything'] : []) : ka.filter((k) => !kb.includes(k));
      if (b.closed && !a.closed) silent('hmr-socket-closed-through-proxy', `${fw}'s socket through the lab closed after ${b.messages.length} messages; the direct one is open`, tags);
      else if (F.hmr !== 'next' && greeting[0] && greeting[0] !== greeting[1]) silent('hmr-message-lost-through-proxy', `${fw}: the dev server greeted the direct socket with ${greeting[0]}, the one through the lab with ${greeting[1] || 'nothing'}`, tags);
      else if (lost.length) silent('hmr-message-lost-through-proxy', `${fw}: the dev server said ${ka.join(', ')} directly; through the lab only ${kb.join(', ') || 'nothing'} arrived`, tags);
    } finally {
      a.close();
      b.close();
    }
  };

  // ----- the steps -----
  const st = { counts: new Map(), editsSinceCount: new Set(), labRestartSinceCount: false };
  const key = (d, i) => (d.real ? keyOfPath(i?.url || '/') : d.attrs.page);
  const saved = (kind) => {
    st.editsSinceCount.add(kind);
    lastSave = Date.now();
  };
  let lastSave = Date.now();
  let lastRestart = 0;
  let brokenAt = 0;
  // A broken file is whole again: the console errors of that time are the framework's own, on each page at its own
  // moment; and a page that loaded in that time (a restart reloaded it) is remembered, see the end.
  const healed = () => {
    quietFrom.push([brokenAt, Date.now() + 3000]);
    for (const x of reals()) {
      if (!x.loadsAtBreak) continue;
      if (x.loads > x.loadsAtBreak[0]) x.loadedWhileBroken = true;
      x.loadsAtBreak = null;
    }
  };
  const unsent = new Map(); // words typed into the widget that no page of the lab held a moment later -> the step
  const findByText = async (text, ms = 4000) => {
    let hit = null;
    await until(async () => (hit = (await everything()).find((c) => c.text === text)), ms * slow, 150);
    return hit;
  };
  const step = async (op, i) => {
    note(`${i}: ${describe(op)}`);
    const d = op.d === undefined ? devices[0] : devices[op.d];
    if (op.t === 'open') {
      if (!d.opened) await openDevice(d);
      if (d.real) await after(d, 'the-first-load');
    } else if (op.t === 'edit' || op.t === 'fix' || op.t === 'break') {
      const f = fileOf(op.file);
      if (!f || (op.file.startsWith('extra:') && !fs.existsSync(abs(f)))) return;
      if (op.t === 'break') {
        write(f, textOf(op.file, op.tok, true));
        broken.add(op.file);
        brokenAt = Date.now();
        for (const x of reals()) x.loadsAtBreak = [x.loads, x.cloads];
      } else {
        write(f, textOf(op.file, op.tok), op.how);
        if (broken.delete(op.file) && !broken.size) healed();
      }
      saved(op.file === 'css' ? 'css' : 'code');
      if (!taken || devDown) return;
      if (op.t === 'break') {
        // The framework shows its error (an overlay, or its error page); the widget stays, and nothing reloads in a loop.
        await sleep(1500 * slow);
        for (const x of reals()) await checkWidget(x, 'an-error-overlay');
        const laptop = reals().find((x) => x.control);
        if (laptop && !labDown) {
          const [a, b] = [laptop.loads, laptop.cloads];
          await sleep(2500);
          const [mine, its] = [laptop.loads - a, laptop.cloads - b];
          note(`   with the error showing, in 2.5 s: ${mine} loads through the lab, ${its} on the control`);
          if (mine >= 2 && mine > its + 1) silent('reload-loop', `${fw}: while ${op.file} holds a syntax error, the page through the lab loaded ${mine} times in 2.5 s; the same page straight on the dev server loaded ${its} times`, { when: 'error-showing', ...where(laptop) });
        }
      }
    } else if (op.t === 'pin') {
      if (!d.opened || (d.real && d.draft)) return;
      if (!d.real) {
        const c = await d.pin(op.text, ANCHOR(op.on, op.slot)).catch((e) => void loud('write-refused', `step ${i} (${describe(op)}): ${e.message}`, { step: 'pin', status: e.status || 0 }));
        if (c) (add(c, d.attrs.page, i), byOp.set(i, c.id));
        return;
      }
      const before = await d.info();
      if (before.error || !before.els?.[op.on] || broken.size) return void note('   (the page shows no such element now: skipped)');
      const want = keyOfPath(before.url);
      if (op.via === 'api') {
        const r = await inPage(d, { page: want, name: d.name, text: op.text, anchor: ANCHOR(op.on, op.slot) });
        if (!r.status) return void note(`   (the page could not send: ${r.error}; skipped)`);
        if (r.status !== 201) return loud('write-refused', `step ${i} (${describe(op)}): ${r.status} ${JSON.stringify(r.json || r.error).slice(0, 160)}`, { step: 'pin', status: r.status });
        add(r.json.comment, want, i);
        byOp.set(i, r.json.comment.id);
      } else {
        // Through the widget: a click on the element opens a new comment, the words are typed, Enter sends it.
        const el = before.els[op.on];
        await d.page.mouse.click(el[0] + Math.min(el[2] - 30, 40 + op.slot * 46), el[1] + el[3] / 2);
        if (!(await until(async () => (await d.info()).draft !== null && (await d.info()).draft !== undefined, 3000 * slow, 100))) return void note('   (no new-comment box opened: skipped)');
        await d.page.keyboard.type(op.text);
        await d.page.keyboard.press('Enter');
        const c = await findByText(op.text);
        if (!c) {
          const now = await d.info();
          await d.page.keyboard.press('Escape').catch(() => {});
          // (The widget sends again every 2 s while the lab can't be reached: whether it was saved is judged at the end.)
          unsent.set(op.text, { i, url: before.url, sent: now.draft !== op.text, tags: { reached: d.clientNav ? 'client-side' : 'page-load', ...where(d) } });
          return void note(now.draft === op.text ? '   (the words are still in the box: not sent, skipped)' : '   (sent, and on no page of the lab 4 s later: looked for again at the end)');
        }
        if (c.key !== want) silent('comment-on-wrong-page', `step ${i}: ${d.id} shows ${before.url} (the lab's page ${want}) and its pin "${op.text}" was saved on ${c.key}`, { via: 'widget', reached: d.clientNav ? 'client-side' : 'page-load', ...where(d) });
        add(c, c.key, i, { via: 'widget' });
        byOp.set(i, c.id);
        await sleep(300);
      }
      await checkPins(d, 'a-pin');
    } else if (op.t === 'pin-route') {
      const e = extras.get(op.n);
      if (!e) return;
      const r = await rq(lab, { method: 'POST', path: '/_lab/api/comments', body: { page: e.key, name: 'Leo', text: op.text, anchor: ANCHOR('anchor-a', 1) } });
      if (r.status !== 201) return loud('write-refused', `a pin on ${e.key}: ${r.status} ${r.text.slice(0, 160)}`, { step: 'pin-route', status: r.status });
      add(r.json().comment, e.key, i);
      byOp.set(i, r.json().comment.id);
    } else if (op.t === 'reply') {
      const root = byOp.get(op.to);
      const m = root && M.get(root);
      if (!m || !d.opened || (d.real && d.draft)) return;
      if (!d.real) {
        if (m.key !== d.attrs.page) return;
        await until(() => d.find(root), 2000, 30);
        const c = d.find(root);
        if (!c) return void note('   (not on its screen: skipped)');
        const out = await d.reply(c, op.text).catch((e) => void loud('write-refused', `step ${i} (${describe(op)}): ${e.message}`, { step: 'reply', status: e.status || 0 }));
        if (out) (add(out, m.key, i), toggled.set(root, false));
        return;
      }
      const info = await d.info();
      if (info.error) return;
      const num = (await list(m.key)).find((c) => c.id === root)?.num;
      // Pin numbers count per page: pin 1 here is another thread than pin 1 on the thread's own page.
      const drawn = op.via === 'widget' && !broken.size && key(d, info) === m.key && info.pins?.some((p) => p.label.startsWith(`comment ${num} by `));
      if (drawn) {
        // Through the widget: the pin is opened, the words typed into its thread, Enter.
        await d.page.evaluate((n) => [...document.querySelectorAll('[data-lab-comments]')][0]?.shadowRoot.querySelector(`button.pin[aria-label^="comment ${n} by "]`)?.click(), num);
        if (!(await until(async () => (await d.info()).draft !== null && (await d.info()).draft !== undefined, 3000 * slow, 100))) return void note('   (the thread did not open: skipped)');
        await d.page.evaluate(() => [...document.querySelectorAll('[data-lab-comments]')][0]?.shadowRoot.querySelector('.card textarea, .float textarea')?.focus());
        await d.page.keyboard.type(op.text);
        await d.page.keyboard.press('Enter');
        const c = await findByText(op.text);
        await d.page.keyboard.press('Escape').catch(() => {});
        await sleep(150);
        if (!c) return silent('widget-pin-not-saved', `step ${i}: a reply typed into the thread ${root} and sent with Enter is on no page of the lab`, { reached: d.clientNav ? 'client-side' : 'page-load', ...where(d) });
        if (c.parent !== root) return silent('reply-in-wrong-thread', `step ${i}: a reply typed into pin ${num} (thread ${root} on ${m.key}) was saved under ${c.parent || 'no thread'} on ${c.key}`, { reached: d.clientNav ? 'client-side' : 'page-load', ...where(d) });
        add(c, c.key, i, { via: 'widget' });
      } else {
        const r = await inPage(d, { page: m.key, parent: root, name: d.name, text: op.text });
        if (r.status !== 201) return void note(`   refused: ${r.status} ${JSON.stringify(r.json || r.error).slice(0, 120)}`);
        add(r.json.comment, m.key, i);
      }
      toggled.set(root, false); // a person writing reopens the thread
    } else if (op.t === 'resolve') {
      const root = byOp.get(op.to);
      const m = root && M.get(root);
      if (!m || labDown) return;
      const now = toggled.get(root);
      const r = await rq(lab, { method: 'POST', path: '/_lab/api/comments', body: { page: m.key, action: now ? 'reopen' : 'resolve', id: root }, headers: { 'x-lab-admin': lab.serverJson().token } });
      if (r.status !== 200) return loud('write-refused', `step ${i} (${describe(op)}): ${r.status} ${r.text.slice(0, 160)}`, { step: 'resolve', status: r.status });
      toggled.set(root, !now);
    } else if (op.t === 'areply') {
      const root = byOp.get(op.to);
      const m = root && M.get(root);
      if (!m || labDown) return;
      if (plan.cli) {
        const r = await runCli(ctx, lab, ['reply', root, '--name', SESSION.name, ...(op.intent ? [`--${op.intent}`] : []), '--', op.text], { env: { CLAUDE_CODE_SESSION_ID: SESSION.id, LABIT_BACKGROUND: '1' } });
        if (r.code !== 0) return loud('agent-command-failed', `labit reply on ${root} (a thread on ${m.key}, behind ${fw}'s dev server): ${r.out.trim().slice(0, 300)}`, { step: 'reply' });
        const c = await findByText(op.text);
        if (!c) return silent('acknowledged-comment-missing', `labit reply on ${root} exited 0 and its answer is on no page`, { who: 'agent' });
        add(c, c.key, i, { agent: true });
      } else {
        const r = await agentRq(lab, SESSION, '/_lab/api/comments', { page: m.key, parent: root, name: SIGNED, text: op.text, ...(op.intent ? { intent: op.intent } : {}) });
        if (r.status !== 201) return loud('agent-answer-refused', `an answer on ${root}: ${r.status} ${r.text.slice(0, 200)}`, { status: r.status });
        add(r.json().comment, m.key, i, { agent: true });
      }
      if (op.intent === 'done') toggled.set(root, true);
    } else if (op.t === 'reload') {
      if (!d.opened || devDown || labDown || (d.real && d.draft)) return;
      if (!d.real) return void (await d.open());
      await d.both((p) => (op.hard ? p.goto(p.url(), { waitUntil: 'load', timeout: 30000 }) : p.reload({ waitUntil: 'load', timeout: 30000 })));
      d.clientNav = false;
      st.counts.delete(d.id);
      await after(d, 'a-reload');
    } else if (op.t === 'nav' || op.t === 'goto') {
      const route = op.t === 'nav' ? op.to : `extra${op.n}`;
      const url = urlOf(route);
      if (!url || !d.opened || devDown || labDown || (d.real && d.draft) || broken.size) return;
      if (!d.real) {
        d.url = url;
        return void (await d.open());
      }
      if (op.t === 'goto') {
        if (!fs.existsSync(abs(extras.get(op.n).file))) return;
        await d.both((p) => p.goto(new URL(p.url()).origin + url, { waitUntil: 'load', timeout: 30000 }));
        // A route made a moment ago may not be there yet for the framework: the person reloads until the control shows it.
        for (let n = 0; n < 5 && (await d.info(Boolean(d.control))).route !== route; n++) (await sleep(600), await d.both((p) => p.reload({ waitUntil: 'load', timeout: 30000 })));
        d.clientNav = false;
        st.counts.delete(d.id);
        return void (await after(d, 'a-page-load'));
      }
      // A click on the page's own link, on the lab's page and on the control.
      const from = await d.info();
      if (from.error || !from.route) return;
      const loads = d.loads;
      await d.both((p) => p.click(`#nav-${route}`, { timeout: 4000 }));
      const there = async (control) => until(async () => (await d.info(control)).route === route, BOUND, 150);
      // A device with no control (the phone) can't say the framework went there: that is no finding, only a note.
      const controlThere = d.control ? await there(true) : null;
      if (!(await there(false))) return controlThere ? silent('page-click-swallowed', `${d.id}: a click on the link to ${route} changed nothing through the lab (still ${(await d.info()).url}); on the control it went to ${route}`, { what: 'link', ...where(d) }) : void note(controlThere === null ? `   (the link did nothing through the lab; no control to compare with)` : '   (the link did nothing on the control either)');
      d.clientNav = d.loads === loads ? true : false; // the address changed with no page load: a client-side navigation
      if (!d.clientNav) st.counts.delete(d.id);
      await after(d, d.clientNav ? 'a-client-side-navigation' : 'a-page-load');
    } else if (op.t === 'back') {
      if (!d.real || !d.opened || devDown || labDown || d.draft || broken.size) return;
      const loads = d.loads;
      const was = (await d.info()).url;
      await d.both((p) => p.goBack({ waitUntil: 'load', timeout: 8000 }));
      await sleep(500);
      const now = await d.info();
      if (now.error || /^about:|^$/.test(d.page.url()) || now.url === was) return void (/^about:/.test(d.page.url()) && (await d.both((p) => p.goForward({ waitUntil: 'load', timeout: 8000 }))));
      d.clientNav = d.loads === loads;
      if (!d.clientNav) st.counts.delete(d.id);
      await after(d, d.clientNav ? 'a-client-side-navigation' : 'a-page-load');
    } else if (op.t === 'draft') {
      const x = devices[0];
      if (!x.real || !x.opened || devDown || labDown) return;
      if (op.on) {
        const info = await x.info();
        if (info.error || !info.els?.['tok-comp'] || x.draft || broken.size) return;
        await x.page.mouse.click(info.els['tok-comp'][0] + 220, info.els['tok-comp'][1] + info.els['tok-comp'][3] / 2);
        if (!(await until(async () => (await x.info()).draft !== null && (await x.info()).draft !== undefined, 3000 * slow, 100))) return void note('   (no new-comment box opened: skipped)');
        await x.page.keyboard.type(op.text);
        x.draft = { text: op.text, loads: x.loads, url: info.url };
      } else if (x.draft) {
        // Its words must still be in the box after every save since: held back from the dev server's reload, or put back after one.
        let now = null;
        await until(async () => (now = await x.info()).draft === x.draft.text, 4000 * slow, 150);
        if (now.draft !== x.draft.text) silent('draft-lost', `${x.id}: typed ${JSON.stringify(x.draft.text)} into a new comment on ${x.draft.url}; after the saves the box ${now.draft === null || now.draft === undefined ? 'is gone' : `holds ${JSON.stringify(now.draft)}`} (the page loaded ${x.loads - x.draft.loads} times meanwhile)`, { reloaded: x.loads > x.draft.loads ? 'yes' : 'no', ...where(x) });
        const text = x.draft.text;
        const want = keyOfPath(x.draft.url);
        x.draft = null;
        if (now.draft === text && op.send) {
          await x.page.keyboard.press('Enter');
          const c = await findByText(text);
          if (c) {
            if (c.key !== want) silent('comment-on-wrong-page', `step ${i}: ${x.id} shows ${now.url} (the lab's page ${want}) and its pin "${text}" was saved on ${c.key}`, { via: 'widget', reached: x.clientNav ? 'client-side' : 'page-load', ...where(x) });
            add(c, c.key, i, { via: 'widget' });
            byOp.set(i, c.id);
          }
        } else await x.page.keyboard.press('Escape').catch(() => {});
        await sleep(200);
      }
    } else if (op.t === 'count') {
      if (!d.real || !d.opened || devDown || labDown || d.draft || broken.size) return;
      const before = [await d.info(), d.control ? await d.info(true) : null];
      if (before[0].error || before[0].count === null) return;
      const loads = d.loads;
      for (let k = 0; k < op.k; k++) await d.both((p) => p.click('#count', { timeout: 3000 }));
      await sleep(250);
      const now = [await d.info(), d.control ? await d.info(true) : null];
      const grew = (a, b) => a && b && !a.error && !b.error && Number(b.count) - Number(a.count);
      // (Not judged when the page loaded again between the clicks: a count starts over then.)
      if (d.control && d.loads === loads && grew(before[1], now[1]) === op.k && grew(before[0], now[0]) !== op.k) silent('page-click-swallowed', `${d.id}: ${op.k} clicks on the page's own button counted ${grew(before[0], now[0])} through the lab and ${op.k} on the control`, { what: 'button', ...where(d) });
      st.counts.set(d.id, true);
      // The saves and restarts since a count are the laptop's (the one with a control, which the end compares): the
      // phone counting does not clear what happened since the laptop's count.
      if (d.control) {
        st.editsSinceCount = new Set();
        st.labRestartSinceCount = false;
      }
    } else if (op.t === 'dev-restart') {
      const t0 = Date.now();
      devDown = true;
      await dev.stop(op.sig);
      if (op.down) await sleep(op.down);
      if (op.tok && fileOf(op.file)) (write(fileOf(op.file), textOf(op.file, op.tok)), broken.delete(op.file), saved('code'));
      const again = await dev.start();
      devDown = false;
      devRestarts++;
      quietFrom.push([t0, Date.now() + 4000]);
      lastRestart = Date.now();
      if (!again) throw new Error(`the dev server did not start again: ${dev.log.trim().slice(-300)}`);
      // The pages find the dev server again by themselves (its client polls and reloads), through the lab as directly.
      for (const x of reals()) {
        if (x.control) await until(async () => !(await x.info(true)).error && (await x.info(true)).route, BOUND, 200);
        await after(x, 'a-dev-server-restart');
      }
    } else if (op.t === 'lab-restart') {
      const t0 = Date.now();
      labDown = true;
      await lab.stop(op.sig);
      const again = await lab.start();
      labDown = false;
      labRestarts++;
      st.labRestartSinceCount = true;
      quietFrom.push([t0, Date.now() + 6000]);
      lastRestart = Date.now() + 3000; // a restarted lab's pages catch up with a reload, seconds later
      if (!again.ok) throw new Error(`the lab did not start again: ${lab.log.slice(-300)}`);
      for (const x of reals()) await after(x, 'a-lab-restart');
    } else if (op.t === 'fetch') await fetches(op.seed, op.n);
    else if (op.t === 'ws') (await hmrSocket(op, devices[1].real ? '' : devices[1].cookie), saved('code'));
    else if (op.t === 'route-new') {
      const e = F.newRoute(op.n);
      extras.set(op.n, e);
      everKeys.add(e.key);
      write(e.file, F.pageText(op.tok, `extra${op.n}`));
    } else if (op.t === 'route-del') {
      const e = extras.get(op.n);
      if (!e) return;
      fs.rmSync(abs(e.file), { force: true });
      // A tab that sits on the route when its file goes shows the framework's "not found" (see the end).
      for (const x of reals()) if (x.page && routeOf(new URL(x.page.url(), 'http://x').pathname) === `extra${op.n}`) x.routeDeletedUnder = true;
      // (the route stays in the model: a step may make its file again, and its comments must be there then)
    } else if (op.t === 'route-mv') {
      const e = extras.get(op.n);
      if (!e || !fs.existsSync(abs(e.file))) return;
      const to = F.newRoute(op.to);
      // The route's file moves (git mv, an editor's rename): Next's route is its folder, the others' a file.
      if (path.basename(e.file) === path.basename(to.file)) fs.renameSync(path.dirname(abs(e.file)), path.dirname(abs(to.file)));
      else fs.renameSync(abs(e.file), abs(to.file));
      extras.delete(op.n);
      extras.set(op.to, to);
      everKeys.add(to.key);
      const mine = [...M.values()].filter((m) => m.key === e.key);
      if (!mine.length || labDown) return;
      // "Rename or move a page with mv: its comments follow the file" (skills/labit/SKILL.md).
      let all = [];
      const followed = await until(async () => {
        all = await everything();
        return mine.every((m) => all.find((c) => c.id === m.id)?.key === to.key);
      }, 4000 * slow, 100);
      if (followed) for (const m of mine) m.key = to.key;
      else silent('route-comments-did-not-follow-the-file', `${fw}: ${e.file} was renamed to ${to.file} (the route ${e.url} is now ${to.url}); its ${mine.length} comment${mine.length === 1 ? '' : 's'} ${mine.map((m) => `${m.id} on ${all.find((c) => c.id === m.id)?.key || 'no page'}`).join(', ')}, not on ${to.key}`, { lab: 'in-front-of-a-dev-server' });
    } else if (op.t === 'wait') await sleep(op.ms);
  };
  const rounds = new Map();
  plan.ops.forEach((op, i) => op && rounds.set(op.r, [...(rounds.get(op.r) || []), [op, i]]));
  for (const [, ops] of [...rounds].sort((a, b) => a[0] - b[0])) {
    await Promise.all(ops.map(([op, i]) => step(op, i)));
    // After a save (or a burst of them) the page shows it by the framework's own update: the widget is still there, once,
    // and its pins are where they were.
    const kinds = new Set(ops.map(([op]) => op.t));
    if (taken && (kinds.has('edit') || kinds.has('fix')) && !devDown && !labDown) {
      await sleep(700 * slow);
      for (const x of reals()) await after(x, kinds.has('fix') ? 'a-fixed-error' : 'a-save');
    }
  }

  // ---------- the end: every file whole, both servers up, drafts closed, then what does each observer hold? ----------
  note('the end');
  for (const id of [...broken]) (write(fileOf(id), textOf(id, TOK(9000000 + broken.size))), broken.delete(id), saved('code'));
  if (brokenAt && reals().some((x) => x.loadsAtBreak)) healed();
  for (const d of devices) {
    if (d.real && d.draft) {
      const now = await d.info();
      if (now.draft !== d.draft.text) silent('draft-lost', `${d.id}: typed ${JSON.stringify(d.draft.text)} into a new comment; at the end the box ${now.draft === null || now.draft === undefined ? 'is gone' : `holds ${JSON.stringify(now.draft)}`} (the page loaded ${d.loads - d.draft.loads} times meanwhile)`, { reloaded: d.loads > d.draft.loads ? 'yes' : 'no', ...where(d) });
      d.draft = null;
      await d.page.keyboard.press('Escape').catch(() => {});
    }
  }
  // The agent's last waits: its open wait ends, then it asks until it is handed nothing more.
  ending = true;
  waitOpen?.();
  await Promise.race([listening, sleep(3000)]);
  await sleep(200);
  for (let n = 0; n < 8; n++) {
    const r = await agentRq(lab, SESSION, '/_lab/wait', { timeout: 0.3, ack: true }, { timeout: 15000 }).catch((e) => ({ status: 0, text: String(e) }));
    if (r.status !== 200) {
      if (r.status !== 204) loud('wait-failed', `the agent's last wait answered ${r.status}: ${r.text.slice(0, 200)}`, { status: r.status });
      break;
    }
    for (const m of r.text.matchAll(/· id ([0-9a-f]{12})/g)) handed.add(m[1]);
    await agentRq(lab, SESSION, '/_lab/ack', { id: r.headers['x-lab-delivery'] }).catch(() => {});
  }

  // 1. The lab holds what was said yes to, each on its page, and so do the files in .lab.
  const restartTag = labRestarts || devRestarts ? { restarted: [labRestarts && 'lab', devRestarts && 'dev-server'].filter(Boolean).join('+') } : {};
  const all = await everything();
  // (A pin the widget sent late, after this test stopped looking for it, is still that step's pin.)
  for (const c of all) if (!M.has(c.id) && unsent.has(c.text)) (add(c, c.key, unsent.get(c.text).i, { via: 'widget' }), unsent.delete(c.text));
  for (const [text, u] of unsent) if (u.sent) silent('widget-pin-not-saved', `step ${u.i}: a pin typed into the widget on ${u.url} and sent with Enter ("${text}") is on no page of the lab at the end`, u.tags);
  for (const m of M.values()) {
    const c = all.find((x) => x.id === m.id);
    if (!c) silent('acknowledged-comment-missing', `${m.agent ? "the agent's" : "a person's"} ${m.parent ? 'reply' : 'pin'} ${m.id} (step ${m.op}, on ${m.key}) was answered 2xx and is on no page of the lab now`, { who: m.agent ? 'agent' : 'person', ...restartTag });
    else if (c.key !== m.key) silent('comment-moved-to-another-page', `${m.id} (step ${m.op}) was saved on ${m.key} and is on ${c.key} now`, restartTag);
    else if ((c.parent || null) !== m.parent) silent('comment-in-wrong-thread', `${m.id}: made in ${m.parent || 'its own thread'}, the lab has it in ${c.parent || 'its own thread'}`, restartTag);
  }
  for (const c of all) if (!M.has(c.id)) silent('comment-nobody-made', `the lab holds ${c.id} "${c.text.slice(0, 60)}" by ${c.name} on ${c.key}, which no step made`, restartTag);
  for (const [id, resolved] of toggled) {
    const c = all.find((x) => x.id === id);
    if (c && Boolean(c.resolved) !== resolved) silent('thread-state-wrong', `thread ${id}: the steps leave it ${resolved ? 'resolved' : 'open'}, the lab says ${c.resolved ? 'resolved' : 'open'}`, { want: resolved ? 'resolved' : 'open', ...restartTag });
  }
  let disk = {};
  const sameOnDisk = () => {
    disk = lab.store();
    return [...everKeys].every((k) => JSON.stringify(Object.values(disk[k] || {}).map((c) => c.id).sort()) === JSON.stringify(all.filter((c) => c.key === k).map((c) => c.id).sort()));
  };
  if (!(await until(sameOnDisk, 2500 * slow, 50))) {
    for (const k of everKeys) {
      const diff = diffComments(all.filter((c) => c.key === k), Object.values(disk[k] || {}), ['id']);
      if (diff.missing.length || diff.extra.length) silent('files-differ-from-the-lab', `.lab/comments for ${k}: missing ${diff.missing.join(' ') || '-'}, extra ${diff.extra.join(' ') || '-'}`, { what: diff.missing.length ? 'missing' : 'extra', ...restartTag });
    }
  }
  // 2. The agent: everything a person wrote in an open thread reached its wait (through the lab in front of the dev server).
  for (const m of M.values()) {
    const root = all.find((c) => c.id === (m.parent || m.id));
    if (m.agent || !root || root.resolved || !all.some((c) => c.id === m.id)) continue;
    if (!handed.has(m.id)) silent('message-never-reached-a-wait', `${m.parent ? 'the reply' : 'the pin'} ${m.id} (step ${m.op}, on ${m.key}) by a person is in an open thread and the agent's wait was never handed it`, { what: m.parent ? 'reply' : 'pin', agent: plan.cli ? 'labit-wait' : 'api', ...restartTag });
  }

  // 3. Raw devices: each holds what the lab would tell it now, kept up by the live stream through the lab alone.
  for (const d of devices.filter((x) => !x.real && x.opened)) {
    // A page that reloaded while the dev server was away got the lab's "no answer from the dev server … Start it, then
    // reload" page: said plainly, and nothing reloads it. The person reloads.
    if (d.dead && d.status === 502) {
      loud('page-left-on-the-labs-502', `${d.id}: its page reloaded while the dev server was restarting and got the lab's "no answer from the dev server" page; nothing reloads it once the dev server is back\n      ${d.id} log: ${d.log.slice(-6).join(' | ')}`, { when: 'a-dev-server-restart', device: d.kind });
      await d.open();
    }
    let want = [];
    let diff = { missing: [], extra: [], changed: [] };
    await until(async () => {
      await d.idle(300);
      want = (await rq(lab, { from: d.from, cookie: d.cookie, path: `/_lab/api/comments?page=${encodeURIComponent(d.attrs.page)}` })).json().comments;
      diff = diffComments(want, d.S.comments, ['id', 'resolved', 'text']);
      return !diff.missing.length && !diff.extra.length && !diff.changed.length;
    }, 5000 * slow, 60);
    const loading = (id) => (d.loads.some(([from, to]) => M.get(id)?.at >= from - 30 && M.get(id)?.at <= to + 30) || (!d.heard && M.get(id)?.at >= d.loadFrom - 30) ? { cond: 'made-while-the-page-loaded' } : {});
    for (const id of diff.missing) silent(M.get(id)?.agent ? 'agent-reply-missing-on-device' : 'comment-missing-on-device', `${d.id} (${d.kind} on ${d.attrs.page}) does not show ${id} (step ${M.get(id)?.op})\n      ${d.id} log: ${d.log.slice(-10).join(' | ')}`, { who: M.get(id)?.agent ? 'agent' : 'person', ...loading(id), device: d.kind, ...restartTag });
    for (const id of diff.extra) silent('device-shows-a-comment-the-lab-lacks', `${d.id} (${d.kind}) still shows ${id}, which the lab no longer has`, { device: d.kind, ...restartTag });
    for (const [id, field] of diff.changed) silent('device-shows-old-state', `${d.id} (${d.kind}) shows ${id}.${field} = ${JSON.stringify(d.S.comments.find((c) => c.id === id)?.[field])?.slice(0, 60)}, the lab says ${JSON.stringify(want.find((c) => c.id === id)?.[field])?.slice(0, 60)}`, { field, device: d.kind, ...restartTag });
  }

  // 4. Real browsers: the page shows the disk, with the widget once and every pin on its element.
  if (taken) {
    // (Behind a server with no live reload of its own nothing reloads a page: "the dev server reloads its own pages". A person reloads.)
    if (F.noReload) for (const d of reals()) await d.both((p) => p.reload({ waitUntil: 'load', timeout: 20000 }));
    const laptop = reals().find((x) => x.control);
    const tSettle = Date.now();
    for (const d of reals()) {
      let i = null;
      let wrong = [];
      // (A device left on a route whose file a step deleted shows the framework's "not found": nothing to compare.)
      const gone = routeOf((await d.info()).url || '/');
      if (gone?.startsWith('extra') && !fs.existsSync(abs(extras.get(Number(gone.slice(5))).file))) continue;
      const check = (info, route) => {
        const want = route ? wantOn(route) : {};
        return Object.entries(want).filter(([k, tok]) => tok && info.v?.[k] !== tok).map(([k, tok]) => ({ k, tok, got: info.v?.[k] ?? null }));
      };
      const ok = await until(async () => {
        i = await d.info();
        if (i.error) return false;
        wrong = check(i, routeOf(i.url));
        return i.route && !wrong.length;
      }, Math.max(1000, BOUND - (Date.now() - lastSave)), 200);
      if (ok) {
        ctx.time(`dev-servers: at the end, from the last save until a real browser showed it (${fw})`, Math.max(0, Date.now() - lastSave));
        continue;
      }
      if (!i || i.error) {
        ctx.add('harness', 'browser-page-unreadable', `${d.id}: ${i?.error}`, {});
        continue;
      }
      // What does the same page do with no lab in front? Only what the control gets right is the lab's.
      // The control counts only on the same route: the laptop's control on / says nothing of the phone's /about.
      const control = laptop ? await laptop.info(true) : null;
      const otherRoute = Boolean(control && !control.error && control.url && routeOf(control.url) !== routeOf(i.url));
      const c = otherRoute ? null : control;
      const controlWrong = c && !c.error ? (c.route ? check(c, routeOf(c.url)) : [{ k: 'page' }]) : null;
      const noControl = otherRoute ? `(the control is on another route, ${control.url}: nothing to compare)` : '(no control on this device)';
      const cause = devRestarts && labRestarts ? 'both-restarted' : devRestarts ? 'dev-server-restarted' : labRestarts ? 'lab-restarted' : 'no-restart';
      // A page that shows no route at all: what does the dev server itself answer at that address? Its own "not found"
      // or error page (a route it has not picked up) is the framework's, with or without the lab.
      const own = !i.route && (await ask({ port: dev.port, path: i.url, headers: NAVIGATE }));
      if (controlWrong?.length) ctx.add('unclear', 'framework-stale-without-the-lab', `${fw}: the control page (no lab) is stale too: ${c.route ? controlWrong.map((w) => `${w.k}=${w.got} for ${w.tok}`).join(', ') : `it shows no page of the project (${JSON.stringify((c.text || '').slice(0, 60))})`}`, {});
      // The page loaded while a file was broken (a restart reloaded it). Whether such a page recovers once the file is
      // fixed is the framework's: Vite only tells a page about the error it hit when that page's socket is already
      // connected, and keeps the error for the next page only when no page at all is connected (`!wss.clients.size`).
      // A real-browser case always has a second tab open (the control, the other device), so of two tabs that reload
      // at the same moment, whichever asks for the broken file first is told and recovers, and the other gets no overlay
      // and no reload, blank for good. That is the same with no lab at all (two tabs straight on the dev server, in both
      // engines), and a lone tab through the lab always recovers. So the control having loaded then too proves nothing.
      else if (d.loadedWhileBroken && (!i.route || wrong.every((w) => w.got === null || w.k !== 'page'))) ctx.add('unclear', 'page-loaded-while-a-file-was-broken-did-not-recover', `${fw}: ${d.id}'s page loaded while a source file held a syntax error (a restart reloaded it, with another tab open) and still shows ${i.route ? wrong.map((w) => `${w.k}=${w.got}`).join(', ') : 'no page'} after the fix; the control shows ${c && !c.error ? JSON.stringify(c.v) : '?'}`, {});
      // A tab was on a route when its file was deleted, and the file is back: the framework's "not found" page stays
      // (Astro's does not reload when the route returns, straight on the dev server too: the control on that very
      // address shows the same). What the lab must do is serve the page on a reload, as a person would.
      else if (d.routeDeletedUnder && !i.route && own?.status === 200 && (await d.page.reload({ waitUntil: 'load', timeout: 20000 }).then(() => until(async () => (await d.info()).route, 4000 * slow, 150)).catch(() => false))) ctx.add('unclear', 'framework-keeps-not-found-after-the-route-came-back', `${fw}: ${d.id} sat on ${i.url} when its file was deleted; after the file came back the tab still shows ${JSON.stringify(i.text.slice(0, 40))} (the dev server answers the page, and a reload through the lab shows it)`, {});
      else if (own && (own.status !== 200 || (!F.spa && fw !== 'webpack' && !/id="tok-page"/.test(own.buf?.toString('utf8') || '')))) ctx.add('unclear', 'framework-shows-no-page-without-the-lab', `${fw}: ${i.url} asked of the dev server directly answers ${own.status} with no page of the project either`, {});
      else if (!i.route) silent('page-blank-or-error-through-proxy', `${d.id} after ${Date.now() - lastSave} ms: ${i.url} through the lab shows no page (title "${i.title}", ${i.overlay ? 'an error overlay' : 'no overlay'}, text ${JSON.stringify(i.text.slice(0, 80))}), the control shows ${c ? `${c.route} at ${JSON.stringify(c.v)}` : noControl}`, { cause, ...(otherRoute ? { control: 'other-route' } : {}), ...where(d) });
      else silent('stale-through-proxy', `${d.id} after ${Date.now() - lastSave} ms on ${i.url}: ${wrong.map((w) => `${w.k} shows ${w.got}, the disk has ${w.tok}`).join('; ')}; the control page (no lab) ${c && !c.error ? `shows ${JSON.stringify(c.v)}` : otherRoute ? noControl : 'could not be read'}\n      the page loaded ${d.loads} times (the control ${laptop?.cloads ?? '-'}), ${i.overlay ? 'shows an error overlay' : 'shows no error overlay'}; its last console errors: ${d.errors.slice(-3).map((e) => `[${e.at - ctx.t0} ms] ${e.text.replace(/\s+/g, ' ').slice(0, 160)}`).join(' | ') || 'none'}`, { res: wrong.every((w) => w.got === null) ? 'the-page-s-scripts-did-not-run' : wrong[0].k, cause, ...(otherRoute ? { control: 'other-route' } : {}), ...where(d) });
    }
    for (const d of reals()) await after(d, 'the-end');
    // The agent's answers are in their threads on the page: the open pin's thread shows the words.
    for (const d of reals().filter((x) => x.kind === 'laptop')) {
      const i = await d.info();
      if (i.error) continue;
      const k = keyOfPath(i.url);
      const truth = everKeys.has(k) ? await list(k) : [];
      for (const m of [...M.values()].filter((x) => x.agent && x.key === k).slice(-2)) {
        const root = truth.find((c) => c.id === m.parent);
        if (!root || root.resolved || !i.pins?.some((p) => p.label.startsWith(`comment ${root.num} by `))) continue;
        await d.page.evaluate((n) => [...document.querySelectorAll('[data-lab-comments]')][0]?.shadowRoot.querySelector(`button.pin[aria-label^="comment ${n} by "]`)?.click(), root.num);
        const shown = await until(() => d.page.evaluate((t) => Boolean([...document.querySelectorAll('[data-lab-comments]')][0]?.shadowRoot.querySelector('.card')?.textContent.includes(t)), m.text).catch(() => false), 4000 * slow, 150);
        await d.page.keyboard.press('Escape').catch(() => {});
        await sleep(150);
        if (!shown) silent('agent-reply-missing-on-device', `${d.id} (${plan.browser}): the thread of pin ${root.num} on ${i.url} does not show the agent's answer "${m.text}" (${m.id})`, { who: 'agent', device: d.kind, browser: plan.browser, ...restartTag });
      }
    }
    // The page's own state: what the control still counts, the lab's page counts too.
    if (laptop && st.counts.get(laptop.id)) {
      const [a, c] = [await laptop.info(), await laptop.info(true)];
      if (!a.error && !c.error && Number(c.count) > 0 && a.count !== c.count) {
        const only = [...st.editsSinceCount];
        const tags = { after: !only.length ? 'no-save' : only.every((k) => k === 'css') ? 'css-only-saves' : 'code-saves', ...where(laptop) };
        // (A restarted lab makes its pages catch up by a reload: the contract does not say a restart keeps a page's state.)
        if (st.labRestartSinceCount) ctx.add('unclear', 'page-state-lost-over-a-lab-restart', `${fw}: the counter shows ${a.count} through the lab and ${c.count} on the control; the lab was restarted in between`, {});
        else silent('state-lost-through-proxy', `${fw}: the page's counter shows ${a.count} through the lab and ${c.count} on the control (the page through the lab loaded ${laptop.loads} times, the control ${laptop.cloads})`, tags);
      }
    }
    // Errors a browser's console shows only with the lab in front.
    const inWindow = (e) => quietFrom.some(([from, to]) => e.at >= from - 500 && e.at <= to);
    const base = new Set((laptop?.cerrors || []).map((e) => tidyError(e.text)));
    for (const d of reals()) {
      const seen = new Set();
      for (const e of d.errors.filter((x) => !inWindow(x))) {
        const t = tidyError(e.text);
        const kind = errorKind(e.text.replace(/\s+/g, ' '));
        // (The phone has no control of its own: its errors are judged by the laptop's. A failed load of the page's own
        // files, while one of them is broken or a server restarts, comes on both pages at their own moments: not judged.)
        if (base.has(t) || seen.has(kind) || kind === 'http-5xx' || kind === 'http-4xx') continue;
        seen.add(kind);
        loud('console-error-only-through-proxy', `${d.id} (${d.kind}, ${plan.browser}): the console shows an error the control page (no lab) never showed: ${e.text.replace(/\s+/g, ' ').slice(0, 420)}`, { kind, browser: plan.browser });
      }
    }
    // Nothing changes now: nothing may reload.
    if (laptop) {
      // A restarted lab makes its pages reload (the dev server's client lost its socket through the lab, and the widget
      // catches up by a reload): the page's state is gone though nothing was saved. The contract does not say.
      if (labRestarts && laptop.loads > laptop.cloads) ctx.add('unclear', 'page-reloaded-by-a-lab-restart', `${fw}: the page through the lab loaded ${laptop.loads} times in this case, the control ${laptop.cloads} times; the lab was restarted ${labRestarts} time${labRestarts === 1 ? '' : 's'}`, {});
      await sleep(Math.max(0, lastSave + 2500 - Date.now(), lastRestart + 7000 - Date.now()));
      const [a, c] = [laptop.loads, laptop.cloads];
      const phone = reals().find((x) => x !== laptop);
      const p0 = phone?.loads;
      await sleep(3000);
      const [mine, its] = [laptop.loads - a, laptop.cloads - c];
      if (mine && !its) silent('reload-loop', `${fw}: with no file saved for ${Math.round((Date.now() - lastSave) / 1000)} s, the page through the lab loaded ${mine} more time${mine === 1 ? '' : 's'} in 3 s; the control did not`, { when: 'quiet', ...where(laptop) });
      else if (mine && its) ctx.add('unclear', 'framework-reloads-when-quiet', `${fw}: both pages loaded again with nothing saved (${mine} through the lab, ${its} on the control)`, {});
      if (phone && phone.loads - p0 && !its) silent('reload-loop', `${fw}: with no file saved, the phone's page through the lab loaded ${phone.loads - p0} more time${phone.loads - p0 === 1 ? '' : 's'} in 3 s`, { when: 'quiet', ...where(phone) });
    }
  }

  // 5. Every route's page as the lab serves it, and a few of its files, against the dev server's own answers.
  for (const route of [...Object.keys(F.pages), ...[...extras.keys()].map((n) => `extra${n}`)]) {
    const url = urlOf(route);
    if (!url || (route.startsWith('extra') && !fs.existsSync(abs(extras.get(Number(route.slice(5))).file)))) continue;
    await compare({ what: 'page', path: url, headers: NAVIGATE });
  }
  await compare({ what: 'range', path: pub('pic.bin'), headers: { range: 'bytes=10-109' } });
  await compare({ what: 'asset-gzip', path: pub('big.txt'), headers: { 'accept-encoding': 'gzip' } });
  for (const u of (await assetsOf(F.pages.home.url)).slice(0, 4)) await compare({ what: 'asset', path: u, headers: { accept: '*/*', 'accept-encoding': 'gzip, deflate, br' } });
}

// A random source for one step (a step's requests must not depend on the steps left out).
function mulberry(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { float: next, int: (n) => Math.floor(next() * n), pick: (list) => list[Math.floor(next() * list.length)] };
}
