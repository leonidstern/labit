// What labit leaves in a project must not leave the computer with it: .lab is out of git by its .gitignore, a .lab in a
// folder that ships (built output, public/) is said at the start, and `preview`'s launch.json stays out of git.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { LAB, rm, tmp } from './harness.mjs';
import { shipsWithSite } from '../lib/shipping.ts';

const dirs = [];
after(() => rm(dirs));
const repo = (name) => {
  const d = fs.realpathSync(tmp(name));
  dirs.push(d);
  execFileSync('git', ['init', '-q'], { cwd: d });
  return d;
};
const status = (d) => execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: d, encoding: 'utf8' });

test('a folder that ships with the site is told apart from one that does not', () => {
  const d = repo('ship-site');
  fs.writeFileSync(path.join(d, 'package.json'), '{}');
  fs.writeFileSync(path.join(d, '.gitignore'), 'generated\n');
  for (const f of ['public', 'dist', 'generated', 'pages']) fs.mkdirSync(path.join(d, f));
  assert.match(shipsWithSite(path.join(d, 'public')), /copied into your app's build/);
  assert.match(shipsWithSite(path.join(d, 'dist')), /built output/);
  assert.match(shipsWithSite(path.join(d, 'generated')), /ignored by git/);
  assert.equal(shipsWithSite(path.join(d, 'pages')), '');
  assert.equal(shipsWithSite(d), '', 'the project folder itself');
});

test('preview keeps a launch.json it made out of git, and only says so for one already in git', async () => {
  const run = (d) => new Promise((resolve) => execFile(process.execPath, [LAB, 'preview', '.'], { cwd: d }, (e, out) => resolve(out)));
  const d = repo('ship-preview');
  const out = await run(d);
  assert.match(out, /Kept out of git/);
  assert.equal(status(d), '', 'git status shows nothing');
  const t = repo('ship-preview-tracked');
  fs.mkdirSync(path.join(t, '.claude'));
  fs.writeFileSync(path.join(t, '.claude/launch.json'), '{"version":"0.0.1","configurations":[]}\n');
  execFileSync('git', ['add', '.'], { cwd: t });
  assert.match(await run(t), /is in git/);
  assert.equal(fs.readFileSync(path.join(t, '.git/info/exclude'), 'utf8').includes('launch.json'), false, 'a tracked file is not excluded');
});
