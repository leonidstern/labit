// The section bar in real browsers (WebKit and Chrome's engine): the page's sections along the top, the current one filled,
// "new" and "updated" marked, what reads one (about 3 s in it, scrolling on, a tap), what is kept per person in the lab
// (two devices, two names, the lab's own store and not the looks), the page's own sticky bar, a phone's sideways line above a
// sheet's dimmed page, a computer's bar as wide as its tabs that scrolls sideways under the wheel, and no bar with no sections or no flag. Not part of `npm test`; CI runs it in the
// `browser` job.
// Run: node test/browser/sections.mjs   (needs the playwright package; NODE_PATH can point at a node_modules that has it).
// ENGINES=webkit,chromium picks the engines (both by default).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();

const DIR = fs.realpathSync(tmp('labit-sections-'));
const OFF_DIR = fs.realpathSync(tmp('labit-sections-off-'));
const PORT = claimPort(5700, 200);
const B = `http://localhost:${PORT}`;
const OFF = `http://localhost:${PORT + 200}`;
const env = labEnv();
const write = (f, t, dir = DIR) => fs.writeFileSync(path.join(dir, f), t);
// Four sections far apart (each a screen and a half), after a title.
const sec = (id, title, words = `Words of ${title}.`) => `<section id="${id}"><h2>${title}</h2><p>${words}</p></section>`;
// A lab page (it links /_lab/lab.css), unless lab is false: a project's own HTML.
const page = ({ head = '', body = '', extra = '', title = 'Plan', lab = true, meta = '' } = {}) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${lab ? '<link rel="stylesheet" href="/_lab/lab.css">' : ''}${meta}<style>body{margin:0 30px;font:16px/1.4 serif}h1{margin:50px 0}section{height:1100px}${head}</style><body><h1>${title}</h1>` +
  (body || sec('speed', 'Speed') + sec('cost', 'Cost') + sec('risk', 'Risk') + sec('plan', 'Next steps')) + extra + '</body>';
write('labit.json', JSON.stringify({ port: PORT })); // no flag: the section bar is simply labit
write('index.html', page());
write('plain.html', page({ body: '<p>Only words.</p>' }));
write('sticky.html', page({ head: 'h1{display:none}header{position:sticky;top:0;height:60px;background:#eee;z-index:5}', body: '<header>Site</header>' + sec('a', 'Alpha') + sec('b', 'Beta') + sec('c', 'Gamma') }));
write('zoomed.html', page().replace('initial-scale=1', 'initial-scale=2.5'));
write('tight.html', page({ head: 'h1{margin:0}' }));
write('many.html', page({ body: Array.from({ length: 14 }, (_, i) => sec(`m${i}`, `Section number ${i}`)).join('') }));
// The six rules (Leo, 19 Nov): project HTML, the per-page switch, a 2-section page with headings in site chrome, an app
// shell, and a page that changes its headings by itself.
write('project.html', page({ lab: false }));
write('project-on.html', page({ lab: false, meta: '<meta name="lab-sections" content="on">' }));
write('meta-off.html', page({ meta: '<meta name="lab-sections" content="off">' }));
// The switch as data-lab-sections on <html> or <body>; where it and the meta disagree, the meta wins, then <html>, then <body>.
const attr = (html, { on = '', off = '' } = {}) => html.replace('<!doctype html>', `<!doctype html>${on === 'html' ? '<html data-lab-sections="on">' : off === 'html' ? '<html data-lab-sections="off">' : ''}`).replace('<body>', `<body${on === 'body' ? ' data-lab-sections="on"' : off === 'body' ? ' data-lab-sections="off"' : ''}>`);
write('html-off.html', attr(page(), { off: 'html' }));
write('body-on.html', attr(page({ lab: false }), { on: 'body' }));
write('meta-on-html-off.html', attr(page({ meta: '<meta name="lab-sections" content="on">' }), { off: 'html' }));
write('html-off-body-on.html', attr(page(), { off: 'html', on: 'body' }));
// A board's own page (a frame of a board, /_lab/board/<name>/<frame>, kept under /_board/): a lab page with sections, yet no bar.
fs.mkdirSync(path.join(DIR, '.lab', 'boards', 'demo'), { recursive: true });
write(path.join('.lab', 'boards', 'demo', 'a.html'), page());
write('two.html', page({ body: '<nav><h2>Home</h2><h2>About</h2></nav>' + sec('a', 'Alpha') + sec('b', 'Beta') + '<footer><h2>Contact</h2></footer>' }));
write('shell.html', page({ head: 'html,body{height:100%;overflow:hidden}main{height:100%;overflow:auto}', body: '<main>' + sec('a', 'Alpha') + sec('b', 'Beta') + sec('c', 'Gamma') + '</main>' }));
fs.writeFileSync(path.join(OFF_DIR, 'labit.json'), JSON.stringify({ port: PORT + 200, flags: { sectionBar: false } })); // a file from before it was kept
write('index.html', page(), OFF_DIR);
// A dev server behind --proxy: an app that switches routes with pushState and draws its headings late.
const APP_PORT = PORT + 600;
const PX = `http://localhost:${PORT + 400}`;
const PX_DIR = fs.realpathSync(tmp('labit-sections-px-'));
fs.writeFileSync(path.join(PX_DIR, 'labit.json'), JSON.stringify({ port: PORT + 400 }));
const route = (names) => names.map((n) => sec(n.toLowerCase(), n)).join('');
const app = http.createServer((req, res) => {
  const meta = req.url.startsWith('/plain') ? '' : '<meta name="lab-sections" content="on">';
  const body = `<div id="app">${route(req.url.startsWith('/r2') ? ['Xray', 'Yankee', 'Zulu'] : ['Alpha', 'Beta', 'Gamma', 'Delta'])}</div>` +
    `<script>window.go=()=>{history.pushState({}, '', '/r2');document.getElementById('app').innerHTML=${JSON.stringify(route(['Xray', 'Yankee', 'Zulu']))}}</script>`;
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(page({ meta, body, head: 'header{position:static}' }));
}).listen(APP_PORT);
const server = startLab(DIR, env);
const offServer = startLab(OFF_DIR, env);
const pxServer = startLab(PX_DIR, env, { args: ['--proxy', String(APP_PORT)] });
for (const base of [B, OFF, PX])
  await labUp(base);
const until = async (f, ms = 6000) => {
  for (let t = 0; t < ms; t += 150) {
    if (await f().catch(() => false)) return true; // a reload mid-look (a rebuilt widget) is another try
    await sleep(150);
  }
  return false;
};

try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    const ME = `tess-${eng}`;
    const context = (extra = {}) => browser.newContext({ viewport: { width: 1100, height: 700 }, reducedMotion: 'reduce', ...extra });
    const open = async (ctx, file = '/', name = ME, base = B) => {
      const p = await ctx.newPage();
      if (name) await p.addInitScript((n) => localStorage.getItem('lab-name') || localStorage.setItem('lab-name', n), name);
      await p.goto(base + file);
      await p.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.scrim')), null, { timeout: 15000 });
      await sleep(900); // the widget checks 400 ms after the load
      const shadow = (fn, arg) => p.evaluate(([f, a]) => new Function('r', 'a', f)([...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim')).shadowRoot, a), [fn.toString().replace(/^[^{]*{|}$/g, ''), arg]);
      // The bar's chips: label, status word, whether current; [] while the bar is hidden.
      const chips = () => shadow(() => { const b = r.querySelector('.sbar'); return !b || b.hidden ? [] : [...r.querySelectorAll('.sb-nav .sb-chip')].map((c) => ({ t: c.querySelector('.sb-t').textContent, st: c.dataset.st || '', cur: c.hasAttribute('aria-current'), hidden: c.hidden })); });
      const states = async () => (await chips()).map((c) => `${c.t}:${c.st}`).join(' ');
      const tap = (label) => shadow(() => { [...r.querySelectorAll('.sb-chip')].find((c) => c.querySelector('.sb-t').textContent === a).click(); }, label);
      const scrollTo = (y) => p.evaluate((v) => scrollTo(0, v), y);
      return { p, shadow, chips, states, tap, scrollTo };
    };
    write('index.html', page());
    const own = await context();
    const L = await open(own);
    const { p, chips, states, tap, scrollTo, shadow } = L;

    // ---- the first visit: everything is read ----
    check(eng, 'first visit: a bar with four sections, none marked', (await states()) === 'Speed: Cost: Risk: Next steps:', await states());
    check(eng, 'no page name in the bar', await shadow(() => { return !r.querySelector('.sb-title') && !r.querySelector('.sbar').textContent.includes('Plan'); }));
    check(eng, 'the lone h1 is the title, not a section', !(await chips()).some((c) => c.t === 'Plan'));

    // ---- a page written anew (80 % or more new or updated at once): read, no name lights up ----
    write('rewrite.html', page());
    const RW = await open(own, '/rewrite');
    write('rewrite.html', page({ body: sec('speed', 'Speed', 'All new.') + sec('cost', 'Cost', 'All new.') + sec('risk', 'Risk', 'All new.') + sec('plan', 'Next steps', 'All new.') + sec('extra', 'Appendix') }));
    await until(async () => (await RW.states()).includes('Appendix'));
    await sleep(600);
    check(eng, 'a page written anew: no chip new or updated', !(await RW.states()).match(/new|updated/), await RW.states());
    await RW.p.reload();
    await sleep(1500);
    check(eng, '...and it was saved read', (await RW.states()) === 'Speed: Cost: Risk: Next steps: Appendix:', await RW.states());
    await RW.p.close();

    // ---- the agent adds a section and changes one ----
    write('index.html', page({ body: sec('speed', 'Speed', 'Words of Speed, now longer.') + sec('cost', 'Cost') + sec('risk', 'Risk') + sec('plan', 'Next steps') + sec('extra', 'Appendix') }));
    check(eng, 'an added section is "new" and a changed one "updated"', await until(async () => (await states()) === 'Speed:updated Cost: Risk: Next steps: Appendix:new'), await states());
    check(eng, 'the status words are on the chips', await shadow(() => { return [...r.querySelectorAll('.sb-chip')].filter((c) => c.querySelector('.sb-w').textContent).length === 2; }));
    check(eng, 'the bar did not move the page', (await p.evaluate(() => scrollY)) === 0);

    // ---- what reads a section ----
    await scrollTo(1250); // Cost (its heading is at about 1250 - the line)
    await sleep(600);
    check(eng, 'the current one is filled', (await chips()).find((c) => c.cur)?.t === 'Cost', JSON.stringify((await chips()).map((c) => c.cur)));
    check(eng, 'passed in a flash (under 0.8 s): not read', (await states()).includes('Speed:updated'));
    await scrollTo(0);
    await sleep(1000);
    await scrollTo(1250);
    await sleep(500);
    check(eng, 'scrolling on from a section after a moment reads it', !(await states()).includes('Speed:updated'), await states());
    await scrollTo(99999); // Appendix is last: the bottom
    await sleep(500);
    check(eng, 'Appendix is current but not read yet', (await states()).includes('Appendix:new'), await states());
    await sleep(3300);
    check(eng, 'about 3 s inside a section reads it', !(await states()).includes('Appendix:new'), await states());
    write('index.html', page({ body: sec('speed', 'Speed', 'Words of Speed, now longer.') + sec('cost', 'Cost') + sec('risk', 'Risk', 'Risk changed.') + sec('plan', 'Next steps') + sec('extra', 'Appendix') + sec('z', 'Last words') }));
    await until(async () => (await states()).includes('Last words:new'));
    await scrollTo(0);
    await sleep(500);
    const y = await p.evaluate(() => scrollY);
    await tap('Last words');
    await sleep(800);
    check(eng, 'a tap in the bar reads it and goes there, with the heading clear of the bar', !(await states()).includes('Last words:new') && (await p.evaluate(() => scrollY)) > y, await states());
    const clear = await p.evaluate(() => [...document.querySelectorAll('h2')].find((h) => h.textContent === 'Last words').getBoundingClientRect().top);
    check(eng, 'the heading is not under the bar', clear >= 38, String(clear));
    await tap('Risk');
    await sleep(500);

    // ---- a tap in the bar is not a click on the page ----
    check(eng, 'no comment box came up from a tap in the bar', await shadow(() => { return !r.querySelector('.float, textarea'); }));

    // ---- kept in the lab, per person ----
    await sleep(1500); // pushed 800 ms after the last read
    const lab = await (await fetch(`${B}/_lab/api/sections?name=${ME}&page=/index`)).json();
    check(eng, "the lab has this person's marks", Object.keys(lab.sections || {}).length >= 5, JSON.stringify(lab));
    const other = await (await context()).newPage();
    const phone = await context();
    const D = await open(phone); // another browser, the same name: nothing is marked
    check(eng, 'the same name on another device: what was read is read', !(await D.states()).match(/new|updated/), await D.states());
    const M = await open(await context(), '/', `mira-${eng}`);
    check(eng, 'another name has its own: a first visit reads it all', !(await M.states()).match(/new|updated/), await M.states());
    // The agent's text names nobody.
    const text = await (await fetch(`${B}/_lab/agent/index`)).text();
    check(eng, "marks are not in the agent's text (no person)", !/looked: /.test(text) && !new RegExp(ME).test(text), text.split('\n').filter((l) => /looked/.test(l)).join('|'));
    // Another device reads something new: this one hears it.
    write('index.html', page({ body: sec('speed', 'Speed', 'Words of Speed, now longer.') + sec('cost', 'Cost') + sec('risk', 'Risk', 'Risk changed.') + sec('plan', 'Next steps') + sec('extra', 'Appendix') + sec('z', 'Last words') + sec('q', 'Questions') }));
    await until(async () => (await D.states()).includes('Questions:new'));
    await until(async () => (await states()).includes('Questions:new'));
    await D.tap('Questions');
    check(eng, 'a section read on one device clears on the other (same name)', await until(async () => !(await states()).includes('Questions:new'), 8000), await states());
    await other.close();
    // A tap on a green name clears its ink at once, with motion on (the ink went over 300 ms), and the heading it goes to
    // wears the half ink for a moment, not a box (Leo, 19 Nov).
    write('index.html', page({ body: sec('speed', 'Speed', 'Words of Speed, now longer.') + sec('cost', 'Cost') + sec('risk', 'Risk', 'Risk changed.') + sec('plan', 'Next steps') + sec('extra', 'Appendix') + sec('z', 'Last words') + sec('q', 'Questions') + sec('ans', 'Answers') }));
    const MO = await open(await context({ reducedMotion: 'no-preference' }));
    await MO.scrollTo(0);
    await until(async () => (await MO.states()).includes('Answers:new'));
    await MO.tap('Answers');
    await sleep(200);
    const gone = await MO.shadow(() => { const c = [...r.querySelectorAll('.sb-nav .sb-chip')].find((x) => x.querySelector('.sb-t').textContent === 'Answers'); const bg = getComputedStyle(c.querySelector('.sb-t'), '::before').backgroundColor; return { st: c.dataset.st || '', bg }; });
    const alpha = (c) => { const m = /rgba?\(([^)]+)\)|color\(srgb ([^)]+)\)/.exec(c) || []; const v = (m[1] || m[2] || '').split(/[ ,/]+/).filter(Boolean); return v.length > 3 ? parseFloat(v[3]) : c === 'transparent' ? 0 : 1; };
    check(eng, 'a tap on a "new" name clears it within 300 ms: no status, no ink', gone.st === '' && alpha(gone.bg) < 0.02, JSON.stringify(gone));
    // The ink is drawn inside the widget (a page's own rules don't reach it).
    const head = await MO.p.evaluate(() => { const ink = document.querySelector('body > [data-lab-comments]').shadowRoot.querySelector('div[style*="2147483646"] > i'); const h = [...document.querySelectorAll('h2')].find((x) => x.textContent === 'Answers'); return { ink: Boolean(ink), outline: getComputedStyle(h).outlineStyle, bg: ink ? getComputedStyle(ink).backgroundColor : '' }; });
    check(eng, 'the heading it goes to wears a green half ink, no box', head.ink && head.outline === 'none' && /36, 160, 70|0\.14\d* 0\.62\d* 0\.27/.test(head.bg), JSON.stringify(head));
    await MO.p.context().close();

    // ---- an unread pin marks nothing in the bar, and a tap on a section only scrolls there ----
    write(`pins-${eng}.html`, page());
    const PN = await open(await context(), `/pins-${eng}`, `zz-newnav-${eng}`);
    check(eng, 'pins page: no chip lit before a pin', !(await PN.states()).match(/:\w/), await PN.states());
    await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: `/pins-${eng}`, name: `zz-other-${eng}`, text: 'a pin in Risk', anchor: { selector: '#risk > p', x: 0.1, y: 0.5, docX: 0.1, docY: 2400, width: 1000, element: '<p>' } }) });
    check(eng, 'the pin is there, unread (the pins show it)', await until(async () => PN.shadow(() => { return r.querySelectorAll('.pin').length > 0; }), 8000));
    await sleep(600);
    check(eng, 'a section with an unread pin is NOT marked in the bar', (await PN.states()) === 'Speed: Cost: Risk: Next steps:', await PN.states());
    check(eng, 'no digits anywhere in the bar', await PN.shadow(() => { return !/\d/.test(r.querySelector('.sbar').textContent); }), await PN.shadow(() => { return r.querySelector('.sbar').textContent; }));
    await PN.tap('Risk');
    await sleep(900);
    const went = await PN.p.evaluate(() => { const h = document.querySelector('#risk h2').getBoundingClientRect(); return { top: h.top, y: scrollY }; });
    check(eng, 'tap: the page is at that section', went.y > 1500 && went.top < 700, JSON.stringify(went));
    check(eng, '...and no pin opened (no card shows its comment)', await PN.shadow(() => { return ![...r.querySelectorAll('.card')].some((c) => c.isConnected && /a pin in Risk/.test(c.textContent) && c.getBoundingClientRect().height > 0); }));
    await PN.p.context().close();

    // ---- headings inside repeated items (the cards of a grid) are not sections ----
    write('cards.html', page({ head: '.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}.card{height:100px;border:1px solid #ccc}section{height:300px}', body: sec('speed', 'Speed') + sec('cost', 'Cost') + sec('risk', 'Risk') + `<div class="grid">${Array.from({ length: 10 }, (_, i) => `<div class="card"><h2>Option ${i + 1}</h2><p>Words.</p></div>`).join('')}</div>` }));
    write('cards-list.html', page({ head: 'section{height:300px}', body: sec('speed', 'Speed') + sec('cost', 'Cost') + sec('risk', 'Risk') + `<div>${Array.from({ length: 6 }, (_, i) => `<article><h2>Post ${i + 1}</h2><p>Words.</p></article>`).join('')}</div>` }));
    const CD = await open(await context(), '/cards');
    check(eng, 'a grid of 10 cards with their own h2: the bar shows the 3 sections, not 13', (await CD.states()) === 'Speed: Cost: Risk:', await CD.states());
    const CL = await open(await context(), '/cards-list');
    check(eng, 'a set of articles with their own h2: not sections either', (await CL.states()) === 'Speed: Cost: Risk:', await CL.states());
    await CD.p.context().close();
    await CL.p.context().close();

    // ---- the page's own bar, no sections, no flag ----
    const S = await open(await context(), '/sticky');
    const gap = await S.shadow(() => { return r.querySelector('.sbar').getBoundingClientRect().top; });
    check(eng, "under the page's own sticky bar", gap >= 59, String(gap));
    check(eng, "rule 3: a page with its own sticky bar is not pushed down", (await S.p.evaluate(() => parseFloat(getComputedStyle(document.documentElement).paddingTop))) === 0);
    // The bar keeps its own room: at the top, the page's first line starts under it (Leo, 19 Nov: "tab bar overlaying
    // first heading on mobile").
    const T = await open(await context(), '/tight');
    const tight = await T.shadow(() => { return { bar: r.querySelector('.sbar').getBoundingClientRect().bottom, h1: document.querySelector('h1').getBoundingClientRect().top, y: scrollY }; });
    check(eng, 'at the top, the first heading starts under the bar', tight.y === 0 && tight.h1 >= tight.bar, JSON.stringify(tight));
    const N = await open(await context(), '/plain');
    check(eng, 'no sections, no bar', (await N.chips()).length === 0 && (await N.shadow(() => { return r.querySelector('.sbar')?.hidden !== false; })));
    const F = await open(await context(), '/', 'old-flag', OFF);
    check(eng, 'kept: an old sectionBar: false in labit.json still gets the bar', (await F.chips()).length > 0, String((await F.chips()).length));

    // ---- comments hidden: no bar ----
    await p.keyboard.press('m');
    await sleep(500);
    check(eng, 'comments hidden: the bar goes', (await chips()).length === 0);
    await p.keyboard.press('m');
    await sleep(900);
    check(eng, 'and comes back with them', (await chips()).length >= 5);

    // ---- a computer: the bar as wide as its tabs; too many scroll sideways under a swipe or the wheel ----
    const fit = await shadow(() => { const b = r.querySelector('.sbar').getBoundingClientRect(); const n = r.querySelector('.sb-nav'); const cs = [...n.querySelectorAll('.sb-chip')].map((c) => c.getBoundingClientRect()); return { w: b.width, l: b.left, r: innerWidth - b.right, fits: n.scrollWidth <= n.clientWidth, span: cs[cs.length - 1].right - cs[0].left }; });
    check(eng, 'computer: the bar is as wide as its tabs, centred', fit.fits && fit.w < 700 && Math.abs(fit.l - fit.r) <= 1 && fit.w - fit.span < 40, JSON.stringify(fit));
    const W2 = await open(await context({ viewport: { width: 700, height: 600 } }), '/many');
    const wide = await W2.shadow(() => { const n = r.querySelector('.sb-nav'); return { over: n.scrollWidth > n.clientWidth, hidden: [...n.querySelectorAll('.sb-chip')].filter((c) => c.hidden).length, more: Boolean(r.querySelector('.sb-more')), bar: r.querySelector('.sbar').getBoundingClientRect().width }; });
    check(eng, 'computer: too many tabs scroll sideways, none folded away', wide.over && !wide.hidden && !wide.more && wide.bar <= 700 - 24 + 1, JSON.stringify(wide));
    const navBox = await W2.shadow(() => { const b = r.querySelector('.sb-nav').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    const navLeft = () => W2.shadow(() => { return r.querySelector('.sb-nav').scrollLeft; });
    await W2.p.mouse.move(navBox.x, navBox.y);
    await W2.p.mouse.wheel(0, 120);
    await sleep(400);
    const afterY = { left: await navLeft(), page: await W2.p.evaluate(() => scrollY) };
    check(eng, 'computer: the wheel over the bar moves it sideways, not the page', afterY.left > 50 && afterY.page === 0, JSON.stringify(afterY));
    await W2.p.mouse.wheel(150, 0);
    await sleep(400);
    const afterX = { left: await navLeft(), page: await W2.p.evaluate(() => scrollX + scrollY) };
    check(eng, 'computer: a sideways swipe moves it on, the page stays', afterX.left > afterY.left + 50 && afterX.page === 0, JSON.stringify(afterX));
    await W2.p.mouse.move(350, 400);
    await W2.p.mouse.wheel(0, 300);
    await sleep(400);
    check(eng, 'computer: off the bar the wheel scrolls the page', (await W2.p.evaluate(() => scrollY)) > 100);
    await W2.shadow(() => { [...r.querySelectorAll('.sb-nav .sb-chip')].pop().click(); });
    await sleep(900);
    check(eng, 'a tap on the last tab goes there', (await W2.p.evaluate(() => scrollY)) > 5000);
    const inView = await W2.shadow(() => { const n = r.querySelector('.sb-nav'); const c = n.querySelector('.sb-chip[aria-current]'); if (!c) return 'none'; const cb = c.getBoundingClientRect(), nb = n.getBoundingClientRect(); return cb.left >= nb.left - 1 && cb.right <= nb.right + 1; });
    check(eng, 'computer: the current tab is kept in view', inView === true, String(inView));

    // ---- a phone: one sideways line, above the dimmed page of a sheet, the sheet never over it ----
    const ph = await context({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    write('many.html', page({ body: Array.from({ length: 14 }, (_, i) => sec(`m${i}`, `Section number ${i}`)).join('') }));
    const P = await open(ph, '/many', 'phone-tess');
    write('many.html', page({ body: Array.from({ length: 14 }, (_, i) => sec(`m${i}`, `Section number ${i}`, i === 11 ? 'Changed.' : undefined)).join('') + sec('fresh', 'Fresh') }));
    await until(async () => (await P.states()).includes('Section number 11:updated'));
    await sleep(600);
    const line = await P.shadow(() => { const n = r.querySelector('.sb-nav'); const b = r.querySelector('.sbar').getBoundingClientRect(); return { sideways: n.scrollWidth > n.clientWidth, left: n.scrollLeft, title: Boolean(r.querySelector('.sb-title')), w: b.width, vw: innerWidth, h: b.height, top: b.top }; });
    check(eng, 'phone: one full-width line that scrolls sideways, no title', line.sideways && !line.title && line.w === line.vw, JSON.stringify(line));
    check(eng, 'phone: opened at the first updated section', line.left > 100, JSON.stringify(line));
    check(eng, 'phone: the bar is a tap target', line.h >= 40, String(line.h));
    const sy = await P.p.evaluate(() => scrollY);
    check(eng, 'the bar gliding sideways did not move the page', sy === 0, String(sy));
    await P.shadow(() => { r.querySelector('.chat-btn').hidden = false; r.querySelector('.chat-btn').click(); });
    await sleep(700);
    // While a sheet is open on a phone the bar steps away (slid up and faded out, not tappable; it eases back as the sheet
    // goes, Leo 20 Nov), so the sheet's handle and its swipe down are free (Leo, 19 Nov: "tab bar blocking me from swiping
    // down chat"); its place is the dimmed page's.
    const sheet = await P.shadow(() => { const c = r.querySelector('.chatwin'); const b = r.querySelector('.sbar'); const k = b.getBoundingClientRect(); const hit = r.elementFromPoint(innerWidth / 2, k.top + k.height / 2); return { open: !c.hidden, scrim: getComputedStyle(r.querySelector('.scrim')).display, bar: getComputedStyle(b).visibility === 'hidden' || (Number(getComputedStyle(b).opacity) === 0 && getComputedStyle(b).pointerEvents === 'none') ? 'away' : 'shown', hit: hit?.closest('.sbar') ? 'bar' : hit?.className }; });
    check(eng, 'chat sheet open: dimmed page, the bar steps away (not tappable over the sheet)', sheet.open && sheet.scrim === 'block' && sheet.bar === 'away' && sheet.hit !== 'bar', JSON.stringify(sheet));
    const sy0 = await P.p.evaluate(() => scrollY);
    await P.p.touchscreen.tap(195, 22);
    await sleep(900);
    const after = await P.shadow(() => { return { open: !r.querySelector('.chatwin').hidden, bar: getComputedStyle(r.querySelector('.sbar')).visibility }; });
    check(eng, 'a tap where the bar was closes the sheet (the page stays put) and the bar comes back', !after.open && after.bar === 'visible' && (await P.p.evaluate(() => scrollY)) === sy0, JSON.stringify(after));
    await ph.close();

    // ---- pinch-zoomed in (as zoom.mjs: the page starts zoomed): the bar keeps its usual size, inside what the screen shows ----
    const Z = await open(await context({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }), '/zoomed', 'zoom-tess');
    const zm = await Z.shadow(() => { const b = r.querySelector('.sbar').getBoundingClientRect(); const v = visualViewport; return { scale: v.scale, zoom: r.host.hasAttribute('data-zoom'), h: b.height * v.scale, left: b.left, right: b.right, vw: v.width, inUi: r.querySelector('.sbar').parentElement.className === 'ui' }; });
    if (Math.abs(zm.scale - 1) < 0.01) console.log(`skip ${eng.padEnd(8)} this engine does not zoom a page (scale 1)`);
    else check(eng, 'zoomed in: the bar keeps its usual size and is inside what the screen shows', zm.inUi && zm.zoom && Math.abs(zm.h - 44) < 3 && zm.left >= -1 && zm.right <= zm.vw + 1, JSON.stringify(zm));

    // ---- the six rules (Leo, 19 Nov) ----
    const pad = (X) => X.p.evaluate(() => ({ top: parseFloat(getComputedStyle(document.documentElement).paddingTop), scroll: getComputedStyle(document.documentElement).scrollPaddingTop }));
    const barOf = (X) => X.shadow(() => { const b = r.querySelector('.sbar'); return { shown: Boolean(b && !b.hidden), away: Boolean(b?.hasAttribute('data-away')), display: b ? getComputedStyle(b).display : '' }; });
    // 1. a lab page: bar and inset, with scroll-padding (6); project HTML: none; behind a proxy: none, lab.css or not.
    const lp = await pad(L);
    check(eng, 'rule 1: a lab page keeps the inset, with scroll-padding-top (rule 6)', lp.top === 38 && parseFloat(lp.scroll) >= 38, JSON.stringify(lp));
    const PJ = await open(await context(), '/project');
    check(eng, "rule 1: a project's own HTML (no lab.css): no bar, no inset", !(await barOf(PJ)).shown && (await pad(PJ)).top === 0, JSON.stringify(await pad(PJ)));
    const served = await (await fetch(`${B}/project`)).text();
    check(eng, '...and the lab keeps no room in it as served', !served.includes('data-lab="section-bar"'));
    const PP = await open(await context(), '/plain', 'px-tess', PX);
    check(eng, 'rule 1: a proxied page, even with lab.css: no bar', !(await barOf(PP)).shown);
    // 2. the per-page switch, both ways.
    const MF = await open(await context(), '/meta-off');
    check(eng, 'rule 2: meta off on a lab page: no bar, no inset, no room served', !(await barOf(MF)).shown && (await pad(MF)).top === 0 && !(await (await fetch(`${B}/meta-off`)).text()).includes('data-lab="section-bar"'));
    const HO = await open(await context(), '/html-off');
    check(eng, 'rule 2: <html data-lab-sections="off"> on a lab page: no bar, no inset, no room served', !(await barOf(HO)).shown && (await pad(HO)).top === 0 && !(await (await fetch(`${B}/html-off`)).text()).includes('data-lab="section-bar"'), JSON.stringify({ bar: await barOf(HO), pad: await pad(HO) }));
    const BO = await open(await context(), '/body-on');
    check(eng, 'rule 2: <body data-lab-sections="on"> on project HTML: the bar shows, floating (no inset)', (await BO.states()) === 'Speed: Cost: Risk: Next steps:' && (await pad(BO)).top === 0, await BO.states());
    const MH = await open(await context(), '/meta-on-html-off');
    check(eng, 'rule 2: meta on and <html> off: the meta wins (bar and inset)', (await barOf(MH)).shown && (await pad(MH)).top === 38, JSON.stringify({ bar: await barOf(MH), pad: await pad(MH) }));
    const HB = await open(await context(), '/html-off-body-on');
    check(eng, 'rule 2: <html> off and <body> on: <html> wins (no bar, no inset)', !(await barOf(HB)).shown && (await pad(HB)).top === 0, JSON.stringify({ bar: await barOf(HB), pad: await pad(HB) }));
    // A board open over the page (its view, [data-lab-board-view]): the bar steps away, and comes back when it closes.
    const boardState = () => shadow(() => { const b = r.querySelector('.sbar'); return { board: b.hasAttribute('data-board'), vis: getComputedStyle(b).visibility, shown: !b.hidden }; });
    const before = await boardState();
    await p.evaluate(() => { const d = document.createElement('div'); d.setAttribute('data-lab-board-view', ''); d.id = 'bv'; document.body.append(d); });
    const opened = await until(async () => { const s = await boardState(); return s.board && s.vis === 'hidden'; }, 2000);
    check(eng, 'a board open over the page: the bar gets data-board and is hidden', before.shown && !before.board && before.vis === 'visible' && opened, JSON.stringify({ before, now: await boardState() }));
    await p.evaluate(() => document.getElementById('bv').remove());
    const closed = await until(async () => { const s = await boardState(); return !s.board && s.vis === 'visible' && s.shown; }, 2000);
    check(eng, '...and the board closed: the bar is back', closed, JSON.stringify(await boardState()));
    const BF = await open(await context(), '/_lab/board/demo/a');
    check(eng, "a board's own page (a frame, under /_board/): no bar, though a lab page with sections", !(await barOf(BF)).shown && (await BF.chips()).length === 0, JSON.stringify(await barOf(BF)));
    const PO = await open(await context(), '/project-on');
    check(eng, 'rule 2: meta on, project HTML: the bar shows', (await barOf(PO)).shown, await PO.states());
    // 3. it floats there: no inset, away on scroll down, back on scroll up.
    check(eng, 'rule 3: not a lab page: the bar floats, the page is not pushed', (await pad(PO)).top === 0);
    await PO.scrollTo(800);
    await sleep(150);
    await PO.scrollTo(1600);
    await sleep(300);
    const down = await barOf(PO);
    await PO.scrollTo(1200);
    await sleep(300);
    const up = await barOf(PO);
    check(eng, 'rule 3: away on scroll down, back on scroll up', down.away && !up.away, JSON.stringify({ down, up }));
    const SH = await open(await context(), '/shell');
    check(eng, 'rule 3: an app shell (inner scroller) is not pushed down', (await barOf(SH)).shown && (await pad(SH)).top === 0, JSON.stringify(await pad(SH)));
    // 4. two sections (and headings in nav and footer, which are not sections): no bar.
    const TW = await open(await context(), '/two');
    check(eng, 'rule 4: two sections (nav and footer headings skipped): no bar, no inset', !(await barOf(TW)).shown && (await pad(TW)).top === 0);
    // 5. a route change behind a proxy: the new route's sections, under its own path; headings added by script.
    const PR = await open(await context(), '/', 'px-tess', PX);
    check(eng, 'rule 5: proxied app with meta on: bar, floating', (await PR.states()) === 'Alpha: Beta: Gamma: Delta:' && (await pad(PR)).top === 0, await PR.states());
    await PR.p.evaluate(() => window.go());
    const routed = await until(async () => (await PR.states()) === 'Xray: Yankee: Zulu:', 4000);
    check(eng, 'rule 5: pushState to another route: its sections, not the first route\'s', routed, await PR.states());
    check(eng, '...kept under the real path', await until(() => PR.p.evaluate(() => Boolean(localStorage.getItem('lab-sections:/r2'))), 3000));
    await p.evaluate(() => { const s = document.createElement('section'); s.innerHTML = '<h2>Drawn late</h2><p>x</p>'; document.body.append(s); });
    check(eng, 'rule 5: a heading added by the page shows up', await until(async () => (await states()).includes('Drawn late'), 3000), await states());
    // 6. print: no bar, no inset.
    await p.emulateMedia({ media: 'print' });
    const pr = { bar: (await barOf(L)).display, pad: (await pad(L)).top };
    check(eng, 'rule 6: printing: no bar, no inset', pr.bar === 'none' && pr.pad === 0, JSON.stringify(pr));
    await p.emulateMedia({ media: 'screen' });
    await browser.close();
  }
} finally {
  server.kill();
  offServer.kill();
  pxServer.kill();
  app.close();
  await sleep(100);
  for (const d of [DIR, OFF_DIR, PX_DIR]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 });
}
finish('all ok');
