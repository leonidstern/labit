// A page without scripts is patched in place on a save, and what you did to it stays: words typed in a form that has a field
// named "id" (form.id answers with that field), in a row whose class changed (it is still that row), a pick in a select whose
// options changed; and what you left alone follows the file (a select, a textarea, the body's attributes).
// Run: node test/browser/morphstate.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, freshLab, sleep, check, finish } from './harness.mjs';
const pw = playwright();
const PORT = claimPort(10700, 30);
const B = `http://localhost:${PORT}`;
const page = (v) => `<!doctype html><meta charset="utf-8"><title>t</title><body class="${v.body}">
<form><input name="id" type="hidden"><input id="t"></form><p id="p">${v.p}</p>
<ul><li class="${v.row}"><input class="r"><li class="row"><input class="r"><li class="row"><input class="r"></ul>
<select id="s">${v.opts}</select><select id="s2"><option>a<option ${v.sel2 ? 'selected' : ''}>b</select>
<textarea id="ta">${v.ta}</textarea>`;
const base = { body: 'x', p: 'one', row: 'row', opts: '<option>a<option>b<option>c', sel2: false, ta: 'file text' };
// Each engine on a lab of its own, from the base page: after a save the page has other options, and a pick by index differs.
const L = freshLab('labit-morphstate-', (dir) => {
  fs.writeFileSync(path.join(dir, 'index.html'), page(base));
  fs.writeFileSync(path.join(dir, 'labit.json'), JSON.stringify({ port: PORT }));
}, { base: B });
const save = (f, t) => fs.writeFileSync(path.join(L.dir, f), t);
try {
  for (const eng of engines()) {
    await L.up();
    const browser = await pw[eng].launch();
    const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
    await ctx.addInitScript(() => localStorage.setItem('lab-name', 'tester'));
    const pg = await ctx.newPage();
    await pg.goto(B + '/');
    await pg.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot), null, { timeout: 5000 });
    await sleep(800);
    await pg.evaluate(() => { window.__kept = 1; document.getElementById('t').value = 'typed'; document.querySelector('.r').value = 'row1'; document.getElementById('s').selectedIndex = 1; });
    await sleep(1700);
    save('index.html', page({ ...base, p: 'TWO', row: 'row hot', body: 'y', opts: '<option>z<option>a<option>b<option>c', ta: 'new file text', sel2: true }));
    await pg.waitForFunction(() => document.getElementById('p').textContent === 'TWO', null, { timeout: 6000 }).catch(() => {});
    await sleep(300);
    const r = await pg.evaluate(() => ({ kept: window.__kept, t: document.getElementById('t').value, rows: [...document.querySelectorAll('.r')].map((i) => i.value), sel: document.getElementById('s').value, nopts: document.getElementById('s').options.length, s2: document.getElementById('s2').value, ta: document.getElementById('ta').value, body: document.body.className }));
    const d = JSON.stringify(r);
    check(eng, 'patched in place, no reload', r.kept === 1, d);
    check(eng, 'a form with a field named id keeps what was typed', r.t === 'typed', d);
    check(eng, 'a row whose class changed keeps its words', JSON.stringify(r.rows) === '["row1","",""]', d);
    check(eng, 'select options follow the file and your pick stays', r.nopts === 4 && r.sel === 'b', d);
    check(eng, 'an untouched select follows the file', r.s2 === 'b', d);
    check(eng, 'an untouched textarea follows the file', r.ta === 'new file text', d);
    check(eng, 'body attributes follow the file', r.body === 'y', d);
    await browser.close();
  }
  finish();
} finally { await L.stop(); }
