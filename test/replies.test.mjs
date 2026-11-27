// Rules from how you reply (lib/replies.ts, src/widget/thread.ts): when a reply is about how the agent answered, the
// agent offers a rule (--suggest-rule); "rule?" on your message keeps it in your replies.md, which goes out with every
// pin; ignoring it is a no, and undo on the answer takes it back out.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { site, tmp, rm, spawnLab, sleep, up, cli as command } from './harness.mjs';

const HOME = tmp('replies'); // nobody's real ~/.config
const { DIR, PORT, B } = site('replies-lab', 9100, 40);
const RULES = path.join(HOME, 'labit', 'replies.md');
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

test('the agent can offer a rule on its own; keep saves it, no does not; a person cannot offer one', async () => {
  await ready();
  const pin = (await post({ name: 'leo', text: 'and the menu', anchor: { kind: 'element', selector: '#x', x: 0.1, y: 0.1 } })).json.comment;
  await cli('reply', pin.id, 'Changed the menu.');
  await cli('wait', '--bg', '--timeout', '2');
  await post({ name: 'leo', text: 'where is it', parent: pin.id, suggest: 'sneaky' });
  const handed = (await cli('wait', '--bg', '--timeout', '3')).out;
  assert.match(handed, /add --suggest-rule "<one short rule>"/, 'a reply in a thread asks the agent to offer a rule when it fits');
  assert.equal((await thread()).find((c) => c.text === 'where is it').suggest, undefined, 'a person never offers a rule');
  const where = (await thread()).find((c) => c.text === 'where is it');
  await cli('reply', where.id, 'Under the menu.', '--suggest-rule', 'Say where to see what you built, with a link.');
  assert.equal((await thread()).find((c) => c.text === 'Under the menu.').to, where.id, 'answering a reply says which one (a quote in the thread)');
  await cli('reply', pin.id, 'And here.', '--suggest-rule', 'Never mind this one.');
  const [keep, no] = (await thread()).filter((c) => c.suggest);
  assert.equal((await post({ id: keep.id, action: 'keep' }, '/_lab/rule')).status, 204);
  assert.equal((await post({ id: no.id, action: 'no' }, '/_lab/rule')).status, 204);
  const rules = fs.readFileSync(RULES, 'utf8');
  assert.match(rules, /^- Say where to see what you built, with a link\.$/m);
  assert.doesNotMatch(rules, /Never mind/);
  const after = await thread();
  assert.deepEqual(after.find((c) => c.id === keep.id).suggest, { text: 'Say where to see what you built, with a link.', state: 'kept' }, 'kept: it shows as a rule, with undo');
  assert.equal(after.find((c) => c.id === no.id).suggest.state, 'no');

  // Every handover ends with the rules; undo takes one back out.
  await post({ name: 'leo', text: 'and the colour?', anchor: { kind: 'element', selector: '#x', x: 0.2, y: 0.2 } });
  assert.match((await cli('wait', '--bg', '--timeout', '3')).out, /How the person wants answers[^\n]*\n- Say where to see what you built, with a link\.$/m);
  await post({ name: 'leo', text: 'and the size?', anchor: { kind: 'element', selector: '#x', x: 0.3, y: 0.3 } });
  assert.doesNotMatch((await cli('wait', '--bg', '--timeout', '3')).out, /How the person wants answers/, 'the same rules go to a session once');
  assert.equal((await post({ id: keep.id }, '/_lab/rule')).status, 204);
  assert.doesNotMatch(fs.readFileSync(RULES, 'utf8'), /Say where/);
  assert.equal((await post({ id: pin.id }, '/_lab/rule')).status, 404, 'a comment with no rule has nothing to undo');
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
