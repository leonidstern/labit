// Sig 6. A page's HTML and CSS are fetched, then the widget (comments.js, defer) starts and opens /_lab/live. The page's
// HTML is stamped with data-version (the "files" count) but not with the "hot" count, so a CSS/HTML save that lands
// after the page was fetched and before its first live message is lost: live.ts onState keeps `hotAt === null` until the
// first message and only then takes v.hot as its baseline (`hotAt !== null && v.hot !== hotAt`). comments.js is held
// 2 s here to make the window wide (a slow phone, a heavy page).
import { repro, page, verdict, sleep } from './_kit.mjs';
await repro('before-first', { 'index.html': page(), 's.css': 'main{color:rgb(1,2,3)}' }, async ({ B, browser, w }) => {
  const p = await browser.newPage();
  await p.route('**/_lab/comments.js*', async (route) => (await sleep(2000), route.continue()));
  const nav = p.goto(B + '/', { waitUntil: 'commit' });
  await sleep(700); // HTML and s.css are in
  w('s.css', 'main{color:rgb(9,8,7)}');
  await nav;
  await sleep(6000);
  const color = () => p.evaluate(() => getComputedStyle(document.getElementById('m')).color);
  const c = await color();
  await p.reload({ waitUntil: 'commit' });
  await sleep(4000);
  const after = await color();
  if (after !== 'rgb(9, 8, 7)') console.log(`ERROR control failed: manual reload shows ${after}`);
  verdict(c === 'rgb(9, 8, 7)', 'css saved between page load and its first live message shows', `color ${c} 6 s after the widget connected`, 'rgb(9, 8, 7)');
});
