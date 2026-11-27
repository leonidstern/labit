// Saves that arrive close together must not leave a page worse off: a stylesheet saved with a picture nothing on the page shows
// (two swaps of one file at once), a page saved with its stylesheet (patched in place, not reloaded), and a saved CSS file
// that was missed while the stream was down. Run: node test/browser/hotrace.mjs (needs playwright; NODE_PATH can point at one).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, freshLab, sleep, check, finish } from './harness.mjs';

const pw = playwright();
const PORT = claimPort(10900, 30);
const B = `http://localhost:${PORT}`;
const svg = (w) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="10"><rect width="${w}" height="10" fill="red"/></svg>`;
const page = (h) => `<!doctype html><html><head><meta charset="utf-8"><title>t</title><link rel="stylesheet" href="s.css"></head><body><main id="m">${h}<img id="i" src="p.svg"></main></body></html>`;
// Each engine on a lab of its own, from these files: the saves below change them.
const L = freshLab('labit-hotrace-', (dir) => {
  const w = (f, t) => fs.writeFileSync(path.join(dir, f), t);
  w('index.html', page('hello'));
  w('s.css', 'main{color:rgb(255,0,0);background:url(bg.svg)}');
  w('bg.svg', svg(10));
  w('p.svg', svg(30));
  w('data.json', '{"n":1}');
  w('labit.json', JSON.stringify({ port: PORT }));
}, { base: B });
const w = (f, t) => fs.writeFileSync(path.join(L.dir, f), t);
try {
  for (const eng of engines()) {
    await L.up();
    const browser = await pw[eng].launch();
    try {
      const pg = await (await browser.newContext()).newPage();
      await pg.goto(B + '/');
      await sleep(1800);
      const links = () => pg.evaluate(() => document.querySelectorAll('link[rel=stylesheet]').length);
      const color = () => pg.evaluate(() => getComputedStyle(document.getElementById('m')).color);
      let lost = 0;
      for (let i = 0; i < 6; i++) {
        w('s.css', `main{color:rgb(0,0,${200 + i});background:url(bg.svg)}`);
        w('bg.svg', svg(20 + i));
        await sleep(1300);
        if (!(await links())) {
          lost++;
          await pg.reload();
          await sleep(1000);
        }
      }
      check(eng, 'a stylesheet saved with a picture no element shows keeps its stylesheet (6 rounds)', lost === 0, `${lost} rounds lost it`);
      check(eng, '… and shows the newest colour', (await color()) === 'rgb(0, 0, 205)', await color());

      let loads = 0;
      pg.on('load', () => loads++);
      w('index.html', page('hello again'));
      w('s.css', 'main{color:rgb(0,128,0);background:url(bg.svg)}');
      await sleep(1500);
      check(eng, 'a page saved with its stylesheet is patched, not reloaded', loads === 0 && (await pg.textContent('#m')) === 'hello again', `loads ${loads}`);
      check(eng, '… and its stylesheet is the new one', (await color()) === 'rgb(0, 128, 0)' && (await links()) === 1, `${await color()}, ${await links()} links`);

      // A file the page never loaded (a package.json, a note) leaves it alone.
      loads = 0;
      w('package.json', '{"a":1}');
      w('notes.txt', 'one');
      await sleep(1200);
      check(eng, 'a file the page never loaded leaves it alone', loads === 0, `loads ${loads}`);
      // A picture only a stylesheet shows: its address in the CSS gets a new version, in place (the browser keeps its copy of the old one).
      const bgUrl = () => pg.evaluate(() => getComputedStyle(document.getElementById('m')).backgroundImage);
      const before = await bgUrl();
      w('bg.svg', svg(77));
      await sleep(1500);
      const after = await bgUrl();
      check(eng, 'a picture only a stylesheet shows is swapped in place: no reload, a new address', loads === 0 && after !== before && /lab-v=/.test(after), `loads ${loads}, ${before} -> ${after}`);
      // After that the next stylesheet save loads the page again: a sheet loaded again would bring the old address back.
      w('s.css', 'main{color:rgb(0,0,99);background:url(bg.svg)}');
      await sleep(1800);
      check(eng, 'the next stylesheet save after that loads the page again', loads === 1 && (await color()) === 'rgb(0, 0, 99)', `loads ${loads}, ${await color()}`);
      // A picture whose file is deleted and written again a moment later: the old one stays showing meanwhile, then the new one.
      loads = 0;
      const wide = () => pg.evaluate(() => document.getElementById('i').naturalWidth);
      fs.rmSync(path.join(L.dir, 'p.svg'));
      await sleep(700);
      check(eng, 'a picture whose file is gone stays showing', (await wide()) === 30 && (await pg.getAttribute('#i', 'src')) === 'p.svg', `${await wide()} ${await pg.getAttribute('#i', 'src')}`);
      w('p.svg', svg(50));
      await sleep(1000);
      check(eng, '… and the new one shows once the file is back, without a reload', (await wide()) === 50 && loads === 0, `${await wide()}, loads ${loads}`);
      await pg.evaluate(() => fetch('/data.json').then((r) => r.text()));
      loads = 0;
      w('data.json', '{"n":2}');
      await sleep(1500);
      check(eng, 'a data file the page fetched loads it again', loads === 1, `loads ${loads}`);
    } finally {
      await browser.close();
    }
  }
  finish();
} finally {
  await L.stop();
}
