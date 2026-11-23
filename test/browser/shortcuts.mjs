// Shortcuts from labit.json in real browsers (WebKit and Chrome's engine): the changed keys work, the old ones don't,
// and the bar shows the new key. Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/shortcuts.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();

const DIR = tmp('labit-keys-');
const PORT = claimPort(7930, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><meta charset="utf-8"><title>k</title><h1>Keys</h1><p>text</p>');
fs.writeFileSync(path.join(DIR, 'ask.html'), '<!doctype html><meta charset="utf-8"><title>a</title><h1 id="h">Pick</h1><p>text</p><div style="height:3000px"></div>');
// canvas-proposals' "Pause and ¼ speed": a looping press with its word inside and a toast, in a box (Measure off here).
fs.writeFileSync(path.join(DIR, 'press.html'), '<!doctype html><meta charset="utf-8"><title>p</title><h1>Press</h1><div id="demo" style="position:relative;padding:40px;width:400px;height:120px;background:#eee"><span id="press" style="display:inline-block;padding:6px 12px;background:#141414;color:#fff"><b id="word">Buy</b></span><div id="toast" style="position:absolute;right:12px;bottom:12px">Order placed</div></div><script>for (const id of ["press", "toast"]) document.getElementById(id).animate([{ transform: "scale(1)" }, { transform: "scale(.94)" }, { transform: "scale(1)" }], { duration: 1200, iterations: Infinity });</script>');
fs.writeFileSync(path.join(DIR, 'anim.html'), '<!doctype html><meta charset="utf-8"><title>m</title><style>@keyframes spin { to { rotate: 1turn } } #s, #t { width: 40px; height: 40px; background: red; animation: spin 2s linear infinite }</style><h1>Moving</h1><div id="s"></div><div id="t"></div><p>text</p>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT, shortcuts: { toggle: 'h', chat: 'x' } }));
const server = startLab(DIR, labEnv());
await labUp(B);
// Waits on the condition the next step needs; `ms` is the longest it waits, and it never throws (the check after it reports the real failure).
const until = (p, fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms, polling: 'raf' }).catch(() => {});
const untilRoot = (p, fn, ms) =>
  until(p, (src) => {
    const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot;
    return Boolean(r) && new Function('r', `return (${src})(r)`)(r);
  }, fn.toString(), ms);
// What the bar shows: comments on or off, the chat open or not, and the chat button's words.
const look = (p) =>
  p.evaluate(() => {
    const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot;
    const chat = r?.querySelector('.chatwin');
    return {
      on: [...(r?.querySelectorAll('button') || [])].some((b) => /hide comments/.test(b.textContent || '')),
      chat: Boolean(chat && !chat.hidden && chat.offsetHeight),
      chatWords: [...(r?.querySelectorAll('button') || [])].map((b) => b.textContent || '').find((t) => /chat/.test(t)) || '',
    };
  });

try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await ctx.addInitScript(() => localStorage.setItem('lab-name', 'tess'));
      // How many MutationObservers are watching now (observe adds one, disconnect takes it away): a comment box that has
      // closed must stop watching the page.
      await ctx.addInitScript(() => {
        const Real = window.MutationObserver;
        const live = new Set();
        window.__watching = () => live.size;
        window.MutationObserver = class extends Real {
          observe(...a) { live.add(this); return super.observe(...a); }
          disconnect() { live.delete(this); return super.disconnect(); }
        };
      });
      const p = await ctx.newPage();
      await p.goto(B + '/');
      await untilRoot(p, () => true, 1200);
      const start = await look(p);
      await p.keyboard.press('m');
      await sleep(250);
      check(eng, 'the old toggle key (m) does nothing', (await look(p)).on === start.on);
      await p.keyboard.press('h');
      await until(p, ([_src, on]) => { const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot; return Boolean(r) && [...r.querySelectorAll('button')].some((b) => /hide comments/.test(b.textContent || '')) !== on; }, [0, start.on], 300);
      const on = await look(p);
      check(eng, 'the new toggle key (h) shows and hides comments', on.on !== start.on);
      if (!on.on) {
        await p.keyboard.press('h');
        await untilRoot(p, (r) => [...r.querySelectorAll('button')].some((b) => /hide comments/.test(b.textContent || '')), 300);
      }
      check(eng, 'the chat button shows the new key', /\(x\)/.test((await look(p)).chatWords), (await look(p)).chatWords);
      await p.keyboard.press('c');
      await sleep(250);
      check(eng, 'the old chat key (c) does nothing', !(await look(p)).chat);
      await p.keyboard.press('x');
      await untilRoot(p, (r) => { const c = r.querySelector('.chatwin'); return Boolean(c && !c.hidden && c.offsetHeight); }, 600);
      check(eng, 'the new chat key (x) opens the chat', (await look(p)).chat);
      // With the bar showing (words selected with Shift-drag), a key that is a shortcut elsewhere is a letter: the
      // changed toggle key (h) starts the comment, it doesn't hide the comments.
      await p.keyboard.press('Escape');
      await untilRoot(p, (r) => { const c = r.querySelector('.chatwin'); return !c || c.hidden || !c.offsetHeight; }, 300);
      const word = await p.evaluate(() => {
        const t = document.querySelector('p').firstChild;
        const r = document.createRange();
        r.setStart(t, 0);
        r.setEnd(t, 4);
        return r.getBoundingClientRect().toJSON();
      });
      const onBefore = (await look(p)).on;
      await p.keyboard.down('Shift');
      await p.mouse.move(word.left + 1, word.top + word.height / 2);
      await p.mouse.down();
      await p.mouse.move(word.right - 1, word.top + word.height / 2, { steps: 6 });
      await p.mouse.up();
      await p.keyboard.up('Shift');
      await untilRoot(p, (r) => r.activeElement?.localName === 'textarea' && Boolean(r.querySelector('.float')), 700);
      await p.keyboard.press('h');
      await untilRoot(p, (r) => r.querySelector('.float textarea')?.value === 'h', 900);
      const typed = await p.evaluate(() => {
        const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot;
        return r?.querySelector('.float textarea')?.value;
      });
      check(eng, 'with the comment card open on words, the changed toggle key (h) is a letter, not a shortcut', typed === 'h' && (await look(p)).on === onBefore, `${typed}`);
      // A question's rows (src/widget/thread.ts, V1 plain list): J K and the arrows move nothing; on a computer 1 to 6 pick
      // that choice (A is 1) like a tap, with its 5 s of undo, unless a text box has the focus; a tap on a row does the same.
      const key = JSON.parse(fs.readFileSync(path.join(DIR, '.lab/server.json'), 'utf8')).agent;
      const send = (body, agent) => fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B, ...(agent ? { 'x-lab-admin': key, 'x-lab-agent': '1' } : {}) }, body: JSON.stringify({ page: '/ask', ...body }) }).then((r) => r.json());
      const asked = (await send({ name: 'leo', text: 'which?', anchor: { kind: 'element', selector: '#h', x: 0.5, y: 0.5, docX: 0.1, docY: 20, width: 1000, element: '<h1 id="h">' } })).comment;
      const q = (await send({ name: 'Claude', text: 'Which?', parent: asked.id, choices: ['one', 'two', 'three'], recommend: 1 }, true)).comment;
      const a = await ctx.newPage();
      await a.goto(B + '/ask');
      await sleep(1200);
      const sh = (fn) => a.evaluate((f) => new Function('r', f)([...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot), fn);
      const row = () => sh('return [...r.querySelectorAll(".choice")].findIndex((x) => x.classList.contains("on"))');
      const note = () => sh('return r.querySelector(".choices .note")?.textContent.trim()');
      const picks = async () => (await (await fetch(`${B}/_lab/api/comments?page=/ask`)).json()).comments.filter((c) => c.picked);
      await sh('r.querySelector("button.pin").click()');
      await sleep(600);
      check(eng, 'a question with no quoted words opens on its pick; the reply box is not focused, so the digits are keys', (await row()) === 1 && !(await sh('return r.activeElement?.localName === "textarea"')));
      await a.keyboard.press('r'); // R goes to the reply box
      await sleep(200);
      check(eng, 'R puts the cursor in the reply box', await sh('return r.activeElement?.localName === "textarea"'));
      await a.keyboard.press('Enter'); // the reply box has the focus: Enter is not the card's pick
      await sleep(300);
      check(eng, 'Enter in the reply box picks nothing', (await note()) === '' && (await picks()).length === 0);
      // In the reply box they type as usual and move nothing: no digit picks while a text box has the focus.
      await a.keyboard.type('jk26');
      await sleep(200);
      check(eng, 'in the reply box J, K, 2 and 6 are typed, and pick nothing', (await sh('return r.activeElement.value')) === 'jk26' && (await row()) === 1 && (await picks()).length === 0 && (await note()) === '');
      await sh('r.activeElement.value = ""; r.activeElement.blur()');
      await sh('r.querySelectorAll(".choice")[1].focus()'); // the focus on a row, not a text box
      for (const k of ['j', 'k']) await a.keyboard.press(k);
      await sleep(300);
      check(eng, 'J and K do nothing on the card', (await row()) === 1 && (await picks()).length === 0, String(await row()));
      // The arrows move the ticked row (stopping at the ends) and never scroll the page.
      const down = [];
      for (const k of ['ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowDown']) {
        await a.keyboard.press(k);
        down.push(await row());
      }
      check(eng, 'ArrowDown / ArrowUp move the ticked row one at a time and stop at the ends', down.join() === '2,2,1,0,0,1' && (await picks()).length === 0, down.join());
      check(eng, 'the arrows did not scroll the page', (await a.evaluate(() => scrollY)) === 0);
      const pressed = await a.evaluate(() => new Promise((res) => {
        addEventListener('keydown', (e) => setTimeout(() => res(e.defaultPrevented), 0), { once: true, capture: false });
        document.dispatchEvent(Object.assign(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true, bubbles: true, composed: true })));
      }));
      check(eng, 'an arrow taken by the question is not left to scroll (default prevented)', pressed === true);
      await a.keyboard.press('ArrowUp'); // back on the agent's pick
      // Enter answers the row the arrows moved to.
      await a.keyboard.press('ArrowDown');
      await sh('r.activeElement?.blur?.()');
      await a.keyboard.press('Enter');
      await sleep(400);
      check(eng, 'Enter answers the row the arrows moved to: "Picked C · undo"', (await note()) === 'Picked C · undo' && (await picks()).length === 0, await note());
      await a.keyboard.press('ArrowUp'); // while a pick waits, the arrows move nothing
      await sleep(200);
      check(eng, 'an arrow while a pick waits is ignored', (await note()) === 'Picked C · undo');
      await sh('r.querySelector(".choices .note .btn.undo").click()');
      await sleep(300);
      check(eng, 'undo puts the tick back on the row the arrows left it on', (await note()) === '' && (await row()) === 2 && (await picks()).length === 0, String(await row()));
      await a.keyboard.press('ArrowUp');
      check(eng, 'the arrows move again after undo', (await row()) === 1);
      // In the reply box the arrows are the box's own.
      await a.keyboard.press('r');
      await a.keyboard.press('ArrowDown');
      check(eng, 'in the reply box the arrows move nothing', (await row()) === 1);
      await sh('r.activeElement.value = ""; r.activeElement.blur()');
      await a.keyboard.press('Shift+ArrowDown');
      check(eng, 'Shift with an arrow moves nothing', (await row()) === 1);
      await a.keyboard.press('9'); // no ninth choice: nothing
      await a.keyboard.press('4'); // no fourth choice: nothing
      await sleep(200);
      check(eng, '4 and 9 (no such choice) do nothing', (await note()) === '' && (await picks()).length === 0);
      await a.keyboard.press('3');
      await sleep(400);
      check(eng, '3 picks the third choice like a tap: "Picked C · undo", nothing sent yet', (await note()) === 'Picked C · undo' && (await picks()).length === 0, await note());
      await a.keyboard.press('1'); // while waiting, a digit changes nothing (undo first)
      await sleep(200);
      check(eng, 'a digit while a pick waits is ignored', (await note()) === 'Picked C · undo');
      await sh('r.querySelector(".choices .note .btn.undo").click()');
      await sleep(300);
      check(eng, 'undo puts the rows back; nothing sent', (await note()) === '' && (await row()) === 1 && (await picks()).length === 0);
      await sh('r.activeElement?.blur?.()');
      await a.keyboard.press('Enter'); // no text box, no button: Enter takes the agent's ticked row (B), as a tap
      await sleep(400);
      check(eng, 'Enter picks the ticked row (the agent\'s pick): "Picked B · undo", nothing sent yet', (await note()) === 'Picked B · undo' && (await picks()).length === 0, await note());
      await sh('r.querySelector(".choices .note .btn.undo").click()');
      await sleep(300);
      check(eng, 'undo after Enter puts the rows back', (await note()) === '' && (await row()) === 1 && (await picks()).length === 0);
      await a.keyboard.press('1');
      await sleep(5700);
      const got = await picks();
      check(eng, '1 picks the first choice and sends after 5 s', got.length === 1 && got[0].picked.n === 0 && got[0].picked.of === q.id && /^Picked A: one/.test(got[0].text), JSON.stringify(got.map((c) => [c.picked, c.text])));
      check(eng, 'no Keep button', await sh('return !r.querySelector("button.keep")'));
      // A question in the page chat has no keys: 1 to 6 pick only the open thread card's question, so 1 keeps its pointer toggle.
      await a.keyboard.press('Escape'); // the thread card closes
      await sleep(300);
      const chatRoot = (await send({ name: 'leo', text: 'and the footer?', anchor: { kind: 'page', width: 1000, height: 700, dpr: 1 } })).comment;
      await send({ name: 'Claude', text: 'Footer: which?', parent: chatRoot.id, choices: ['Dark', 'Light'], recommend: 1 }, true);
      await sleep(1200);
      await sh('r.querySelector(".chat-btn, button[aria-label^=chat]")?.click()'); // the chat
      await sleep(700);
      const inChat = await sh('return r.querySelectorAll(".msgs .choices.live").length');
      await a.keyboard.press('1');
      await sleep(400);
      check(eng, 'a question in the chat is not answered by 1 to 6', inChat === 1 && (await sh('return r.querySelector(".msgs .choices .note")?.textContent.trim()')) === '' && (await picks()).length === 1, String(inChat));
      // With the pointer switched on by 1 (comment / pointer) when no question is open: 1 still toggles it.
      await a.close();
      for (const c of (await (await fetch(`${B}/_lab/api/comments?page=/ask`)).json()).comments.filter((c) => !c.parent)) await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-admin': key, 'x-lab-agent': '1' }, body: JSON.stringify({ page: '/ask', action: 'delete', id: c.id }) });
      // Motion (Leo, 23 Nov, #421): nothing of labit sits on a moving thing; a right-click on one opens labit's motion menu
      // at the pointer (pause, speed ¼ ½ 1, comment at that moment, pause all), anywhere else the browser's own. P stops
      // them all, a comment written while paused tells the agent so (anchor.paused, atMs); P again plays. S slows all to ¼.
      await p.goto(B + '/anim');
      await until(p, () => performance.getEntriesByType('resource').some((e) => /\/_lab\/motion\.js/.test(e.name)), null, 2500);
      await sleep(300);
      // A long comment scrolls inside its box: the scrollbar sits at the box's right edge, not left of the name and arrow.
      const h2 = await p.evaluate(() => document.querySelector('h1').getBoundingClientRect().toJSON());
      await p.mouse.click(h2.left + 20, h2.top + h2.height / 2);
      await untilRoot(p, (r) => Boolean(r.querySelector('textarea')), 900);
      await p.keyboard.insertText(Array.from({ length: 14 }, (_, i) => `line ${i} of a long comment`).join('\n'));
      await sleep(300);
      const sb = await p.evaluate(() => { const deep = (root) => { for (const n of root.querySelectorAll('*')) { if (n.localName === 'textarea') return n; const f = n.shadowRoot && deep(n.shadowRoot); if (f) return f; } return null; }; const t = deep(document); const b = t.closest('.box').getBoundingClientRect(); const x = t.getBoundingClientRect(); return { scrolls: t.scrollHeight > t.clientHeight, gap: Math.round(b.right - x.right), tall: t.closest('.box').classList.contains('tall') }; });
      check(eng, 'a long comment scrolls with its scrollbar at the box\'s right edge', sb.scrolls && sb.tall && sb.gap <= 16, JSON.stringify(sb));
      await p.keyboard.press('Escape');
      // Opening and closing a comment box again and again leaves no observers behind.
      const watching = () => p.evaluate(() => window.__watching());
      const before = await watching();
      for (let i = 0; i < 5; i++) {
        await p.mouse.click(h2.left + 20, h2.top + h2.height / 2);
        await untilRoot(p, (r) => Boolean(r.querySelector('textarea')), 900);
        await p.keyboard.insertText('x');
        await p.keyboard.press('Escape');
        await sleep(150);
      }
      const after = await watching();
      check(eng, 'boxes opened and closed again leave no observers behind', after - before <= 1, `${before} → ${after}`);
      const menu = () => p.evaluate(() => {
        const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot;
        const m = r?.querySelector('.motion-menu');
        const open = Boolean(m && !m.hidden && (!m.popover || m.matches(':popover-open')));
        const b = m?.getBoundingClientRect();
        return { open, head: m?.querySelector('.lab-head')?.textContent, items: [...(m?.querySelectorAll(':scope > button') || [])].map((n) => n.textContent),
          speed: m?.querySelector('.motion-speed button[aria-pressed="true"]')?.textContent, at: b && { x: b.left, y: b.top },
          onPage: Boolean(r?.querySelector('.motions, .motion-ctl')),
          anim: document.getElementById('s').getAnimations()[0]?.playState, other: document.getElementById('t').getAnimations()[0]?.playState };
      });
      const pick = (label) => p.evaluate((l) => [...[...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot.querySelectorAll('.motion-menu button')].find((b) => b.textContent === l)?.click(), label);
      const sr = await p.evaluate(() => document.getElementById('s').getBoundingClientRect().toJSON());
      const sx = sr.left + sr.width / 2, sy = sr.top + sr.height / 2;
      const first = await menu();
      check(eng, 'nothing of labit on the page over a moving thing, and no menu before a right-click', !first.open && !first.onPage, JSON.stringify(first));
      await p.mouse.click(sx, sy, { button: 'right' });
      await sleep(200);
      const opened = await menu();
      check(eng, 'a right-click on a moving thing opens the motion menu at the pointer, its moment first',
        opened.open && /^loop \d/.test(opened.head || '') && Math.abs(opened.at.x - sx) < 3 && Math.abs(opened.at.y - sy) < 3 && opened.speed === '1'
        && JSON.stringify(opened.items) === JSON.stringify(['pause', `comment at ${opened.head.match(/^loop ([\d.]+)/)[1]} s`, 'pause all motion']), JSON.stringify(opened));
      await pick('pause');
      await until(p, () => document.getElementById('s').getAnimations()[0]?.playState === 'paused', null, 600);
      const one = await menu();
      const noPin = await p.evaluate(`!${"[...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot"}.querySelector('textarea')`);
      check(eng, 'its pause stops only that one, closes the menu and drops no pin', one.anim === 'paused' && one.other === 'running' && !one.open && noPin, JSON.stringify({ one, noPin }));
      await p.mouse.click(sx, sy, { button: 'right' });
      await sleep(200);
      check(eng, 'on a paused one the menu says play', (await menu()).items?.[0] === 'play');
      await pick('play');
      await until(p, () => document.getElementById('s').getAnimations()[0]?.playState === 'running', null, 600);
      await p.mouse.click(sx, sy, { button: 'right' });
      await sleep(200);
      await p.evaluate(() => [...[...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot.querySelectorAll('.motion-speed button')].find((b) => b.textContent === '½').click());
      await sleep(150);
      const half = await p.evaluate(() => ['s', 't'].map((id) => document.getElementById(id).getAnimations()[0]?.playbackRate));
      check(eng, '½ in its menu slows only that one', half[0] === 0.5 && half[1] === 1, JSON.stringify(half));
      await p.evaluate(() => [...[...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot.querySelectorAll('.motion-speed button')].find((b) => b.textContent === '1').click());
      await sleep(150);
      check(eng, '1 gives it its own speed back', await p.evaluate(() => document.getElementById('s').getAnimations()[0]?.playbackRate === 1));
      await p.keyboard.press('Escape');
      // Anywhere else, or with ⇧: the browser's own menu (labit leaves the event alone).
      await p.evaluate(() => addEventListener('contextmenu', (e) => (window.__cm = e.defaultPrevented)));
      const h1 = await p.evaluate(() => document.querySelector('h1').getBoundingClientRect().toJSON());
      await p.mouse.click(h1.left + 20, h1.top + h1.height / 2, { button: 'right' });
      await sleep(150);
      const plain = await p.evaluate(() => window.__cm);
      await p.keyboard.press('Escape');
      await p.keyboard.down('Shift');
      await p.mouse.click(sx, sy, { button: 'right' });
      await p.keyboard.up('Shift');
      await sleep(150);
      const shifted = await p.evaluate(() => window.__cm);
      check(eng, 'a right-click on still text, or ⇧ right-click, is the browser\'s own', plain === false && shifted === false && !(await menu()).open, JSON.stringify({ plain, shifted }));
      await p.keyboard.press('Escape');
      await p.keyboard.press('s');
      await until(p, () => ['s', 't'].every((id) => document.getElementById(id).getAnimations()[0]?.playbackRate === 0.25), null, 1200);
      check(eng, 'S slows everything to ¼', await p.evaluate(() => document.getElementById('t').getAnimations()[0]?.playbackRate === 0.25));
      await p.keyboard.press('s');
      await until(p, () => document.getElementById('s').getAnimations()[0]?.playbackRate === 1, null, 600);
      check(eng, 'S again gives each its own speed back', await p.evaluate(() => ['s', 't'].every((id) => document.getElementById(id).getAnimations()[0]?.playbackRate === 1)));
      await p.keyboard.press('p');
      await until(p, () => document.getElementById('s').getAnimations()[0]?.playState === 'paused', null, 600);
      const paused = await menu();
      check(eng, 'P pauses all the page\'s animations, and nothing shows on them', paused.anim === 'paused' && paused.other === 'paused' && !paused.onPage, JSON.stringify(paused));
      const h = await p.evaluate(() => document.querySelector('h1').getBoundingClientRect().toJSON());
      await p.mouse.click(h.left + 20, h.top + h.height / 2);
      await untilRoot(p, (r) => Boolean(r.querySelector('textarea')), 900);
      await p.keyboard.type('still');
      await p.keyboard.press('Enter');
      const pinned = async () => (await (await fetch(`${B}/_lab/api/comments?page=/anim`)).json()).comments.find((c) => c.text === 'still');
      for (let i = 0; i < 20 && !(await pinned()); i++) await sleep(100);
      check(eng, 'a comment written while paused says so, with the moment', (await pinned())?.anchor?.paused === true && Number.isFinite((await pinned())?.anchor?.atMs), JSON.stringify((await pinned())?.anchor));
      await p.keyboard.press('Escape');
      await p.keyboard.press('p');
      await until(p, () => document.getElementById('s').getAnimations()[0]?.playState === 'running', null, 600);
      const played = await menu();
      check(eng, 'P again plays them', played.anim === 'running' && played.other === 'running', JSON.stringify(played));
      // Comment at this moment: the menu's moment goes with the new comment, shown as a quiet line above its box.
      await p.mouse.click(sx, sy, { button: 'right' });
      await sleep(200);
      const at = (await menu()).items?.find((t) => t.startsWith('comment at'));
      await pick(at);
      await untilRoot(p, (r) => Boolean(r.querySelector('textarea')), 900);
      const line = await p.evaluate(() => [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot.querySelector('.float > .moment')?.textContent);
      check(eng, '"comment at" opens a comment that carries that moment', Boolean(at) && /^(at )?loop \d/.test(line || ''), JSON.stringify({ at, line }));
      await p.keyboard.press('Escape');
      await p.keyboard.press('h'); // hide comments (this lab's toggle key): a right-click is the browser's again
      await sleep(200);
      await p.mouse.click(sx, sy, { button: 'right' });
      await sleep(150);
      check(eng, 'with comments hidden a right-click on a moving thing is the browser\'s', (await p.evaluate(() => window.__cm)) === false && !(await menu()).open);
      await p.keyboard.press('Escape');
      await p.keyboard.press('h'); // comments back
      // On the moving thing, or on the word inside it: its menu.
      await p.goto(B + '/press');
      await until(p, () => performance.getEntriesByType('resource').some((e) => /\/_lab\/motion\.js/.test(e.name)), null, 2500);
      await sleep(300);
      const spot = (id, dx, dy) => p.evaluate(([id, dx, dy]) => { const r = document.getElementById(id).getBoundingClientRect(); return [r.left + r.width * dx, r.top + r.height * dy]; }, [id, dx, dy]);
      for (const [where, id, dx, dy] of [['on the moving thing', 'press', 0.08, 0.5], ['inside it', 'word', 0.5, 0.5]]) {
        const [x, y] = await spot(id, dx, dy);
        await p.mouse.click(x, y, { button: 'right' });
        await sleep(200);
        const m = await p.evaluate(() => { const b = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot.querySelector('.motion-menu'); return b && !b.hidden && b.querySelector('.lab-head')?.textContent; });
        check(eng, `a right-click ${where} opens its menu`, /^loop /.test(m || ''), String(m));
        await p.keyboard.press('Escape');
        await sleep(100);
      }
      for (const c of (await (await fetch(`${B}/_lab/api/comments?page=/anim`)).json()).comments.filter((c) => !c.parent)) await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-admin': key, 'x-lab-agent': '1' }, body: JSON.stringify({ page: '/anim', action: 'delete', id: c.id }) });
      await p.goto('about:blank');
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true });
}
finish();
