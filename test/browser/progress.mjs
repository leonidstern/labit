// "Never stuck" in real browsers (WebKit and Chrome's engine): the agent's progress line in the connection pill and on a
// working pin's tooltip (no message bubble), the queue ("2 waiting", "1st in line" in a thread's stamp), the ring colours
// (still pale green picked up, turning working, muted waiting, grey when it went quiet, amber when it asks, none when done),
// and the pill going back to normal after an answer.
// Not part of `npm test`; CI runs it in the `browser` job. Run: node test/browser/progress.mjs (needs playwright; NODE_PATH
// can point at a node_modules that has it). One line per check; exits 1 if any fails.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { claimPort } from './port.mjs';
import { playwright, engines, LAB, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });

const until = async (ok, ms = 6000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(60)) if (await ok()) return true;
  return false;
};

// One lab per engine, so each starts with no comments.
async function lab(n) {
  const dir = tmp('labit-progress-');
  const port = String(claimPort(6300 + n * 40, 30));
  const B = `http://localhost:${port}`;
  const env = labEnv({ LAB_SETTLE_MS: '0' }, { settings: false });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><title>p</title><body style="margin:40px"><p id="a">first line</p><p id="b">second line</p><p id="c">third line</p></body>');
  const server = startLab(dir, env, { root: '.', port });
  await labUp(B);
  const cli = (...args) => new Promise((done) => execFile(process.execPath, [LAB, ...args], { cwd: dir, env }, (err, out, errOut) => done({ code: err?.code ?? 0, out: out + errOut })));
  const post = (text, sel) =>
    fetch(B + '/_lab/api/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: B },
      body: JSON.stringify({ page: '/index', name: 'Leo', text, anchor: { selector: sel, x: 0.2, y: 0.5, docX: 0.1, docY: 20, width: 1000, element: `<p id="${sel.slice(1)}">` } }),
    }).then((r) => r.json()).then((j) => j.comment.id);
  const comments = () => fetch(B + '/_lab/api/comments?page=/index').then((r) => r.json()).then((j) => j.comments);
  return { B, cli, post, comments, stop: () => (server.kill(), fs.rmSync(dir, { recursive: true, force: true })) };
}

for (const [n, eng] of engines().entries()) {
  const L = await lab(n);
  const browser = await pw[eng].launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    await ctx.addInitScript(() => localStorage.setItem('lab-name', 'leo'));
    const p = await ctx.newPage();
    await p.clock.install({ time: Date.now() });
    await p.goto(L.B + '/');
    await until(() => p.evaluate(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.scrim'))), 1200); // not p.waitForFunction: the page's clock is faked
    // In the widget's shadow root. The pins are in the order the threads were made.
    const shadow = (fn, arg) => p.evaluate(([f, a]) => new Function('r', 'a', f)([...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot, a), [fn.toString().replace(/^[^{]*{|}$/g, ''), arg]);
    const pins = () => shadow(() => { return [...r.querySelectorAll('button.pin')].map((b) => [(/\bgone\b/.test(b.querySelector('.ring')?.className) ? '' : b.querySelector('.ring')?.className.replace(/\s*(come|off)\b/g, '')) || '', b.querySelector('.tip')?.textContent || '']); });
    const ringOf = async (i) => (await pins())[i]?.[0];
    const tipOf = async (i) => (await pins())[i]?.[1];
    // The words that open over the pill, and the badge the collapsed pill shows (how many wait, or ! once the agent went quiet).
    const pill = () => shadow(() => { const w = r.querySelector('.listener'); return (w?.querySelector('.lbl .t')?.textContent || '') + (w?.dataset.n ? ` [${w.dataset.n}]` : ''); });
    const pillIs = (re) => until(async () => re.test(await pill()), 8000);
    const ringIs = (i, ring) => until(async () => (await ringOf(i)) === ring);
    // All the rings at once, so the check after it doesn't catch one pin a moment behind another.
    const ringsAre = (want) => until(async () => JSON.stringify((await pins()).map((x) => x[0])) === JSON.stringify(want));

    const ids = [await L.post('make it red', '#a'), await L.post('and bigger', '#b'), await L.post('and blue', '#c')];
    await until(async () => (await pins()).length === 3);
    check(eng, 'sent pins wear no ring', (await pins()).every(([ring]) => ring === ''), JSON.stringify(await pins()));
    // The listening mark: grey when no agent listens (not black), and its tooltip names the state.
    const mark = () => shadow(() => { const w = r.querySelector('.listener'); return { title: ['.t', '.d', '.c'].map((k) => w?.querySelector(k)?.textContent || '').filter(Boolean).join('\n'), fill: w?.querySelector('.mark') ? getComputedStyle(w.querySelector('.mark')).fill : '' }; });
    await until(async () => /^No agent listening/.test((await mark()).title));
    const away = await mark();
    check(eng, 'away: a grey mark and the box says no agent listens, and how to get one', /^No agent listening\nTell an agent: listen for pins on .*\nlabit wait --page \/index$/.test(away.title) && /rgba\(/.test(away.fill), JSON.stringify(away));

    // The agent takes all three: the oldest is picked up (pale green, still), the others wait in line (muted, still).
    const heard = await L.cli('wait', '--timeout', '5');
    check(eng, 'the agent got them', ids.every((id) => heard.out.includes(id)));
    await ringsAre(['ring got', 'ring wait', 'ring wait']);
    check(eng, 'picked up: a still pale green ring; the rest wait with a still muted ring', (await ringOf(0)) === 'ring got' && (await ringOf(1)) === 'ring wait' && (await ringOf(2)) === 'ring wait', JSON.stringify(await pins()));
    check(eng, 'the pill counts those waiting', await pillIs(/is working \[2\]/), await pill());
    check(eng, 'working: a green mark and the box says Claude is working', /^Claude is working\n2 waiting(\nSession .*)?$/.test((await mark()).title) && (await mark()).fill === 'rgb(36, 160, 70)', JSON.stringify(await mark()));
    await shadow(() => { [...r.querySelectorAll('button.pin')][1].click(); });
    await until(() => shadow(() => { return !!r.querySelector('.card .stamp'); }));
    const stamp = () => shadow(() => { return r.querySelector('.card .msg.mine .stamp .state')?.textContent || ''; });
    check(eng, 'a waiting pin says its place in its thread, under the bubble', (await stamp()) === '1st in line', await stamp());
    // The words change with the state, under the bubble: the bubble keeps its size (Leo, 20 Nov: it jumped). The picked-up pin's
    // one-line bubble is as tall as the waiting one's, and in both the words sit below it.
    const bubble = () => shadow(() => { const m = r.querySelector('.card .msg.mine'); const b = m.getBoundingClientRect(); const w = m.querySelector('.state').getBoundingClientRect(); return `${Math.round(b.height)} tall, words ${w.top >= b.bottom ? 'below' : 'inside'}`; });
    const waitingSize = await bubble();
    await p.keyboard.press('Escape');
    await until(() => shadow(() => { return !r.querySelector('.card'); }));
    await shadow(() => { [...r.querySelectorAll('button.pin')][0].click(); });
    await until(() => shadow(() => { return !!r.querySelector('.card .stamp'); }));
    check(eng, 'the status words do not change the bubble: waiting and picked up (no words: ✓✓ says it) are as tall, the words below', (await bubble()) === waitingSize && /below/.test(waitingSize) && (await stamp()) === '', `${waitingSize} vs ${await bubble()}`);
    await p.keyboard.press('Escape');

    // Progress: the ring turns, the pill says what it does, hovering says it too, and no message is added.
    const say = await L.cli('reply', ids[0], '--progress', 'drawing W1–W6 · 2 of 4');
    check(eng, 'labit reply --progress works', say.code === 0 && /Progress noted/.test(say.out), say.out.trim());
    await ringsAre(['ring', 'ring wait', 'ring wait']);
    check(eng, 'working (progress): the green ring turns; the others still wait', (await ringOf(0)) === 'ring' && (await ringOf(1)) === 'ring wait', JSON.stringify(await pins()));
    check(eng, 'the pill reads the line (no name, no age) and a badge for the queue', await pillIs(/^drawing W1–W6 · 2 of 4 \[2\]$/), await pill());
    // Icon only: the words are not drawn until the pointer is on the pill, and then they come at once, in a box above it like a pin's tip.
    // The pill does not grow, and the browser's own tooltip (it waits a second) is not used.
    const open = () => shadow(() => { const w = r.querySelector('.listener'); const t = w.querySelector('.w'); const b = w.getBoundingClientRect(); const tb = t.getBoundingClientRect(); return { shown: getComputedStyle(t).opacity === '1', pill: Math.round(b.width), above: tb.bottom <= b.top, title: w.title, x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    const shut = await open();
    check(eng, 'collapsed: the pill is the mark and a badge, no words drawn', !shut.shown && shut.pill < 60, JSON.stringify(shut));
    await p.mouse.move(shut.x, shut.y);
    const t0 = Date.now();
    await until(async () => (await open()).shown);
    const wide = await open();
    check(eng, 'on the pill: its words show at once in a box above it, the pill does not grow, no browser tooltip', wide.shown && wide.above && wide.pill === shut.pill && wide.title === '' && Date.now() - t0 < 600, JSON.stringify([shut, wide]) + ` ${Date.now() - t0} ms`);
    await p.mouse.move(5, 300);
    await until(async () => !(await open()).shown);
    check(eng, 'hovering the ring shows the same line', (await tipOf(0)) === 'drawing W1–W6 · 2 of 4 · just now', await tipOf(0));
    const got = await L.comments();
    check(eng, 'no message was added, nothing is done', got.length === 3 && got[0].progress?.text === 'drawing W1–W6 · 2 of 4' && !got[0].resolved);
    // A pin you point at holds still what is on it: the working pin's tip, and the card of an open pin (it is tied to its pin,
    // which the browser reads as drawn: the pin's hover lift moved the card, and flipped it above and below near the screen's end).
    const spot = (i) => shadow(() => { const q = [...r.querySelectorAll('button.pin')][a].getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; }, i);
    const tops = async (sel, ms) => {
      const seen = [];
      for (const end = Date.now() + ms; Date.now() < end; await sleep(25)) seen.push(await shadow(() => { return r.querySelector(a)?.getBoundingClientRect().top ?? null; }, sel));
      return seen.filter((t) => t !== null);
    };
    const spread = (a) => (a.length ? Math.max(...a) - Math.min(...a) : Infinity);
    await p.mouse.move(5, 5);
    const at0 = await spot(0);
    await p.mouse.move(at0.x, at0.y, { steps: 3 });
    await sleep(500);
    const tipTops = await tops('button.pin .tip', 600);
    check(eng, 'hovering a working pin: its tip stays within 1 px while the pointer is still', tipTops.length > 5 && spread(tipTops) <= 1, `${tipTops.length} frames, ${spread(tipTops).toFixed(2)} px`);
    await p.mouse.move(5, 5);
    const at1 = await spot(1);
    await p.mouse.click(at1.x, at1.y);
    await until(() => shadow(() => { return !!r.querySelector('.card'); }));
    await p.mouse.move(5, 5);
    await sleep(600);
    const rest = (await tops('.card', 100))[0];
    const held = [];
    for (let k = 0; k < 4; k++) { // the pointer crossing its pin's edge in and out: the card must not follow it
      await p.mouse.move(at1.x, at1.y, { steps: 2 });
      held.push(...(await tops('.card', 250)));
      await p.mouse.move(5, 5, { steps: 2 });
      held.push(...(await tops('.card', 250)));
    }
    const off = Math.max(...held.map((t) => Math.abs(t - rest)));
    check(eng, "hovering an open pin: its card's top stays within 0.1 px, in and out", held.length > 20 && off <= 0.1, `${held.length} frames, moved ${off.toFixed(2)} px`);
    await p.keyboard.press('Escape');
    await until(() => shadow(() => { return !r.querySelector('.card'); }));
    // Opening, closing and reopening a thread by its pin: the card is never see-through (opacity 1, an opaque ground) and there
    // is never more than one (an old one fading out beside the new one let the page show through).
    {
      const look = () => shadow(() => { return [...r.querySelectorAll('.card')].map((c) => { const s = getComputedStyle(c); return `${s.opacity} ${s.backgroundColor}`; }); });
      const seenCards = [];
      const watch = async (ms) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) seenCards.push(await look()); };
      await p.mouse.move(5, 5);
      const pinAt = await spot(1);
      await p.mouse.move(pinAt.x, pinAt.y, { steps: 2 });
      await sleep(200);
      await p.mouse.down(); await p.mouse.up(); // open
      await watch(400);
      await p.mouse.down(); await p.mouse.up(); // close
      await sleep(30);
      await p.mouse.down(); await p.mouse.up(); // reopen at once
      await watch(500);
      await p.mouse.down(); await p.mouse.up(); // close again
      await watch(100);
      const many = seenCards.filter((c) => c.length > 1).length;
      const thin = seenCards.flat().filter((c) => !/^1 rgb\((\d+), (\d+), (\d+)\)$/.test(c)).length;
      check(eng, 'opening, closing and reopening a thread: one card at most, never see-through', seenCards.some((c) => c.length === 1) && many === 0 && thin === 0, `${seenCards.length} looks, ${many} with two cards, ${thin} see-through`);
      await p.keyboard.press('Escape');
      await until(() => shadow(() => { return !r.querySelector('.card'); }));
    }
    // Placing a pin: the new comment's box and its pin keep their place from the first frame (the box was placed a line short
    // and grew, and followed the pin's pop-in: near the screen's end it jumped, and WebKit snapped it at the end). Layout
    // numbers, so the box's own fade-in (a transform) is not counted; recorded in the page on each resize too (a frame is short).
    for (const [spotName, x, y] of [['in the page', 300, 100], ['near the right edge', 985, 100], ['near the bottom', 300, 690]]) {
      await p.mouse.move(5, 5);
      await shadow(() => {
        window.__seen = [];
        window.__take = () => {
          const f = r.querySelector('.float');
          const q = r.querySelector('.pin.draft')?.getBoundingClientRect();
          // The bar and the listening pill too: placing a pin must not touch them on a computer (only a phone's sheet moves them).
          const away = ['.bar', '.listener', '.left'].map((s) => { const n = r.querySelector(s); if (!n) return ''; const c = getComputedStyle(n); const b = n.getBoundingClientRect(); return [c.opacity, c.visibility, c.transform, b.left, b.top, b.width, b.height].join(' '); }).join(' | ');
          if (f && q) window.__seen.push([parseFloat(getComputedStyle(f).top), f.offsetHeight, q.top, q.left, away, getComputedStyle(r.querySelector('.ptr')).opacity]);
        };
        window.__watch?.disconnect();
        window.__watch = new MutationObserver(() => {
          const f = r.querySelector('.float');
          if (!f || f.__ro) return;
          f.__ro = true;
          window.__take();
          new ResizeObserver(window.__take).observe(f);
        });
        window.__watch.observe(r, { childList: true, subtree: true });
      });
      await p.mouse.move(x, y, { steps: 2 }); // the pointer rests on the spot first, its drawn pin showing
      await sleep(300);
      const shownBefore = await shadow(() => { return getComputedStyle(r.querySelector('.ptr')).opacity; });
      await p.mouse.click(x, y);
      for (const end = Date.now() + 700; Date.now() < end; await sleep(20)) await shadow(() => { window.__take(); });
      const seen = await p.evaluate(() => window.__seen);
      const range = (k) => (seen.length ? Math.max(...seen.map((r) => r[k])) - Math.min(...seen.map((r) => r[k])) : Infinity);
      check(eng, `placing a pin ${spotName}: the box and the pin stay within 0.5 px from the first frame`, seen.length > 5 && Math.max(range(0), range(1), range(2), range(3)) <= 0.5, `${seen.length} samples, box top ${range(0).toFixed(2)}, height ${range(1).toFixed(2)}, pin ${range(2).toFixed(2)}`);
      // The drawn pointer (the pin-shaped pill that follows the mouse) is gone from the first frame: it faded over the new pin, 1 px off.
      const ptrSeen = new Set(seen.map((r) => r[5]));
      check(eng, `placing a pin ${spotName}: the drawn pointer is gone at once, not faded over the new pin`, (shownBefore === '1' || spotName !== 'in the page') && ptrSeen.size === 1 && ptrSeen.has('0'), `shown ${shownBefore} before; then ${[...ptrSeen].join(' ')}`);
      const moves = new Set(seen.map((r) => r[4]));
      check(eng, `placing a pin ${spotName}: the bar and the listening pill do not flicker or move`, moves.size === 1 && !moves.has('') && !/ hidden /.test([...moves][0]), `${moves.size} looks of 3: ${[...moves].slice(0, 2).join(' // ')}`);
      await p.keyboard.press('Escape');
      await until(() => shadow(() => { return !r.querySelector('.float'); }));
    }
    const width = () => shadow(() => { return Math.round(r.querySelector('.listener').getBoundingClientRect().width); });
    const w1 = await width();
    await L.cli('reply', ids[0], '--progress', 'a different and much longer line about what is being drawn right now, with more words');
    await pillIs(/different and much longer/);
    check(eng, 'a longer line does not make the pill wider (nothing beside it moves)', (await width()) === w1, `${w1} → ${await width()} px`);

    // A question: amber and still, the pill back to normal; then done: no ring, and the next one in line is picked up.
    await L.cli('reply', ids[0], 'green or red?', '--question');
    await ringIs(0, 'ring asks');
    check(eng, 'a question: an amber ring, and the pill has no line', (await ringOf(0)) === 'ring asks' && (await pillIs(/is working \[1\]/)) && !/drawing/.test(await pill()), `${await ringOf(0)} | ${await pill()}`);
    check(eng, 'the progress line is gone from the thread (cleared by the answer)', (await L.comments()).find((c) => c.id === ids[0]).progress === undefined);
    await L.cli('reply', ids[0], 'Done: red', '--done');
    await ringsAre(['', 'ring got', 'ring wait']);
    check(eng, 'done: no ring; the next is picked up and the last is first in line', (await ringOf(0)) === '' && (await ringOf(1)) === 'ring got' && (await ringOf(2)) === 'ring wait', JSON.stringify(await pins()));

    // Gone quiet: 6 minutes with no sign → grey still ring; the pill says so and what came last; a new line brings it back.
    await L.cli('reply', ids[1], '--progress', 'drawing W1–W6 · 3 of 4');
    await ringIs(1, 'ring');
    // A status line is a sign for 3 minutes unless it is renewed: still working at 2.5, grey (the same look) just after 3.
    await p.clock.runFor(2.5 * 60 * 1000);
    await ringsAre(['', 'ring', 'ring wait']);
    await p.clock.runFor(60 * 1000);
    await ringsAre(['', 'ring stale', 'ring wait']);
    check(eng, 'a status line not renewed for 3 min lapses: the grey ring, and the pill says no update for 3 min', await pillIs(/^No update for 3 min \[!\]$/) && /\nLast: drawing W1–W6 · 3 of 4\n/.test((await mark()).title), await pill() + ' | ' + (await mark()).title);
    await p.clock.runFor(3 * 60 * 1000);
    await ringsAre(['', 'ring stale', 'ring wait']);
    check(eng, 'no sign for 5+ min: a grey still ring (the one waiting behind it is not grey)', (await ringOf(1)) === 'ring stale' && (await ringOf(2)) === 'ring wait', JSON.stringify(await pins()));
    check(eng, 'the pill says how long and what came last', await pillIs(/^No update for 6 min \[!\]$/) && /\nLast: drawing W1–W6 · 3 of 4\n1 waiting/.test((await mark()).title), await pill() + ' | ' + (await mark()).title);
    check(eng, 'the tooltip says it too', /^no update for 6 min · last: drawing W1–W6 · 3 of 4$/.test(await tipOf(1)), await tipOf(1));
    // The next line replaces the old one on the thread (the page's own clock is moved ahead here, the lab's is not, so
    // it would still read as old: the stored line is what's checked).
    await L.cli('reply', ids[1], '--progress', 'drawing W1–W6 · 4 of 4');
    check(eng, 'the next line replaces the last on the thread', (await L.comments()).find((c) => c.id === ids[1]).progress?.text === 'drawing W1–W6 · 4 of 4');
    // A named session: the pill has no name in its words; the name is in its tooltip.
    for (const id of ids) await L.cli('reply', id, 'Done', '--done');
    const named = L.cli('wait', '--name', 'ooze', '--timeout', '4');
    const pillTip = () => shadow(() => { const w = r.querySelector('.listener'); return { words: w?.querySelector('.lbl .t')?.textContent || '', title: w?.querySelector('.d')?.textContent || '' }; });
    await until(async () => /Session ooze/.test((await pillTip()).title), 3000);
    const nm = await pillTip();
    check(eng, 'a named session: the pill has no name in its words, the tooltip has it', /Session ooze/.test(nm.title) && !/ooze/.test(nm.words), JSON.stringify(nm));
    await named;
    await p.close();
  } finally {
    await browser.close();
    L.stop();
  }
}
finish('');
