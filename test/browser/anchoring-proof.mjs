// A pin's fingerprint (src/widget/anchoring.ts): the element is accepted only when its words, its company and its count
// prove it; otherwise the pin is shown as changed or unsure and the agent is told, or it is lost. Never attached because
// something came to sit at the old path. The worst cases, in Safari's engine (WebKit) and Chrome's. No lab server.
// Not part of `npm test`; CI runs it in the `browser` job. Run: node test/browser/anchoring-proof.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { playwright, engines, tmp, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });
const WIDGET = fileURLToPath(new URL('../../src/widget/', import.meta.url));
const TMP = tmp('labit-proof-');
const OUT = path.join(TMP, 'anchoring.js');
execFileSync('npx', ['--yes', 'esbuild@0.25.12', path.join(WIDGET, 'anchoring.ts'), '--bundle', '--format=iife', '--global-name=A', `--outfile=${OUT}`, '--log-level=warning']);
const BUNDLE = fs.readFileSync(OUT, 'utf8');

const open = async (ctx, body) => {
  const p = await ctx.newPage();
  await p.setContent(`<!doctype html><meta charset="utf-8"><style>body{margin:20px;font:16px/1.4 sans-serif}</style><body>${body}</body>`);
  await p.addScriptTag({ content: BUNDLE });
  await p.evaluate(() => {
    const host = document.createElement('div');
    document.documentElement.append(host);
    A.bindAnchoring({ host, layer: host, el: (tag) => document.createElement(tag) });
    // A pin on an element (a click inside it), as a person makes it.
    window.pinOn = (sel) => {
      const b = document.querySelector(sel).getBoundingClientRect();
      const a = A.anchorAt(b.left + Math.min(8, b.width / 2), b.top + b.height / 2);
      a.kind = 'element';
      delete a.quote;
      return a;
    };
    // Where the pin is now: the element, and what the agent would be told.
    window.where = (a) => {
      const n = A.findTarget(a);
      return { node: n, moved: A.position(a).moved === true, told: A.spotChanged(a) };
    };
  });
  return p;
};

try {
  for (const eng of engines('chromium,webkit')) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });

      // 1. What a pin saves: its words, how many said the same, its company, what stands beside it.
      let p = await open(ctx, '<ul id="l"><li>Alice <button>Edit</button></li><li>Bob <button>Edit</button></li></ul><p>Alone here</p>');
      let r = await p.evaluate(() => {
        const bob = pinOn('li:nth-child(2) button');
        const alone = pinOn('p');
        return { bob: bob.fp, alone: alone.fp };
      });
      check(eng, 'fingerprint: words hash, first words, how many said them, which, its company and its place among look-alikes', r.bob.t === 'Edit' && r.bob.u === 2 && r.bob.k === 1 && r.bob.x && r.bob.o[1] === 1 && r.alone.u === 1 && r.alone.t === 'Alone here' && !r.alone.a && r.bob.b === 'Alice Edit\u0001', JSON.stringify(r));

      // 2. A new first item: the pin on Bob's Edit stays on Bob's Edit (the element now at its path is Alice's).
      r = await p.evaluate(() => {
        const a = pinOn('li:nth-child(2) button');
        const bob = document.querySelectorAll('li')[1].querySelector('button');
        document.getElementById('l').insertAdjacentHTML('afterbegin', '<li>Zoe <button>Edit</button></li>');
        const w = where(a);
        return { right: w.node === bob, told: w.told };
      });
      check(eng, 'a new first row: the pin stays on its own Edit, nothing to tell', r.right && r.told === null, JSON.stringify(r));
      await p.close();

      // 3. A near-copy inserted before it (a card that only differs in a word): never the copy.
      p = await open(ctx, '<div id="g"><div class="card"><h3>Starter</h3><p>For small teams.</p></div><div class="card"><h3>Team</h3><p>For bigger teams.</p></div></div>');
      r = await p.evaluate(() => {
        const a = pinOn('.card:nth-child(2) h3');
        const team = document.querySelectorAll('h3')[1];
        document.querySelector('.card:nth-child(2)').insertAdjacentHTML('beforebegin', '<div class="card"><h3>Team</h3><p>For bigger teams (copy).</p></div>');
        const w = where(a);
        return { right: w.node === document.querySelectorAll('h3')[2] && w.node === team, copy: w.node === document.querySelectorAll('h3')[1], moved: w.moved, told: w.told };
      });
      check(eng, 'a near-copy inserted before it: the pin stays on its own heading, not the copy', r.right && !r.copy, JSON.stringify(r));
      await p.close();

      // 4. Its item deleted, the next one looks alike: lost and told, never on the look-alike.
      p = await open(ctx, '<ol id="o"><li>The dashboard shows the total orders placed this week</li><li>The dashboard shows the total orders placed this month</li><li>Something else</li></ol>');
      r = await p.evaluate(() => {
        const a = pinOn('li:nth-child(1)');
        document.querySelector('li').remove();
        const w = where(a);
        return { node: w.node && w.node.textContent, moved: w.moved, told: w.told };
      });
      check(eng, 'its item deleted: the pin is lost (moved) and the agent is told its words are gone', r.node === null && r.moved && r.told?.gone === true, JSON.stringify(r));
      await p.close();

      // 5. A typo fixed in it: still on it, shown as changed and told, not lost.
      p = await open(ctx, '<div class="row"><b>Plan</b><p>The footer note about the menu.</p></div><div class="row"><b>Plan</b><p>The second note about the menu.</p></div>');
      r = await p.evaluate(() => {
        const a = pinOn('.row:nth-child(1) p');
        const n = document.querySelector('p');
        n.textContent = 'The fotter note about the menu.';
        const w = where(a);
        return { right: w.node === n, told: w.told, first: a.fp.t };
      });
      check(eng, 'a typo fixed in its words, in its company: the pin stays on it, never gone', r.right && !r.told?.gone, JSON.stringify(r));
      await p.close();

      // 6. Its class renamed everywhere: found by its words and company, nothing to tell.
      p = await open(ctx, '<div class="grid"><div class="card">Alpha card</div><div class="card">Beta card</div><div class="card">Gamma card</div></div>');
      r = await p.evaluate(() => {
        const a = pinOn('.card:nth-child(2)');
        const n = document.querySelectorAll('.card')[1];
        document.querySelectorAll('.card').forEach((c) => (c.className = 'tile'));
        const w = where(a);
        return { right: w.node === n, told: w.told };
      });
      check(eng, 'a class renamed: the pin is still on its element, nothing to tell', r.right && r.told === null, JSON.stringify(r));
      await p.close();

      // 7. Two identical cards, a third copy before: told "unsure", never silent.
      p = await open(ctx, '<div id="g"><div class="card">Same words</div><div class="card">Same words</div></div>');
      r = await p.evaluate(() => {
        const a = pinOn('.card:nth-child(2)');
        document.getElementById('g').insertAdjacentHTML('afterbegin', '<div class="card">Same words</div>');
        const w = where(a);
        return { node: Boolean(w.node), told: w.told };
      });
      check(eng, 'an identical copy added before identical twins: the pin is unsure and the agent is told', !r.node || Boolean(r.told?.alike), JSON.stringify(r));
      await p.close();

      // 8. The page read is kept for a pass and dropped when the page changes (in the same task too).
      p = await open(ctx, '<ul id="l"><li>One</li><li>Two</li></ul>');
      r = await p.evaluate(() => {
        const a = pinOn('li:nth-child(2)');
        const first = where(a).node === document.querySelectorAll('li')[1];
        document.querySelector('li').remove();
        const w = where(a);
        const second = w.node === document.querySelector('li');
        document.querySelector('li').textContent = 'Something else entirely';
        return { first, second, told: w.told, after: A.findTarget(a) === null };
      });
      check(eng, 'the shared page read follows changes made in the same task', r.first && r.second && r.after, JSON.stringify(r));
      await p.close();

      // 9. Six edits in a row, the pin learning its element again after every sure find: still on it at the end.
      p = await open(ctx, `<h2>Plans</h2><div id="l"><div class="card"><h3>Starter</h3><p>For small teams.</p></div><div class="card"><h3>Team</h3><p>For bigger teams.</p></div><div class="card"><h3>Pro</h3><p>For companies.</p></div></div><h2>Notes</h2><p>The end.</p>`);
      r = await p.evaluate(() => {
        let a = pinOn('.card:nth-child(2) h3');
        const team = document.querySelectorAll('h3')[1];
        const heal = () => {
          const f = A.foundAt(a);
          if (f) a = { ...a, ...f };
        };
        const l = document.getElementById('l');
        const steps = [
          () => (team.textContent = 'Team plan'),
          () => l.insertAdjacentHTML('afterbegin', '<div class="card"><h3>Free</h3><p>For one.</p></div>'),
          () => (team.textContent = 'The Team plan'),
          () => l.lastElementChild.remove(),
          () => l.querySelector('p').remove(),
          () => { const w = document.createElement('section'); l.before(w); w.append(l); },
        ];
        const seen = [];
        for (const step of steps) {
          step();
          const w = where(a);
          seen.push(w.node === team ? 'on' : w.node ? 'WRONG' : 'lost');
          heal();
        }
        return { seen, fp: a.fp.t };
      });
      check(eng, 'six edits in a row with learning: never on another element, and on its own at the end', !r.seen.includes('WRONG') && r.seen.at(-1) === 'on', JSON.stringify(r));
      await p.close();

      // 10. A pin from before fingerprints (none saved) works as it did, and gets its fingerprint on the first sure find.
      p = await open(ctx, '<div id="l"><p>First note.</p><p>Second note.</p></div>');
      r = await p.evaluate(() => {
        const a = pinOn('p:nth-child(2)');
        delete a.fp;
        const found = A.foundAt(a);
        return { node: A.findTarget(a) === document.querySelectorAll('p')[1], learnt: found && found.fp && found.fp.t };
      });
      check(eng, 'a pin without fingerprint is found as before and learns one when its path and words agree', r.node && r.learnt === 'Second note.', JSON.stringify(r));
      await p.close();

      // 11. Not here now is not gone: an element that is on the page but not shown (a closed details, display:none), or that
      // a long scroll box has not built at the moment, is hidden (never lost, never told as gone); deleted for good it is lost.
      const rows = Array.from({ length: 20 }, (_, i) => `<li>Row number ${i + 1}</li>`).join('');
      p = await open(ctx, `<details id="d" open><summary>More</summary><p id="in">Words inside the details.</p></details><div id="tab"><button id="sv">Save changes</button></div><div id="v" style="height:100px;overflow:auto"><ul>${rows}</ul></div><div id="s" style="height:60px;overflow:auto"><ul><li>Only one</li><li>Only two</li><li>Only three</li></ul></div><p id="plain">A plain paragraph.</p>`);
      r = await p.evaluate(() => {
        const state = (a) => {
          const at = A.position(a);
          return `${at.why || 'plain'}${at.moved ? '+moved' : ''}${A.spotChanged(a) ? '+told' : ''}`;
        };
        const out = {};
        const inside = pinOn('#in'), save = pinOn('#sv'), plain = pinOn('#plain'), few = pinOn('#s li:nth-child(2)');
        const v = document.getElementById('v');
        v.scrollTop = 150;
        const row = pinOn('#v li:nth-child(9)');
        out.shown = [inside, save, row, few].map(state);
        document.getElementById('d').open = false;
        document.getElementById('tab').style.display = 'none';
        v.querySelector('li:nth-child(9)').remove(); // a long list builds only the rows near the view: the pinned one is not built now
        out.hidden = [inside, save, row].map(state);
        document.getElementById('d').open = true;
        document.getElementById('tab').style.display = '';
        out.back = [inside, save].map(state);
        document.getElementById('plain').remove();
        document.querySelector('#s li:nth-child(2)').remove();
        out.deleted = [state(plain), state(few)];
        const gone = pinOn('#in');
        gone.gone = true;
        out.settled = A.position(gone).why;
        return out;
      });
      check(eng, 'hidden: a closed details, display:none and a row a long list has not built are hidden, not lost, not told as gone; shown again they are plain', r.shown.every((x) => x === 'plain') && r.hidden.every((x) => x === 'hidden') && r.back.every((x) => x === 'plain'), JSON.stringify(r));
      check(eng, 'deleted for good (a paragraph; a row of a short list) is lost and told as gone; the agent saying gone is lost too', r.deleted.every((x) => x === 'lost+moved+told') && r.settled === 'lost', JSON.stringify(r));

      // 12. The look: rewritten words in the same place are changed, a copy among look-alikes is unsure.
      p = await open(ctx, '<div id="g"><p id="a">Welcome to our small shop on the corner</p></div><ul id="l"><li>Alice <button>Edit</button></li><li>Bob <button>Edit</button></li></ul>');
      r = await p.evaluate(() => {
        const a = pinOn('#a');
        const bob = pinOn('li:nth-child(2) button');
        document.getElementById('a').textContent = 'The corner shop: welcome, open nine to five daily';
        document.getElementById('l').insertAdjacentHTML('beforeend', '<li>Bob <button>Edit</button></li>');
        return { changed: A.position(a).why, copy: A.position(bob).why };
      });
      check(eng, 'rewritten in place: changed; a copy appeared next to it: unsure', r.changed === 'changed' && r.copy === 'unsure', JSON.stringify(r));
      await p.close();

      // 13. The id its selector goes through renamed (the agent renamed a section, #video to #motion: Leo, 27 Nov), the
      // element itself unchanged: the pin stays on it. A pin the agent placed (labit pin move: a selector and a spot,
      // nothing else) and a person's pin. With two such elements left, nothing tells them apart: not silently on one.
      const SECTIONS = '<section id="intro"><h2>Intro</h2><p>Some words first.</p></section><section id="video"><h2>Videos and animations</h2><div class="sv"><div class="sv-vid" style="width:200px;height:120px;background:#ddd"><i class="sv-ball"></i></div><p class="sv-cap">A ball that bounces</p></div></section><section id="end"><h2>End</h2><p>The last words.</p></section>';
      p = await open(ctx, SECTIONS);
      r = await p.evaluate(() => {
        const n = document.querySelector('.sv-vid');
        const b = n.getBoundingClientRect();
        const moved = { kind: 'element', selector: '#video .sv-vid', x: 0.5, y: 0.5, docX: (b.left + b.width / 2) / innerWidth, docY: b.top + scrollY + b.height / 2 };
        const person = pinOn('#video .sv-vid');
        const before = A.findTarget(moved) === n;
        document.getElementById('video').id = 'motion';
        return { before, moved: A.findTarget(moved) === n, person: A.findTarget(person) === n, why: [A.position(moved).why || '', A.position(person).why || ''] };
      });
      check(eng, 'a pin the agent placed on a path (#video .sv-vid): on its element', r.before, JSON.stringify(r));
      check(eng, 'an id renamed under a pin the agent placed: still on its element', r.moved, JSON.stringify(r));
      check(eng, "an id renamed under a person's pin: still on its element", r.person, JSON.stringify(r));
      await p.close();
      p = await open(ctx, SECTIONS + '<section id="more"><div class="sv-vid"></div></section>');
      r = await p.evaluate(() => {
        const moved = { kind: 'element', selector: '#video .sv-vid', x: 0.5, y: 0.5, docX: 0.5, docY: 200 };
        document.getElementById('video').id = 'motion';
        return { node: Boolean(A.findTarget(moved)) };
      });
      check(eng, 'an id renamed with two such elements on the page: not silently on either', !r.node, JSON.stringify(r));
      await p.close();

      // 14. Same words, more boxes: a label put inside the pinned card stays the card's; a pinned badge deleted while a
      // badge of another tag with other words stays elsewhere: lost, not on that one because its class is rare.
      p = await open(ctx, '<section id="s"><h2>Orders</h2><div class="card">Pending</div><p>Other words here.</p></section><section id="t"><h2>Admin</h2><div class="tools"><b class="badge">Admin tools</b></div></section>');
      r = await p.evaluate(() => {
        const card = document.querySelector('.card');
        const a = pinOn('.card');
        card.innerHTML = '<div class="label">Pending</div>';
        const inner = A.findTarget(JSON.parse(JSON.stringify(a))) === card;
        document.getElementById('s').insertAdjacentHTML('beforeend', '<span class="badge">Paid</span>');
        const b = pinOn('#s .badge');
        document.querySelector('#s .badge').remove();
        return { inner, badge: A.findTarget(JSON.parse(JSON.stringify(b)))?.outerHTML || null };
      });
      check(eng, 'a label put inside the pinned card: the pin stays on the card', r.inner, JSON.stringify(r));
      check(eng, 'a pinned badge deleted, a badge of another tag elsewhere: lost, not on it', r.badge === null, JSON.stringify(r));
      await p.close();
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 });
}
finish();
