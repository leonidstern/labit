// Links in a pin's message in real browsers (WebKit and Chrome's engine): an address of this lab written as localhost
// opens on the origin the reader is on (a phone on the wifi), a link to this same page's #section is a shortcut that
// scrolls there without a reload, a #section the page doesn't have stays plain words, and other addresses stay as written.
// Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/links.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
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
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'labit-links-'));
const PORT = claimPort(10300, 30);
const B = `http://localhost:${PORT}`;
const R = `http://127.0.0.1:${PORT}`; // the reader's address: another name for the same lab
fs.writeFileSync(path.join(DIR, 'links.html'), '<!doctype html><meta charset="utf-8"><title>Links</title><style>body{margin:30px;font:18px/1.6 serif}.gap{height:2400px}</style><h1 id="t">Links</h1><p class="blurb">Top words</p><div class="gap"></div><h2 id="sec2">Second section</h2><p>Down here</p><div class="gap"></div>');
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
const check = (eng, name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${eng.padEnd(8)} ${name}${detail && !ok ? ` (${detail})` : ''}`);
};
const keys = () => JSON.parse(fs.readFileSync(path.join(DIR, '.lab/server.json'), 'utf8'));
const asAgent = (page, body) => fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-admin': keys().agent, 'x-lab-agent': '1' }, body: JSON.stringify({ page, name: 'Claude', ...body }) }).then((r) => r.json());

const TEXT = `Design is on ${B}/links#sec2 and in #sec2 too, more at ${B}/other?x=1#a, ${B}/links#ghost, #nothere, ${B.replace(PORT, '9')}/z and javascript:alert(1). Without http too: localhost:${PORT}/bare-page/, 127.0.0.1:${PORT}/two. and localhost:99/far, not mylocalhost:${PORT}/no.`;

try {
  await asAgent('/links', { text: TEXT, anchor: { kind: 'element', selector: '.blurb', x: 0.5, y: 0.5, element: '<p class="blurb">' } });
  for (const eng of (process.env.ENGINES || 'webkit,chromium').split(',')) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await ctx.addInitScript(() => {
        localStorage.setItem('lab-name', 'leo');
        localStorage.setItem('lab-on', '1');
      });
      const p = await ctx.newPage();
      await p.goto(R + '/links');
      await sleep(1800);
      const sh = (fn) => p.evaluate((f) => new Function('r', f)([...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim, button.pin, .bar')).shadowRoot), fn.toString().replace(/^[^{]*{|}$/g, ''));
      await p.evaluate(() => { window.__same = 1; });
      await sh(() => { r.querySelector('button.pin').click(); });
      await sleep(700);
      const links = await sh(() => { return [...r.querySelectorAll('.msg a.link')].map((a) => ({ text: a.textContent, href: a.getAttribute('href'), target: a.target, rel: a.rel })); });
      const text = await sh(() => { return r.querySelector('.msg')?.textContent || ''; });
      const by = (t) => links.find((l) => l.text === t);
      check(eng, 'an address of this lab written as localhost opens on the reader\'s origin, path query and hash kept', by(`${R}/other?x=1#a`)?.href === `${R}/other?x=1#a` && by(`${R}/other?x=1#a`).target === '_blank' && /noopener/.test(by(`${R}/other?x=1#a`).rel), JSON.stringify(links));
      check(eng, 'an address of another port stays as written', links.some((l) => l.href === `http://localhost:9/z`), JSON.stringify(links));
      check(eng, 'the same page with a #section, and a bare #section, are shortcuts: no address, no new tab', links.filter((l) => l.href === '#sec2' && l.text === '#sec2' && !l.target).length === 2, JSON.stringify(links));
      check(eng, 'a #section the page does not have is plain words, written as the agent did', !links.some((l) => /ghost|nothere/.test(l.text)) && text.includes('#nothere') && text.includes(`${B}/links#ghost`), text);
      check(eng, 'a lab address written without http:// is a link too, on the reader\'s origin, a trailing full stop left out', by(`${R}/bare-page/`)?.target === '_blank' && by(`${R}/two`)?.href === `${R}/two`, JSON.stringify(links));
      check(eng, 'one without http:// on another port links as written, with http://', links.some((l) => l.text === 'localhost:99/far' && l.href === 'http://localhost:99/far'), JSON.stringify(links));
      check(eng, 'a word that only ends in localhost is not a link', !links.some((l) => /\/no$/.test(l.href)) && text.includes(`mylocalhost:${PORT}/no`), JSON.stringify(links));
      check(eng, 'javascript: is never a link', !links.some((l) => /^javascript/i.test(l.href)) && text.includes('javascript:alert(1)'), JSON.stringify(links));
      const before = await p.evaluate(() => scrollY);
      await sh(() => { r.querySelector('.msg a.link[href="#sec2"]').click(); });
      await sleep(1500);
      const after = await p.evaluate(() => ({ y: scrollY, top: document.getElementById('sec2').getBoundingClientRect().top, same: window.__same, url: location.href }));
      check(eng, 'a shortcut scrolls the page to the section, without a reload or a new address', before < 100 && after.top > 0 && after.top < 400 && after.same === 1 && after.url === `${R}/links`, JSON.stringify({ before, ...after }));
      await p.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
process.exit(failed ? 1 : 0);
