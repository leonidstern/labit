// bench/cost.mjs: a run's spend is read from Claude Code's stream-json as the host reports it, each model call counted
// once, and a missing number stays unknown (null), never zero.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spendOf, summary } from '../bench/cost.mjs';

const usage = (input, write, read, output) => ({ input_tokens: input, cache_creation_input_tokens: write, cache_read_input_tokens: read, output_tokens: output });

test('cost: one call that comes as two events counts once; tool results and pictures are counted', () => {
  const lines = [
    { type: 'assistant', message: { id: 'a', usage: usage(3, 100, 0, 5), content: [{ type: 'text', text: 'hm' }] } },
    { type: 'assistant', message: { id: 'a', usage: usage(3, 100, 0, 5), content: [{ type: 'tool_use', name: 'Read' }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'abcd' }] } },
    { type: 'assistant', message: { id: 'b', usage: usage(1, 20, 100, 7), content: [{ type: 'tool_use', name: 'Read' }, { type: 'tool_use', name: 'Bash' }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'image', source: {} }, { type: 'text', text: 'é' }] }] } },
    { type: 'result', subtype: 'success', num_turns: 3, total_cost_usd: 0.01, usage: { output_tokens: 40 }, modelUsage: { 'm-1': {} } },
  ];
  const s = spendOf(lines);
  assert.deepEqual(
    { calls: s.calls, uncached: s.uncached, cacheWrite: s.cacheWrite, cacheRead: s.cacheRead, output: s.output, turns: s.turns, costUsd: s.costUsd },
    { calls: 2, uncached: 4, cacheWrite: 120, cacheRead: 100, output: 40, turns: 3, costUsd: 0.01 },
  );
  assert.deepEqual(s.tools, { Read: 2, Bash: 1 });
  assert.equal(s.toolBytes, 6, 'bytes, not characters');
  assert.equal(s.pictures, 1);
  assert.deepEqual(s.models, ['m-1']);
  assert.equal(s.finished, true);
});

test('cost: a run the host reported nothing for is unknown, not free', () => {
  const s = spendOf([]);
  assert.equal(s.costUsd, null);
  assert.equal(s.cacheRead, null);
  assert.equal(s.turns, null);
  assert.equal(s.finished, false);
});

test('cost: per arm, cost per all-right run counts the wrong runs too', () => {
  const run = (arm, costUsd, pass) => ({ arm, costUsd, score: { pass, of: 2 }, calls: 1, turns: 1, uncached: 0, cacheWrite: 0, cacheRead: 0, output: 0, toolCalls: 0, toolBytes: 0, pictures: 0, seconds: 1 });
  const arms = summary([run('a', 1, 2), run('a', 3, 1), run('b', null, 2)]);
  assert.equal(arms.a.allRight, 1);
  assert.equal(arms.a.costPerAllRightRun, 4);
  assert.equal(arms.a.costUsd.median, 2);
  assert.equal(arms.b.costUsd.median, null, 'no cost reported stays unknown');
  assert.equal(arms.b.costUsd.mean95, null);
  assert.equal(arms.b.costPerAllRightRun, null, 'and so does its cost per right run');
});
