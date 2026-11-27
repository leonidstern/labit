// Sig 1. A page is open; the lab stops; s.css is saved while it is down; the lab starts again (same port, same folder).
// The page reconnects ("lab restarted": live.ts onState ~l.480) and only re-fetches its HTML (morphPage), never its
// stylesheets/pictures, so it keeps showing the old CSS until a manual reload.
import { repro, page, verdict, sleep } from './_kit.mjs';
await repro('restart-css', { 'index.html': page(), 's.css': 'main{color:rgb(1,2,3)}' }, async ({ B, start, stopLab, browser, w }) => {
  const p = await browser.newPage();
  await p.goto(B + '/');
  const color = () => p.evaluate(() => getComputedStyle(document.getElementById('m')).color);
  await sleep(1500); // the widget has heard its first live message
  await stopLab();
  w('s.css', 'main{color:rgb(9,8,7)}');
  await start();
  await sleep(6000); // EventSource retries in ~3 s; give it time to reconnect and "catch up"
  const c = await color();
  await p.reload();
  const after = await color(); // control: a manual reload does show the file
  if (after !== 'rgb(9, 8, 7)') console.log(`ERROR control failed: manual reload shows ${after}`);
  verdict(c === 'rgb(9, 8, 7)', 'css saved while the lab was stopped shows after it is back', `color ${c}`, 'rgb(9, 8, 7) (the file on disk)');
});
