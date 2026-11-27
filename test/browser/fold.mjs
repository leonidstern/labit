// The agent's status messages ("on it") fold and never count as unread: a thread shows Leo's message, a small muted
// "N updates ›" row (a tap opens them in place), then the answer; before the answer the latest status stays; the pin,
// the chat and the tab title count no status as new.
// Not part of `npm test`; CI runs it in the `browser` job. Run: node test/browser/fold.mjs (needs playwright; NODE_PATH
// can point at a node_modules that has it). One line per check; exits 1 if any fails.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { claimPort } from './port.mjs';

const require = createRequire(import.meta.url);
const pw = (() => {
  for (const paths of [undefined, (process.env.NODE_PATH || '').split(path.delimiter)]) {
    try {
      return require(require.resolve('playwright', paths && { paths }));
    } catch {}
  }
  // On CI a missing browser is a failure: a skip there would pass with nothing run.
  console.log(`playwright is not installed: ${process.env.CI ? 'failed (CI)' : 'skipped'}`);
  process.exit(process.env.CI ? 1 : 0);
})();

const LAB = fileURLToPath(new URL('../../local.mjs', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (eng, name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${eng.padEnd(8)} ${name}${detail ? ` (${detail})` : ''}`);
};
const until = async (ok, ms = 6000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(60)) if (await ok()) return true;
  return false;
};

// One lab per engine, so each starts with no comments.
async function lab(n) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'labit-fold-'));
  const port = String(claimPort(6700 + n * 40, 30));
  const B = `http://localhost:${port}`;
  const env = { ...process.env, LAB_SETTLE_MS: '0', LABIT_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'labit-home-')), LABIT_NO_UPDATE_CHECK: '1', LABIT_EXIT_WITH_PARENT: '1' };
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><title>p</title><body style="margin:40px"><p id="a">first line</p><p id="b">second line</p><p id="c">third line</p></body>');
  const server = spawn(process.execPath, [LAB, '.', '--new', '--no-open', '--port', port], { cwd: dir, env });
  for (let i = 0; i < 80; i++) {
    try {
      await fetch(B + '/');
      break;
    } catch {
      await sleep(100);
    }
  }
  const cli = (...args) => new Promise((done) => execFile(process.execPath, [LAB, ...args], { cwd: dir, env }, (err, out, errOut) => done({ code: err?.code ?? 0, out: out + errOut })));
  const post = (text, sel) =>
    fetch(B + '/_lab/api/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: B },
      body: JSON.stringify({ page: '/index', name: 'Leo', text, anchor: { selector: sel, x: 0.2, y: 0.5, docX: 0.1, docY: 20, width: 1000, element: `<p id="${sel.slice(1)}">` } }),
    }).then((r) => r.json()).then((j) => j.comment.id);
  const comments = () => fetch(B + '/_lab/api/comments?page=/index').then((r) => r.json()).then((j) => j.comments);
  return { B, cli, post, comments, stop: () => (server.kill(), fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 })) };
}

for (const [n, eng] of (process.env.ENGINES || 'webkit,chromium').split(',').entries()) {
  const L = await lab(n);
  const browser = await pw[eng].launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    await ctx.addInitScript(() => localStorage.setItem('lab-name', 'leo'));
    const p = await ctx.newPage();
    await p.goto(L.B + '/');
    await until(() => p.evaluate(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.scrim'))), 3000);
    const shadow = (fn, arg) => p.evaluate(([f, a]) => new Function('r', 'a', f)([...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot, a), [fn.toString().replace(/^[^{]*{|}$/g, ''), arg]);
    const card = () => shadow(() => { const b = r.querySelector('.card .body'); return b ? { rows: [...b.children].map((n) => (n.classList.contains('updates') ? `[${n.textContent}]` : n.classList.contains('msg') ? n.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) : '')).filter(Boolean) } : null; });
    const pinNew = () => shadow(() => { return r.querySelector('button.pin')?.classList.contains('new') || false; });

    const id = await L.post('make it red', '#a');
    await until(async () => (await shadow(() => { return r.querySelectorAll('button.pin').length; })) === 1);
    await L.cli('wait', '--timeout', '5');
    await L.cli('reply', id, 'on it, first', '--on-it');
    await L.cli('reply', id, 'on it, second', '--on-it');
    await until(async () => (await L.comments()).filter((c) => c.intent === 'working').length === 2);
    await sleep(600);
    check(eng, 'status messages alone leave no new mark on the pin', (await pinNew()) === false);
    check(eng, 'and the tab title counts none', !/^\(\d+\)/.test(await p.title()), await p.title());
    await shadow(() => { r.querySelector('button.pin').click(); });
    await until(async () => Boolean(await card()));
    let rows = (await card())?.rows || [];
    check(eng, 'before the answer: the older update folds, the latest status still shows', rows.length === 3 && rows[1] === '[1 update ›]' && /on it, second/.test(rows[2]), JSON.stringify(rows));

    await L.cli('reply', id, 'made it red', '--done');
    await until(async () => /made it red/.test(((await card())?.rows || []).join('|')), 4000);
    rows = (await card())?.rows || [];
    check(eng, 'with the answer: Leo, "2 updates ›", then the answer', rows.length === 3 && /make it red/.test(rows[0]) && rows[1] === '[2 updates ›]' && /made it red/.test(rows[2]), JSON.stringify(rows));
    await shadow(() => { r.querySelector('.card .updates').click(); });
    await until(async () => ((await card())?.rows || []).length === 5, 2000);
    rows = (await card())?.rows || [];
    check(eng, 'a tap opens the updates in place, in order', rows.length === 5 && /on it, first/.test(rows[2]) && /on it, second/.test(rows[3]) && /made it red/.test(rows[4]), JSON.stringify(rows));
    await shadow(() => { r.querySelector('.card .updates').click(); });
    await until(async () => ((await card())?.rows || []).length === 3, 2000);
    check(eng, 'and a tap on the row folds them again', ((await card())?.rows || []).length === 3);

    // The chat: a status in it is not counted, and folds after the answer.
    const chatId = await fetch(L.B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: L.B }, body: JSON.stringify({ page: '/index', name: 'Leo', text: 'whole page note', anchor: { kind: 'page', width: 1000, height: 700, dpr: 1 } }) }).then((r) => r.json()).then((j) => j.comment.id);
    await L.cli('wait', '--timeout', '5');
    await L.cli('reply', chatId, 'on it, chat', '--on-it');
    await until(async () => (await L.comments()).some((c) => c.parent === chatId));
    await sleep(600);
    const count = () => shadow(() => { return r.querySelector('.cnt')?.textContent; });
    check(eng, 'the chat count takes no status as new', (await count()) === '0', await count());
    await p.keyboard.press('Escape');
    await p.keyboard.press('t');
    await until(async () => (await shadow(() => { return !r.querySelector('.chatwin').hidden; })) === true, 2000);
    const chatRows = () => shadow(() => { return [...r.querySelectorAll('.chatwin .msgs > *')].map((n) => (n.classList.contains('updates') ? `[${n.textContent}]` : n.classList.contains('msg') ? n.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) : '')).filter(Boolean); });
    let cr = await chatRows();
    check(eng, 'in the chat the lone status still shows (no answer yet)', cr.some((t) => /on it, chat/.test(t)) && !cr.some((t) => /update/.test(t)), JSON.stringify(cr));
    await L.cli('reply', chatId, 'chat answer', '--done');
    await until(async () => (await chatRows()).some((t) => /chat answer/.test(t)), 3000);
    cr = await chatRows();
    check(eng, 'in the chat the answer folds the status into "1 update ›"', cr.some((t) => t === '[1 update ›]') && !cr.some((t) => /on it, chat/.test(t)), JSON.stringify(cr));

    // Two threads interleaved in the chat fold into one row each (not one row per adjacent run), and a tap on a row keeps
    // the chat where it was: no jump to the end, no entrance animation for the messages it opens.
    const long = (w) => `${w} ${'a long note that fills the chat so it scrolls. '.repeat(14)}`;
    const note = (text) => fetch(L.B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: L.B }, body: JSON.stringify({ page: '/index', name: 'Leo', text, anchor: { kind: 'page', width: 1000, height: 700, dpr: 1 } }) }).then((r) => r.json()).then((j) => j.comment.id);
    const A = await note(long('Alpha'));
    const B = await note(long('Bravo'));
    await L.cli('wait', '--timeout', '5');
    for (const n of [1, 2, 3]) {
      await L.cli('reply', A, `status A${n}`, '--on-it');
      await L.cli('reply', B, `status B${n}`, '--on-it');
    }
    await L.cli('reply', A, 'answer to alpha');
    await L.cli('reply', B, 'answer to bravo');
    await until(async () => (await chatRows()).some((t) => /answer to bravo/.test(t)), 4000);
    cr = await chatRows();
    check(eng, 'interleaved threads fold into one row each in the chat', cr.filter((t) => t === '[3 updates ›]').length === 2 && !cr.some((t) => /status [AB]\d/.test(t)), JSON.stringify(cr));
    // A last thread D, short, near the bottom: the chat stays scrolled to its end with D's fold row in view.
    const D = await note('Delta');
    await L.cli('wait', '--timeout', '5');
    await L.cli('reply', D, 'status D1', '--on-it');
    await L.cli('reply', D, 'status D2', '--on-it');
    await L.cli('reply', D, 'answer to delta');
    await until(async () => (await chatRows()).some((t) => /answer to delta/.test(t)), 4000);
    await sleep(300);
    const chatBox = () => shadow(() => { const b = r.querySelector('.chatwin .msgs'); const u = [...b.querySelectorAll('.updates')].pop(); const kids = [...b.children]; const at = kids.indexOf(u); return { sc: b.scrollTop, over: b.scrollHeight > b.clientHeight, top: Math.round(u.getBoundingClientRect().top - b.getBoundingClientRect().top), open: u.getAttribute('aria-expanded') === 'true', opened: kids.slice(at + 1, at + 3).filter((n) => n.matches('.msg')).length, fresh: kids.slice(at + 1, at + 3).filter((n) => n.classList.contains('fresh')).length, focused: r.activeElement === u, visible: u.matches(':focus-visible'), outline: getComputedStyle(u).outlineStyle }; });
    await shadow(() => { const b = r.querySelector('.chatwin .msgs'); b.scrollTop = b.scrollHeight; [...b.querySelectorAll('.updates')].pop().focus({ preventScroll: true }); });
    await sleep(200);
    const c0 = await chatBox();
    await p.keyboard.press('Enter');
    await until(async () => (await chatBox()).open, 2000);
    const c1 = await chatBox();
    check(eng, 'the chat has something to scroll (precondition)', c0.over === true, JSON.stringify(c0));
    check(eng, 'opening a fold row in the chat at the bottom keeps the tapped row where it was', c1.top === c0.top && c1.sc === c0.sc, `${JSON.stringify(c0)} -> ${JSON.stringify(c1)}`);
    check(eng, 'and the messages it opens do not fade in as new', c1.opened === 2 && c1.fresh === 0, JSON.stringify(c1));
    check(eng, 'the keyboard focus stays on the fold row after it redraws, with a visible outline', c1.focused && c1.visible && c1.outline === 'solid', JSON.stringify(c1));
    await p.keyboard.press('Enter');
    await until(async () => !(await chatBox()).open, 2000);
    check(eng, 'and again after it folds', await shadow(() => { const u = [...r.querySelectorAll('.chatwin .msgs .updates')].pop(); return r.activeElement === u && u.getAttribute('aria-expanded') === 'false'; }));
    await p.keyboard.press('Escape');

    // A thread: the same for its sheet, and a status or an answer that arrives while you type is added in place.
    const pins = () => shadow(() => { return r.querySelectorAll('button.pin').length; });
    const before = await pins();
    const T = await L.post(`Charlie ${'a long note that fills the sheet so it scrolls even when the updates are open. '.repeat(40)}`, '#c');
    await until(async () => (await pins()) > before);
    await L.cli('wait', '--timeout', '5');
    await shadow(() => { [...r.querySelectorAll('button.pin')].pop().click(); });
    await until(async () => Boolean(await shadow(() => { return r.querySelector('.card textarea'); })), 3000);
    await shadow(() => { const t = r.querySelector('.card textarea'); t.focus(); t.__keep = 1; });
    await p.keyboard.type('half a thought');
    await L.cli('reply', T, 'status C1', '--on-it');
    await until(async () => /status C1/.test(((await card())?.rows || []).join('|')), 4000);
    await L.cli('reply', T, 'status C2', '--on-it');
    await L.cli('reply', T, 'answer to charlie');
    await until(async () => /answer to charlie/.test(((await card())?.rows || []).join('|')), 4000);
    const typing = await shadow(() => { const t = r.querySelector('.card textarea'); return { same: t?.__keep === 1, value: t?.value, focused: r.activeElement === t, rows: [...r.querySelectorAll('.card .body .msg')].map((n) => n.textContent.replace(/\s+/g, ' ').trim().slice(0, 30)) }; });
    check(eng, 'a status and an answer arriving while you type leave the box, its words and its focus alone', typing.same && typing.value === 'half a thought' && typing.focused, JSON.stringify(typing));
    check(eng, 'and both appear in the thread in place', typing.rows.some((t) => /status C1/.test(t)) && typing.rows.some((t) => /answer to cha/.test(t)), JSON.stringify(typing.rows));
    // Clear the box and let go of it: the next draw folds the statuses.
    await shadow(() => { const t = r.querySelector('.card textarea'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); t.blur(); });
    await L.cli('reply', T, 'one more thing');
    await until(async () => (await card())?.rows.some((t) => t === '[2 updates ›]'), 4000);
    rows = (await card())?.rows || [];
    check(eng, 'next draw: the statuses fold into one row before the answer', rows.some((t) => t === '[2 updates ›]'), JSON.stringify(rows));
    // The sheet on a phone has a fixed height: read at its end, a tap on a fold row must not carry the sheet to the end.
    await p.close();
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await mctx.addInitScript(() => localStorage.setItem('lab-name', 'leo'));
    const m = await mctx.newPage();
    await m.goto(L.B + '/');
    await until(() => m.evaluate(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.scrim'))), 3000);
    const mshadow = (fn, arg) => m.evaluate(([f, a]) => new Function('r', 'a', f)([...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot, a), [fn.toString().replace(/^[^{]*{|}$/g, ''), arg]);
    await until(async () => (await mshadow(() => { return r.querySelectorAll('button.pin').length; })) > 0, 3000);
    await mshadow(() => { [...r.querySelectorAll('button.pin')].pop().click(); });
    await until(async () => Boolean(await mshadow(() => { return r.querySelector('.card .updates'); })), 4000);
    await sleep(1200); // the sheet settles (reads synced, its slide-in done) before the focus is set
    const sheet = () => mshadow(() => { const b = r.querySelector('.card .body'); const u = b.querySelector('.updates'); return { sc: b.scrollTop, over: b.scrollHeight > b.clientHeight, top: Math.round(u.getBoundingClientRect().top - b.getBoundingClientRect().top), open: u.getAttribute('aria-expanded') === 'true', focused: r.activeElement === u, visible: u.matches(':focus-visible'), outline: getComputedStyle(u).outlineStyle }; });
    await mshadow(() => { const b = r.querySelector('.card .body'); b.scrollTop = b.scrollHeight; r.querySelector('.card .updates').focus({ preventScroll: true }); });
    await sleep(300);
    const s0 = await sheet();
    await m.keyboard.press('Enter');
    await until(async () => (await sheet()).open, 2000);
    const s1 = await sheet();
    check(eng, 'the phone sheet has something to scroll (precondition)', s0.over === true, JSON.stringify(s0));
    check(eng, 'opening a fold row in a sheet read at its end keeps the tapped row where it was', s1.top === s0.top && s1.sc === s0.sc, `${JSON.stringify(s0)} -> ${JSON.stringify(s1)}`);
    check(eng, 'the sheet keeps the keyboard focus on the row, with a visible outline', s1.focused && s1.visible && s1.outline === 'solid', JSON.stringify(s1));
    await mctx.close();
  } finally {
    await browser.close();
    L.stop();
  }
}
process.exit(failed ? 1 : 0);
