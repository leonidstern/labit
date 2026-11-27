// The built copy npm ships (dist/, made by npm run build:cli before every pack): it runs, finds the package's own
// files from dist/, and serves a page with the widget.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { claimPort, tmp, up } from './harness.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const kids = [];
after(() => kids.forEach((k) => k.kill()));

test('the built copy in dist/ runs and serves a page with the widget', async () => {
  execSync('npm run --silent build:cli', { cwd: REPO, stdio: 'ignore' });
  const bin = path.join(REPO, 'dist', 'local.mjs');
  assert.match(execSync(`node "${bin}" --help`, { encoding: 'utf8' }), /^labit \d+\.\d+\.\d+/);
  const dir = tmp('dist');
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>t</title><h1>hi</h1>');
  const home = tmp('home');
  const port = claimPort(8000, 500); // clear of 6566 and 6665-6669, which fetch refuses ("bad port")
  const kid = spawn(process.execPath, [bin, dir, '--no-open', '--port', String(port)], { env: { ...process.env, LABIT_HOME: home, LABIT_NO_UPDATE_CHECK: '1' } });
  kids.push(kid);
  const url = `http://localhost:${port}`;
  await up(url + '/', { tries: 60, fail: false });
  assert.match(await (await fetch(url + '/')).text(), /_lab\/comments\.js/);
  assert.equal((await fetch(url + '/_lab/comments.js')).status, 200);
});
