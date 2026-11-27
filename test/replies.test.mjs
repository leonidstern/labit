// Replies in a thread from the CLI: answering a reply, and asking with choices.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { site, tmp, rm, spawnLab, sleep, up, cli as command } from './harness.mjs';

const HOME = tmp('replies'); // nobody's real ~/.config
const { DIR, PORT, B } = site('replies-lab', 9100, 40);
const env = { ...process.env, XDG_CONFIG_HOME: HOME, PORT: '' };
fs.writeFileSync(path.join(DIR, 'package.json'), '{}');
fs.writeFileSync(path.join(DIR, 'bar.html'), '<!doctype html><title>Bar</title><p id="x">Hi</p>');
const lab = spawnLab(DIR, PORT, { flags: ['--new'], env });
after(() => {
  lab.kill();
  rm([HOME, DIR]);
});
const cli = (...args) => command(args, { cwd: DIR, env });
const post = async (body, url = '/_lab/api/comments') => {
  const r = await fetch(B + url, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/bar', ...body }) });
  return { status: r.status, json: r.status === 204 ? null : await r.json().catch(() => null) };
};
const thread = async () => (await (await fetch(`${B}/_lab/api/comments?page=/bar`)).json()).comments;
const ready = () => up(B + '/', { fail: false });

test('answering a reply says which one; --suggest-rule (the rules feature, removed 27 Nov) is an unknown option', async () => {
  await ready();
  const pin = (await post({ name: 'leo', text: 'and the menu', anchor: { kind: 'element', selector: '#x', x: 0.1, y: 0.1 } })).json.comment;
  await cli('reply', pin.id, 'Changed the menu.');
  await cli('wait', '--bg', '--timeout', '2');
  await post({ name: 'leo', text: 'where is it', parent: pin.id, suggest: 'sneaky' });
  const handed = (await cli('wait', '--bg', '--timeout', '3')).out;
  assert.doesNotMatch(handed, /suggest-rule|How the person wants answers/);
  const where = (await thread()).find((c) => c.text === 'where is it');
  assert.equal(where.suggest, undefined, 'a suggest field sent along is not kept');
  await cli('reply', where.id, 'Under the menu.');
  assert.equal((await thread()).find((c) => c.text === 'Under the menu.').to, where.id, 'answering a reply says which one (a quote in the thread)');
  const old = await cli('reply', pin.id, 'And here.', '--suggest-rule', 'Never mind this one.');
  assert.notEqual(old.code, 0);
  assert.match(old.out, /Unknown option --suggest-rule/);
  assert.equal((await thread()).some((c) => /And here|Never mind/.test(c.text)), false, 'nothing is posted');
  assert.equal((await post({ id: pin.id, action: 'keep' }, '/_lab/rule')).status, 404, 'the route is gone');
});

// Ask with choices and listen in one command: the pick, when the person makes it, is what the wait returns, with the
// question it answers.
test('reply --choice --wait returns the pick', async () => {
  const pin = (await post({ name: 'leo', text: 'which tone?', anchor: { kind: 'text', selector: '#x', x: 0.5, y: 0.5, quote: { exact: 'Hi', prefix: '', suffix: '' } } })).json.comment;
  await cli('wait', '--bg', '--timeout', '2'); // the pin itself is read
  const asking = cli('reply', pin.id, 'Which tone?', '--choice', 'Hi', '--choice', 'Hello', '--recommend', 'B', '--wait', '--timeout', '20');
  let ask;
  for (let i = 0; i < 50 && !ask; i++) {
    ask = (await thread()).find((c) => c.choices && c.parent === pin.id);
    if (!ask) await sleep(100);
  }
  assert.ok(ask, 'the question is saved');
  assert.deepEqual([ask.choices, ask.recommend, ask.intent], [['Hi', 'Hello'], 1, 'question']);
  await post({ name: 'leo', text: 'Picked B: Hello', parent: ask.id, to: ask.id, picked: 1 });
  const { code, out } = await asking;
  assert.equal(code, 0, out);
  assert.match(out, /Asked with A\) Hi {2}B\) Hello {2}\(your pick: B\)/);
  assert.match(out, /Picked B: Hello \(their pick on your question id /);
  assert.ok(out.includes(`(their pick on your question id ${ask.id})`));
  assert.match(out, /^A pick .*: make that change, then .* resolve <id> with no words; words only if/m, 'one rule for a pick: change it, resolve with no words');
  assert.match(out, /resolve <id> with no words \(words only if/, 'the same rule where the question was asked');
});
