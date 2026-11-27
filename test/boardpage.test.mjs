// The board page's route: /_lab/board/<name> is an empty page that loads the one board (boardview.js, the same file a
// page's board view is) and the widget under the board's key.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimPort, tmp, rm, spawnLab, up as answers } from './harness.mjs';

const mk = (flags) => {
  const dir = fs.realpathSync(tmp('boardpage'));
  fs.writeFileSync(path.join(dir, 'labit.json'), JSON.stringify({ flags }));
  return dir;
};
const [ON] = [mk({})];
const base = claimPort(9900, 100);
const procs = [ON].map((d) => spawnLab(d, base));
after(() => {
  procs.forEach((p) => p.kill());
  rm([ON]);
});
const up = (port) => answers(`http://localhost:${port}/_lab/state`);

test('the board page is a shell: the one board (boardview.js) first, then the widget under the board key', async () => {
  await up(base);
  const r = await fetch(`http://localhost:${base}/_lab/board/checkout`);
  const html = await r.text();
  assert.equal(r.status, 200);
  assert.match(html, /<script type="module">import\{own\}from"\/_lab\/boardview\.js";own\("checkout"\)<\/script>/);
  assert.match(html, /<title>board checkout<\/title>/);
  assert.match(html, /data-page="\/_board\/checkout"/);
  assert.ok(html.indexOf('/_lab/boardview.js') < html.indexOf('/_lab/comments.js'), 'the board script comes first: it must exist before the frames load');
  assert.match(html, /maximum-scale=1, user-scalable=no/);
  const js = await fetch(`http://localhost:${base}/_lab/boardview.js`);
  assert.equal(js.status, 200);
  const text = await js.text();
  assert.ok(text.length > 1000);
  assert.match(text, /export\{[^}]*\bas own\b[^}]*\}/, 'the file the page imports own() from');
});

test('one board is shipped: no second bundle beside the view', async () => {
  assert.equal((await fetch(`http://localhost:${base}/_lab/board.js`)).status, 404);
  const here = path.dirname(fileURLToPath(import.meta.url));
  assert.ok(!fs.existsSync(path.join(here, '../public/_lab/board.js')));
  assert.ok(!JSON.parse(fs.readFileSync(path.join(here, '../package.json'), 'utf8')).files.includes('public/_lab/board.js'));
});

test('a board page does not count as an opened page', async () => {
  // When a page was opened is kept in .lab/state.json (opened). A plain page opened after the board shows the save
  // happened; the board is not in it.
  fs.writeFileSync(path.join(ON, 'plain.html'), '<!doctype html><title>plain</title><h1>plain</h1>');
  assert.equal((await fetch(`http://localhost:${base}/_lab/board/checkout`)).status, 200);
  assert.equal((await fetch(`http://localhost:${base}/plain`)).status, 200);
  let opened = {};
  for (let i = 0; i < 60 && !opened['/plain']; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try { opened = JSON.parse(fs.readFileSync(path.join(ON, '.lab/state.json'), 'utf8')).opened || {}; } catch {}
  }
  assert.ok(opened['/plain'], 'the plain page is recorded as opened');
  assert.deepEqual(Object.keys(opened).filter((k) => k.startsWith('/_board')), []);
});

test('a name that is not a board name is not a board page', async () => {
  const r = await fetch(`http://localhost:${base}/_lab/board/Bad%20Name`);
  assert.notEqual(r.status, 200);
});
