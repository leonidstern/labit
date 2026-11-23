// The labit plugin's wake for Claude Code: a pin left while the session that was listening isn't listening (its `wait`
// ended, or it never ran it again, or it is busy building) comes in as a new turn, the way a person's message would.
// Without it, a pin after the agent stopped listening reached nobody until the person came back to the chat.
//
// Every few seconds it asks each lab this session may be listening on GET /_lab/pending: pins no wait has been handed
// yet, whether a wait is open, and which session listened last. It wakes only that session, only when nothing is
// listening, and once per set of pins. The turn tells the agent to run `wait`, which hands the pins over as always
// (and the lab marks them, so the same pins never wake it twice). Other agents (Codex, Cursor...) keep using `wait`.
//
// Even while the session is busy mid-turn the wake is submitted (`$.prompt.submit` queues it as the next turn, which
// starts the moment the current one ends), so a long build never leaves pins sitting. Only a pin that is still
// unheard on two looks in a row is queued then, so an agent about to run `wait` itself isn't woken for nothing.
//
// Routing and retries (#420): each look says this session, so the lab answers with this session's pins alone (two
// sessions listening on two pages each get woken for their own). One wake at a time: while the turn a wake started is
// running, more pins queue nothing (that turn ends by listening again, which hears them; if it doesn't, the next idle
// look wakes it). A wake that never started a turn is sent again, TRIES in all for one set of pins, then left to `wait`.
//
// Progress: a pin somebody claimed (the agent said `reply --progress` or `--on-it` on it) keeps its status line alive while
// this session itself runs tools, at most one renewal per pin a minute. A renewal moves only the line's time: the agent's
// own words stay on the pin ("session activity" only where it wrote none). The lab counts a status line as a sign only for
// 3 minutes (PROGRESS_MS), so a session that moved on to something else lets it lapse and the pin goes grey, and it lists
// a pin for renewal only for 10 minutes after the agent itself last said something on it (CLAIM_LIFE_MS, #425). A helper's tool calls never renew it, and a pin nobody claimed gets no line.
//
// Labs: the one in the session's folder (.lab/server.json, or above), and every lab whose registry file
// (~/.labit/servers/<port>.json, what `labit list` reads) names this session as its listener, so it also works when the
// session's folder is somewhere else. Localhost only, a few labs at most, and each look is quick.
import type { Register } from 'claude-code';

const EVERY_MS = 4000;
const MAX_LABS = 4; // labs one look asks, at most
const MAX_FILES = 40; // registry files one look reads, at most
type Pending = { working?: { page: string; id: string }[]; fresh: number; pages: string[]; key: string; listening: boolean; last: string; for?: string; dir: string; cmd: string; url: string };
type Lab = { port: number; key: string };

let busy = false; // a main-loop turn is running
const told = new Map<number, string>(); // lab port -> the set of pins this session was last woken for
let heard = ''; // port:key seen unheard while busy, on the look before
let timer: { cancel: () => void } | null = null;
const PROGRESS_MS = 60000; // a pin's progress line is renewed once a minute at most
const WORKING_MS = 15000; // how long the list of pins being worked on is kept before it is asked for again
let working: { lab: Lab; page: string; id: string }[] = [];
let workingAt = -Infinity;
const noted = new Map<string, number>(); // lab port + pin id -> when its line was last written
// When the last wake was submitted, until its turn starts. A wake the person cancels (Escape takes it out of the
// queue) never starts a turn: after SUBMIT_MS it counts as not delivered, and the same pins may wake the session again.
// A wake queued behind a running turn starts that clock when the turn ends (`queued`), not before.
let submittedAt = 0;
let queued = false;
const SUBMIT_MS = 15000;
const TRIES = 3; // wakes for one set of pins, at most
const tries = new Map<string, number>(); // port:key -> wakes sent for it
let woke = false; // the running turn is one a wake started
// Claude Code refuses a submit after the person stopped the session (Escape) until they send something: the submit
// resolves with { drop: why } (it doesn't reject). A refused wake was never a try: it doesn't count, and no wake is sent until a turn starts again (the person's), which ends by
// waking the session for the pins still unheard.
let refused = false;
// The lab answers for this session (`for`); a lab from before #420 doesn't, and then only the one that listened last counts.
const mine = (p: Pending | null, me: string) => Boolean(p) && (p!.for ? p!.for === me : p!.last === me);
const ask = ($: any, lab: Lab, me: string) =>
  $.http.fetch(`http://127.0.0.1:${lab.port}/_lab/pending?for=${encodeURIComponent(me)}`, {
    headers: { host: `localhost:${lab.port}`, 'x-lab-admin': lab.key, 'x-lab-agent': '1' },
  });

// The lab's address and the agent's key, from .lab/server.json in a folder or one above it.
async function labAt($: any, dir: string, port?: number): Promise<Lab | null> {
  for (;;) {
    try {
      const s = JSON.parse(await $.fs.read(`${dir}/.lab/server.json`));
      if (s && Number(s.port) && (!port || Number(s.port) === port)) return { port: Number(s.port), key: String(s.agent || s.token || '') };
    } catch {}
    if (port) return null; // a registry root is the lab's own folder: no looking above it
    const up = dir.replace(/\/[^/]+\/?$/, '');
    if (!up || up === dir) return null;
    dir = up;
  }
}

// Labs whose registry file names this session as the one that listened last: found from any folder.
async function registered($: any, me: string): Promise<Lab[]> {
  const found: Lab[] = [];
  try {
    const home = (await $.env.get('LABIT_HOME')) || `${(await $.env.get('HOME')) || ''}/.labit`;
    const dir = `${home}/servers`;
    for (const f of (await $.fs.list(dir)).slice(0, MAX_FILES)) {
      if (found.length >= MAX_LABS) break;
      if (!/^\d+\.json$/.test(f.name)) continue;
      try {
        const r = JSON.parse(await $.fs.read(`${dir}/${f.name}`));
        if (r?.listener !== me || !Number(r.port) || typeof r.root !== 'string') continue;
        const lab = await labAt($, r.root, Number(r.port));
        if (lab) found.push(lab);
      } catch {}
    }
  } catch {}
  return found;
}

async function labsFor($: any, me: string): Promise<Lab[]> {
  const labs: Lab[] = [];
  const here = await labAt($, await $.session.cwd());
  if (here) labs.push(here);
  for (const l of await registered($, me)) if (!labs.some((x) => x.port === l.port)) labs.push(l);
  return labs.slice(0, MAX_LABS);
}

// The status line a tool call renews on a pin: only that the session is active (the pin shows "session activity · 1 min
// ago"), never the call itself: a command is not an answer, and helpers' commands are about other work.
const LINE = 'session activity';

// Renew the status line of the pins somebody claimed (the lab lists only those; at most one renewal per pin a minute).
async function note($: any, line: string): Promise<void> {
  const now = await $.clock.now();
  if (now - workingAt > WORKING_MS) {
    workingAt = now;
    const me = await $.session.id();
    const list: typeof working = [];
    for (const lab of await labsFor($, me)) {
      try {
        const res = await ask($, lab, me);
        const p: Pending = res.ok ? JSON.parse(res.text) : null;
        if (mine(p, me)) for (const w of p.working || []) list.push({ lab, ...w });
      } catch {}
    }
    working = list;
  }
  for (const w of working) {
    const key = `${w.lab.port}:${w.id}`;
    if (now - (noted.get(key) ?? -Infinity) < PROGRESS_MS) continue;
    noted.set(key, now);
    void $.http
      .fetch(`http://127.0.0.1:${w.lab.port}/_lab/api/comments`, {
        method: 'POST',
        headers: { host: `localhost:${w.lab.port}`, 'x-lab-admin': w.lab.key, 'x-lab-agent': '1', 'content-type': 'application/json' },
        body: JSON.stringify({ page: w.page, action: 'progress', id: w.id, text: line, renew: true }), // renew: only its time moves, the agent's words stay
      })
      .catch(() => {});
  }
}

// Only the session's own tool calls count: a helper it started (agentId set) works on whatever it was given.
async function progress($: any, e: any): Promise<void> {
  if (e?.tool && e.agentId === undefined) await note($, LINE);
}

// A wake that never got in: the try is taken back, and nothing more is sent until a turn starts (the person's).
function undelivered(key: string, port: number): void {
  tries.set(key, Math.max(0, (tries.get(key) || 1) - 1));
  told.delete(port);
  submittedAt = 0;
  queued = false;
  refused = true;
}

async function look($: any): Promise<void> {
  if (submittedAt) {
    if ((await $.clock.now()) - submittedAt < SUBMIT_MS) return;
    submittedAt = 0;
    told.clear();
  }
  if (refused) return; // the session was stopped: nothing gets in until the person writes
  if (queued) return; // already in the queue behind the running turn; its end starts the clock
  if (busy && woke) return; // the wake's own turn is running: it listens again at its end
  const me = await $.session.id();
  for (const lab of await labsFor($, me)) {
    let p: Pending;
    try {
      const res = await ask($, lab, me);
      if (!res.ok) continue;
      p = JSON.parse(res.text);
    } catch {
      continue; // no lab running there
    }
    if (!p.fresh || p.listening || p.key === told.get(lab.port) || submittedAt || queued) continue;
    if (!mine(p, me)) continue; // another session's pins, or a lab this session never listened on
    const sent = tries.get(`${lab.port}:${p.key}`) || 0;
    if (sent >= TRIES) continue; // woken that often for these pins and never came: `wait` hands them over when it listens
    if (busy) {
      const now = `${lab.port}:${p.key}`;
      if (heard !== now) {
        heard = now; // wait one more look: the agent may be about to run `wait` itself
        return;
      }
    }
    told.set(lab.port, p.key);
    tries.set(`${lab.port}:${p.key}`, sent + 1);
    if (busy) queued = true;
    else submittedAt = await $.clock.now(); // its turn starts once the session is idle; don't submit twice meanwhile
    const n = p.fresh === 1 ? 'A new pin' : `${p.fresh} new pins`;
    // No page names here: this text is a turn of its own, and a page's path is whatever a comment was posted to (a
    // guest on the wifi can post one). `wait` names the pages, in text marked as the lab's.
    const key = `${lab.port}:${p.key}`;
    void Promise.resolve($.prompt.submit({
      text:
        `labit: ${n} (${p.url}) while you weren't listening${busy ? ' (queued while you were busy)' : ''}. ` +
        `Run \`${p.cmd} wait --timeout 5\` in ${p.dir} to read them (nothing new means you already have them), ` +
        `read each thread whole (the page or section is not the question), answer each on its pin with reply, then listen again in the background as before (\`wait --bg\`).`,
    })).then(
      (r: any) => { if (r?.drop !== undefined) undelivered(key, lab.port); }, // { drop: why }: refused, or taken out of the queue
      () => undelivered(key, lab.port),
    );
    return;
  }
  heard = ''; // nothing waiting: the next pin starts its count again
}

export const register: Register = (on) => {
  // A tool call by this session or a helper of it: the pins being worked on show it. Never delays the call.
  on('tool.call', ($, e, next) => {
    void progress($, e).catch(() => {});
    return next(e);
  });
  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) {
      busy = true;
      refused = false;
      woke = Boolean(submittedAt || queued); // the wake's turn (a queued one starts right after the turn it waited for)
      submittedAt = 0;
      queued = false;
    }
    return next(e);
  });
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      busy = false;
      woke = false;
      if (queued) {
        queued = false;
        submittedAt = await $.clock.now(); // the queued wake's turn should start now; if it doesn't, it counts as lost
      }
    }
    return next(e);
  });
  on('session.start', async ($, e, next) => {
    const out = await next(e);
    timer?.cancel();
    timer = $.clock.every(EVERY_MS, () => {
      void look($).catch(() => {});
    });
    return out;
  });
};
