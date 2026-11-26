// The page scripts as the npm package ships them: brotli-packed (public/_lab/<name>.js.br, scripts/build-widget.mjs). The
// lab sends the packed bytes as they are to a browser that takes brotli, unpacks them for one that doesn't, keeps the
// type, ETag and revalidation of a plain file, and a checkout (plain .js beside or without the .br) serves its own file.
// A package-shaped folder is made here from the server and a few made-up scripts. No browser.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { claimPort, spawnLab, stop, tmp, up } from './harness.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const labs = [];
after(() => labs.forEach((l) => l.kill()));

const SCRIPT = `${'console.log("a made-up page script");\n'.repeat(60)}`;
const PLAIN = Buffer.from(SCRIPT);
const PACKED = zlib.brotliCompressSync(PLAIN);

/** A folder shaped like the npm package (the server, its lib, package.json, public/_lab with `files`), and a lab run from it. */
const pack = async (files, name) => {
  const pkg = tmp(name);
  fs.cpSync(path.join(REPO, 'local.mjs'), path.join(pkg, 'local.mjs'));
  fs.cpSync(path.join(REPO, 'lib'), path.join(pkg, 'lib'), { recursive: true });
  fs.cpSync(path.join(REPO, 'package.json'), path.join(pkg, 'package.json'));
  fs.mkdirSync(path.join(pkg, 'public/_lab'), { recursive: true });
  for (const f of ['favicon.svg', 'lab.css.br']) fs.cpSync(path.join(REPO, 'public/_lab', f), path.join(pkg, 'public/_lab', f)); // the lab reads both as it starts (lab.css packed, as npm ships it)
  for (const [f, bytes] of Object.entries(files)) fs.writeFileSync(path.join(pkg, 'public/_lab', f), bytes);
  const dir = tmp(`${name}-site`);
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>t</title><h1>hi</h1>');
  const port = claimPort(11000, 100);
  const lab = spawn(process.execPath, [path.join(pkg, 'local.mjs'), '.', '--no-open', '--port', String(port)], { cwd: dir, env: { ...process.env, LABIT_HOME: tmp(`${name}-home`) } });
  labs.push(lab);
  await up(`http://localhost:${port}/`);
  return { pkg, port, dir, lab };
};
const get = (port, p, headers = {}, method = 'GET') =>
  new Promise((done, fail) => {
    http.request({ host: '127.0.0.1', port, path: p, method, agent: false, headers: { host: `localhost:${port}`, ...headers } }, (res) => {
      const parts = [];
      res.on('data', (d) => parts.push(d));
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(parts) }));
    }).on('error', fail).end();
  });

test('a packed script: brotli browsers get the packed bytes, others the unpacked script, same type and ETag rules', async () => {
  const { port } = await pack({ 'comments.js.br': PACKED, 'draw.js.br': PACKED }, 'packed');
  for (const f of ['comments.js', 'draw.js']) {
    const br = await get(port, `/_lab/${f}`, { 'accept-encoding': 'gzip, deflate, br' });
    assert.equal(br.status, 200);
    assert.equal(br.headers['content-encoding'], 'br');
    assert.equal(br.headers['content-type'], 'text/javascript');
    assert.equal(br.headers['cache-control'], 'no-cache');
    assert.equal(br.headers.vary, 'accept-encoding');
    assert.ok(br.bytes.equals(PACKED), 'the packed bytes go as they are');
    assert.equal(Number(br.headers['content-length']), PACKED.length);
    assert.ok(zlib.brotliDecompressSync(br.bytes).equals(PLAIN));

    const gz = await get(port, `/_lab/${f}`, { 'accept-encoding': 'gzip' });
    assert.equal(gz.headers['content-encoding'], 'gzip');
    assert.ok(zlib.gunzipSync(gz.bytes).equals(PLAIN));

    const none = await get(port, `/_lab/${f}`);
    assert.equal(none.status, 200);
    assert.equal(none.headers['content-encoding'], undefined);
    assert.equal(none.headers['content-type'], 'text/javascript');
    assert.ok(none.bytes.equals(PLAIN), 'a client that takes no compression gets the script unpacked');

    const etag = br.headers.etag;
    assert.match(etag, /^W\/"/);
    assert.equal(none.headers.etag, etag);
    const again = await get(port, `/_lab/${f}`, { 'accept-encoding': 'br', 'if-none-match': etag });
    assert.equal(again.status, 304);
    assert.equal(again.bytes.length, 0);
    const head = await get(port, `/_lab/${f}`, { 'accept-encoding': 'br' }, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.bytes.length, 0);
  }
  assert.equal((await get(port, '/_lab/boardview.js', { 'accept-encoding': 'br' })).status, 404, 'a script that is not there is still not there');
  assert.equal((await get(port, '/_lab/favicon.svg')).status, 200, 'the other files are served as before');
});

test('lab.css ships packed too: served unpacked or as brotli, as text/css (the lab started: it reads it for its own screens)', async () => {
  const { port } = await pack({}, 'packed-css');
  const css = zlib.brotliDecompressSync(fs.readFileSync(path.join(REPO, 'public/_lab/lab.css.br')));
  assert.ok(css.equals(fs.readFileSync(path.join(REPO, 'public/_lab/lab.css'))), 'the packed file is the built one');
  const none = await get(port, '/_lab/lab.css');
  assert.equal(none.status, 200);
  assert.equal(none.headers['content-type'], 'text/css');
  assert.ok(none.bytes.equals(css));
  const br = await get(port, '/_lab/lab.css', { 'accept-encoding': 'br' });
  assert.equal(br.headers['content-encoding'], 'br');
  assert.ok(zlib.brotliDecompressSync(br.bytes).equals(css));
});

test('the widget version follows the packed scripts', async () => {
  const { port, pkg } = await pack({ 'comments.js.br': PACKED, 'draw.js.br': PACKED }, 'packed-rev');
  const rev = async () => /data-widget="([^"]*)"/.exec(await (await fetch(`http://localhost:${port}/`)).text())?.[1];
  const first = await rev();
  assert.match(first, /^[0-9a-f]{10}$/);
  fs.writeFileSync(path.join(pkg, 'public/_lab/draw.js.br'), zlib.brotliCompressSync(Buffer.from(`${SCRIPT}//changed\n`)));
  for (let i = 0; i < 30 && (await rev()) === first; i++) await new Promise((r) => setTimeout(r, 100));
  assert.notEqual(await rev(), first, 'a changed part changes the version, so open pages reload');
});

test('a checkout keeps serving the plain built file', async () => {
  const OTHER = Buffer.from(`${SCRIPT}// plain\n`);
  const { port } = await pack({ 'comments.js': OTHER, 'comments.js.br': PACKED }, 'plain');
  const br = await get(port, '/_lab/comments.js', { 'accept-encoding': 'br' });
  assert.equal(br.headers['content-encoding'], 'br');
  assert.ok(zlib.brotliDecompressSync(br.bytes).equals(OTHER), 'the plain file wins over a .br beside it');
  const none = await get(port, '/_lab/comments.js');
  assert.ok(none.bytes.equals(OTHER));
  assert.equal(none.headers['content-type'], 'text/javascript');
});

test('the server in this checkout reads its own built script', async () => {
  // The repo (not a package folder): the built page script is plain here and served as such.
  const dir = tmp('checkout');
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>t</title>');
  const port = claimPort(11000, 100);
  const lab = spawnLab(dir, port, { env: { ...process.env, LABIT_HOME: tmp('checkout-home'), LABIT_NO_UPDATE_CHECK: '1' } });
  labs.push(lab);
  await up(`http://localhost:${port}/`);
  const script = await get(port, '/_lab/comments.js');
  assert.equal(script.status, 200);
  assert.equal(script.headers['content-encoding'], undefined);
  assert.ok(script.bytes.equals(fs.readFileSync(path.join(REPO, 'public/_lab/comments.js'))));
  await stop(lab);
});
