// The served folder at the edges: links that loop or point outside, a 10 MB page, file names with spaces, marks and
// other scripts, pages that are empty or not HTML at all, a subfolder removed under its comments, folders made and
// removed as a build does, and the served folder itself wiped (and written again) or deleted while the lab runs.
// No browser.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LAB = fileURLToPath(new URL('../local.mjs', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (n) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `labit-edge-${n}-`)));
const freePort = () => new Promise((done) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)); }); });
const ENV = { ...process.env, LABIT_HOME: tmp('home'), LABIT_NO_UPDATE_CHECK: '1', LABIT_IDLE_MS: '0', LAB_SETTLE_MS: '100', LAB_COMMENTS_PER_HOUR: '100000', LAB_SAVE_RETRY_MS: '400', PORT: '' };
const labs = [];
const dirs = [];
const raw = (port, p, { method = 'GET', headers = {}, body } = {}) =>
  new Promise((done) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, agent: false, headers: { host: `localhost:${port}`, ...headers } }, (res) => {
      const parts = [];
      res.on('data', (d) => parts.push(d));
      res.on('end', () => {
        const bytes = Buffer.concat(parts);
        const text = bytes.toString();
        let json = null;
        try { json = JSON.parse(text); } catch {}
        done({ status: res.statusCode, text, json, bytes, headers: res.headers });
      });
    });
    req.on('error', (e) => done({ status: 0, text: String(e), json: null, bytes: Buffer.alloc(0), headers: {} }));
    req.end(body);
  });
const PAGE = (t) => `<!doctype html><html><head><title>${t}</title></head><body><h1>${t}</h1></body></html>`;
const startLab = async (dir, { wait = 10000 } = {}) => {
  if (!dirs.includes(dir)) dirs.push(dir);
  const port = await freePort();
  let out = '';
  const proc = spawn(process.execPath, [LAB, '.', '--no-open', '--port', String(port)], { cwd: dir, env: ENV });
  proc.stdout.on('data', (d) => (out += d));
  proc.stderr.on('data', (d) => (out += d));
  const lab = { proc, port, dir, B: `http://localhost:${port}`, out: () => out, gone: () => proc.exitCode !== null || proc.signalCode !== null,
    stop: () => new Promise((r) => (proc.exitCode !== null || proc.signalCode ? r() : (proc.once('exit', r), proc.kill()))) };
  labs.push(lab);
  const t = Date.now();
  while (Date.now() - t < wait && proc.exitCode === null) {
    if ((await raw(port, '/_lab/state')).status === 200) return Object.assign(lab, { took: Date.now() - t });
    await sleep(50);
  }
  throw new Error(`the lab did not start in ${wait} ms: ${out}`);
};
after(async () => {
  for (const l of labs) await l.stop();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 });
});
const pinOn = (lab, page, text) => raw(lab.port, '/_lab/api/comments', { method: 'POST', body: JSON.stringify({ page, name: 'Leo', text, anchor: { selector: 'h1', x: 0.5, y: 0.5 } }), headers: { 'content-type': 'application/json', origin: lab.B } });
const listOn = async (lab, page) => (await raw(lab.port, `/_lab/api/comments?page=${encodeURIComponent(page)}`)).json?.comments;
const stateOf = async (lab) => JSON.parse((await raw(lab.port, '/_lab/state')).text);
const STACK = /\n\s+at .+:\d+:\d+\)?|Node\.js v\d+/;
const widgets = (html) => html.split('/_lab/comments.js').length - 1;

const DIR = tmp('files');
const OUTSIDE = tmp('outside');
dirs.push(OUTSIDE);
fs.writeFileSync(path.join(DIR, 'index.html'), PAGE('index'));
fs.mkdirSync(path.join(DIR, 'sub/deep'), { recursive: true });
fs.writeFileSync(path.join(DIR, 'sub/deep/page.html'), PAGE('deep'));
fs.writeFileSync(path.join(OUTSIDE, 'secret.html'), PAGE('outside the folder'));
// Links: to the folder itself, to each other, to themselves, to nothing, and out of the folder.
fs.symlinkSync('.', path.join(DIR, 'loop'));
fs.symlinkSync('..', path.join(DIR, 'sub/up'));
fs.symlinkSync('b', path.join(DIR, 'a'));
fs.symlinkSync('a', path.join(DIR, 'b'));
fs.symlinkSync('self.html', path.join(DIR, 'self.html'));
fs.symlinkSync('nowhere.html', path.join(DIR, 'dangling.html'));
fs.symlinkSync(OUTSIDE, path.join(DIR, 'out'));
fs.symlinkSync(path.join(OUTSIDE, 'secret.html'), path.join(DIR, 'secret.html'));
fs.symlinkSync('/', path.join(DIR, 'root'));
const lab = await startLab(DIR);
const PORT = lab.port;
const alive = async () => assert.equal((await raw(PORT, '/')).status, 200, `the lab still answers\n${lab.out().slice(-800)}`);

test('links that loop, point at themselves, at nothing or out of the folder: the lab starts at once, lists each page once, and serves nothing from outside', async () => {
  assert.ok(lab.took < 5000, `started in ${lab.took} ms`);
  const pages = (await raw(PORT, '/_lab/pages')).json.pages;
  // (a link to a file is listed under its own name, like a file; a link to a folder is never walked into)
  const files = pages.map((p) => p.file);
  assert.deepEqual(files.filter((f) => !['dangling.html', 'secret.html', 'self.html'].includes(f)).sort(), ['index.html', 'sub/deep/page.html'], 'each real page once, none again through a link to a folder');
  assert.equal(new Set(files).size, files.length);
  for (const p of ['/loop/', '/loop/loop/loop/', '/loop/index.html', '/sub/up/index.html', '/loop/sub/deep/page']) {
    const r = await raw(PORT, p);
    assert.equal(r.status, 200, `${p} → ${r.status}`);
    assert.equal(widgets(r.text), 1);
    assert.match(r.text, /data-page="\/(index|sub\/deep\/page)"/, `${p} is the page it leads to, under that page's own key`);
  }
  for (const p of ['/a', '/b', '/a/x', '/self.html', '/self', '/dangling.html', '/dangling']) assert.equal((await raw(PORT, p)).status, 404, p);
  for (const p of ['/out/', '/out/secret.html', '/out/secret', '/secret.html', '/secret', '/root/', '/root/etc/passwd', '/root/etc/hosts', '/loop/out/secret.html', '/sub/up/out/secret.html', '/sub/up/../../etc/passwd']) {
    const r = await raw(PORT, p);
    assert.ok([403, 404].includes(r.status), `${p} → ${r.status}`);
    assert.doesNotMatch(r.text, /outside the folder|root:|localhost/);
  }
  // The watcher still hears a save, loops and all.
  const before = await stateOf(lab);
  fs.writeFileSync(path.join(DIR, 'index.html'), PAGE('index, saved again'));
  let after;
  for (let i = 0; i < 40; i++) {
    after = await stateOf(lab);
    if ((after.hot || 0) > (before.hot || 0) || after.files > before.files) break;
    await sleep(50);
  }
  assert.ok((after.hot || 0) > (before.hot || 0) || after.files > before.files, 'the save reached the open pages');
  await alive();
});

test('a subfolder removed under its page\'s comments, then made again: the lab stays up, the comments stay and are on the page when it is back', async () => {
  const made = (await pinOn(lab, '/sub/deep/page', 'on the deep page')).json.comment;
  fs.rmSync(path.join(DIR, 'sub'), { recursive: true });
  await sleep(500);
  await alive();
  assert.equal((await raw(PORT, '/sub/deep/page')).status, 404);
  assert.deepEqual((await listOn(lab, '/sub/deep/page')).map((c) => c.id), [made.id]);
  assert.equal((await raw(PORT, '/_lab/pages')).status, 200);
  assert.equal((await raw(PORT, '/_lab/agent/sub/deep/page')).status, 200);
  fs.mkdirSync(path.join(DIR, 'sub/deep'), { recursive: true });
  fs.writeFileSync(path.join(DIR, 'sub/deep/page.html'), PAGE('deep, back'));
  await sleep(500);
  assert.match((await raw(PORT, '/sub/deep/page')).text, /deep, back/);
  const page = (await raw(PORT, '/_lab/pages')).json.pages.find((p) => p.path === '/sub/deep/page');
  assert.equal(page?.open, 1, 'the page is listed again, with its comment');
  // The lab hears of the new folder from its watcher, which can take longer than the pause above on a busy computer.
  let text = '';
  for (let i = 0; i < 50 && !/^file: sub\/deep\/page\.html$/m.test((text = (await raw(PORT, '/_lab/agent/sub/deep/page')).text)); i++) await sleep(100);
  assert.match(text, /^file: sub\/deep\/page\.html$/m);
});

test('a 10 MB page: served whole with the comment layer once, compressed too, without holding up the rest for long', async () => {
  const filler = '<p class="row">Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.</p>\n';
  const html = `<!doctype html><html><head><title>big page</title></head><body><h1 id="top">big</h1>\n${filler.repeat(Math.ceil(10 * 1024 * 1024 / filler.length))}<p id="tail">THE-END-OF-THE-PAGE</p></body></html>`;
  fs.writeFileSync(path.join(DIR, 'big.html'), html);
  assert.ok(Buffer.byteLength(html) > 10 * 1024 * 1024);
  await sleep(300);
  let t = Date.now();
  const plain = await raw(PORT, '/big');
  const plainMs = Date.now() - t;
  assert.equal(plain.status, 200);
  assert.ok(plain.bytes.length > Buffer.byteLength(html), 'the whole page and the layer');
  assert.equal(Number(plain.headers['content-length']), plain.bytes.length);
  assert.equal(widgets(plain.text), 1);
  assert.match(plain.text, /data-page="\/big"/);
  assert.ok(plain.text.includes('THE-END-OF-THE-PAGE'));
  assert.ok(plainMs < 5000, `plain: ${plainMs} ms`);
  // Compressed, with something else asked for meanwhile.
  t = Date.now();
  const [br, state] = await Promise.all([raw(PORT, '/big', { headers: { 'accept-encoding': 'br, gzip' } }), sleep(20).then(async () => { const s = Date.now(); await raw(PORT, '/_lab/state'); return Date.now() - s; })]);
  const brMs = Date.now() - t;
  assert.equal(br.status, 200);
  assert.equal(br.headers['content-encoding'], 'br');
  assert.ok(br.bytes.length < plain.bytes.length / 5, `compressed to ${br.bytes.length} bytes`);
  assert.ok(brMs < 10000, `compressed: ${brMs} ms`);
  assert.ok(state < 5000, `another request waited ${state} ms behind it`);
  const head = await raw(PORT, '/big', { method: 'HEAD' });
  assert.deepEqual([head.status, head.bytes.length], [200, 0]);
  const five = await Promise.all(Array.from({ length: 5 }, () => raw(PORT, '/big.html')));
  assert.ok(five.every((r) => r.status === 200 && r.bytes.length === plain.bytes.length));
  // It is a page like any other: listed with its title, takes a pin, has its agent text, and a save is heard.
  assert.equal((await raw(PORT, '/_lab/pages')).json.pages.find((p) => p.path === '/big')?.title, 'big page');
  assert.equal((await pinOn(lab, '/big', 'on the big page')).status, 201);
  const agent = await raw(PORT, '/_lab/agent/big');
  assert.equal(agent.status, 200);
  assert.match(agent.text, /^file: big\.html$/m);
  const before = await stateOf(lab);
  fs.appendFileSync(path.join(DIR, 'big.html'), '<!-- saved again -->');
  let now;
  for (let i = 0; i < 60; i++) {
    now = await stateOf(lab);
    if ((now.hot || 0) > (before.hot || 0) || now.files > before.files) break;
    await sleep(50);
  }
  assert.ok((now.hot || 0) > (before.hot || 0) || now.files > before.files, 'the save was heard');
  fs.rmSync(path.join(DIR, 'big.html'));
  await alive();
});

const NAMES = ['a b.html', 'a_20b.html', 'A-B.html', 'a-b/index.html', 'ünï cödé.html', 'q?x=1&y=2.html', '#frag.html', 'per%cent.html', '100%.html', 'dot.dot.html', "it's.html", '-dash.html', '_under.html', 'UPPER/Page.HTML', '中文 页面.html', 'emoji 😀.html', 'plus+plus.html', 'semi;colon.htm', 'at@sign.html', 'quote"d.html', 'tab\tname.html'];
test('file names with spaces, marks, capitals and other scripts: each is a page of its own, at its own address, with its own comments', async () => {
  const at = path.join(DIR, 'names');
  for (const n of NAMES) {
    fs.mkdirSync(path.dirname(path.join(at, n)), { recursive: true });
    fs.writeFileSync(path.join(at, n), PAGE(`page ${NAMES.indexOf(n)}`));
  }
  await sleep(500);
  const pages = (await raw(PORT, '/_lab/pages')).json.pages.filter((p) => p.file.startsWith('names/'));
  assert.deepEqual(pages.map((p) => p.file.normalize('NFC')).sort(), NAMES.map((n) => `names/${n}`.normalize('NFC')).sort(), 'every file is listed');
  assert.equal(new Set(pages.map((p) => p.path)).size, NAMES.length, 'every page has a key of its own');
  const bad = [];
  for (const p of pages) {
    const n = NAMES.findIndex((x) => `names/${x}`.normalize('NFC') === p.file.normalize('NFC'));
    const u = new URL(p.url);
    const r = await raw(PORT, u.pathname + u.search);
    if (r.status !== 200 || !r.text.includes(`<h1>page ${n}</h1>`)) bad.push(`${p.file}: ${p.url} → ${r.status}`);
    else if (!r.text.includes(`data-page="${p.path}"`)) bad.push(`${p.file}: served under another key than ${p.path}`);
    if (p.title !== `page ${n}`) bad.push(`${p.file}: title ${p.title}`);
    const c = await pinOn(lab, p.path, `a pin on page ${n}`);
    if (c.status !== 201) bad.push(`${p.file}: a pin on ${p.path} → ${c.status} ${c.text.slice(0, 60)}`);
    const mine = await listOn(lab, p.path);
    if (mine?.length !== 1 || mine[0].text !== `a pin on page ${n}`) bad.push(`${p.file}: its list has ${mine?.map((x) => x.text).join(', ')}`);
    const text = (await raw(PORT, `/_lab/agent${p.path}`)).text;
    if (!text.split('\n').includes(`file: ${p.file}`)) bad.push(`${p.file}: the agent text names ${text.split('\n').find((l) => l.startsWith('file:'))}`);
  }
  assert.deepEqual(bad, []);
  await alive();
});

test('a page with a long name in another script (Cyrillic, 55 letters) takes comments like any other', { todo: 'the key is 307 characters, over the 300 cap' }, async () => {
  const name = 'Отчёт о проделанной работе за третий квартал этого года.html';
  fs.writeFileSync(path.join(DIR, name), PAGE('отчёт'));
  await sleep(400);
  const page = (await raw(PORT, '/_lab/pages')).json.pages.find((p) => p.file.normalize('NFC') === name.normalize('NFC'));
  assert.ok(page, 'the page is listed');
  const u = new URL(page.url);
  const html = await raw(PORT, u.pathname);
  assert.equal(html.status, 200);
  assert.ok(html.text.includes(`data-page="${page.path}"`), 'the page is served with its key');
  const listed = await raw(PORT, `/_lab/api/comments?page=${encodeURIComponent(page.path)}`);
  const made = await pinOn(lab, page.path, 'по-русски');
  assert.deepEqual([listed.status, made.status], [200, 201], `its key is ${page.path.length} characters; the page's own comment list and a new pin answer ${listed.status} ${listed.text.slice(0, 40)} / ${made.status} ${made.text.slice(0, 40)}`);
});

test('pages that are empty, plain words, not UTF-8, in capitals, or folders named like pages are served, the HTML ones with the layer once', async () => {
  const at = path.join(DIR, 'odd');
  fs.mkdirSync(path.join(at, 'folder.html'), { recursive: true });
  fs.writeFileSync(path.join(at, 'folder.html/index.html'), PAGE('in a folder named like a page'));
  fs.writeFileSync(path.join(at, 'empty.html'), '');
  fs.writeFileSync(path.join(at, 'words.html'), 'just words, no tags at all');
  fs.writeFileSync(path.join(at, 'latin1.html'), Buffer.from([0x3c, 0x68, 0x31, 0x3e, 0xe9, 0xff, 0xfe, 0x00, 0x80, 0x3c, 0x2f, 0x68, 0x31, 0x3e]));
  fs.writeFileSync(path.join(at, 'upper.html'), '<HTML><HEAD><TITLE>x</TITLE></HEAD><BODY><H1>caps</H1></BODY></HTML>');
  fs.writeFileSync(path.join(at, 'tricky.html'), '<!doctype html><head><script>var s = "</body></html><head>";</script></head><body><h1>tricky</h1><!-- </body> --></body></html>');
  fs.writeFileSync(path.join(at, 'old.htm'), PAGE('htm'));
  fs.writeFileSync(path.join(at, 'data.json'), '{"html":"<body></body>"}');
  fs.writeFileSync(path.join(at, 'pic.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
  fs.writeFileSync(path.join(at, 'notes.md'), '# notes <body>');
  fs.writeFileSync(path.join(at, 'noext'), '<body>no extension</body>');
  await sleep(300);
  for (const p of ['/odd/empty.html', '/odd/empty', '/odd/words', '/odd/latin1', '/odd/upper', '/odd/tricky', '/odd/old.htm', '/odd/folder.html/']) {
    const r = await raw(PORT, p);
    assert.equal(r.status, 200, `${p} → ${r.status} ${r.text.slice(0, 80)}`);
    assert.equal(widgets(r.text), 1, `${p} has the layer once`);
    assert.match(r.headers['content-type'], /^text\/html/);
  }
  const folder = await raw(PORT, '/odd/folder.html');
  assert.ok([200, 302].includes(folder.status), `a folder named like a page → ${folder.status}`);
  for (const [p, type] of [['/odd/data.json', /^application\/json/], ['/odd/pic.svg', /^image\/svg/], ['/odd/notes.md', /^text\/plain/], ['/odd/noext', /^application\/octet-stream/]]) {
    const r = await raw(PORT, p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers['content-type'], type, p);
    assert.equal(widgets(r.text), 0, `${p} is sent as it is`);
  }
  // Byte ranges on a file: the part asked for, 416 for one that can't be, never a 500.
  for (const [range, want] of [['bytes=0-4', 206], ['bytes=-5', 206], ['bytes=5-', 206], ['bytes=5-2', 416], ['bytes=99999-', 416], ['bytes=abc', 200], ['bytes=', 200], ['bytes=0-4,6-8', 200], ['items=0-4', 200], ['bytes=-', 200], ['bytes=-0', 416]]) {
    const r = await raw(PORT, '/odd/data.json', { headers: { range } });
    assert.ok(r.status === want || (want === 416 && r.status === 206), `range ${range} → ${r.status}, not ${want}`);
    assert.ok(r.status < 500);
  }
  const first = await raw(PORT, '/odd/data.json');
  assert.equal((await raw(PORT, '/odd/data.json', { headers: { 'if-none-match': first.headers.etag } })).status, 304);
  await alive();
});

test('folders made and removed again and again while the lab looks through them (a build writing its output): the lab stays up', async () => {
  const dir = tmp('churn');
  fs.writeFileSync(path.join(dir, 'index.html'), PAGE('beside a build'));
  const one = await startLab(dir);
  await pinOn(one, '/index', 'so the lab has a page to look up');
  // Up to 40 rounds: a tree of 150 folders with pages is written, left for about as long as the lab waits before it
  // looks (80 ms), and removed while it looks.
  const script = `
    i=0
    while [ $i -lt 40 ]; do
      for d in 0 1 2 3 4 5 6 7 8 9; do for e in 0 1 2 3 4; do for f in 0 1 2; do mkdir -p "build/$d/$e/$f"; echo '<h1>x</h1>' > "build/$d/$e/$f/p.html"; done; done; done
      sleep 0.0$((RANDOM % 4 + 7))
      rm -rf build
      i=$((i+1))
    done`;
  const build = spawn('bash', ['-c', script], { cwd: dir, stdio: 'ignore' });
  const ended = new Promise((done) => build.once('exit', done));
  const watch = setInterval(() => one.gone() && build.kill(), 100);
  await ended;
  clearInterval(watch);
  await sleep(600);
  assert.ok(!one.gone(), `the lab went down: ${one.out().split('\n').filter((l) => /Error/.test(l)).join(' | ')}`);
  assert.equal((await raw(one.port, '/')).status, 200);
  assert.doesNotMatch(one.out(), STACK);
});

test('the served folder wiped and written again while the lab runs (a build that starts from an empty folder): the lab stays up and its comments are written back', async () => {
  const dir = tmp('wiped');
  fs.writeFileSync(path.join(dir, 'index.html'), PAGE('before the build'));
  const one = await startLab(dir);
  const first = (await pinOn(one, '/index', 'made before the build')).json.comment;
  await sleep(300);
  assert.ok(fs.existsSync(path.join(dir, '.lab/comments/index.json')));
  // The build: everything in the folder goes (the lab's .lab with it), then the pages are written again.
  for (const n of fs.readdirSync(dir)) fs.rmSync(path.join(dir, n), { recursive: true, force: true });
  await sleep(200);
  fs.writeFileSync(path.join(dir, 'index.html'), PAGE('after the build'));
  await sleep(600);
  assert.ok(!one.gone(), `the lab went down: ${one.out().split('\n').filter((l) => /Error/.test(l)).join(' | ')}`);
  assert.match((await raw(one.port, '/')).text, /after the build/);
  assert.deepEqual((await listOn(one, '/index')).map((c) => c.id), [first.id], 'the lab still holds the comment');
  const second = await pinOn(one, '/index', 'made after the build');
  assert.equal(second.status, 201);
  // The lab says it keeps comments it could not save and writes them again every few seconds (0.4 s here).
  let saved = false;
  for (let i = 0; i < 30 && !saved; i++) {
    await sleep(200);
    try {
      const f = JSON.parse(fs.readFileSync(path.join(dir, '.lab/comments/index.json'), 'utf8'));
      saved = Boolean(f.comments[first.id] && f.comments[second.json.comment.id]);
    } catch {}
  }
  assert.ok(!one.gone(), 'the lab is still up');
  assert.ok(saved, `6 s later the comments are in memory only: .lab is ${fs.existsSync(path.join(dir, '.lab')) ? `there with ${fs.readdirSync(path.join(dir, '.lab')).join(' ') || 'nothing in it'}` : 'not there'}; a restart now loses them. The lab said: ${one.out().split('\n').filter((l) => /could not|save/i.test(l)).slice(-2).join(' | ') || 'nothing'}`);
});

test('the served folder deleted for good: the lab ends (or stays) without a stack trace', async () => {
  const dir = tmp('deleted');
  fs.writeFileSync(path.join(dir, 'index.html'), PAGE('soon gone'));
  const one = await startLab(dir);
  await pinOn(one, '/index', 'on a page that is about to go');
  await sleep(200);
  fs.rmSync(dir, { recursive: true, force: true });
  await sleep(1200);
  const r = one.gone() ? null : await raw(one.port, '/');
  await one.stop();
  assert.ok(!STACK.test(one.out()), `it ended on an error nobody caught: ${one.out().split('\n').find((l) => /Error/.test(l))}`);
  if (r) assert.ok(r.status === 404 || r.status === 200 || r.status === 0, `while it stayed: ${r.status}`);
});
