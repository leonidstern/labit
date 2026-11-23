// A board pin (+board, src/widget/boardcam.ts; Leo, 23 Nov, issue 422, pick 6C): the comment is a pin whose card holds a
// board, and nothing is written into the page. Its rules, each checked here:
// 1. +board sends the words as the pin, makes board pin-<id> about this page titled with them, and opens it; the page's
//    file is not touched.
// 2. Its card holds the board (the strip and Open); Open brings it up over the whole window.
// 3. What happens on the board shows on the pin: an agent's question there wears the asking ring and the new dot, and the
//    strip says "board needs your reply".
// 4. Deleting it is refused while its board has open threads; resolving it closes the pin only (board and threads stay,
//    the card still opens the board), and reopening brings it back.
// 5. Dragging it to a new spot keeps the same board.
// 6. Losing its spot (its element gone) sends it to the ⋯ menu like any pin, and its card there still opens the board.
// 7. Taken back within its first seconds (its own key), the pin and its board are both gone.
// 8. ⌘Z within those seconds takes it back too, and closes its board if open; ⌘Z later only closes the pin (its board
//    and pictures stay). Opening the pin's card leaves its board's threads unread; a thread's card on the board opens
//    without an error. +board asking for a name first, then sent as other words, is a plain pin.
// Not part of `npm test`. Run: node test/browser/boardpin.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();

const DIR = tmp('labit-boardpin-');
const PORT = claimPort(8360, 30);
const B = `http://localhost:${PORT}`;
const PAGE = '<!doctype html><meta charset="utf-8"><title>Page d</title>\n<h1>Page d</h1>\n<p id="t">The hero needs pictures</p>\n<p id="b">Pricing goes here</p>\n<div style="height:600px"></div>\n<p>Last</p>\n';
const FILE = path.join(DIR, 'd.html');
fs.writeFileSync(FILE, PAGE);
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);
const keys = () => JSON.parse(fs.readFileSync(path.join(DIR, '.lab/server.json'), 'utf8'));
const api = (body, as = 'owner') => fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B, ...(as === 'agent' ? { 'x-lab-admin': keys().agent, 'x-lab-agent': '1' } : as === 'owner' ? { 'x-lab-admin': keys().token } : {}) }, body: JSON.stringify({ page: '/d', ...body }) });
const list = async () => (await (await fetch(`${B}/_lab/api/comments?page=/d`)).json()).comments || [];
const boardFile = (name) => path.join(DIR, '.lab/boards', `${name}.json`);
const until = async (fn, ms = 6000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await fn()) return true;
  return false;
};

try {
  for (const eng of engines('chromium,webkit')) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'leo'); localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      const errors = [];
      // WebKit reports a fetch cut off by a reload ("… due to access control checks") as a page error: not the widget's.
      p.on('pageerror', (e) => (console.log('pageerror', e.message), /due to access control checks/.test(e.message) || errors.push(e.message)));
      const shadow = (fn, arg) => p.evaluate(([f, a]) => new Function('r', 'a', f)(document.querySelector('[data-lab-comments]').shadowRoot, a), [typeof fn === 'string' ? fn : fn.toString().replace(/^[^{]*{|}$/g, ''), arg]);
      const view = () => p.evaluate(() => Boolean(document.querySelector('[data-lab-board-view]')));
      const strip = () => shadow(() => { const h = r.querySelector('.card .pinboard'); return h ? (h.shadowRoot?.querySelector('.top')?.textContent || 'empty') : null; });
      // The board pin (number 1): the board's own threads have pins too, kept hidden while their board is closed.
      const PIN = "[...r.querySelectorAll('button.pin:not(.draft)')].filter((b) => b.style.visibility !== 'hidden' && /^comment( 1)? by/.test(b.getAttribute('aria-label') || ''))";
      const pinEl = (f) => shadow(`const b = ${PIN}[0]; return (${f})(b);`);
      const openPin = async () => {
        await pinEl('(b) => b.click()');
        await until(async () => (await strip()) && (await strip()) !== 'empty', 4000);
      };
      await p.goto(B + '/d');
      await sleep(1200);

      // ----- 1. +board: a pin, its board, the board open; the file untouched
      await p.click('#t');
      await p.waitForFunction(() => document.querySelector('[data-lab-comments]')?.shadowRoot?.querySelector('.float .quick .own'), null, { timeout: 8000 });
      await p.keyboard.type('hero refs');
      await shadow(() => { r.querySelector('.float .quick .own').click(); });
      const opened = await until(view, 8000);
      const roots = (await list()).filter((c) => !c.parent);
      const pin = roots[0];
      const name = pin && `pin-${pin.id}`;
      const made = name && fs.existsSync(boardFile(name)) && JSON.parse(fs.readFileSync(boardFile(name), 'utf8'));
      check(eng, '1. +board sends the words as a pin, makes its board about this page with them as its title, and opens it',
        opened && roots.length === 1 && pin.text === 'hero refs' && made?.title === 'hero refs' && made?.of === `/d#${name}`, JSON.stringify({ opened, roots: roots.length, text: pin?.text, made }));
      check(eng, '1. nothing is written into the page', fs.readFileSync(FILE, 'utf8') === PAGE);
      await p.keyboard.press('Escape');
      await until(async () => !(await view()));

      // ----- 2. its card holds the board; Open opens it over the whole window
      await sleep(3500); // past the undo seconds: the card is the pin's own
      await openPin();
      const s0 = await strip();
      check(eng, '2. the pin\'s card holds the board strip', /Board/.test(s0 || ''), String(s0));
      await shadow(() => { r.querySelector('.card .pinboard').shadowRoot.querySelector('button').click(); });
      const whole = (await until(view)) && (await sleep(900), true) && (await p.evaluate(() => { const r = document.querySelector('[data-lab-board-view]').getBoundingClientRect(); return r.top === 0 && Math.abs(r.height - innerHeight) < 2; }));
      check(eng, '2. Open brings the board up over the whole window', whole);
      await p.keyboard.press('Escape');
      await until(async () => !(await view()));

      // ----- 3. the board's news on the pin: an agent's question there
      const th = await (await api({ name: 'leo', text: 'more like this', anchor: { kind: 'board', board: name, fx: 10, fy: 10 } }, 'none')).json();
      await api({ name: 'Claude', parent: th.comment.id, text: 'Which of the two?', intent: 'question' }, 'agent');
      await p.reload();
      await sleep(1500);
      const face = await pinEl("(b) => b ? { new: b.classList.contains('new'), ring: b.querySelector('.ring')?.className || '', label: b.getAttribute('aria-label') } : null");
      check(eng, '3. an agent\'s question on the board shows on the pin: the asking ring and the new dot', Boolean(face) && face.new && /ask/.test(face.ring), JSON.stringify(face));
      await openPin();
      const s1 = await strip();
      check(eng, '3. the card\'s strip says the board needs your reply', /board needs your reply/.test(s1 || ''), String(s1));
      await p.keyboard.press('Escape');
      await sleep(400);
      const still = await pinEl("(b) => ({ new: b.classList.contains('new'), ring: b.querySelector('.ring')?.className || '' })");
      check(eng, '3. opening the pin\'s card leaves its board\'s question unread: ring and dot stay', still.new && /ask/.test(still.ring), JSON.stringify(still));
      // A thread's card on the board, on a computer: held beside its pin, no error, every pin still drawn.
      await openPin();
      await shadow(() => { r.querySelector('.card .pinboard').shadowRoot.querySelector('button').click(); });
      await until(view);
      await sleep(900);
      const before = errors.length;
      await shadow(() => { [...r.querySelectorAll('button.pin:not(.draft)')].find((b) => b.style.visibility !== 'hidden' && /more like this|comment/.test(b.getAttribute('aria-label') || ''))?.click(); });
      await sleep(600);
      const onIt = await shadow(() => { return { card: Boolean(r.querySelector('.card')), pins: [...r.querySelectorAll('button.pin:not(.draft)')].filter((b) => b.style.visibility !== 'hidden').length }; });
      check(eng, '3. a thread\'s card on the board opens with no error, its pin still drawn', errors.length === before && onIt.card && onIt.pins >= 1, JSON.stringify({ errors: errors.slice(before), ...onIt }));
      await p.keyboard.press('Escape');
      await p.keyboard.press('Escape');
      await until(async () => !(await view()));

      // ----- 4. delete refused while its board has open threads; resolve closes the pin only
      const refused = await api({ action: 'delete', id: pin.id });
      check(eng, '4. deleting it is refused while its board has an open thread', refused.status === 409 && fs.existsSync(boardFile(name)), String(refused.status));
      const slash = await api({ action: 'delete', id: pin.id, page: '/d/' });
      check(eng, '4. the page written with a trailing slash is refused the same', slash.status === 409 && (await list()).some((c) => c.id === pin.id), String(slash.status));
      await api({ action: 'resolve', id: pin.id });
      await p.reload();
      await sleep(1500);
      const after = await list();
      const shown = await pinEl('(b) => Boolean(b)');
      check(eng, '4. resolving it closes the pin only: the board and its thread stay, and the closed pin is still shown', after.find((c) => c.id === pin.id)?.resolved === true && after.find((c) => c.id === th.comment.id)?.resolved !== true && fs.existsSync(boardFile(name)) && shown, JSON.stringify({ shown }));
      await openPin();
      check(eng, '4. a closed pin\'s card still opens its board', /Board/.test((await strip()) || ''));
      await p.keyboard.press('Escape');
      await api({ action: 'reopen', id: pin.id });
      await p.reload();
      await sleep(1500);

      // ----- 5. dragged to a new spot: the same board
      const at = await pinEl('(b) => { const q = b.getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2]; }');
      const to = await p.locator('#b').boundingBox();
      await p.mouse.move(at[0], at[1]);
      await p.mouse.down();
      await p.mouse.move(at[0] + 20, at[1] + 10, { steps: 4 });
      await p.mouse.move(to.x + 60, to.y + to.height / 2, { steps: 8 });
      await p.mouse.up();
      await sleep(900);
      const moved = (await list()).find((c) => c.id === pin.id);
      await p.keyboard.press('Escape');
      await openPin();
      check(eng, '5. dragged to a new spot it keeps the same board', moved.anchor.selector !== pin.anchor.selector && fs.existsSync(boardFile(name)) && /Board/.test((await strip()) || ''), JSON.stringify([pin.anchor.selector, moved.anchor.selector]));
      await p.keyboard.press('Escape');

      // ----- 6. its spot gone: the ⋯ menu has it, and its card still opens the board
      await api({ action: 'move', id: pin.id, anchor: { selector: '#nope', x: 0.5, y: 0.5, docX: 0.6, docY: 300, width: 1000, element: '<p id="nope">' } });
      await p.reload();
      await sleep(1800);
      const menu = await shadow(() => { return { pins: [...r.querySelectorAll('button.pin:not(.draft)')].filter((b) => b.style.visibility !== 'hidden').length, moved: r.querySelector('.moved-btn')?.textContent || '', shown: r.querySelector('.moved-btn') ? !r.querySelector('.moved-btn').hidden : false }; });
      check(eng, '6. with its spot gone it leaves the page for the ⋯ menu', menu.pins === 0 && menu.shown && /1/.test(menu.moved), JSON.stringify(menu));
      await shadow(() => { r.querySelector('.more').click(); r.querySelector('.moved-btn').click(); });
      await until(async () => (await strip()) && (await strip()) !== 'empty', 4000);
      check(eng, '6. opened from the menu, its card still holds the board', /Board/.test((await strip()) || ''));
      await p.keyboard.press('Escape');

      // ----- 4 again: with its board's threads closed, deleting it takes the board too
      await api({ action: 'resolve', id: th.comment.id });
      const del = await api({ action: 'delete', id: pin.id });
      check(eng, '4. with no open thread on its board, deleting it takes the board and its folder too', del.ok && !fs.existsSync(boardFile(name)) && !fs.existsSync(path.join(DIR, '.lab/boards', name)), String(del.status));
      for (const c of (await list()).filter((x) => !x.parent)) await api({ action: 'delete', id: c.id });

      // ----- 7. taken back within its first seconds with its own key: pin and board gone
      await p.reload();
      await sleep(1200);
      await p.click('#b');
      await p.waitForFunction(() => document.querySelector('[data-lab-comments]')?.shadowRoot?.querySelector('.float .quick .own'), null, { timeout: 8000 });
      await shadow(() => { r.querySelector('.float .quick .own').click(); });
      await until(view, 8000);
      const second = (await list()).find((c) => !c.parent);
      const name2 = second && `pin-${second.id}`;
      const madeIt = name2 && fs.existsSync(boardFile(name2));
      const back = await p.evaluate(async ([b, id]) => (await fetch('/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: '/d', action: 'delete', id, edit: localStorage.getItem(`lab-edit:${id}`) || undefined }) })).status, [B, second?.id]);
      check(eng, '7. +board with no words names the pin "board"', second?.text === 'board', second?.text);
      check(eng, '7. taken back with its own key, the pin and its board are both gone', madeIt && back === 200 && !(await list()).length && !fs.existsSync(boardFile(name2)), JSON.stringify({ madeIt, back }));
      await p.keyboard.press('Escape');
      await until(async () => !(await view()));

      // ----- 8. ⌘Z: within the first seconds it takes the pin and board back and closes the board; later it only closes the pin
      const plusBoard = async (sel) => {
        await p.reload();
        await sleep(1200);
        await p.click(sel);
        await p.waitForFunction(() => document.querySelector('[data-lab-comments]')?.shadowRoot?.querySelector('.float .quick .own'), null, { timeout: 8000 });
        await shadow(() => { r.querySelector('.float .quick .own').click(); });
        await until(view, 8000);
        await until(async () => (await list()).some((c) => !c.parent && fs.existsSync(boardFile(`pin-${c.id}`))));
        return (await list()).find((c) => !c.parent);
      };
      const third = await plusBoard('#t');
      await p.keyboard.press('ControlOrMeta+z');
      const shut = await until(async () => !(await view()), 3000);
      check(eng, '8. ⌘Z right away takes back the pin and its board, and closes the board', shut && !(await list()).length && !fs.existsSync(boardFile(`pin-${third?.id}`)), JSON.stringify({ shut }));
      const fourth = await plusBoard('#b');
      await p.keyboard.press('Escape');
      await until(async () => !(await view()));
      await sleep(3500); // past the undo seconds
      await p.keyboard.press('ControlOrMeta+z');
      await sleep(900);
      const kept = (await list()).find((c) => c.id === fourth?.id);
      check(eng, '8. ⌘Z later closes the pin and keeps its board', kept?.resolved === true && fs.existsSync(boardFile(`pin-${fourth?.id}`)), JSON.stringify({ kept: kept && { resolved: kept.resolved } }));
      await api({ action: 'delete', id: fourth.id });

      // ----- 8. +board asking for a name first, then sent as other words: a plain pin
      await p.reload();
      await sleep(1200);
      await p.evaluate(() => localStorage.removeItem('lab-name')); // after the load: the start script sets it on each one
      await p.click('#t');
      await p.waitForFunction(() => document.querySelector('[data-lab-comments]')?.shadowRoot?.querySelector('.float .quick .own'), null, { timeout: 8000 });
      await shadow(() => { r.querySelector('.float .quick .own').click(); });
      await sleep(500);
      await shadow("const ta = r.querySelector('.float textarea'); ta.value = 'just a plain comment'; ta.dispatchEvent(new Event('input')); r.querySelector('.float input')?.focus();");
      await p.keyboard.type('leo');
      await p.keyboard.press('Enter');
      await until(async () => (await list()).length);
      await sleep(1000);
      const plain = (await list()).find((c) => !c.parent);
      check(eng, '8. +board abandoned for other words sends a plain pin, with no board', plain?.text === 'just a plain comment' && !fs.existsSync(boardFile(`pin-${plain.id}`)) && !(await view()), JSON.stringify({ text: plain?.text }));
      check(eng, 'no page errors', !errors.length, errors.join(' | '));
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
