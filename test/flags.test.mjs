// Flags: what you are trying (talk, now). Off unless your own settings.json or the ⋯ menu's experiments turn one on;
// a switch in the menu is saved there, so it holds in every lab you run.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { LAB, claimPort, tmp as folder, rm, sleep } from './harness.mjs';
import { loadSettings, FLAGS } from '../lib/settings.ts';

const dirs = [];
const kids = [];
after(() => {
  for (const k of kids) k.kill();
  rm(dirs);
});
const tmp = () => {
  const d = fs.realpathSync(folder('flags'));
  dirs.push(d);
  return d;
};
const mine = (cfg) => path.join(cfg, 'labit', 'settings.json');
// Settings from a folder of its own, with your settings.json in a config home of its own.
const read = (dir, cfg, flags) => {
  if (flags !== undefined) {
    fs.mkdirSync(path.join(cfg, 'labit'), { recursive: true });
    fs.writeFileSync(mine(cfg), JSON.stringify({ flags }));
  }
  const was = process.env.XDG_CONFIG_HOME; // your file is found where XDG_CONFIG_HOME says
  process.env.XDG_CONFIG_HOME = cfg;
  try {
    return loadSettings(dir, {}, {});
  } finally {
    process.env.XDG_CONFIG_HOME = was;
  }
};

test('talk (K) is an experiment, off by default, and the widget shows it only when the flag is on', () => {
  assert.deepEqual(FLAGS, ['talk']);
  const s = read(tmp(), tmp());
  assert.deepEqual(s.values.flags, {});
  assert.equal(s.from.flags, 'default');
  const widget = fs.readFileSync(new URL('../src/comments.js', import.meta.url), 'utf8');
  // K goes through the bar's talk button, which stays hidden while the flag is off: one gate for both.
  assert.match(widget, /walkieBtn\.hidden = [^;\n]*!flag\('talk'\)/);
  assert.match(widget, /if \(k === 'walkie'\) return walkieBtn\.hidden \|\|/);
});

test('your settings turn a flag on; a name nobody tries any more, or a flag that is off, is skipped without a word', () => {
  let s = read(tmp(), tmp(), { talk: true, inkOnText: true, native: false });
  assert.deepEqual([s.values.flags, s.problems], [{ talk: true }, []]);
  s = read(tmp(), tmp(), { talk: false });
  assert.deepEqual(s.values.flags, {});
  s = read(tmp(), tmp(), 'on');
  assert.match(s.problems.join('\n'), /flags must be an object/);
});

test("a project's labit.json can't switch your experiments", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'labit.json'), JSON.stringify({ flags: { talk: true } }));
  const s = read(dir, tmp());
  assert.deepEqual(s.values.flags, {});
  assert.match(s.problems.join('\n'), /flags can only be set in your own settings/);
});

// The lab: POST /_lab/flags with the browser's key, from this computer.
const startLab = async (dir, cfg) => {
  const port = claimPort(7600, 150);
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>t</title><h1 id="t">Hi</h1>');
  const lab = spawn(process.execPath, [LAB, '--no-open', '--new', '--port', String(port)], { cwd: dir, env: { ...process.env, PORT: '', XDG_CONFIG_HOME: cfg } });
  kids.push(lab);
  const B = `http://localhost:${port}`;
  let html = '';
  for (let i = 0; i < 80 && !html; i++) {
    html = await fetch(B + '/').then((r) => r.text(), () => '');
    if (!html) await sleep(100);
  }
  assert.ok(html, 'the lab answers');
  const key = html.match(/data-admin="([^"]+)"/)?.[1];
  const flagsOf = (h) => JSON.parse(h.match(/data-flags='([^']*)'/)[1]);
  const post = (body, k = key) => fetch(B + '/_lab/flags', { method: 'POST', headers: { 'content-type': 'application/json', ...(k ? { 'x-lab-admin': k } : {}) }, body: JSON.stringify(body) });
  return { B, html, key, flagsOf, post };
};
const saved = (cfg) => (fs.existsSync(mine(cfg)) ? JSON.parse(fs.readFileSync(mine(cfg), 'utf8')).flags : undefined);

test('the experiments switch: owner only, saved in your settings, on the page and the live state at once', async () => {
  const dir = tmp();
  const cfg = tmp();
  const { B, html, key, flagsOf, post } = await startLab(dir, cfg);
  assert.ok(key, "this computer's page has the key");
  assert.deepEqual(flagsOf(html), { talk: false });

  assert.equal((await post({ flag: 'talk', on: true }, '')).status, 403, 'no key: refused');
  assert.equal((await post({ flag: 'talk', on: true }, 'x'.repeat(key.length))).status, 403, 'a wrong key: refused');
  assert.equal((await post({ flag: 'inkOnText', on: true })).status, 400, 'a flag nobody tries');
  assert.equal((await post({ flag: 'talk', on: 'yes' })).status, 400);
  assert.equal((await post({ flag: '__proto__', on: true })).status, 400);
  assert.equal(saved(cfg), undefined, 'nothing written for a refused switch');

  const r = await post({ flag: 'talk', on: true });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).flags, ['talk']);
  assert.deepEqual(saved(cfg), { talk: true }, 'in your own settings');
  assert.equal(fs.existsSync(path.join(dir, 'labit.json')), false, "the project's file is not touched");
  assert.deepEqual(flagsOf(await (await fetch(B + '/')).text()), { talk: true }, 'the next page load has it, no restart');
  assert.deepEqual((await (await fetch(B + '/_lab/state')).json()).flags, ['talk'], 'open pages hear it');

  await post({ flag: 'talk', on: false });
  assert.deepEqual(saved(cfg), {}, 'off: none on');
  assert.deepEqual((await (await fetch(B + '/_lab/state')).json()).flags, []);
});

test('`labit settings` names the flags that are on', async () => {
  const cli = (cwd, cfg) => new Promise((resolve) => execFile(process.execPath, [LAB, 'settings'], { cwd, env: { ...process.env, PORT: '', XDG_CONFIG_HOME: cfg } }, (err, out) => resolve({ code: err ? (Number.isInteger(err.code) ? err.code : 1) : 0, out })));
  const dir = tmp();
  const cfg = tmp();
  assert.match((await cli(dir, cfg)).out, /^flags\s+none on\s+default$/m);
  read(dir, cfg, { talk: true });
  const r = await cli(dir, cfg);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^flags\s+talk\s+your settings$/m);
});
