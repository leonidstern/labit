// Sync, connections and listeners: every open page hears each change, the lab counts a page as open while it holds a
// live stream, and an agent's wait is opened, replaced, cancelled, timed out and closed at the right moments, with
// the pages told each time. No browser: the live stream is read as plain server-sent events.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { LAB, site, tmp, rm, spawnLab, sleep, up, serverJson, pinPost } from './harness.mjs';

const { DIR, PORT, B } = site('sync', 8600, 200); // clear of the other test files' ranges (they run at the same time)
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
      const s = { msgs, last: () => msgs[msgs.length - 1], beats: () => beats, ended: false, hide: () => res.destroy(), close: () => (res.destroy(), bye(tab)?.catch(() => {})) }; // the lab may stop before the last bye lands
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

test('a live stream starts with the lab\'s state; a new comment reaches every open page; the delta has it', async () => {
  const a = await live('a1');
  const b = await live('b1');
  await until(() => a.msgs.length && b.msgs.length, 2000, 'first state');
  const rev = a.last().comments;
  assert.equal(b.last().comments, rev, 'both pages start at the same revision');
  assert.ok(a.last().lab && Number.isInteger(a.last().files), 'the state names the lab and its files revision');
  const { comment } = await post('sync to both');
  await until(() => a.last().comments > rev && b.last().comments > rev, 3000, 'both pages to hear the comment');
  const delta = await (await fetch(`${B}/_lab/api/changes?page=/index&since=${rev}`)).json();
  assert.equal(delta.rev, a.last().comments, 'the delta ends at the revision the pages were told');
  assert.ok(delta.set.some((c) => c.id === comment.id), 'the delta holds the new comment');
  a.close();
  b.close();
});

test('a closed stream gets nothing more and the lab keeps serving the pages still open', async () => {
  const gone = await live('g1');
  const stays = await live('s1');
  await until(() => gone.msgs.length && stays.msgs.length, 2000, 'first state');
  gone.close();
  await until(() => gone.ended, 2000, 'the closed stream to end');
  const heard = gone.msgs.length;
  const rev = stays.last().comments;
  await post('after one page closed');
  await until(() => stays.last().comments > rev, 3000, 'the open page to hear it');
  assert.equal(gone.msgs.length, heard, 'nothing written to the closed one');
  assert.equal((await fetch(B + '/')).status, 200, 'the lab still answers');
  stays.close();
});

test('two tabs: closing one keeps the agent listening; closing the last ends the wait after the grace', async () => {
  await drain();
  const t1 = await live('two-1');
  const t2 = await live('two-2');
  const w = wait();
  await until(() => modeOf(t1) === 'listening', 4000, 'pages to show the agent listening');
  t1.close();
  await sleep(2200); // past the 1 s grace: one tab still open
  assert.equal(w.over(), false, 'still listening with one tab open');
  t2.close();
  const { out, ms } = await w.done;
  assert.match(out, /page was closed/);
  assert.ok(ms < 9000, `ended ${ms} ms after it started`);
});

test('a wait that times out ends quietly and the pages say no agent is listening', async () => {
  await drain();
  const p = await live('to-1');
  const w = wait([], 1);
  await until(() => modeOf(p) === 'listening', 4000, 'listening');
  const { out } = await w.done;
  assert.doesNotMatch(out, /page was closed|another session/);
  await until(() => modeOf(p) === 'away', 3000, 'away after the timeout');
  p.close();
});

test('right after a wait runs out the pages still say listening, for the next wait to come (LAB_BETWEEN_MS)', async () => {
  await drain();
  const p = await live('bt-1');
  const w = wait([], 1);
  await until(() => modeOf(p) === 'listening', 4000, 'listening');
  await w.done;
  await sleep(300);
  assert.equal(modeOf(p), 'listening', 'still listening inside the grace');
  const again = wait();
  await sleep(1000); // past the grace: the new wait keeps it listening
  assert.equal(modeOf(p), 'listening');
  again.kill();
  await again.done;
  await until(() => modeOf(p) === 'away', 3000, 'away once cancelled');
  p.close();
});

test('two sessions on one lab: when one gets its pins, the other is still listening', async () => {
  await drain();
  const p = await live('two-s');
  await until(() => modeOf(p) === 'away', 3000, 'away before the test');
  const other = wait(['--pages', 'other']);
  const idx = wait(['--pages', 'third']);
  await until(() => modeOf(p) === 'listening', 4000, 'listening');
  await post('for the third session', '/third');
  const { out } = await idx.done;
  assert.match(out, /for the third session/);
  await sleep(300);
  assert.equal(modeOf(p), 'listening', 'the /other wait is still open: not working, not away');
  other.kill();
  await other.done;
  p.close();
});

test('pages say which of them are heard: a wait with --pages hears its own, not the others', async () => {
  await drain();
  const p = await live('hd-1');
  await until(() => modeOf(p) === 'away', 3000, 'away before the test');
  const mine = wait(['--pages', 'other']);
  await until(() => modeOf(p) === 'listening', 4000, 'listening');
  assert.deepEqual(p.last().heard, { all: false, pages: ['/other'], except: [] });
  const plain = wait();
  await until(() => p.last().heard?.all === true, 4000, 'a plain wait hears every page');
  assert.ok(!p.last().heard.except.includes('/index'), 'index is heard');
  plain.kill();
  mine.kill();
  await Promise.all([plain.done, mine.done]);
  p.close();
});

test('a new wait for the same pages replaces the old one: the old one is told, the pages never show away in between', async () => {
  await drain();
  const p = await live('re-1');
  const first = wait();
  await until(() => modeOf(p) === 'listening', 4000, 'listening');
  const from = p.msgs.length;
  const second = wait();
  const old = await first.done;
  assert.match(old.out, /another session is listening/i);
  await sleep(500);
  assert.ok(p.msgs.slice(from).every((m) => m.mode !== 'away'), 'no "away" between the two waits');
  assert.equal(second.over(), false, 'the new wait listens on');
  second.kill();
  await second.done;
  p.close();
});
