// Settings (lib/settings.ts): labit.json in the project and ~/.config/labit/settings.json fill in what flags and
// variables leave out. The rules on their own first, then `labit settings`, then a lab started with a labit.json.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LAB, claimPort, tmp as folder, rm, sleep, cli as command } from './harness.mjs';
import { loadSettings, seedActions } from '../lib/settings.ts';
import { SEED, NAME_MAX } from '../lib/actions.ts';

const dirs = [];
const kids = [];
after(() => {
  for (const k of kids) k.kill();
  rm(dirs);
});
const tmp = (name) => {
  const d = fs.realpathSync(folder(`set-${name}`));
  dirs.push(d);
  return d;
};
// A project folder with labit.json, and a config home with your settings.json.
const setup = (project, personal) => {
  const proj = tmp('proj');
  const cfg = tmp('cfg');
  if (project) fs.writeFileSync(path.join(proj, 'labit.json'), JSON.stringify(project));
  if (personal) {
    fs.mkdirSync(path.join(cfg, 'labit'));
    fs.writeFileSync(path.join(cfg, 'labit', 'settings.json'), JSON.stringify(personal));
  }
  return { proj, cfg, load: (flags = {}, env = {}) => withConfig(cfg, () => loadSettings(proj, flags, env)) };
};
const withConfig = (cfg, fn) => {
  const was = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = cfg;
  try {
    return fn();
  } finally {
    process.env.XDG_CONFIG_HOME = was;
  }
};

test('the first that has a setting wins: flag, variable, labit.json, your settings, default', () => {
  const { load } = setup({ port: 4700, batchSeconds: 1 }, { port: 4800, batchSeconds: 5, remindAfterMinutes: 9 });
  let s = load();
  assert.equal(s.values.port, 4700);
  assert.match(s.from.port, /labit\.json$/);
  assert.equal(s.values.remindAfterMinutes, 9, 'yours, where the project says nothing');
  assert.equal(s.values.archiveAfterDays, 30, 'the default');
  assert.equal(s.from.archiveAfterDays, 'default');
  s = load({}, { PORT: '5000', LAB_SETTLE_MS: '500' });
  assert.equal(s.values.port, 5000);
  assert.equal(s.from.port, 'env PORT');
  assert.equal(s.values.batchSeconds, 0.5);
  s = load({ port: 5100 }, { PORT: '5000' });
  assert.equal(s.values.port, 5100);
  assert.equal(s.from.port, 'flag');
  assert.deepEqual(s.problems, []);
});

test('boards are off unless a file or LABIT_BOARDS turns them on (Leo, 21 Nov: boards behind a flag for now)', () => {
  assert.equal(setup().load().values.boards, false);
  assert.equal(setup({ boards: true }).load().values.boards, true);
  assert.equal(setup(null, { boards: true }).load().values.boards, true);
  assert.equal(setup().load({}, { LABIT_BOARDS: '1' }).values.boards, true);
  assert.equal(setup({ boards: true }).load({}, { LABIT_BOARDS: '0' }).values.boards, false, 'the variable wins');
});

test('a project file can\'t name you or open your lab to the wifi; your file can\'t pick a project\'s folder', () => {
  const { load } = setup({ name: 'mallory', wifi: true, model: 'X' }, { folder: 'dist', proxy: '3000' });
  const s = load();
  assert.equal(s.values.name, '');
  assert.equal(s.values.wifi, false);
  assert.equal(s.values.folder, '.');
  assert.equal(s.values.proxy, '');
  for (const key of ['name', 'wifi', 'model', 'folder', 'proxy']) assert.ok(s.problems.some((p) => p.includes(`${key} can only be set`)), key);
});

test('unknown keys, wrong types and broken JSON are said and skipped, the rest still counts', () => {
  const { proj, load } = setup({ port: 'fast', nope: 1, open: false, archiveAfterDays: 0 });
  let s = load();
  assert.equal(s.values.port, 4400);
  assert.equal(s.values.open, false);
  assert.equal(s.values.archiveAfterDays, 30);
  assert.ok(s.problems.some((p) => /port must be a number/.test(p)));
  assert.ok(s.problems.some((p) => /nope is not a setting/.test(p)));
  assert.ok(s.problems.some((p) => /archiveAfterDays must be a number of at least 1/.test(p)));
  fs.writeFileSync(path.join(proj, 'labit.json'), '{ "port": 4700, }');
  s = load();
  assert.equal(s.values.port, 4400);
  assert.ok(s.problems.some((p) => /not valid JSON/.test(p)));
});

test('shortcuts merge key by key (the project\'s over yours over the defaults); a key used twice is said', () => {
  const { load } = setup({ shortcuts: { chat: 'x' } }, { shortcuts: { chat: 'q', toggle: 'h', next: 'X', bogus: 'z', done: 'dd', pause: 'o' } });
  const s = load();
  assert.equal(s.values.shortcuts.chat, 'x');
  assert.equal(s.values.shortcuts.toggle, 'h');
  assert.equal(s.values.shortcuts.next, 'x', 'lowercased');
  assert.equal(s.values.shortcuts.comment, undefined, 'the old comment key (1) is gone');
  assert.equal(s.values.shortcuts.pin, undefined, 'and the pin key (C)');
  assert.equal(s.values.shortcuts.done, 'e', 'two letters: refused, the default stays');
  assert.ok(s.problems.some((p) => /bogus is not an action/.test(p)));
  assert.equal(s.values.shortcuts.pause, 'o', 'pause is an action again: the project can move it');
  assert.ok(!s.problems.some((p) => /\.pause /.test(p)), 'and it is not reported');
  assert.ok(s.problems.some((p) => /"x" is used twice/.test(p)));
});

// The shortcuts are listed three times: lib/settings.ts (what a file may set), the widget's KEYS (what the page
// answers to) and the table in docs/settings.md. One missing from the first can't be changed: `slow` was (20 Nov).
test('the shortcuts in settings, in the widget and in docs/settings.md are the same actions and keys', () => {
  const lib = setup().load().values.shortcuts;
  const text = (f) => fs.readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
  const table = /const KEYS = \{([^}]*)\};/.exec(text('../src/comments.js'));
  assert.ok(table, 'src/comments.js has its KEYS table');
  const widget = [...table[1].matchAll(/(\w+):\s*'([^']*)'/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(widget, Object.entries(lib), 'the widget\'s KEYS and SHORTCUTS in lib/settings.ts, in the same order');
  const section = text('../docs/settings.md').split(/^## Shortcuts$/m)[1]?.split(/^## /m)[0] || '';
  const docs = [...section.matchAll(/^\| `(\w+)` \| `(\w)` \|/gm)].map((m) => [m[1], m[2]]);
  assert.deepEqual(Object.fromEntries(docs), lib, 'the table in docs/settings.md');
  assert.equal(docs.length, widget.length, 'each action once in the docs');
});

test('slow is a shortcut a file can move, and its key is checked like the others', () => {
  let s = setup({ shortcuts: { slow: 'Q' } }).load();
  assert.equal(s.values.shortcuts.slow, 'q');
  assert.deepEqual(s.problems, []);
  s = setup({ shortcuts: { chat: 's' } }).load();
  assert.ok(s.problems.some((p) => /"s" is used twice \(slow too\)/.test(p)), 'another action on S is said');
});

test('labit.json is found from a folder inside the project; an old zoom setting is named and ignored', () => {
  const { proj, cfg } = setup({ port: 4600, zoom: { skill: 'docs/zoom.md' }, shortcuts: { zoom: 'z' } });
  const sub = path.join(proj, 'src', 'pages');
  fs.mkdirSync(sub, { recursive: true });
  const s = withConfig(cfg, () => loadSettings(sub));
  assert.equal(s.values.port, 4600);
  assert.equal(s.values.zoom, undefined);
  assert.equal(s.values.shortcuts.pointer, undefined, 'no pointer key');
  assert.ok(s.problems.some((p) => /zoom is not a setting/.test(p)));
  assert.ok(s.problems.some((p) => /\.zoom is not an action/.test(p)));
});

const cli = (cwd, args, env = {}) => command(args, { cwd, env: { ...process.env, PORT: '', ...env } });

test('`labit settings` shows each value and where it came from, and fails on a problem', async () => {
  const { proj, cfg } = setup({ port: 4700, shortcuts: { chat: 'x' } }, { name: 'Leo', model: 'Opus 5.5' });
  let r = await cli(proj, ['settings'], { XDG_CONFIG_HOME: cfg });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^port\s+4700\s+labit\.json$/m);
  assert.match(r.out, /^name\s+Leo\s+your settings$/m);
  assert.match(r.out, /^model\s+Opus 5\.5\s+your settings$/m);
  assert.match(r.out, /^shortcuts\s+chat x\s+labit\.json$/m);
  assert.match(r.out, /^archiveAfterDays\s+30\s+default$/m);
  r = await cli(proj, ['settings', '--port', '4999'], { XDG_CONFIG_HOME: cfg });
  assert.match(r.out, /^port\s+4999\s+flag$/m);
  fs.writeFileSync(path.join(proj, 'labit.json'), JSON.stringify({ wifi: true }));
  r = await cli(proj, ['settings'], { XDG_CONFIG_HOME: cfg });
  assert.equal(r.code, 1);
  assert.match(r.out, /wifi can only be set in your own settings/);
});

test('a lab started with a labit.json: its port, its shortcuts on the page, its batchSeconds', async () => {
  const port = claimPort(7400, 200); // clear of the other test files' ranges
  const { proj, cfg } = setup({ port, shortcuts: { chat: 'x' }, batchSeconds: 0 });
  fs.writeFileSync(path.join(proj, 'index.html'), '<!doctype html><title>t</title><h1 id="t">Hi</h1>');
  const env = { ...process.env, PORT: '', XDG_CONFIG_HOME: cfg };
  const lab = spawn(process.execPath, [LAB, '--no-open', '--new'], { cwd: proj, env });
  kids.push(lab);
  const B = `http://localhost:${port}`;
  let html = '';
  for (let i = 0; i < 80 && !html; i++) {
    html = await fetch(B + '/').then((r) => r.text(), () => '');
    if (!html) await sleep(100);
  }
  assert.ok(html, `the lab answers on ${port}, the port in labit.json`);
  assert.match(html, /data-keys='\{"chat":"x"\}'/, 'only the changed key goes to the page');
  const waiting = cli(proj, ['wait', '--timeout', '10'], { XDG_CONFIG_HOME: cfg });
  await sleep(500);
  const t0 = Date.now();
  await fetch(B + '/_lab/api/comments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: B },
    body: JSON.stringify({ page: '/index', name: 'Leo', text: 'make it red', anchor: { selector: '#t', x: 0.1, y: 0.5, docX: 0.1, docY: 20, width: 1000, element: '<h1 id="t">', block: 't' } }),
  });
  const { out } = await waiting;
  assert.ok(Date.now() - t0 < 1500, 'batchSeconds 0: handed over at once');
  assert.match(out, /make it red/);
  assert.match(out, /block: t/);
  assert.doesNotMatch(out, /^zoom:|zoom skill/m);
});

test('actions: one list of yours, in order; names of 7 characters at most; bad ones said and left out', () => {
  assert.equal(NAME_MAX, 7);
  assert.ok(SEED.every((a) => a.name.length <= NAME_MAX && a.prompt), 'the seed fits');
  assert.deepEqual(SEED.map((a) => a.name), ['go', 'more', 'no']);
  const mine = [{ name: 'variant', prompt: 'Three variants.' }, { name: 'go', prompt: 'Go.' }];
  let s = setup(null, { actions: [...mine, { name: 'too long', prompt: 'x' }, { name: 'Go', prompt: 'again' }, { name: 'x' }, 'fix'] }).load();
  assert.deepEqual(s.values.actions, mine, 'the order given; the rest left out');
  const said = s.problems.join('\n');
  for (const re of [/"too long" is 8 characters: a name is 7 at most/, /"Go" is listed twice/, /needs a "name" and a "prompt"/]) assert.match(said, re);
  // The project's labit.json can hold the list too, and its list wins over yours.
  s = setup({ actions: [mine[1]] }, { actions: mine }).load();
  assert.deepEqual([s.values.actions, s.problems], [[mine[1]], []], "the project's list wins");
  assert.equal(s.from.actions.endsWith('labit.json'), true);
  s = setup(null, {}).load();
  assert.deepEqual(s.values.actions, SEED, 'no list anywhere: the seed');
  assert.equal(setup(null, { actions: { spot: ['go'] } }).load().problems.length, 1, 'the old { words, spot } form: said, until it is seeded');
});

test('actions: seeded once into your settings.json from today\'s, the rest of the file kept', () => {
  const cfg = tmp('seed');
  const file = path.join(cfg, 'labit', 'settings.json');
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify({ name: 'someone', actions: { words: ['go', { label: 'tighter', send: 'Tighter: less space' }] } }));
  assert.equal(withConfig(cfg, seedActions), true);
  const got = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(got.name, 'someone', 'nothing else changes');
  assert.deepEqual(got.actions, [...SEED, { name: 'tighter', prompt: 'Tighter: less space' }], 'the seed, then your own old buttons');
  got.actions = [{ name: 'go', prompt: 'Go.' }];
  fs.writeFileSync(file, JSON.stringify(got));
  assert.equal(withConfig(cfg, seedActions), false, 'a list there already: left alone (no reset)');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).actions, [{ name: 'go', prompt: 'Go.' }]);
  const none = tmp('seed-none');
  assert.equal(withConfig(none, seedActions), true, 'no file yet: made with the list');
});

test('actions in labit.json reach the page, over the list in your settings; the page has no way to edit either', async () => {
  const dir = tmp('proj-actions');
  const cfg = tmp('proj-actions-cfg');
  const port = claimPort(7750, 100);
  const mine = [{ name: 'ship', prompt: 'Ship it.' }, { name: 'go', prompt: "Go. It's fine & <ok>." }];
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>t</title><h1>Hi</h1>');
  fs.writeFileSync(path.join(dir, 'labit.json'), JSON.stringify({ actions: mine }));
  kids.push(spawn(process.execPath, [LAB, '--no-open', '--new', '--port', String(port)], { cwd: dir, env: { ...process.env, PORT: '', XDG_CONFIG_HOME: cfg } }));
  const B = `http://localhost:${port}`;
  let html = '';
  for (let i = 0; i < 80 && !html; i++) {
    html = await fetch(B + '/').then((r) => r.text(), () => '');
    if (!html) await sleep(100);
  }
  const attr = html.match(/data-actions='([^']*)'/)?.[1] || '';
  assert.deepEqual(JSON.parse(attr.replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&amp;/g, '&')), mine, "the project's list, in its order");
  const key = html.match(/data-admin="([^"]+)"/)?.[1] || '';
  const put = await fetch(B + '/_lab/api/actions', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-lab-admin': key }, body: JSON.stringify({ actions: [] }) });
  assert.equal(put.status, 404, 'no editor on the page, so no endpoint');
});
