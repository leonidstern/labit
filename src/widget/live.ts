// Part of the comment widget (src/comments.js bundles it). Uses the widget's own parts through W, set once at startup.
import { pillLine } from './list.ts';

import { aroundMorph } from './trial.ts';
import { cut } from './anchoring.ts';
import { sessionLine } from '../../lib/status.mjs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let W: any;
export function bindLive(w: unknown) {
  W = w;
}
export const MARK_PATHS = '<g transform="translate(-1 -.5)" fill="currentColor">' +
  '<path class="e1" d="M18.9 24.67L24.4 3h11.5L31.28 21.2A22.8 22.8 0 0 0 18.9 24.67Z"/>' +
  '<path class="e2" d="M37.07 22.02L41.9 3h11.5L47.1 27.85A22.8 22.8 0 0 0 37.07 22.02Z"/>' +
  '<path d="M31 26a18 18 0 0 1 18 18 18 18 0 0 1-18 18H15.57a2.57 2.57 0 0 1-2.57-2.57V44A18 18 0 0 1 31 26Z"/>' +
  '<circle class="eye" cx="31" cy="45" r="6.2"/></g>';
const span = (t: string, className = '') => Object.assign(document.createElement('span'), { textContent: t, className });

// Local mode (local.mjs sets data-live): one event stream for all of a lab's tabs (see startLive), so many tabs
// don't use up the browser's connections. The page reloads when its files change, keeping the scroll position, and the
// comments refresh when someone else, like an agent, changes them. A label says which Claude session listens.
export function startLive() {
  if (W.script?.dataset.live) {
    // sessionStorage is shared by every frame of a tab: a board's frames of one page each keep their own (the board names them).
    // The address now, not at load: an app behind --proxy moves between its pages without loading one.
    const keyNow = () => 'lab-scroll:' + (window.name.startsWith('lab:') ? window.name + ':' : '') + location.pathname;
    const key = keyNow();
    // The page's own state that a reload would lose, each with its element (by id, or its place among its kind): a
    // scrolled box, an opened <details>, words typed in a field, a tick, a choice, the field with the cursor.
    // A form with a field named "id" answers `form.id` with that field, so the id is read as the attribute it is.
    const idOf = (x: any) => (x.nodeType === 1 && x.getAttribute('id')) || '';
    // A select changed since its file: a lone select always shows its first option, which isn't a change.
    const selDirty = (n: any) => (n.multiple ? [...n.options].some((o) => o.selected !== o.defaultSelected) : n.selectedIndex !== Math.max(0, [...n.options].findIndex((o) => o.defaultSelected)));
    const ofKind = (t: string) => [...document.getElementsByTagName(t)].filter((n) => n !== W.host);
    const pageState = () => {
      const out: any[] = [];
      for (const n of document.querySelectorAll('*') as NodeListOf<any>) {
        if (n === W.host || n === document.documentElement || n === document.body) continue;
        const add = (kind: string, v: any) => out.length < 200 && out.push([idOf(n) ? '#' + idOf(n) : n.localName + ':' + ofKind(n.localName).indexOf(n), kind, v]);
        if (n.scrollTop || n.scrollLeft) add('s', [n.scrollTop, n.scrollLeft]);
        if (n.localName === 'details' && n.open) add('o', 1);
        if (!/^(input|textarea|select)$/.test(n.localName) || /^(password|file|hidden)$/.test(n.type)) continue;
        // Only what you changed: a field as its file has it follows the file after the reload.
        if (n.localName === 'select') {
          if (selDirty(n)) add('m', [...n.options].flatMap((o, i) => (o.selected ? [i] : [])));
        } else if (/^(checkbox|radio)$/.test(n.type)) {
          if (n.checked !== n.defaultChecked) add('c', n.checked);
        } else if (n.value !== n.defaultValue && n.value.length < 5000) add('v', n.value);
        if (n === document.activeElement) add('f', [n.selectionStart, n.selectionEnd]);
      }
      return out;
    };
    // Each is put back and says whether it's done: a box (or the page) that isn't long enough yet is not.
    const putBack = ([k, kind, v]: [string, string, any]) => () => {
      const n: any = k[0] === '#' ? document.getElementById(k.slice(1)) : ofKind(k.split(':')[0])[+k.split(':')[1]];
      if (!n) return false;
      if (kind === 's') {
        n.scrollTop = v[0];
        n.scrollLeft = v[1];
        return Math.abs(n.scrollTop - v[0]) < 2 && Math.abs(n.scrollLeft - v[1]) < 2;
      }
      if (kind === 'o') n.open = true;
      else if (kind === 'c') n.checked = v;
      else if (kind === 'm') [...(n.options || [])].forEach((o, i) => (o.selected = v.includes(i)));
      else if (kind === 'v') n.value = v;
      else {
        n.focus({ preventScroll: true });
        try {
          n.setSelectionRange(v[0], v[1]);
        } catch {} // a field without a text cursor (a number, a date)
      }
      return true;
    };
    // What a reload would lose, kept in the tab for the next load of this page. `u`: kept as the page went, not by the lab.
    const keep = (u = 0) => {
      try {
        sessionStorage.setItem(keyNow(), JSON.stringify({ y: scrollY, x: scrollX, open: W.S.openId, chat: W.S.chatOpen, page: pageState(), ...(u ? { u } : {}) }));
      } catch {}
    };
    // A reload the lab didn't start (a dev server's own, behind --proxy, or the browser's): the page goes, and what you had
    // open comes back with it, as it does after the lab's. A board's frames are swapped by the board, never reloaded.
    if (!W.S.frame) addEventListener('pagehide', () => keep(Date.now()));
    let touchedAt = 0;
    try {
      // The scroll position and the open thread come back after a reload, so an answer shows where you left it. So does
      // what you did to the page itself (pageState). A page that builds itself after it loads is still short then, and
      // its fields aren't there yet: what can't be put back is tried again for 3 s, until you touch the page.
      const kept = JSON.parse(sessionStorage.getItem(key) || 'null');
      // Kept as the page went (pagehide, below): only a reload of it puts it back, and only right after. Leaving the page
      // and coming back to it later starts it fresh, as any page does.
      const nav = (performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined)?.type;
      if (kept !== null) sessionStorage.removeItem(key);
      if (kept !== null && !(kept.u && (nav !== 'reload' || Date.now() - kept.u > 60000))) {
        if (kept.open) W.S.openId = kept.open;
        if (kept.chat) W.S.chatOpen = true;
        const y = () => +(kept.y ?? kept);
        const x = +kept.x || 0;
        let todo = [...(kept.page || []).map(putBack), () => (scrollTo(x, y()), Math.abs(scrollY - y()) < 2 && Math.abs(scrollX - x) < 2)];
        let tries = 0;
        const go = () => {
          todo = todo.filter((job) => !job());
          if (todo.length && tries++ < 30 && !touchedAt) setTimeout(go, 100);
        };
        if (document.readyState === 'complete') go();
        else addEventListener('load', go);
      }
    } catch {}
    // Hold a reload while anything is open (a thread, a new comment) or a box has focus or text: the page
    // reloads once you close it, where you were.
    // A newer version reloads the page when it's safe: not while you read a thread or the chat (it waits
    // until they're closed, so nothing moves under you), type, have words in a box, place a new comment, have a phone's
    // keyboard up, are drawing (until the drawing is sent, issue 428) or have just touched the page.
    for (const t of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(t, () => (touchedAt = performance.now()), { capture: true, passive: true });
    const frame = Boolean(W.S.frame); // a board's frame (frame.ts): the board holds the stream and says when it is busy
    // A board page (its key is /_board/<name>) holds its frames, which name the files it "uses": a save of a page, a .json
    // or anything else is the frames' to follow (they patch or reload themselves), never the board's. It still reloads
    // for a new widget script or comments schema, and follows the lab's comments and the board file.
    const board = Boolean(W.S.board); // exactly /_board/<name>: a variant opened by itself is a page like any other
    const busy = () =>
      frame ? W.S.busy() || performance.now() - touchedAt < 1500 : W.S.draft || W.S.grabbing || W.S.openId || W.S.chatOpen || W.S.inking || W.S.sendingInk || W.S.drag?.active || (W.coarse && /^(textarea|input)$/.test(W.root.activeElement?.localName || '')) ||
      [...W.root.querySelectorAll('textarea')].some((t) => t.value.trim()) || performance.now() - touchedAt < 1500;
    let reloadWhenShown = false;
    let reloadTimer: any = 0;
    // A held reload is invisible otherwise: the page sits old while you read, then jumps the moment you close the
    // thread. A "!" on the labit mark says one is ready (owner, 19 Nov: "move it to rabbit status"), and a tap on the
    // mark takes it now. Where no mark shows (no agent news yet, a phone before its chat button got the mark), the ⋯
    // button carries it. The badge floats over its corner, so nothing moves when it comes or goes.
    const upd = Object.assign(document.createElement('span'), { className: 'upd', textContent: '!', hidden: true });
    upd.setAttribute('aria-hidden', 'true');
    let held = false;
    let updOn: HTMLElement | null = null;
    const UPD_LABEL = 'update waiting, tap to load';
    const shows = (n: Element | null) => Boolean(n && !(n as HTMLElement).hidden && n.getClientRects().length);
    const showUpd = (on: boolean) => {
      held = on;
      if (!on) {
        upd.hidden = true;
        if (updOn) {
          const was = updOn.dataset.updLabel;
          if (was) updOn.setAttribute('aria-label', was);
          else updOn.removeAttribute('aria-label');
          delete updOn.dataset.updLabel;
          updOn.classList.remove('has-upd');
        }
        updOn = null;
        return;
      }
      const host: HTMLElement = shows(who) ? who : W.root.querySelector('.more'); // the mark, at the bar's right end on a phone too
      if (!host) return;
      if (updOn !== host) {
        showUpd(false);
        held = true;
        updOn = host;
        host.dataset.updLabel = host.getAttribute('aria-label') || '';
        host.setAttribute('aria-label', UPD_LABEL);
        host.classList.add('has-upd');
        host.append(upd);
      }
      upd.hidden = false;
      // On the mark's top right corner (or the ⋯'s), measured, so the badge sits on the mark wherever it is.
      const m = host.querySelector('.mark') || host;
      const hr = host.getBoundingClientRect();
      const mr = m.getBoundingClientRect();
      Object.assign(upd.style, { left: `${mr.right - hr.left - 6}px`, top: `${mr.top - hr.top - 6}px` });
    };
    const take = (e: Event) => {
      if (!held || e.currentTarget !== updOn) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      clearTimeout(reloadTimer);
      reloadTimer = 0;
      now();
    };
    // The page is asked for first: with its dev server down the lab answers a plain 502, and with its file gone its page
    // list or "not found" (200 for a folder): none of them has a widget, and a reload would leave the tab there for good.
    // This page stays, and asks again in a moment.
    const now = () =>
      fetch(location.href, { cache: 'no-store', headers: { accept: 'text/html', 'x-lab': '1' } })
        .then((r) => r.ok && r.text().then((t) => t.includes('data-live')), () => false)
        .then((up) => {
          if (!up) return void (reloadTimer ||= setTimeout(() => ((reloadTimer = 0), reload()), 2000));
          keep();
          // A board's frame: the board loads it anew behind this one and swaps them (board/mount.ts again), no blank frame.
          if (!frame || !(top as unknown as { __labBoard?: { again?: (n: string) => boolean } }).__labBoard?.again?.(window.name)) location.reload();
        });
    const reload = () => {
      // A tab in the background doesn't reload on every save: it reloads once, when you come back to it.
      if (document.hidden) return void (reloadWhenShown = true);
      if (busy()) {
        showUpd(true);
        if (!reloadTimer) reloadTimer = setTimeout(() => ((reloadTimer = 0), reload()), 500); // one waiting reload, not one per message
        return;
      }
      showUpd(false);
      now();
    };
    const who = document.createElement('a');
    who.className = 'listener';
    // The labit mark, in place of the old dot: our pin as a head, two slabs as ears (the cut for small sizes: a wider
    // gap and a bigger dot, so neither closes up at 16 px). Its parts are separate so the styles can move them: the
    // dot blinks now and then while an agent listens, the ears twitch while one works. The words sit in .lbl, so
    // changing them never rebuilds (and restarts) the mark.
    const MARK = '<svg class="mark" viewBox="0 0 64 64" aria-hidden="true">' + MARK_PATHS + '</svg>';
    who.innerHTML = MARK + '<span class="cb"></span><div class="lbl"></div>';
    const lbl = who.querySelector('.lbl') as HTMLElement;
    const cb = who.querySelector('.cb') as HTMLElement;
    // The pill's label, kept aside while it says "update waiting" (the "!" badge) and put back after.
    const whoLabel = (t: string) => (updOn === who ? (who.dataset.updLabel = t) : who.setAttribute('aria-label', t));
    who.hidden = true;
    W.root.querySelector('.bar')?.append(who); // (a page in a board's frame has no bar) the bar's last part, after ⋯: on the bar's own colour it reads on any page, a black one too (Leo, 23 Nov)
    // Capture, so a tap that takes the update never also opens the chat, the ⋯ menu or the session's link.
    for (const n of [who, W.chatBtn, W.root.querySelector('.more')]) n?.addEventListener('click', take, { capture: true });
    // Files a save can mean for this page: the page itself, anything it loads, and data it may fetch as it runs.
    // Everything else -- a README, another page's script, the project's own server code -- leaves it alone.
    performance.setResourceTimingBufferSize(3e3); // the page's own list of what it loaded (a fetch, a module, a worker): 250 is too few for a big app
    const loaded = (p, by = /./) => performance.getEntriesByType('resource').some((e: any) => by.test(e.initiatorType) && samePath(e.name, [p]));
    const tidy = (u) => decodeURIComponent(u).replace(/\/index\.html?$/i, '/').replace(/\.html?$/i, '').toLowerCase();
    const usedHere = (p) => {
      if (tidy(location.pathname) === tidy(p)) return true;
      for (const n of document.querySelectorAll('script[src], link[href], iframe[src], object[data], embed[src]')) {
        if (W.host.contains(n)) continue;
        const v = n.getAttribute('src') || n.getAttribute('href') || n.getAttribute('data');
        if (v && samePath(v.split('#')[0], [p])) return true;
      }
      // Anything else the page fetched while it ran: an ES module's imports, a worker, a script a script added, its data.
      return loaded(p);
    };
    // A page with no tab icon of its own gets labit's: only in a local lab (this block), only when the page names
    // none and the project serves no /favicon.ico (a dev server may answer any path with its HTML, so the type counts).
    if (!frame && !board && !document.querySelector('link[rel~="icon"]')) {
      fetch('/favicon.ico', { method: 'HEAD' })
        .then((r) => r.ok && (r.headers.get('content-type') || '').startsWith('image/'))
        .catch(() => false)
        .then((has) => {
          if (has || document.querySelector('link[rel~="icon"]')) return;
          document.head.append(Object.assign(document.createElement('link'), { rel: 'icon', href: '/_lab/favicon.svg' }));
        });
    }
    // What goes wrong on the page, for the agent that fixes it (the lab shows it with the page's text): an uncaught error, a
    // file that failed to load, a rejected promise, a script the page's policy blocked. The last 8, each once, sent a
    // second after the last one. The widget's own are not the page's. (A file that failed while the page was still loading
    // is the lab's to say: the page's text lists the files it asked for that the lab did not have.)
    // Each route keeps its own list (the app can go to another route with no page load): posted under the route it was thrown on.
    const oops: Record<string, string[]> = {};
    const told = new Set<string>();
    let oopsTimer: any = 0;
    const tell = (t: string) => {
      t = cut(t.replace(/\s+/g, ' '), 200);
      const page = W.S.page, list = (oops[page] ||= []);
      if (list.includes(t) || /^Script error\.?/.test(t)) return;
      list.push(t);
      if (list.length > 8) list.shift();
      told.add(page);
      clearTimeout(oopsTimer);
      oopsTimer = setTimeout(() => {
        for (const page of told) fetch(W.script.dataset.live.replace(/live$/, 'errors'), { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page, list: oops[page], tab }) }).catch(() => {});
        told.clear();
      }, 1000);
    };
    if (!board) {
      addEventListener('error', (e: any) => e.filename?.includes('/_lab/') || tell(e.message ? `${e.message} (${(e.filename || '').split('/').pop() || 'page'}:${e.lineno})` : `failed to load ${e.target?.src || e.target?.href}`), true);
      addEventListener('unhandledrejection', (e) => tell(`unhandled rejection: ${e.reason?.message || e.reason}`));
      addEventListener('securitypolicyviolation', (e) => tell(`blocked by the page's policy: ${e.violatedDirective} ${e.blockedURI}`));
    }
    let stream = null;
    let beat = 0;
    // The pill is the mark, with its status as a badge on the mark's corner (Leo, 20 Nov: "lets try this", icon only; "like we had
    // with !"): how many pins wait, or a sign: ! the agent went quiet, … it isn't answering, - nobody listens, ~ reconnecting. Its
    // words show in a box above the pill the moment the pointer is on it (the .w box, like a pin's: no browser tooltip, which waits
    // a second, and the pill never grows): "talking to Claude", the status line, "no update for 6 min · last: …", and under
    // them what the state means (.d). The words stay in the pill's label for screen readers. From the lab's state (mode, agent)
    // and the agent's work on this page (list.ts pillLine).
    let pill = null;
    const SIGNS = { '!': 'M6 3.25v3.25M6 8.75h.01', '…': 'M3.4 6h.01M6 6h.01M8.6 6h.01', '-': 'M3.75 6h4.5', '~': 'M8.6 6.6A2.6 2.6 0 1 1 6.3 4M5.1 2.8l1.3 1.2-1.3 1.2' };
    const TONE = { '!': 'amber', '…': 'amber', '-': 'grey', '~': 'grey' };
    // The box: line 1 (.t), what else is worth knowing (.d, muted), and a command to copy (.c).
    const show = (head: string, n = '', more: string[] = [], cmd = '') => {
      const sig = [head, n, ...more, cmd].join('|');
      if (lbl.dataset.sig === sig) return;
      lbl.dataset.sig = sig;
      lbl.replaceChildren(span('', 'w'));
      lbl.firstElementChild.append(span(head, 't'), ...(more.length ? [span(more.join('\n'), 'd')] : []), ...(cmd ? [span(cmd, 'c')] : []));
      cb.className = `cb ${TONE[n] || ''}`;
      cb.innerHTML = SIGNS[n] ? `<svg viewBox="0 0 12 12" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="6" fill="currentColor"/><path d="${SIGNS[n]}" stroke="var(--_bg)" stroke-width="${n === '…' ? 2.4 : 1.8}"/></svg>` : n ? `<span>${n}</span>` : '';
      if (n) who.dataset.n = n;
      else delete who.dataset.n;
    };
    // What a screen reader gets: the first line, and the count the badge shows.
    const said = () => (lbl.querySelector('.t')?.textContent || '') + (/^\d+$/.test(who.dataset.n || '') ? ` · ${who.dataset.n} waiting` : '');
    const paintWho = () => {
      if (!pill) return;
      const { mode, agent, away, name, resume } = pill;
      const { text, last, stale, waiting } = mode === 'working' ? pillLine() : { text: '', last: '', stale: false, waiting: 0 };
      const n = mode === 'working' ? (stale ? '!' : waiting ? String(Math.min(waiting, 99)) : '') : mode === 'quiet' ? '…' : mode === 'away' ? '-' : '';
      const [who2, model] = agent.split(' · ');
      const lines = [];
      const how = `labit wait --page ${W.S.page}`;
      let head = '';
      if (mode === 'listening') {
        head = `${who2} is listening`;
        if (model) lines.push(model);
      } else if (mode === 'quiet') {
        head = `${who2} isn't answering`;
        lines.push('Pins go to the next agent that listens.');
      } else if (mode === 'working') {
        head = text || `${who2} is working`;
        if (last) lines.push(last);
        if (waiting) lines.push(`${waiting} waiting`);
      } else {
        head = away[0].toUpperCase() + away.slice(1);
        lines.push(`Tell an agent: listen for pins on ${location.origin}${W.S.page}`);
      }
      if (name) lines.push(sessionLine(name));
      show(head, n, lines, mode === 'away' ? how : resume || '');
      whoLabel(said());
    };
    W.paintWho = paintWho;
    // The status pill says "reconnecting" while the live connection is down; the next message puts it right.
    // A dropped connection isn't "nobody listening": the badge keeps its last state, faded, and says reconnecting
    // (Leo, 18 Nov: the black rabbit came and went at random, from these).
    const showAway = (word) => {
      pill = null; // the pill's own words are not painted over it until the next state
      lbl.dataset.sig = '';
      show(word, '~');
      whoLabel(word);
      who.classList.add('stale');
      if (!who.classList.contains('working') && !last) who.classList.add('idle');
      who.hidden = false;
    };
    let commentsRev = null; // the lab's comments version this page has (not the read marks, `seen`)
    let readsAt = null;
    let hotAt = W.script.dataset.hot ? +W.script.dataset.hot : null; // the lab's hot count when this page was served: a save since then is still caught up
    const samePath = (u, paths) => {
      try {
        const url = new URL(u, location.href);
        return url.origin === location.origin && (!paths || paths.includes(decodeURIComponent(url.pathname)));
      } catch {
        return false;
      }
    };
    const scriptsOf = (doc) => [...doc.querySelectorAll('script:not([data-lab])')].filter((x) => !/\/_lab\/comments\.js/.test(x.getAttribute('src') || '')).map((x) => x.getAttribute('src') || x.textContent);
    // A page with scripts of its own is reloaded instead: patching it toward its file would undo what its scripts built.
    const ownScripts = () => scriptsOf(document).length > 0;
    const plainPage = () =>
      !ownScripts() && !document.querySelector('iframe[src], object[data], embed[src], video, audio') && !document.fonts?.size &&
      !performance.getEntriesByType('resource').some((e: any) => {
        const p = new URL(e.name).pathname;
        return /fetch|xml/.test(e.initiatorType) && !p.startsWith('/_lab/') && p !== '/favicon.ico' && p !== location.pathname;
      });
    // Live reload in place is its own file (reload.ts, public/_lab/reload.js), fetched on the first save this page hears
    // about. It can't load: the page reloads, as it did before live reload.
    let reloading: Promise<any> | null = null;
    const withReloader = (fn: (r: { catchUp: () => void; hotUpdate: (files: any[]) => void }) => void) =>
      void (reloading ??= W.part('reload').then((m) => m.reloader({ W, reload, loaded, samePath, idOf, selDirty, board, scriptsOf, ownScripts, aroundMorph }))).then(fn, () => {
        reloading = null;
        reload();
      });
    const catchUp = () => withReloader((r) => r.catchUp());
    const hotUpdate = (files) => withReloader((r) => r.hotUpdate(files));
    // One live stream per browser for this lab, shared by its tabs: the tab holding the lock "labit-live" (locks and
    // channels are per origin, so per lab) opens it and passes each message to the lab's other tabs over a
    // BroadcastChannel; they listen there. When it closes, the next tab takes the lock and opens the stream. So a tab
    // in the background stays live (its title count and pins update at once), and any number of tabs use one of the
    // browser's 6 connections to a lab. (Before, each tab held its own and let it go 30 s into the background, asking
    // for the state every 20 s instead.) Without locks or channels a tab opens its own stream.
    const tab = Math.random().toString(36).slice(2, 12); // the lab counts open tabs by their streams; bye on close
    const bc = 'BroadcastChannel' in window ? new BroadcastChannel('labit-live') : null;
    const shared = Boolean(bc && navigator.locks);
    let leading = !shared;
    let release: (() => void) | null = null;
    let last = null; // the last state, for a tab that joins
    const got = (v) => {
      beat = Date.now();
      last = v;
      dispatchEvent(new CustomEvent('lab-state', { detail: v })); // the board page follows the board file from this
      onState(v);
    };
    if (bc)
      bc.onmessage = ({ data: d }) => {
        if (d.t === 'hello' && stream?.readyState === 1 && last) bc.postMessage({ t: 'state', v: last }); // a tab joined: it gets the state now
        if (stream) return; // a tab with its own stream listens to that
        if (d.t === 'state') got(d.v);
        if (d.t === 'beat') beat = Date.now();
        if (d.t === 'down') showAway('Reconnecting');
      };
    const connect = () => {
      if (stream) return;
      stream = new EventSource(`${W.script.dataset.live}?tab=${tab}`);
      beat = Date.now();
      stream.addEventListener('beat', () => {
        beat = Date.now();
        if (leading) bc?.postMessage({ t: 'beat' });
      });
      stream.onerror = () => {
        showAway('Reconnecting');
        if (leading) bc?.postMessage({ t: 'down' });
      };
      stream.onmessage = (e) => {
        const v = JSON.parse(e.data);
        got(v);
        if (leading) bc?.postMessage({ t: 'state', v });
      };
    };
    // Waits for the lock (another tab may hold it), then opens the stream and keeps the lock until the page goes.
    const lead = () =>
      navigator.locks.request('labit-live', () => new Promise<void>((r) => {
        release = r;
        leading = true;
        connect();
      }));
    function onState(v) {
      {
        // A new widget script: this page needs it, so it reloads (when it's safe, as always). While the reload waits
        // (a chat, a thread or a draft is open) the rest still runs: replies keep arriving and the pill stays true.
        if (v.widget && W.script.dataset.widget && v.widget !== W.script.dataset.widget) reload();
        // Comments stored in a new shape (lib/schema.mjs VERSION): this page reads them with the widget that knows it.
        if (v.schema && W.script.dataset.schema && String(v.schema) !== W.script.dataset.schema) return reload();
        // The lab restarted (its counters start again): catch up in place instead of reloading. The page is fetched
        // and patched (only if its file changed does anything move), and the comments are loaded again.
        if (v.lab && W.script.dataset.lab && v.lab !== W.script.dataset.lab) {
          W.script.dataset.lab = v.lab;
          W.script.dataset.version = String(v.files);
          hotAt = v.hot || 0;
          commentsRev = v.comments;
          catchUp(); // files saved while it was down are not in any list
          W.load();
        }
        if (String(v.files) !== W.script.dataset.version) {
          // The lab says which files changed (no list: a burst too big to judge, so reload as before).
          const listed = v.files - +W.script.dataset.version === 1 && Array.isArray(v.changed) && v.changed.length;
          if (board || (listed && !v.changed.some(usedHere))) W.script.dataset.version = String(v.files);
          // Saves missed, or a burst too big to list (a branch switch): a page with no scripts, frames or objects of its
          // own that fetched nothing uses only its file, its styles and its pictures, so it catches up in place (issue 428).
          // Fonts, video and sound aren't refreshed in place: a page with them reloads. The widget's own asks (the
          // page itself, the tab icon, /_lab/) are not the page's.
          else if (!listed && plainPage()) {
            W.script.dataset.version = String(v.files);
            catchUp();
          } else reload(); // held while something is open: the comments below still come in (the agent's answer, read marks)
        }
        // Missed more than one hot update while away (asleep, offline): patch the page and refresh every stylesheet
        // and picture, instead of only the last batch of files.
        const hot = v.hot || 0;
        if (!board && hotAt !== null && hot !== hotAt) {
          if (hot - hotAt > 1) catchUp();
          else hotUpdate(v.hotFiles || []);
        }
        hotAt = hot;
        // The page's list of comments isn't in yet (the page just loaded): a comment made between that list being read
        // and this state is in this state's version but not in the list, and no later state would name it again. Once
        // the list is in, whatever is newer than it is fetched.
        if (!W.S.loaded) {
          const want = v.comments;
          const after = () => (W.S.loaded ? W.S.rev != null && W.S.rev < want && W.loadChanges(W.S.rev) : setTimeout(after, 100));
          after();
        }
        commentsRev ??= W.S.rev ?? null; // the list's own version: what was written since it was read is fetched below, not lost
        // One version on and it names the pages it changed, none of them this one: nothing to fetch. (An older lab sends
        // no commentPages; more than one version on, the pages in between aren't known.)
        const elsewhere = v.comments === commentsRev + 1 && Array.isArray(v.commentPages) && !v.commentPages.includes(W.S.page);
        if (commentsRev !== null && v.comments !== commentsRev && !elsewhere) W.loadChanges(commentsRev); // keeps typed text: it adds replies in place
        commentsRev = v.comments;
        // read on another device with your name
        if (v.reads !== readsAt) {
          readsAt = v.reads;
          W.syncReads();
        }
        // Experiments switched on or off (the ⋯ menu here or in another tab). An older lab sends no flags.
        if (Array.isArray(v.flags)) W.S.syncFlags?.(v.flags);
        // listening: a wait is open · working: Claude got comments and is on them · away: nobody will hear a comment now.
        const s = v.session;
        // A lab with listeners can still have none for this page (a wait with --page for another one): this page says
        // so, instead of "talking to Claude" while its pins wait for nobody. An older lab doesn't send heard.
        const h = v.heard;
        const here = !h || h.pages.includes(W.S.page) || (h.all && !h.except.includes(W.S.page));
        // The session listening here was handed pins and answered none of them (local.mjs silentNow): the pill says
        // "Claude isn't answering" instead of "talking to Claude", until it answers anything.
        const quiet = (v.silent || []).find((q) => !q.pages || q.pages.includes(W.S.page));
        const mode = s && here ? (quiet ? 'quiet' : v.mode || 'listening') : 'away';
        W.S.unheard = mode === 'away';
        // "Claude · Sonnet 5.5": the agent, and the model the session said it runs on (the box says "Claude is listening", then the
        // model). The session's name is its own line there.
        const agent = quiet && mode === 'quiet' ? quiet.label : s?.model ? `${s.agent || 'Claude'} · ${s.model}` : s?.agent || 'Claude';
        const name = s && s.name !== (s.agent || 'Claude') ? s.name : '';
        pill = { mode, agent, name, resume: s?.resume || '', away: s && !here ? 'no agent on this page' : 'no agent listening' };
        paintWho();
        who.classList.remove('stale');
        who.classList.toggle('idle', mode === 'away' || mode === 'quiet');
        who.classList.toggle('working', mode === 'working');
        W.listBtn.dataset.agent = mode;
        whoLabel(said()); // the words stay for screen readers when only the light shows
        if (s?.url && mode !== 'away') Object.assign(who, { href: s.url, target: '_blank' });
        else who.removeAttribute('href');
        // A tap doesn't copy the resume command any more (Leo, 16 Nov: it made no sense): the pill only says who listens.
        who.hidden = false;
      }
    }
    // Back in front: a save that waited reloads now; a stream that went quiet while hidden is checked at once.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (reloadWhenShown) return reload();
      check();
    });
    addEventListener('pagehide', () => {
      stream?.close();
      stream = null;
      release?.(); // the next tab takes over the stream
      release = null;
      leading = !shared;
      if (!frame) fetch(W.script.dataset.live.replace(/live$/, 'bye'), { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tab }) }).catch(() => {});
    });
    addEventListener('pageshow', (e) => e.persisted && start()); // back from the back-forward cache
    // Back from sleep, or the stream went quiet: catch up (the first message after it says what changed). A clock that
    // jumped (the laptop slept) or 40 s without a beat both count. A tab without a stream whose sharing tab went
    // quiet (frozen, asleep) opens its own.
    let tick = Date.now();
    const freshStream = () => {
      stream?.close();
      stream = null;
      showAway('Reconnecting');
      connect();
    };
    const check = (slept = false) => {
      const stale = Date.now() - beat > 40000;
      if (stream && (slept || stale)) freshStream();
      else if (!stream && stale && !(frame && bc)) connect();
      else if (!stream && (slept || stale)) bc?.postMessage({ t: 'hello' });
    };
    // Hidden tabs' timers are slowed to about once a minute, which would look like sleep: only a tab in front checks.
    setInterval(() => {
      const now = Date.now();
      const slept = now - tick > 20000;
      tick = now;
      if (!document.hidden) check(slept);
    }, 5000);
    addEventListener('online', () => !document.hidden && check(true));
    const start = () => {
      if (frame && bc) return bc.postMessage({ t: 'hello' }); // a frame only listens: the board's stream is the one
      if (!shared) return connect();
      beat = Date.now(); // a joining tab waits up to 40 s for the shared stream before opening its own
      lead();
      bc.postMessage({ t: 'hello' });
    };
    start();
  }
}
