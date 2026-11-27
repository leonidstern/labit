// Files the lab serves from the folder: the type a browser needs for them (a .wasm must be application/wasm to be
// compiled while it streams, a font or a PDF to be used at all), and only text types go compressed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { site, rm, spawnLab, stop, up } from './harness.mjs';

const { DIR, PORT, B } = site('mime', 10900, 20);
const big = Buffer.alloc(3000, 'a');
const FILES = { 'a.wasm': 'application/wasm', 'b.pdf': 'application/pdf', 'c.xml': 'application/xml', 'd.webmanifest': 'application/manifest+json', 'e.woff': 'font/woff', 'f.ttf': 'font/ttf', 'g.otf': 'font/otf', 'h.mp3': 'audio/mpeg', 'i.ico': 'image/x-icon' };
for (const name of Object.keys(FILES)) fs.writeFileSync(path.join(DIR, name), big);
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><title>t</title>');
const lab = spawnLab(DIR, PORT, { env: { ...process.env, LABIT_HOME: path.join(DIR, '.home'), LABIT_NO_UPDATE_CHECK: '1' } });
after(async () => {
  await stop(lab);
  rm([DIR]);
});

test('files get their own type, and only text ones go compressed', async () => {
  await up(B + '/');
  for (const [name, type] of Object.entries(FILES)) {
    const r = await fetch(`${B}/${name}`, { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(r.headers.get('content-type'), type, name);
    // fetch undoes the encoding itself, so the header says whether the lab compressed
    assert.equal(r.headers.get('content-encoding'), /xml|manifest/.test(type) ? 'gzip' : null, `${name} compressed or not`);
    await r.arrayBuffer();
  }
});
