// The lab in front of a dev server (--proxy): a page in another charset, a redirect to the dev server's own address comes back as the lab's, and
// a person who leaves (a closed tab, a cancelled event stream) ends the dev server's side of the request too; no icon at
// /favicon.ico (a 404, or the app's page for any path) is labit's mark, never a 404 in the console (torture bug 20).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { site, tmp, rm, spawnLab, sleep } from './harness.mjs';

const { DIR, PORT } = site('proxy', 6400, 90);

let icon = false; // whether the dev server has a favicon.ico
let closed = 0; // event streams the dev server saw end
const dev = http.createServer((req, res) => {
  const here = `http://localhost:${dev.address().port}`;
  if (req.url === '/old') return void res.writeHead(302, { location: here + '/new?x=1' }).end();
  if (req.url === '/ip') return void res.writeHead(302, { location: `http://127.0.0.1:${dev.address().port}/new#h` }).end();
  if (req.url === '/six') return void res.writeHead(302, { location: `http://[::1]:${dev.address().port}/new` }).end();
  if (req.url === '/away') return void res.writeHead(302, { location: 'https://example.com/' }).end();
  if (req.url === '/near') return void res.writeHead(302, { location: here + '0/x' }).end(); // another port, not this server
  if (req.url === '/latin') return void res.writeHead(200, { 'content-type': 'text/html; charset=iso-8859-1' }).end(Buffer.from('<!doctype html><html><head><title>t</title></head><body>caf\xe9</body></html>', 'latin1'));
  if (req.url === '/nohead') return void res.writeHead(200, { 'content-type': 'text/html' }).end('\n<!-- c -->\n<!DOCTYPE html>\n<html><body><p>no head</p></body></html>');
  if (req.url === '/frag') return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<ul><li>one</li><li>two</li></ul><p>hi</p>');
  if (req.url === '/whole') return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><html><head><title>w</title></head><body><p>whole</p></body></html>');
  if (req.url === '/jar') return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'app=1; Path=/' }).end(`<!doctype html><html><head><title>j</title></head><body><p>${req.headers.cookie || ''}</p></body></html>`);
  if (req.url === '/favicon.ico') return void (icon ? res.writeHead(200, { 'content-type': 'image/x-icon' }).end('ico') : res.writeHead(404).end('no'));
  if (req.url === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: 1\n\n');
    return void req.on('close', () => closed++);
  }
  res.end('ok');
});
await new Promise((r) => dev.listen(0, '127.0.0.1', r));
const lab = spawnLab(DIR, PORT, { args: ['--proxy', String(dev.address().port)], env: { ...process.env, LABIT_HOME: tmp('home'), LABIT_NO_UPDATE_CHECK: '1' } });
after(() => {
  lab.kill();
  dev.closeAllConnections();
  dev.close();
  rm([DIR]);
});
const ask = (p) =>
  new Promise((done, fail) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p, headers: { host: `localhost:${PORT}` } }, (res) => done({ req, res }));
    req.on('error', fail);
  });
const up = async () => {
  for (let i = 0; i < 80; i++) {
    const r = await ask('/').catch(() => null);
    if (r) return void r.res.resume();
    await sleep(100);
  }
  throw new Error('the lab did not start');
};

test('a redirect to the dev server\'s own address stays on the lab; one to somewhere else is left alone', async () => {
  await up();
  const at = async (p) => {
    const { res } = await ask(p);
    res.resume();
    return res.headers.location;
  };
  assert.equal(await at('/old'), `http://localhost:${PORT}/new?x=1`);
  assert.equal(await at('/ip'), `http://localhost:${PORT}/new#h`, 'the same server by its number');
  assert.equal(await at('/six'), `http://localhost:${PORT}/new`);
  assert.equal(await at('/away'), 'https://example.com/');
  assert.equal(await at('/near'), `http://localhost:${dev.address().port}0/x`, 'an address that only starts the same is not the dev server');
});

test('a page the dev server sends as iso-8859-1 is read as such and goes on as UTF-8', async () => {
  await up();
  const r = await fetch(`http://localhost:${PORT}/latin`, { headers: { accept: 'text/html' } });
  assert.equal(r.headers.get('content-type'), 'text/html; charset=utf-8');
  const text = await r.text();
  assert.ok(text.includes('caf\u00e9'), 'the é is an é');
  assert.ok(!text.includes('\ufffd'), 'no replacement marks');
});

test('a page with a comment before its doctype and no <head> keeps its doctype whole', async () => {
  await up();
  const text = await (await fetch(`http://localhost:${PORT}/nohead`, { headers: { accept: 'text/html' } })).text();
  assert.match(text, /<!DOCTYPE html><script>[^]*?<\/script>\n<html>/, 'the doctype is in one piece, the reload-holder after it');
});

test('a browser is given its id for the page\'s error reports beside the app\'s own cookies, and the app never sees it', async () => {
  await up();
  const first = await fetch(`http://localhost:${PORT}/jar`, { headers: { 'sec-fetch-dest': 'document', accept: 'text/html', cookie: 'app=0' } });
  const jar = first.headers.getSetCookie();
  assert.ok(jar.some((c) => /^lab_dev_\d+=[0-9a-f]{16};/.test(c)), 'the lab\'s id');
  assert.ok(jar.includes('app=1; Path=/'), 'and the app\'s own cookie');
  const back = await (await fetch(`http://localhost:${PORT}/jar`, { headers: { 'sec-fetch-dest': 'document', accept: 'text/html', cookie: `app=2; ${jar.find((c) => c.startsWith('lab_dev_')).split(';')[0]}; other=3` } })).text();
  assert.match(back, /<p>app=2; other=3<\/p>/, 'the dev server got its own cookies only');
});

test('a person who leaves an event stream ends it at the dev server too', async () => {
  await up();
  const { req, res } = await ask('/events');
  await new Promise((r) => res.once('data', r));
  assert.equal(closed, 0);
  req.destroy();
  for (let i = 0; i < 40 && !closed; i++) await sleep(50);
  assert.equal(closed, 1, 'the dev server saw its stream close');
});

// What a page load looks like to the lab, and what a script's fetch looks like: only the first gets the widget (its tag
// carries the admin key; an HTML fragment an app fetches is its data).
const getAs = (p, headers) =>
  new Promise((done, fail) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p, headers: { host: `localhost:${PORT}`, ...headers } }, (res) => {
      const parts = [];
      res.on('data', (c) => parts.push(c));
      res.on('end', () => done({ res, text: Buffer.concat(parts).toString('utf8') }));
    }).on('error', fail);
  });
const FRAG = '<ul><li>one</li><li>two</li></ul><p>hi</p>';
const hasWidget = (t) => /\/_lab\/comments\.js/.test(t) || /__lab=\{writing/.test(t);

test('HTML a script fetches is left as it is: no widget, no reload holder, no admin key', async () => {
  await up();
  const sent = [
    { 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'same-origin', accept: '*/*' }, // fetch() and XHR
    { 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', accept: 'text/html, application/xhtml+xml' }, // a router asking for HTML (Turbo, htmx)
    { 'sec-fetch-dest': 'empty', accept: 'text/html' },
    { accept: 'text/html', 'x-requested-with': 'XMLHttpRequest' }, // a browser with no Sec-Fetch-*
    { accept: 'application/json, */*' },
    {},
  ];
  for (const h of sent) {
    const { text } = await getAs('/frag', h);
    assert.equal(text, FRAG, `the fragment as the dev server sent it for ${JSON.stringify(h)}`);
    assert.ok(!/data-admin/.test(text), 'no admin key in the app\'s data');
  }
  // The widget's own fetch of the page (live update) marks itself with X-Lab: it gets the page as the lab sends it.
  const own = await getAs('/frag', { 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'same-origin', accept: 'text/html', 'x-lab': '1' });
  assert.equal((own.text.match(/<script src="\/_lab\/comments\.js"/g) || []).length, 1, 'the widget\'s own fetch gets the widget tag');
  // A whole page fetched by a client router (Astro's) gets no second widget either: the one on the page stays.
  const whole = await getAs('/whole', { 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', accept: '*/*' });
  assert.ok(!hasWidget(whole.text), 'a whole page fetched by a script is the dev server\'s bytes');
  assert.match(whole.text, /^<!doctype html>/);
});

test('a page load gets the widget, with or without Sec-Fetch headers, in a frame too', async () => {
  await up();
  const loads = [
    { 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'none', accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
    { 'sec-fetch-dest': 'document', accept: '*/*' },
    { 'sec-fetch-dest': 'iframe', 'sec-fetch-mode': 'navigate', accept: 'text/html' },
    { 'sec-purpose': 'prefetch', 'sec-fetch-dest': 'empty', accept: 'text/html' }, // a prefetch is what the next page load shows
    { accept: 'text/html' }, // curl -H, an old browser, a test
  ];
  for (const path of ['/whole', '/frag']) {
    for (const h of loads) {
      const { text } = await getAs(path, h);
      assert.equal((text.match(/<script src="\/_lab\/comments\.js"/g) || []).length, 1, `${path} for ${JSON.stringify(h)} holds one widget tag`);
      assert.match(text, /__lab=\{writing/);
    }
  }
});

test('no favicon.ico at the dev server: labit\'s mark, not a 404; the app\'s own icon passes through', async () => {
  await up();
  const get = async (method) => {
    const r = await fetch(`http://localhost:${PORT}/favicon.ico`, { method, redirect: 'manual' });
    return [r.status, r.headers.get('location') || r.headers.get('content-type')];
  };
  for (const method of ['HEAD', 'GET']) assert.deepEqual(await get(method), [302, '/_lab/favicon.svg'], `${method}: a 404 is redirected`);
  icon = true;
  for (const method of ['HEAD', 'GET']) assert.deepEqual(await get(method), [200, 'image/x-icon'], `${method}: the app's icon is served`);
});

// The dev server's live-reload socket: frames sent in the same write as the 101 (they reach the lab as the upgrade's head), and a
// burst right after, all arrive through the lab, and in order (torture: a message "lost" through the proxy was a harness race).
test('a websocket through the lab gets every frame the dev server sends, those written with the 101 and a burst after it', async () => {
  await up();
  const frame = (t) => Buffer.concat([Buffer.from([0x81, t.length]), Buffer.from(t)]);
  const sockets = new Set(); // upgraded sockets are no longer the http server's: it would wait for them when it closes
  dev.on('upgrade', (req, socket) => {
    sockets.add(socket);
    socket.write(Buffer.concat([Buffer.from('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: x\r\n\r\n'), frame('connected'), frame('full-reload')]));
    for (let i = 0; i < 50; i++) socket.write(frame(`m${i}`));
    socket.on('error', () => {});
  });
  const text = await new Promise((done, fail) => {
    let got = Buffer.alloc(0);
    const s = net.connect(PORT, '127.0.0.1', () => s.write(`GET /?token=t HTTP/1.1\r\nHost: localhost:${PORT}\r\nOrigin: http://localhost:${PORT}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`));
    s.on('data', (d) => {
      got = Buffer.concat([got, d]);
      const at = got.indexOf('\r\n\r\n');
      if (at >= 0 && got.subarray(at + 4).toString('latin1').includes('m49')) (s.destroy(), done(got.toString('latin1')));
    });
    s.on('error', fail);
    setTimeout(() => (s.destroy(), done(got.toString('latin1'))), 4000);
  });
  for (const s of sockets) s.destroy();
  assert.match(text, /^HTTP\/1\.1 101 /);
  const body = text.slice(text.indexOf('\r\n\r\n') + 4).replace(/[\x00-\x1f\x80-\xff]/g, ' ');
  assert.deepEqual(body.trim().split(/\s+/), ['connected', 'full-reload', ...Array.from({ length: 50 }, (_, i) => `m${i}`)]);
});

// Last: it stops the dev server for good.
test('a page asked for while the dev server restarts waits for it instead of failing', async () => {
  await up();
  const port = dev.address().port;
  dev.closeAllConnections();
  await new Promise((r) => dev.close(r));
  const got = new Promise((done, fail) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/back', headers: { host: `localhost:${PORT}`, accept: 'text/html' } }, (res) => {
      let t = '';
      res.on('data', (c) => (t += c));
      res.on('end', () => done({ status: res.statusCode, t }));
    });
    req.on('error', fail);
  });
  await sleep(800);
  await new Promise((r) => dev.listen(port, '127.0.0.1', r));
  const { status } = await got;
  assert.equal(status, 200, 'the page came once the server was back');
  // Not forever: a server that stays down answers 502 after about 5 s.
  dev.closeAllConnections();
  await new Promise((r) => dev.close(r));
  const t0 = Date.now();
  const status2 = await new Promise((done, fail) => http.get({ host: '127.0.0.1', port: PORT, path: '/gone', headers: { host: `localhost:${PORT}`, accept: 'text/html' } }, (res) => (res.resume(), done(res.statusCode))).on('error', fail));
  assert.equal(status2, 502);
  assert.ok(Date.now() - t0 > 4000 && Date.now() - t0 < 8000, `${Date.now() - t0} ms`);
});
