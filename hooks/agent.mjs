// labit for Codex, Cursor and opencode, no MCP: what the Claude Code plugin's hook (wake.ts) does, for agents that run a
// command on their events (Codex, Cursor) or load a plugin (opencode). One file, no packages.
//
//   node agent.mjs progress   a tool call by the session: keeps the status line of the pins it claimed alive
//   node agent.mjs wake       the session stopped: pins nobody was handed come in as its next turn
//   node agent.mjs start      Cursor's session start: tells the shells which session this is (LAB_SESSION_ID)
//   opencode: copy this file to .opencode/plugins/labit.js (its default export is the plugin)
//
// Same rules as the Claude Code hook (PR #321): a status line only for a pin the session claimed (the lab lists those) and
// only while this session itself runs tools, at most one renewal per pin a minute (the lab counts a line for 3 minutes);
// the line says "session activity", never the command; the wake goes only to the session that listened last, once per set
// of pins, and names no page (a guest's pin can name anything). A helper's tool calls renew nothing.
//
// The session is the id the agent's `wait` and `reply` sign with: Codex CODEX_THREAD_ID, and LAB_SESSION_ID for the
// others (Cursor's start hook and opencode's shell.env set it), so the lab's "listened last" is the same id here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const MAX_LABS = 4;
const PROGRESS_MS = 60000; // a pin's status line is renewed once a minute at most
const WORKING_MS = 15000; // the list of claimed pins is kept this long before the lab is asked again
const LINE = 'session activity'; // the whole status line: a command is not an answer, and helpers' commands are other work

// The lab's address and the agent's key, from .lab/server.json in a folder or one above it (a lab whose process is gone
// left its file behind: its port may be another folder's lab by now).
function labAt(dir, port) {
  for (;;) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, '.lab/server.json'), 'utf8'));
      if (Number(s?.port) && (!port || Number(s.port) === port)) {
        let live = true;
        try { process.kill(s.pid, 0); } catch (e) { live = e.code === 'EPERM' || !Number.isInteger(s.pid); }
        if (live) return { port: Number(s.port), key: String(s.agent || s.token || '') };
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
    const dir = path.join(process.env.LABIT_HOME || path.join(os.homedir(), '.labit'), 'servers');
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
const pending = (lab) => call(lab, 'GET', '/_lab/pending');

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
      const p = await pending(lab);
      if (p?.last === sid) for (const w of p.working || []) st.working.push({ lab, ...w });
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
    const p = await pending(lab);
    if (!p || !p.fresh || p.listening || p.last !== sid || p.key === st.told[lab.port]) continue;
    st.told[lab.port] = p.key;
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
  }
}
// (Not import.meta.url: opencode's loader runs the file without a plugin call when it is used.)
if (/[\\/]agent\.mjs$/.test(process.argv[1] || '')) await cli(process.argv[2]).catch(() => {});

// ---------- opencode: this file as .opencode/plugins/labit.js ----------
export default async function labit({ directory, client }) {
  return {
    // The shells opencode starts get this session's id, so `wait` and `reply` sign with it.
    'shell.env': async (input, output) => { if (safe(input?.sessionID)) output.env.LAB_SESSION_ID = input.sessionID; },
    'tool.execute.after': async (input) => { await progress(input?.sessionID, directory).catch(() => {}); },
    event: async ({ event }) => {
      const sid = event?.properties?.sessionID || event?.properties?.info?.id;
      if (event?.type !== 'session.idle' || !sid) return;
      const text = await wake(sid, directory).catch(() => '');
      // promptAsync queues the turn and returns; prompt (older SDKs) holds until the answer is done.
      const send = client.session.promptAsync || client.session.prompt;
      if (text) await send.call(client.session, { path: { id: sid }, body: { parts: [{ type: 'text', text }] } }).catch(() => {});
    },
  };
}
