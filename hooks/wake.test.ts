import { expect, mock, test } from 'claude-code/testing';

// A lab at /p/.lab/server.json; the session is /p/sub; /_lab/pending answers what each test sets.
// `more` changes the world: another folder for the session (`cwd`), more files (`files`: path -> text), `pending` per port.
const world = (on: any, pending: Record<string, unknown>, me = 'S1', more: { submit?: (e: any) => any; cwd?: string; files?: Record<string, string>; byPort?: Record<number, Record<string, unknown>> } = {}) => {
  const sent: string[] = [];
  const asked: number[] = [];
  const looked = { n: 0 };
  const posts: any[] = [];
  const heads: string[] = []; // the urls looked at
  const files: Record<string, string> = { '/p/.lab/server.json': JSON.stringify({ port: 4400, agent: 'k' }), ...more.files };
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }));
  on('session.cwd', () => ({ value: more.cwd || '/p/sub' }));
  on('session.id', () => ({ value: me }));
  on('env.get', (_: any, e: any) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }));
  on('fs.read', (_: any, e: any) => {
    const file = typeof e === 'string' ? e : e.path;
    return file in files ? { value: files[file] } : { deny: 'no such file' };
  });
  on('fs.list', (_: any, e: any) => {
    const dir = (typeof e === 'string' ? e : e.path) + '/';
    return { value: Object.keys(files).filter((f) => f.startsWith(dir) && !f.slice(dir.length).includes('/')).map((f) => ({ name: f.slice(dir.length), kind: 'file', size: 1, mtimeMs: 0, isLink: false })) };
  });
  on('http.fetch', (_: any, e: any) => {
    if ((e.init?.method || e.method) === 'POST') {
      posts.push(JSON.parse(e.init?.body ?? e.body));
      return { value: { status: 204, ok: true, headers: {}, text: '' } };
    }
    looked.n++;
    heads.push(typeof e === 'string' ? e : e.url);
    const port = Number(/:(\d+)\//.exec(typeof e === 'string' ? e : e.url)?.[1]);
    asked.push(port);
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ fresh: 0, pages: [], key: '', listening: false, last: 'S1', dir: '/p', cmd: 'labit', url: `http://localhost:${port}`, ...pending, ...more.byPort?.[port] }) } };
  });
  on('prompt.submit', (_: any, e: any) => {
    const r = more.submit?.(e);
    if (r) return r;
    sent.push(e.text);
    return { text: e.text };
  });
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }));
  on('turn.complete', (_: any, e: any) => ({ text: e.answer }));
  return { sent, looked, asked, posts, heads };
};
const turnStart = ($: any, turnId = 't1') => $.turn.start({ text: 'go', turnId });
const turnEnd = ($: any, turnId = 't1') => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId, reason: 'answer' });

test('an idle session that listened last is woken once for new pins', async ($, on) => {
  const clock = mock.clock(on);
  const w = world(on, { fresh: 2, pages: ['/a'], key: 'k1' });
  await $.session.start({ cwd: '/p/sub', surface: 'terminal', isInteractive: true } as any);
  await clock.advance(4000);
  expect(w.sent.length).toBe(1);
  expect(w.sent[0]).toContain('2 new pins (');
  expect(w.sent[0]).not.toContain('/a,'); // page paths are whatever a comment was posted to: not in a turn of its own
  expect(w.sent[0]).toContain('labit wait --timeout 5');
  await clock.advance(12000);
  expect(w.sent.length).toBe(1);
});

test('nothing while a wait is open, for another session, or with no pins', async ($, on) => {
  const clock = mock.clock(on);
  const a = world(on, { fresh: 1, pages: ['/a'], key: 'k1', listening: true });
  await $.session.start({ cwd: '/p/sub', surface: 'terminal', isInteractive: true } as any);
  await clock.advance(8000);
  expect(a.looked.n).toBeGreaterThan(0);
  expect(a.sent.length).toBe(0);
});

test('another session is never woken', async ($, on) => {
  const clock = mock.clock(on);
  const w = world(on, { fresh: 1, pages: ['/a'], key: 'k1' }, 'S2');
  await $.session.start({ cwd: '/p/sub', surface: 'terminal', isInteractive: true } as any);
  await clock.advance(8000);
  expect(w.sent.length).toBe(0);
});

test('a wake taken out of the queue (Escape) never started a turn: it wakes again later', async ($, on) => {
  const clock = mock.clock(on);
  const w = world(on, { fresh: 1, pages: ['/a'], key: 'k1' });
  await $.session.start({ cwd: '/p/sub', surface: 'terminal', isInteractive: true } as any);
  await clock.advance(4000);
  expect(w.sent.length).toBe(1);
  await clock.advance(8000); // no turn started yet: no second wake
  expect(w.sent.length).toBe(1);
  await clock.advance(12000); // well past 15 s with no turn: the first counts as not delivered
  expect(w.sent.length).toBe(2);
});

test('while the session is busy, pins are queued as its next turn, once, after two looks', async ($, on) => {
  const clock = mock.clock(on);
  const w = world(on, { fresh: 1, pages: ['/a'], key: 'k1' });
  await $.session.start({ cwd: '/p/sub', surface: 'terminal', isInteractive: true } as any);
  await turnStart($);
  await clock.advance(4000);
  expect(w.sent.length).toBe(0); // seen once: the agent may be about to run wait itself
  await clock.advance(4000);
  expect(w.sent.length).toBe(1);
  expect(w.sent[0]).toContain('queued while you were busy');
  await clock.advance(60000); // a long build: still one wake, the lost-wake timer doesn't run while busy
  expect(w.sent.length).toBe(1);
  await turnEnd($);
  await turnStart($, 't2'); // the wake's turn starts
  await turnEnd($, 't2');
  await clock.advance(60000);
  expect(w.sent.length).toBe(1);
});

test('a pin the agent reads itself before the second look queues nothing', async ($, on) => {
  const clock = mock.clock(on);
  const state: Record<string, unknown> = { fresh: 1, pages: ['/a'], key: 'k1' };
  const w = world(on, state);
  await $.session.start({ cwd: '/p/sub', surface: 'terminal', isInteractive: true } as any);
  await turnStart($);
  await clock.advance(4000);
  state.fresh = 0; // the agent ran wait and was handed the pin
  await clock.advance(20000);
  expect(w.sent.length).toBe(0);
});

test('a queued wake that never starts a turn counts as lost 15 s after the busy turn ends', async ($, on) => {
  const clock = mock.clock(on);
  const w = world(on, { fresh: 1, pages: ['/a'], key: 'k1' });
  await $.session.start({ cwd: '/p/sub', surface: 'terminal', isInteractive: true } as any);
  await turnStart($);
  await clock.advance(8000);
  expect(w.sent.length).toBe(1);
  await turnEnd($);
  await clock.advance(8000);
  expect(w.sent.length).toBe(1);
  await clock.advance(12000);
  expect(w.sent.length).toBe(2);
});

test('busy and another session listened last: nothing is queued', async ($, on) => {
  const clock = mock.clock(on);
  const w = world(on, { fresh: 1, pages: ['/a'], key: 'k1' }, 'S2');
  await $.session.start({ cwd: '/p/sub', surface: 'terminal', isInteractive: true } as any);
  await turnStart($);
  await clock.advance(20000);
  expect(w.sent.length).toBe(0);
});

const registry = (port: number, listener: string, root: string) => JSON.stringify({ port, pid: 1, root, name: 'x', listener });

test('a session in another folder finds the lab that lists it as listener, in the registry', async ($, on) => {
  const clock = mock.clock(on);
  const w = world(on, { fresh: 1, pages: ['/a'], key: 'k1' }, 'S1', {
    cwd: '/elsewhere',
    files: {
      '/home/u/.labit/servers/4400.json': registry(4400, 'S1', '/p'),
      '/home/u/.labit/servers/4401.json': registry(4401, 'S9', '/q'), // another session's lab
      '/q/.lab/server.json': JSON.stringify({ port: 4401, agent: 'q' }),
    },
  });
  await $.session.start({ cwd: '/elsewhere', surface: 'terminal', isInteractive: true } as any);
  await clock.advance(4000);
  expect(w.asked).toEqual([4400]); // only its own lab is asked
  expect(w.sent.length).toBe(1);
  expect(w.sent[0]).toContain('http://localhost:4400');
});

test('the registry is only believed when the lab at that folder is that port; labs of other sessions stay unasked', async ($, on) => {
  const clock = mock.clock(on);
  const w = world(on, { fresh: 1, pages: ['/a'], key: 'k1' }, 'S1', {
    cwd: '/elsewhere',
    files: {
      '/home/u/.labit/servers/4400.json': registry(4400, 'S1', '/p'),
      '/p/.lab/server.json': JSON.stringify({ port: 4999, agent: 'k' }), // another lab now lives there
      '/home/u/.labit/servers/notes.json': registry(4402, 'S1', '/p'), // not a registry file name
    },
  });
  await $.session.start({ cwd: '/elsewhere', surface: 'terminal', isInteractive: true } as any);
  await clock.advance(12000);
  expect(w.asked).toEqual([]);
  expect(w.sent.length).toBe(0);
});

test('a registry lab where the lab itself says another session listened last is not woken', async ($, on) => {
  const clock = mock.clock(on);
  const w = world(on, { fresh: 1, pages: ['/a'], key: 'k1', last: 'S2' }, 'S1', {
    cwd: '/elsewhere',
    files: { '/home/u/.labit/servers/4400.json': registry(4400, 'S1', '/p') },
  });
  await $.session.start({ cwd: '/elsewhere', surface: 'terminal', isInteractive: true } as any);
  await clock.advance(12000);
  expect([...new Set(w.asked)]).toEqual([4400]);
  expect(w.sent.length).toBe(0);
});

test('the session\'s own tool calls renew the status line of the claimed pins, once a minute each', async ($, on) => {
  const clock = mock.clock(on);
  const w = world(on, { working: [{ page: '/a', id: 'c1' }], last: 'S1' });
  on('tool.call', () => ({ result: {} }));
  await $.session.start({ cwd: '/p/sub', surface: 'terminal', isInteractive: true } as any);
  await $.tool.call({ tool: 'Edit', file_path: '/p/src/comments.js', old_string: 'a', new_string: 'b' } as any);
  await clock.advance(1000);
  expect(w.posts.length).toBe(1);
  expect(w.posts[0]).toEqual({ page: '/a', action: 'progress', id: 'c1', text: 'session activity', renew: true }); // not the tool call, not an answer; a renewal keeps the agent's words
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as any).catch(() => {});
  await clock.advance(1000);
  expect(w.posts.length).toBe(1); // within the minute: no second line
  await clock.advance(60000);
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as any).catch(() => {});
  await clock.advance(1000);
  expect(w.posts.length).toBe(2);
  expect(w.posts[1].text).toBe('session activity');
});

test('a helper\'s tool calls renew nothing, and a helper running while the session itself is idle does not keep the line alive', async ($, on) => {
  const clock = mock.clock(on);
  const w = world(on, { working: [{ page: '/a', id: 'c1' }], last: 'S1' });
  on('tool.call', () => ({ result: {} }));
  await $.session.start({ cwd: '/p/sub', surface: 'terminal', isInteractive: true } as any);
  await turnStart($);
  await $.tool.call({ tool: 'Bash', command: 'cd /x/trim-skill && sed -i s/a/b/ f', agentId: 'helper-1' } as any);
  await $.tool.call({ tool: 'Agent', description: 'build the page', agentId: 'helper-1' } as any);
  await clock.advance(200000);
  expect(w.posts.length).toBe(0);
  await $.tool.call({ tool: 'Agent', description: 'build the page' } as any); // the session's own call starts a helper: that is its activity
  await clock.advance(1000);
  expect(w.posts.length).toBe(1);
  await clock.advance(200000); // no tool call of its own: nothing renews, the line lapses at the lab
  expect(w.posts.length).toBe(1);
  await turnEnd($);
});

test('each look says the session, and the lab\'s answer for it is what counts (#420)', async ($, on) => {
  const clock = mock.clock(on);
  const w = world(on, { fresh: 1, pages: ['/pricing'], key: 'k1', last: 'S2', for: 'S1' });
  await $.session.start({ cwd: '/p/sub', surface: 'terminal', isInteractive: true } as any);
  await clock.advance(4000);
  expect(w.heads[0]).toContain('/_lab/pending?for=S1');
  expect(w.sent.length).toBe(1); // another session listened later, on another page: this one is still woken for its own
});

test('an answer for another session never wakes this one', async ($, on) => {
  const clock = mock.clock(on);
  const w = world(on, { fresh: 1, pages: ['/a'], key: 'k1', last: 'S1', for: 'S2' });
  await $.session.start({ cwd: '/p/sub', surface: 'terminal', isInteractive: true } as any);
  await clock.advance(12000);
  expect(w.sent.length).toBe(0);
});

test('a wake that keeps getting lost is sent three times for one set of pins, then left to wait', async ($, on) => {
  const clock = mock.clock(on);
  const state: Record<string, unknown> = { fresh: 1, pages: ['/a'], key: 'k1' };
  const w = world(on, state);
  await $.session.start({ cwd: '/p/sub', surface: 'terminal', isInteractive: true } as any);
  await clock.advance(120000); // no turn ever starts
  expect(w.sent.length).toBe(3);
  state.key = 'k2'; // a new pin: a new set
  state.fresh = 2;
  await clock.advance(10000);
  expect(w.sent.length).toBe(4);
  expect(w.sent[3]).toContain('2 new pins');
});

test('while the turn a wake started runs, more pins queue nothing; once it ends without listening, one wake', async ($, on) => {
  const clock = mock.clock(on);
  const state: Record<string, unknown> = { fresh: 1, pages: ['/a'], key: 'k1' };
  const w = world(on, state);
  await $.session.start({ cwd: '/p/sub', surface: 'terminal', isInteractive: true } as any);
  await clock.advance(4000);
  expect(w.sent.length).toBe(1);
  await turnStart($, 'wake'); // the wake's turn
  state.key = 'k2'; // a pin more while it answers the first
  await clock.advance(30000);
  expect(w.sent.length).toBe(1); // no second turn queued behind it
  await turnEnd($, 'wake');
  await clock.advance(4000);
  expect(w.sent.length).toBe(2); // it didn't listen again: the idle look wakes it once
});

test('a turn the person started still gets pins queued behind it', async ($, on) => {
  const clock = mock.clock(on);
  const w = world(on, { fresh: 1, pages: ['/a'], key: 'k1' });
  await $.session.start({ cwd: '/p/sub', surface: 'terminal', isInteractive: true } as any);
  await turnStart($); // no wake before it: the person's own message
  await clock.advance(8000);
  expect(w.sent.length).toBe(1);
  expect(w.sent[0]).toContain('queued while you were busy');
});

test('a wake Claude Code refuses (the session was stopped) is no try: the next turn the person starts brings it', async ($, on) => {
  const clock = mock.clock(on);
  let refuse = true;
  let refusedN = 0;
  const w = world(on, { fresh: 1, pages: ['/a'], key: 'k1' }, 'S1', {
    submit: () => (refuse ? (refusedN++, { drop: 'the session was stopped and nobody has sent input since' }) : null), // as Claude Code answers it
  });
  await $.session.start({ cwd: '/p/sub', surface: 'terminal', isInteractive: true } as any);
  await clock.advance(4000);
  expect(refusedN).toBe(1);
  await clock.advance(120000); // refused: no more submits while nobody writes
  expect(refusedN).toBe(1);
  refuse = false;
  await turnStart($); // the person writes
  await clock.advance(8000); // two looks while busy: queued behind their turn
  expect(w.sent.length).toBe(1);
  expect(w.sent[0]).toContain('queued while you were busy');
});

test('after a refused wake, a short turn of the person (over before two looks) is followed by the wake', async ($, on) => {
  const clock = mock.clock(on);
  let refuse = true;
  const w = world(on, { fresh: 1, pages: ['/a'], key: 'k1' }, 'S1', {
    submit: () => (refuse ? { drop: 'the session was stopped and nobody has sent input since' } : null),
  });
  await $.session.start({ cwd: '/p/sub', surface: 'terminal', isInteractive: true } as any);
  await clock.advance(60000);
  refuse = false;
  await turnStart($);
  await clock.advance(1000);
  await turnEnd($);
  await clock.advance(4000);
  expect(w.sent.length).toBe(1);
  expect(w.sent[0]).not.toContain('queued while you were busy');
});
