// An open page follows its files (live reload of lab pages), in real browsers: a module the page's script imports, a page
// that is gone for a moment and comes back, a stylesheet saved while the lab was stopped, a stylesheet saved before the
// page's first live message, a page opened in another letter case. Each check saves a file and looks at what the open page
// shows a few seconds later.
// Not part of `npm test`; CI runs it in the `browser` job. Run: node test/browser/livereload.mjs (needs playwright;
// NODE_PATH can point at one). One line per check; exits 1 if any fails.
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });

const DIR = tmp('labit-livereload-');
const PORT = String(claimPort(10700, 30));
const B = `http://localhost:${PORT}`;
const html = (extra = '', text = 'hello') => `<!doctype html><meta charset="utf-8"><title>t</title><link rel="stylesheet" href="s.css"><main id="m">${text}</main>${extra}`;
const save = (f, t) => fs.writeFileSync(path.join(DIR, f), t);
const color = (r, g, b) => `main{color:rgb(${r},${g},${b})}`;
const env = labEnv({}, { settings: false });
let server = null;
const start = async () => {
  server = startLab(DIR, env, { root: '.', port: PORT });
  await labUp(B);
};
const stop = () => new Promise((done) => (server.once('exit', done), server.kill()));
const until = async (ok, ms = 7000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) {
    try {
      if (await ok()) return true;
    } catch {} // a read while the page navigates throws: look again
  }
  return false;
};
const text = (p) => p.evaluate(() => document.getElementById('m')?.textContent ?? null);
const col = (p) => p.evaluate(() => getComputedStyle(document.getElementById('m')).color);

save('s.css', color(1, 2, 3));
save('index.html', html('<script type="module" src="main.js"></script>'));
save('main.js', 'import "./dep.js";');
save('dep.js', 'document.documentElement.dataset.dep="v1";');
save('plain.html', html());
save('imp.html', '<!doctype html><meta charset="utf-8"><title>t</title><link rel="stylesheet" href="top.css"><link rel="stylesheet" href="side.css"><main id="m">imp</main>');
save('top.css', '@import "base.css";');
save('base.css', color(1, 2, 3));
save('side.css', 'i{color:red}');
save('gone.html', html('', 'v1'));
save('Caps.html', html());
await start();
try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const open = async (url, wait = 1500) => {
        const p = await browser.newPage();
        await p.goto(B + url);
        await p.waitForSelector('script[data-live]', { state: 'attached', timeout: 5000 });
        await sleep(wait); // the page has heard the live stream's first message
        return p;
      };

      // A module the page's script imports: the page reloads (it only has that module in what it loaded).
      let p = await open('/');
      await p.evaluate(() => (window.kept = 1)); // a reload loses it
      save('dep.js', 'document.documentElement.dataset.dep="v2";');
      check(eng, 'saving a module the page imports reloads the page', await until(() => p.evaluate(() => document.documentElement.dataset.dep === 'v2')), await p.evaluate(() => document.documentElement.dataset.dep));
      // A script of another page leaves it alone.
      save('other.js', 'x');
      await sleep(1000);
      check(eng, 'a script this page does not load leaves it alone', await p.evaluate(() => document.documentElement.dataset.dep === 'v2'));
      await p.evaluate(() => (window.kept = 2));
      save('other.js', 'y');
      await sleep(1000);
      check(eng, 'and the page was not reloaded for it', await p.evaluate(() => window.kept === 2));
      await p.close();

      // The page's file is gone for a moment: the open page stays and shows the file when it is back.
      for (const gap of [0, 600]) {
        p = await open('/gone');
        fs.rmSync(path.join(DIR, 'gone.html'));
        await sleep(gap);
        save('gone.html', html('', `back${gap}`));
        check(eng, `a page whose file is gone for ${gap} ms shows the file when it is back`, await until(async () => (await text(p)) === `back${gap}`), String(await text(p)));
        await p.close();
      }

      // The index page is gone for 3 s and a script it loads is saved meanwhile: the page reloads for that, and the lab answers
      // "/" with its page list (200, no widget). The open page stays on its own copy and shows the file when it is back.
      p = await open('/');
      const index = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
      fs.rmSync(path.join(DIR, 'index.html'));
      await sleep(300);
      save('dep.js', 'document.documentElement.dataset.dep="v3";');
      await sleep(3000);
      check(eng, 'an index page that is gone while its script is saved keeps its widget', await p.evaluate(() => Boolean(document.querySelector('script[data-live]'))));
      save('index.html', index.replace('hello', 'idx-back'));
      check(eng, 'and shows the index page when it is back', await until(async () => (await text(p)) === 'idx-back'), String(await text(p)));
      await p.close();

      // A stylesheet saved before the page's first live message.
      p = await browser.newPage();
      await p.route('**/_lab/comments.js*', async (route) => (await sleep(1500), route.continue()));
      save('s.css', color(1, 2, 3));
      const nav = p.goto(B + '/plain', { waitUntil: 'commit' });
      await sleep(500); // the page and its stylesheet are in; the widget is held
      save('s.css', color(9, 8, 7));
      await nav;
      check(eng, 'a stylesheet saved before the page heard its first live message shows', await until(async () => (await col(p)) === 'rgb(9, 8, 7)', 9000), await col(p));
      await p.close();

      // A page and its stylesheet saved together: patched in place (the stylesheet being swapped in is not a changed list of sheets).
      p = await open('/plain');
      await p.evaluate(() => (window.kept = 1));
      save('plain.html', html('', 'both'));
      save('s.css', color(2, 3, 4));
      check(eng, 'a page saved with its stylesheet updates in place', (await until(async () => (await text(p)) === 'both' && (await col(p)) === 'rgb(2, 3, 4)')) && (await p.evaluate(() => window.kept === 1)), `${await text(p)} ${await col(p)}`);
      // And a half-written file does not take the widget with it: the page stays and follows the file when it is whole.
      save('plain.html', html('', 'whole').slice(0, 90));
      await sleep(1500);
      check(eng, 'a page cut short on disk stays as it is, with its widget', await p.evaluate(() => window.kept === 1 && Boolean(document.querySelector('script[data-live]'))));
      save('plain.html', html('', 'whole'));
      check(eng, 'and shows the whole file when it is saved again', await until(async () => (await text(p)) === 'whole'), String(await text(p)));
      await p.close();

      // A stylesheet that is only @imported, saved together with another one the page links: both show (the imported one is
      // not named by a link, so the sheets that import it are swapped too).
      p = await open('/imp');
      save('base.css', color(5, 6, 7));
      save('side.css', 'i{color:blue}');
      check(eng, 'an @imported stylesheet saved with another one shows', await until(async () => (await col(p)) === 'rgb(5, 6, 7)'), await col(p));
      await p.close();

      // A page opened in another letter case (a disk that ignores case: macOS, Windows).
      if ((await fetch(`${B}/caps.html`)).status === 200) {
        p = await open('/caps.html');
        save('Caps.html', html('', 'changed'));
        check(eng, 'saving Caps.html updates the page opened as /caps.html', await until(async () => (await text(p)) === 'changed'), String(await text(p)));
        await p.close();
      }

      // A stylesheet saved while the lab was stopped: the page catches up when the lab is back.
      save('s.css', color(1, 2, 3));
      p = await open('/plain');
      await stop();
      save('s.css', color(4, 5, 6));
      await start();
      check(eng, 'a stylesheet saved while the lab was stopped shows when it is back', await until(async () => (await col(p)) === 'rgb(4, 5, 6)', 12000), await col(p));
      await p.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  server?.kill();
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
}
finish();
