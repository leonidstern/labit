// The lab says every time a file changed, not only the first: a board file (the lab writes it by a rename) and a page saved by
// a rename (as many editors do). On Linux Node's recursive watcher missed every change after the first (lib/watch.ts).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { LAB, site, rm, sleep, up } from './harness.mjs';

const { DIR, PORT, B } = site('livewatch', 8490, 20);
fs.writeFileSync(path.join(DIR, 'pricing.html'), '<!doctype html><title>P</title><h1>Pricing</h1>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = spawn(process.execPath, [LAB, '--new', '--no-open'], { cwd: DIR, stdio: 'ignore' });
const state = { boards: 0, hot: 0, files: 0 }; // the newest the lab said
const abort = new AbortController();
after(() => {
  abort.abort();
  server.kill();
  rm([DIR], { maxRetries: 5 });
});

const ready = (async () => {
  await up(B + '/', { tries: 100, fail: false });
  const res = await fetch(B + '/_lab/live', { signal: abort.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const m of dec.decode(value).matchAll(/data: (.*)\n/g)) {
          try {
            const s = JSON.parse(m[1]);
            for (const k of Object.keys(state)) if (typeof s[k] === 'number') state[k] = s[k];
          } catch {}
        }
      }
    } catch {}
  })();
})();
// Waits until the lab's count for `key` is above `than` (at most 4 s); the count it reached.
const above = async (key, than) => {
  for (let t = 0; t < 4000 && state[key] <= than; t += 25) await sleep(25);
  return state[key];
};
const atomic = (file, text) => {
  fs.writeFileSync(`${file}.tmp`, text);
  fs.renameSync(`${file}.tmp`, file);
};
const put = (frames, rev) =>
  fetch(`${B}/_lab/api/board?name=pins`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ v: 1, rev, frames, of: '/pricing' }) }).then((r) => r.json());

test('a board file changed again and again: each change is announced', async () => {
  await ready;
  let b = await put([{ id: 'a', src: '/pricing', w: 390, h: 844 }], 0);
  await sleep(300); // the lab starts watching boards once there are some
  for (let i = 1; i <= 3; i++) {
    const was = state.boards;
    b = await put(b.frames.map((f) => ({ ...f, x: i * 50, auto: false })), b.rev);
    assert.ok((await above('boards', was)) > was, `board change ${i} was announced (boards ${was} → ${state.boards})`);
  }
});

test('a page saved by a rename again and again: each save is announced', async () => {
  await ready;
  const file = path.join(DIR, 'pricing.html');
  for (let i = 1; i <= 3; i++) {
    const was = state.hot;
    atomic(file, `<!doctype html><title>P</title><h1>Pricing ${i}</h1>`);
    assert.ok((await above('hot', was)) > was, `save ${i} was announced (hot ${was} → ${state.hot})`);
  }
});

test('a save in venv, __pycache__ or bower_components is not announced, and the file is still served', async () => {
  await ready;
  for (const d of ['venv', '__pycache__', 'bower_components']) fs.mkdirSync(path.join(DIR, d));
  await sleep(200); // the folders are seen
  const was = { ...state };
  for (const d of ['venv', '__pycache__', 'bower_components']) fs.writeFileSync(path.join(DIR, d, 'x.js'), '1');
  await sleep(700);
  assert.deepEqual(state, was, 'the lab said nothing');
  assert.equal((await fetch(`${B}/venv/x.js`)).status, 200, 'served as any other file');
  fs.writeFileSync(path.join(DIR, 'app.js'), '1');
  assert.ok((await above('files', was.files)) > was.files, 'a save beside them is announced');
});

test('a save that changes nothing, and what editors leave beside a save, are not announced', async () => {
  await ready;
  const file = path.join(DIR, 'same.css');
  const hot0 = state.hot;
  fs.writeFileSync(file, 'a{color:red}');
  // The new file's own announcement first: on a slow runner it came after a fixed 400 ms and was taken for the re-save's.
  await above('hot', hot0);
  await sleep(200);
  let was = { ...state };
  fs.writeFileSync(file, 'a{color:red}'); // saved again, the same bytes
  await sleep(500);
  assert.deepEqual(state, was, 'the lab said nothing');
  for (const f of ['same.css~', '4913', '#same.css#', 'same.css.swp', 'same.css.tmp', 'a.___jb_old___']) fs.writeFileSync(path.join(DIR, f), 'x');
  await sleep(500);
  assert.deepEqual(state, was, 'nothing for an editor\'s leftovers');
  was = { ...state };
  fs.writeFileSync(file, 'a{color:blue}');
  assert.ok((await above('hot', was.hot)) > was.hot, 'a real change is announced');
});

test('writes that never pause are still announced, within about a second', async () => {
  await ready;
  const was = state.files;
  const file = path.join(DIR, 'busy.log');
  const t0 = Date.now();
  let i = 0;
  const timer = setInterval(() => fs.writeFileSync(file, `line ${i++}`), 40);
  try {
    assert.ok((await above('files', was)) > was, 'announced while the writes go on');
    assert.ok(Date.now() - t0 < 2500, `after ${Date.now() - t0} ms`);
  } finally {
    clearInterval(timer);
  }
});

test('the event stream asks to be reopened in half a second, and a script is not cached', async () => {
  await ready;
  const res = await fetch(B + '/_lab/live', { signal: AbortSignal.timeout(2000) }).catch(() => null);
  const first = res ? new TextDecoder().decode((await res.body.getReader().read()).value) : '';
  assert.match(first, /^retry: 500\n/);
  fs.writeFileSync(path.join(DIR, 'app.js'), '2');
  assert.equal((await fetch(`${B}/app.js`)).headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(`${B}/pricing`)).headers.get('cache-control'), 'no-store');
});
