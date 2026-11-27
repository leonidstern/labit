// A reload the lab makes (a page with a script of its own is reloaded on a save, not patched) puts back what you did to
// the page: the scroll, a scrolled box, an opened <details>, typed words, a tick, a choice. A page that builds itself
// after it loads gets its scroll back once it is long enough. Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/reloadstate.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, freshLab, sleep, check, finish } from './harness.mjs';

const pw = playwright();

const PORT = claimPort(10600, 30);
const B = `http://localhost:${PORT}`;
const lines = (n) => Array.from({ length: n }, (_, i) => `<p>Paragraph number ${i} with some words in it.</p>`).join('\n');
const page = (word) => `<!doctype html><meta charset="utf-8"><title>t</title>
<h1>Title ${word}</h1>
<details><summary>More</summary><p>hidden</p></details>
<input id="in"><textarea></textarea><input type="checkbox" id="cb"><input type="password" id="pw">
<input id="same" value="from the file ${word}">
<select id="sel"><option>a<option>b<option>c</select>
<div id="box" style="height:200px;overflow:auto">${lines(60)}</div>
${lines(40)}<h2 id="target">Target</h2>${lines(80)}<script>window.own = 1</script>`;
const app = `setTimeout(() => (document.getElementById('late').innerHTML = ${JSON.stringify(lines(150))}), 700);`;
const drawPage = (word) => `<!doctype html><meta charset="utf-8"><title>${word}</title><h1>Draw ${word}</h1>${lines(20)}<script>window.own = 1</script>`;
const save = (f, text) => fs.writeFileSync(path.join(L.dir, f), text);
// Each engine on a lab of its own, from these files: the one before it saved them and left a drawing on /drawhold.
const L = freshLab('labit-reloadstate-', () => {
  save('index.html', page('one'));
  save('app.js', app);
  save('late.html', '<!doctype html><meta charset="utf-8"><title>l</title><h1>Late</h1><div id="late"></div><script src="app.js"></script>');
  // #428: a page with a script of its own, saved while a drawing is being drawn; and a plain page that misses saves.
  save('drawhold.html', drawPage('one'));
  save('plain.html', `<!doctype html><meta charset="utf-8"><title>p</title><h1>Plain</h1>${lines(20)}`);
  save('labit.json', JSON.stringify({ port: PORT }));
}, { base: B });
const post = (page, id, tag = 'p') => fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page, name: 'tester', text: 'Comment', anchor: { selector: '#' + id, x: 0.3, y: 0.5, docX: 0.3, docY: 900, width: 1000, element: `<${tag} id="${id}">` } }) });
try {
  for (const eng of engines()) {
    await L.up();
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await ctx.addInitScript(() => localStorage.setItem('lab-name', 'tester'));
      const open = async (p) => {
        const pg = await ctx.newPage();
        await pg.goto(B + p);
        await pg.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot), null, { timeout: 5000 });
        await sleep(800);
        await pg.evaluate(() => (window.__kept = 1));
        return pg;
      };
      const pg = await open('/');
      await pg.fill('#in', 'typed');
      await pg.fill('textarea', 'area');
      await pg.fill('#pw', 'secret');
      await pg.evaluate(() => {
        document.activeElement.blur();
        document.getElementById('target').scrollIntoView();
        document.getElementById('box').scrollTop = 300;
        document.querySelector('details').open = true;
        document.getElementById('cb').checked = true;
        document.getElementById('sel').selectedIndex = 2;
      });
      const y = await pg.evaluate(() => Math.round(scrollY));
      await sleep(1800); // a reload waits 1.5 s after a touch
      save('index.html', page('two'));
      await pg.waitForFunction(() => !window.__kept && document.querySelector('h1')?.textContent === 'Title two', null, { timeout: 8000 }).catch(() => {});
      await sleep(600);
      const s = await pg.evaluate(() => ({
        reloaded: !window.__kept, y: Math.round(scrollY), box: document.getElementById('box').scrollTop, open: document.querySelector('details').open,
        input: document.getElementById('in').value, area: document.querySelector('textarea').value, tick: document.getElementById('cb').checked,
        sel: document.getElementById('sel').selectedIndex, pw: document.getElementById('pw').value, same: document.getElementById('same').value,
      }));
      const d = JSON.stringify(s);
      check(eng, 'a page with a script reloads on its save (control)', s.reloaded, d);
      check(eng, 'the scroll comes back', Math.abs(s.y - y) < 3, `${y} -> ${s.y}`);
      check(eng, 'a scrolled box comes back', s.box === 300, d);
      check(eng, 'an opened <details> is open again', s.open, d);
      check(eng, 'typed words come back (a field, a textarea)', s.input === 'typed' && s.area === 'area', d);
      check(eng, 'a tick and a choice come back', s.tick && s.sel === 2, d);
      check(eng, 'a password is not kept', s.pw === '', d);
      check(eng, 'a field you left alone follows the file', s.same === 'from the file two', d);
      check(eng, 'nothing is left in sessionStorage', (await pg.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('lab-scroll:')).length)) === 0);
      await pg.close();

      // A thread open when the reload comes (the "!" taken with it open) is back beside its pin from its first frame:
      // it used to be placed from the page's corner, its pin not being in the layer yet, and sat there for 3 s or more.
      await post('/index', 'target', 'h2');
      const th = await open('/');
      const inRoot = (fn) => th.evaluate((src) => {
        const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.more'))?.shadowRoot;
        return r ? new Function('r', `return (${src})(r)`)(r) : null;
      }, fn.toString());
      const box = (sel) => inRoot(new Function('r', `const b = r.querySelector('${sel}')?.getBoundingClientRect(); return b ? { x: Math.round(b.x), y: Math.round(b.y), w: b.width } : null;`));
      await th.evaluate(() => { document.getElementById('target').scrollIntoView(); scrollBy(0, -200); });
      await th.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.pin')), null, { timeout: 5000 }).catch(() => {});
      await sleep(600);
      const pin = await box('.pin');
      await th.mouse.click(pin.x + 10, pin.y + 10);
      await sleep(1800);
      const before = await box('.card');
      save('index.html', page('three'));
      await sleep(1500);
      const upd = await box('.has-upd');
      check(eng, 'with a thread open the reload waits, with its "!" (control)', Boolean(before && upd && (await th.evaluate(() => window.__kept === 1))), JSON.stringify({ before, upd }));
      if (upd) await th.mouse.click(upd.x + 8, upd.y + 8);
      await th.waitForFunction(() => !window.__kept && [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.card')), null, { timeout: 8000 }).catch(() => {});
      await sleep(500); // well inside the 3 s it used to take
      const after = await box('.card');
      const pinAfter = await box('.pin');
      check(eng, 'after the reload the open thread is beside its pin, where it was', Boolean(before && after && Math.abs(after.x - before.x) < 3 && Math.abs(after.y - before.y) < 3), JSON.stringify({ before, after, pin, pinAfter }));
      await th.close();

      // A page that is short when it loads and builds itself 700 ms later.
      const late = await open('/late');
      await sleep(900);
      await late.evaluate(() => scrollTo(0, 3000));
      await sleep(1800);
      save('app.js', app + '\n// saved');
      await late.waitForFunction(() => !window.__kept, null, { timeout: 8000 }).catch(() => {});
      await sleep(2000);
      const ly = await late.evaluate(() => Math.round(scrollY));
      check(eng, 'a page built after it loads gets its scroll back', Math.abs(ly - 3000) < 3, `3000 -> ${ly}`);
      // #428: its file saved mid-drawing, the page waits for the drawing to be sent before it reloads (it lost the strokes).
      const dh = await open('/drawhold');
      await dh.keyboard.down('d');
      await dh.mouse.move(200, 200);
      await dh.mouse.down();
      for (let i = 1; i <= 10; i++) await dh.mouse.move(200 + i * 20, 200 + i * 4);
      save('drawhold.html', drawPage('two'));
      await sleep(3200); // past the 1.5 s a touch holds a reload anyway
      const mid = await dh.evaluate(() => window.__kept === 1);
      await dh.mouse.up();
      await dh.keyboard.up('d');
      await dh.waitForFunction(() => !window.__kept, null, { timeout: 8000 }).catch(() => {});
      const inks = (await (await fetch(B + '/_lab/api/comments?page=/drawhold')).json()).comments.filter((c) => c.anchor?.ink);
      check(eng, 'a save mid-drawing waits: the page reloads after the drawing is sent, and the drawing is saved', mid && (await dh.title()) === 'two' && inks.length === 1, JSON.stringify({ mid, title: await dh.title(), inks: inks.length }));
      await dh.close();

      // #428: a burst too big to list (a branch switch: 60 files at once), none of them this page's: a page with no scripts
      // of its own catches up in place instead of reloading. (Saves missed while away take the same path.)
      const pl = await open('/plain');
      // Patched in place first: the widget fetched the page and the tab icon itself, which are not the page's own asks.
      save('plain.html', `<!doctype html><meta charset="utf-8"><title>p</title><h1>Plain, saved</h1>${lines(20)}`);
      await pl.waitForFunction(() => document.querySelector('h1').textContent === 'Plain, saved', null, { timeout: 5000 }).catch(() => {});
      for (let i = 0; i < 60; i++) save(`burst-${i}.md`, `# ${i}`);
      await sleep(4000);
      check(eng, 'a burst too big to list: a page with no scripts of its own is not reloaded, after a patch fetched it', await pl.evaluate(() => window.__kept === 1 && document.querySelector('h1').textContent === 'Plain, saved' && performance.getEntriesByType('resource').some((e) => e.initiatorType === 'fetch' && new URL(e.name).pathname === '/plain')));
      await pl.close();
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  await L.stop();
  fs.rmSync(L.dir, { recursive: true, force: true, maxRetries: 5 });
}
finish();
