// A phone's chat bottom (Leo, 27 Nov: messages were cut hard by the box, an agent's name and dots showed below it, and the
// margins round the box were "big holes"), in WebKit and Chromium with a phone's viewport and touch: the box sits 8 px in
// from the sheet's sides and bottom; read back, the messages fade out from 32 px above the box and are gone 8 px into it,
// so nothing of the list shows under or below the box; at the newest the fade has stepped down, so the last message is
// whole and clear. Not part of `npm test`; CI runs it in the `browser` job. Run: node test/browser/chatfade.mjs (needs
// playwright; NODE_PATH can point at a node_modules that has it). One line per check; exits 1 if any fails.
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { execFile } from 'node:child_process';
import { playwright, engines, LAB, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });
const chatSpot = { kind: 'page', width: 390, height: 844, dpr: 2 };

for (const [n, eng] of engines().entries()) {
  const dir = tmp('labit-chatfade-');
  const port = String(claimPort(8980 + n * 15, 15));
  const B = `http://localhost:${port}`;
  const env = labEnv({ LAB_SETTLE_MS: '0' }, { settings: false });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>s</title><body style="margin:20px"><p>a page</p></body>');
  const server = startLab(dir, env, { root: '.', port });
  const browser = await pw[eng].launch();
  try {
    await labUp(B);
    const seen = [];
    for (let i = 0; i < 30; i++) {
      const r = await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', name: i === 29 ? 'leo' : i % 2 ? 'Ann' : 'Sam', text: `Message ${i}. ` + 'Words that wrap onto a second line on a phone. '.repeat(1 + (i % 3)), anchor: chatSpot }) });
      seen.push((await r.json()).comment.id);
    }
    // An agent on your last message: its words ("on it …") under the bubble.
    await new Promise((done) => execFile(process.execPath, [LAB, 'reply', seen[29], '--progress', 'looking at it', '--page', '/index'], { cwd: dir, env }, () => done()));
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: eng === 'chromium', deviceScaleFactor: 2 });
    await ctx.addInitScript(([s]) => {
      localStorage.setItem('lab-name', 'leo');
      localStorage.setItem('lab-seen:/index', s.join(','));
    }, [seen]);
    const p = await ctx.newPage();
    const shadow = (fn, arg) => p.evaluate(([f, a]) => new Function('r', 'a', f)([...document.querySelectorAll('*')].find((x) => x.shadowRoot?.querySelector('.scrim')).shadowRoot, a), [fn.toString().replace(/^[^{]*{|}$/g, ''), arg]);
    await p.goto(B + '/');
    await sleep(1800);
    await shadow(() => { r.querySelector('.chat-btn').click(); });
    await sleep(1200);
    // Where things are, and the bottom fade's stops in the page's pixels: the list's mask image (its second layer) is
    // as tall as the list plus how far it has stepped down (mask-size), its stops measured from that height's end.
    const look = () => shadow(() => {
      const sheet = r.querySelector('.chatwin');
      const box = sheet.querySelector('.chat .box');
      const list = sheet.querySelector('.msgs');
      const R = (e) => e.getBoundingClientRect();
      const cs = getComputedStyle(list);
      const pb = parseFloat(getComputedStyle(sheet.querySelector('.chat')).paddingBottom);
      const sizes = cs.maskSize.split(',').map((x) => x.trim());
      const lr = R(list);
      // The second layer's height: 100% or calc(100% + Npx).
      const extra = Number(/\+\s*([\d.]+)px/.exec(sizes[1] || '')?.[1] || 0);
      const end = lr.bottom + extra;
      const msgs = [...list.querySelectorAll('.msg')];
      return {
        coarse: matchMedia('(pointer: coarse)').matches,
        layers: (cs.maskImage.match(/linear-gradient/g) || []).length,
        timeline: CSS.supports('animation-timeline: scroll()'),
        sheet: R(sheet).toJSON(), box: R(box).toJSON(),
        opaqueTo: end - 82 - pb, // the fade starts here (fully shown above)
        goneAt: end - 42 - pb, // and nothing shows from here down
        last: R(msgs[msgs.length - 1]).toJSON(),
        waits: msgs[msgs.length - 1].classList.contains('waits'),
        words: (() => { const w = msgs[msgs.length - 1].querySelector('.stamp .state'); return w ? { ...R(w).toJSON(), text: w.textContent } : null; })(),
        atEnd: list.scrollHeight - list.scrollTop - list.clientHeight < 2,
      };
    });
    const atEnd = await look();
    check(eng, 'a phone (pointer: coarse) with the chat open', atEnd.coarse && atEnd.layers >= 1, JSON.stringify(atEnd));
    const near = (a, b) => Math.abs(a - b) <= 1;
    check(eng, 'the box sits 8 px in from the sheet\'s sides and bottom', near(atEnd.box.left - atEnd.sheet.left, 8) && near(atEnd.sheet.right - atEnd.box.right, 8) && near(atEnd.sheet.bottom - atEnd.box.bottom, 8), JSON.stringify({ box: atEnd.box, sheet: atEnd.sheet }));
    check(eng, 'at the newest, the last message is whole and clear, 12 px above the box', atEnd.atEnd && atEnd.last.bottom <= atEnd.opaqueTo + 1 && near(atEnd.box.top - atEnd.last.bottom, 12), JSON.stringify(atEnd));
    // Your own message last, an agent on it: its words under it ("on it …") sit in that 12 px, clear of the box .
    check(eng, 'your own waiting message last: 12 px above the box too, its words under it clear of the box', atEnd.waits && near(atEnd.box.top - atEnd.last.bottom, 12) && atEnd.words?.text && atEnd.words.bottom <= atEnd.box.top + 0.5, JSON.stringify({ last: atEnd.last, words: atEnd.words, box: atEnd.box, waits: atEnd.waits }));
    await shadow(() => { const l = r.querySelector('.chatwin .msgs'); l.scrollTop = l.scrollHeight - l.clientHeight - 300; });
    await sleep(400);
    const back = await look();
    // Without scroll timelines the fade stays stepped down (the plain edge, as at the newest): nothing shows below the box either way.
    const down = back.timeline ? 0 : 32;
    check(eng, 'read back, the messages fade from 32 px above the box and are gone 8 px into it (nothing under or below it)',
      near(back.opaqueTo, back.box.top - 32 + down) && near(back.goneAt, back.box.top + 8 + down) && back.goneAt < back.box.bottom, JSON.stringify(back));
  } finally {
    await browser.close();
    server.kill();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
}
finish('');
