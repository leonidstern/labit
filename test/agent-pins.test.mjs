// The agent's own pins (`labit pin`): a browser checks the selector (the lab keeps what it says on the pin: the browser
// test proves that part) and the agent is told when it matches nothing; --quote pins on words; --question / --choice make the pin itself ask; "Do it" and ticks reach the agent's
// next wait; --file pins many at once; --board pins on a board and its frames.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { site, tmp, rm, spawnLab, up, serverJson, cli as command } from './harness.mjs';

const HOME = tmp('agent-pins');
const { DIR, PORT, B } = site('agent-pins-lab', 9800, 40);
const env = { ...process.env, XDG_CONFIG_HOME: HOME, LABIT_HOME: HOME, PORT: '', LABIT_NO_UPDATE_CHECK: '1', LAB_SETTLE_MS: '100' };
delete env.CLAUDE_CODE_SESSION_ID;
delete env.CLAUDE_CODE_REMOTE_SESSION_ID;
delete env.LAB_SESSION_NAME;
fs.writeFileSync(path.join(DIR, 'package.json'), '{}');
fs.writeFileSync(
  path.join(DIR, 'index.html'),
  `<!doctype html><title>Home</title>
<h1 id="t">Pricing &amp; plans</h1>
<section id="plans"><h2>Plans</h2>
<p id="p">The quick brown fox jumps over the lazy dog, the quick brown fox.</p>
<ul class="list"><li>one<li>two<li class="last">three</ul></section>
<script>document.body.append('<div id="drawn">x</div>')</script>`,
);
fs.writeFileSync(path.join(DIR, 'pricing.html'), '<!doctype html><title>Pricing</title><h1>Pricing</h1><p>Buy it.</p>');
const lab = spawnLab(DIR, PORT, { flags: ['--new'], env });
const servers = [];
after(() => {
  lab.kill();
  for (const s of servers) s.close();
  rm([HOME, DIR]);
});
const cli = (sid, ...args) => command(args, { cwd: DIR, env: { ...env, CLAUDE_CODE_SESSION_ID: sid }, timeout: 30000 });
const S = 'aaaaaaaa-1';
const pin = (...args) => cli(S, 'pin', ...args);
// A person's call, as the browser makes it (this computer: the owner).
const api = async (body) => {
  const r = await fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-admin': serverJson(DIR).token }, body: JSON.stringify({ name: 'Leo', ...body }) });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
const all = async (page = '/index') => (await (await fetch(`${B}/_lab/api/comments?page=${page}`)).json()).comments;
const idOf = (out) => /Pinned (\w+) on/.exec(out)?.[1];

test('setup', async () => {
  await up(B + '/', { fail: false });
});

test('2: with no browser open the pin is saved unchecked, and says so once; no-check says nothing', async () => {
  const r = await pin('#nope', 'x', '--page', '/index');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^Note: No browser has the lab open: selector not checked\.$/m);
  const c = (await all()).find((x) => x.id === idOf(r.out));
  assert.deepEqual([c.anchor.kind, c.anchor.selector, c.anchor.x, c.anchor.y, c.anchor.element], ['element', '#nope', 0.5, 0.5, undefined]);
  const quiet = await pin('#drawn', 'a script draws this', '--page', 'index.html', '--no-check');
  assert.equal(quiet.code, 0, quiet.out);
  assert.doesNotMatch(quiet.out, /Note:/);
  assert.equal((await all()).find((x) => x.id === idOf(quiet.out)).anchor.page, undefined);
});

test('3: a browser says a selector matched nothing (move with unmatched): the agent hears it once in its next wait; a fill clears it', async () => {
  const id = idOf((await pin('#gone', 'where did it go', '--page', '/index', '--no-check')).out);
  const said = await api({ page: '/index', action: 'move', id, unmatched: true, anchor: { selector: '#gone' } });
  assert.equal(said.status, 200);
  assert.equal(said.comment.unmatched, true);
  assert.equal(said.comment.movedAt, undefined, 'no move');
  await api({ page: '/index', text: 'something from a person', anchor: { kind: 'element', selector: '#t', x: 0.5, y: 0.5 } });
  const heard = await cli(S, 'wait', '--bg', '--timeout', '5');
  assert.match(heard.out, new RegExp(`^pin ${id} matched nothing on /index: #gone$`, 'm'));
  await api({ page: '/index', text: 'and one more', anchor: { kind: 'element', selector: '#t', x: 0.5, y: 0.5 } });
  assert.doesNotMatch((await cli(S, 'wait', '--bg', '--timeout', '5')).out, /matched nothing/, 'said once');
  // Found later: the fill takes it back.
  const filled = await api({ page: '/index', action: 'move', id, fill: true, anchor: { selector: '#gone', element: '<h2>' } });
  assert.equal(filled.comment.unmatched, undefined);
  // A person's pin takes neither.
  const theirs = (await api({ page: '/index', text: 'mine', anchor: { kind: 'element', selector: '#t', x: 0.5, y: 0.5 } })).comment;
  assert.equal((await api({ page: '/index', action: 'move', id: theirs.id, unmatched: true, anchor: { selector: '#t' } })).status, 400);
});

test('6: --quote pins on those words; the browser finds them in the element', async () => {
  const r = await pin('#p', 'say it shorter', '--quote', 'lazy   dog', '--page', '/index', '--no-check');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /on the words "lazy dog"/);
  const c = (await all()).find((x) => x.id === idOf(r.out));
  assert.deepEqual([c.anchor.kind, c.anchor.selector, c.anchor.quote], ['text', '#p', { exact: 'lazy dog', prefix: '', suffix: '' }]);
});

test('4: --question and --choice make the pin itself ask; the pick comes back in the next wait', async () => {
  const q = await pin('#t', 'Is this title right?', '--question', '--page', '/index');
  assert.equal(q.code, 0, q.out);
  assert.match(q.out, /\(a question\)/);
  const asking = (await all()).find((x) => x.id === idOf(q.out));
  assert.deepEqual([asking.intent, asking.choices, Boolean(asking.session)], ['question', undefined, true]);

  const c = await pin('#t', 'Which title?', '--choice', 'Plans', '--choice', 'Pricing', '--recommend', 'B', '--page', '/index');
  assert.equal(c.code, 0, c.out);
  assert.match(c.out, /\(asks: A\) Plans {2}B\) Pricing; your pick: B\)/);
  const id = idOf(c.out);
  const root = (await all()).find((x) => x.id === id);
  assert.deepEqual([root.intent, root.choices, root.recommend, root.parent], ['question', ['Plans', 'Pricing'], 1, null]);
  // The person picks: a reply with picked, as the page's Keep sends it.
  const pick = await api({ page: '/index', parent: id, to: id, text: 'Picked A: Plans', picked: 0 });
  assert.equal(pick.status, 201);
  assert.deepEqual(pick.comment.picked, { of: id, n: 0 });
  const heard = await cli(S, 'wait', '--bg', '--timeout', '5');
  assert.match(heard.out, /^reply: Leo.* id \w+: Picked A: Plans$/m);
  assert.match(heard.out, /^ {2}picked: A\) Plans \(Leo\)$/m, 'the pick, under the pin\'s own choices');
  assert.ok(heard.out.includes(`id ${id}`));
  const text = await (await fetch(`${B}/_lab/agent/index`)).text();
  assert.match(text, /^ {2}A\) Plans$/m);
  assert.match(text, /^ {2}B\) Pricing \(your pick\)$/m);
  assert.match(text, /^ {2}picked: A\) Plans \(Leo\)$/m);
  // A person cannot make a pin that asks.
  const sneaky = await api({ page: '/index', text: 'a person', intent: 'question', choices: ['a', 'b'], anchor: { kind: 'element', selector: '#t', x: 0.5, y: 0.5 } });
  assert.equal(sneaky.comment.intent, undefined);
  assert.equal(sneaky.comment.choices, undefined);
  // Wrong choices are refused plainly.
  assert.match((await pin('#t', 'x', '--choice', 'only one', '--page', '/index')).out, /at least two/);
  assert.match((await pin('#t', 'x', '--recommend', 'B', '--page', '/index')).out, /goes with --choice/);
});

test('5: Do it on an agent pin reaches the next wait; on a person\'s pin it is only a reply', async () => {
  const r = await pin('#plans', 'Move the plans up?', '--page', '/index');
  const id = idOf(r.out);
  const done = await api({ page: '/index', parent: id, text: 'Do it', doit: true });
  assert.equal(done.status, 201);
  assert.equal(done.comment.doit, true);
  const heard = await cli(S, 'wait', '--bg', '--timeout', '5');
  assert.match(heard.out, /Do it \(Leo said: do it\. Go ahead with what your pin proposes, then reply --done\)/);
  const text = await (await fetch(`${B}/_lab/agent/index`)).text();
  assert.match(text, /^reply: Leo.* · id \w+: Do it \(Leo said: do it/m);
  const theirs = (await api({ page: '/index', text: 'mine', anchor: { kind: 'element', selector: '#t', x: 0.5, y: 0.5 } })).comment;
  const forced = await api({ page: '/index', parent: id, text: 'delete everything', doit: true });
  assert.equal(forced.comment.text, 'Do it', 'it says nothing else');
  const sneaky = await api({ page: '/index', parent: theirs.id, text: 'Do it', doit: true });
  assert.equal(sneaky.comment.doit, undefined, 'only an agent\'s own pin takes it');
});

test('5: ticked pins are told once in the next wait: "ticked: N of your M pins"', async () => {
  await cli(S, 'wait', '--bg', '--timeout', '2'); // whatever was left from the tests above
  // Another session's pin, ticked too: it is not this session's to hear about, and not in its count.
  const other = idOf((await cli('bbbbbbbb-2', 'pin', '#t', 'from another session', '--page', '/index')).out);
  assert.equal((await api({ page: '/index', action: 'resolve', id: other })).status, 200);
  const mine = (await all()).filter((c) => !c.parent && c.session && c.id !== other);
  const [one, two] = mine;
  assert.equal((await api({ page: '/index', action: 'resolve', id: one.id })).comment.resolvedBy, 'owner');
  await api({ page: '/index', action: 'resolve', id: two.id });
  // A tick alone wakes nothing: it goes out with the next pin from a person.
  await api({ page: '/index', text: 'something else', anchor: { kind: 'element', selector: '#t', x: 0.5, y: 0.5 } });
  const heard = await cli(S, 'wait', '--bg', '--timeout', '5');
  assert.match(heard.out, new RegExp(`^ticked: 2 of your ${mine.length} pins \\(resolved by people since your last wait`, 'm'));
  assert.ok(heard.out.includes(`id ${one.id}`) && heard.out.includes(`id ${two.id}`));
  assert.ok(!heard.out.includes(`id ${other}`), 'another session\'s pin is not told');
  await api({ page: '/index', text: 'and another', anchor: { kind: 'element', selector: '#t', x: 0.5, y: 0.5 } });
  assert.doesNotMatch((await cli(S, 'wait', '--bg', '--timeout', '5')).out, /ticked:/, 'said once');
  // The agent resolving its own pin is no tick.
  const agentOwn = idOf((await pin('#t', 'resolved by me', '--page', '/index')).out);
  await cli(S, 'resolve', agentOwn);
  await api({ page: '/index', text: 'yet another', anchor: { kind: 'element', selector: '#t', x: 0.5, y: 0.5 } });
  assert.doesNotMatch((await cli(S, 'wait', '--bg', '--timeout', '5')).out, /ticked:/);
});

test('3: a browser fills an agent pin made from a bare selector (move with fill); a person\'s pin takes none', async () => {
  const bare = await cli(S, 'pin', '#t', 'bare', '--page', '/index', '--no-check');
  const id = idOf(bare.out);
  const filled = await api({ page: '/index', action: 'move', id, fill: true, anchor: { selector: '#t', docX: 0.1, docY: 40, eh: 30, element: '<h1 id="t">', section: 'Plans', inside: '#plans', text: 'Pricing', kind: 'image', x: 0.9 } });
  assert.equal(filled.status, 200);
  const a = filled.comment.anchor;
  assert.deepEqual([a.element, a.section, a.inside, a.text, a.kind, a.x, a.docY], ['<h1 id="t">', 'Plans', '#plans', 'Pricing', 'element', 0.5, 40], 'only what the pin lacked, and its place; kind and share stay');
  assert.equal(filled.comment.movedAt, undefined, 'a fill is no move');
  const again = await api({ page: '/index', action: 'move', id, fill: true, anchor: { selector: '#t', element: '<h2>', section: 'Other' } });
  assert.deepEqual([again.comment.anchor.element, again.comment.anchor.section], ['<h1 id="t">', 'Plans'], 'kept');
  const theirs = (await api({ page: '/index', text: 'mine', anchor: { kind: 'element', selector: '#t', x: 0.5, y: 0.5 } })).comment;
  assert.equal((await api({ page: '/index', action: 'move', id: theirs.id, fill: true, anchor: { selector: '#t', element: '<h1>' } })).status, 400);
});

test('7: --file pins many at once: all are made ready first, then saved, every id printed', async () => {
  const file = path.join(DIR, 'points.json');
  const before = (await all()).length;
  fs.writeFileSync(file, JSON.stringify([{ selector: '#t', text: '1. title' }, { text: '2. no selector' }]));
  const bad = await pin('--file', file, '--page', '/index');
  assert.equal(bad.code, 1, bad.out);
  assert.match(bad.out, /^Pin 2: Say where/);
  assert.equal((await all()).length, before, 'nothing half saved');
  fs.writeFileSync(file, JSON.stringify([
    { selector: '#t', text: '1. title' },
    { selector: '#p', text: '2. words', quote: 'lazy dog' },
    { selector: 'h1', text: '3. other page', page: '/pricing' },
    { selector: '#plans', text: '4. choose', choices: ['yes', 'no'], recommend: 'A', at: '0.2,0.1' },
  ]));
  const ok = await pin('--file', file, '--page', '/index');
  assert.equal(ok.code, 0, ok.out);
  const ids = [...ok.out.matchAll(/Pinned (\w+) on (\S+)/g)].map((m) => [m[1], m[2]]);
  assert.equal(ids.length, 4, ok.out);
  assert.deepEqual(ids.map((x) => x[1]), ['/index', '/index', '/pricing', '/index']);
  const here = await all();
  assert.equal(here.find((c) => c.id === ids[1][0]).anchor.quote.exact, 'lazy dog');
  const asks = here.find((c) => c.id === ids[3][0]);
  assert.deepEqual([asks.choices, asks.recommend, asks.anchor.x, asks.anchor.y], [['yes', 'no'], 0, 0.2, 0.1]);
  assert.equal((await all('/pricing')).find((c) => c.id === ids[2][0]).text, '3. other page');
  // The same file run again is the same pins (a retried command), not twice as many.
  assert.equal((await pin('--file', file, '--page', '/index')).code, 0);
  assert.equal((await all()).length, here.length);
  assert.match((await pin('--file', path.join(DIR, 'nope.json'))).out, /Could not read/);
  fs.writeFileSync(file, '{"a":1}');
  assert.match((await pin('--file', file)).out, /must be a list of pins/);
});

test('8: --board pins on a frame\'s element, on a frame, or on the board itself', async () => {
  const made = await cli(S, 'board', 'new', 'Hero', '--of', '/pricing', '--variants', '2');
  assert.equal(made.code, 0, made.out);
  const name = /# Board (\S+)/.exec(made.out)[1];
  // An element of a variant: its own page.
  const inFrame = await pin('--board', name, '--frame', 'b', 'h1', 'bigger?');
  assert.equal(inFrame.code, 0, inFrame.out);
  assert.ok(idOf(inFrame.out), inFrame.out);
  const c = (await all(`/_board/${name}/b`)).find((x) => x.id === idOf(inFrame.out));
  assert.deepEqual([c.anchor.kind, c.anchor.selector, c.anchor.board, c.anchor.frame], ['element', 'h1', name, 'b']);
  // Frame a is the real page: the pin goes there, saying which board and frame it was made on.
  const onPage = await pin('--board', name, '--frame', 'a', 'p', 'buy?');
  assert.match(onPage.out, /on \/pricing at p/);
  const p = (await all('/pricing')).find((x) => x.id === idOf(onPage.out));
  assert.deepEqual([p.anchor.board, p.anchor.frame], [name, 'a']);
  // On a frame itself (no element) and on the board.
  const onFrame = await pin('--board', name, '--frame', 'c', '-', 'this one is too wide', '--at', '40,20');
  assert.equal(onFrame.code, 0, onFrame.out);
  const f = (await all('/pricing')).find((x) => x.id === idOf(onFrame.out));
  assert.deepEqual([f.anchor.kind, f.anchor.frame, f.anchor.fx, f.anchor.fy, f.anchor.board], ['board', 'c', 40, 20, name]);
  const alone = await pin('--board', name, '-', 'move these apart', '--at', '-300,50');
  const b = (await all('/pricing')).find((x) => x.id === idOf(alone.out));
  assert.deepEqual([b.anchor.kind, b.anchor.bx, b.anchor.by, b.anchor.frame], ['board', -300, 50, undefined]);
  const text = await (await fetch(`${B}/_lab/agent/pricing`)).text(); // a board about a page: its pins are the page's
  assert.match(text, /near: frame c .*40 px right of its left edge, 20 px below its top/);
  assert.match(text, /at: -300,50 on the board/);
  // Text alone with --board and --frame is a pin on the frame.
  assert.equal((await pin('--board', name, '--frame', 'b', 'just words')).code, 0);
  assert.match((await pin('--board', 'nosuch', '--frame', 'b', '-', 'x')).out, /No board nosuch/);
  assert.match((await pin('--board', name, '--frame', 'z', '-', 'x')).out, /No frame z on board/);
  assert.match((await pin('--board', name, 'h1', 'x')).out, /names its frame/);
  assert.match((await pin('--board', name, '-', 'x')).out, /--at x,y in pixels/);
});

test('12: the same pin said again is one pin, but not once it was ticked: that is a new pin; other choices are other pins', async () => {
  const a = await pin('#t', 'Same words', '--page', '/index');
  const b = await pin('#t', 'Same words', '--page', '/index');
  assert.equal(idOf(a.out), idOf(b.out), 'a retried command');
  await api({ page: '/index', action: 'resolve', id: idOf(a.out) });
  const c = await pin('#t', 'Same words', '--page', '/index');
  assert.notEqual(idOf(c.out), idOf(a.out), 'ticked in between: new');
  assert.equal((await all()).find((x) => x.id === idOf(c.out)).resolved, false);
  const q1 = await pin('#t', 'Which?', '--choice', 'A', '--choice', 'B', '--page', '/index');
  const q2 = await pin('#t', 'Which?', '--choice', 'A', '--choice', 'C', '--page', '/index');
  const q3 = await pin('#t', 'Which?', '--question', '--page', '/index');
  assert.equal(new Set([idOf(q1.out), idOf(q2.out), idOf(q3.out)]).size, 3);
});

test('13: --file takes its pins from the file: flags that belong to one pin are refused', async () => {
  const file = path.join(DIR, 'points2.json');
  fs.writeFileSync(file, JSON.stringify([{ selector: '#t', text: 'x' }]));
  for (const flag of [['--quote', 'Pricing'], ['--at', '0.1,0.1'], ['--question'], ['--choice', 'A', '--choice', 'B'], ['--recommend', 'A']]) {
    const r = await pin('--file', file, '--page', '/index', ...flag);
    assert.equal(r.code, 1, flag.join(' '));
    assert.match(r.out, new RegExp(`${flag[0]}.* go(es)? on a single pin`));
  }
});

test('14: --hint on a pin\'s --choice is kept, as on a reply; in --file it is "hints", one per choice', async () => {
  const c = await pin('#t', 'Which heading?', '--choice', 'Plans', '--hint', 'shorter', '--choice', 'Pricing', '--recommend', 'A', '--page', '/index');
  assert.equal(c.code, 0, c.out);
  const one = (await all()).find((x) => x.id === idOf(c.out));
  assert.deepEqual([one.choices, one.hints, one.recommend], [['Plans', 'Pricing'], ['shorter', ''], 0]);

  const file = path.join(DIR, 'points3.json');
  fs.writeFileSync(file, JSON.stringify([{ selector: '#plans', text: 'Keep the list?', choices: ['Keep', 'Cut'], hints: ['', 'less to read'] }]));
  const f = await pin('--file', file, '--page', '/index');
  assert.equal(f.code, 0, f.out);
  const id = [...f.out.matchAll(/Pinned (\w+)/g)][0][1];
  assert.deepEqual((await all()).find((x) => x.id === id).hints, ['', 'less to read']);

  fs.writeFileSync(file, JSON.stringify([{ selector: '#plans', text: 'Keep the list?', choices: ['Keep', 'Cut'], hints: ['why'] }]));
  const bad = await pin('--file', file, '--page', '/index');
  assert.equal(bad.code, 1, bad.out);
  assert.match(bad.out, /one for each choice/);
  const flag = await pin('--file', file, '--page', '/index', '--hint', 'x');
  assert.match(flag.out, /--hint.* go(es)? on a single pin/);
});
