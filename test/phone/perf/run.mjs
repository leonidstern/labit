// How fast a phone opens and closes a thread's sheet, measured in Mobile Safari in the iOS simulator. Not part of `npm test`
// or CI: it needs a booted simulator and a real page. The numbers come from inside the page (probe.js), not screenshots.
//
//   PERF_PORT=4720 node test/phone/perf/run.mjs serve <site> [--lab <local.mjs>] [--sim <udid>] [--fresh]
//       copies <site> (without its .lab) to a work folder, puts probe.js on its pages, starts a lab of the build at --lab
//       (default: this checkout) on PERF_PORT and the recorder's sink on PERF_PORT + 1, and opens the page in the
//       simulator. Every other command takes the same PERF_PORT.
//       The copy and its .lab are kept between runs (--fresh starts over), so two builds are timed on the same comments.
//   node test/phone/perf/run.mjs seed <pins.json>         [{ "selector": "#x", "text": "…", "replies": 3 }, …] on /index
//   node test/phone/perf/run.mjs bench [--pins 1,7] [--n 7] [--label before]
//       in the page, by script: for each pin number, n times: scroll it to 237 px from the top, click it (a phone opens the
//       sheet as a tap does), then click the dimmed page to close it. Prints the medians.
//   node test/phone/perf/run.mjs bench-new [--n 5] [--x 100 --y 318 --sy 1803] [--label before]
//       in the page, by script: a new comment held at (x, y) with the page scrolled to sy, lifted, then dropped by a
//       click on the dimmed page. The open counts from the hold (400 ms after touch-down), its handler is the hold's work.
//   node test/phone/perf/run.mjs label <name>             names the real touches that follow (sanity runs with the simulator)
//   node test/phone/perf/run.mjs report [--label x]       medians of every recorded run, by label
//   node test/phone/perf/run.mjs ask "<js>"               runs JavaScript in the page (`shadow`: the widget's shadow root)
//
// What the columns mean (ms; a touch's runs count from the finger's lift, a scripted one's from the dispatch):
//   visible  first frame where the dimmed page has started to fade (in on open, out on close): the sheet visibly moves
//   settled  last frame where the sheet, the dimmed page, the scroll or the keyboard still changed
//   handler  time the click's handlers kept the page busy (the widget's render and what it reads)
//   >34      frames that took more than 34 ms (two or more frames at 60 Hz) between the dispatch and settled
//   max      the longest frame in that span
//   event    the longest Event Timing entry (handling + next paint) in it, where the browser reports them
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// One work folder per port (PERF_PORT, default 4720): two runs can time side by side without sharing a log.
const PORT = Number(process.env.PERF_PORT) || 4720;
const WORK = path.join(os.tmpdir(), `labit-phone-perf-${PORT}`);
const SITE = path.join(WORK, 'site');
const LOG = path.join(WORK, 'log.jsonl');
const ASK = path.join(WORK, 'ask.js');
const STATE = path.join(WORK, 'state.json');
const [cmd, ...args] = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : dflt);
const state = () => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(WORK, { recursive: true });

const lines = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);

async function ask(js, wait = 60000) {
  const from = Date.now();
  fs.writeFileSync(ASK, js);
  for (let t = 0; t < wait; t += 250) {
    await sleep(250);
    const a = lines().find((l) => l.why === 'answer' && l.at >= from);
    if (a) return a.answer;
  }
  return 'no answer (is the page open in the simulator, in front?)';
}

// One run's numbers.
function measure(r) {
  const lift = r.ev.find((e) => e.type === 'touchend' || e.type === 'pointerup' || e.type === 'script')?.t ?? r.t0;
  const opening = r.pre.k === '-';
  let visible = null;
  let last = null;
  let prev = r.pre.s;
  for (const f of r.frames) {
    if (visible == null && (opening ? f.k !== '-' && f.so > 0 && !f.a.includes('data-opening') : f.so < r.pre.so)) visible = f.raf;
    if (f.s !== prev) last = f.raf;
    prev = f.s;
  }
  const rafs = r.frames.map((f) => f.raf);
  const gaps = [];
  // From the dispatch to the first frame too, when no frame came before it (else that wait counts nowhere).
  if (rafs.length && rafs[0] >= r.t0 && (last == null || rafs[0] <= last + 34)) gaps.push(rafs[0] - r.t0);
  for (let i = 1; i < rafs.length; i++) if (rafs[i] >= r.t0 && (last == null || rafs[i] <= last + 34)) gaps.push(rafs[i] - rafs[i - 1]);
  return {
    label: r.label + (r.label.endsWith(':open') || r.label.endsWith(':close') ? '' : opening ? ':open' : ':close'),
    visible: visible == null ? null : Math.round(visible - lift),
    settled: last == null ? null : Math.round(last - lift),
    handler: r.clicks[0]?.handler ?? null,
    long: gaps.filter((g) => g > 34).length,
    max: gaps.length ? Math.round(Math.max(...gaps)) : null,
    event: r.entries.length ? Math.max(...r.entries.map((e) => e.dur)) : null,
    missed: visible == null && r.ev.some((e) => e.type === 'touchend') && !r.clicks.length, // a tap whose click never came
  };
}
const median = (a) => {
  const s = a.filter((x) => x != null).sort((x, y) => x - y);
  return s.length ? s[(s.length - 1) >> 1] : '-';
};
function report(filter, since = 0) {
  const by = new Map();
  for (const l of lines()) {
    if (l.why !== 'run' || l.at < since) continue;
    const m = measure(l);
    if (filter && !m.label.startsWith(filter)) continue;
    (by.get(m.label) || by.set(m.label, []).get(m.label)).push(m);
  }
  const rows = [['run', 'n', 'visible', 'settled', 'handler', '>34', 'max', 'event', 'missed taps']];
  for (const [label, ms] of by) {
    const ok = ms.filter((m) => !m.missed && m.visible != null);
    rows.push([label, ok.length, median(ok.map((m) => m.visible)), median(ok.map((m) => m.settled)), median(ok.map((m) => m.handler)), median(ok.map((m) => m.long)), median(ok.map((m) => m.max)), median(ok.map((m) => m.event)), ms.filter((m) => m.missed).length]);
  }
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  for (const r of rows) console.log(r.map((c, i) => String(c).padEnd(w[i])).join('  '));
}

if (cmd === 'serve') {
  const from = path.resolve(args[0] || '.');
  const port = PORT;
  const lab = path.resolve(opt('lab', path.join(HERE, '../../../local.mjs')));
  if (args.includes('--fresh') || !fs.existsSync(SITE)) {
    fs.rmSync(SITE, { recursive: true, force: true });
    fs.cpSync(from, SITE, { recursive: true, filter: (f) => path.basename(f) !== '.lab' });
  }
  fs.copyFileSync(path.join(HERE, 'probe.js'), path.join(SITE, 'labit-perf-probe.js'));
  for (const f of fs.readdirSync(SITE).filter((f) => f.endsWith('.html'))) {
    const p = path.join(SITE, f);
    const html = fs.readFileSync(p, 'utf8').replace(/<script src="\/labit-perf-probe\.js"[^>]*><\/script>/g, '');
    fs.writeFileSync(p, html.replace(/<\/head>|<body/i, (m) => `<script src="/labit-perf-probe.js" data-sink="${port + 1}"></script>${m}`));
  }
  http.createServer((req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    if (req.method === 'OPTIONS') return res.end();
    if (req.url.startsWith('/ask')) {
      const js = fs.existsSync(ASK) ? fs.readFileSync(ASK, 'utf8') : '';
      fs.rmSync(ASK, { force: true });
      return res.end(js);
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try { fs.appendFileSync(LOG, JSON.parse(body).lines.map((l) => JSON.stringify(l)).join('\n') + '\n'); } catch {}
      res.end();
    });
  }).on('error', (e) => (console.error(`sink on ${port + 1}: ${e.message}`), process.exit(1))).listen(port + 1, '0.0.0.0', () => {
    fs.writeFileSync(STATE, JSON.stringify({ port, lab }));
    const child = spawn(process.execPath, [lab, '--new', '--no-open', '--no-wifi', '--port', String(port), '--name', 'phone perf'], { cwd: SITE, stdio: 'inherit', env: { ...process.env, LABIT_EXIT_WITH_PARENT: '1', LABIT_NO_UPDATE_CHECK: '1' } });
    const sim = opt('sim');
    if (sim) setTimeout(() => {
      try { execFileSync('xcrun', ['simctl', 'terminate', sim, 'com.apple.mobilesafari']); } catch {} // old tabs keep answering
      execFileSync('xcrun', ['simctl', 'openurl', sim, `http://127.0.0.1:${port}/`]); // 127.0.0.1: Safari tries IPv6 first for localhost
    }, 2500);
    for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => (child.kill(), process.exit(0)));
    child.on('exit', () => process.exit(0));
  });

} else if (cmd === 'seed') {
  const { lab } = state();
  for (const p of JSON.parse(fs.readFileSync(args[0], 'utf8'))) {
    const out = execFileSync(process.execPath, [lab, 'pin', p.selector, p.text, '--page', '/index', '--no-check'], { cwd: SITE, encoding: 'utf8' });
    const id = /Pinned (\w+)/.exec(out)?.[1];
    for (let i = 0; i < (p.replies || 0); i++) execFileSync(process.execPath, [lab, 'reply', id, `reply ${i + 1}: a longer answer with a couple of lines, so the thread's messages scroll a little on a phone.`, '--page', '/index'], { cwd: SITE });
    console.log(`${id} ${p.selector}`);
  }
} else if (cmd === 'bench') {
  const pins = (opt('pins', '7')).split(',').map(Number);
  const label = opt('label', '');
  const since = Date.now();
  console.log(await ask(`__perf.bench(${JSON.stringify({ pins, n: Number(opt('n', 7)), label: label ? `${label}:` : '' })})`, 600000));
  await sleep(800);
  report(label, since);
} else if (cmd === 'bench-new') {
  const label = opt('label', '');
  const since = Date.now();
  const o = { n: Number(opt('n', 5)), x: Number(opt('x', 100)), y: Number(opt('y', 318)), sy: Number(opt('sy', 1803)), label: label ? `${label}:` : '' };
  console.log(await ask(`__perf.benchNew(${JSON.stringify(o)})`, 600000));
  await sleep(800);
  report(label, since);
} else if (cmd === 'label') {
  console.log(await ask(`(window.__perfLabel = ${JSON.stringify(args[0] || '')}, 'ok')`));
} else if (cmd === 'report') {
  report(opt('label', ''));
} else if (cmd === 'ask') {
  console.log(await ask(args.join(' ')));
} else {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
}
