// The skill and the code say the same numbers and flags: the skill is read once and trusted, so a timing or a flag that
// drifted from the code is a wrong rule nobody notices (the hand-off said 10 minutes to agents whose lines lapse at 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLAIM_LIFE_MS, PROGRESS_MS } from '../lib/schema.mjs';

const SKILL = readFileSync(new URL('../skills/labit/SKILL.md', import.meta.url), 'utf8');
const LOCAL = readFileSync(new URL('../local.mjs', import.meta.url), 'utf8');
const ARGS = readFileSync(new URL('../lib/args.ts', import.meta.url), 'utf8');
const minutes = (ms) => ms / 60000;

test('the status-line timings in the skill are the code\'s', () => {
  assert.match(SKILL, new RegExp(`Without the plugin a line lapses after ${minutes(PROGRESS_MS)} minutes`));
  assert.match(SKILL, new RegExp(`for ${minutes(CLAIM_LIFE_MS)} minutes after your last line`));
});

test('the not-answered time in the skill is the code\'s', () => {
  const ms = Number(/const ANSWER_MS = Number\(process\.env\.LAB_ANSWER_MS \?\? (\d+)\)/.exec(LOCAL)?.[1]);
  assert.ok(ms, 'ANSWER_MS found in local.mjs');
  assert.match(SKILL, new RegExp(`for ${minutes(ms)} minutes counts as not answered`));
});

test('every --flag the skill names is one the CLI knows', () => {
  const known = new Set([...ARGS.matchAll(/'(--[a-z][a-z-]*)'/g)].map((m) => m[1]));
  const boolFlags = [...readFileSync(new URL('../lib/commands.ts', import.meta.url), 'utf8').matchAll(/opts\[?['.]?([a-z][a-zA-Z-]*)/g)].map((m) => `--${m[1].replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
  for (const f of boolFlags) known.add(f);
  const named = [...new Set([...SKILL.matchAll(/`[^`]*`/g)].flatMap((m) => [...m[0].matchAll(/(?<![\w-])(--[a-z][a-z-]*[a-z])(?![\w-])/g)].map((x) => x[1])))];
  const unknown = named.filter((f) => !known.has(f) && !LOCAL.includes(`'${f}'`) && !LOCAL.includes(`"${f}"`));
  assert.deepEqual(unknown, [], `flags in the skill the code doesn't parse: ${unknown.join(' ')}`);
});
