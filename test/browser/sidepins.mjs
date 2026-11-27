// A pin in the empty margin beside a centred column (the page's left or right side), in real browsers (WebKit and
// Chrome's engine): it is made, sits where it was put, goes with the line it is level with when the page changes or the
// window is resized, and stays on screen when the window is too narrow for a margin. Not part of `npm test`; CI runs
// it in the `browser` job. Run: node test/browser/sidepins.mjs (needs playwright; NODE_PATH can point at one).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });

const DIR = tmp('labit-sidepins-');
const PORT = claimPort(10500, 30);
const B = `http://localhost:${PORT}`;
const paras = (n) => Array.from({ length: n }, (_, i) => `<p id="p${i}">Paragraph ${i}: words of the line a pin in the margin is level with.</p>`).join('');
const page = (n) => `<!doctype html><meta charset="utf-8"><title>sides</title><style>body{margin:0;font:16px/1.5 sans-serif}main{max-width:600px;margin:0 auto;padding:20px 16px 400px}pre{font:13px/1.6 monospace;padding:8px}p{margin:0 0 60px}</style><main>${paras(n)}<pre id="code">const a = 1;\nconst b = 2;\nreturn a + b;</pre></main>`;
for (const eng of engines('webkit,chromium')) {
  fs.writeFileSync(path.join(DIR, `${eng}.html`), page(8));
  fs.writeFileSync(path.join(DIR, `${eng}-short.html`), '<!doctype html><meta charset="utf-8"><title>s</title><style>body{margin:0}main{max-width:300px;margin:0 auto}</style><main><p id="only">Short.</p></main>');
}
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);
const list = async (name) => (await (await fetch(`${B}/_lab/api/comments?page=/${name}`)).json()).comments;

try {
  for (const eng of engines('webkit,chromium')) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 } });
      await ctx.addInitScript(() => {
        localStorage.setItem('lab-name', 'leo');
        localStorage.setItem('lab-on', '1');
      });
      const p = await ctx.newPage();
      await p.goto(`${B}/${eng}.html`);
      await sleep(1500);
      const pins = () => p.evaluate(() => {
        const root = [...document.querySelectorAll('*')].find((n) => n.shadowRoot).shadowRoot;
        return [...root.querySelectorAll('button.pin')].map((b) => ({ ...b.getBoundingClientRect().toJSON(), moved: b.classList.contains('moved'), hidden: getComputedStyle(b).display === 'none' || b.hidden }));
      });
      const line = async (id) => p.locator(`#${id}`).boundingBox();
      const say = async (x, y, text) => {
        await p.mouse.click(x, y, { modifiers: ['Alt'] });
        await sleep(500);
        await p.keyboard.type(text);
        await p.keyboard.press('Enter');
        await sleep(900);
        await p.keyboard.press('Escape');
        await sleep(300);
      };

      // Option-click in the left margin and in the right one, level with the third paragraph.
      const third = await line('p2');
      const y = Math.round(third.y + third.height / 2);
      await say(180, y, 'left side');
      await say(1250, y, 'right side');
      const made = await list(eng);
      const [left, right] = ['left side', 'right side'].map((t) => made.find((c) => c.text === t));
      check(eng, 'a pin in the left margin is made', Boolean(left), String(made.length));
      check(eng, 'a pin in the right margin is made', Boolean(right), String(made.length));
      check(eng, 'it is on the line it is level with, not on the page', left?.anchor.selector === '#p2' && right?.anchor.selector === '#p2', `${left?.anchor.selector} | ${right?.anchor.selector}`);
      check(eng, 'and says how far out: left of it, right of it', left?.anchor.sx < -100 && right?.anchor.sx > 100, `${left?.anchor.sx} ${right?.anchor.sx}`);

      // Where they are drawn: the tip (bottom left of the pin) at the click.
      const tips = async () => (await pins()).map((q) => ({ left: Math.round(q.left), tip: Math.round(q.bottom) }));
      let [a, b] = await tips();
      check(eng, 'drawn where they were put', Math.abs(a.left - 180) <= 2 && Math.abs(a.tip - y) <= 3 && !(await pins())[0].moved, JSON.stringify([a, b]));

      // After a reload.
      await p.reload();
      await sleep(1800);
      [a, b] = await tips();
      const dist = async () => { const m = await p.locator('main').boundingBox(); return [m.x - (await tips())[0].left, (await tips())[1].left - (m.x + m.width)]; };
      const before = await dist();
      check(eng, 'back at the same spot after a reload', Math.abs(a.left - 180) <= 2 && Math.abs(a.tip - y) <= 3, JSON.stringify([a, b]));

      // The window narrower and wider: the pins stay the same distance from the column.
      for (const w of [1250, 1800]) {
        await p.setViewportSize({ width: w, height: 800 });
        await sleep(700);
        const d = await dist();
        const t = await tips();
        check(eng, `at ${w} px wide they keep their distance from the column`, Math.abs(d[0] - before[0]) <= 2 && Math.abs(d[1] - before[1]) <= 2 && Math.abs(t[0].tip - y) <= 3, JSON.stringify({ before, d, t }));
      }

      // A pin put on a line of code sits where it was put (it used to move to the letters' own box, a few px up or down).
      await p.evaluate(() => document.querySelector('#code').scrollIntoView({ block: 'center' }));
      await sleep(400);
      const code = await line('code');
      const spots = [8, 26, 30].map((d) => [Math.round(code.x + 40), Math.round(code.y + d)]);
      for (const [i, [x, cy]] of spots.entries()) await say(x, cy, `code ${i}`);
      // Each spot has a pin whose tip is on it (±1 px).
      const tipsOn = async (at) => { const all = await pins(); return at.every(([x, y]) => all.some((q) => Math.abs(q.left - x) <= 1 && Math.abs(q.bottom - y) <= 1)); };
      check(eng, 'a pin on a line of code is where it was put', await tipsOn(spots), JSON.stringify([spots, (await pins()).map((q) => [Math.round(q.left), Math.round(q.bottom)])]));
      await p.reload();
      await sleep(1800);
      await p.evaluate(() => document.querySelector('#code').scrollIntoView({ block: 'center' }));
      await sleep(500);
      const code2 = await line('code');
      const shift = Math.round(code2.y - code.y);
      check(eng, 'and after a reload', await tipsOn(spots.map(([x, y]) => [x, y + shift])), JSON.stringify([shift, (await pins()).map((q) => [Math.round(q.left), Math.round(q.bottom)])]));
      await p.evaluate(() => scrollTo(0, 0));
      await sleep(400);

      // The page grows above them (the agent adds a block): they go down with their line.
      await p.setViewportSize({ width: 1400, height: 800 });
      await sleep(600);
      await p.evaluate(() => {
        const d = document.createElement('div');
        d.style.height = '150px';
        document.querySelector('main').prepend(d);
      });
      await sleep(700);
      const moved = await line('p2');
      const t2 = await tips();
      check(eng, 'they go with their line when the page changes', Math.abs(t2[0].tip - (moved.y + moved.height / 2)) <= 3 && Math.abs(t2[1].tip - (moved.y + moved.height / 2)) <= 3, JSON.stringify({ moved, t2 }));

      // A window with no margin (a phone): the pins are kept on the screen.
      await p.setViewportSize({ width: 420, height: 800 });
      await sleep(700);
      const narrow = await pins();
      check(eng, 'with no room for a margin they stay on the screen', narrow.every((q) => q.left >= 0 && q.right <= 420), JSON.stringify(narrow.map((q) => [Math.round(q.left), Math.round(q.right)])));

      // A click beside nothing (below a short page's content): the page itself, as before.
      await p.setViewportSize({ width: 1400, height: 800 });
      await p.goto(`${B}/${eng}-short.html`);
      await sleep(1500);
      await say(200, 600, 'below');
      const below = (await list(`${eng}-short`)).find((c) => c.text === 'below');
      check(eng, 'a click with no line beside it is still made, on the page', below?.anchor.selector === 'body' && !below.anchor.sx, JSON.stringify(below?.anchor));
      check(eng, 'and drawn', (await pins()).length === 1, String((await pins()).length));
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
finish();
