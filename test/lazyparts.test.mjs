// The section bar and the motion menu are their own files (public/_lab/sections.js, motion.js), loaded only when
// the page uses them: the page script (comments.js) must not carry their code, and each file must carry its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public/_lab');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const PARTS = {
  'sections.js': ['sb-chip', 'sb-nav', 'lab-sections:', '.sbar{'],
  'motion.js': ['motion-speed', 'motion-menu', 'pick on page', '.moment{'],
};

test('the page script carries neither the section bar nor the motion menu', () => {
  const page = read('comments.js');
  for (const [file, marks] of Object.entries(PARTS)) for (const m of marks) assert.ok(!page.includes(m), `comments.js still has ${JSON.stringify(m)} (${file} has it)`);
});

test('each part has its own code and its own styles, and is packed beside the page script', () => {
  for (const [file, marks] of Object.entries(PARTS)) {
    const part = read(file);
    for (const m of marks) assert.ok(part.includes(m), `${file} lacks ${JSON.stringify(m)}`);
    assert.ok(fs.existsSync(path.join(DIR, `${file}.br`)), `${file}.br is built for the npm package`);
  }
  const files = JSON.parse(fs.readFileSync(path.join(DIR, '..', '..', 'package.json'), 'utf8')).files;
  for (const file of Object.keys(PARTS)) assert.ok(files.includes(`public/_lab/${file}.br`), `package.json "files" has ${file}.br`);
});
