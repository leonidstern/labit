// ~/.labit/roots remembers every folder a lab served, after it stops; `labit gc` reports what each .lab keeps and what
// could go, and changes nothing (#427).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { claimPort, cli, rm, spawnLab, stop, tmp, up } from './harness.mjs';

const dirs = [];
after(() => rm(dirs));
const folder = (name) => {
  const d = fs.realpathSync(tmp(name));
  dirs.push(d);
  return d;
};
const lines = (home) => fs.readFileSync(path.join(home, 'roots'), 'utf8').split('\n').filter(Boolean);

test('a lab stopped with Ctrl-C is still remembered, once however often it starts', async () => {
  const home = folder('gc-home');
  const dir = folder('gc-site');
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>Hi</h1>');
  for (let i = 0; i < 2; i++) {
    const port = claimPort(5600, 90);
    const lab = spawnLab(dir, port, { env: { ...process.env, LABIT_HOME: home } });
    await up(`http://localhost:${port}/_lab/pages`);
    lab.kill('SIGINT');
    await stop(lab);
  }
  assert.deepEqual(fs.readdirSync(path.join(home, 'servers')), [], 'servers/ forgot it');
  assert.deepEqual(lines(home), [JSON.stringify(dir)]);
});

// A .lab as labit leaves it: a comment with a picture, an archived one with a picture, and the leftovers a clean-up could take.
const lab = (root, { old = true } = {}) => {
  const L = path.join(root, '.lab');
  for (const d of ['comments', 'archive', 'attachments/.staged', 'boards/b']) fs.mkdirSync(path.join(L, d), { recursive: true });
  fs.writeFileSync(path.join(L, '.gitignore'), '*\n');
  const page = (id) => JSON.stringify({ v: 3, page: '/', comments: { [id]: { id, text: 'x', images: [{ n: 1, type: 'png' }] } } });
  fs.writeFileSync(path.join(L, 'comments/_.json'), page('aaaaaaaaaaaa'));
  fs.writeFileSync(path.join(L, 'archive/_.json'), page('bbbbbbbbbbbb'));
  fs.writeFileSync(path.join(L, 'attachments/aaaaaaaaaaaa-1.png'), Buffer.alloc(200));
  fs.writeFileSync(path.join(L, 'attachments/bbbbbbbbbbbb-1.png'), Buffer.alloc(300));
  fs.writeFileSync(path.join(L, 'attachments/cccccccccccc-1.png'), Buffer.alloc(100));
  fs.writeFileSync(path.join(L, 'attachments/.staged/0123'), 'x');
  fs.writeFileSync(path.join(L, 'state.json.tmp'), '{');
  fs.writeFileSync(path.join(L, 'boards/b/f1.html'), '<p>');
  if (old) for (const f of ['attachments/cccccccccccc-1.png', 'attachments/.staged/0123', 'state.json.tmp']) fs.utimesSync(path.join(L, f), new Date(0), new Date(0));
};
const snapshot = (dir) => {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      const s = fs.lstatSync(f);
      out[f] = e.isFile() ? `${s.size} ${s.mtimeMs} ${crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex')}` : `${e.isDirectory() ? 'dir' : 'link'} ${s.mtimeMs}`;
      if (e.isDirectory()) walk(f);
    }
  };
  walk(dir);
  return out;
};

test('labit gc reports every known lab and what could go, and changes nothing', async () => {
  const home = folder('gc-home');
  const w = folder('gc-labs');
  const a = path.join(w, 'a');
  const fresh = path.join(w, 'fresh');
  const theirs = path.join(w, 'theirs');
  lab(a);
  lab(fresh, { old: false });
  fs.mkdirSync(path.join(theirs, '.lab'), { recursive: true });
  fs.writeFileSync(path.join(theirs, '.lab', 'notes.txt'), 'not labit');
  fs.symlinkSync(a, path.join(w, 'a-link'));
  const roots = [a, path.join(w, 'a-link'), fresh, theirs, path.join(w, 'gone'), '/Volumes/labit-test-unplugged/site'];
  // as labs write it, plus what a crash or another tool could leave: a line cut short, junk, a relative path
  fs.writeFileSync(path.join(home, 'roots'), roots.map((r) => '\n' + JSON.stringify(r)).join('') + '\n"/half/writ\nnot json\n42\n"relative/path"');
  const before = snapshot(w);
  const homeBefore = snapshot(home);
  const { code, out } = await cli(['gc'], { env: { ...process.env, LABIT_HOME: home } });
  assert.equal(code, 0, out);
  assert.deepEqual(snapshot(w), before, 'no project file written, moved or deleted');
  assert.deepEqual(snapshot(home), homeBefore, 'nor anything in ~/.labit');
  const at = (r) => out.split('\n').findIndex((l) => l.startsWith(r + '  '));
  const block = (r) => out.split('\n').slice(at(r), at(r) + 4).join('\n');
  assert.match(block(a), /could go: uploads never sent \(1\)/);
  assert.match(block(a), /could go: unfinished writes \(1\)/);
  assert.match(block(a), /could go: pictures no comment names \(1\), 100 B/, 'the archived comment keeps its picture');
  assert.doesNotMatch(block(fresh).split('\n').slice(0, 2).join('\n'), /could go/, 'nothing changed in the last minute is offered');
  assert.match(out, new RegExp(`${path.join(w, 'a-link')}  same folder as ${a}`));
  assert.match(out, new RegExp(`${theirs}  no labit .lab here`));
  assert.match(out, new RegExp(`${path.join(w, 'gone')}  missing`));
  assert.match(out, /\/Volumes\/labit-test-unplugged\/site {2}offline/);
  assert.doesNotMatch(out, /half|relative|^42/m, 'damaged lines are skipped');
  assert.match(out, /6 lab folders, .*Nothing was changed/);
});

test('labit gc with nothing known', async () => {
  const home = folder('gc-home');
  const { code, out } = await cli(['gc'], { env: { ...process.env, LABIT_HOME: home } });
  assert.equal(code, 0);
  assert.match(out, /No labs known/);
  assert.deepEqual(fs.readdirSync(home), [], 'it made nothing');
});
