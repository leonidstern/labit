// What open pages are told when files change and comments land (no browser): CSS, pictures, fonts and HTML saves are
// "hot" (updated in place), anything else is a reload; comment changes come as deltas; a restart is a new lab id.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { site, tmp, rm, spawnLab, sleep, up as answers, serverJson } from './harness.mjs';

const { DIR, PORT, B } = site('hot', 4900, 90);
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><title>t</title><link rel="stylesheet" href="s.css"><h1 id="t">Hello</h1>');
fs.writeFileSync(path.join(DIR, 's.css'), 'h1{color:red}');
fs.writeFileSync(path.join(DIR, 'app.js'), 'console.log(1)');
fs.writeFileSync(path.join(DIR, 'pic.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>');

let server = null;
const start = () => (server = spawnLab(DIR, PORT, { flags: ['--new'], env: { ...process.env, PORT } }));
start();
after(() => {
  server?.kill();
  rm([DIR]);
});

const up = () => answers(B + '/', { fail: 'server did not start' });
const post = (body) =>
  fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify(body) }).then((r) => r.json());

// The live stream as a page sees it: every state message, parsed.
async function listen() {
  const res = await fetch(B + '/_lab/live?tab=test');
  const reader = res.body.getReader();
  const states = [];
  let buf = '';
  (async () => {
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ done: true }));
      if (done) return;
      buf += new TextDecoder().decode(value);
      for (let i; (i = buf.indexOf('\n\n')) >= 0; ) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (line.startsWith('data: ')) states.push(JSON.parse(line.slice(6)));
      }
    }
  })();
  const next = async (pred, ms = 3000) => {
    const t0 = Date.now();
    for (;;) {
      const hit = states.find(pred);
      if (hit) return hit;
      if (Date.now() - t0 > ms) return null;
      await sleep(50);
    }
  };
  return { states, next, stop: () => reader.cancel().catch(() => {}) };
}
const save = (file, text) => fs.writeFileSync(path.join(DIR, file), text);

test('pages are served with the lab id and the widget revision', async () => {
  const html = await (await up()).text();
  assert.match(html, /data-lab="[0-9a-f]{8}"/);
  assert.match(html, /data-widget="[0-9a-f]{10}"/);
});

test('a CSS save is hot (swapped in place), not a reload', async () => {
  await up();
  const live = await listen();
  const first = await live.next(() => true);
  save('s.css', 'h1{color:blue}');
  const hot = await live.next((s) => s.hot > (first.hot || 0));
  live.stop();
  assert.ok(hot, 'a hot update came');
  assert.equal(hot.files, first.files, 'no reload');
  assert.deepEqual(hot.hotFiles, [{ path: '/s.css', kind: 'css' }]);
});

test('an HTML save and a picture save are hot too', async () => {
  const live = await listen();
  const first = await live.next(() => true);
  save('index.html', '<!doctype html><title>t</title><link rel="stylesheet" href="s.css"><h1 id="t">Hello again</h1>');
  const html = await live.next((s) => s.hot > (first.hot || 0));
  assert.deepEqual(html?.hotFiles, [{ path: '/index.html', kind: 'html' }]);
  save('pic.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="5" height="5"/>');
  const img = await live.next((s) => s.hot > html.hot);
  live.stop();
  assert.deepEqual(img?.hotFiles, [{ path: '/pic.svg', kind: 'img' }]);
  assert.equal(img.files, first.files, 'still no reload');
});

// macOS reports a write through a symlink under the target's path only: the served path of the link must be told too.
test('a page, a stylesheet and a picture served through symlinks update when the target is written', async () => {
  const outer = tmp('hot-out'); // a target outside the served folder is outside the watcher too
  fs.mkdirSync(path.join(DIR, '_alt'));
  save('_alt/page.html', '<!doctype html><title>l</title><h1>one</h1>');
  save('_alt/theme.css', 'h1{color:red}');
  fs.writeFileSync(path.join(outer, 'far.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>');
  fs.symlinkSync('_alt/page.html', path.join(DIR, 'linked.html'));
  fs.symlinkSync('_alt/theme.css', path.join(DIR, 'linked.css'));
  fs.symlinkSync(path.join(outer, 'far.svg'), path.join(DIR, 'far.svg'));
  await sleep(400); // the links' own events settle
  for (const [link, target, text, kind] of [
    ['/linked.html', '_alt/page.html', '<!doctype html><title>l</title><h1>two</h1>', 'html'],
    ['/linked.css', '_alt/theme.css', 'h1{color:blue}', 'css'],
    ['/far.svg', null, '<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9"/>', 'img'],
  ]) {
    const live = await listen();
    const first = await live.next(() => true);
    if (target) save(target, text);
    else fs.writeFileSync(path.join(outer, 'far.svg'), text);
    const hot = await live.next((s) => s.hot > (first.hot || 0));
    live.stop();
    assert.ok(hot?.hotFiles.some((f) => f.path === link && f.kind === kind), `${link} was told: ${JSON.stringify(hot?.hotFiles)}`);
  }
  rm([outer]);
});

test('more hot files in one go than the list holds is a reload, not a list that leaves some out', async () => {
  const live = await listen();
  const first = await live.next(() => true);
  for (let i = 0; i < 60; i++) save(`many-${i}.css`, `h1{margin:${i}px}`);
  // Only an answer to this burst: on Linux the test above removing its outside folder is a change too (far.svg), and
  // that update can land here first. Taken for this one, it failed this test and left the burst's reload to the next.
  const said = await live.next((s) => s.files > first.files || (s.hot > (first.hot || 0) && s.hotFiles?.some((f) => f.path.startsWith('/many-'))));
  live.stop();
  assert.ok(said?.files > first.files, 'every page reloads');
  assert.equal(said.changed, null, 'with no list of files');
});

test('a script save is a reload', async () => {
  const live = await listen();
  const first = await live.next(() => true);
  save('app.js', 'console.log(2)');
  const reload = await live.next((s) => s.files > first.files);
  live.stop();
  assert.ok(reload, 'files version went up');
  assert.ok(reload.changed?.includes('/app.js'), 'the page is told which file it was');
});

// The page decides: it reloads only if it uses one of these. A README or another page's script leaves it alone.
test('a reload says which files changed', async () => {
  const live = await listen();
  const first = await live.next(() => true);
  save('notes.md', '# notes');
  const reload = await live.next((s) => s.files > first.files);
  live.stop();
  assert.deepEqual(reload?.changed, ['/notes.md']);
});

test('comment changes reach pages as deltas: a new comment, a reply, a delete', async () => {
  const live = await listen();
  const first = await live.next(() => true);
  const { comment } = await post({ page: '/index', name: 'Leo', text: 'bigger title', anchor: { selector: '#t', x: 0.1, y: 0.5, docX: 0.1, docY: 20, width: 1000, element: '<h1 id="t">' } });
  const after1 = await live.next((s) => s.comments > first.comments);
  const d1 = await (await fetch(`${B}/_lab/api/changes?page=/index&since=${first.comments}`)).json();
  assert.ok(d1.set.some((c) => c.id === comment.id), 'the new comment is in the delta');
  await post({ page: '/index', name: 'Claude', text: 'Done: bigger', parent: comment.id });
  const after2 = await live.next((s) => s.comments > after1.comments);
  const d2 = await (await fetch(`${B}/_lab/api/changes?page=/index&since=${after1.comments}`)).json();
  assert.ok(d2.set.some((c) => c.parent === comment.id), 'the reply is in the delta');
  assert.ok(!d2.set.some((c) => c.id === comment.id && c.text !== 'bigger title'), 'only what changed');
  const key = (await (await fetch(B + '/')).text()).match(/data-admin="([^"]+)"/)?.[1];
  await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-admin': key }, body: JSON.stringify({ page: '/index', action: 'delete', id: comment.id }) });
  await live.next((s) => s.comments > after2.comments);
  const d3 = await (await fetch(`${B}/_lab/api/changes?page=/index&since=${after2.comments}`)).json();
  live.stop();
  assert.ok(d3.del.includes(comment.id), 'the delete is in the delta');
});

// A question's pick is a reply like any: the widget's other tabs get it as a delta, with its picked field, so their
// rows are drawn again as answered.
test('a pick reaches pages as a delta', async () => {
  const live = await listen();
  const first = await live.next(() => true);
  const anchor = { selector: '#t', x: 0.1, y: 0.5, docX: 0.1, docY: 20, width: 1000, element: '<h1 id="t">' };
  const { comment } = await post({ page: '/index', name: 'Leo', text: 'tone?', anchor });
  const key = serverJson(DIR).agent;
  const asked = await (await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-agent': '1', 'x-lab-admin': key }, body: JSON.stringify({ page: '/index', name: 'Claude', text: 'Which?', parent: comment.id, choices: ['Hello', 'Hi there'], recommend: 1 }) })).json();
  const mid = await live.next((s) => s.comments > first.comments);
  const picked = await post({ page: '/index', name: 'Leo', text: 'Picked B: Hi there', parent: asked.comment.id, to: asked.comment.id, picked: 1 });
  await live.next((s) => s.comments > mid.comments);
  const d = await (await fetch(`${B}/_lab/api/changes?page=/index&since=${first.comments}`)).json();
  live.stop();
  assert.deepEqual(d.set.find((c) => c.id === asked.comment.id).choices, ['Hello', 'Hi there'], 'the question carries its choices');
  assert.deepEqual(d.set.find((c) => c.id === picked.comment.id).picked, { of: asked.comment.id, n: 1 }, 'the pick says which question and which row');
});

test('a delta from too long ago, or from the future, asks for the whole list', async () => {
  const far = await (await fetch(`${B}/_lab/api/changes?page=/index&since=999999`)).json();
  assert.equal(far.full, true);
});

// A page is served with the hot count of that moment (data-hot), so a save between its load and its first live message
// is caught up instead of being the page's baseline.
test('a page is served with the lab\'s hot count', async () => {
  const live = await listen();
  const first = await live.next(() => true);
  const html = await (await up()).text();
  live.stop();
  assert.equal(html.match(/data-hot="(\d+)"/)?.[1], String(first.hot || 0));
  save('s.css', 'h1{color:green}');
  const after = await (async () => {
    for (let i = 0; i < 60; i++) {
      const tag = (await (await up()).text()).match(/data-hot="(\d+)"/)?.[1];
      if (tag !== String(first.hot || 0)) return tag;
      await sleep(50);
    }
  })();
  assert.equal(after, String((first.hot || 0) + 1), 'a save counts');
});

// A new folder in the burst is itself a "changed" entry the page would find unused: with the hot list cut, nothing may
// tell a page it can stay.
test('a burst of more than 50 hot files and a new folder reloads every page', async () => {
  const live = await listen();
  const first = await live.next(() => true);
  fs.mkdirSync(path.join(DIR, 'bulk'), { recursive: true });
  for (let i = 0; i < 52; i++) save(`bulk/f${i}.css`, `/* ${i} */`);
  save('index.html', '<!doctype html><title>t</title><link rel="stylesheet" href="s.css"><h1 id="t">Burst</h1>');
  const said = await live.next((s) => s.files > first.files);
  live.stop();
  assert.ok(said, 'files version went up');
  assert.equal(said.changed, null, 'no list: the page reloads');
});

// The browser keeps a file by its ETag: one that stays the same when the bytes change shows the old bytes after a reload.
test('a file saved with the same size and mtime gets a new ETag, and an unchanged one keeps it', async () => {
  const f = path.join(DIR, 'same.js');
  fs.writeFileSync(f, 'var v="AAAA";');
  const st = fs.statSync(f);
  const a = await fetch(B + '/same.js');
  const tag = a.headers.get('etag');
  assert.equal((await fetch(B + '/same.js', { headers: { 'if-none-match': tag } })).status, 304, 'unchanged: kept');
  fs.writeFileSync(f, 'var v="BBBB";');
  fs.utimesSync(f, st.atime, st.mtime);
  const b = await fetch(B + '/same.js', { headers: { 'if-none-match': tag } });
  assert.equal(b.status, 200);
  assert.equal(await b.text(), 'var v="BBBB";');
});

test('a restart is a new lab id (pages catch up in place), the widget revision stays', async () => {
  const before = (await (await fetch(B + '/')).text()).match(/data-lab="([^"]+)" data-widget="([^"]+)"/);
  server.kill();
  await sleep(500);
  start();
  const html = await (await up()).text();
  const now = html.match(/data-lab="([^"]+)" data-widget="([^"]+)"/);
  assert.notEqual(now[1], before[1], 'new lab id');
  assert.equal(now[2], before[2], 'same widget');
});
