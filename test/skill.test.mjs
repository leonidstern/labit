// `labit skill` prints the agent's instructions from the package, without the plugin's frontmatter: what a lab's
// first lines point an agent to when it has no plugin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LAB } from './harness.mjs';

test('labit skill prints SKILL.md without its frontmatter', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [LAB, 'skill']);
  assert.match(stdout, /^# labit\n/);
  assert.doesNotMatch(stdout, /^---/);
  assert.match(stdout, /wait --bg/);
});

test('the skill says how to use boards', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [LAB, 'skill']);
  assert.match(stdout, /board new/);
  assert.match(stdout, /Picked b/);
});

test('the skill offers to report labit bugs once, to the labit repo, never faking it', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [LAB, 'skill']);
  assert.match(stdout, /Looks like a labit bug\. Want me to open an issue\?/);
  assert.match(stdout, /`leonidstern\/labit` \(never the project you work in\)/);
  assert.match(stdout, /offer once/);
  assert.match(stdout, /never claim it was filed/);
});

test('the npm package carries the skill packed (SKILL.md.br): labit skill unpacks it and prints the same', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const zlib = await import('node:zlib');
  const { tmp } = await import('./harness.mjs');
  const REPO = path.dirname(LAB);
  const pkg = tmp('skill-packed');
  fs.cpSync(path.join(REPO, 'local.mjs'), path.join(pkg, 'local.mjs'));
  fs.cpSync(path.join(REPO, 'lib'), path.join(pkg, 'lib'), { recursive: true });
  fs.cpSync(path.join(REPO, 'package.json'), path.join(pkg, 'package.json'));
  fs.mkdirSync(path.join(pkg, 'skills/labit'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'skills/labit/SKILL.md.br'), zlib.brotliCompressSync(fs.readFileSync(path.join(REPO, 'skills/labit/SKILL.md'))));
  const run = (lab) => promisify(execFile)(process.execPath, [lab, 'skill']).then((r) => r.stdout);
  assert.equal(await run(path.join(pkg, 'local.mjs')), await run(LAB));
});
