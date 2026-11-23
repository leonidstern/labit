// A lab nobody uses parks itself (LABIT_IDLE_MS): no page open, no agent waiting. One with a page open stays.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { LAB, claimPort, tmp, rm, spawnLab, sleep, up as answers, serverJson } from './harness.mjs';

const kids = [];
const dirs = [];
after(() => {
  kids.forEach((k) => k.kill());
  rm(dirs);
});
const start = (idleMs) => {
  const dir = fs.realpathSync(tmp('idle'));
  const home = tmp('idle-home');
  dirs.push(dir, home);
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><h1>Hi</h1>');
  const port = String(claimPort(5500, 90));
  const lab = spawnLab(dir, port, { env: { ...process.env, LABIT_HOME: home, LABIT_IDLE_MS: String(idleMs) } });
  kids.push(lab);
  const exited = new Promise((r) => lab.on('exit', r));
  return { dir, home, port, lab, exited };
};
const up = (port) => answers(`http://localhost:${port}/_lab/pages`, { tries: 50 });

test('nobody on it: the lab parks itself and can be started again from the parked record', async () => {
  const { dir, home, port, exited } = start(1500);
  await up(port);
  const code = await Promise.race([exited, sleep(8000).then(() => 'still running')]);
  assert.equal(code, 0, 'it ended by itself');
  const parked = JSON.parse(fs.readFileSync(path.join(home, 'parked', `${port}.json`), 'utf8'));
  assert.equal(parked.root, dir);
  assert.equal(parked.why, 'idle');
  assert.ok(parked.argv.includes('--port'), 'how it was started, to start it the same way');
  assert.ok(!fs.existsSync(path.join(home, 'servers', `${port}.json`)), 'no longer listed as running');
});

test('a page open on it: the lab stays', async () => {
  const { port, lab, exited } = start(1500);
  await up(port);
  const live = http.get(`http://localhost:${port}/_lab/live`);
  live.on('error', () => {});
  const code = await Promise.race([exited, sleep(4500).then(() => 'still running')]);
  assert.equal(code, 'still running');
  live.destroy();
  lab.kill();
});

test('started again after parking: the session that listened last is its listener again', async () => {
  const { dir, home, port, exited } = start(1500);
  await up(port);
  const key = serverJson(dir).agent;
  const sess = { id: 'sess-park', name: 'park test', agent: 'Claude', kind: 'claude' };
  await fetch(`http://localhost:${port}/_lab/wait`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://localhost:${port}`, 'x-lab-admin': key, 'x-lab-agent': '1', 'x-lab-session': encodeURIComponent(JSON.stringify(sess)) }, body: JSON.stringify({ timeout: 0.2 }) });
  await Promise.race([exited, sleep(10000)]);
  const parked = JSON.parse(fs.readFileSync(path.join(home, 'parked', `${port}.json`), 'utf8'));
  assert.equal(parked.session?.id, 'sess-park', 'the parked record keeps who listened');
  const again = spawn(process.execPath, parked.argv, { cwd: dir, env: { ...process.env, LABIT_HOME: home, LABIT_IDLE_MS: '0' } });
  kids.push(again);
  await up(port);
  await sleep(300);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'servers', `${port}.json`), 'utf8')).listener, 'sess-park');
  assert.ok(!fs.existsSync(path.join(home, 'parked', `${port}.json`)), 'no longer parked once running');
});

// One home for two folders: a parked lab keeps its port, so another folder's lab parking can't write over its record (#427).
test('a parked lab keeps its port: another folder skips it, and its own folder starts on it again', async () => {
  const home = tmp('idle-home');
  const a = fs.realpathSync(tmp('idle-a'));
  const b = fs.realpathSync(tmp('idle-b'));
  dirs.push(home, a, b);
  for (const d of [a, b]) fs.writeFileSync(path.join(d, 'index.html'), '<h1>Hi</h1>');
  const env = { ...process.env, LABIT_HOME: home, LABIT_IDLE_MS: '1500' };
  delete env.PORT;
  const port = String(claimPort(5500, 90));
  const run = (dir, args) => {
    const lab = spawn(process.execPath, [LAB, '.', '--no-open', ...args], { cwd: dir, env });
    kids.push(lab);
    return new Promise((r) => lab.on('exit', r));
  };
  await run(a, ['--port', port]);
  await run(b, ['--port', port]); // asked for A's port: it takes the next free one
  const parked = Object.fromEntries(fs.readdirSync(path.join(home, 'parked')).map((f) => [JSON.parse(fs.readFileSync(path.join(home, 'parked', f), 'utf8')).root, f]));
  assert.equal(parked[a], `${port}.json`, "A's record is still there");
  assert.ok(parked[b] && parked[b] !== `${port}.json`, 'B parked on another port');
  // A again, no port asked: back on its own port, and its record taken (not left behind as a second entry)
  const again = spawn(process.execPath, [LAB, '.', '--no-open'], { cwd: a, env: { ...env, LABIT_IDLE_MS: '0' } });
  kids.push(again);
  await up(port);
  await sleep(300);
  assert.ok(!fs.existsSync(path.join(home, 'parked', `${port}.json`)), 'taken once running');
  assert.ok(fs.existsSync(path.join(home, 'parked', parked[b])), "B's record untouched");
  again.kill();
});
