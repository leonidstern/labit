// labit and colabit never share a page (lib/colabit.ts): a lab takes colabit's script tag out of every page it serves,
// a folder's page and a dev server's page alike, and keeps its own widget. Pins stay in the lab's store; nothing is read
// from or written to a colabit. (colabit's own check, off where a lab's widget is, is in test/browser/colabitoff.mjs: it
// runs in a browser.)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { site, rm, spawnLab, up } from './harness.mjs';
import { stripTags } from '../lib/colabit.ts';

const CO = '<script src="https://lab.example.com/_lab/co.js" data-site="lab" defer></script>';
const PAGE = `<!doctype html><html><head><title>t</title></head><body><h1>Hi</h1>${CO}</body></html>`;
const widgets = (t) => (t.match(/<script\b[^>]*\/_lab\/comments\.js/g) || []).length;
const colabits = (t) => (t.match(/\/_lab\/co\.js/g) || []).length;

test('colabit\'s tag and the lab\'s own are found however they are written, and nothing else goes', () => {
  for (const tag of [
    CO,
    "<script defer src='/_lab/co.js'></script>",
    '<script src="https://lab.example.com/_lab/co.js?v=3" data-site="lab"></script>',
    '<SCRIPT src="//cdn.example.com/x/_lab/co.js#a" defer>\n</SCRIPT>',
    '<script src="/_lab/comments.js" defer></script>',
    '<script src="/_lab/comments.js?v=3" defer></script>',
  ]) assert.equal(stripTags(`<p>a</p>${tag}<p>b</p>`), '<p>a</p><p>b</p>', tag);
  for (const keep of ['<script src="/app/co.js"></script>', '<script src="/_lab/co.json.js"></script>', '<p>/_lab/co.js in words</p>']) {
    assert.equal(stripTags(keep), keep, keep);
  }
});

const { DIR, PORT, B } = site('colabit', 11100, 90);
fs.writeFileSync(path.join(DIR, 'co.html'), PAGE);
const dev = http.createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE));
await new Promise((r) => dev.listen(0, '127.0.0.1', r));
const { DIR: DIR2, PORT: PORT2, B: B2 } = site('colabit-dev', 11200, 90);
const labs = [spawnLab(DIR, PORT), spawnLab(DIR2, PORT2, { args: ['--proxy', String(dev.address().port)] })];
after(() => {
  labs.forEach((l) => l.kill());
  dev.close();
  rm([DIR, DIR2]);
});
const page = async (base, p) => (await fetch(base + p, { headers: { accept: 'text/html' } })).text();

test('a folder\'s page made for a colabit gets the lab\'s widget only', async () => {
  await up(B + '/');
  const t = await page(B, '/co');
  assert.equal(colabits(t), 0, 'no colabit tag');
  assert.equal(widgets(t), 1, 'one lab widget');
});

test('a dev server\'s page made for a colabit gets the lab\'s widget only; a script\'s fetch is left as it is', async () => {
  await up(B2 + '/_lab/state');
  const t = await page(B2, '/co');
  assert.equal(colabits(t), 0, 'no colabit tag');
  assert.equal(widgets(t), 1, 'one lab widget');
  const fetched = await (await fetch(B2 + '/co', { headers: { accept: '*/*', 'sec-fetch-dest': 'empty' } })).text();
  assert.equal(fetched, PAGE);
});
