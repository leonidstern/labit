// Sig 2. The page is opened as /caps.html but the file is Caps.html (case-insensitive disk: macOS, Windows). The lab
// says the save is of "/Caps.html"; live.ts hotUpdate() (~l.395) compares it to location.pathname with ===, so
// "/Caps" != "/caps" and the page never patches itself.
import { repro, page, verdict, sleep } from './_kit.mjs';
await repro('letter-case', { 'Caps.html': page(), 's.css': 'main{}' }, async ({ B, browser, w, dir }) => {
  const r = await fetch(B + '/caps.html');
  if (r.status !== 200) return console.log(`SKIP this disk is case-sensitive (/caps.html -> ${r.status})`);
  const p = await browser.newPage();
  await p.goto(B + '/caps.html');
  await sleep(2000);
  w('Caps.html', page().replace('hello', 'changed'));
  await sleep(5000);
  const text = await p.evaluate(() => document.getElementById('m').textContent);
  await p.reload();
  const control = await p.evaluate(() => document.getElementById('m').textContent);
  if (control !== 'changed') console.log(`ERROR control failed: manual reload shows ${control}`);
  verdict(text === 'changed', 'saving Caps.html updates the page opened as /caps.html', `<main> says "${text}" 5 s after the save`, '"changed"');
});
