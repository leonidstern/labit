// Starting and running a lab the ways people do on Windows (#544: 0.8.2 exited on every start there, because the lab
// kept .lab/lock open and Windows can't replace an open file). CI runs this file on a Windows runner as well as with
// the other unit tests; nothing in it is Windows-only, so it guards the same paths everywhere.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { parseArgs, windowsPagePath } from '../lib/args.ts';
import { claimPort, tmp, rm, spawnLab, stop, sleep, serverJson, cli, pinPost } from './harness.mjs';

const WIN = process.platform === 'win32';
const labs = [];
after(async () => {
  await Promise.all(labs.map(stop));
});

/** A lab started in `dir`, with what it printed and a promise of its exit. */
const start = (dir, port, args = []) => {
  const p = spawnLab(dir, port, { flags: ['--no-wifi'], args });
  p.out = '';
  p.stdout.on('data', (d) => (p.out += d));
  p.stderr.on('data', (d) => (p.out += d));
  p.done = new Promise((r) => p.on('exit', (code, signal) => r({ code, signal })));
  labs.push(p);
  return p;
};
/** Waits until the lab says it listens, or exits; true when it listens. */
const listening = async (p) => {
  for (let i = 0; i < 150 && !/\[lab\] http:\/\/localhost/.test(p.out) && p.exitCode === null; i++) await sleep(100);
  return /\[lab\] http:\/\/localhost/.test(p.out) && p.exitCode === null;
};
/** Starts a lab and fails with everything it printed when it doesn't come up. */
const running = async (dir, port, args) => {
  const p = start(dir, port, args);
  assert.ok(await listening(p), `the lab did not start:\n${p.out}`);
  return p;
};
const lockOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.lab/lock'), 'utf8'));
const page = (dir, name = 'index.html', text = '<h1>hello</h1>') => fs.writeFileSync(path.join(dir, name), text);

test('starts, writes its port into the lock, and holds no handle on it', async () => {
  const dir = tmp('win-start');
  page(dir);
  const port = claimPort(6500, 40);
  const p = await running(dir, port);
  assert.equal(lockOf(dir).pid, p.pid);
  assert.equal(lockOf(dir).port, port, 'the rewrite with the port went through (the EPERM of #544)');
  assert.match(await (await fetch(`http://localhost:${port}/`)).text(), /hello/);
  // Rewriting the lock by hand as another program would: fails on Windows while the lab still holds it open.
  const lock = path.join(dir, '.lab/lock');
  fs.writeFileSync(lock + '.probe', fs.readFileSync(lock));
  fs.renameSync(lock + '.probe', lock);
  await stop(p);
  rm([dir]);
});

test('a folder whose path has spaces and letters outside ASCII', async () => {
  const dir = path.join(tmp('win-names'), 'My Project — été 2026');
  fs.mkdirSync(dir);
  page(dir);
  const port = claimPort(6500, 40);
  const p = await running(dir, port);
  assert.equal(serverJson(dir).port, port);
  await stop(p);
});

test('a git worktree (.git is a file there), as in #544', { skip: !hasGit() && 'no git' }, async () => {
  const repo = tmp('win-repo');
  const git = (args, cwd = repo) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  git(['init', '-q']);
  page(repo);
  git(['add', '.']);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x']);
  const tree = path.join(tmp('win-wt'), 'tree');
  git(['worktree', 'add', '-q', tree]);
  assert.ok(fs.statSync(path.join(tree, '.git')).isFile());
  const port = claimPort(6500, 40);
  const p = await running(tree, port);
  assert.equal(lockOf(tree).port, port);
  await stop(p);
  git(['worktree', 'remove', '--force', tree]);
  rm([repo]);
});

test('--proxy in front of a dev server, as in #544', async () => {
  const dev = http.createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<html><body><h1>from the dev server</h1></body></html>'));
  const devPort = claimPort(6500, 40);
  await new Promise((r) => dev.listen(devPort, r));
  const dir = tmp('win-proxy');
  const port = claimPort(6500, 40);
  try {
    const p = await running(dir, port, ['--proxy', String(devPort)]);
    assert.equal(lockOf(dir).port, port);
    assert.match(await (await fetch(`http://localhost:${port}/`)).text(), /from the dev server/);
    await stop(p);
  } finally {
    dev.close();
    rm([dir]);
  }
});

test('starts again after a lab was killed (its lock and server.json left behind)', async () => {
  const dir = tmp('win-killed');
  page(dir);
  const first = await running(dir, claimPort(6500, 40));
  first.kill('SIGKILL'); // what Windows does to every kill: no exit handlers run
  await first.done;
  assert.ok(fs.existsSync(path.join(dir, '.lab/lock')), 'a killed lab leaves its lock');
  const port = claimPort(6500, 40);
  const second = await running(dir, port);
  assert.equal(lockOf(dir).pid, second.pid);
  assert.equal(lockOf(dir).port, port);
  await stop(second);
  rm([dir]);
});

test('two started at once in one folder make one lab', async () => {
  const dir = tmp('win-two');
  page(dir);
  const [a, b] = [start(dir, claimPort(6500, 40)), start(dir, claimPort(6500, 40))];
  const ups = await Promise.all([listening(a), listening(b)]);
  const loser = ups[0] ? b : a;
  assert.equal((await loser.done).code, 0, `${a.out}\n---\n${b.out}`);
  assert.match(loser.out, /already running for this folder/);
  assert.equal(ups.filter(Boolean).length, 1);
  await Promise.all([stop(a), stop(b)]);
  rm([dir]);
});

test('pins are saved while another program keeps reading the files (a virus scanner, the indexer)', async () => {
  const dir = tmp('win-pins');
  page(dir);
  const port = claimPort(6500, 40);
  const B = `http://localhost:${port}`;
  const p = await running(dir, port);
  const post = pinPost(B);
  const file = path.join(dir, '.lab/comments');
  // Opens every file under .lab for a moment, again and again, while the pins come in: a rename over an open file
  // waits on Windows (writeAtomic tries again) instead of failing.
  let scanning = true;
  const scanner = (async () => {
    while (scanning) {
      for (const f of [...(fs.existsSync(file) ? fs.readdirSync(file).map((n) => path.join(file, n)) : []), path.join(dir, '.lab/server.json'), path.join(dir, '.lab/comments.md')]) {
        let fd;
        try {
          fd = fs.openSync(f, 'r');
          await sleep(15);
        } catch {
        } finally {
          if (fd !== undefined) fs.closeSync(fd);
        }
      }
      await sleep(5);
    }
  })();
  const ids = [];
  for (let round = 0; round < 6; round++) ids.push(...(await Promise.all(Array.from({ length: 5 }, (_, i) => post(`pin ${round}-${i}`)))).map((r) => r.comment?.id));
  scanning = false;
  await scanner;
  assert.equal(ids.filter(Boolean).length, 30, 'every pin was taken');
  assert.equal(p.exitCode, null, `the lab still runs:\n${p.out}`);
  assert.doesNotMatch(p.out, /EPERM|EACCES|EBUSY/);
  await stop(p);
  // All of them are on disk: a new lab reads them back.
  const port2 = claimPort(6500, 40);
  const again = await running(dir, port2);
  const listed = await (await fetch(`http://localhost:${port2}/_lab/api/comments?page=/index`)).json();
  const kept = new Set((Array.isArray(listed) ? listed : listed.comments || []).map((c) => c.id));
  assert.ok(ids.every((id) => kept.has(id)), `${ids.filter((id) => !kept.has(id)).length} pins were lost`);
  await stop(again);
  rm([dir]);
});

test('the agent commands: wait takes a pin, reply answers it', async () => {
  const dir = tmp('win-agent');
  page(dir);
  const port = claimPort(6500, 40);
  const p = await running(dir, port);
  const { comment } = await pinPost(`http://localhost:${port}`)('make it blue');
  const got = await cli(['wait', '--timeout', '5', '--no-open'], { cwd: dir });
  assert.match(got.out, /make it blue/, got.out);
  const r = await cli(['reply', comment.id, 'Blue now', '--done'], { cwd: dir });
  assert.equal(r.code, 0, r.out);
  await stop(p);
  rm([dir]);
});

test(`stops cleanly${WIN ? '' : ' on SIGINT'}: lock and server.json go with it`, { skip: WIN && 'Windows has no SIGINT for a child process' }, async () => {
  const dir = tmp('win-stop');
  page(dir);
  const p = await running(dir, claimPort(6500, 40));
  p.kill('SIGINT');
  await p.done;
  assert.ok(!fs.existsSync(path.join(dir, '.lab/lock')));
  assert.ok(!fs.existsSync(path.join(dir, '.lab/server.json')));
  rm([dir]);
});

function hasGit() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}


test('a page Git Bash turned into a Windows path is refused, with the way to write it', async () => {
  const why = (...a) => windowsPagePath(parseArgs(a).opts);
  assert.match(why('--page', 'C:/Program Files/Git/spot/trade'), /--page spot\/trade\b.*MSYS_NO_PATHCONV=1/);
  assert.match(why('--pages', '/a,C:\\Program Files\\Git\\usr\\b'), /--pages b\b/);
  for (const ok of [['--page', '/spot/trade'], ['--page', 'spot/trade'], ['--pages', '/a,/b'], ['--page']]) assert.equal(why(...ok), null, ok.join(' '));
  // The command stops before it reaches any lab.
  const dir = tmp('win-msys');
  const r = await cli(['pin', 'h1', 'hi', '--page', 'C:/Program Files/Git/spot/trade'], { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.out, /Git Bash/);
  rm([dir]);
});
