// Who may talk to a local lab, at the edges: Host values a rebinding page would send, Origin and Sec-Fetch-Site in every
// mix, localhost / 127.0.0.1 / [::1], no CORS for reads, other methods, the keys of the agent's and the owner's
// endpoints, the rate limit against a forged forwarded-for, JSON bodies that are not objects, and paths that can't be
// decoded. No browser.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LAB = fileURLToPath(new URL('../local.mjs', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (n) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `labit-edge-${n}-`)));
const freePort = () => new Promise((done) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)); }); });
const ENV = { ...process.env, LABIT_HOME: tmp('home'), LABIT_NO_UPDATE_CHECK: '1', LABIT_IDLE_MS: '0', LAB_SETTLE_MS: '100', LAB_COMMENTS_PER_HOUR: '100000', PORT: '' };
const labs = [];
const dirs = [];
const raw = (port, p, { method = 'GET', headers = {}, body, host, to = '127.0.0.1' } = {}) =>
  new Promise((done) => {
    const req = http.request({ host: to, port, path: p, method, headers: { host: host ?? `localhost:${port}`, ...headers } }, (res) => {
      const parts = [];
      res.on('data', (d) => parts.push(d));
      res.on('end', () => {
        const text = Buffer.concat(parts).toString();
        let json = null;
        try { json = JSON.parse(text); } catch {}
        done({ status: res.statusCode, text, json, headers: res.headers });
      });
    });
    req.on('error', (e) => done({ status: 0, text: String(e), json: null, headers: {} }));
    req.setTimeout(3000, () => req.destroy(new Error('no answer in 3 s')));
    req.end(body);
  });
// A request written by hand (a missing or doubled Host, HTTP/1.0): the status line's code.
const byHand = (port, lines) =>
  new Promise((done) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(lines.join('\r\n') + '\r\n\r\n'));
    let got = '';
    s.on('data', (d) => (got += d));
    const end = () => done(Number(/^HTTP\/1\.[01] (\d+)/.exec(got)?.[1] || 0));
    s.on('close', end);
    s.on('error', end);
    setTimeout(() => s.destroy(), 1500);
  });
const startLab = async (dir, env = {}) => {
  const port = await freePort();
  let out = '';
  const proc = spawn(process.execPath, [LAB, '.', '--no-open', '--port', String(port)], { cwd: dir, env: { ...ENV, ...env } });
  proc.stdout.on('data', (d) => (out += d));
  proc.stderr.on('data', (d) => (out += d));
  const lab = { proc, port, dir, B: `http://localhost:${port}`, out: () => out, keys: () => JSON.parse(fs.readFileSync(path.join(dir, '.lab/server.json'), 'utf8')),
    stop: () => new Promise((r) => (proc.exitCode !== null || proc.signalCode ? r() : (proc.once('exit', r), proc.kill()))) };
  labs.push(lab);
  for (let i = 0; i < 100 && proc.exitCode === null; i++) {
    if ((await raw(port, '/_lab/state')).status === 200) return lab;
    await sleep(100);
  }
  throw new Error(`the lab did not start: ${out}`);
};
const page = (name) => {
  const dir = tmp(name);
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>index</title><h1>index</h1>');
  return dir;
};
after(async () => {
  for (const l of labs) await l.stop();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 });
});
const lab = await startLab(page('origin'));
const PORT = lab.port;
const comment = (text) => JSON.stringify({ page: '/index', name: 'Leo', text, anchor: { selector: 'h1' } });
const texts = async () => (await raw(PORT, '/_lab/api/comments?page=/index')).json.comments.map((c) => c.text);
const alive = async () => assert.equal((await raw(PORT, '/')).status, 200, `the lab still answers\n${lab.out().slice(-600)}`);

test('Host: only names of this computer get an answer, on every kind of path', async () => {
  const refused = ['evil.example', `evil.example:${PORT}`, `localhost.evil.example:${PORT}`, `127.0.0.1.nip.io:${PORT}`, `localhost:${PORT}.evil.example`, `localhost:${PORT}:80`,
    'localhost@evil.example', 'evil.example#localhost', `evil.example/localhost:${PORT}`, `0.0.0.0:${PORT}`, '0.0.0.0', `127.0.0.2:${PORT}`, '127.1', '2130706433', '0x7f.0.0.1',
    `[::ffff:127.0.0.1]:${PORT}`, `[::]:${PORT}`, 'localhost.', `127.0.0.1.:${PORT}`, 'localhost, evil.example', `${os.hostname()}`, 'lab'];
  for (const host of refused) {
    for (const p of ['/', '/_lab/api/comments?page=/index', '/_lab/agent/index', '/_lab/comments.js', '/_lab/state', '/_lab/pages']) {
      const r = await raw(PORT, p, { host });
      assert.ok(r.status === 403 || r.status === 400, `Host ${JSON.stringify(host)} ${p} → ${r.status}`);
      assert.doesNotMatch(r.text, /<h1>index|"comments"|"root"/, `Host ${host} ${p}`);
    }
  }
  const post = await raw(PORT, '/_lab/api/comments', { method: 'POST', host: `evil.example:${PORT}`, body: comment('through a rebound name'), headers: { 'content-type': 'application/json', origin: `http://evil.example:${PORT}` } });
  assert.equal(post.status, 403, 'a page on a rebound name is its own origin, and still refused');
  for (const host of [`localhost:${PORT}`, 'localhost', `127.0.0.1:${PORT}`, '127.0.0.1', `[::1]:${PORT}`, `LOCALHOST:${PORT}`]) assert.equal((await raw(PORT, '/', { host })).status, 200, host);
  assert.ok(!(await texts()).includes('through a rebound name'));
});

test('no Host at all, HTTP/1.0 without one, another site first of two Hosts, an absolute URL of another site: refused', async () => {
  const close = 'Connection: close';
  assert.ok([400, 403].includes(await byHand(PORT, ['GET / HTTP/1.1', close])), 'HTTP/1.1 with no Host');
  assert.ok([400, 403].includes(await byHand(PORT, ['GET / HTTP/1.0'])), 'HTTP/1.0 with no Host');
  assert.ok([400, 403].includes(await byHand(PORT, ['GET / HTTP/1.1', 'Host:', close])), 'an empty Host');
  assert.ok([400, 403].includes(await byHand(PORT, ['GET / HTTP/1.1', 'Host: evil.example', `Host: localhost:${PORT}`, close])), 'two Hosts, another site first');
  assert.ok([400, 403].includes(await byHand(PORT, ['GET http://evil.example/ HTTP/1.1', 'Host: evil.example', close])), 'an absolute URL of another site');
  assert.ok([400, 403].includes(await byHand(PORT, [`GET http://localhost:${PORT}/ HTTP/1.1`, 'Host: evil.example', close])), 'an absolute URL of ours under another Host');
  assert.equal(await byHand(PORT, ['GET / HTTP/1.1', `Host: localhost:${PORT}`, close]), 200);
});

test('without --wifi the lab is on 127.0.0.1 alone: not on ::1, not on this computer\'s network address', async () => {
  assert.equal((await raw(PORT, '/', { to: '::1', host: `[::1]:${PORT}` })).status, 0, '::1 is not listened on');
  const lan = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal)?.address;
  if (lan) assert.equal((await raw(PORT, '/', { to: lan, host: `${lan}:${PORT}` })).status, 0, `${lan} is not listened on`);
});

test('a write is taken from the lab\'s own page only: Origin, Host and Sec-Fetch-Site in every mix', async () => {
  const post = (text, headers, host) => raw(PORT, '/_lab/api/comments', { method: 'POST', host, body: comment(text), headers: { 'content-type': 'application/json', ...headers } });
  const cases = [
    ['own page', { origin: `http://localhost:${PORT}` }, undefined, 201],
    ['own page by number', { origin: `http://127.0.0.1:${PORT}` }, `127.0.0.1:${PORT}`, 201],
    ['own page by ::1', { origin: `http://[::1]:${PORT}` }, `[::1]:${PORT}`, 201],
    ['127.0.0.1 page to localhost', { origin: `http://127.0.0.1:${PORT}` }, `localhost:${PORT}`, 403],
    ['localhost page to 127.0.0.1', { origin: `http://localhost:${PORT}` }, `127.0.0.1:${PORT}`, 403],
    ['::1 page to localhost', { origin: `http://[::1]:${PORT}` }, `localhost:${PORT}`, 403],
    ['another port on this computer', { origin: `http://localhost:${PORT + 1}` }, undefined, 403],
    ['localhost with no port', { origin: 'http://localhost' }, undefined, 403],
    ['a null origin (a sandboxed frame, a file)', { origin: 'null' }, undefined, 403],
    ['an origin that only starts like ours', { origin: `http://localhost:${PORT}.evil.example` }, undefined, 403],
    ['an origin with ours as its user', { origin: `http://localhost:${PORT}@evil.example` }, undefined, 403],
    ['not a URL', { origin: 'localhost' }, undefined, 403],
    ['another site', { origin: 'https://evil.example' }, undefined, 403],
    ['another site, saying same-origin', { origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' }, undefined, 403],
    ['no origin, cross-site', { 'sec-fetch-site': 'cross-site' }, undefined, 403],
    ['no origin, same-site', { 'sec-fetch-site': 'same-site' }, undefined, 403],
    ['no origin, none (typed address)', { 'sec-fetch-site': 'none' }, undefined, 403],
    ['no origin, same-origin', { 'sec-fetch-site': 'same-origin' }, undefined, 201],
    ['a tool: no origin, no sec-fetch-site', {}, undefined, 201],
    ['another site in the referer only', { referer: 'https://evil.example/', origin: 'https://evil.example' }, undefined, 403],
  ];
  for (const [what, headers, host, want] of cases) assert.equal((await post(`case: ${what}`, headers, host)).status, want, what);
  const saved = (await texts()).filter((t) => t.startsWith('case: ')).sort();
  assert.deepEqual(saved, cases.filter((c) => c[3] === 201).map((c) => `case: ${c[0]}`).sort(), 'only the allowed ones were saved');
});

test('reads are not opened to other sites: no CORS headers, and a preflight is refused', async () => {
  for (const p of ['/_lab/api/comments?page=/index', '/_lab/agent/index', '/_lab/state', '/_lab/pages', '/_lab/api/board', '/']) {
    const r = await raw(PORT, p, { headers: { origin: 'https://evil.example' } });
    for (const h of ['access-control-allow-origin', 'access-control-allow-credentials', 'access-control-allow-headers']) assert.equal(r.headers[h], undefined, `${p} sends no ${h}`);
  }
  for (const p of ['/_lab/api/comments', '/_lab/wait', '/_lab/api/board?name=x']) {
    const pre = await raw(PORT, p, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-lab-admin' } });
    assert.ok(pre.status >= 400 && pre.status < 500, `preflight ${p} → ${pre.status}`);
    assert.equal(pre.headers['access-control-allow-origin'], undefined);
  }
});

test('other methods on the comments API are refused plainly, never a 500', async () => {
  for (const method of ['PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']) {
    const r = await raw(PORT, '/_lab/api/comments?page=/index', { method, body: method === 'HEAD' ? undefined : comment('by another method'), headers: { 'content-type': 'application/json', origin: lab.B } });
    assert.ok(r.status >= 400 && r.status < 500, `${method} → ${r.status} ${r.text.slice(0, 100)}`);
  }
  assert.ok(!(await texts()).includes('by another method'));
  await alive();
});

test('the agent\'s endpoints: no key, the page\'s key, a wrong key of the right length, the key without the mark, the key from another site', async () => {
  const { agent, token } = lab.keys();
  const tries = [
    ['no key', {}],
    ['the mark alone', { 'x-lab-agent': '1' }],
    ['the page key', { 'x-lab-agent': '1', 'x-lab-admin': token }],
    ['a wrong key of the right length', { 'x-lab-agent': '1', 'x-lab-admin': 'f'.repeat(32) }],
    ['the key cut short', { 'x-lab-agent': '1', 'x-lab-admin': agent.slice(0, 31) }],
    ['the key and more', { 'x-lab-agent': '1', 'x-lab-admin': agent + '0' }],
    ['the key in capitals', { 'x-lab-agent': '1', 'x-lab-admin': agent.toUpperCase() === agent ? agent + 'x' : agent.toUpperCase() }],
    ['the key without the mark', { 'x-lab-admin': agent }],
    ['the key with another mark', { 'x-lab-agent': 'true', 'x-lab-admin': agent }],
    ['the key from another site', { 'x-lab-agent': '1', 'x-lab-admin': agent, origin: 'https://evil.example' }],
  ];
  for (const [what, headers] of tries) {
    for (const [p, method] of [['/_lab/wait', 'POST'], ['/_lab/ack', 'POST'], ['/_lab/invite', 'POST'], ['/_lab/pending', 'GET']]) {
      if (method === 'GET' && headers.origin) continue; // a read from another site gets no CORS answer anyway
      const r = await raw(PORT, p, { method, body: method === 'POST' ? '{"timeout":1}' : undefined, headers: { ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...headers } });
      assert.equal(r.status, 403, `${what} on ${p} → ${r.status}`);
    }
  }
  // And none of those marked a comment as the agent's.
  const r = await raw(PORT, '/_lab/api/comments', { method: 'POST', body: JSON.stringify({ page: '/index', name: 'Claude', text: 'Done: speaking as the agent', anchor: { selector: 'h1' } }), headers: { 'content-type': 'application/json', origin: lab.B, 'x-lab-agent': '1', 'x-lab-admin': token, 'x-lab-session': encodeURIComponent('{"id":"x","name":"x"}') } });
  assert.equal(r.status, 201);
  assert.equal(r.json.comment.session, undefined, 'the page key does not speak as the agent');
  assert.equal((await raw(PORT, '/_lab/pending', { headers: { 'x-lab-agent': '1', 'x-lab-admin': agent } })).status, 200, 'the agent itself is let in');
});

test('the owner\'s switch (labs) takes the page\'s key alone: not none, not a wrong one, not the agent\'s', async () => {
  const { agent, token } = lab.keys();
  const tries = [['no key', {}], ['a wrong key', { 'x-lab-admin': '0'.repeat(24) }], ['the agent key', { 'x-lab-admin': agent, 'x-lab-agent': '1' }], ['the key and more', { 'x-lab-admin': token + 'a' }], ['an empty key', { 'x-lab-admin': '' }]];
  const settings = path.join(ENV.XDG_CONFIG_HOME, 'labit', 'settings.json');
  const before = fs.existsSync(settings) ? fs.readFileSync(settings, 'utf8') : null;
  for (const [what, headers] of tries) {
    for (const [p, method, body] of [['/_lab/labs', 'POST', { action: 'stop', port: PORT }]]) {
      const r = await raw(PORT, p, { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json', origin: lab.B, ...headers } });
      assert.equal(r.status, 403, `${what} on ${p} → ${r.status}`);
    }
  }
  assert.equal(fs.existsSync(settings) ? fs.readFileSync(settings, 'utf8') : null, before, 'the settings file was not touched');
  await alive();
});

test('the hourly limit counts by the real address: a forged x-forwarded-for does not get around it, the owner and the agent are not limited', async () => {
  const small = await startLab(page('rate'), { LAB_COMMENTS_PER_HOUR: '5' });
  const post = (n, headers = {}) => raw(small.port, '/_lab/api/comments', { method: 'POST', body: JSON.stringify({ page: '/index', name: 'R', text: `r${n}`, anchor: { selector: 'h1' } }), headers: { 'content-type': 'application/json', origin: small.B, ...headers } });
  const codes = [];
  for (let i = 0; i < 8; i++) codes.push((await post(i, { 'x-forwarded-for': `203.0.113.${i}`, forwarded: `for=203.0.113.${i}`, 'x-real-ip': `203.0.113.${i}` })).status);
  assert.deepEqual(codes, [201, 201, 201, 201, 201, 429, 429, 429]);
  assert.equal((await post('owner', { 'x-lab-admin': small.keys().token })).status, 201, 'the owner is not limited');
  assert.equal((await post('agent', { 'x-lab-admin': small.keys().agent, 'x-lab-agent': '1' })).status, 201, 'nor the agent');
  assert.equal((await post('again')).status, 429, 'and people still are');
});

test('a JSON body that is null, a number, a string or a list is the sender\'s mistake (4xx), not a 500 with the error\'s text', async () => {
  const { agent, token } = lab.keys();
  const own = { 'x-lab-admin': token };
  const asAgent = { 'x-lab-admin': agent, 'x-lab-agent': '1' };
  const ends = [
    ['/_lab/api/comments', 'POST', {}], ['/_lab/bye', 'POST', {}], ['/_lab/me', 'POST', {}], ['/_lab/rule', 'POST', {}], ['/_lab/api/reads', 'POST', {}],
    ['/_lab/labs', 'POST', own],
    ['/_lab/ack', 'POST', asAgent], ['/_lab/wait', 'POST', asAgent],
  ];
  const bad = [];
  for (const [p, method, headers] of ends) {
    for (const body of ['null', '5', '"text"', '[]', 'true']) {
      if (p === '/_lab/wait' && body !== 'null') continue; // anything else there is a wait that stays open
      const r = await raw(PORT, p, { method, body, headers: { 'content-type': 'application/json', origin: lab.B, ...headers } });
      if (r.status >= 500 || r.status === 0 || /TypeError|ReferenceError|Cannot (read|destructure)/.test(r.text)) bad.push(`${method} ${p} ${body} → ${r.status} ${r.text.slice(0, 90)}`);
    }
  }
  await alive();
  assert.deepEqual(bad, []);
});

test('a path that can\'t be decoded is a bad request (4xx), not a 500 with the error\'s text; NUL and odd paths find nothing', async () => {
  const bad = [];
  for (const p of ['/%', '/%E0%A4%A', '/%zz', '/_lab/agent/%E0%A4%A', '/_lab/api/comments%', '/index%ff.html', '/a%00b', '/a%00.html', '/index.html%00.png', '/%00', '/..%00/', '/%5C..%5C..%5Cetc%5Cpasswd', '/index.html/', '/index.html/x', '/index/../index',
    '/_lab/board/%', '/_lab/board/a/%E0', '/_lab/j/%', '/_lab/comments.js%00', '/_lab/../local.mjs', '/_lab/%2e%2e/package.json', '/_lab/..%2f..%2fpackage.json', '/_lab/%2e%2e%2flocal.mjs']) {
    const r = await raw(PORT, p);
    if (r.status >= 500 || r.status === 0 || /URIError|TypeError|ENOENT|\bat /.test(r.text)) bad.push(`${p} → ${r.status} ${r.text.slice(0, 80)}`);
    assert.doesNotMatch(r.text, /"version"|@leonidstern\/labit|root:.*:0:0/, `${p} serves nothing from outside`);
  }
  await alive();
  assert.deepEqual(bad, []);
});

// The board API's own mistakes-of-the-sender, each on a lab of its own: one that takes the lab down would hide the rest.
for (const [what, method, q, body, who] of [
  ['PUT of a body that is not JSON', 'PUT', '?name=edge', '{"v":1,"frames":[', 'nobody'],
  ['PUT of null for a page\'s board', 'PUT', '?page=/index', 'null', 'nobody'],
  ['PUT of a body over 256 KB', 'PUT', '?name=edge', JSON.stringify({ v: 1, frames: [], title: 'x'.repeat(300 * 1024) }), 'nobody'],
  ['POST of null from the agent', 'POST', '', 'null', 'agent'],
  ['POST of a body that is not JSON, with the page key', 'POST', '', '{"action":', 'owner'],
]) {
  test(`the board API: ${what} is refused (4xx) and the lab keeps running`, async () => {
    const one = await startLab(page('board-body'));
    const { agent, token } = one.keys();
    const headers = { 'content-type': 'application/json', origin: one.B, ...(who === 'agent' ? { 'x-lab-admin': agent, 'x-lab-agent': '1' } : who === 'owner' ? { 'x-lab-admin': token } : {}) };
    const r = await raw(one.port, `/_lab/api/board${q}`, { method, body, headers });
    await sleep(200);
    const still = (await raw(one.port, '/')).status;
    const died = one.proc.exitCode !== null || still !== 200;
    await one.stop();
    assert.ok(!died, `the lab went down (exit ${one.proc.exitCode}): ${one.out().split('\n').filter((l) => /Error|could not/.test(l)).slice(0, 2).join(' | ')}`);
    assert.ok(r.status >= 400 && r.status < 500, `${r.status} ${r.text.slice(0, 100)}`);
  });
}
