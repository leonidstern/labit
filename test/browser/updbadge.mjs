// The "update waiting" badge in real browsers (WebKit and Chrome's engine): a reload held while something is open puts a
// green "!" on the labit mark (the pill on a computer, the chat button on a phone, the ⋯ when no mark shows), the host's
// label says so meanwhile (and keeps the pill's own words aside, a new status included), a tap on the host takes the
// update at once without opening the ⋯ menu or following the pill's link, and when the reload happens the badge goes and
// the host gets its own label back. Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/updbadge.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, freshLab, labEnv, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });

const PORT = String(claimPort(5600, 190)); // below 6000: browsers refuse that port (X11)
const B = `http://localhost:${PORT}`;
const UPD_LABEL = 'update waiting, tap to load';
const SESSION_URL = 'https://claude.ai/code/session_updbadge';
const write = (f, t) => fs.writeFileSync(path.join(L.dir, f), t);
// Each engine on a lab of its own: the one before it had an agent listening there.
const L = freshLab('labit-updbadge-', () => {
  write('index.html', '<!doctype html><meta charset="utf-8"><title>upd</title><style>body{margin:30px}</style><h1>Update badge</h1><p>text</p>');
  write('data.json', '{"a":0}'); // a file the page may fetch: a save of it reloads the page
}, { env: () => labEnv({}, { settings: false }), root: '.', port: PORT, stdio: 'ignore', base: B });
let saves = 0;
const save = () => write('data.json', JSON.stringify({ a: ++saves }));
const waitFor = async (ok, ms) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(40)) if (await ok()) return true;
  return false;
};
// The widget's shadow root, and a function run in it.
const inRoot = (p, fn, arg) =>
  p.evaluate(([src, a]) => {
    const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.more'))?.shadowRoot;
    return r ? new Function('r', 'a', `return (${src})(r, a)`)(r, a) : null;
  }, [fn.toString(), arg]);
// Where the badge is and what its host says.
const badge = (p) =>
  inRoot(p, (r) => {
    const u = r.querySelector('.upd');
    const host = u?.parentElement;
    const name = !host ? '' : host.classList.contains('listener') ? 'pill' : host.classList.contains('chat-btn') ? 'chat' : host.classList.contains('more') ? 'more' : host.className;
    return { shown: Boolean(u && !u.hidden), host: name, label: host?.getAttribute('aria-label') ?? null, kept: host?.dataset.updLabel ?? null, hasUpd: host?.classList.contains('has-upd') || false, others: [...r.querySelectorAll('.has-upd')].length };
  });
// Saved as the page unloads (after the widget let go of the badge), read back once the new page is in.
const snapOnUnload = (p) =>
  p.evaluate(() => {
    let pressed = 0; // when the last press began: a tap that takes the update reloads at once, not when the 1.5 s hold after a touch ends
    addEventListener('pointerdown', () => (pressed = performance.now()), true);
    // A click that got past the badge's host to the window: what it did on its way (the page may be unloading already,
    // so what it opened or followed would only flash; it must not get here at all, or come prevented and having opened nothing).
    sessionStorage.removeItem('upd-click');
    const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.more'))?.shadowRoot;
    const got = (e) => sessionStorage.setItem('upd-click', JSON.stringify({ prevented: e.defaultPrevented, menuOpen: !r.querySelector('.more-menu').hidden }));
    // On the hosts themselves too (after the widget's own listeners there, so the ⋯ menu has opened if it was going to).
    for (const n of [window, r.querySelector('a.listener'), r.querySelector('.more'), r.querySelector('.chat-btn')]) n.addEventListener('click', got);
    addEventListener('beforeunload', () => {
      const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.more'))?.shadowRoot;
      const who = r.querySelector('a.listener');
      const more = r.querySelector('.more');
      const menu = r.querySelector('.more-menu');
      sessionStorage.setItem('upd-snap', JSON.stringify({
        updHidden: r.querySelector('.upd')?.hidden ?? true, hasUpd: r.querySelectorAll('.has-upd').length,
        whoLabel: who.getAttribute('aria-label'), whoKept: who.dataset.updLabel ?? null,
        moreLabel: more.getAttribute('aria-label'), moreKept: more.dataset.updLabel ?? null,
        menuOpen: Boolean(menu && !menu.hidden), expanded: more.getAttribute('aria-expanded'), url: location.href,
        afterPress: pressed ? Math.round(performance.now() - pressed) : null,
      }));
    });
  });
const snap = (p) => p.evaluate(() => ({ ...JSON.parse(sessionStorage.getItem('upd-snap') || 'null'), click: JSON.parse(sessionStorage.getItem('upd-click') || 'null') }));
const clickStopped = (s) => !s.click || (s.click.prevented && !s.click.menuOpen);
// A listening agent, with a session link, till the engine's run ends (a new one for each engine: the next one starts with none).
let listen = new AbortController();
const agentListens = () => {
  const key = JSON.parse(fs.readFileSync(path.join(L.dir, '.lab/server.json'), 'utf8')).agent;
  const sess = { id: 'sess-upd', name: 'upd test', agent: 'Claude', kind: 'claude', url: SESSION_URL };
  fetch(`${B}/_lab/wait`, { method: 'POST', signal: listen.signal, headers: { 'content-type': 'application/json', origin: B, 'x-lab-admin': key, 'x-lab-agent': '1', 'x-lab-session': encodeURIComponent(JSON.stringify(sess)) }, body: JSON.stringify({ timeout: 600 }) }).catch(() => {});
};

try {
  for (const eng of engines()) {
    await L.up();
    listen = new AbortController();
    const browser = await pw[eng].launch();
    try {
      // A computer: the badge sits on the pill's mark.
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await ctx.addInitScript(() => localStorage.setItem('lab-name', 'leo'));
      await ctx.addInitScript(() => addEventListener('load', () => fetch('/data.json').catch(() => {}))); // the page uses data.json: a save of it reloads the page
      const p = await ctx.newPage();
      let popups = 0;
      ctx.on('page', () => popups++); // a page the pill's link opens (target _blank)
      let loads = 0;
      p.on('load', () => loads++);
      await p.goto(B + '/');
      const pillShows = () => inRoot(p, (r) => { const w = r.querySelector('a.listener'); return Boolean(w && !w.hidden && w.getClientRects().length && w.querySelector('.mark')); });
      await waitFor(pillShows, 4000);
      await sleep(1600); // a reload waits while you've just pressed a key or clicked
      const away = await inRoot(p, (r) => r.querySelector('a.listener').getAttribute('aria-label'));

      // Held by the open chat: the badge on the pill, which says "update waiting" and keeps its words aside.
      await p.keyboard.press('t');
      await waitFor(() => inRoot(p, (r) => r.querySelector('.chatwin')?.hidden === false), 2000);
      save();
      await waitFor(async () => (await badge(p))?.shown, 4000);
      let b = await badge(p);
      check(eng, 'a held reload shows the badge on the pill, where the agent mark shows', b.shown && b.host === 'pill' && b.hasUpd && b.others === 1, JSON.stringify(b));
      check(eng, "the pill's label says an update waits, its own words kept aside", b.label === UPD_LABEL && b.kept === away && /no agent/i.test(away), `${JSON.stringify(b)} away ${away}`);
      check(eng, 'held: the page has not reloaded', loads === 1, `loads ${loads}`);
      // A status update while it waits: the label still says "update waiting", the new words are kept for after.
      agentListens();
      await waitFor(async () => /Claude is listening/.test((await badge(p))?.kept || ''), 4000);
      b = await badge(p);
      check(eng, "a new status while held is kept aside, the label still says an update waits", b.label === UPD_LABEL && /Claude is listening/.test(b.kept || ''), JSON.stringify(b));
      // Closing the chat lets the reload through: the badge goes and the pill's latest words come back.
      await snapOnUnload(p);
      await p.keyboard.press('Escape');
      await waitFor(() => loads === 2, 4000);
      await waitFor(pillShows, 4000);
      const gone = await snap(p);
      check(eng, 'closed, the held reload goes through', loads === 2, `loads ${loads}`);
      check(eng, 'as it goes the badge is hidden and no host is marked', gone?.updHidden === true && gone?.hasUpd === 0, JSON.stringify(gone));
      check(eng, "the pill's own label is back, with the status that came while held", /Claude is listening/.test(gone?.whoLabel || '') && gone?.whoLabel !== UPD_LABEL && gone?.whoKept === null, JSON.stringify(gone));

      // A tap on the badge's host takes the update at once, without following the pill's link.
      await waitFor(() => inRoot(p, (r, url) => r.querySelector('a.listener').getAttribute('href') === url, SESSION_URL), 4000);
      const href = await inRoot(p, (r) => r.querySelector('a.listener').getAttribute('href'));
      await sleep(1600);
      await p.keyboard.press('t');
      await waitFor(() => inRoot(p, (r) => r.querySelector('.chatwin')?.hidden === false), 2000);
      save();
      await waitFor(async () => (await badge(p))?.shown, 4000);
      b = await badge(p);
      await sleep(1200); // held: more than the 500 ms the waiting reload checks again in
      const before = loads;
      await snapOnUnload(p);
      await p.locator('a.listener').click({ timeout: 3000 }).catch((e) => console.log(`  (click: ${e.message.split('\n')[0]})`));
      const took = await waitFor(() => loads === before + 1, 3000);
      await waitFor(pillShows, 4000);
      const tapped = await snap(p);
      check(eng, 'held, with the chat still open, the badge is on the pill (which links to the session)', b.shown && b.host === 'pill' && before === 2 && href === SESSION_URL, `${JSON.stringify(b)} loads ${before} href ${href}`);
      check(eng, 'a tap on the pill takes the update: the page reloads at once', took && tapped?.afterPress !== null && tapped.afterPress < 1000, `loads ${loads}, ${tapped?.afterPress} ms after the press`);
      check(eng, "the tap did not follow the pill's link", clickStopped(tapped) && popups === 0 && tapped?.url === B + '/' && p.url() === B + '/', `popups ${popups}, click ${JSON.stringify(tapped?.click)}, ${tapped?.url} ${p.url()}`);

      // No mark showing (the pill hidden, as before the first status comes): the ⋯ carries the badge.
      await sleep(1600);
      await inRoot(p, (r) => r.append(Object.assign(document.createElement('style'), { textContent: '.listener { display: none !important; }' })));
      await p.keyboard.press('t');
      await waitFor(() => inRoot(p, (r) => r.querySelector('.chatwin')?.hidden === false), 2000);
      const moreBefore = await inRoot(p, (r) => r.querySelector('.more').getAttribute('aria-label'));
      save();
      await waitFor(async () => (await badge(p))?.shown, 4000);
      b = await badge(p);
      await sleep(1200);
      check(eng, 'with no mark showing, the badge is on the ⋯ button, which says an update waits', b.shown && b.host === 'more' && b.hasUpd && b.others === 1 && b.label === UPD_LABEL, JSON.stringify(b));
      const before2 = loads;
      await snapOnUnload(p);
      await p.locator('.more').click({ timeout: 3000 }).catch((e) => console.log(`  (click: ${e.message.split('\n')[0]})`));
      const took2 = await waitFor(() => loads === before2 + 1, 3000);
      await waitFor(pillShows, 4000);
      const tapped2 = await snap(p);
      check(eng, 'a tap on the ⋯ takes the update: the page reloads at once', took2 && tapped2?.afterPress !== null && tapped2.afterPress < 1000, `loads ${loads}, ${tapped2?.afterPress} ms after the press`);
      check(eng, 'and did not open the ⋯ menu', clickStopped(tapped2) && !tapped2.menuOpen && tapped2.expanded !== 'true' && tapped2.url === B + '/', JSON.stringify(tapped2));
      check(eng, "the ⋯ had its own label before", moreBefore !== UPD_LABEL, String(moreBefore));
      await p.goto('about:blank');
      await ctx.close();

      // A phone: the mark sits at the bar's right end, as on a computer, so it carries the badge.
      const phone = pw.devices[eng === 'webkit' ? 'iPhone 13' : 'Pixel 7'];
      const pctx = await browser.newContext({ ...phone });
      await pctx.addInitScript(() => localStorage.setItem('lab-name', 'leo'));
      await pctx.addInitScript(() => addEventListener('load', () => fetch('/data.json').catch(() => {}))); // the page uses data.json: a save of it reloads the page
      const q = await pctx.newPage();
      let qloads = 0;
      q.on('load', () => qloads++);
      await q.goto(B + '/');
      await waitFor(() => inRoot(q, (r) => { const w = r.querySelector('a.listener'); return Boolean(w && !w.hidden && w.getClientRects().length && w.querySelector('.mark')); }), 4000);
      await sleep(1600);
      // The button's own click, in the page: Playwright's tap waits for the button to be free of whatever sits over it (the
      // "hold to comment" hint, in the first seconds on an iPhone), and timed out there; what is tested is the badge.
      await inRoot(q, (r) => r.querySelector('.chat-btn').click());
      await waitFor(() => inRoot(q, (r) => r.querySelector('.chatwin')?.hidden === false), 2000);
      save();
      await waitFor(async () => (await badge(q))?.shown, 4000);
      b = await badge(q);
      check(eng, 'on a phone the badge is on the mark at the bar\'s right end, as on a computer', b.shown && b.host === 'pill' && b.hasUpd && b.others === 1 && b.label === UPD_LABEL && qloads === 1, `${JSON.stringify(b)} loads ${qloads}`);
      await q.goto('about:blank');
      await pctx.close();
    } finally {
      listen.abort();
      await browser.close();
    }
  }
} finally {
  listen.abort();
  await L.stop(); // gone before its folder is: the lab writes its .lab files as it stops
  fs.rmSync(L.dir, { recursive: true, force: true, maxRetries: 5 });
}
finish();
