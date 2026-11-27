// Your name is remembered for this computer, not for one lab: the browser's own memory is per origin and every lab
// has its own port, so a name given to one lab used to mean nothing to the next.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { claimPort, tmp, rm, spawnLab, up } from './harness.mjs';

const HOME = tmp('me'); // nobody's real ~/.config
const ME = path.join(HOME, 'labit', 'settings.json'); // the setting `name` in your own settings (me.json before 17 Nov)
const labs = [];
const dirs = [HOME];
const [ONE, TWO, OLD] = [0, 1, 2].map(() => claimPort(4711, 30)); // three labs, each on its own port

const startLab = async (port, home = HOME) => {
  const dir = tmp('lab');
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>t</title><h1>Hello</h1>');
  const server = spawnLab(dir, port, { flags: ['--new'], env: { ...process.env, XDG_CONFIG_HOME: home } });
  labs.push(server);
  const res = await up(`http://localhost:${port}/`, { tries: 60, fail: `lab on ${port} did not start` });
  return { port, html: await res.text() };
};

after(() => {
  for (const s of labs) s.kill();
  rm(dirs);
});

test('a lab tells the page nothing until it knows who you are', async () => {
  const { html } = await startLab(ONE);
  assert.doesNotMatch(html, /data-me=/);
});

test('a name given once is kept for this computer and handed to the next lab', async () => {
  const res = await fetch(`http://localhost:${ONE}/_lab/me`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'leo' }),
  });
  assert.equal(res.status, 204);
  assert.equal(JSON.parse(fs.readFileSync(ME, 'utf8')).name, 'leo');

  // The lab that was already running says so now…
  assert.match(await (await fetch(`http://localhost:${ONE}/`)).text(), /data-me="leo"/);
  // …and so does a lab started after it, in another folder on another port.
  const next = await startLab(TWO);
  assert.match(next.html, /data-me="leo"/);
});

test('an empty or oversized name is refused, and the kept one stands', async () => {
  for (const name of ['', '   ', 'x'.repeat(61), 42, null]) {
    const res = await fetch(`http://localhost:${ONE}/_lab/me`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    assert.equal(res.status, 400, String(name));
  }
  assert.equal(JSON.parse(fs.readFileSync(ME, 'utf8')).name, 'leo');
});

test('a name kept in the old me.json is still known', async () => {
  const old = tmp('me-old');
  dirs.push(old);
  fs.mkdirSync(path.join(old, 'labit'));
  fs.writeFileSync(path.join(old, 'labit', 'me.json'), JSON.stringify({ name: 'ada' }));
  const { html } = await startLab(OLD, old);
  assert.match(html, /data-me="ada"/);
});
