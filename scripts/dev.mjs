#!/usr/bin/env node
// One terminal for working on labit: the widget build in watch mode and the lab under node --watch.
// Without it that's two terminals, and a lab run beside a forgotten build serves yesterday's widget with no sign
// of it. Anything after `npm run dev --` goes to the lab (a port, a folder).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const kids = [];
let stopping = false;
// Each one runs in a process group of its own (not on Windows), so a signal reaches what it started too: npm's esbuild,
// and the lab under node --watch.
const own = process.platform !== 'win32';
const kill = (kid, sig) => {
  try {
    if (own) process.kill(-kid.pid, sig);
    else spawn('taskkill', ['/pid', String(kid.pid), '/T', ...(sig === 'SIGKILL' ? ['/F'] : [])], { stdio: 'ignore' });
  } catch {} // gone already
};

// Give each one a moment to go: the lab is a grandchild (node --watch runs it), and exiting the instant the
// signal is sent leaves it behind, holding the port.
const stop = async (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const kid of kids) kill(kid, 'SIGTERM');
  await Promise.race([
    Promise.all(kids.map((kid) => (kid.exitCode === null && kid.signalCode === null ? new Promise((r) => kid.once('exit', r)) : null))),
    new Promise((r) => setTimeout(r, 2000)),
  ]);
  for (const kid of kids) kill(kid, 'SIGKILL');
  process.exit(code);
};

// esbuild's watch mode ends when its stdin closes (so it can't outlive the terminal). Run with a pipe nobody
// writes to and it stays up, in a terminal or started by something else.
const run = (name, cmd, args, keepStdin = false) => {
  const kid = spawn(cmd, args, { cwd: REPO, stdio: [keepStdin ? 'pipe' : 'inherit', 'inherit', 'inherit'], shell: cmd.endsWith('.cmd'), detached: own });
  kid.on('error', (e) => {
    console.error(`[dev] could not start ${name}: ${e.message}`);
    stop(1);
  });
  // One going down takes the other with it: a lab running next to a dead build watcher is the trap this avoids.
  kid.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`[dev] ${name} stopped (${signal || code}). Stopping the lab too.`);
    stop(code ?? 1);
  });
  kids.push(kid);
};

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => stop(0));

run('the widget build', npm, ['run', 'build:watch'], true);
run('the lab', process.execPath, [path.join(REPO, 'local.mjs'), '--dev', ...process.argv.slice(2)]);
