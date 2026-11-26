// Two Safari / phone things: the ⋯ menu fades out when it closes (WebKit has no `overlay` property, so the popover's
// CSS exit is skipped there), and turning the phone with a comment card open keeps its pin and card on screen.
// Not part of `npm test`; CI runs it in the `browser` job.
// Run: node test/browser/menuexit.mjs (needs playwright; NODE_PATH can point at a node_modules that has it).
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright({ ciFails: true });

const DIR = tmp('labit-menuexit-');
const PORT = claimPort(8520, 30);
const B = `http://localhost:${PORT}`;
const words = 'The quick brown fox jumps over the lazy dog while the committee reviews the quarterly figures. ';
const paras = Array.from({ length: 60 }, (_, i) => `<p id="p${i}">Paragraph ${i}. ${words.repeat(2)}</p>`).join('');
fs.writeFileSync(path.join(DIR, 'index.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>m</title><style>body{margin:0;font:17px/1.6 Georgia,serif}main{max-width:640px;margin:0 auto;padding:20px 16px 400px}</style><main><h1>Menu</h1>${paras}</main><p id="low" style="position:absolute;top:1400px;left:60px;margin:0;width:200px">Low words</p><div id="cover" style="position:fixed;right:0;bottom:50px;width:260px;height:300px;z-index:2147483647;background:#fc0"></div><dialog id="dlg" style="top:auto;bottom:0;right:0;left:auto"><p>A page dialog</p></dialog>`);
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);
await fetch(B + '/_lab/api/comments', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', name: 'Sam', text: 'a thread low on the page', anchor: { selector: '#p30', x: 0.5, y: 0.5, docX: 300, docY: 3300, width: 600 } }) });

const ROOT = '[...document.querySelectorAll("*")].find((n) => n.shadowRoot?.querySelector(".scrim")).shadowRoot';
try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const mk = async (opts) => {
        const ctx = await browser.newContext(opts);
        await ctx.addInitScript(() => {
          localStorage.setItem('lab-name', 'leo');
          localStorage.setItem('lab-on', '1');
        });
        const p = await ctx.newPage();
        await p.goto(B + '/');
        await p.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('button.pin')), null, { timeout: 8000 });
        await sleep(900);
        return [ctx, p];
      };
      const sh = (p, expr) => p.evaluate(`(() => { const r = ${ROOT}; return ${expr}; })()`);

      // E. The ⋯ menu after Esc and after the ⋯ button: one sample per frame from the key / click on.
      {
        const [ctx, p] = await mk({ viewport: { width: 1200, height: 800 } });
        await sh(p, `(window.__sample = (ev, target) => { window.__fr = []; const go = () => { const m = r.querySelector('.more-menu'); const cs = getComputedStyle(m); window.__fr.push(cs.display === 'none' ? null : +(+cs.opacity).toFixed(2)); if (window.__fr.length < 30) requestAnimationFrame(go); }; addEventListener(ev, () => requestAnimationFrame(go), { capture: true, once: true }); })`);
        const frames = async (how) => {
          await p.evaluate(`window.__sample(${JSON.stringify(how === 'esc' ? 'keydown' : 'pointerdown')})`);
          if (how === 'esc') await p.keyboard.press('Escape');
          else {
            const b = await sh(p, `(() => { const q = r.querySelector('.more').getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; })()`);
            await p.mouse.click(b[0], b[1]);
          }
          await sleep(700);
          return p.evaluate('window.__fr');
        };
        const open = async () => {
          const b = await sh(p, `(() => { const q = r.querySelector('.more').getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; })()`);
          await p.mouse.click(b[0], b[1]);
          await sleep(700);
        };
        for (const how of ['esc', 'button']) {
          await open();
          const fr = await frames(how);
          const shown = fr.filter((o) => o !== null);
          console.log(`     ${eng} ${how}: ${fr.map((o) => (o === null ? '-' : o)).join(' ')}`);
          check(eng, `the ⋯ menu fades out after ${how === 'esc' ? 'Esc' : 'the ⋯ button'}`, shown.length >= 3 && shown[1] < 1 && fr[fr.length - 1] === null, `${shown.length} frames shown, second frame opacity ${shown[1]}`);
          await sleep(200);
        }
        // "hide comments" from the menu: it fades out at its own height, not snapped shorter as its rows go (Leo, 26 Nov),
        // and the next time comments show, the menu has its real rows back.
        {
          await open();
          await p.evaluate('document.getElementById("cover").style.display = "none"');
          // Clicked with the mouse on it: the row keeps its hover grey while the menu fades (Leo, 26 Nov).
          const t = await sh(p, `(() => { const q = r.querySelector('.more-menu .toggle').getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; })()`);
          await p.mouse.move(t[0], t[1]);
          await sleep(200);
          await sh(p, `(window.__h = []) && (() => { const go = () => { const m = r.querySelector('.more-menu'); if (getComputedStyle(m).display !== 'none' && +getComputedStyle(m).opacity > 0.1) { const row = [...m.querySelectorAll('button')].find((b) => b.textContent.startsWith('hide comments')); window.__h.push([Math.round(m.getBoundingClientRect().height), row ? getComputedStyle(row).backgroundColor : 'none']); requestAnimationFrame(go); } }; requestAnimationFrame(go); })()`);
          await p.mouse.click(t[0], t[1]);
          await sleep(700);
          const hs = (await p.evaluate('window.__h')).map(([h]) => h);
          const greys = (await p.evaluate('window.__h')).map(([, bg]) => bg);
          check(eng, 'hiding comments from the ⋯ menu: the menu leaves at its own height', hs.length >= 2 && Math.max(...hs) - Math.min(...hs) <= 8, hs.join(' '));
          check(eng, 'and the clicked row keeps its grey until the menu is gone', greys.length >= 2 && new Set(greys).size === 1 && !/rgba\(0, 0, 0, 0\)|transparent/.test(greys[0]), greys.join(' | '));
          await sh(p, `r.querySelector('.bar .toggle').click()`);
          await sleep(500);
          await open();
          const real = await sh(p, `r.querySelector('.more-menu .toggle') === r.querySelector('.toggle') && r.querySelector('.more-menu .toggle').textContent.startsWith('hide comments')`);
          check(eng, 'the ⋯ menu has its real rows again once comments show', real, String(real));
          await p.keyboard.press('Escape');
          await sleep(400);
        }
        // A row picked: the ⋯ button's grey leaves with the menu, not at once while it still fades (Leo, 26 Nov).
        {
          await open();
          const c = await sh(p, `(() => { const q = [...r.querySelectorAll('.more-menu button')].find((b) => b.textContent === 'copy link').getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; })()`);
          await p.mouse.move(c[0], c[1]);
          await sleep(200);
          await sh(p, `(window.__d = []) && (() => { const go = () => { const m = r.querySelector('.more-menu'); if (getComputedStyle(m).display !== 'none' && +getComputedStyle(m).opacity > 0.3) { window.__d.push(+getComputedStyle(r.querySelector('.more')).backgroundColor.match(/[\\d.]+(?=\\))/)?.[0] || 0); requestAnimationFrame(go); } }; requestAnimationFrame(go); })()`);
          await p.mouse.click(c[0], c[1]);
          await sleep(700);
          const d = await p.evaluate('window.__d');
          check(eng, 'a row picked: the ⋯ button stays grey while the menu is still clearly there', d.length >= 2 && d.every((a) => a > 0.01), d.join(' '));
          await p.keyboard.press('Escape');
          await sleep(300);
        }
        // A click on the page with the menu open only closes it: no new pin, no comment box (Leo, 23 Nov)
        await open();
        await p.mouse.click(300, 300);
        await sleep(600);
        const after = await sh(p, `({ menu: !r.querySelector('.more-menu').hidden, box: r.querySelectorAll('textarea').length })`);
        check(eng, 'a click on the page with the ⋯ menu open closes it and pins nothing', !after.menu && after.box === 0, JSON.stringify(after));
        await p.mouse.click(300, 300);
        await sleep(600);
        const again = await sh(p, `r.querySelectorAll('textarea').length`);
        check(eng, 'the next click on the page pins as usual', again === 1, String(again));
        await p.keyboard.press('Escape');
        await sleep(300);
        await p.evaluate('document.getElementById("cover").style.display = ""');
        // Over the page's own top-layer dialog (non-modal) and a fixed element at the highest z-index: is the menu's first item what a click would hit?
        await p.evaluate('document.getElementById("dlg").show()');
        const b = await sh(p, `(() => { const q = r.querySelector('.more').getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; })()`);
        await p.mouse.click(b[0], b[1]);
        await sleep(500);
        const hit = await sh(p, `(() => { const m = r.querySelector('.more-menu'); const q = m.querySelector('button').getBoundingClientRect(); const t = document.elementFromPoint(q.x + 5, q.y + 5); return { open: !m.hidden, top: t?.localName + '#' + (t?.id || '') }; })()`);
        console.log(`     ${eng} over a page dialog and a top z-index element: ${JSON.stringify(hit)}`);
        await ctx.close();
      }

      // I. One thing open at a time (Leo, 23 Nov: "close it and open menu or chat"): with a thread or the chat open, one
      // click on ⋯ closes it and opens the menu; with a thread open, the chat closes it too.
      {
        const [ctx, p] = await mk({ viewport: { width: 1200, height: 800 } });
        const at = (sel) => sh(p, `(() => { const q = r.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; })()`);
        const state = () => sh(p, `({ card: Boolean(r.querySelector('.card:not(.out)')), chat: !r.querySelector('.chatwin').hidden, menu: (() => { const m = r.querySelector('.more-menu'); return m.matches(':popover-open') || (!m.hidden && !m.classList.contains('out')); })() })`);
        const openCard = async () => {
          await p.evaluate('document.getElementById("p30").scrollIntoView({ block: "center" })');
          await sleep(500);
          const pin = await at('button.pin');
          await p.mouse.click(pin[0], pin[1]);
          await sleep(600);
        };
        await openCard();
        const before = await state();
        let b = await at('.more');
        await p.mouse.click(b[0], b[1]);
        await sleep(600);
        const after = await state();
        check(eng, 'a thread open, one click on ⋯ closes it and opens the menu', before.card && !after.card && after.menu, JSON.stringify([before, after]));
        await p.keyboard.press('Escape');
        await sleep(400);
        await p.evaluate(() => document.activeElement?.blur());
        await p.keyboard.press('t');
        await sleep(600);
        const chat = await state();
        b = await at('.more');
        await p.mouse.click(b[0], b[1]);
        await sleep(600);
        const chat2 = await state();
        check(eng, 'the chat open, one click on ⋯ closes it and opens the menu', chat.chat && !chat2.chat && chat2.menu, JSON.stringify([chat, chat2]));
        // the labit mark at the bar's end closes an open thread too (Leo, 23 Nov: "yes it should")
        await p.keyboard.press('Escape');
        await sleep(400);
        await openCard();
        const mk1 = await state();
        await sh(p, `(() => { const w = r.querySelector('.listener'); if (w) w.hidden = false; })()`);
        const lb = await at('.listener');
        await p.mouse.click(lb[0], lb[1]);
        await sleep(600);
        const mk2 = await state();
        check(eng, 'a thread open, a click on the labit mark closes it', mk1.card && !mk2.card, JSON.stringify([mk1, mk2]));
        await ctx.close();
      }

      // H. Turning the phone with a card open: the pin and its card stay on screen.
      {
        const [ctx, p] = await mk({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
        await p.evaluate('document.getElementById("p30").scrollIntoView({ block: "center" })');
        await sleep(500);
        const pin = await sh(p, `(() => { const q = r.querySelector('button.pin').getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; })()`);
        await p.touchscreen.tap(pin[0], pin[1]);
        await sleep(1000);
        const look = () => sh(p, `(() => { const q = r.querySelector('button.pin')?.getBoundingClientRect(); const c = r.querySelector('.card:not(.out), .float:not(.out)')?.getBoundingClientRect(); return { sy: Math.round(scrollY), vh: innerHeight, pin: q && [Math.round(q.top), Math.round(q.bottom)], card: c && [Math.round(c.top), Math.round(c.bottom)] }; })()`);
        const before = await look();
        await sh(p, `(window.__rec = []) && 0`);
        await p.evaluate(`(() => { window.__rec = []; const g = () => { const R = ${ROOT}; const q = R.querySelector('button.pin')?.getBoundingClientRect(); const c = R.querySelector('.card:not(.out), .float:not(.out)')?.getBoundingClientRect(); window.__rec.push([Math.round(scrollY), q && Math.round(q.top), c && Math.round(c.top), c && Math.round(c.bottom)]); if (window.__rec.length < 90) requestAnimationFrame(g); }; requestAnimationFrame(g); })()`);
        await p.setViewportSize({ width: 844, height: 390 });
        await sleep(2000);
        const after = await look();
        const rec = await p.evaluate('window.__rec');
        console.log(`     ${eng} rotate before ${JSON.stringify(before)}\n     ${eng} rotate after  ${JSON.stringify(after)}`);
        console.log(`     ${eng} frames (scrollY, pin top, card top, card bottom): ${rec.filter((_, i) => i % 6 === 0).map((f) => f.join('/')).join('  ')}`);
        check(eng, 'a card was open before the turn', Boolean(before.card && before.pin), JSON.stringify(before));
        check(eng, 'after the turn the pin is inside the window', Boolean(after.pin) && after.pin[0] >= 0 && after.pin[1] <= after.vh, JSON.stringify(after));
        check(eng, 'after the turn the card is inside the window', Boolean(after.card) && after.card[0] >= 0 && after.card[1] <= after.vh, JSON.stringify(after));
        await ctx.close();
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
finish();
