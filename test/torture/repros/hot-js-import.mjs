// Sig 5. A page loads <script type=module src=main.js>, main.js imports dep.js. Saving dep.js sends the page a
// "files changed: /dep.js" message; live.ts usedHere() (~l.150) only looks at the page's own <script src>/<link href>,
// so dep.js counts as "not used here" and the page neither reloads nor tells anyone: it keeps the old module.
import { repro, page, verdict, sleep } from './_kit.mjs';
await repro('js-import', {
  'index.html': page('<script type="module" src="main.js"></script>'),
  's.css': 'main{}',
  'main.js': 'import "./dep.js";',
  'dep.js': 'document.documentElement.dataset.dep="v1";',
}, async ({ B, browser, w }) => {
  const p = await browser.newPage();
  await p.goto(B + '/');
  await sleep(2000);
  w('dep.js', 'document.documentElement.dataset.dep="v2";');
  await sleep(5000);
  const dep = await p.evaluate(() => document.documentElement.dataset.dep);
  await p.reload();
  const control = await p.evaluate(() => document.documentElement.dataset.dep);
  if (control !== 'v2') console.log(`ERROR control failed: manual reload shows ${control}`);
  verdict(dep === 'v2', 'saving an imported module updates the open page', `dataset.dep = ${dep} 5 s after the save (page never reloaded)`, 'v2 (page reloads like for main.js)');
});
