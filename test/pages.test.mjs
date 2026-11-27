// A page file in the folder as the lab sends it on: read in the charset it names and sent as UTF-8, and the lab's own
// additions (its icon, its script) put in the page's head, not in some other tag whose name starts the same. Files a page
// asked for and the lab did not have are told to the agent, in that page's text.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { seed } from '../lib/boardact.ts';
import http from 'node:http';
import { site, rm, spawnLab, stop, up } from './harness.mjs';

const { DIR, PORT, B } = site('pages', 10920, 20);
const page = (name, body) => fs.writeFileSync(path.join(DIR, name), body);
page('index.html', '<!doctype html><title>t</title>');
page('latin.html', Buffer.from('<!doctype html><html><head><meta charset="iso-8859-1"><title>caf\xe9</title></head><body><p>caf\xe9</p></body></html>', 'latin1'));
page('header.html', '<!doctype html><body><header class="x">H</header><p>x</p></body>');
page('utf8.html', '<!doctype html><html><head><title>café</title></head><body><p>café ☃</p></body></html>');
const lab = spawnLab(DIR, PORT, { env: { ...process.env, LABIT_HOME: path.join(DIR, '.home'), LABIT_NO_UPDATE_CHECK: '1' } });
after(async () => {
  await stop(lab);
  rm([DIR]);
});

test('a page saved as iso-8859-1 is read as such and sent as UTF-8', async () => {
  await up(B + '/');
  const r = await fetch(B + '/latin');
  assert.equal(r.headers.get('content-type'), 'text/html; charset=utf-8');
  const text = await r.text();
  assert.ok(text.includes('<p>café</p>'), 'the é is an é');
  assert.ok(!text.includes('�'), 'no replacement marks');
  assert.ok((await (await fetch(B + '/utf8')).text()).includes('café ☃'), 'a UTF-8 page is as it was');
});
test('a <header> is not the <head>: the icon goes to the top of the page', async () => {
  const text = await (await fetch(B + '/header')).text();
  assert.ok(text.includes('rel="icon"') && text.includes('<header'), 'the icon and the <header> are both there');
  assert.ok(text.indexOf('rel="icon"') < text.indexOf('<header'), 'the icon is before the <header>, not inside it');
  assert.ok(!/<header[^>]*>\s*<link/.test(text));
});

test('a board variant of such a page gets its <base> before the <header> too', () => {
  const out = seed('<!doctype html><body><header class="x">H</header></body>', 'a/p.html');
  assert.ok(out.includes('<base'), 'the <base> is there');
  assert.ok(out.indexOf('<base') < out.indexOf('<header'));
  assert.ok(seed('<html><head lang=en><title>t</title></head>', 'p.html').startsWith('<html><head lang=en><base'), 'a real <head> with attributes still is one');
});

// A GET with a Referer (fetch does not let a script choose it).
const from = (p, referer) =>
  new Promise((done, fail) => http.get({ host: '127.0.0.1', port: PORT, path: p, headers: { host: `localhost:${PORT}`, accept: 'text/html', ...(referer && { referer }) } }, (res) => (res.resume(), res.on('end', () => done(res.statusCode)))).on('error', fail));
const agent = async (page) => (await fetch(`${B}/_lab/agent${page}`)).text();

test('a file a page asked for and the lab does not have is told to the agent, on that page', async () => {
  assert.equal(await from('/img/x.png', `${B}/`), 404);
  assert.equal(await from('/img/x.png', `${B}/`), 404, 'asked twice, said once');
  assert.equal(await from('/img/y.png', 'http://example.com/index.html'), 404, 'a page of another site is none of this lab\'s');
  assert.equal(await from('/img/z.png'), 404, 'nor is a request from nowhere');
  assert.equal(await from('/_lab/nothing.js', `${B}/`), 404);
  const text = await agent('/index');
  assert.equal(text.match(/^Missing files: .*$/m)?.[0], 'Missing files: /img/x.png (on /index)');
  assert.ok(!/Missing files/.test(await agent('/utf8')), 'not on another page');
});

test('the lab keeps the last ten, and a file that has appeared is not said', async () => {
  for (let i = 0; i < 12; i++) await from(`/m${i}.png`, `${B}/utf8.html`);
  const said = (await agent('/utf8')).match(/^Missing files: (.*)$/m)[1].split(', ');
  assert.equal(said.length, 10);
  assert.ok(said[0].startsWith('/m2.png') && said[9].startsWith('/m11.png'), said.join());
  fs.writeFileSync(path.join(DIR, 'm11.png'), 'x');
  assert.ok(!(await agent('/utf8')).includes('/m11.png'));
});
