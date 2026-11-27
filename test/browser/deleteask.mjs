// "delete comment?" in a pin's card stays asked when an agent's answer comes in meanwhile: the redraw had put the row
// back, the delete pressed next never went, and the pin "came back" (Leo, 27 Nov). The delete then goes, with the answer.
// Run: node test/browser/deleteask.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();
const DIR = tmp('labit-deleteask-');
const PORT = claimPort(8170, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><meta charset="utf-8"><title>d</title><h1 id="h">Hello there</h1><p>words</p>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);
const agentKey = JSON.parse(fs.readFileSync(path.join(DIR, '.lab/server.json'), 'utf8')).agent;
const post = (body, agent) => fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-lab-admin': agentKey, 'x-lab-agent': agent ? '1' : '0' }, body: JSON.stringify({ page: '/index', ...body }) }).then((r) => r.json());
const ids = async () => (await (await fetch(`${B}/_lab/api/comments?page=/index`)).json()).comments.map((c) => c.id);
const R = '[...document.querySelectorAll("*")].find((n) => n.shadowRoot)?.shadowRoot';
const row = (p) => p.evaluate(`[...(${R}?.querySelector('.row.acts')?.children || [])].map((b) => b.textContent.trim()).join('|')`);
const press = (p, word, nth = 0) => p.evaluate(`[...${R}.querySelector('.row.acts').children].filter((b) => b.textContent.trim() === ${JSON.stringify(word)})[${nth}].click()`);

try {
  for (const eng of engines()) {
    const { comment } = await post({ name: 'leo', text: `more ${eng}`, anchor: { kind: 'element', selector: '#h', x: 0.5, y: 0.5 } });
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await ctx.addInitScript(() => (localStorage.setItem('lab-name', 'leo'), localStorage.setItem('lab-on', '1'), localStorage.setItem('lab-hint-seen', '1')));
      const p = await ctx.newPage();
      await p.goto(B + '/');
      await p.waitForFunction(`Boolean(${R}?.querySelector('button.pin'))`, null, { timeout: 8000 }).catch(() => {});
      await p.evaluate(`${R}.querySelector('button.pin').click()`);
      await p.waitForFunction(`Boolean(${R}?.querySelector('.row.acts'))`, null, { timeout: 3000 }).catch(() => {});
      await press(p, 'delete');
      check(eng, 'delete asks first', (await row(p)) === 'delete comment?|delete|cancel', await row(p));
      await post({ parent: comment.id, name: 'Claude', text: 'More of what?' }, true);
      await p.waitForFunction(`${R}.querySelectorAll('.msg, .message').length > 1 || /More of what/.test(${R}.textContent)`, null, { timeout: 3000 }).catch(() => {});
      await p.waitForFunction(`/delete thread\\?/.test(${R}.querySelector('.row.acts')?.textContent || '')`, null, { timeout: 2000 }).catch(() => {});
      check(eng, "an agent's answer coming in keeps the question", (await row(p)) === 'delete thread?|delete|cancel', await row(p));
      await press(p, 'delete');
      let gone = false;
      for (let i = 0; i < 30 && !gone; i++) gone = !(await ids()).includes(comment.id) || (await sleep(100), false);
      check(eng, 'the delete goes, with the answer', gone);
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
}
finish();
