// Repro: a page's comments do not follow `mv` when the lab never recorded the page's file (home) before the move.
// SKILL.md says: "Rename or move a page with `mv`: its comments follow the file."
//   1. lab running on a folder with one.html and two.html
//   2. pin on /two, then pin on /one (the second page to get a comment in this lab run), reply on /one
//   3. `mv one.html renamed.html` right away (WAIT_MS=0), the lab keeps running
// Expected: the comments are on /renamed.   Observed: they stay on /one (the file is gone: an orphan page).
// WAIT_MS=3000 (a pause before the mv) shows whether it is a timing thing. HOW=stopped (the lab stopped across the mv)
// and HOW=into-folder (one.html moved to moved/renamed.html, page /moved/renamed) also work.
// Run: node test/torture/repros/rename-follow.mjs   (exit 0 always; prints PASS, BUG, or ERROR when the setup failed)
import fs from 'node:fs';
import path from 'node:path';
import { claimPort, spawnLab, up, tmp, rm, stop, serverJson, sleep } from '../../harness.mjs';

const DIR = tmp('rename-follow');
const PORT = claimPort(24700, 100);
const B = `http://localhost:${PORT}`;
const WAIT_MS = Number(process.env.WAIT_MS ?? 0);
const HOW = process.env.HOW ?? 'running';
if (!['running', 'stopped', 'into-folder'].includes(HOW)) {
  console.log(`ERROR: HOW=${HOW}: running, stopped or into-folder`);
  process.exit(0);
}
const [DEST, DEST_PAGE] = HOW === 'into-folder' ? ['moved/renamed.html', '/moved/renamed'] : ['renamed.html', '/renamed'];
const anchor = { selector: 'h1', x: 0.1, y: 0.5, docX: 0.1, docY: 20, width: 1000, element: '<h1>' };
// Each setup comment must be made: a refused one would make a correct move look like a lost comment.
const post = async (body) => {
  const r = await fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify(body) });
  const json = await r.json().catch(() => ({}));
  if (r.status !== 201 || !json.comment) throw new Error(`setup: the ${body.parent ? 'reply' : 'pin'} on ${body.page} answered ${r.status} ${JSON.stringify(json).slice(0, 120)}`);
  return json;
};
const list = async (page) => (await (await fetch(`${B}/_lab/api/comments?page=${encodeURIComponent(page)}`)).json()).comments;
let lab = spawnLab(DIR, PORT, { stdio: 'ignore' });
try {
  for (const n of ['one', 'two']) fs.writeFileSync(path.join(DIR, `${n}.html`), `<!doctype html><title>${n}</title><h1>${n}</h1>`);
  await up(`${B}/`);
  // ONE_ONLY=1: no pin on /two at all. FIRST_ONE=1: /one is the first page pinned. Both make the mv work (see report).
  if (!process.env.ONE_ONLY && !process.env.FIRST_ONE) await post({ page: '/two', name: 'Leo', text: 'on two', anchor });
  const pin = (await post({ page: '/one', name: 'Leo', text: 'on one', anchor })).comment;
  if (process.env.FIRST_ONE) await post({ page: '/two', name: 'Leo', text: 'on two', anchor });
  await post({ page: '/one', name: 'Leo', text: 'reply', parent: pin.id });
  await sleep(WAIT_MS);
  if (HOW === 'stopped') await stop(lab);
  if (HOW === 'into-folder') fs.mkdirSync(path.join(DIR, 'moved'));
  fs.renameSync(path.join(DIR, 'one.html'), path.join(DIR, DEST));
  if (HOW === 'stopped') {
    lab = spawnLab(DIR, PORT, { stdio: 'ignore' });
    await up(`${B}/`);
  }
  let there = [];
  for (let i = 0; i < 40 && !there.length; i++) {
    await sleep(100);
    there = await list(DEST_PAGE);
  }
  const still = await list('/one');
  if (there.length === 2 && !still.length) console.log(`PASS: both comments followed one.html to ${DEST_PAGE} (WAIT_MS=${WAIT_MS}, HOW=${HOW})`);
  else console.log(`BUG: after mv one.html ${DEST}, ${DEST_PAGE} has ${there.length} comments, /one still has ${still.length} (expected 2 and 0) (WAIT_MS=${WAIT_MS}, HOW=${HOW})`);
} catch (e) {
  console.log(`ERROR: ${e.message}`);
} finally {
  await stop(lab);
  rm([DIR], { maxRetries: 5 });
}
process.exit(0);
