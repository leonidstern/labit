// Sig 3. One burst: a new folder with 51 .css files, plus an edit of index.html. local.mjs ~l.1283-1290: the new
// folder itself is a non-hot "change" (changed = ["/bulk"], not used by the page => the page must not reload) and the
// hot list is cut to the first 50 entries, which are all bulk/*.css; index.html is entry 52 and is dropped. The page
// gets neither a reload nor a patch.
import { repro, page, verdict, sleep, fs, path } from './_kit.mjs';
await repro('over-50', { 'index.html': page(), 's.css': 'main{}' }, async ({ B, dir, browser, w }) => {
  const p = await browser.newPage();
  await p.goto(B + '/');
  await sleep(2000);
  fs.mkdirSync(path.join(dir, 'bulk'));
  for (let i = 0; i < 51; i++) fs.writeFileSync(path.join(dir, `bulk/f${i}.css`), `/* ${i} */`);
  w('index.html', page().replace('hello', 'changed'));
  await sleep(5000);
  const text = await p.evaluate(() => document.getElementById('m').textContent);
  await p.reload();
  const control = await p.evaluate(() => document.getElementById('m').textContent);
  if (control !== 'changed') console.log(`ERROR control failed: manual reload shows ${control}`);
  verdict(text === 'changed', 'index.html saved in a burst with 51 other files shows on the open page', `<main> says "${text}" 5 s after the save`, '"changed"');
});
