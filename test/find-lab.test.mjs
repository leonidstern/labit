// Which lab a folder's commands talk to (lib/labcall.ts). A lab that crashed leaves .lab/server.json behind, and its
// port may be another folder's lab by now: a file whose process is gone is not a lab.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmp, rm } from './harness.mjs';
import { findLab } from '../lib/labcall.ts';

const DIR = fs.realpathSync(tmp('findlab'));
after(() => rm([DIR]));
const lab = (dir, server) => {
  fs.mkdirSync(path.join(dir, '.lab'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.lab/server.json'), JSON.stringify(server));
};
const gone = spawnSync(process.execPath, ['-e', '']).pid; // a process that has ended

test('a lab is found from a folder inside it', () => {
  lab(DIR, { port: 4400, pid: process.pid, token: 't' });
  fs.mkdirSync(path.join(DIR, 'a/b'), { recursive: true });
  assert.equal(findLab(path.join(DIR, 'a/b'))?.dir, DIR);
});

test('a file left by a lab that is gone is passed over, for the running lab above it or for none', () => {
  lab(path.join(DIR, 'a'), { port: 4401, pid: gone, token: 't' });
  assert.equal(findLab(path.join(DIR, 'a/b'))?.server.port, 4400, 'the running lab above');
  lab(DIR, { port: 4400, pid: gone, token: 't' });
  assert.equal(findLab(path.join(DIR, 'a/b')), null);
});

test('a file from before labs wrote their pid still counts', () => {
  lab(DIR, { port: 4400, token: 't' });
  assert.equal(findLab(DIR)?.server.port, 4400);
});
