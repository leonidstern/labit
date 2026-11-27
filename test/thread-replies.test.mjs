// Threads (src/widget/thread.ts, lib/commands.ts): an answer to a later message in the thread says which one, so the
// widget quotes it, as the chat does.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { site, tmp, rm, spawnLab, sleep, up, serverJson, cli as command } from './harness.mjs';
import { choiceSpills, parseArgs, replyChoices } from '../lib/args.ts';

const HOME = tmp('thread'); // nobody's real ~/.config
const { DIR, PORT, B } = site('thread-lab', 9150, 40);
const env = { ...process.env, XDG_CONFIG_HOME: HOME, PORT: '' };
fs.writeFileSync(path.join(DIR, 'package.json'), '{}');
fs.writeFileSync(path.join(DIR, 'bar.html'), '<!doctype html><title>Bar</title><p id="x">Hi</p>');
const lab = spawnLab(DIR, PORT, { flags: ['--new'], env });
after(() => {
  lab.kill();
  rm([HOME, DIR]);
});
const cli = (...args) => command(args, { cwd: DIR, env });
const post = async (body) => (await (await fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/bar', ...body }) })).json()).comment;
const thread = async () => (await (await fetch(`${B}/_lab/api/comments?page=/bar`)).json()).comments;

test('answering a reply by its id says which message it answers; answering the pin does not', async () => {
  await up(B + '/', { fail: false });
  const pin = await post({ name: 'leo', text: 'the menu', anchor: { kind: 'element', selector: '#x', x: 0.5, y: 0.5 } });
  assert.equal((await cli('reply', pin.id, 'Changed the menu.')).code, 0);
  const where = await post({ name: 'leo', text: 'where is it', parent: pin.id });
  assert.equal((await cli('reply', where.id, 'Under the menu.')).code, 0);
  const all = await thread();
  assert.equal(all.find((c) => c.text === 'Under the menu.').to, where.id);
  assert.equal(all.find((c) => c.text === 'Changed the menu.').to, undefined);
});

// A question with choices (labit reply --choice … --recommend …): stored on the reply, the person's pick comes back as
// a reply that says which choice (picked), and the agent text shows both.
test('a reply with choices is a question; the pick is stored and shown to the agent', async () => {
  const pin = await post({ name: 'leo', text: 'sharper?', anchor: { kind: 'text', selector: '#x', x: 0.5, y: 0.5, quote: { exact: 'Hi', prefix: '', suffix: '' } } });
  const first = await cli('wait', '--timeout', '5');
  assert.match(first.out, /sharper\?/);
  // Refused, with nothing saved: one choice, a recommend out of range, a choice with --done or --resolve.
  for (const bad of [['--choice', 'Hey'], ['--choice', 'Hey', '--choice', 'Hello', '--recommend', 'D'], ['--choice', 'Hey', '--choice', 'Hello', '--done'], ['--choice', 'Hey', '--choice', 'Hello', '--resolve'], ['--recommend', 'A']]) {
    const r = await cli('reply', pin.id, 'Which one?', ...bad);
    assert.notEqual(r.code, 0, bad.join(' '));
  }
  assert.equal((await thread()).filter((c) => c.parent === pin.id).length, 0);
  // A choice may start with a dash.
  const asked = await cli('reply', pin.id, 'Which one?', '--choice', 'Hey', '--choice', '-Hello there', '--choice', 'Howdy', '--recommend', 'b');
  assert.equal(asked.code, 0, asked.out);
  assert.match(asked.out, /A\) Hey {2}B\) -Hello there {2}C\) Howdy {2}\(your pick: B\)/);
  const ask = (await thread()).find((c) => c.text === 'Which one?');
  assert.deepEqual(ask.choices, ['Hey', '-Hello there', 'Howdy']);
  assert.equal(ask.recommend, 1);
  assert.equal(ask.intent, 'question');
  assert.equal(ask.v, 2); // nothing to upgrade: the fields are only added
  // A person can't put choices on their own reply; a pick out of range is just words.
  const odd = await post({ name: 'leo', text: 'Picked Z', parent: ask.id, to: ask.id, picked: 7, choices: ['x', 'y'] });
  assert.equal(odd.picked, undefined);
  assert.equal(odd.choices, undefined);
  const pick = await post({ name: 'leo', text: 'Picked B: -Hello there', parent: ask.id, to: ask.id, picked: 1 });
  assert.deepEqual(pick.picked, { of: ask.id, n: 1 });
  assert.equal(pick.parent, pin.id); // in the thread, quoting the question
  assert.equal(pick.to, ask.id);
  const text = await (await fetch(`${B}/_lab/agent/bar`)).text();
  assert.match(text, /^ {2}B\) -Hello there \(your pick\)$/m);
  assert.match(text, /^ {2}picked: B\) -Hello there \(leo\)$/m);
  const next = await cli('wait', '--timeout', '5');
  assert.match(next.out, /Picked B: -Hello there/);
});

// The page tries each choice in place of the quoted words: a choice that reaches past them gets a note from reply.
test('a choice that reaches past the quoted words is noted', () => {
  const quote = { exact: 'the review on the page', prefix: 'labit puts ', suffix: ', not in chat.' };
  const notes = choiceSpills(quote, ['pins the review to the page', 'the notes on the page', 'puts the review', 'the review on the page, not', 'all of it']);
  assert.deepEqual(notes.map((n) => n.slice(0, 8)), ['Choice A', 'Choice C', 'Choice D']);
  assert.match(notes[0], /reads "…labit puts pins the review to the page, not in chat\.…"/);
  assert.deepEqual(choiceSpills(undefined, ['a', 'b']), []);
});

// What the page couldn't show as rows is refused (exit 1 from reply, 400 from the server), and nothing is saved.
test('seven, empty and 301-character choices are refused', async () => {
  const pin = await post({ name: 'leo', text: 'which word?', anchor: { kind: 'text', selector: '#x', x: 0.5, y: 0.5, quote: { exact: 'Hi', prefix: '', suffix: '' } } });
  const before = (await thread()).length;
  const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const long = 'x'.repeat(301);
  for (const bad of [seven, ['a', ''], ['a', '  '], ['a', long]]) {
    const r = await cli('reply', pin.id, 'Which?', ...bad.flatMap((c) => ['--choice', c]));
    assert.notEqual(r.code, 0, bad.join('|').slice(0, 30));
  }
  // The server says no on its own too: someone who talks to it directly (the agent's header) gets a 400, not a cut list.
  const agent = (body) => fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-agent': '1', 'x-lab-admin': serverJson(DIR).agent }, body: JSON.stringify({ page: '/bar', name: 'Claude', text: 'Which?', parent: pin.id, ...body }) });
  for (const body of [{ choices: seven }, { choices: ['a'] }, { choices: ['a', ''] }, { choices: ['a', long] }, { choices: ['a', 'b'], recommend: 2 }, { choices: ['a', 'b'], recommend: 'B' }, { choices: ['a', 'b'], recommend: -1 }, { recommend: 0 }]) {
    assert.equal((await agent(body)).status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.equal((await thread()).length, before, 'nothing saved');
  assert.equal((await agent({ choices: ['a', 'b', 'c', 'd', 'e', 'f'], recommend: 5 })).status, 201); // six, the last one its pick: fine
});

// Picking twice (another device, a changed mind): the agent reads the latest pick, and wait says which question each answers.
test('a second pick: the agent reads the latest', async () => {
  const pin = await post({ name: 'leo', text: 'which tone?', anchor: { kind: 'text', selector: '#x', x: 0.5, y: 0.5, quote: { exact: 'Hi', prefix: '', suffix: '' } } });
  const sent = await cli('reply', pin.id, 'Which tone?', '--choice', 'Hi', '--choice', 'Hello');
  assert.equal(sent.code, 0, sent.out);
  const ask = (await thread()).find((c) => c.text === 'Which tone?');
  await cli('wait', '--timeout', '5'); // the question and what came before are read; only the picks are new
  const one = await post({ name: 'leo', text: 'Picked A: Hi', parent: ask.id, to: ask.id, picked: 0 });
  await sleep(15); // the latest is by time
  const two = await post({ name: 'leo', text: 'Picked B: Hello', parent: ask.id, to: ask.id, picked: 1 });
  assert.equal(one.picked.n, 0);
  assert.equal(two.picked.n, 1);
  const text = await (await fetch(`${B}/_lab/agent/bar`)).text();
  assert.match(text, /^ {2}picked: B\) Hello \(leo\)$/m);
  assert.doesNotMatch(text, /picked: A\)/);
  // A pick of "keep the words as they are".
  const none = await post({ name: 'leo', text: 'Keep as is: none of these.', parent: ask.id, to: ask.id, picked: -1 });
  assert.equal(none.picked.n, -1);
  assert.match(await (await fetch(`${B}/_lab/agent/bar`)).text(), /^ {2}picked: none, keep the words as they are \(leo\)$/m);
  const w = await cli('wait', '--timeout', '5');
  assert.match(w.out, new RegExp(`Picked B: Hello.*\\(their pick on your question id ${ask.id}\\)`));
});

// Each choice may carry a short description (--hint, right after its --choice): stored as hints, parallel to choices.
test('--hint follows its choice and is stored as hints', async () => {
  const parse = (...a) => replyChoices(parseArgs(a).opts);
  assert.deepEqual(parse('--choice', 'Tabs', '--hint', 'less scrolling', '--choice', 'List', '--choice', 'Grid', '--hint', '-wide'), { choices: ['Tabs', 'List', 'Grid'], hints: ['less scrolling', '', '-wide'] });
  assert.deepEqual(parse('--choice', 'A', '--choice', 'B', '--recommend', 'B'), { choices: ['A', 'B'], recommend: 1 }); // no hints: no field
  assert.deepEqual(parse('--choice', 'A', '--hint', 'x', '--choice', 'B', '--recommend', '1').hints, ['x', '']);
  // Refused: a hint before any choice, none with no choices, two for one choice, an empty one, 121 characters.
  for (const bad of [['--hint', 'x', '--choice', 'A', '--choice', 'B'], ['--hint', 'x'], ['--choice', 'A', '--hint', 'x', '--hint', 'y', '--choice', 'B'], ['--choice', 'A', '--hint', ' ', '--choice', 'B'], ['--choice', 'A', '--hint', 'x'.repeat(121), '--choice', 'B']]) assert.ok(parse(...bad) instanceof Error, bad.join(' ').slice(0, 40));
  assert.ok(!(parse('--choice', 'A', '--hint', 'x'.repeat(120), '--choice', 'B') instanceof Error));
  const pin = await post({ name: 'leo', text: 'which layout?', anchor: { kind: 'text', selector: '#x', x: 0.5, y: 0.5, quote: { exact: 'Hi', prefix: '', suffix: '' } } });
  const sent = await cli('reply', pin.id, 'Which layout?', '--choice', 'Tabs', '--hint', 'less  scrolling', '--choice', 'List', '--recommend', 'A');
  assert.equal(sent.code, 0, sent.out);
  assert.match(sent.out, /A\) Tabs \(less scrolling\)/);
  const ask = (await thread()).find((c) => c.text === 'Which layout?');
  assert.deepEqual([ask.choices, ask.hints, ask.recommend], [['Tabs', 'List'], ['less scrolling', ''], 0]);
  assert.match(await (await fetch(`${B}/_lab/agent/bar`)).text(), /^ {2}A\) Tabs — less scrolling \(your pick\)$/m);
  // A question with no hint stores none; the server refuses hints that don't fit the choices.
  const plain = await cli('reply', pin.id, 'Plain?', '--choice', 'a', '--choice', 'b');
  assert.equal(plain.code, 0, plain.out);
  assert.equal((await thread()).find((c) => c.text === 'Plain?').hints, undefined);
  const agent = (body) => fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-agent': '1', 'x-lab-admin': JSON.parse(fs.readFileSync(path.join(DIR, '.lab/server.json'), 'utf8')).agent }, body: JSON.stringify({ page: '/bar', name: 'Claude', text: 'Which?', parent: pin.id, choices: ['a', 'b'], ...body }) });
  for (const hints of [['x'], ['x', 'y', 'z'], ['x', 1], 'x', ['x', 'y'.repeat(121)]]) assert.equal((await agent({ hints })).status, 400, JSON.stringify(hints).slice(0, 30));
  assert.equal((await agent({ hints: ['x', ''] })).status, 201);
  // A person's reply can't carry hints, whatever it sends.
  assert.equal((await post({ name: 'leo', text: 'hm', parent: pin.id, hints: ['x'] })).hints, undefined);
});

// A note on a spot or an element has no quoted words: the choices show as rows, and the agent is told so.
test('a note without quoted words gets the note', async () => {
  const pin = await post({ name: 'leo', text: 'which colour?', anchor: { kind: 'element', selector: '#x', x: 0.5, y: 0.5 } });
  const r = await cli('reply', pin.id, 'Which?', '--choice', 'red', '--choice', 'blue');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Note: this note has no quoted words, so the choices show as rows and nothing is tried in the page\./);
  assert.match(r.out, /Asked with A\) red {2}B\) blue/);
  // With quoted words there is no such note.
  const quoted = await post({ name: 'leo', text: 'tone?', anchor: { kind: 'text', selector: '#x', x: 0.5, y: 0.5, quote: { exact: 'Hi', prefix: '', suffix: '' } } });
  const q = await cli('reply', quoted.id, 'Which?', '--choice', 'Hi', '--choice', 'Hey');
  assert.equal(q.code, 0, q.out);
  assert.doesNotMatch(q.out, /no quoted words/);
});
