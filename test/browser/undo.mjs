// Undo after sending (Leo, 19 Nov, 20 Nov): the first comment of a new pin closes its card at once (no strip above the
// bar: "no need this pill"); for 3 s opening the sent pin shows undo in its card, in the resolve key's place, at resolve's
// width, and a tap deletes the pin, with no words left anywhere. Left alone, the undo goes and the pin stays. A reply in an
// existing thread keeps its card open. Its own lab on a free port, its own LABIT_HOME (never the owner's lab or settings).
// Not part of `npm test`. Run: node test/browser/undo.mjs (needs playwright; NODE_PATH can point at a node_modules that
// has it; ENGINES=webkit,chromium for both). One line per check; exits 1 if any fails.
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();

const until = async (ok, ms = 6000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (await ok()) return true;
  return false;
};

async function lab(n) {
  const dir = tmp('labit-undo-');
  const home = tmp('labit-home-');
  const port = String(claimPort(6700 + n * 40, 30));
  const B = `http://localhost:${port}`;
  const env = labEnv({ LAB_SETTLE_MS: '0', LABIT_HOME: home }, { settings: false });
  const html = '<!doctype html><meta charset="utf-8"><title>p</title><body style="margin:40px"><p id="a">first line</p><p id="b" style="margin-top:120px">second line</p></body>';
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  fs.writeFileSync(path.join(dir, 'guest.html'), html); // the guest's checks, on a page of their own
  const server = startLab(dir, env, { root: '.', port });
  await labUp(B);
  const comments = (page = '/index') => fetch(B + `/_lab/api/comments?page=${page}`).then((r) => r.json()).then((j) => j.comments || []);
  return { B, comments, stop: () => (server.kill(), fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }), fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 })) };
}

for (const [n, eng] of engines('chromium').entries()) {
  const L = await lab(n);
  const browser = await pw[eng].launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    await ctx.addInitScript(() => localStorage.setItem('lab-name', 'zz-undo'));
    const p = await ctx.newPage();
    await p.goto(L.B + '/');
    const shadow = (fn) => p.evaluate((f) => new Function('r', f)([...document.querySelectorAll('*')].find((x) => x.shadowRoot?.querySelector('.scrim'))?.shadowRoot), fn.toString().replace(/^[^{]*{|}$/g, ''));
    await until(() => p.evaluate(() => [...document.querySelectorAll('*')].some((x) => x.shadowRoot?.querySelector('.scrim'))));
    await sleep(300);
    const write = async (words) => {
      const b = await p.locator('#b').boundingBox();
      await p.mouse.click(b.x + 30, b.y + b.height / 2);
      await until(() => shadow(() => { return Boolean(r.querySelector('.float textarea')); }));
      await p.keyboard.type(words);
      await p.keyboard.press('Enter');
    };

    // Sent, then taken back within the 3 s.
    await write('fix this typo');
    const offered = await until(() => shadow(() => { return Boolean(r.querySelector('.pin:not(.draft)')); }), 2000);
    const closed = await shadow(() => { return { box: Boolean(r.querySelector('.float textarea')), card: Boolean(r.querySelector('.card:not(.out)')), draft: r.querySelectorAll('.pin.draft').length }; });
    check(eng, 'after the first comment is sent the card is closed at once, and no "sent · undo" strip is shown', offered && !closed.box && !closed.card && closed.draft === 0 && (await L.comments()).length === 1 && (await shadow(() => { return !r.querySelector('.sent') && !/sent · undo/.test(r.textContent); })), JSON.stringify(closed));
    // Opening the sent pin within the 3 s: undo is in its card, at resolve's width.
    await shadow(() => { r.querySelector('.pin:not(.draft)').click(); });
    const inCard = await until(() => shadow(() => { return Boolean(r.querySelector('.card .btn.undo')); }), 1500);
    const widths = inCard ? await shadow(() => {
      const u = r.querySelector('.card .btn.undo');
      return [u?.getBoundingClientRect().width, (() => { const t = document.createElement('button'); t.className = 'btn'; t.textContent = 'resolve'; u.parentNode.append(t); const w = t.getBoundingClientRect().width; t.remove(); return w; })()];
    }) : [0, 1];
    check(eng, 'opening the sent pin shows undo in the resolve key\'s place, at resolve\'s width', inCard && Math.abs(widths[0] - widths[1]) < 0.5, widths.join(' vs '));
    await shadow(() => { r.querySelector('.card .btn.undo').click(); });
    const gone = await until(async () => (await L.comments()).length === 0, 2000);
    const shut = await until(() => shadow(() => { return !r.querySelector('.float textarea') && !r.querySelector('.card:not(.out)') && !r.querySelector('.pin.draft'); }), 2000);
    const pins = await shadow(() => { return r.querySelectorAll('.pin:not(.draft)').length; });
    const kept = await p.evaluate(() => Object.keys(localStorage).filter((k) => /^lab-(typing|spot):/.test(k) && localStorage.getItem(k)).join(','));
    check(eng, 'undo deletes the pin (no comment left on the lab)', gone);
    check(eng, 'no comment box and no pin is left', shut && pins === 0, `pins ${pins}`);
    check(eng, 'no draft kept in localStorage', kept === '', kept);
    await p.reload();
    await until(() => p.evaluate(() => [...document.querySelectorAll('*')].some((x) => x.shadowRoot?.querySelector('.scrim'))));
    await sleep(400);
    check(eng, 'after a reload no comment box comes back', await shadow(() => { return !r.querySelector('.float textarea'); }));

    // With the card closed there is nothing to let go: a click elsewhere pins as usual and the sent pin stays.
    await write('stays sent');
    await until(() => shadow(() => { return Boolean(r.querySelector('.pin:not(.draft)')); }), 2000);
    const a = await p.locator('#a').boundingBox();
    await p.mouse.click(a.x + 20, a.y + a.height / 2);
    check(eng, 'a click elsewhere within the 3 s starts the next comment, the sent pin stays', await until(() => shadow(() => { return Boolean(r.querySelector('.float textarea')); }), 1500) && (await L.comments()).map((c) => c.text).includes('stays sent'));
    await p.keyboard.press('Escape');
    await sleep(300);
    // A link clicked within the 3 s still acts (only a new pin is held back).
    await write('before link');
    await until(() => shadow(() => { return Boolean(r.querySelector('.pin:not(.draft)')); }), 2000);
    await p.evaluate(() => { const l = document.createElement('a'); l.id = 'lk'; l.href = '#went'; l.textContent = 'a link'; document.body.prepend(l); });
    await p.click('#lk');
    await sleep(300);
    check(eng, 'within the 3 s a link still acts and no box opens', (await p.evaluate(() => location.hash)) === '#went' && (await shadow(() => { return !r.querySelector('.float textarea'); })));
    await p.evaluate(() => { document.getElementById('lk').remove(); history.replaceState(null, '', location.pathname); });
    const had = (await L.comments()).length;
    await p.reload();
    await until(() => p.evaluate(() => [...document.querySelectorAll('*')].some((x) => x.shadowRoot?.querySelector('.scrim'))));
    await sleep(400);

    // Sent again, then left alone: after 3 s the undo goes and the pin stays.
    await write('fix this typo');
    await until(() => shadow(() => { return Boolean(r.querySelector('.pin:not(.draft)')); }), 2000);
    await sleep(3900);
    const after = await shadow(() => { return { card: Boolean(r.querySelector('.card:not(.out)')), undo: Boolean(r.querySelector('.btn.undo')) }; });
    check(eng, 'left alone, after 3 s the undo has gone and the pin is kept', !after.card && !after.undo && (await L.comments()).length === had + 1, JSON.stringify(after));

    // A reply in an existing thread keeps its card open (only the first comment of a new pin closes it).
    await shadow(() => { r.querySelector('.pin:not(.draft)').click(); });
    await until(() => shadow(() => { return Boolean(r.querySelector('.card textarea')); }), 1500);
    await shadow(() => { r.querySelector('.card textarea').focus(); });
    await p.keyboard.type('and a reply');
    await p.keyboard.press('Enter');
    await until(async () => (await L.comments()).some((c) => c.text === 'and a reply'), 3000);
    await sleep(500);
    check(eng, 'a reply in an open thread keeps the card open', await shadow(() => { return Boolean(r.querySelector('.card:not(.out)')); }));
    await p.keyboard.press('Escape');
    await sleep(300);
    // A guest (not this computer: the page carries no admin key, so the lab takes them for anyone) holds the new pin's
    // own key (lab-edit), and undo sends it: the lab lets the starter take a fresh pin back with it.
    const guest = async (keyless) => {
      const g = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      await g.addInitScript(() => localStorage.setItem('lab-name', 'zz-guest'));
      await g.route(L.B + '/guest', async (route) => {
        const res = await route.fetch();
        const body = (await res.text()).replace(/ data-admin="[^"]*"/, '');
        await route.fulfill({ response: res, body, headers: { ...res.headers(), 'content-encoding': '', 'content-length': String(Buffer.byteLength(body)) } });
      });
      // keyless: the lab's answer to the send carries no key for the pin (a guest who can't take it back).
      if (keyless) await g.route('**/_lab/api/comments', async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        const res = await route.fetch();
        const j = await res.json();
        delete j.edit;
        await route.fulfill({ response: res, json: j });
      });
      const q = await g.newPage();
      await q.goto(L.B + '/guest');
      const gs = (fn) => q.evaluate((f) => new Function('r', f)([...document.querySelectorAll('*')].find((x) => x.shadowRoot?.querySelector('.scrim'))?.shadowRoot), fn.toString().replace(/^[^{]*{|}$/g, ''));
      await until(() => q.evaluate(() => [...document.querySelectorAll('*')].some((x) => x.shadowRoot?.querySelector('.scrim'))));
      await sleep(300);
      const admin = await q.evaluate(() => Boolean(document.querySelector('script[data-admin]')));
      const b = await q.locator('#b').boundingBox();
      await q.mouse.click(b.x + 30, b.y + b.height / 2);
      await until(() => gs(() => { return Boolean(r.querySelector('.float textarea')); }));
      await q.keyboard.type(keyless ? 'no key' : 'guest typo');
      await q.keyboard.press('Enter');
      await until(async () => (await L.comments('/guest')).length > 0, 3000);
      return { g, q, gs, admin };
    };
    {
      const { g, q, gs, admin } = await guest(false);
      await until(() => gs(() => { return Boolean(r.querySelector('.pin:not(.draft)')); }), 2000);
      await gs(() => { r.querySelector('.pin:not(.draft)').click(); });
      const offered = await until(() => gs(() => { return Boolean(r.querySelector('.card .btn.undo')); }), 1500);
      const held = await q.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('lab-edit:') && localStorage.getItem(k)));
      check(eng, 'a guest holding the pin\'s key is offered undo', !admin && held && offered, JSON.stringify({ admin, held, offered }));
      await gs(() => { r.querySelector('.card .btn.undo')?.click(); });
      const gone = await until(async () => (await L.comments('/guest')).length === 0, 2000);
      check(eng, '…and a guest\'s undo deletes the pin (with its key)', gone, JSON.stringify((await L.comments('/guest')).map((c) => c.text)));
      await g.close();
    }
    {
      const { g, gs, admin } = await guest(true);
      await sleep(800);
      await gs(() => { r.querySelector('.pin:not(.draft)')?.click(); });
      await sleep(400);
      const seen = await gs(() => { return { undo: Boolean(r.querySelector('.btn.undo')), card: Boolean(r.querySelector('.card:not(.out)')) }; });
      const kept = (await L.comments('/guest')).map((c) => c.text);
      // No undo to offer: nothing is shown, the pin stays.
      check(eng, 'a guest without the pin\'s key gets no undo: opening the pin offers none, the pin stays', !admin && !seen.undo && seen.card && kept.includes('no key'), JSON.stringify([seen, kept]));
      await g.close();
    }
  } finally {
    await browser.close();
    L.stop();
  }
}
finish('');
