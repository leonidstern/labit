// Several marks, then words: the person draws more than one thing (in one drawing, or several drawings and then a typed
// comment) and says what's wrong across them ("these don't line up"). The real widget makes the comments on a copy of
// dash.html per scenario; an agent (Sonnet by default) gets the page's agent text, as a wait hands it over, edits a
// fresh copy; a Sonnet grader reads the diff against what the fix must show.
//   NODE_PATH=<folder with playwright-core>/node_modules node bench/multi/run.mjs [sonnet] [runs]
// Since 23 Nov (#425) it also holds the loop's other cases: a mark with a question, a picture-only pin, a long thread
// whose ask changed, a fix the person says is still wrong, and a pin made on a phone. Options, by env:
//   ONLY=id,id       run only these scenarios          LAB_ROOT=<a labit checkout>  make the pins with that lab (a baseline)
//   CHECK=1          the agent may look at the page (node shot.mjs <file> <width> saves shot.png it can read)
//   CHROMIUM=1       Playwright's own Chromium instead of the installed Chrome (a cloud machine)   PAR=5  agents at once
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHAPES } from '../drawings/shapes.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(HERE, 'out');
const SITE = join(OUT, 'site');
const PORT = 4494;
const MODEL = process.argv[2] || 'sonnet';
const RUNS = Number(process.argv[3] || 2);
const TAG = process.env.TAG || 'run';

// Each: what is drawn (groups of marks: one group = one drawing, D held throughout), the words, and what must change.
const SCEN = [
  { id: 'one-drawing-align', groups: [[['circle', '.users .value'], ['circle', '.revenue .value'], ['circle', '.churn .value']]], words: "these don't line up",
    problem: "The Revenue value sits lower than the other two stat values: .stat.revenue .value has margin-top: 18px instead of the shared 4px.", done_when: 'The three stat values share one top margin (the .stat.revenue .value override is gone or matches 4px); nothing else changes.' },
  { id: 'three-drawings-then-ask', groups: [[['circle', '.actions .primary']], [['circle', '.actions a[href="#share"]']], [['circle', '.actions .export']]], chat: 'the 3 I circled should sit on one line',
    problem: 'Export sits 9px lower than New report and Share: .btn.export has margin-top: 9px.', done_when: 'The three action buttons align on one line (the .btn.export margin-top is gone); their order and styles are otherwise unchanged.' },
  { id: 'mixed-marks-one-ask', groups: [[['x', '.tag.t4'], ['x', '.tag.t5'], ['circle', '.tag.t3']]], words: 'drop the crossed ones, make the circled one stand out',
    problem: 'Old and Archived tags should go; Draft should look different from the other tags (stand out).', done_when: 'The Old and Archived tags are removed; Draft has a visibly different style (colour or weight) from Q3 and EU; Q3 and EU are unchanged.' },
  { id: 'move-and-rename', groups: [[['arrow', '.card.c h2', '.card.a h2'], ['circle', '.card.b h2']]], words: 'move this one first. and this title is wrong, should be Notifications',
    problem: 'Integrations card should come first (before Weekly digest); the Alerts card title should read Notifications.', done_when: 'The Integrations card is the first card in .cards; the second-marked card (formerly Alerts) is titled Notifications; Weekly digest is kept.' },
  // A mark that only points: the words ask, nothing is to change.
  { id: 'circle-question', groups: [[['circle', '.tag.t3']]], words: 'what is this tag for?',
    problem: 'The person asks what the circled Draft tag is for. It is a question, not a request to change anything.', done_when: 'The page file is unchanged (an empty diff), and the answer talks about the Draft tag.' },
  { id: 'arrow-compare', groups: [[['arrow', '.actions .export', '.actions a[href="#share"]']]], words: 'why does this one look different from that one?',
    problem: 'The person asks why Export looks different from Share (Export sits 9px lower: .btn.export has margin-top: 9px). A question, not a move.', done_when: 'Export is not moved (the order New report, Share, Export is kept). Explaining the 9px margin, with or without removing it, is right; moving or restyling anything else is wrong.' },
  // A pin whose only words are a picture.
  { id: 'picture-only', click: '.actions .export', image: ['Export', 'should say: Download CSV'],
    problem: 'The pin on the Export button carries only a picture; the picture says the button should say "Download CSV".', done_when: 'The Export button\'s text is now Download CSV; nothing else changes.' },
  // A long thread: the ask changes in the second message, then the talk goes on.
  { id: 'long-thread-revised', pin: ['.stat.revenue .value', 'make this green'], thread: [
      [0, 'actually not green, keep its colour. make it bolder instead'], [1, 'On it', 'working'], [0, 'and only the number, not the Revenue label'],
      [0, 'is the weight 800 possible?'], [1, 'Yes, the font has 800.', 'question'], [0, 'ok 800 then'], [0, 'thanks, take your time'],
      [0, 'also the other two numbers stay as they are'], [0, 'one more: keep the size'], [0, 'go'] ],
    problem: 'The Revenue number (.stat.revenue .value) should become weight 800, keep its colour and size; the label and the other two numbers stay.', done_when: 'Only the Revenue value gets font-weight 800; no green or other colour change; its size, the Revenue label and the other stat values are unchanged.' },
  // A fix that missed: the agent renamed the wrong card, the person says so on the same pin.
  { id: 'still-wrong', start: [['<h2>Weekly digest</h2>', '<h2>Notifications</h2>']], pin: ['.card.b h2', 'rename this to Notifications'], thread: [
      [1, 'Done: renamed the card title to Notifications.', 'done'], [0, 'still wrong: you renamed Weekly digest. I meant this one, Alerts. Put Weekly digest back.'] ],
    problem: 'The earlier fix renamed the wrong card (Weekly digest became Notifications). Alerts should read Notifications and the first card should read Weekly digest again.', done_when: 'The first card is titled Weekly digest again and the Alerts card is titled Notifications; nothing else changes.' },
  // A pin made on a phone: the fix belongs in a narrow-width rule.
  { id: 'phone-cards', viewport: { width: 390, height: 844 }, pin: ['.cards', 'these are squashed on my phone, stack them'],
    problem: 'On a phone (390 px wide) the three cards are squeezed into three columns; they should stack in one column there.', done_when: 'A media query for narrow widths makes .cards one column; the desktop rule (three columns) is unchanged; nothing else changes.' },
].filter((s) => !process.env.ONLY || process.env.ONLY.split(',').includes(s.id));
const CHECK = process.env.CHECK === '1';

const AGAIN = process.env.AGENTS_ONLY; // reuse the comments made last time
if (!AGAIN) rmSync(OUT, { recursive: true, force: true });
mkdirSync(SITE, { recursive: true });
for (const s of SCEN) cpSync(join(HERE, 'dash.html'), join(SITE, `${s.id}.html`));
const LAB = process.env.LAB_ROOT || ROOT; // the lab that makes the pins and the text the agent reads
const lab = AGAIN ? { kill() {} } : spawn('node', [join(LAB, 'local.mjs'), '.', '--port', String(PORT), '--no-open', '--new'], { cwd: SITE, stdio: 'ignore' });
process.on('exit', () => lab.kill());
for (let i = 0; i < (AGAIN ? 0 : 40); i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/${SCEN[0].id}`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const browser = AGAIN ? null : await chromium.launch(process.env.CHROMIUM ? {} : { channel: 'chrome' });
const ctx = AGAIN ? null : await browser.newContext({ viewport: { width: 1280, height: 900 } });
if (ctx) await ctx.addInitScript(() => (localStorage.setItem('lab-name', 'leo'), localStorage.setItem('lab-on', '1')));
let page = null;
const newest = async (id) => (await (await fetch(`http://localhost:${PORT}/_lab/api/comments?page=/${id}`)).json()).comments.filter((c) => !c.parent).pop().id;
// The rest of a thread, as the lab takes it: a person's reply, or the agent's (with the lab's agent key and its intent).
const say = (id, page, [agent, text, intent]) => fetch(`http://localhost:${PORT}/_lab/api/comments`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(agent ? { 'x-lab-admin': JSON.parse(readFileSync(join(SITE, '.lab/server.json'), 'utf8')).agent, 'x-lab-agent': '1' } : {}) },
  body: JSON.stringify({ page, parent: id, name: agent ? 'Claude' : 'leo', text, ...(intent ? { intent } : {}) }),
});
const boxOf = (sel) => page.locator(sel).first().evaluate((e) => {
  const r = document.createRange();
  r.selectNodeContents(e);
  let b = r.getBoundingClientRect();
  if (!b.width || !b.height) b = e.getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
});
const root = `[...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.scrim'))?.shadowRoot`;
const until = (sel, ms = 3000) => page.waitForFunction((s) => Boolean(new Function(`return ${s[0]}`)()?.querySelector(s[1])), [root, sel], { timeout: ms }).catch(() => {});
for (const s of AGAIN ? [] : SCEN) {
  page = await ctx.newPage();
  if (s.viewport) await page.setViewportSize(s.viewport);
  await page.goto(`http://localhost:${PORT}/${s.id}`);
  await page.waitForTimeout(1200);
  // A pin with words (pin) or with only a picture (image: its lines drawn on a picture, pasted into the box).
  if (s.pin || s.click) {
    const b = await boxOf(s.pin?.[0] || s.click);
    await page.keyboard.down('Alt'); // Option-click: a link takes a pin too, instead of being followed
    await page.mouse.click(b.x + Math.min(b.w / 2, 40), b.y + b.h / 2);
    await page.keyboard.up('Alt');
    await until('textarea');
    await page.waitForTimeout(300);
    if (s.pin) await page.keyboard.type(s.pin[1]);
    if (s.image) {
      await page.evaluate(async (lines) => {
        const cv = Object.assign(document.createElement('canvas'), { width: 900, height: 300 });
        const g = cv.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, 900, 300);
        g.strokeStyle = '#e11'; g.lineWidth = 6; g.strokeRect(40, 40, 260, 90);
        g.fillStyle = '#1b1e24'; g.font = '600 40px system-ui'; g.fillText(lines[0], 80, 100);
        g.fillStyle = '#e11'; g.font = '600 44px system-ui'; g.fillText(lines[1], 40, 230);
        const dt = new DataTransfer();
        dt.items.add(new File([await new Promise((r) => cv.toBlob(r, 'image/png'))], 'image.png', { type: 'image/png' }));
        const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true });
        let a = document.activeElement;
        while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
        a.dispatchEvent(ev);
      }, s.image);
      await page.waitForTimeout(1500); // uploaded before it goes
    }
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
  }
  if (s.thread) {
    const id = await newest(s.id);
    for (const m of s.thread) await say(id, `/${s.id}`, m);
  }
  for (const [gi, group] of (s.groups || []).entries()) {
    await page.keyboard.down('d');
    for (const [mark, on, to] of group) {
      const strokes = SHAPES[mark](await boxOf(on), to ? await boxOf(to) : null);
      for (const st of strokes) {
        await page.mouse.move(st[0][0], st[0][1]);
        await page.mouse.down();
        for (const [x, y] of st.slice(1)) await page.mouse.move(x, y, { steps: 4 });
        await page.mouse.up();
        await page.waitForTimeout(150);
      }
    }
    await page.keyboard.up('d');
    // A drawing goes as it is the moment it is done (since 21 Nov: no box to send it from); the words come after it, as a
    // reply on its pin, the way a person types them into its card.
    await page.waitForTimeout(1200);
    if (s.words && gi === s.groups.length - 1) await say(await newest(s.id), `/${s.id}`, [0, s.words]);
  }
  if (s.chat) {
    await page.keyboard.press('t'); // the chat: a comment on the page as a whole
    await until('.chatwin textarea');
    await page.waitForTimeout(300);
    await page.keyboard.type(s.chat);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    await page.keyboard.press('Escape');
  }
  const text = await (await fetch(`http://localhost:${PORT}/_lab/agent/${s.id}`)).text();
  writeFileSync(join(OUT, `${s.id}.txt`), text);
  console.log(`${s.id}: ${(text.match(/^## /gm) || []).length} comments, marks: ${[...text.matchAll(/^drawn: (.*)$/gm)].map((m) => m[1]).join(' · ')}`);
  // The pictures the comments carry, for the agent's copy of the site (the lab keeps them under .lab/attachments).
  for (const [, f] of text.matchAll(/^\s*image: (\.lab\/attachments\/\S+)/gm)) cpSync(join(SITE, f), join(OUT, `${s.id}-files`, f));
  await page.close();
}
await browser?.close();
lab.kill();

const claude = (args, cwd) => new Promise((done) => execFile('claude', args, { cwd, timeout: 300000, maxBuffer: 1 << 24 }, (err, out) => {
  try {
    done(JSON.parse(out));
  } catch {
    done({ result: String(out || err) });
  }
}));
// Two files, or two folders (every file in them, new and deleted ones too, without the CHECK=1 look's own files).
const diffOf = (a, b) => {
  try {
    execFileSync('diff', ['-ruN', '-x', 'shot.mjs', '-x', 'shot.png', '-x', 'shots.log', a, b]);
    return '';
  } catch (e) {
    return String(e.stdout);
  }
};
// The look an agent gets with CHECK=1: the page at a width, as a picture it can read; each look is logged.
const SHOT = `import { createRequire } from 'node:module';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { chromium } = createRequire(${JSON.stringify(join(ROOT, 'package.json'))})('playwright-core');
const [file, width = '1280'] = process.argv.slice(2);
const b = await chromium.launch(${process.env.CHROMIUM ? '{}' : "{ channel: 'chrome' }"});
const p = await b.newPage({ viewport: { width: Number(width), height: 900 } });
await p.goto(pathToFileURL(file).href);
await p.screenshot({ path: 'shot.png', fullPage: true });
await b.close();
appendFileSync('shots.log', file + ' ' + width + '\\n');
console.log('saved shot.png');
`;
const results = [];
const jobs = SCEN.flatMap((s) => Array.from({ length: RUNS }, (_, n) => ({ s, n })));
const run = async ({ s, n }) => {
  const dir = join(OUT, `run-${TAG}-${s.id}-${n}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // The page as the agent finds it: dash.html, with an earlier (wrong) fix already in it for a still-wrong case.
  const start = (s.start || []).reduce((h, [a, b]) => h.replace(a, b), readFileSync(join(HERE, 'dash.html'), 'utf8'));
  writeFileSync(join(dir, `${s.id}.html`), start);
  writeFileSync(join(OUT, `${s.id}-start.html`), start);
  try {
    cpSync(join(OUT, `${s.id}-files`), dir, { recursive: true });
  } catch {}
  // The folder as the agent finds it, so the grader sees every file it changed, not only the page.
  const before = `${dir}-start`;
  rmSync(before, { recursive: true, force: true });
  cpSync(dir, before, { recursive: true });
  if (CHECK) writeFileSync(join(dir, 'shot.mjs'), SHOT);
  // The lab's own lines that point at its folder (where to answer, the live link) are left out: the agent works in its own copy.
  const pins = readFileSync(join(OUT, `${s.id}.txt`), 'utf8').split('\n').filter((l) => !/^(to answer|always up to date): /.test(l)).join('\n');
  const look = CHECK ? `\n\nFor a change you can see, look at the page after your edit: \`node shot.mjs ${s.id}.html <width>\` saves shot.png here (the page at that width), which you can Read. Say in your last line whether you looked.` : '';
  const prompt = `You answer comments people leave on pages in a lab (labit). This folder is the site; the page /${s.id} is ${s.id}.html. These comments came in together:\n\n${pins}\n\nDo the work they ask for in the files now (no one is around to answer questions). Then end with one short line: what you did.${look}`;
  const t0 = Date.now();
  const j = await claude(['-p', prompt, '--output-format', 'json', '--model', MODEL, '--permission-mode', 'acceptEdits', '--allowedTools', `Read,Edit,Write,Grep,Glob${CHECK ? ',Bash(node shot.mjs:*)' : ''}`], dir);
  const said = String(j.result || '').trim().split('\n').filter(Boolean).at(-1) || '';
  const diff = diffOf(before, dir);
  const words = String(j.result || '').trim().slice(-1500); // a question's answer is all its words, not only the last line
  const g = await claude(['-p', `You grade a coding agent's edit for a design review benchmark. Reply with JSON only:\n{"verdict":"right|partial|wrong|nothing","unrelated":<changes that have nothing to do with it>,"why":"<one short line>"}\n\nWhat the reviewer meant: ${s.problem}\nDone when: ${s.done_when}\nThe agent's words (the end): ${words}\n\nThe diff (empty = nothing changed):\n${diff.slice(0, 12000) || '(empty)'}`, '--output-format', 'json', '--model', 'sonnet', '--allowedTools', ''], OUT);
  let grade = {};
  try {
    grade = JSON.parse(/\{[\s\S]*\}/.exec(g.result || '')?.[0] || '{}');
  } catch {}
  results.push({ id: s.id, n, verdict: grade.verdict || '?', unrelated: grade.unrelated ?? null, why: grade.why || '', s: Math.round((Date.now() - t0) / 100) / 10, turns: j.num_turns, cost: j.total_cost_usd, out: j.usage?.output_tokens, looked: (() => { try { return readFileSync(join(dir, 'shots.log'), 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } })(), said });
  console.log(`${(grade.verdict || '?').padEnd(8)} ${s.id.padEnd(24)} #${n} ${Math.round((Date.now() - t0) / 1000)}s ${j.num_turns}t  ${grade.why || ''}`.slice(0, 220));
};
const queue = [...jobs];
await Promise.all(Array.from({ length: Number(process.env.PAR) || 3 }, async () => {
  while (queue.length) await run(queue.shift());
}));
writeFileSync(join(HERE, `results-${TAG}.json`), JSON.stringify(results, null, 2));
const right = results.filter((r) => r.verdict === 'right').length;
console.log(`${MODEL} ${TAG}: right ${right} / ${results.length}`);
