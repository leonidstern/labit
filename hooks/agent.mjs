// labit for Codex, Cursor and opencode, no MCP: what the Claude Code plugin's hook (wake.ts) does, for agents that run a
// command on their events (Codex, Cursor) or load a plugin (opencode). One file, no packages.
//
//   node agent.mjs progress   a tool call by the session: keeps the status line of the pins it claimed alive
//   node agent.mjs wake       the session stopped: pins nobody was handed come in as its next turn
//   node agent.mjs prompt     Codex: the person wrote: pins nobody was handed come with their message (Codex has no
//                             idle event, so a pin left while it sat idle reached it only at the end of that turn)
//   node agent.mjs start      Cursor's session start: tells the shells which session this is (LAB_SESSION_ID)
//   opencode 2: copy this file to .opencode/plugins/labit.js (its default export is the plugin)
//
// Same rules as the Claude Code hook (PR #321): a status line only for a pin the session claimed (the lab lists those) and
// only while this session itself runs tools, at most one renewal per pin a minute (the lab counts a line for 3 minutes);
// the line says "session activity", never the command; the wake goes only to the session that listened last, once per set
// of pins, and names no page (a guest's pin can name anything). A helper's tool calls renew nothing.
//
// Each look says its session (#420), so the lab answers with that session's pins alone: two sessions listening on two
// pages each get woken for their own. A wake whose pins are still unhanded at the next stop was not acted on: it is sent
// once more (TRIES in all for one set of pins), never in a loop; `wait` stays what hands pins over.
//
// The session is the id the agent's `wait` and `reply` sign with: Codex CODEX_THREAD_ID, Cursor CURSOR_CONVERSATION_ID,
// opencode OPENCODE_SESSION_ID (each the id its hooks get), so the lab's "listened last" is the same id here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const MAX_LABS = 4;
const PROGRESS_MS = 60000; // a pin's status line is renewed once a minute at most
const WORKING_MS = 15000; // the list of claimed pins is kept this long before the lab is asked again
const LINE = 'session activity'; // the whole status line: a command is not an answer, and helpers' commands are other work
const TRIES = 3; // wakes for one set of pins, at most (as wake.ts): a stop hook that blocks again and again would never let the session stop

// ~/.labit (or LABIT_HOME): the registry of running labs is its servers/ folder.
const servers = () => path.join(process.env.LABIT_HOME || path.join(os.homedir(), '.labit'), 'servers');
// The lab's address and the agent's key, from .lab/server.json in a folder or one above it. Only while that lab runs:
// its registry file (servers/<port>.json, written while it runs, removed as it stops) names the same pid, as in wake.ts
// (#627). A server.json a lab left behind (it was killed) would send its key to whatever answers on that port now.
function labAt(dir, port) {
  for (;;) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, '.lab/server.json'), 'utf8'));
      if (Number(s?.port) && (!port || Number(s.port) === port)) {
        const r = JSON.parse(fs.readFileSync(path.join(servers(), `${Number(s.port)}.json`), 'utf8'));
        return Number(r?.pid) > 0 && Number(r.pid) === Number(s.pid) ? { port: Number(s.port), key: String(s.agent || s.token || '') } : null;
      }
    } catch {}
    const up = path.dirname(dir);
    if (port || up === dir) return null; // a registry root is the lab's own folder: no looking above it
    dir = up;
  }
}
// The lab in the session's folder, then the labs whose registry file (what `labit list` reads) names this session as the
// one that listened last, so it also works when the session's folder is somewhere else.
function labsFor(cwd, me) {
  const labs = [];
  const here = cwd && labAt(path.resolve(cwd));
  if (here) labs.push(here);
  try {
    const dir = servers();
    for (const f of fs.readdirSync(dir).filter((n) => /^\d+\.json$/.test(n)).slice(0, 40)) {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (r?.listener !== me || typeof r.root !== 'string') continue;
        const lab = labAt(r.root, Number(r.port));
        if (lab && !labs.some((l) => l.port === lab.port)) labs.push(lab);
      } catch {}
    }
  } catch {}
  return labs.slice(0, MAX_LABS);
}

// node:http, not fetch: the lab checks the Host header, and fetch won't set it.
const call = (lab, method, url, body) =>
  new Promise((resolve) => {
    const data = body && JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port: lab.port, path: url, method, timeout: 3000,
        headers: { host: `localhost:${lab.port}`, 'x-lab-admin': lab.key, 'x-lab-agent': '1', ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) } },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => { try { resolve(res.statusCode === 200 ? JSON.parse(text) : null); } catch { resolve(null); } });
      },
    );
    req.on('error', () => resolve(null)).on('timeout', () => req.destroy());
    req.end(data);
  });
// The lab answers for this session (`for`); a lab from before #420 doesn't, and then only the one that listened last counts.
const pending = (lab, sid) => call(lab, 'GET', `/_lab/pending?for=${encodeURIComponent(sid)}`);
const mine = (p, sid) => Boolean(p) && (p.for ? p.for === sid : p.last === sid);

// What this session remembers between calls (a hook is a new process each time): when each pin's line was last written,
// the claimed pins the lab named, and the set of pins it was last woken for.
const stateFile = (sid) => path.join(os.tmpdir(), `labit-hook-${sid}.json`);
const load = (sid) => { try { return JSON.parse(fs.readFileSync(stateFile(sid), 'utf8')); } catch { return {}; } };
const save = (sid, s) => { try { fs.writeFileSync(stateFile(sid), JSON.stringify(s)); } catch {} };
const safe = (sid) => typeof sid === 'string' && /^[\w-]{1,100}$/.test(sid);

// Renew the status line of the pins this session claimed (the lab lists only those, and only for the session that listened last).
async function progress(sid, cwd, now = Date.now()) {
  if (!safe(sid)) return;
  const st = load(sid);
  st.noted ||= {};
  if (!(now - (st.workingAt || 0) < WORKING_MS)) {
    st.workingAt = now;
    st.working = [];
    for (const lab of labsFor(cwd, sid)) {
      const p = await pending(lab, sid);
      if (mine(p, sid)) for (const w of p.working || []) st.working.push({ lab, ...w });
    }
  }
  for (const w of st.working || []) {
    const key = `${w.lab.port}:${w.id}`;
    if (now - (st.noted[key] || 0) < PROGRESS_MS) continue;
    st.noted[key] = now;
    await call(w.lab, 'POST', '/_lab/api/comments', { page: w.page, action: 'progress', id: w.id, text: LINE, renew: true }); // renew: only its time moves, the agent's words stay
  }
  save(sid, st);
}

// The text of the turn a wake starts, or '' when nothing is waiting for this session. No page names: this text is a turn
// of its own, and `wait` names the pages, in text marked as the lab's.
async function wake(sid, cwd) {
  if (!safe(sid)) return '';
  const st = load(sid);
  st.told ||= {};
  for (const lab of labsFor(cwd, sid)) {
    const p = await pending(lab, sid);
    if (!mine(p, sid) || !p.fresh || p.listening) continue;
    // { key, n }: the set of pins woken for and how many times (a lab state from before kept the key alone).
    const was = typeof st.told[lab.port] === 'string' ? { key: st.told[lab.port], n: TRIES } : st.told[lab.port];
    const n = was?.key === p.key ? was.n : 0;
    if (n >= TRIES) continue;
    st.told[lab.port] = { key: p.key, n: n + 1 };
    save(sid, st);
    return (
      `labit: ${p.fresh === 1 ? 'A new pin' : `${p.fresh} new pins`} (${p.url}) while you weren't listening. ` +
      `Run \`${p.cmd} wait --timeout 5\` in ${p.dir} to read them (nothing new means you already have them), ` +
      `read each thread whole (the page or section is not the question), answer each on its pin with reply, then listen again in the background as before (\`wait --bg\`).`
    );
  }
  return '';
}

// ---------- Codex and Cursor: a command per event, the event on stdin, the answer on stdout ----------
async function cli(mode) {
  let e = {};
  try { e = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch {}
  const cursor = 'conversation_id' in e;
  const sid = String((cursor ? e.conversation_id : e.session_id) || '');
  const cwd = (cursor ? e.workspace_roots?.[0] : e.cwd) || process.cwd();
  if (e.agent_id || e.subagent_id) return; // a helper's work is about whatever it was given
  if (mode === 'start' && cursor && safe(sid)) console.log(JSON.stringify({ env: { LAB_SESSION_ID: sid } }));
  else if (mode === 'progress') await progress(sid, cwd);
  else if (mode === 'wake') {
    const text = await wake(sid, cwd);
    if (text) console.log(JSON.stringify(cursor ? { followup_message: text } : { decision: 'block', reason: text }));
  } else if (mode === 'prompt' && !cursor) {
    const text = await wake(sid, cwd);
    if (text) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } }));
  }
}
// (Not import.meta.url: opencode's loader runs the file without a plugin call when it is used.)
if (/[\\/]agent\.mjs$/.test(process.argv[1] || '')) await cli(process.argv[2]).catch(() => {});

// ---------- opencode 2: this file as .opencode/plugins/labit.js ----------
// opencode 2 takes a plugin as { id, setup(ctx) } and refuses a function (opencode 1's shape). Its shells already carry
// OPENCODE_SESSION_ID, which `wait` and `reply` sign with, so no env hook is needed. The tool hook "execute.after" gets
// { tool, sessionID, ... }; the session hook "experimental.idle" gets { sessionID, background } once the session's loop
// has nothing left to do (background: the jobs still running); ctx.session.prompt({ sessionID, text }) starts a turn.
function setup(ctx) {
  const dir = ctx?.location?.directory || process.cwd();
  const offs = [];
  const keep = (x) => { if (typeof x?.then === 'function') x.then((h) => h && offs.push(h)).catch(() => {}); else if (x) offs.push(x); };
  keep(ctx.tool.hook('execute.after', (e) => { if (safe(e?.sessionID)) void progress(e.sessionID, dir).catch(() => {}); }));
  keep(ctx.session.hook('experimental.idle', (e) => {
    const sid = e?.sessionID;
    if (!safe(sid) || (Array.isArray(e?.background) ? e.background.length : e?.background)) return; // a `wait --bg` still running hears the pins itself
    // Not awaited: the idle hook runs inside the session's loop, and a prompt sent from inside it would wait on itself.
    setTimeout(async () => {
      const text = await wake(sid, dir).catch(() => '');
      if (text) await Promise.resolve(ctx.session.prompt({ sessionID: sid, text })).catch(() => {});
    }, 0);
  }));
  return () => { for (const h of offs) try { (h.dispose || h)(); } catch {} };
}
export default { id: 'labit', setup };
