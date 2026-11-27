// Your own files (~/.config/labit): the rules file is yours to edit, and a settings file that can't be read is not
// written over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { addRule, dropRule, rulesText } from '../lib/replies.ts';
import { savePersonal } from '../lib/settings.ts';

const DIR = path.join(process.env.XDG_CONFIG_HOME, 'labit'); // a throwaway folder (test/setup.mjs)
const RULES = path.join(DIR, 'replies.md');
const SETTINGS = path.join(DIR, 'settings.json');

test('replies.md: what you wrote beside the rules stays where it is; a rule kept twice counts twice in place', () => {
  addRule('Keep it short.');
  addRule('No emoji');
  const mine = fs.readFileSync(RULES, 'utf8').replace('- No emoji\n', '## Tone\n\na note of my own\n* a starred line\n- No emoji\n');
  fs.writeFileSync(RULES, mine);
  addRule('Answer in English');
  addRule('keep it short'); // the same rule again, said a little differently
  const now = fs.readFileSync(RULES, 'utf8');
  assert.equal(now, mine.replace('- Keep it short.\n', '- Keep it short. (×2)\n') + '- Answer in English\n');
  dropRule('No emoji');
  assert.equal(fs.readFileSync(RULES, 'utf8'), now.replace('- No emoji\n', ''), 'only its line goes');
  assert.ok(!fs.existsSync(RULES + '.tmp'));
});

test('replies.md: undo finds a rule that was offered with a line break or a double space', () => {
  const offered = 'Lead with  the answer.\nNo preamble';
  addRule(offered);
  assert.match(rulesText(), /- Lead with the answer\. No preamble/);
  dropRule(offered);
  assert.doesNotMatch(rulesText(), /No preamble/);
});

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
