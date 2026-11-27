// What labit leaves in a project must not leave the computer with it: .lab is out of git by its .gitignore, a .lab in a
// folder that ships (built output, public/) is said at the start.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { rm, tmp } from './harness.mjs';
import { shipsWithSite } from '../lib/shipping.ts';

const dirs = [];
after(() => rm(dirs));
const repo = (name) => {
  const d = fs.realpathSync(tmp(name));
  dirs.push(d);
  execFileSync('git', ['init', '-q'], { cwd: d });
  return d;
};

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
