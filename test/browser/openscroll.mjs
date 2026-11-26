// Where a thread and the chat open, and where they go when a message comes in, on a computer, in WebKit and Chromium: a thread
// with nothing new opens with its last message in view, one with new messages at the first of them, the chat at its last
// message; each stays there as its words settle (a long message lays out a frame after the first), and a message you send,
// or one that arrives while you are at the end, comes into view whole and stays. Leo, 20 Nov: "it scrolls to the wrong position".
// Not part of `npm test`; CI runs it in the `browser` job. Run: node test/browser/openscroll.mjs (needs playwright; NODE_PATH
// can point at a node_modules that has it). One line per check; exits 1 if any fails.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { claimPort } from './port.mjs';
import { playwright, engines, LAB, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });

const long = (i) => `Message number ${i}. ` + 'Some words that wrap onto more than one line so that the messages differ in height. '.repeat(1 + (i % 4));
const spot = (sel) => ({ selector: sel, x: 0.2, y: 0.5, docX: 0.1, docY: 20, width: 1000, element: `<p id="${sel.slice(1)}">` });
const chatSpot = { kind: 'page', width: 1000, height: 700, dpr: 1 };

// A lab of its own for each engine (what is read is shared by name, so one engine's opening would read it for the next):
// thread A of twelve messages, all read; thread T of twelve, the last five new; the chat of thirty, the last eight new.
async function lab(n) {
  const dir = tmp('labit-openscroll-');
  const port = String(claimPort(8470 + n * 15, 15));
  const B = `http://localhost:${port}`;
  const env = labEnv({ LAB_SETTLE_MS: '0' }, { settings: false });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><title>s</title><body style="margin:40px"><p id="a">first line of text here</p><p id="b">second line of text here</p><p id="c">third line</p></body>');
  const server = startLab(dir, env, { root: '.', port });
  await labUp(B);
  const post = (body) => fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', ...body }) }).then((r) => r.json()).then((j) => j.comment);
  const seen = [];
  const A = await post({ name: 'Sam', text: long(0), anchor: spot('#a') });
  seen.push(A.id);
  for (let i = 1; i <= 11; i++) seen.push((await post({ name: i % 2 ? 'Ann' : 'Sam', text: long(i), parent: A.id })).id);
  // Thread Q: the last message is an agent's question with choices (it opens at the question, as thread.ts says).
  const Q = await post({ name: 'Sam', text: long(0), anchor: spot('#b') });
  seen.push(Q.id);
  for (let i = 1; i <= 6; i++) seen.push((await post({ name: i % 2 ? 'Ann' : 'Sam', text: long(i), parent: Q.id })).id);
  const cli = (...args) => new Promise((done) => execFile(process.execPath, [LAB, ...args], { cwd: dir, env }, () => done()));
  await cli('wait', '--timeout', '3');
  await cli('reply', Q.id, `Which one do you want? ${long(3)}`, '--choice', 'First option with words', '--choice', 'Second option with more words to wrap around the row', '--choice', 'Third');
  for (const c of (await (await fetch(B + '/_lab/api/comments?page=/index')).json()).comments) if (c.parent === Q.id && c.session) seen.push(c.id);
  const T = await post({ name: 'Sam', text: long(0), anchor: spot('#c') });
  seen.push(T.id);
  for (let i = 1; i <= 11; i++) {
    const c = await post({ name: i % 2 ? 'Ann' : 'Sam', text: long(i), parent: T.id });
    if (i <= 6) seen.push(c.id);
  }
  for (let i = 0; i < 30; i++) {
    const c = await post({ name: i % 2 ? 'Ann' : 'Sam', text: long(i), anchor: chatSpot });
    if (i < 22) seen.push(c.id);
  }
  return { B, A, seen, post, stop: () => (server.kill(), fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 })) };
}

for (const [n, eng] of engines().entries()) {
  const L = await lab(n);
  const { B, A, seen, post } = L;
  const browser = await pw[eng].launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    await ctx.addInitScript(([s]) => {
      localStorage.setItem('lab-name', 'leo');
      localStorage.setItem('lab-seen:/index', s.join(','));
    }, [seen]);
    const p = await ctx.newPage();
    const shadow = (fn, arg) => p.evaluate(([f, a]) => new Function('r', 'a', f)([...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot, a), [fn.toString().replace(/^[^{]*{|}$/g, ''), arg]);
    // The list of messages (the open card's body, or the chat's), and where its last and its first new message sit in it.
    const look = (which) => shadow(() => {
      const box = r.querySelector(a === 'chat' ? '.chatwin .msgs' : '.card .body');
      if (!box) return null;
      const q = box.getBoundingClientRect();
      const items = [...box.querySelectorAll('.msg')];
      const at = (n) => n && { top: Math.round(n.getBoundingClientRect().top - q.top), bottom: Math.round(n.getBoundingClientRect().bottom - q.top) };
      return { scrollTop: Math.round(box.scrollTop), ch: box.clientHeight, n: items.length, last: at(items[items.length - 1]), fresh: at(box.querySelector('.fresh, .newline')), ask: at(box.querySelector('.msg.asks')) };
    }, which);
    const inView = (x, ch) => Boolean(x) && x.top >= -1 && x.bottom <= ch + 1;
    const openOne = async (which) => {
      await p.goto(B + '/');
      await sleep(1800);
      if (which === 'chat') await shadow(() => { r.querySelector('.chat-btn').click(); });
      else {
        const q = await shadow(() => { const b = r.querySelectorAll('button.pin')[a].getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, { A: 0, Q: 1, B: 2 }[which]);
        await p.mouse.click(q.x, q.y);
      }
      await sleep(450);
    };
    // Opens and, after its words have settled, a second look a second on: it is where it was.
    const stays = async (name, which, want) => {
      await openOne(which);
      const one = await look(which);
      await sleep(1200);
      const two = await look(which);
      const ok = Boolean(one && two) && want(two) && Math.abs(two.scrollTop - one.scrollTop) <= 1;
      check(eng, name, ok, JSON.stringify({ one, two }));
    };
    await stays('a read thread opens with its last message in view, and stays', 'A', (x) => x.n === 12 && inView(x.last, x.ch));
    await stays('a thread with new messages opens at the first new one, and stays', 'B', (x) => x.fresh && x.fresh.top >= -1 && x.fresh.top < x.ch - 20);
    await stays('a thread whose last message is a question opens at the question, in view, and stays', 'Q', (x) => x.ask && x.ask.top >= -1 && x.ask.top < x.ch - 40);
    await stays('the chat opens with its last message in view, and stays', 'chat', (x) => x.n === 30 && inView(x.last, x.ch));

    // A message you send, and one that arrives, while the thread or the chat is open at its end.
    for (const which of ['A', 'chat']) {
      await openOne(which);
      await sleep(900);
      const before = await look(which);
      await p.keyboard.type('my own new message that is a bit long so it wraps maybe onto a second line, ok');
      await p.keyboard.press('Enter');
      await sleep(1500);
      const mine = await look(which);
      check(eng, `${which === 'chat' ? 'the chat' : 'a thread'}: a message you send is in view, whole, and stays`, mine.n === before.n + 1 && inView(mine.last, mine.ch), JSON.stringify({ before, mine }));
      await post(which === 'chat' ? { name: 'Ann', text: long(98), anchor: chatSpot } : { name: 'Ann', text: long(99), parent: A.id });
      for (const end = Date.now() + 6000; Date.now() < end && (await look(which)).n < mine.n + 1; await sleep(100));
      await sleep(1500);
      const came = await look(which);
      check(eng, `${which === 'chat' ? 'the chat' : 'a thread'}: a message that arrives while you are at the end is in view, whole, and stays`, came.n === mine.n + 1 && inView(came.last, came.ch), JSON.stringify({ mine, came }));
    }
  } finally {
    await browser.close();
    L.stop();
  }
}
finish('');
