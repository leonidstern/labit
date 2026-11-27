// A reload the dev server makes, behind --proxy, comes back as the lab's own does: the scroll, typed words and the open
// thread are there again (they used to be lost: only the lab's reload kept them). Next's reloadPage message waits while a
// thread is open, as Vite's full-reload does. Leaving the page and coming back starts it fresh.
// Not part of `npm test`; CI runs it in the `browser` job. Run: node test/browser/proxyreload.mjs (needs playwright;
// NODE_PATH can point at a node_modules that has it). One line per check; exits 1 if any fails.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });

const DIR = fs.realpathSync(tmp('labit-proxyreload-'));
const PORT = claimPort(11400, 60);
const APP_PORT = claimPort(11460, 60); // claimed too: another program on PORT + 60 stopped the app before any check
const B = `http://localhost:${PORT}`;
fs.writeFileSync(`${DIR}/labit.json`, JSON.stringify({ port: PORT }));
const lines = (n) => Array.from({ length: n }, (_, i) => `<p>Paragraph number ${i} with some words in it.</p>`).join('');
// An app with a dev server's client: a socket that reloads the page on Next's message, as Next's own client does.
const client = `<script>const ws=new WebSocket('ws://'+location.host+'/_hmr');ws.onmessage=(e)=>{if(JSON.parse(e.data).type==='reloadPage')location.reload()}</script>`;
const app = http.createServer((req, res) => {
  if (req.url === '/favicon.ico') return void res.writeHead(404).end('no');
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><meta charset="utf-8"><title>app</title>${client}<body><h1>App</h1><input id="in">${lines(40)}<p id="p">Some words to pin.</p>${lines(80)}</body>`);
});
const sockets = new Set();
app.on('upgrade', (req, socket) => {
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
  socket.on('error', () => sockets.delete(socket));
});
const sendAll = (text) => {
  const body = Buffer.from(text);
  for (const s of sockets) s.write(Buffer.concat([Buffer.from([0x81, body.length]), body]));
};
await new Promise((done) => app.listen(APP_PORT, done));
const server = startLab(DIR, labEnv(), { args: ['--proxy', String(APP_PORT)] });
await labUp(B);
const seed = (page) =>
  fetch(`${B}/_lab/api/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: B },
    body: JSON.stringify({ page, name: 'Leo', text: 'A note', anchor: { selector: '#p', x: 0.2, y: 0.5, docX: 0.2, docY: 1200, width: 1000, element: '<p id="p">' } }),
  });

try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    const page = `/${eng}-page`;
    await seed(page);
    try {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await ctx.addInitScript(() => localStorage.setItem('lab-name', 'leo'));
      const pg = await ctx.newPage();
      const inRoot = (sel) => pg.evaluate((s) => {
        const b = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.more'))?.shadowRoot?.querySelector(s)?.getBoundingClientRect();
        return b && b.width ? { x: Math.round(b.x), y: Math.round(b.y) } : null;
      }, sel);
      const ready = async () => {
        await pg.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.pin')), null, { timeout: 8000 });
        await sleep(800);
        await pg.evaluate(() => (window.__kept = 1));
      };
      const openThread = async () => {
        await pg.evaluate(() => { document.getElementById('p').scrollIntoView(); scrollBy(0, -200); });
        await sleep(400);
        const pin = await inRoot('.pin');
        await pg.mouse.click(pin.x + 10, pin.y + 10);
        await sleep(600);
      };

      // The dev server's client calls location.reload() itself (Next's Fast Refresh after an error, or any reload of its own).
      await pg.goto(B + page);
      await ready();
      await pg.fill('#in', 'typed');
      await pg.evaluate(() => document.activeElement.blur());
      await openThread();
      const y = await pg.evaluate(() => Math.round(scrollY));
      const before = await inRoot('.card');
      await pg.evaluate(() => location.reload());
      await pg.waitForFunction(() => !window.__kept && [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.card')), null, { timeout: 8000 }).catch(() => {});
      await sleep(800);
      const s = await pg.evaluate(() => ({ reloaded: !window.__kept, y: Math.round(scrollY), input: document.getElementById('in').value }));
      const after = await inRoot('.card');
      check(eng, 'a reload the dev server makes (control: the page did reload)', s.reloaded, JSON.stringify(s));
      check(eng, 'after it the scroll comes back', Math.abs(s.y - y) < 3, `${y} -> ${s.y}`);
      check(eng, 'after it typed words come back', s.input === 'typed', JSON.stringify(s));
      check(eng, 'after it the open thread is open again', Boolean(before && after), JSON.stringify({ before, after }));

      // Next's reloadPage message waits while the thread is open, and goes through once it is closed.
      await pg.evaluate(() => (window.__kept = 1));
      sendAll(JSON.stringify({ type: 'reloadPage', data: 'request' }));
      await sleep(1500);
      const held = await pg.evaluate(() => window.__kept === 1);
      check(eng, "Next's reloadPage waits while a thread is open", held);
      await pg.keyboard.press('Escape');
      await pg.keyboard.press('Escape');
      const went = await pg.waitForFunction(() => !window.__kept, null, { timeout: 8000 }).then(() => true, () => false);
      check(eng, 'and the page reloads once the thread is closed', went);

      // Away and back: a fresh start, not the place it had.
      await ready();
      await pg.evaluate(() => scrollTo(0, 1500));
      await sleep(300);
      await pg.goto(B + '/elsewhere');
      await sleep(500);
      await pg.goto(B + page);
      await ready();
      const y2 = await pg.evaluate(() => Math.round(scrollY));
      check(eng, 'leaving the page and coming back starts it at the top', y2 === 0, String(y2));
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  app.close();
  app.closeAllConnections();
  for (const s of sockets) s.destroy();
}
finish();
