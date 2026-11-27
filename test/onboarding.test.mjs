// Running labit in a project: it finds the project's own dev server, and never serves a project's source as pages.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { LAB, claimPort, tmp, rm, sleep, cli } from './harness.mjs';

const DIR = fs.realpathSync(tmp('onboard'));
fs.mkdirSync(path.join(DIR, 'src'));
fs.writeFileSync(path.join(DIR, 'package.json'), JSON.stringify({ name: 'app', scripts: { dev: 'vite' } }));
// What a browser asks a page with (a bare fetch is no page load to a lab in front of a dev server).
const PAGE = { accept: 'text/html', 'sec-fetch-dest': 'document' };
const kids = [];
after(() => {
  kids.forEach((k) => k.kill());
  rm([DIR]);
});

const run = (args) => cli(args, { cwd: DIR });
const hasLsof = (() => {
  try {
    execFileSync('lsof', ['-v'], { stdio: 'ignore' });
    return true;
  } catch (e) {
    return e.code !== 'ENOENT';
  }
})();

test('a project whose dev server is not running is refused, not served as files', async () => {
  const { code, out } = await run(['--no-open', '--port', '4999']);
  assert.equal(code, 1, out);
  assert.match(out, /dev server, and it isn't running/);
  assert.ok(!fs.existsSync(path.join(DIR, '.lab')), 'no .lab left behind');
});

test('in a project, a bare run finds the dev server running in that folder', { skip: !hasLsof && 'needs lsof' }, async () => {
  const devPort = claimPort(5700, 90);
  const labPort = String(claimPort(5800, 90));
  // A stand-in dev server, running in the project like `npm run dev` would.
  const dev = spawn(process.execPath, ['-e', `require('http').createServer((q,s)=>{s.setHeader('content-type','text/html');s.end('<h1>dev page</h1>')}).listen(${devPort},'127.0.0.1')`], { cwd: DIR });
  kids.push(dev);
  await sleep(400);
  const lab = spawn(process.execPath, [LAB, '--no-open', '--port', labPort], { cwd: DIR });
  kids.push(lab);
  let out = '';
  lab.stdout.on('data', (d) => (out += d));
  lab.stderr.on('data', (d) => (out += d));
  let html = '';
  for (let i = 0; i < 50 && !html; i++) {
    try {
      html = await (await fetch(`http://localhost:${labPort}/`, { headers: PAGE })).text();
    } catch {
      await sleep(100);
    }
  }
  assert.match(out, new RegExp(`fronting your dev server on :${devPort}`), out);
  assert.match(html, /dev page/);
  assert.match(html, /_lab\/comments\.js/);
});

test('a folder with no index.html at the top lists its pages, not its folders, and opens the first one', async () => {
  const dir = fs.realpathSync(tmp('pages'));
  fs.mkdirSync(path.join(dir, 'site/about'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.writeFileSync(path.join(dir, 'lib/x.js'), '');
  fs.writeFileSync(path.join(dir, 'site/index.html'), '<title>Home</title><h1>home</h1>');
  fs.writeFileSync(path.join(dir, 'site/about/team.html'), '<h1>team</h1>');
  const port = String(claimPort(6700, 90));
  const lab = spawn(process.execPath, [LAB, '--no-open', '--port', port], { cwd: dir });
  kids.push(lab);
  let out = '';
  lab.stdout.on('data', (d) => (out += d));
  let html = '';
  for (let i = 0; i < 50 && !html; i++) {
    try {
      html = await (await fetch(`http://localhost:${port}/`, { headers: PAGE })).text();
    } catch {
      await sleep(100);
    }
  }
  assert.match(html, /href="\/site\/"><span class="lab-page-t">Home</); // a page with a title shows it, not its file
  assert.doesNotMatch(html, /<span class="lab-page-f">/);
  assert.match(html, /href="\/site\/about\/team\.html"><span class="lab-page-t">site\/about\/team\.html</);
  assert.doesNotMatch(html, /lib/);
  assert.match(out, /opening site\/index\.html/);
  assert.match(await (await fetch(`http://localhost:${port}/site/`)).text(), /_lab\/comments\.js/);
  rm([dir]);
});

test('a running lab is listed for the Lab panel: a registry file while it runs, its pages with open comments', async () => {
  const dir = fs.realpathSync(tmp('reg'));
  const home = tmp('home');
  fs.writeFileSync(path.join(dir, 'index.html'), '<title>Start</title><h1>start</h1>');
  const port = String(claimPort(4990, 9));
  const lab = spawn(process.execPath, [LAB, '--no-open', '--port', port], { cwd: dir, env: { ...process.env, LABIT_HOME: home } });
  kids.push(lab); // stopped by after() also when an assertion below fails
  let info = null;
  for (let i = 0; i < 50 && !info; i++) {
    try {
      info = await (await fetch(`http://localhost:${port}/_lab/pages`)).json();
    } catch {
      await sleep(100);
    }
  }
  const reg = path.join(home, 'servers', `${port}.json`);
  assert.equal(JSON.parse(fs.readFileSync(reg, 'utf8')).root, dir);
  assert.equal(info.name, path.basename(dir));
  assert.deepEqual(info.pages.map((p) => [p.title, p.file, p.open]), [['Start', 'index.html', 0]]);
  // `pages` turns every running lab into a Markdown list in .lab/lab-pages.md.
  const out = await new Promise((resolve) => execFile(process.execPath, [LAB, 'pages'], { cwd: dir, env: { ...process.env, LABIT_HOME: home } }, (err, stdout) => resolve(stdout.trim())));
  assert.equal(out, path.join(dir, '.lab', 'lab-pages.md'));
  assert.equal(fs.readFileSync(out, 'utf8'), `- [Start](http://localhost:${port}/) · just now\n`);
  // Run from a folder no lab has served: the .lab it makes for the file is one git skips.
  const elsewhere = fs.realpathSync(tmp('pages-here'));
  await new Promise((resolve) => execFile(process.execPath, [LAB, 'pages'], { cwd: elsewhere, env: { ...process.env, LABIT_HOME: home } }, resolve));
  assert.equal(fs.readFileSync(path.join(elsewhere, '.lab', '.gitignore'), 'utf8'), '*\n');
  rm([elsewhere]);
  lab.kill();
  await new Promise((r) => lab.on('exit', r));
  assert.ok(!fs.existsSync(reg), 'registry file removed on exit');
  rm([dir, home]);
});

test('a folder that a running lab already serves opens that lab instead of starting another', async () => {
  const dir = fs.realpathSync(tmp('nest'));
  const home = tmp('home');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<title>Top</title>');
  fs.writeFileSync(path.join(dir, 'sub', 'index.html'), '<title>Sub</title>');
  const env = { ...process.env, LABIT_HOME: home };
  const lab = spawn(process.execPath, [LAB, '--no-open', '--port', String(claimPort(6800, 90))], { cwd: dir, env });
  kids.push(lab);
  // The lab moves up a port when its first pick is busy: read the one it took from its registry file.
  const reg = path.join(home, 'servers');
  for (let i = 0; i < 50 && !(fs.existsSync(reg) && fs.readdirSync(reg).length); i++) await sleep(100);
  const port = String(JSON.parse(fs.readFileSync(path.join(reg, fs.readdirSync(reg)[0]), 'utf8')).port);
  const run2 = (args, cwd) => cli(args, { cwd, env });
  const nested = await run2(['--no-open'], path.join(dir, 'sub'));
  assert.equal(nested.code, 0);
  assert.match(nested.out, new RegExp(`already served by the lab for .*: http://localhost:${port}/sub/`));
  assert.ok(!fs.existsSync(path.join(dir, 'sub', '.lab')), 'no second lab started');
  const list = await run2(['list'], dir);
  assert.match(list.out, new RegExp(`http://localhost:${port}  ${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · labit [^,]+, up [^·]+ · 2 pages`));
  lab.kill();
  await new Promise((r) => lab.on('exit', r));
  assert.match((await run2(['list'], dir)).out, /No labs running/);
  rm([dir, home]);
});

test('pages lists this folder\'s labs only, unless --all', async () => {
  const home = tmp('home');
  const env = { ...process.env, LABIT_HOME: home };
  const mk = (name) => {
    const d = fs.realpathSync(tmp(name));
    fs.writeFileSync(path.join(d, 'index.html'), `<title>${name}</title>`);
    return d;
  };
  const [a, b] = [mk('alpha'), mk('beta')];
  for (const [d, p] of [[a, 6900], [b, 6950]]) kids.push(spawn(process.execPath, [LAB, '--no-open', '--port', String(claimPort(p, 40))], { cwd: d, env }));
  const reg = path.join(home, 'servers');
  for (let i = 0; i < 50 && !(fs.existsSync(reg) && fs.readdirSync(reg).length === 2); i++) await sleep(100);
  const pagesIn = (cwd, extra = []) => new Promise((resolve) => execFile(process.execPath, [LAB, 'pages', ...extra], { cwd, env }, (err, stdout) => resolve(fs.readFileSync(stdout.trim(), 'utf8'))));
  const mine = await pagesIn(a);
  assert.match(mine, /\[alpha\]/);
  assert.doesNotMatch(mine, /beta/);
  const all = await pagesIn(a, ['--all']);
  assert.match(all, /\*\*labit-alpha-.*\[alpha\][\s\S]*\*\*labit-beta-.*\[beta\]/s);
  rm([a, b]);
});

test('a mistyped flag is refused for every command, not posted as text', async () => {
  const dir = tmp('flag');
  const r = await cli(['reply', 'abc', 'Done', '--resolv'], { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.out, /Unknown option --resolv/);
  rm([dir]);
});

test('preview is gone: it is a folder name like any other word', async () => {
  const dir = tmp('preview');
  const r = await cli(['preview'], { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.out, /No folder preview\./);
  assert.equal(fs.existsSync(path.join(dir, '.claude')), false, 'no launch.json written');
  rm([dir]);
});

test('a newer version on npm is announced as the lab starts', async () => {
  const dir = tmp('latest');
  const home = tmp('home');
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>x</h1>');
  // What a check would have found (kept for a day), so the test needs no network.
  fs.writeFileSync(path.join(home, 'latest.json'), JSON.stringify({ version: '99.0.0', at: Date.now() }));
  const env = { ...process.env, LABIT_HOME: home };
  delete env.CI;
  delete env.LABIT_NO_UPDATE_CHECK;
  const lab = spawn(process.execPath, [LAB, '--no-open', '--port', String(claimPort(7600, 90))], { cwd: dir, env });
  kids.push(lab);
  let out = '';
  lab.stdout.on('data', (d) => (out += d));
  for (let i = 0; i < 40 && !/is out/.test(out); i++) await sleep(100);
  assert.match(out, /labit 99\.0\.0 is out \(you have [\d.]+\): npx @leonidstern\/labit@latest/);
  rm([dir]);
});

test('the npm package ships the widget and the lab screens\' stylesheet', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const f of ['public/_lab/comments.js.br', 'public/_lab/lab.css.br']) assert.ok(pkg.files.includes(f), `${f} is in package.json files`);
});

// A project with HTML files of its own (Vite's index.html, webpack's template) is still a project with a dev server.
const project = (name, files, pkg) => {
  const dir = fs.realpathSync(tmp(name));
  for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), text);
  if (pkg) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  return dir;
};
const startLab = async (dir, port) => {
  const lab = spawn(process.execPath, [LAB, '--no-open', '--port', String(port)], { cwd: dir });
  kids.push(lab);
  let out = '';
  lab.stdout.on('data', (d) => (out += d));
  lab.stderr.on('data', (d) => (out += d));
  let html = '';
  for (let i = 0; i < 50 && !html; i++) {
    try {
      html = await (await fetch(`http://localhost:${port}/`, { headers: PAGE })).text();
    } catch {
      await sleep(100);
    }
  }
  return { html, out: () => out };
};
const standIn = async (dir, port) => {
  const dev = spawn(process.execPath, ['-e', `require('http').createServer((q,s)=>{s.setHeader('content-type','text/html');s.end('<h1>framework page</h1>')}).listen(${port},'127.0.0.1')`], { cwd: dir });
  kids.push(dev);
  await sleep(400);
};

for (const [what, pkg] of [
  ['a dev script', { name: 'app', scripts: { dev: 'vite' } }],
  ['only a framework in its dependencies', { name: 'app', devDependencies: { vite: '^7.0.0' } }],
]) {
  test(`a project with an index.html and ${what}, and a dev server running in it: the lab fronts the dev server, not the raw index.html`, { skip: !hasLsof && 'needs lsof' }, async () => {
    const dir = project('onboard-html', { 'index.html': '<!doctype html><title>raw</title><h1>raw source</h1><script type="module" src="/src/main.js"></script>' }, pkg);
    const devPort = claimPort(5700, 90);
    await standIn(dir, devPort);
    const { html, out } = await startLab(dir, claimPort(5800, 90));
    assert.match(out(), new RegExp(`fronting your dev server on :${devPort}`), out());
    assert.match(html, /framework page/);
    assert.doesNotMatch(html, /raw source/);
    assert.match(html, /_lab\/comments\.js/);
    rm([dir]);
  });
}

test('a project with an index.html and a dev script whose server is not running is served as pages, and says so', { skip: !hasLsof && 'needs lsof' }, async () => {
  const dir = project('onboard-nodev', { 'index.html': '<!doctype html><title>raw</title><h1>raw source</h1>' }, { name: 'app', scripts: { dev: 'vite' } });
  const { html, out } = await startLab(dir, claimPort(5800, 90));
  assert.match(html, /raw source/);
  assert.match(out(), /has a dev script but no dev server is running here/, out());
  assert.match(out(), /npm run dev/);
  rm([dir]);
});

test('a plain folder of pages is served as pages even with a server running in it, and one with a package.json but no dev script or framework too', { skip: !hasLsof && 'needs lsof' }, async () => {
  for (const pkg of [null, { name: 'site', scripts: { build: 'tsc' }, dependencies: { lodash: '1' } }]) {
    const dir = project('onboard-static', { 'index.html': '<!doctype html><title>plain</title><h1>plain page</h1>' }, pkg);
    await standIn(dir, claimPort(5700, 90)); // a port of its own each: the one next to a claimed port may be taken
    const { html, out } = await startLab(dir, claimPort(5800, 90));
    assert.match(html, /plain page/);
    assert.doesNotMatch(out(), /fronting your dev server/);
    rm([dir]);
  }
});

test('a dev server that has a lab already gets no second one; `use` moves a lab onto another build in place', async () => {
  const home = tmp('home');
  const env = { ...process.env, LABIT_HOME: home };
  const site = (await import('node:http')).createServer((q, s) => s.end('<title>Site</title>'));
  const devPort = claimPort(6300, 90);
  await new Promise((r) => site.listen(devPort, '127.0.0.1', r));
  // Closed at the end also when an assertion below fails: a listening server keeps the test process alive.
  after(() => {
    site.closeAllConnections();
    site.close();
  });
  const [a, b] = [fs.realpathSync(tmp('front-a')), fs.realpathSync(tmp('front-b'))];
  const lab = spawn(process.execPath, [LAB, '--no-open', '--proxy', String(devPort), '--port', String(claimPort(6400, 90))], { cwd: a, env });
  kids.push(lab);
  const reg = path.join(home, 'servers');
  // Read again while the file is swapped: the new lab writes it once it listens.
  const read = () => {
    try {
      return fs.readdirSync(reg).map((f) => JSON.parse(fs.readFileSync(path.join(reg, f), 'utf8'))).find((l) => l.root === a) || {};
    } catch {
      return {};
    }
  };
  for (let i = 0; i < 50 && !(fs.existsSync(reg) && fs.readdirSync(reg).length); i++) await sleep(100);
  const { port, pid } = read();
  const second = await cli(['--no-open', '--proxy', String(devPort)], { cwd: b, env });
  assert.equal(second.code, 0, second.out);
  assert.match(second.out, new RegExp(`:${devPort} has a lab already: http://localhost:${port}`));
  assert.ok(!fs.existsSync(path.join(b, '.lab')), 'no second lab started');
  // A lab of its own coming back (a newer build, a park, a restart) starts: 26 Nov, a lab followed a new build and
  // the new one refused to start, leaving its site with no lab.
  fs.mkdirSync(path.join(b, '.lab'));
  const back = spawn(process.execPath, [LAB, '--no-open', '--proxy', String(devPort), '--port', String(claimPort(6500, 90))], { cwd: b, env });
  kids.push(back);
  for (let i = 0; i < 50 && fs.readdirSync(reg).length < 2; i++) await sleep(100);
  assert.equal(fs.readdirSync(reg).length, 2, 'the lab came back');
  back.kill();
  for (let i = 0; i < 50 && fs.readdirSync(reg).length > 1; i++) await sleep(100);
  // Another session listening here would have its pages moved too: refused, unless the person said so (--new).
  const other = spawn(process.execPath, [LAB, 'wait', '--timeout', '60'], { cwd: a, env: { ...env, CLAUDE_CODE_SESSION_ID: 'other' } });
  kids.push(other);
  for (let i = 0; i < 50 && !(await cli(['list'], { cwd: a, env })).out.includes('other'); i++) await sleep(100);
  const me = { cwd: a, env: { ...env, CLAUDE_CODE_SESSION_ID: 'me' } };
  const refused = await cli(['use'], me);
  assert.equal(refused.code, 1, refused.out);
  assert.match(refused.out, /another session listens on this lab/);
  assert.equal(read().pid, pid, 'the lab stayed');
  // The same file stands in for a branch's build: the lab starts again from it, on its port, in its folder.
  const used = await cli(['use', '--new'], me);
  assert.equal(used.code, 0, used.out);
  let now = read();
  for (let i = 0; i < 100 && (now.pid ?? pid) === pid; i++) await sleep(100), (now = read());
  assert.notEqual(now.pid, pid, 'a new process took over');
  assert.equal(now.port, port);
  assert.equal(now.root, a);
  process.kill(now.pid);
  other.kill();
  for (let i = 0; i < 50 && fs.readdirSync(reg).length; i++) await sleep(100);
  rm([a, b, home]);
});
