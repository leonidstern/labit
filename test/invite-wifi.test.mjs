// `labit invite` on a lab that is open to this computer only turns the wifi on in that same lab (same folder, port,
// name, pins; a wait carries on), instead of the advice to start a second lab with --wifi, whose pins were separate.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { site, tmp, rm, spawnLab, stop, sleep, up as answers, serverJson, cli, pinPost, agentCall } from './harness.mjs';

const { DIR: dir, PORT, B } = site('invite-wifi', 10300, 40);
const DIR = fs.realpathSync(dir);
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><title>index</title><h1>index</h1>');
const HOME = tmp('home');
const env = { ...process.env, LABIT_HOME: HOME, LABIT_NO_UPDATE_CHECK: '1', LABIT_IDLE_MS: '0', CLAUDE_CODE_SESSION_ID: 'sess-i', CODEX_THREAD_ID: '', AMP_CURRENT_THREAD_ID: '' };
const lab = spawnLab(DIR, PORT, { env, args: ['--name', 'Phone lab'] });
const labs = () => fs.readdirSync(path.join(HOME, 'servers')).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(fs.readFileSync(path.join(HOME, 'servers', n), 'utf8')));
after(async () => {
  await stop(lab);
  try {
    process.kill(serverJson(DIR).pid); // the lab that took its place is not this test's child
  } catch {}
  await sleep(300);
  rm([DIR, HOME], { maxRetries: 5 });
});
const lan = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal && /^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address))?.address;
const get = (host, p) =>
  new Promise((done) => {
    const req = http.get({ host, port: PORT, path: p, headers: { host: `${host === '127.0.0.1' ? 'localhost' : host}:${PORT}` }, timeout: 3000 }, (res) => {
      res.resume();
      done({ status: res.statusCode, cookie: res.headers['set-cookie']?.[0] });
    });
    req.on('error', () => done({ status: 0 }));
    req.on('timeout', () => req.destroy());
  });
const comments = async () => (await (await fetch(B + '/_lab/api/comments?page=/index')).json()).comments;

test('a lab started local only: invite turns wifi on in it, same port, pins kept, a wait carries on, one lab in the registry', async () => {
  await answers(B + '/', { fail: () => assert.fail('the lab did not start') });
  const first = serverJson(DIR);
  const before = await pinPost(B)('written before the switch');
  assert.equal((await agentCall(PORT, () => first.agent)('/_lab/invite', {}, 's')).status, 404, 'local only: no link yet');
  assert.match((await cli(['wait', '--bg', '--timeout', '5'], { cwd: DIR, env })).out, /written before the switch/, 'read, so the next wait is for a new pin');
  const waiting = cli(['wait', '--bg', '--timeout', '40'], { cwd: DIR, env });
  await sleep(800);

  const r = await cli(['invite', 'Mira'], { cwd: DIR, env });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Turning wifi on for this lab \(it restarts for a moment, same address\)/);
  assert.match(r.out, /one-time link/);
  const links = r.out.split('\n').filter((l) => l.startsWith('http://'));
  assert.ok(links.length && links.every((l) => new RegExp(`^http://[^/]+:${PORT}/_lab/j/[0-9a-f]{32}\\?me=Mira$`).test(l)), r.out);

  const now = serverJson(DIR);
  assert.notEqual(now.pid, first.pid, 'the lab started again');
  assert.equal(now.port, PORT, 'same port');
  assert.notEqual(now.agent, first.agent, 'a new key: the wait reads it again');
  const info = await (await fetch(B + '/_lab/pages')).json();
  assert.equal(info.wifi, true);
  assert.equal(info.name, 'Phone lab', 'same name');
  assert.ok((await comments()).some((c) => c.id === before.comment.id && c.text === 'written before the switch'), 'the pin written before is still there');
  const mine = labs().filter((l) => l.root === DIR);
  assert.equal(mine.length, 1, 'no second lab entry');
  assert.equal(mine[0].port, PORT);
  assert.equal(mine[0].pid, now.pid);
  assert.equal(labs().length, 1);

  // a guest link works: opened once it trades for a pass (from this computer's wifi address when it has one)
  if (lan) {
    const path_ = new URL(links[0]).pathname;
    assert.equal((await get(lan, '/')).status, 403, 'being on the wifi is not enough');
    const g = await get(lan, path_);
    assert.ok(g.status < 400 && g.cookie, `the link lets a guest in (${g.status})`);
    assert.equal((await get(lan, path_)).cookie, undefined, 'a link works once');
  }

  // the wait that was open during the switch hears the next pin
  await sleep(500);
  const after = await pinPost(B)('after the switch');
  const { code, out } = await waiting;
  assert.equal(code, 0);
  assert.doesNotMatch(out, /forbidden/);
  assert.match(out, /after the switch/);
  assert.ok(after.comment.id);

  // and a second invite is just a link: no more restart
  const again = await cli(['invite'], { cwd: DIR, env });
  assert.equal(again.code, 0, again.out);
  assert.doesNotMatch(again.out, /Turning wifi/);
  assert.equal(serverJson(DIR).pid, now.pid);
});

test('labit --wifi in the folder of a lab with wifi says so and starts nothing; --no-wifi switches it back, same port', async () => {
  const had = serverJson(DIR);
  const same = await cli(['--wifi', '--no-open', '.'], { cwd: DIR, env });
  assert.equal(same.code, 0, same.out);
  assert.match(same.out, /already running for this folder, wifi is on: http:\/\/localhost:\d+/);
  assert.equal(serverJson(DIR).pid, had.pid);
  const off = await cli(['--no-wifi', '--no-open', '.'], { cwd: DIR, env });
  assert.equal(off.code, 0, off.out);
  assert.match(off.out, /Turning wifi off for this lab/);
  assert.match(off.out, /wifi is now off: http:\/\/localhost:\d+/);
  assert.equal(serverJson(DIR).port, PORT);
  assert.equal((await (await fetch(B + '/_lab/pages')).json()).wifi, false);
  assert.ok((await comments()).some((c) => c.text === 'after the switch'), 'pins kept');
  assert.equal(labs().length, 1);
  // and on again from the start command
  const on = await cli(['--wifi', '--no-open', '.'], { cwd: DIR, env });
  assert.equal(on.code, 0, on.out);
  assert.match(on.out, /Turning wifi on for this lab[\s\S]*wifi is now on: http:\/\/localhost:\d+/);
  assert.equal((await (await fetch(B + '/_lab/pages')).json()).wifi, true);
  assert.equal(labs().length, 1);
  // the key a page carries cannot switch the wifi
  const page = await fetch(B + '/_lab/wifi', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: '{"on":false}' });
  assert.equal(page.status, 403);
});
