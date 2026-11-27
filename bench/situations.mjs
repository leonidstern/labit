// Pins about 30 comments on bench/situations (text, code, photos, video, other) the way a person would, then writes
// what an agent gets (results/situations-agent-text.txt) and what a correct answer is (situations-truth.json).
// Run: NODE_PATH=<folder with playwright> node bench/situations.mjs      (KEEP=1 leaves the pages up to look at)
// Batch 2 (about 30 more, in situations-2.mjs): add --batch 2. It writes results/situations-2-agent-text.txt and situations-2-truth.json.
// An agent answering bench/situations-task.md must not read this file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(HERE, 'situations');
process.env.PORT ||= '4391';
process.env.BENCH_SITE = 'bench/situations';
process.env.BENCH_AT = '/sit';
process.env.LAB_COMMENTS_PER_HOUR ||= '1000';
if (!process.env.LABIT_HOME) {
  // A home of its own for this run, removed when it ends.
  const home = (process.env.LABIT_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'labit-bench-')));
  process.on('exit', () => fs.rmSync(home, { recursive: true, force: true }));
}
const { ready } = await import('./serve.mjs');
await ready;
const BASE = `http://localhost:${process.env.PORT}`;
const BATCH = process.argv.includes('--batch') ? process.argv[process.argv.indexOf('--batch') + 1] : '1';
const OUT = BATCH === '1' ? { text: 'results/situations-agent-text.txt', truth: 'situations-truth.json' } : { text: `results/situations-${BATCH}-agent-text.txt`, truth: `situations-${BATCH}-truth.json` };
const media = JSON.parse(fs.readFileSync(path.join(HERE, 'situations-media.json'), 'utf8'));

// ---------- helpers ----------
// Line (1-based) of the nth line in a fixture file that contains `needle`.
function lineOf(file, needle, nth = 1) {
  const lines = fs.readFileSync(path.join(SITE, file), 'utf8').split('\n');
  let seen = 0;
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(needle) && ++seen === nth) return i + 1;
  throw new Error(`${file}: no line ${nth} with "${needle}"`);
}
// Screen <-> file pixels for an image or video drawn in box b with object-fit (or a cover background).
function fit(b, [nw, nh], mode = 'fill', px = 0.5, py = 0.5) {
  const sx = b.width / nw, sy = b.height / nh;
  const s = mode === 'cover' ? Math.max(sx, sy) : mode === 'contain' ? Math.min(sx, sy) : 0;
  const [kx, ky] = s ? [s, s] : [sx, sy];
  const ox = (b.width - nw * kx) * px, oy = (b.height - nh * ky) * py;
  return { screen: (x, y) => [b.x + ox + x * kx, b.y + oy + y * ky], file: (x, y) => [(x - b.x - ox) / kx, (y - b.y - oy) / ky] };
}
const mid = ([x1, y1, x2, y2]) => [(x1 + x2) / 2, (y1 + y2) / 2];
const tokens = (s) => String(s || '').toLowerCase().replace(/[’‘]/g, "'").split(/\s+/).map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);

// In the page: find words and boxes, scrolling like a person would so the spot is in the middle of the window.
const inPage = () => {
  const centre = (r) => {
    for (let p = r.startContainer.parentElement; p && p !== document.body; p = p.parentElement) {
      if (p.scrollHeight > p.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(p).overflowY)) {
        const b = r.getBoundingClientRect();
        p.scrollTop += b.top - p.getBoundingClientRect().top - p.clientHeight / 2;
      }
    }
    const b = r.getBoundingClientRect();
    scrollBy(0, b.top + b.height / 2 - innerHeight / 2);
  };
  const flat = (b) => ({ x: b.x, y: b.y, width: b.width, height: b.height });
  window.__bench = {
    // The nth time `word` shows inside the element.
    word(sel, word, nth = 0, scroll = true) {
      const el = document.querySelector(sel);
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let seen = 0;
      for (let n; (n = walker.nextNode()); ) {
        for (let i = n.data.indexOf(word); i !== -1; i = n.data.indexOf(word, i + 1)) {
          if (seen++ !== nth) continue;
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + word.length);
          if (scroll) centre(r);
          return flat(r.getBoundingClientRect());
        }
      }
      throw new Error(`no "${word}" #${nth} in ${sel}`);
    },
    // The element's box; fx, fy (fractions of it) say which point to bring to the middle of the window.
    box(sel, fx = 0.5, fy = 0.5, scroll = true) {
      const el = document.querySelector(sel);
      const b = el.getBoundingClientRect();
      if (scroll) scrollBy(0, b.top + b.height * fy - innerHeight / 2);
      return flat(el.getBoundingClientRect());
    },
    // The lines of text as they wrap on screen: one box per line.
    lines(sel) {
      const el = document.querySelector(sel);
      const r = document.createRange();
      r.selectNodeContents(el);
      centre(r);
      const rows = [];
      for (const c of r.getClientRects()) {
        const row = rows.find((x) => Math.abs(x.top - c.top) < 6);
        if (row) Object.assign(row, { left: Math.min(row.left, c.left), right: Math.max(row.right, c.right), bottom: Math.max(row.bottom, c.bottom) });
        else rows.push({ top: c.top, bottom: c.bottom, left: c.left, right: c.right });
      }
      return rows.sort((a, b) => a.top - b.top);
    },
    // The words of the element whose middle is inside the zone, in reading order.
    wordsIn(sel, zone) {
      const walker = document.createTreeWalker(document.querySelector(sel), NodeFilter.SHOW_TEXT);
      const r = document.createRange();
      const out = [];
      for (let n; (n = walker.nextNode()); ) {
        for (const m of n.data.matchAll(/\S+/g)) {
          r.setStart(n, m.index);
          r.setEnd(n, m.index + m[0].length);
          const b = r.getBoundingClientRect();
          const [cx, cy] = [b.x + b.width / 2, b.y + b.height / 2];
          if (b.width && cx >= zone.x0 && cx <= zone.x1 && cy >= zone.y0 && cy <= zone.y1) out.push(m[0]);
        }
      }
      return out.join(' ');
    },
  };
};

// One browser window on one page, with the things a person does in it.
async function open(browser, pagePath, { name = 'Leo', context = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...context });
  const page = await ctx.newPage();
  await page.addInitScript((n) => localStorage.setItem('lab-name', n), name);
  if (context.hasTouch) await page.addInitScript(() => localStorage.setItem('lab-on', '1')); // labit on, as the mark's tap would leave it
  await page.addInitScript(inPage);
  await page.goto(BASE + pagePath);
  const lab = (sel) => page.locator(`[data-lab-comments] ${sel}`);
  await lab('.toggle').waitFor({ state: context.hasTouch ? 'attached' : 'visible' }); // a phone keeps it in its sheet
  if (!context.hasTouch) await lab('.toggle').click(); // a phone pins with a hold, labit's mark there opens its sheet
  else await page.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.scrim')), null, { timeout: 10000 });
  // Type the comment and send it. Once posted the composer closes and the new pin stays.
  const pins = () => page.evaluate(() => document.querySelector('[data-lab-comments]').shadowRoot.querySelectorAll('button.pin').length);
  const say = async (text) => {
    await lab('.float textarea').waitFor({ timeout: 5000 });
    const before = await pins();
    await lab('.float textarea').fill(text);
    await lab('.float textarea').press('Enter');
    for (let i = 0; (await pins()) === before; i++) {
      if (i > 50) throw new Error(`"${text}" was not saved: ${(await lab('.error').allTextContents()).join(' ')}`);
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(250);
  };
  return {
    page,
    say,
    close: () => ctx.close(),
    $: (fn, ...args) => page.evaluate(([f, a]) => window.__bench[f](...a), [fn, args]),
    click: async (x, y, { alt = false } = {}) => {
      if (alt) await page.keyboard.down('Alt'); // Option: pins on links, controls and videos with controls too
      await page.mouse.click(x, y);
      if (alt) await page.keyboard.up('Alt');
    },
    // A pin on a phone is a hold (the widget pins at 400 ms): a touch pointer down and held, as test/browser/phonebox.mjs.
    tap: async (x, y) => {
      const touch = (type) => page.evaluate(([t, px, py]) => document.elementFromPoint(px, py).dispatchEvent(new PointerEvent(t, { pointerType: 'touch', isPrimary: true, clientX: px, clientY: py, button: 0, bubbles: true, composed: true })), [type, x, y]);
      await touch('pointerdown');
      await page.waitForTimeout(700);
    },
    drag: async (x0, y0, x1, y1, { alt = false } = {}) => {
      if (alt) await page.keyboard.down('Alt');
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 6 });
      await page.mouse.move(x1, y1, { steps: 6 });
      await page.mouse.up();
      if (alt) await page.keyboard.up('Alt');
    },
    // Each wait has a deadline: a video that never loads or seeks fails this situation, not the whole run.
    seek: (sel, t) => page.locator(sel).evaluate(async (v, time) => {
      const until = (p, what) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error(`video ${what} took over 10 s`)), 10000))]);
      if (v.readyState < 1) await until(new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true })), 'metadata');
      v.pause();
      await until(new Promise((r) => { v.addEventListener('seeked', r, { once: true }); v.currentTime = time; }), 'seek');
    }, t),
  };
}
const centreOf = (b) => [b.x + b.width / 2, b.y + b.height / 2];

// ---------- what the agent text has to carry, per situation (the sanity check) ----------
const field = (block, name) => block.match(new RegExp(`^${name}: (.*)$`, 'm'))?.[1] ?? '';
const inBox = (x, y, [x1, y1, x2, y2]) => x >= x1 && x <= x2 && y >= y1 && y <= y2;
const overlap = (a, b) => {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  const area = (r) => (r[2] - r[0]) * (r[3] - r[1]);
  return (w * h) / (area(a) + area(b) - w * h);
};
const has = {
  quote: (word) => (b) => [`the word under the pin is quoted: [${word}]`, field(b, 'text').includes(`[${word}]`), field(b, 'text')],
  selector: (part) => (b) => [`the selector leads to the element (${part})`, field(b, 'selector \\(at comment time\\)').includes(part), field(b, 'selector \\(at comment time\\)')],
  section: (name) => (b) => [`the section heading is "${name}"`, field(b, 'section') === `"${name}"`, field(b, 'section')],
  element: (part) => (b) => [`the element is ${part}`, field(b, 'element').includes(part), field(b, 'element')],
  areaText: (words) => (b) => ['the words in the area are exactly the ones marked', tokens(field(b, 'text in area')).join(' ') === tokens(words).join(' '), field(b, 'text in area')],
  codeLine: (label, n) => (b) => [`code block "${label || 'no label'}", line ${n}`, (label ? field(b, 'on') .includes(`"${label}"`) : field(b, 'on') === 'code') && +field(b, 'line').split(' ')[0] === n, `${field(b, 'on')} · ${field(b, 'line')}`],
  file: (hint) => (b) => [`the file is named (${hint})`, field(b, 'on').includes(`"${hint}"`), field(b, 'on')],
  spot: (box, size) => (b) => {
    const m = field(b, 'spot in original').match(/([\d.]+)% across, ([\d.]+)% down of (\d+)×(\d+)/);
    const exact = field(b, 'spot in original').match(/\(pixel (\d+),(\d+)\)/);
    const [x, y] = exact ? [+exact[1], +exact[2]] : m ? [(m[1] / 100) * m[3], (m[2] / 100) * m[4]] : [NaN, NaN];
    const k = m && size ? size[0] / m[3] : 1; // a srcset variant: same picture, other size
    return ['the spot, in the file’s own pixels, is on the thing', inBox(x * k, y * k, box), m ? `${field(b, 'spot in original')} = ${Math.round(x)},${Math.round(y)}` : 'no "spot in original" line'];
  },
  size: ([w, h]) => (b) => ['the size printed with the spot is the file’s own size', field(b, 'spot in original').includes(`of ${w}×${h}`), field(b, 'spot in original')],
  area: (box) => (b) => {
    const m = field(b, 'area in original').match(/pixels (\d+),(\d+) to (\d+),(\d+)/);
    return ['the area, in the file’s own pixels, is the one marked', m && overlap(m.slice(1).map(Number), box) >= 0.5, m ? m[0] : 'no "area in original" line'];
  },
  time: (from, to) => (b) => {
    const m = field(b, 'video time').match(/(\d+):(\d+(?:\.\d)?)/);
    const t = m ? +m[1] * 60 + +m[2] : NaN;
    return [`the video time is between ${from} and ${to} s`, t >= from && t < to, field(b, 'video time')];
  },
  canvasBar: (index, of, padLeft, padRight, width) => (b) => {
    const m = field(b, 'spot').match(/([\d.]+)% across/);
    const at = m ? Math.floor(((m[1] / 100) * width - padLeft) / ((width - padLeft - padRight) / of)) : NaN;
    return [`the spot on the canvas falls on bar ${index + 1} of ${of}`, at === index, `${field(b, 'on')} · ${field(b, 'spot')}`];
  },
  scheme: (which) => (b) => [`it says the page was in ${which} mode`, field(b, 'colours').startsWith(which), field(b, 'colours') || 'nothing about light or dark'],
  pagePosition: () => (b) => ['it says where on the page (not only where on a page-tall element)', /^(page position|between|doc y|after|before):/m.test(b), `${field(b, 'element')} · ${field(b, 'where on element')}`],
};

// ---------- the situations ----------
// Each one pins a comment and returns what a correct answer is (expect) and what the agent text must carry (needs).
const P = 'pricing.html', D = 'docs.html', T = 'tour.html';
const sizeOf = (f) => [media[f].width, media[f].height];
let situations = {
  '/sit/pricing': [
    {
      id: 'text-word', group: 'text', comment: 'say archive instead of this word',
      tests: 'point on one word in a paragraph; the word shows elsewhere on the page too',
      async pin(w) {
        await w.click(...centreOf(await w.$('word', '.hero .lead', 'history')));
        return { expect: { file: P, lines: [lineOf(P, 'with unlimited history on every paid plan')], words: 'history' }, needs: [has.quote('history'), has.element('<p class="lead">')] };
      },
    },
    {
      id: 'text-heading', group: 'text', comment: 'rename this plan to Crew',
      tests: 'point on a heading; the same word is a table header and a second (hidden) heading',
      async pin(w) {
        await w.click(...centreOf(await w.$('word', '#plans .plan:nth-of-type(2) h3', 'Team')));
        return { expect: { file: P, lines: [lineOf(P, '<h3>Team</h3>', 1)], words: 'Team' }, needs: [has.quote('Team'), has.element('<h3>'), has.selector('#plans')] };
      },
    },
    {
      id: 'text-list-item', group: 'text', comment: 'nobody gets this one, call it free/busy',
      tests: 'point on a list item; the same item is in the next plan’s list',
      async pin(w) {
        await w.click(...centreOf(await w.$('word', '#plans .plan:nth-of-type(2) li:nth-of-type(4)', 'availability')));
        return { expect: { file: P, lines: [lineOf(P, '<li>Shared availability</li>', 1)], words: 'availability' }, needs: [has.quote('availability'), has.section('Team'), has.selector('article:nth-of-type(2)')] };
      },
    },
    {
      id: 'text-link-option', group: 'text', comment: 'on this plan the button should say Talk to us',
      tests: 'Option-click on a link; three links on the page read the same, only the address differs',
      async pin(w) {
        await w.click(...centreOf(await w.$('word', '#plans .plan:nth-of-type(3) a.btn', 'trial')), { alt: true });
        return { expect: { file: P, lines: [lineOf(P, 'href="/signup?plan=studio"')], words: 'trial' }, needs: [has.quote('trial'), has.element('href="/signup?plan=studio"')] };
      },
    },
    {
      id: 'text-table-cell', group: 'text', comment: 'should be 1 year here, not unlimited',
      tests: 'point on a table cell; five cells in the table read the same',
      async pin(w) {
        await w.click(...centreOf(await w.$('word', '#compare tbody tr:nth-of-type(3) td:nth-of-type(2)', 'Unlimited')));
        return { expect: { file: P, lines: [lineOf(P, '<th scope="row">History</th>') + 2], words: 'Unlimited' }, needs: [has.quote('Unlimited'), has.selector('tr:nth-of-type(3) > td:nth-of-type(2)')] };
      },
    },
    {
      id: 'other-gap-between-sections', group: 'other', comment: 'too much empty space here',
      tests: 'point on the empty space between two sections, far down the page',
      async pin(w) {
        const faq = await w.$('box', '#faq', 0.5, 0);
        const compare = await w.$('box', '#compare', 0.5, 0.5, false);
        const y = (compare.y + compare.height + faq.y) / 2;
        await w.click(faq.x + faq.width / 2, y);
        return { expect: { file: P, lines: [lineOf(P, '<section id="faq">') - 2, lineOf(P, '<section id="faq">')] }, needs: [has.pagePosition()] };
      },
    },
    {
      id: 'text-area-part-of-line', group: 'text', comment: 'legal says this has to be 14',
      tests: 'area over three words of one line, drawn taller than the line',
      async pin(w) {
        const sel = '#faq p:nth-of-type(1)';
        const a = await w.$('word', sel, 'within');
        const b = await w.$('word', sel, 'days');
        if (Math.abs(a.y - b.y) > 2) throw new Error('"within 30 days" wraps: change the paragraph');
        const zone = { x0: a.x - 3, y0: a.y - 9, x1: b.x + b.width + 3, y1: b.y + b.height + 9 };
        await w.drag(zone.x0, zone.y0, zone.x1, zone.y1);
        return { expect: { file: P, lines: [lineOf(P, 'If you cancel within 30 days')], words: 'within 30 days' }, needs: [has.areaText('within 30 days')], zone };
      },
    },
    {
      id: 'text-area-two-lines', group: 'text', comment: 'this part is confusing, rewrite it',
      tests: 'area over the second and third line of a four-line paragraph (with &nbsp; &mdash; &rsquo; in the source)',
      async pin(w) {
        const sel = '#faq p:nth-of-type(2)';
        const rows = await w.$('lines', sel);
        if (rows.length < 4) throw new Error(`the paragraph wraps to ${rows.length} lines, need 4`);
        const zone = { x0: Math.min(rows[1].left, rows[2].left) - 6, y0: rows[1].top - 1, x1: Math.max(rows[1].right, rows[2].right) + 6, y1: rows[2].bottom + 1 };
        const words = await w.$('wordsIn', sel, zone);
        await w.drag(zone.x0, zone.y0, zone.x1, zone.y1);
        return { expect: { file: P, lines: [lineOf(P, 'Nothing is deleted.'), lineOf(P, 'past the limit.')], words }, needs: [has.areaText(words)], zone };
      },
    },
    {
      id: 'text-form-input', group: 'text', comment: 'make this a dropdown with ranges',
      tests: 'Option-click inside a form field (third of four, no id, no text of its own)',
      async pin(w) {
        await w.click(...centreOf(await w.$('box', '#contact input[name="team-size"]')), { alt: true });
        return { expect: { file: P, lines: [lineOf(P, 'name="team-size"')] }, needs: [has.element('<input'), has.selector('label:nth-of-type(3) > input')] };
      },
    },
    {
      id: 'text-same-sentence-twice', group: 'text', comment: 'drop this, it is already said at the top',
      tests: 'point on a sentence that is on the page twice, word for word (top and bottom)',
      async pin(w) {
        await w.click(...centreOf(await w.$('word', '.cta .fine', 'card')));
        return { expect: { file: P, lines: [lineOf(P, 'No credit card required.', 2)], words: 'card' }, needs: [has.quote('card'), has.section('Ready when you are')] };
      },
    },
    {
      id: 'other-sticky-header', group: 'other', comment: 'too long up here, cut it to two words',
      tests: 'point on text in the sticky header after scrolling to the bottom; the footer right below has the same words',
      async pin(w) {
        await w.page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        await w.page.waitForTimeout(800); // a click while the page still scrolls pins nothing, as for a person
        await w.click(...centreOf(await w.$('word', '.site-header .tagline', 'small', 0, false)));
        return { expect: { file: P, lines: [lineOf(P, '<span class="tagline">')], words: 'small' }, needs: [has.quote('small'), has.element('<span class="tagline">'), has.selector('header')] };
      },
    },
  ],
  '/sit/pricing#phone': [
    {
      id: 'other-phone-layout', group: 'other', comment: 'Solo should say 30 days',
      tests: 'tap on a phone (390 px wide, 3x): the table is replaced by cards there, so the same value is in the source twice',
      async pin(w) {
        await w.tap(...centreOf(await w.$('word', '#compare .compare-cards article:nth-of-type(1) dd:nth-of-type(3)', '90')));
        return { expect: { file: P, lines: [lineOf(P, '<dd>90 days</dd>')], words: '90' }, needs: [has.quote('90'), has.element('<dd>'), has.selector('article:nth-of-type(1)')] };
      },
    },
  ],
  '/sit/docs': [
    {
      id: 'code-long-block', group: 'code', comment: 'the cap here cuts off what the server asked for',
      tests: 'a line far down a 74-line block that scrolls inside its own box (coloured code: many small spans)',
      async pin(w) {
        await w.click(...centreOf(await w.$('word', '#retries pre code', 'asked', 1)));
        const line = lineOf('src/sync/retry.ts', 'const delayMs = Math.min(asked');
        return { expect: { file: 'src/sync/retry.ts', lines: [line] }, needs: [has.codeLine('src/sync/retry.ts', line)] };
      },
    },
    {
      id: 'code-identical-lines', group: 'code', comment: 'pushes need a longer timeout than this',
      tests: 'two identical lines in one block (pull and push): the second one',
      async pin(w) {
        await w.click(...centreOf(await w.$('word', '#client pre code', 'AbortSignal', 1)));
        const line = lineOf('src/sync/client.ts', 'signal: AbortSignal.timeout(timeoutMs),', 2);
        return { expect: { file: 'src/sync/client.ts', lines: [line] }, needs: [has.codeLine('src/sync/client.ts', line)] };
      },
    },
    {
      id: 'code-same-snippet-two-files', group: 'code', comment: 'three is enough on this one',
      tests: 'the same line, at the same line number, in two blocks from two files (staging and production)',
      async pin(w) {
        await w.click(...centreOf(await w.$('word', '#options figure:nth-of-type(2) pre code', 'maxAttempts')));
        const line = lineOf('config/sync.production.ts', 'maxAttempts: 5,');
        return { expect: { file: 'config/sync.production.ts', lines: [line] }, needs: [has.codeLine('config/sync.production.ts', line)] };
      },
    },
    {
      id: 'code-inline-in-prose', group: 'code', comment: 'link this to the options table',
      tests: 'inline code inside a sentence; the same name is in four code blocks, a table and another paragraph',
      async pin(w) {
        await w.click(...centreOf(await w.$('word', '#options > p', 'maxAttempts')));
        return { expect: { file: D, lines: [lineOf(D, 'Set <code>maxAttempts</code> to')], words: 'maxAttempts' }, needs: [has.quote('maxAttempts'), has.element('<code>')] };
      },
    },
    {
      id: 'code-same-command-two-blocks', group: 'code', comment: 'add --strict to this run',
      tests: 'the same command in two blocks with no file label (on your machine / in CI): the CI one',
      async pin(w) {
        await w.click(...centreOf(await w.$('word', '#check pre:nth-of-type(2) code', '--check')));
        return { expect: { file: D, lines: [lineOf(D, 'npx tidepool sync --check', 2)] }, needs: [has.codeLine('', 2), has.section('In CI')] };
      },
    },
    {
      id: 'other-scrolled-far-rendered', group: 'other', comment: 'this shipped a version later, move it',
      tests: 'point on text at the very bottom of a long page; the text is put there by a script from a JSON file',
      async pin(w) {
        await w.page.locator('#changelog-list li').first().waitFor();
        await w.click(...centreOf(await w.$('word', '#changelog-list', 'honour')));
        return { expect: { file: 'data/changelog.json', lines: [lineOf('data/changelog.json', 'Retries now honour the Retry-After header.')], words: 'honour' }, needs: [has.quote('honour'), has.section('2.3.1 · 18 September 2026')] };
      },
    },
  ],
  '/sit/tour': [
    {
      id: 'photo-css-background', group: 'photos', comment: 'this looks odd, pick a photo without it',
      tests: 'point on a thing in a CSS background photo (cover, cropped top and bottom)',
      async pin(w) {
        const f = 'hero-desk.jpg';
        const b = await w.$('box', '.tour-hero');
        await w.click(...fit(b, sizeOf(f), 'cover').screen(...mid(media[f].boxes.mug)));
        return { expect: { file: `media/${f}`, size: sizeOf(f), box: media[f].boxes.mug }, needs: [has.file('hero-desk'), has.spot(media[f].boxes.mug)] };
      },
    },
    {
      id: 'photo-large-scaled', group: 'photos', comment: 'this one should start at 10:00',
      tests: 'point in a 2880×1800 screenshot shown 912 px wide; five things in a row look the same',
      async pin(w) {
        const f = 'app-week.png', box = media[f].boxes['standup-thu'];
        const b = await w.$('box', '#week img', ...mid(box).map((v, i) => v / sizeOf(f)[i]));
        await w.click(...fit(b, sizeOf(f)).screen(...mid(box)));
        return { expect: { file: `media/${f}`, size: sizeOf(f), box }, needs: [has.file('app-week'), has.spot(box)] };
      },
    },
    {
      id: 'photo-area', group: 'photos', comment: 'hide this panel in the screenshot',
      tests: 'area on an image (around the small month calendar in the screenshot)',
      async pin(w) {
        const f = 'app-week.png', [x1, y1, x2, y2] = media[f].boxes['mini-calendar'];
        const area = [x1 - 14, y1 - 14, x2 + 14, y2 + 14];
        const m = fit(await w.$('box', '#week img', 0.1, 0.2), sizeOf(f));
        await w.drag(...m.screen(area[0], area[1]), ...m.screen(area[2], area[3]));
        return { expect: { file: `media/${f}`, size: sizeOf(f), area }, needs: [has.file('app-week'), has.area(area)] };
      },
    },
    {
      id: 'photo-object-fit-cover', group: 'photos', comment: 'make this brighter',
      tests: 'point on a square thumbnail of a 3:2 picture (object-fit: cover, object-position: 78% 50%): screen position is not file position',
      async pin(w) {
        const f = 'template-offsite.jpg', box = media[f].boxes.campfire;
        const b = await w.$('box', '#templates .template:nth-of-type(2) .thumb');
        await w.click(...fit(b, sizeOf(f), 'cover', 0.78, 0.5).screen(...mid(box)));
        return { expect: { file: `media/${f}`, size: sizeOf(f), box }, needs: [has.file('template-offsite'), has.spot(box)] };
      },
    },
    {
      id: 'photo-srcset', group: 'photos', comment: 'retouch this out',
      tests: 'point on a responsive image (srcset 800/1600/2400): the browser shows the 1600 file, the tag names the 800 one',
      async pin(w) {
        const big = 'harbour-2400.jpg', box = media[big].boxes['red-buoy'];
        const b = await w.$('box', '#harbour img', ...mid(box).map((v, i) => v / sizeOf(big)[i]));
        await w.click(...fit(b, sizeOf(big)).screen(...mid(box)));
        const files = Object.fromEntries(['800', '1600', '2400'].map((n) => [`media/harbour-${n}.jpg`, sizeOf(`harbour-${n}.jpg`)]));
        return { expect: { files, size: sizeOf(big), box }, needs: [has.file('harbour-1600'), has.spot(box, sizeOf(big)), has.size(sizeOf('harbour-1600.jpg'))] };
      },
    },
    {
      id: 'photo-svg-shape', group: 'photos', comment: 'this bar looks too low, check the number',
      tests: 'point on one shape of an inline SVG chart (fifth of seven bars, no ids)',
      async pin(w) {
        await w.click(...centreOf(await w.$('box', '#numbers svg .bars rect:nth-of-type(5)')));
        return { expect: { file: T, lines: [lineOf(T, '<rect class="bar" x="430"')] }, needs: [has.element('<rect class="bar">'), has.selector('rect:nth-of-type(5)')] };
      },
    },
    {
      id: 'other-canvas-chart', group: 'other', comment: 'is this month right? it looks too high',
      tests: 'point on a bar of a chart drawn on a canvas by a script: the answer is the data line, found through the drawing code',
      async pin(w) {
        const b = await w.$('box', '#growth');
        // Bar 10 of 12 (Sep): left pad 96, 140 px per month, in the canvas's own 1824×640 pixels.
        await w.click(...fit(b, [1824, 640]).screen(96 + 9.5 * 140, 365));
        return { expect: { file: 'tour-chart.js', lines: [lineOf('tour-chart.js', "month: 'Sep'")] }, needs: [has.canvasBar(9, 12, 96, 48, 1824)] };
      },
    },
    {
      id: 'photo-tall-screenshot-row', group: 'photos', comment: 'this entry is a duplicate, hide it',
      tests: 'point on one row of a 1600×7200 full-page screenshot (125 rows of 56 px)',
      async pin(w) {
        const f = 'activity-log.png', box = media[f].boxes['log-row-68'];
        const at = [640, box[1] + 22]; // on the row's text, a little above its middle
        const b = await w.$('box', '#activity img', at[0] / sizeOf(f)[0], at[1] / sizeOf(f)[1]);
        await w.click(...fit(b, sizeOf(f)).screen(...at));
        return { expect: { file: `media/${f}`, size: sizeOf(f), box }, needs: [has.file('activity-log'), has.spot(box)] };
      },
    },
  ],
  '/sit/demo': [
    {
      id: 'video-spot', group: 'video', comment: 'this covers the button, show it somewhere else',
      tests: 'point on a video paused at 7.3 s (the thing is on screen from 6 to 9 s only)',
      async pin(w) {
        const f = 'tour.webm', scene = media[f].scenes[7];
        await w.seek('#walkthrough video', 7.3);
        const b = await w.$('box', '#walkthrough video');
        await w.click(...fit(b, sizeOf(f)).screen(1180, 96), { alt: true });
        return { expect: { file: `media/${f}`, size: sizeOf(f), box: scene.boxes.toast, from: 6, to: 9 }, needs: [has.file('tour'), has.spot(scene.boxes.toast), has.time(6, 9)] };
      },
    },
    {
      id: 'video-same-place-other-time', group: 'video', comment: 'make this smaller',
      tests: 'a second comment on the same video, almost the same place, paused at 1.5 s: something else is there then',
      async pin(w) {
        const f = 'tour.webm', scene = media[f].scenes[1];
        await w.seek('#walkthrough video', 1.5);
        const b = await w.$('box', '#walkthrough video');
        await w.click(...fit(b, sizeOf(f)).screen(1160, 112), { alt: true });
        return { expect: { file: `media/${f}`, size: sizeOf(f), box: scene.boxes.fab, from: 0, to: 3 }, needs: [has.file('tour'), has.spot(scene.boxes.fab), has.time(0, 3)] };
      },
    },
    {
      id: 'video-area', group: 'video', comment: 'show three people here, not two',
      tests: 'area on a 4:3 video shown in a wider box (black bars left and right), paused at 3.2 s',
      async pin(w) {
        const f = 'new-event.webm', [x1, y1, x2, y2] = media[f].scenes[3].boxes['sheet-guests'];
        const area = [x1 - 10, y1 - 10, x2 + 10, y2 + 10];
        await w.seek('#new-event video', 3.2);
        const m = fit(await w.$('box', '#new-event video'), sizeOf(f), 'contain');
        await w.drag(...m.screen(area[0], area[1]), ...m.screen(area[2], area[3]), { alt: true });
        return { expect: { file: `media/${f}`, size: sizeOf(f), area, from: 2, to: 4 }, needs: [has.file('new-event'), has.area(area), has.time(2, 4)] };
      },
    },
  ],
  '/sit/status': [
    {
      id: 'other-dark-mode', group: 'other', comment: 'can barely read this line',
      tests: 'point on text while the page is in dark mode; the page has light and dark colours and the complaint is only true in dark',
      async pin(w) {
        await w.click(...centreOf(await w.$('word', 'main > p:nth-of-type(3)', 'Started')));
        return { expect: { file: 'status.html', lines: [lineOf('status.html', 'Started 14 November 2026')], words: 'Started', color_scheme: 'dark' }, needs: [has.quote('Started'), has.scheme('dark')] };
      },
    },
  ],
};
let windows = {
  '/sit/pricing#phone': { name: 'Ines', context: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  '/sit/status': { context: { colorScheme: 'dark' } },
};
// The other batches live in their own files (situations-2.mjs) and get the same helpers.
if (BATCH !== '1') ({ situations, windows } = (await import(`./situations-${BATCH}.mjs`)).default({ lineOf, fit, mid, centreOf, tokens, field, inBox, overlap, has, HERE, SITE }));

// ---------- pin them ----------
const browser = await chromium.launch(); // headless, one at a time
const done = [];
try {
  for (const [key, list] of Object.entries(situations)) {
    const w = await open(browser, key.split('#')[0], windows[key]);
    for (const s of list) {
      const { expect, needs, zone } = await s.pin(w);
      await w.say(s.comment);
      done.push({ ...s, page: key.split('#')[0], expect, needs, zone });
      console.log('pinned', s.id);
    }
    await w.close();
  }
} finally {
  await browser.close();
}

// ---------- what the agent gets: no login, no browser ----------
const pages = [...new Set(done.map((s) => s.page))];
let all = '';
const blocks = {};
const stored = {};
const get = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status} ${await r.text()}`);
  return r;
};
for (const p of pages) {
  const text = await (await get(`${BASE}/_lab/agent${p}`)).text();
  all += `===== ${BASE}/_lab/agent${p} =====\n${text}\n`;
  for (const b of text.split('\n## ').slice(1)) blocks[b.match(/^comment: (.*)$/m)?.[1]] = b;
  for (const c of (await (await get(`${BASE}/_lab/api/comments?page=${encodeURIComponent(p)}`)).json()).comments) stored[c.text] = c.anchor;
}
fs.mkdirSync(path.join(HERE, 'results'), { recursive: true });
fs.writeFileSync(path.join(HERE, OUT.text), all);

// ---------- the truth, and the sanity check: is what an agent needs in the text? ----------
let surprises = 0;
let complete = 0;
const truth = done.map((s) => {
  const block = blocks[s.comment] || '';
  const recorded = s.needs.map((need) => { const [what, ok, got] = need(block); return { what, ok: Boolean(ok), got }; });
  const enough = Boolean(block) && recorded.every((r) => r.ok);
  if (enough) complete++;
  if (enough === Boolean(s.gap)) surprises++;
  console.log(`${enough ? 'ok  ' : s.gap ? 'gap ' : 'FAIL'} ${s.id.padEnd(30)} ${recorded.map((r) => `${r.ok ? '✓' : '✗'} ${r.what} · ${r.got}`).join('\n' + ' '.repeat(36))}${enough && s.gap ? '\n' + ' '.repeat(36) + 'expected a gap here, but the text has it now' : ''}`);
  return {
    id: s.id, group: s.group, tests: s.tests, page: s.page, comment: s.comment, expect: s.expect,
    ...(s.gap ? { expected_gap: s.gap } : {}),
    in_agent_text: recorded,
    ...(s.zone ? { zone_on_screen: Object.fromEntries(Object.entries(s.zone).map(([k, v]) => [k, Math.round(v)])) } : {}),
    anchor: stored[s.comment],
  };
});
fs.writeFileSync(path.join(HERE, OUT.truth), JSON.stringify({ fixtures: 'bench/situations', agent_text: `bench/${OUT.text}`, situations: truth }, null, 2) + '\n');
const gaps = truth.filter((t) => t.expected_gap).length;
console.log(`${truth.length} situations pinned · ${complete} with everything in the agent text · ${gaps} expected gaps · ${Buffer.byteLength(all)} bytes of agent text`);
if (surprises) console.log(`${surprises} did not go as expected (FAIL, or a gap that closed): see above`);
if (process.env.KEEP) console.log(`pages stay up at ${BASE}${Object.keys(situations)[0].split('#')[0]} (KEEP=1)`);
else process.exit(surprises ? 1 : 0);
