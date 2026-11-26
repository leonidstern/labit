// Sync, continued (sync.test.mjs): waits beside each other, cancelled waits, tabs that stop checking in, labs & pages.
// A file of its own so the two run side by side.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { LAB, site, tmp, rm, spawnLab, sleep, up, serverJson, pinPost } from './harness.mjs';

const { DIR, PORT, B } = site('sync-tabs', 8600, 200); // clear of the other test files' ranges (they run at the same time)
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><title>t</title><h1 id="t">Hello</h1>');
fs.writeFileSync(path.join(DIR, 'other.html'), '<!doctype html><title>o</title><h1 id="o">Other</h1>');
fs.writeFileSync(path.join(DIR, 'third.html'), '<!doctype html><title>3</title><h1 id="h">Third</h1>'); // its own session's page: a claim on it leaves the others alone
// A 1 s grace once every page is closed, and pins 300 ms apart go over together. A tab with neither a stream nor a check-in is gone after 3 s here (90 s in a real lab).
const env = { ...process.env, LAB_CLOSE_GRACE: '1', LAB_SETTLE_MS: '300', LAB_TAB_TTL: '3', LAB_BETWEEN_MS: '800', LABIT_HOME: tmp('home'), LABIT_NO_UPDATE_CHECK: '1' };
const server = spawnLab(DIR, PORT, { env });
const procs = new Set();
after(() => {
  for (const p of procs) p.kill();
  server.kill();
  rm([DIR]);
});
const until = async (ok, ms = 4000, what = 'condition') => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (ok()) return;
    await sleep(25);
  }
  assert.fail(`timed out waiting for ${what}`);
};

// A page's live stream: every state message it got, in order. close() is the tab going away.
const live = (tab) =>
  new Promise((resolve, reject) => {
    const msgs = [];
    let beats = 0;
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/_lab/live' + (tab ? `?tab=${tab}` : ''), headers: { host: `localhost:${PORT}` } }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (/^event: beat/m.test(block)) beats++;
          else {
            const data = block.split('\n').find((l) => l.startsWith('data: '));
            if (data) msgs.push(JSON.parse(data.slice(6)));
          }
        }
      });
      // hide(): the tab lets its stream go but stays open (in the background). close(): it goes away and says bye,
      // as the widget does on pagehide.
      const s = { msgs, last: () => msgs[msgs.length - 1], beats: () => beats, ended: false, hide: () => res.destroy(), close: () => (res.destroy(), bye(tab)) };
      res.on('close', () => (s.ended = true));
      resolve(s);
    });
    req.on('error', reject);
  });

const bye = (tab) => tab && fetch(B + '/_lab/bye', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ tab }) });

// `labit wait`, as an agent runs it. kill() is the agent cancelling it.
const wait = (args = [], timeout = 20) => {
  const t0 = Date.now();
  const p = spawn(process.execPath, [LAB, 'wait', '--timeout', String(timeout), '--name', 'sync-test', ...args], { cwd: DIR, env });
  procs.add(p);
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (out += d));
  const done = new Promise((r) => p.on('close', (code) => (procs.delete(p), r({ code, out, ms: Date.now() - t0 }))));
  let over = false;
  done.then(() => (over = true));
  return { done, over: () => over, kill: () => p.kill() };
};
const post = pinPost(B);
// Hands over whatever earlier tests left unanswered, so the next wait starts with nothing waiting for it.
const drain = () => wait([], 1).done;
// The mode pages are told: listening, working or away.
const modeOf = (s) => (s.last()?.session ? s.last().mode : 'away');

test('the lab starts', async () => {
  await up(B + '/', { fail: () => assert.fail('lab did not start') });
});

test('a wait for other pages stays when a plain wait comes and goes', async () => {
  await drain();
  const p = await live('pg-1');
  const mine = wait(['--pages', 'other']);
  await until(() => modeOf(p) === 'listening', 4000, 'listening');
  const plain = wait([], 1);
  await plain.done;
  await sleep(300);
  assert.equal(mine.over(), false, 'the --pages wait is still open');
  assert.equal(modeOf(p), 'listening', 'still listening: one wait is open');
  mine.kill();
  await mine.done;
  await until(() => modeOf(p) === 'away', 3000, 'away once the last wait is cancelled');
  p.close();
});

test('a cancelled wait shows away at once, and a comment made then goes to the next wait, not lost', async () => {
  await drain();
  const p = await live('ca-1');
  const w = wait();
  await until(() => modeOf(p) === 'listening', 4000, 'listening');
  w.kill();
  await w.done;
  await until(() => modeOf(p) === 'away', 3000, 'away after the cancel');
  const { comment } = await post('made while nobody listened');
  await sleep(600); // past the settle time: nobody to wake
  const next = wait([], 5);
  const { out } = await next.done;
  assert.match(out, new RegExp(comment.id), 'the next wait gets it');
  assert.match(out, /made while nobody listened/);
  await until(() => modeOf(p) === 'working', 3000, 'working once handed over');
  p.close();
});

test('pins made one after another reach the agent together, in one message', async () => {
  await drain();
  const p = await live('st-1');
  const w = wait();
  await until(() => modeOf(p) === 'listening', 4000, 'listening');
  const one = (await post('first of two')).comment;
  await sleep(100); // inside the 300 ms settle
  const two = (await post('second of two')).comment;
  const { out } = await w.done;
  assert.match(out, /In this message: 2 new/);
  assert.match(out, new RegExp(one.id));
  assert.match(out, new RegExp(two.id));
  const again = wait([], 1);
  const later = await again.done;
  assert.doesNotMatch(later.out, new RegExp(`${one.id}|${two.id}`), 'neither comes a second time');
  p.close();
});

test('a page that only polls the state (a background tab) still counts as open', async () => {
  await drain();
  const p = await live('bg-1');
  const w = wait();
  await until(() => modeOf(p) === 'listening', 4000, 'listening');
  p.hide(); // the stream is let go in the background ...
  for (let i = 0; i < 3; i++) {
    const s = await (await fetch(`${B}/_lab/state?tab=bg-1`)).json(); // ... and the state polled instead
    assert.equal(s.mode, 'listening');
    await sleep(800);
  }
  assert.equal(w.over(), false, 'past the grace and still listening');
  assert.equal((await bye('bg-1')).status, 204);
  assert.match((await w.done).out, /page was closed/);
});

test('a tab that goes silent (no bye, no check-in: it crashed, or a phone froze it) stops counting after the timeout', async () => {
  await drain();
  const p = await live('crash-1');
  const w = wait();
  await until(() => modeOf(p) === 'listening', 4000, 'listening');
  const t0 = Date.now();
  p.hide(); // the stream drops and nothing more comes from the tab
  const { out } = await w.done;
  assert.match(out, /page was closed/);
  const ms = Date.now() - t0;
  assert.ok(ms > 2500 && ms < 9000, `ended ${ms} ms after the tab went silent (timeout 3 s + grace 1 s)`);
});

test('a bye that arrives before its stream has closed still lets the tab go', async () => {
  await drain();
  const p = await live('race-1');
  const w = wait();
  await until(() => modeOf(p) === 'listening', 4000, 'listening');
  assert.equal((await bye('race-1')).status, 204); // the bye first, while the stream is still open ...
  await sleep(100);
  const t0 = Date.now();
  p.hide(); // ... then the stream closes
  const { out } = await w.done;
  assert.match(out, /page was closed/);
  const ms = Date.now() - t0;
  assert.ok(ms < 2500, `ended ${ms} ms after: within the 1 s grace, not after the 3 s silent-tab timeout`);
});

test('labs & pages: this lab and its pages; stop listening needs the key and ends the wait with its own word', async () => {
  await drain();
  const got = await (await fetch(B + '/_lab/labs')).json();
  const me = got.labs.find((l) => l.here);
  assert.equal(me.port, Number(PORT));
  assert.ok(me.pages.some((p) => p.path === '/other'), 'its pages are listed');
  const w = wait();
  const p = await live('sw-1');
  await until(() => modeOf(p) === 'listening', 4000, 'listening');
  const no = await fetch(B + '/_lab/labs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'stop', port: Number(PORT) }) });
  assert.equal(no.status, 403, 'no key, no stop');
  const { token } = serverJson(DIR);
  const ok = await fetch(B + '/_lab/labs', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lab-admin': token }, body: JSON.stringify({ action: 'stop', port: Number(PORT) }) });
  assert.equal(ok.status, 200);
  const { out } = await w.done;
  assert.match(out, /stopped listening from the page/);
  await until(() => modeOf(p) === 'away', 3000, 'away once stopped');
  p.close();
  await sleep(300); // its bye reaches the lab before the file's end stops it
});
