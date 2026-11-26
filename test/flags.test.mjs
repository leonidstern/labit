// Flags: what the lab is trying (talk, now). Off unless labit.json, your settings or the ⋯ menu's experiments turn one
// on. A switch in the menu is saved in your own settings; the project's labit.json still wins.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { LAB, claimPort, tmp as folder, rm, sleep } from './harness.mjs';
import { loadSettings, savePersonalFlag } from '../lib/settings.ts';
import { FLAGS, flagDefaults, flagsOn } from '../lib/flags.ts';

// The flag these checks switch: the first one there is. Nothing is being tried when the table is empty, and the
// checks that need one skip (the checks for a name nobody tries run either way).
const ONE = Object.keys(FLAGS)[0];
const NONE = !ONE && 'nothing is being tried';

test('talk (K) is an experiment, off by default, and the widget shows it only when the flag is on', () => {
  assert.ok('talk' in FLAGS);
  assert.equal(flagDefaults().talk, false);
  const widget = fs.readFileSync(new URL('../src/comments.js', import.meta.url), 'utf8');
  // K goes through the bar's talk button, which stays hidden while the flag is off: one gate for both.
  assert.match(widget, /walkieBtn\.hidden = [^;\n]*!flag\('talk'\)/);
  assert.match(widget, /if \(k === 'walkie'\) return walkieBtn\.hidden \|\|/);
});

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
// Settings read from a folder of their own, with no labit.json above it and nobody's personal file in the way.
const read = (dir) => loadSettings(dir, {}, { XDG_CONFIG_HOME: path.join(dir, 'nothing') });

test('every flag is off until somebody says otherwise', () => {
  const s = read(tmp());
  assert.deepEqual(s.values.flags, flagDefaults());
  assert.deepEqual(flagsOn(s.values.flags), []);
  assert.equal(s.from.flags, 'default');
});

test("a flag in the project's file turns it on, and the others stay off", { skip: !Object.keys(FLAGS).length && 'nothing is being tried' }, () => {
  const dir = tmp();
  const one = Object.keys(FLAGS)[0];
  fs.writeFileSync(path.join(dir, 'labit.json'), JSON.stringify({ flags: { [one]: true } }));
  const s = read(dir);
  assert.equal(s.values.flags[one], true);
  assert.deepEqual(flagsOn(s.values.flags), [one]);
  assert.deepEqual(s.problems, []);
  for (const k of Object.keys(FLAGS)) if (k !== one) assert.equal(s.values.flags[k], false);
});

test('a name nobody is trying any more is skipped without a word, not obeyed', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'labit.json'), JSON.stringify({ flags: { wasKeptLastYear: true, inkOnText: true } }));
  const s = read(dir);
  assert.deepEqual(s.problems, []);
  assert.deepEqual(flagsOn(s.values.flags), []);
  assert.equal('inkOnText' in s.values.flags, false);
  assert.throws(() => savePersonalFlag('inkOnText', true), /not something being tried/);
});

test('a flag that is not true or false is ignored, with a word about it', { skip: !Object.keys(FLAGS).length && 'nothing is being tried' }, () => {
  const dir = tmp();
  const one = Object.keys(FLAGS)[0];
  fs.writeFileSync(path.join(dir, 'labit.json'), JSON.stringify({ flags: { [one]: 'yes' } }));
  const s = read(dir);
  assert.match(s.problems[0], /must be true or false/);
  assert.equal(s.values.flags[one], false);
});

// Your own settings file, in a config home of its own (the switch writes where XDG_CONFIG_HOME says).
const withConfig = (cfg, fn) => {
  const was = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = cfg;
  try {
    return fn();
  } finally {
    process.env.XDG_CONFIG_HOME = was;
  }
};
const mine = (cfg) => path.join(cfg, 'labit', 'settings.json');
// No flag in your settings (a lab writes your actions there once when it starts, lib/actions.ts; that is not a switch).
const noFlags = (cfg) => !fs.existsSync(mine(cfg)) || !('flags' in JSON.parse(fs.readFileSync(mine(cfg), 'utf8')));

test('a switch is saved in your own settings, keeps the rest of the file, and off leaves no trace', { skip: NONE }, () => {
  const cfg = tmp();
  fs.mkdirSync(path.join(cfg, 'labit'));
  fs.writeFileSync(mine(cfg), JSON.stringify({ name: 'Leo', shortcuts: { chat: 'x' } }));
  const file = withConfig(cfg, () => savePersonalFlag(ONE, true));
  assert.equal(file, mine(cfg));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { name: 'Leo', shortcuts: { chat: 'x' }, flags: { [ONE]: true } });
  const s = withConfig(cfg, () => loadSettings(tmp(), {}, {}));
  assert.equal(s.values.flags[ONE], true);
  assert.equal(s.flagFrom[ONE], 'personal');
  withConfig(cfg, () => savePersonalFlag(ONE, false));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { name: 'Leo', shortcuts: { chat: 'x' } });
  assert.throws(() => withConfig(cfg, () => savePersonalFlag('wasKeptLastYear', true)), /not something being tried/);
});

test('a switch makes your settings file when there is none, and never writes over one that is not JSON', { skip: NONE }, () => {
  const cfg = tmp();
  withConfig(cfg, () => savePersonalFlag(ONE, true));
  assert.deepEqual(JSON.parse(fs.readFileSync(mine(cfg), 'utf8')), { flags: { [ONE]: true } });
  fs.writeFileSync(mine(cfg), '{ "name": "Leo", }');
  assert.throws(() => withConfig(cfg, () => savePersonalFlag(ONE, false)));
  assert.equal(fs.readFileSync(mine(cfg), 'utf8'), '{ "name": "Leo", }', 'left as it was');
});

test("the project's labit.json wins over your switch, and says it is the project's", { skip: NONE }, () => {
  const dir = tmp();
  const cfg = tmp();
  fs.writeFileSync(path.join(dir, 'labit.json'), JSON.stringify({ flags: { [ONE]: false } }));
  withConfig(cfg, () => savePersonalFlag(ONE, true));
  const s = withConfig(cfg, () => loadSettings(dir, {}, {}));
  assert.equal(s.values.flags[ONE], false);
  assert.equal(s.flagFrom[ONE], 'project');
});

// The lab: POST /_lab/flags with the browser's key, from this computer. One lab, started once for these checks.
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
  const flagsOf = (h) => JSON.parse(h.match(/data-flags='([^']*)'/)[1].replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&amp;/g, '&'));
  const post = (body, k = key) => fetch(B + '/_lab/flags', { method: 'POST', headers: { 'content-type': 'application/json', ...(k ? { 'x-lab-admin': k } : {}) }, body: JSON.stringify(body) });
  return { B, html, key, flagsOf, post };
};

test('the experiments switch: owner only, saved in your settings, on the page and the live state at once', { skip: NONE }, async () => {
  const dir = tmp();
  const cfg = tmp();
  const { B, html, key, flagsOf, post } = await startLab(dir, cfg);
  assert.ok(key, "this computer's page has the key");
  assert.equal(flagsOf(html)[ONE].on, false);
  assert.equal(flagsOf(html)[ONE].project, undefined);

  assert.equal((await post({ flag: ONE, on: true }, '')).status, 403, 'no key: refused');
  assert.equal((await post({ flag: ONE, on: true }, 'x'.repeat(key.length))).status, 403, 'a wrong key: refused');
  assert.equal((await post({ flag: 'wasKeptLastYear', on: true })).status, 400);
  assert.equal((await post({ flag: ONE, on: 'yes' })).status, 400);
  assert.equal((await post({ flag: '__proto__', on: true })).status, 400);
  assert.ok(noFlags(cfg), 'nothing written for a refused switch');

  const r = await post({ flag: ONE, on: true });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).flags, [ONE]);
  assert.deepEqual(JSON.parse(fs.readFileSync(mine(cfg), 'utf8')).flags, { [ONE]: true }, 'in your own settings');
  assert.equal(fs.existsSync(path.join(dir, 'labit.json')), false, "the project's file is not touched");
  assert.equal(flagsOf(await (await fetch(B + '/')).text())[ONE].on, true, 'the next page load has it, no restart');
  assert.deepEqual((await (await fetch(B + '/_lab/state')).json()).flags, [ONE], 'open pages hear it');

  await post({ flag: ONE, on: false });
  assert.ok(noFlags(cfg), 'off leaves no flags behind');
  assert.deepEqual((await (await fetch(B + '/_lab/state')).json()).flags, []);
});

test('a switch for a flag that was dropped (inkOnText) is refused, and nothing is written', async () => {
  const dir = tmp();
  const cfg = tmp();
  const { html, flagsOf, post } = await startLab(dir, cfg);
  assert.ok(!('inkOnText' in flagsOf(html)), 'the page is not offered it');
  assert.equal((await post({ flag: 'inkOnText', on: true })).status, 400);
  assert.ok(noFlags(cfg), 'nothing written for a refused switch');
});

test("a flag the project's labit.json sets: shown as the project's, and the switch is refused", { skip: NONE }, async () => {
  const dir = tmp();
  const cfg = tmp();
  fs.writeFileSync(path.join(dir, 'labit.json'), JSON.stringify({ flags: { [ONE]: true } }));
  const { html, flagsOf, post } = await startLab(dir, cfg);
  assert.deepEqual(flagsOf(html)[ONE], { name: FLAGS[ONE].name, on: true, project: true });
  assert.equal((await post({ flag: ONE, on: false })).status, 409);
  assert.ok(noFlags(cfg));
});

test('`labit settings` names each flag that is on and whose it is', { skip: NONE }, async () => {
  const { execFile } = await import('node:child_process');
  const cli = (cwd, cfg) => new Promise((resolve) => execFile(process.execPath, [LAB, 'settings'], { cwd, env: { ...process.env, PORT: '', XDG_CONFIG_HOME: cfg } }, (err, out) => resolve({ code: err?.code ?? 0, out })));
  const dir = tmp();
  const cfg = tmp();
  withConfig(cfg, () => savePersonalFlag(ONE, true));
  let r = await cli(dir, cfg);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, new RegExp(`^flags\\s+${ONE} \\(yours\\)\\s+your settings$`, 'm'));
  fs.writeFileSync(path.join(dir, 'labit.json'), JSON.stringify({ flags: { [ONE]: true } }));
  r = await cli(dir, cfg);
  assert.match(r.out, new RegExp(`^flags\\s+${ONE} \\(labit\\.json\\)\\s+labit\\.json \\+ your settings$`, 'm'));
});
