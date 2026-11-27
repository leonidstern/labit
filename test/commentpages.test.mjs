// The widget skips its pull when the version moved by one and its page isn't in commentPages. For each step of a
// stream, every page that skips must really have nothing new.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { LAB, H1, site, tmp, rm, spawnLab, sleep, up, serverJson } from './harness.mjs';

const { DIR, PORT, B } = site('cp', 9500, 300);
const html = (t) => `<!doctype html><title>${t}</title><h1>${t}</h1>`;
fs.writeFileSync(path.join(DIR, 'index.html'), html('i'));
fs.writeFileSync(path.join(DIR, 'other.html'), html('o'));
fs.mkdirSync(path.join(DIR, 'sub'));
fs.writeFileSync(path.join(DIR, 'sub/index.html'), html('s'));
fs.writeFileSync(path.join(DIR, 'Ünï code.html'), html('u'));
fs.writeFileSync(path.join(DIR, 'mover.html'), html('m'));
const env = { ...process.env, LAB_CLOSE_GRACE: '30', LAB_SETTLE_MS: '100', LABIT_HOME: tmp('home'), LABIT_NO_UPDATE_CHECK: '1' };
let server = spawnLab(DIR, PORT, { env });
after(() => { server.kill(); rm([DIR]); });
const live = () => new Promise((resolve) => {
  const msgs = [];
  const req = http.get({ host: '127.0.0.1', port: PORT, path: '/_lab/live?tab=cp', headers: { host: `localhost:${PORT}` } }, (res) => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const data = buf.slice(0, i).split('\n').find((l) => l.startsWith('data: '));
        buf = buf.slice(i + 2);
        if (data) msgs.push(JSON.parse(data.slice(6)));
      }
    });
    resolve({ msgs, close: () => req.destroy() });
  });
});
const keys = () => serverJson(DIR);
const api = (body, agent) => fetch(B + '/_lab/api/comments', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: B, ...(agent ? { 'x-lab-agent': '1', 'x-lab-admin': keys().agent } : { 'x-lab-admin': keys().token }) },
  body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const post = (page, text) => api({ page, name: 'Leo', text, anchor: H1 }).then((r) => r.comment);
const PAGES = ['/index', '/other', '/sub/index', '/_c3_bcn_c3_af_5fcode', '/mover'];
let problems = [];
// What the widget does with the stream, for page P: returns true when it skips.
const skips = (prev, cur, P) => cur.comments === prev.comments + 1 && Array.isArray(cur.commentPages) && !cur.commentPages.includes(P);
async function settle(s, from) {
  let n = s.msgs.length;
  for (let i = 0; i < 12; i++) { await sleep(120); if (s.msgs.length === n && s.msgs.length > from) break; n = s.msgs.length; }
}
async function step(s, label, fn) {
  const from = s.msgs.length;
  const prevRev = s.msgs[from - 1].comments;
  await fn();
  await settle(s, from);
  const msgs = s.msgs.slice(from - 1);
  // the widget sees a chain; check each hop it would skip
  for (let k = 1; k < msgs.length; k++) {
    const [prev, cur] = [msgs[k - 1], msgs[k]];
    for (const P of PAGES) {
      if (!skips(prev, cur, P)) continue;
      const d = await (await fetch(`${B}/_lab/api/changes?page=${encodeURIComponent(P)}&since=${prev.comments}`)).json();
      // delta runs to the latest version; only hops that are the last are exact, so compare against cur.comments via rev
      if (cur.comments === s.msgs[s.msgs.length - 1].comments && (d.full || d.set?.length || d.del?.length))
        problems.push(`${label}: page ${P} would skip rev ${prev.comments}->${cur.comments} (pages ${JSON.stringify(cur.commentPages)}) but its delta is ${JSON.stringify(d).slice(0, 200)}`);
    }
  }
  // end-to-end: a tab on each page that followed the hops and pulled/skipped must end with the same set as the server
  return { prevRev, last: s.msgs[s.msgs.length - 1] };
}
test('start', async () => {
  await up(B + '/', { fail: () => assert.fail('no start') });
});
test('skips only when nothing is new for that page', async () => {
  const s = await live();
  await sleep(300);
  const a = await post('/index', 'a');
  const o = await post('/other', 'o');
  const u = await post('/_c3_bcn_c3_af_5fcode', 'u');
  await sleep(300);
  await step(s, 'post index', () => post('/index', 'b'));
  await step(s, 'post sub', () => post('/sub/index', 'b'));
  await step(s, 'three at once', () => Promise.all([post('/index', 'x1'), post('/other', 'x2'), post('/sub/index', 'x3')]));
  await step(s, 'agent reply', () => api({ page: '/index', parent: a.id, text: 'Done: ok', name: 'claude', intent: 'done' }, true));
  await step(s, 'resolve', () => api({ page: '/other', action: 'resolve', id: o.id }));
  await step(s, 'delete', () => api({ page: '/other', action: 'delete', id: o.id }));
  const mv = await post('/mover', 'm');
  await step(s, 'rename file', async () => { fs.renameSync(path.join(DIR, 'mover.html'), path.join(DIR, 'moved.html')); await sleep(1500); await fetch(B + '/_lab/pages').catch(() => {}); });
  await step(s, 'agent wait handoff', async () => {
    const p = spawn(process.execPath, [LAB, 'wait', '--timeout', '5', '--name', 'cp'], { cwd: DIR, env });
    await new Promise((r) => p.on('close', r));
  });
  console.log(JSON.stringify(s.msgs.map((m) => [m.comments, m.commentPages])));
  s.close();
  assert.deepEqual(problems, []);
});
