// What the unit tests (test/*.test.mjs) share: a folder and a port for a lab, the lab itself, waiting until it answers,
// its keys, the agent's calls, and the ends. Each file keeps its own pages, variables and cleanup order.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { claimPort } from './browser/port.mjs';

// A port from the file's own range that no other test on this machine holds (test/browser/port.mjs).
export { claimPort };
export const LAB = fileURLToPath(new URL('../local.mjs', import.meta.url));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A throwaway folder, /tmp/labit-<name>-XXXXXX, removed when the test file ends (a file that forgot its own rm left
    100 or so folders behind per run). */
const made = [];
process.on('exit', () => rm(made, { maxRetries: 0 }));
export const tmp = (name) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `labit-${name}-`));
  made.push(d);
  return d;
};
/** Folders removed for good. A killed lab can still be writing into .lab for a moment (ENOTEMPTY), so it retries,
    and a temp folder that still won't go never fails the test: the OS clears /tmp. */
export const rm = (dirs, more = {}) => {
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100, ...more });
    } catch {}
  }
};

/** One lab's folder, its port (a number, from [base, base + span)) and its address. */
export const site = (name, base, span) => {
  const PORT = claimPort(base, span);
  return { DIR: tmp(name), PORT, B: `http://localhost:${PORT}` };
};

/** A lab on a folder: `labit . --no-open [flags] --port <port> [args]`; the rest goes to spawn (env, stdio). */
export const spawnLab = (dir, port, { flags = [], args = [], ...opts } = {}) =>
  spawn(process.execPath, [LAB, '.', '--no-open', ...flags, '--port', String(port), ...args], { cwd: dir, ...opts });

/** Ends a lab and waits until it has exited (it writes to .lab on its way out). */
export const stop = (lab) => new Promise((r) => (lab.exitCode !== null || lab.signalCode !== null ? r() : (lab.once('exit', r), lab.kill())));

/**
 * Waits until `url` answers and gives the answer: `tries` times, 100 ms apart. When it never does, `fail` says what
 * happens: a message is thrown, a function is called, false goes on without a word.
 */
export const up = async (url, { tries = 80, fail = 'lab did not start' } = {}) => {
  for (let i = 0; i < tries; i++) {
    try {
      return await fetch(url);
    } catch {
      await sleep(100);
    }
  }
  if (typeof fail === 'function') return fail();
  if (fail) throw new Error(fail);
};

/** A lab's .lab/server.json: port, pid, token (the person's key), agent (the agent's key). */
export const serverJson = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.lab/server.json'), 'utf8'));

/** A labit command in a folder, run to its end: its exit code (1 when a signal ended it, never 0) and everything it
    printed. */
export const cli = (args, opts = {}, lab = LAB) =>
  new Promise((resolve) => execFile(process.execPath, [lab, ...args], opts, (err, stdout, stderr) => resolve({ code: err ? (Number.isInteger(err.code) ? err.code : 1) : 0, out: stdout + stderr })));

/** call(path, body, who, signal): a POST to the lab as the agent, signed with its key (key() reads it), from session `who`. */
export const agentCall = (port, key) => (p, body, who, signal) =>
  new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', signal, headers: { host: `localhost:${port}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'x-lab-admin': key(), 'x-lab-agent': '1', 'x-lab-session': encodeURIComponent(JSON.stringify({ id: who, name: who })) } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, text, delivery: res.headers['x-lab-delivery'] || '' }));
    });
    req.on('error', reject);
    req.end(data);
  });

/** Where a person's pin sits in these tests: on the page's h1, as the widget sends it. */
export const H1 = { selector: 'h1', x: 0.1, y: 0.5, docX: 0.1, docY: 20, width: 1000, element: '<h1>' };
/** post(text, page): Leo's pin on a page's h1. */
export const pinPost = (B) => (text, page = '/index') =>
  fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page, name: 'Leo', text, anchor: H1 }) }).then((r) => r.json());

/** A live stream's events, whole: give each read (text or bytes) to the function this returns, and on(data) gets the
    text of every complete `data:` line. A read can end inside a line: the rest waits for the next read. */
export const sseReader = (on) => {
  const dec = new TextDecoder();
  let rest = '';
  return (chunk) => {
    rest += typeof chunk === 'string' ? chunk : dec.decode(chunk, { stream: true });
    const lines = rest.split('\n');
    rest = lines.pop();
    for (const l of lines) if (l.startsWith('data: ')) on(l.slice(6).replace(/\r$/, ''));
  };
};

/** A page held open (tab t1): its live stream, read and thrown away. destroy() closes the page. */
export const openTab = (port) => http.get({ host: '127.0.0.1', port, path: '/_lab/live?tab=t1', headers: { host: `localhost:${port}` } }, (r) => r.resume());
