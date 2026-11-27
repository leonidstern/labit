// Talking to this folder's lab as its agent: the `wait` / `reply` commands' call to the lab.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// agent: the agent's own key (labs since 17 Nov); a lab from before has only token, the browser's key, and takes that.
type Server = { port: number; token: string; agent?: string; pid?: number };
type Session = Record<string, unknown>;

/** Whether a process with this pid is running (ours or not). */
export const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'; // there, and somebody else's
  }
};

/** The lab serving `from` or a folder above it, from its .lab/server.json; null when none is there. */
export function findLab(from: string): { dir: string; server: Server } | null {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    const file = path.join(dir, '.lab/server.json');
    if (fs.existsSync(file)) {
      // A file cut short (a full disk, a crash while it was written) or holding null names no lab: it was a stack trace.
      let server: Server | null = null;
      try {
        server = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {}
      // A lab that crashed (or a reboot) leaves its file behind, and its port may be another folder's lab by now:
      // a wait there is refused and a pin lands on the wrong lab. A file whose process is gone is not a lab.
      if (server && typeof server === 'object' && (!Number.isInteger(server.pid) || alive(server.pid!))) return { dir, server };
    }
    if (path.dirname(dir) === dir) return null;
  }
}

/** A POST to the lab with its key. node:http, not fetch: a wait can outlast fetch's 5-minute header timeout. Rejects
 *  when the lab can't be reached, or when `signal` aborts (the request is dropped, so the lab sees the wait end). */
export const labCall = (server: Server, pathname: string, body: object, session: Session, signal?: AbortSignal) =>
  new Promise<{ status: number; text: string; delivery: string }>((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port: server.port, path: pathname, method: 'POST', signal,
        headers: { host: `localhost:${server.port}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data),
          'x-lab-admin': server.agent || server.token, 'x-lab-agent': '1', 'x-lab-session': encodeURIComponent(JSON.stringify(session)) } },
      (res) => {
        let text = '';
        res.setEncoding('utf8'); // a character split between two chunks stays whole
        res.on('data', (c) => (text += c));
        // delivery: a wait's hand-off to confirm once it is shown (labAck), so the lab doesn't send its pins again.
        res.on('end', () => resolve({ status: res.statusCode || 0, text, delivery: String(res.headers['x-lab-delivery'] || '') }));
      },
    );
    req.on('error', reject);
    req.end(data);
  });

/** Tells the lab a wait's hand-off was shown to the agent. Best-effort: unconfirmed, the lab sends those pins again. */
export const labAck = (server: Server, delivery: string, session: Session) =>
  delivery ? labCall(server, '/_lab/ack', { id: delivery }, session).then(() => {}, () => {}) : Promise.resolve();

/** What a wait that ended without pins says, by the lab's answer. */
export const WAIT_SAID: Record<number, string> = {
  204: 'No new comments yet. Run wait again to keep listening.',
  409: 'Another session is listening on these pages now; this one stopped. Leave them to that session: two sessions waiting on one page take turns ending each other\'s wait, and its pins go to whichever is open.',
  410: 'The page was closed, so this stopped listening. Wait again only when the person asks or opens the page.',
  423: 'The person stopped listening from the page (labs & pages). Don\'t wait again until they ask you to.',
};

/** Turns the wifi on or off in the lab for folder `dir`: the lab starts again in its own place (same port, name and
 *  comments) and this waits until the new one answers. changed false: it was so already. */
export async function setWifi(dir: string, on: boolean, session: Session, say: (line: string) => void = () => {}) {
  const read = (): Server => JSON.parse(fs.readFileSync(path.join(dir, '.lab/server.json'), 'utf8'));
  const old = read();
  const first = await labCall(old, '/_lab/wifi', { on }, session).catch(() => null);
  if (!first) return { error: "the lab doesn't answer" };
  if (first.status === 200) return { changed: false };
  if (first.status !== 202) return { error: first.text };
  say(`${on ? 'Turning wifi on' : 'Turning wifi off'} for this lab (it restarts for a moment, same address)…`);
  for (const until = Date.now() + 30000; Date.now() < until; await new Promise((r) => setTimeout(r, 250))) {
    try {
      const now = read();
      if (now.pid !== old.pid && (await labCall(now, '/_lab/wifi', { on }, session)).status === 200) return { changed: true };
    } catch {} // down for a moment
  }
  return { error: `it didn't come back (see ${path.join(dir, '.lab/lab.log')}); the first one may still be running` };
}
