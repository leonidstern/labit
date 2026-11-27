// Loaded into every node process of a ci/reach.mjs run (NODE_OPTIONS=--import): never in a normal test run.
// - In a test: every Chromium page records which lines of labit's scripts (/_lab/*.js) ran, written to
//   $LABIT_REACH_OUT/<pid>.json as { url: [generated lines] } when the process ends.
// - In a lab (and any other node process): NODE_V8_COVERAGE, set by ci/reach.mjs, records the server's lines, but node
//   writes it only on a normal exit: a SIGTERM (how tests end their labs) ends the process through process.exit here,
//   after any handler of the lab's own had its turn.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

process.on('SIGTERM', () => setTimeout(() => process.exit(143), 50));
process.on('SIGINT', () => setTimeout(() => process.exit(130), 50));

const OUT = process.env.LABIT_REACH_OUT;
const require = createRequire(path.join(process.cwd(), 'x.js'));
let pw = null;
for (const paths of [undefined, (process.env.NODE_PATH || '').split(path.delimiter)]) {
  try {
    pw = require(require.resolve('playwright', paths && { paths }));
    break;
  } catch {}
}

const seen = new Map(); // url -> Set of generated lines that ran
const classes = new Set(); // every class an element in labit's shadow roots wore while the test ran: what its CSS styled

function record(entries) {
  for (const e of entries) {
    if (!/\/_lab\/[\w-]+\.js(\?|$)/.test(e.url) || !e.source) continue;
    const url = e.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '');
    // Block coverage: ranges nest, the innermost one says whether its code ran. Painted per character, outermost
    // first; a line ran when any of its characters (not spaces) did, so a branch not taken on a line that ran doesn't
    // erase it. The same as linesRan in ci/reach.mjs.
    const src = e.source;
    const paint = new Uint8Array(src.length);
    const ranges = e.functions.flatMap((f) => f.ranges).sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
    for (const r of ranges) paint.fill(r.count > 0 ? 1 : 0, r.startOffset, r.endOffset);
    const ran = [];
    let line = 1;
    let on = false;
    for (let i = 0; i <= src.length; i++) {
      const c = i < src.length ? src.charCodeAt(i) : 10;
      if (c === 10) {
        if (on) ran.push(line);
        line++;
        on = false;
      } else if (c > 32 && paint[i]) on = true;
    }
    let set = seen.get(url);
    if (!set) seen.set(url, (set = new Set()));
    for (const l of ran) set.add(l);
  }
}

if (OUT && pw?.chromium) {
  const proto = Object.getPrototypeOf(pw.chromium);
  const launch = proto.launch;
  const pages = new Set();
  const stop = async (p) => {
    if (!pages.delete(p)) return;
    try {
      record(await p.coverage.stopJSCoverage());
    } catch {}
  };
  const watchPage = async (p) => {
    try {
      await p.exposeBinding('__labReachClasses', (_, list) => list.forEach((c) => classes.add(c)));
      // Every 300 ms and on each change: the classes in open shadow roots (labit's widget, board view, parts).
      await p.addInitScript(() => {
        const sent = new Set();
        const sweep = () => {
          const fresh = [];
          const visit = (root) => {
            for (const el of root.querySelectorAll('*')) {
              for (const c of el.classList) if (!sent.has(c)) (sent.add(c), fresh.push(c));
              if (el.shadowRoot) visit(el.shadowRoot);
            }
          };
          for (const el of document.querySelectorAll('*')) if (el.shadowRoot) visit(el.shadowRoot);
          for (const c of document.documentElement.classList) if (!sent.has(c)) (sent.add(c), fresh.push(c));
          if (fresh.length) window.__labReachClasses?.(fresh);
        };
        setInterval(sweep, 300);
        addEventListener('pagehide', sweep);
      });
      await p.coverage.startJSCoverage({ resetOnNavigation: false });
      pages.add(p);
      const close = p.close.bind(p);
      p.close = async (...a) => (await stop(p), close(...a));
    } catch {}
    return p;
  };
  const watchContext = (ctx) => {
    const newPage = ctx.newPage.bind(ctx);
    ctx.newPage = async (...a) => watchPage(await newPage(...a));
    const close = ctx.close.bind(ctx);
    ctx.close = async (...a) => {
      await Promise.all(ctx.pages().map(stop));
      return close(...a);
    };
    return ctx;
  };
  proto.launch = async function (...a) {
    const b = await launch.apply(this, a);
    if (this.name() !== 'chromium') return b;
    const newContext = b.newContext.bind(b);
    b.newContext = async (...x) => watchContext(await newContext(...x));
    const newPage = b.newPage.bind(b);
    b.newPage = async (...x) => watchPage(await newPage(...x));
    const close = b.close.bind(b);
    b.close = async (...x) => {
      await Promise.all([...pages].map(stop));
      return close(...x);
    };
    return b;
  };
  const write = () => {
    if (!seen.size && !classes.size) return;
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `${process.pid}.json`), JSON.stringify({ ...Object.fromEntries([...seen].map(([u, s]) => [u, [...s]])), '#classes': [...classes] }));
  };
  // A test that ends without closing its browser: what its pages ran so far.
  const end = process.exit.bind(process);
  process.exit = (code) => {
    const left = [...pages];
    if (!left.length) return (write(), end(code));
    Promise.race([Promise.all(left.map(stop)), new Promise((r) => setTimeout(r, 3000))]).then(() => (write(), end(code)));
  };
  process.on('beforeExit', write);
}
