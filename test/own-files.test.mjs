// Your own files (~/.config/labit): a settings file that can't be read is not written over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { savePersonal } from '../lib/settings.ts';

const DIR = path.join(process.env.XDG_CONFIG_HOME, 'labit'); // a throwaway folder (test/setup.mjs)
const SETTINGS = path.join(DIR, 'settings.json');
fs.mkdirSync(DIR, { recursive: true });

test('settings.json: one key is set and the rest kept; a file that is not settings is left alone', () => {
  fs.writeFileSync(SETTINGS, JSON.stringify({ port: 4455, name: 'Leo' }));
  savePersonal('name', 'Mira');
  assert.deepEqual(JSON.parse(fs.readFileSync(SETTINGS, 'utf8')), { port: 4455, name: 'Mira' });
  for (const broken of ['{ "port": 4455, "name": "Leo"', '[1, 2]']) {
    fs.writeFileSync(SETTINGS, broken);
    assert.throws(() => savePersonal('name', 'Mira'), /fix it/);
    assert.equal(fs.readFileSync(SETTINGS, 'utf8'), broken, 'not written over');
  }
  fs.rmSync(SETTINGS);
  savePersonal('name', 'Mira');
  assert.deepEqual(JSON.parse(fs.readFileSync(SETTINGS, 'utf8')), { name: 'Mira' }, 'no file yet: one is made');
});
