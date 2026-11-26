// An agent's own pins (labit pin) in real browsers (WebKit and Chrome's engine): a pin made from a bare selector learns
// what a person's pin carries and is found again after the page is edited; a pin that asks shows its choices and takes
// the pick; "Do it" hands the pin back to the agent. Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/agentpins.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
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
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'labit-agentpins-'));
const PORT = claimPort(8340, 30);
const B = `http://localhost:${PORT}`;
const PAGE = (extra = '') => `<!doctype html><meta charset="utf-8"><title>Plans</title><style>body{margin:30px;font:18px/1.6 serif}p{margin:24px 0}</style>${extra}<h1 id="t">Pricing</h1><section id="plans"><h2>Plans</h2><p class="blurb">Pick a plan that fits your team</p></section><p class="foot">Footer words</p>`;
for (const f of ['fill', 'ask', 'doit']) fs.writeFileSync(path.join(DIR, `${f}.html`), PAGE());
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const env = { ...process.env, PORT: '', XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'labit-cfg-')), LABIT_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'labit-home-')), LABIT_NO_UPDATE_CHECK: '1', LABIT_EXIT_WITH_PARENT: '1' };
const server = spawn(process.execPath, [LAB, '--new', '--no-open'], { cwd: DIR, env });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 80; i++) {
  try {
    await fetch(B + '/');
    break;
  } catch {
    await sleep(100);
  }
}
let failed = 0;
// `labit pin …` as the agent runs it: its words.
const pinNow = (...args) => new Promise((done) => {
  let out = '';
  const c = spawn(process.execPath, [LAB, 'pin', ...args], { cwd: DIR, env: { ...env, CLAUDE_CODE_SESSION_ID: 'agentpins-1' } });
  c.stdout.on('data', (d) => (out += d));
  c.stderr.on('data', (d) => (out += d));
  c.on('close', () => done(out));
});
const check = (eng, name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${eng.padEnd(8)} ${name}${detail ? ` (${detail})` : ''}`);
};
const keys = () => JSON.parse(fs.readFileSync(path.join(DIR, '.lab/server.json'), 'utf8'));
const asAgent = (page, body) => fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-admin': keys().agent, 'x-lab-agent': '1' }, body: JSON.stringify({ page, name: 'Claude', ...body }) }).then((r) => r.json());
const list = async (page) => (await (await fetch(`${B}/_lab/api/comments?page=${page}`)).json()).comments;
const wipe = async (page) => {
  for (const c of (await list(page)).filter((x) => !x.parent)) await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-admin': keys().token }, body: JSON.stringify({ page, action: 'delete', id: c.id }) });
};
// A bare agent pin, as an older agent or a dev-server lab leaves it: a selector and a spot, nothing about the element.
const bare = (page, text, extra = {}) => asAgent(page, { text, anchor: { kind: 'element', selector: '.blurb', x: 0.5, y: 0.5, ...extra } }).then((r) => r.comment);

try {
  for (const eng of (process.env.ENGINES || 'webkit,chromium').split(',')) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await ctx.addInitScript(() => {
        localStorage.setItem('lab-name', 'leo');
        localStorage.setItem('lab-on', '1');
      });
      const open = async (page) => {
        const p = await ctx.newPage();
        await p.goto(B + page);
        await sleep(1800);
        const sh = (fn, arg) => p.evaluate(([f, a]) => new Function('r', 'a', f)([...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim, button.pin, .bar')).shadowRoot, a), [fn.toString().replace(/^[^{]*{|}$/g, ''), arg]);
        return { p, sh };
      };

      // 3: filled in once, then found again after an edit that puts another .blurb in front of it.
      await wipe('/fill');
      const pin = await bare('/fill', 'wording?');
      let { p, sh } = await open('/fill');
      let c;
      for (let i = 0; i < 30 && !c?.anchor.element; i++) { await sleep(150); c = (await list('/fill')).find((x) => x.id === pin.id); }
      check(eng, 'an agent pin drawn from a bare selector is filled in: tag, words, heading, box', c.anchor.element === '<p class="blurb">' && c.anchor.text === 'Pick a plan that fits your team' && c.anchor.section === 'Plans' && c.anchor.inside === '#plans', JSON.stringify(c.anchor));
      check(eng, 'filling in is no move', !c.movedAt);
      await p.close();
      // The agent adds a new section above, with a .blurb of its own: the old selector now leads to the wrong paragraph.
      fs.writeFileSync(path.join(DIR, 'fill.html'), PAGE().replace('<section id="plans">', '<section id="new"><h2>New</h2><p class="blurb">Something else entirely</p></section><section id="plans">'));
      ({ p, sh } = await open('/fill'));
      const where = await p.evaluate(() => { const q = [...document.querySelectorAll('.blurb')].find((n) => /Pick a plan/.test(n.textContent)).getBoundingClientRect(); return { top: q.top + scrollY, bottom: q.bottom + scrollY }; });
      const pinAt = await sh(() => { const b = r.querySelector('button.pin'); if (!b) return null; const q = b.getBoundingClientRect(); return { y: q.top + q.height / 2 + scrollY, moved: b.classList.contains('moved') || b.getAttribute('data-moved') !== null }; });
      check(eng, 'after the page is edited the pin is still on its own paragraph', pinAt && pinAt.y > where.top - 30 && pinAt.y < where.bottom + 30, JSON.stringify([pinAt, where]));
      await p.close();

      // The browser is the check: a bare pin whose selector matches nothing is marked on the server; `labit pin` waits for
      // that answer (up to 3 s) and names it, and says nothing for one that matches (it is filled in instead).
      await wipe('/fill');
      ({ p, sh } = await open('/fill'));
      const gone = await bare('/fill', 'where?', { selector: '#nope' });
      let marked;
      for (let i = 0; i < 40 && !marked?.unmatched; i++) { await sleep(150); marked = (await list('/fill')).find((x) => x.id === gone.id); }
      check(eng, 'a bare agent pin whose selector matches nothing is marked unmatched', marked?.unmatched === true && !marked.anchor.element, JSON.stringify(marked?.unmatched));
      const said = await pinNow('#nope', 'asked from the command line', '--page', '/fill');
      check(eng, 'labit pin names a selector the browser found nothing for', /pin \w+ matched nothing on \/fill: #nope/.test(said), said.trim().slice(-120));
      const fine = await pinNow('.blurb', 'this one is there', '--page', '/fill');
      const good = (await list('/fill')).find((x) => fine.includes(x.id));
      check(eng, 'a selector that matches says nothing, and is filled in', !/Note:|matched nothing/.test(fine) && good?.anchor.element === '<p class="blurb">', fine.trim().slice(-120));
      await p.close();

      // 4: a pin that asks shows its choices; a tap sends the pick under it.
      await wipe('/ask');
      const q = (await asAgent('/ask', { text: 'Which heading?', intent: 'question', choices: ['Plans', 'Pricing'], recommend: 1, anchor: { kind: 'element', selector: '#t', x: 0.5, y: 0.5, element: '<h1 id="t">' } })).comment;
      ({ p, sh } = await open('/ask'));
      const ring = await sh(() => { return r.querySelectorAll('button.pin i.ring.asks').length; });
      check(eng, 'a pin that asks wears the asking ring', ring === 1, String(ring));
      await sh(() => { r.querySelector('button.pin').click(); });
      await sleep(700);
      const rows = await sh(() => { return [...r.querySelectorAll('.choice')].map((x) => x.textContent); });
      check(eng, 'its card shows the choices as rows', rows.length === 2 && rows[0].startsWith('Plans'), JSON.stringify(rows));
      await sh(() => { r.querySelectorAll('.choice')[0].click(); }); // a tap answers at once
      let pick;
      for (let i = 0; i < 60 && !pick; i++) { await sleep(150); pick = (await list('/ask')).find((x) => x.picked); }
      check(eng, 'a tap sends the pick under the pin itself', pick?.parent === q.id && pick.picked.of === q.id && pick.picked.n === 0 && /^Picked A: Plans/.test(pick.text), JSON.stringify(pick));
      await sleep(500);
      const quoted = await sh(() => { return r.querySelector('.msg .quote')?.textContent || ''; });
      check(eng, 'the pick shows the question it answers, the pin itself, as a quote', /Which heading\?/.test(quoted), quoted);
      await p.close();

      // 5: Do it.
      await wipe('/doit');
      const d = await bare('/doit', 'move the plans up?');
      ({ p, sh } = await open('/doit'));
      await sh(() => { r.querySelector('button.pin').click(); });
      await sleep(700);
      const has = await sh(() => { return [...r.querySelectorAll('.acts .btn')].map((x) => x.textContent); });
      check(eng, 'an agent pin\'s card has Do it beside resolve', has.includes('Do it') && has.includes('resolve'), JSON.stringify(has));
      await sh(() => { [...r.querySelectorAll('.acts .btn')].find((x) => x.textContent === 'Do it').click(); });
      let reply;
      for (let i = 0; i < 30 && !reply; i++) { await sleep(150); reply = (await list('/doit')).find((x) => x.doit); }
      await sleep(400);
      const after = await sh(() => { const b = [...r.querySelectorAll('.acts .btn')].find((x) => /^(Do it|told)$/.test(x.textContent)); return b ? [b.textContent, b.disabled] : null; });
      check(eng, 'once told, the button stays down until the agent answers', after && after[0] === 'told' && after[1] === true, JSON.stringify(after));
      check(eng, 'Do it sends a reply marked doit under the pin', reply?.parent === d.id && reply.text === 'Do it' && !reply.session, JSON.stringify(reply));
      await p.close();
      await ctx.close();
      fs.writeFileSync(path.join(DIR, 'fill.html'), PAGE());
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
