// A board in the page it is linked from (Leo, 19 Nov: "can board be part of same page?", "should not have
// separate labit page and controls, should have resizable window tho and share comments with main page"). A part the
// widget loads when a board link is clicked (src/comments.js, part('boardview')): a view over the same page, the board
// drawn in it by mount.ts. No second widget: the page's own one stays on top and its pins on the board's frames are the
// page's comments (anchor kind board, with the board's name). The address gets #board=<name>, so back closes it and a
// reload opens it again; closing leaves the page where it was scrolled. The view's height is kept per page.
//
// The board's own address (/_lab/board/<name>, a direct link) is this same view, by itself: the lab serves a page with
// nothing else on it, and own() below puts the view over all of it (no half, nothing is under it). That is for a board
// with no page of its own to be over; one that is about a page goes there (the lab redirects), so it has one set of pins.
import { mountBoard } from './mount.ts';
import * as move from '../widget/sheetmove.ts';

type Opts = { page: string; of?: string; push?: boolean; onClose?: () => void; own?: boolean }; // own: the board's own address (own() below)
type Open = { name: string; view: HTMLElement; destroy: () => void; onClose?: () => void; restoration: ScrollRestoration; pushed: boolean };
let cur: Open | null = null;
let lastOpts: Opts | null = null; // a forward to #board=<name> opens it as the last one was

// The view is a shadow host (like the comment widget, src/widget/styles.css): the board, its bar and its frames' labels are
// drawn inside it, so no rule of the page's (div, button, *, all: unset, !important) reaches them. !important on :host beats
// the page's own !important on the host (an inner shadow context wins the important declarations); the height is the
// --bv-h variable, set inline by paintSize. cursor: inherit keeps the page's pin pointer over the board.
const CSS = `
:host{--_radius:var(--lab-radius,12px);--_r-s:6px;all:initial!important;opacity:var(--bv-o,1)!important;translate:0 calc(var(--bv-pan,0px) + var(--bv-y,0px))!important;transition:translate var(--bv-t,0ms) var(--bv-e,cubic-bezier(.32,.72,0,1))!important;display:flex!important;flex-direction:column!important;position:fixed!important;left:0!important;right:0!important;bottom:0!important;height:var(--bv-h,100%)!important;zoom:var(--bv-z,1)!important;z-index:2147482000!important;overscroll-behavior:none!important;background:#f7f7f7!important;color:#1d1d1b!important;box-shadow:0 -1px 0 rgba(0,0,0,.12),0 -8px 24px rgba(0,0,0,.08)!important;font:500 13px/1 system-ui,-apple-system,sans-serif!important;direction:ltr!important;cursor:inherit!important}
.bv-bar{position:relative;flex:none;touch-action:none;display:flex;align-items:center;gap:6px;height:40px;padding:0 8px;background:inherit;border-bottom:1px solid rgba(0,0,0,.08)}
:host(.full) .bv-bar{height:calc(40px + env(safe-area-inset-top,0px));padding-top:env(safe-area-inset-top,0px)}
.bv-bar button{font:400 14px/1.4 var(--lab-font,system-ui,-apple-system,sans-serif);letter-spacing:-.011em;color:inherit;background:transparent;border:0;border-radius:var(--_r-s,6px);padding:5px 10px;cursor:pointer;transition:background-color var(--lab-t-quick,120ms) var(--lab-ease-out,cubic-bezier(0,0,.58,1))}
.bv-bar button:hover{background:var(--lab-hover,rgba(0,0,0,.10))}
.bv-bar button:focus-visible{outline:2px solid currentColor;outline-offset:2px}
.bv-name{position:absolute;left:50%;translate:-50% 0;width:calc(100% - 220px);pointer-events:none;text-align:center;font:400 14px/1.4 var(--lab-font,system-ui,-apple-system,sans-serif);letter-spacing:-.011em;opacity:.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:normal}
.bv-box{position:relative;flex:1;min-height:0}
.bv-box #lab-board{position:absolute}
@media (pointer:coarse){.bv-bar{z-index:1}.bv-bar button{position:relative;z-index:2;min-width:44px}.bv-bar button::before{content:"";position:absolute;left:0;right:0;top:-9px;bottom:-12px}}
@media (prefers-color-scheme:dark){:host{background:#1b1b1a!important;color:#e9e8e4!important}.bv-bar button:hover{background:var(--lab-hover,rgba(255,255,255,.10))}.bv-bar{border-color:rgba(255,255,255,.08)}}
@supports (corner-shape:squircle){:host{--_radius:calc(var(--lab-radius,12px)*1.8);--_r-s:11px}*{corner-shape:squircle}}
`;
const nameInHash = () => /^#board=([a-z0-9][a-z0-9_-]*)/i.exec(location.hash)?.[1] || '';
const moved = () => dispatchEvent(new Event('lab-board-moved')); // the widget draws the pins again (the board's and the page's under it)
// The view came to rest after a slide (the board read its box again, board.resized): every pin on the board is placed
// again where its frame now is, as after a camera move (a plain redraw kept a pin where it was put mid-slide, off the screen).
const rested = () => dispatchEvent(new CustomEvent('lab-board-moved', { detail: { camera: true, box: true } }));
// The page scrolled under a half view: the board's pins are held to the screen, the page's own scroll with it, so the
// widget only hides or shows those the view's edge crossed (no redraw per scroll step: the pins flickered; Leo, 19 Nov).
const scrolled = () => dispatchEvent(new CustomEvent('lab-board-moved', { detail: { scroll: true } }));

/** The board called name in a view over this page. */
export function show(name: string, o: Opts) {
  lastOpts = o;
  if (!document.body) return void addEventListener('DOMContentLoaded', () => show(name, o), { once: true });
  if (cur?.name === name) return;
  if (cur) teardown();
  const pushed = o.push !== false;
  if (pushed) history.pushState({ ...(history.state && typeof history.state === 'object' ? history.state : {}), labBoard: name }, '', `${location.pathname}${location.search}#board=${name}`);
  const restoration = history.scrollRestoration;
  history.scrollRestoration = 'manual'; // back from #board=… keeps the page where it is now, not where it was when the view opened

  const view = document.createElement('div');
  view.setAttribute('data-lab-board-view', name);
  view.setAttribute('role', 'dialog');
  view.setAttribute('aria-label', `board ${name}`);
  const bar = document.createElement('div');
  bar.className = 'bv-bar';
  bar.setAttribute('data-uncommentable', '');
  const btn = (t: string, label: string, fn: () => void) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: t });
    b.setAttribute('aria-label', label);
    b.addEventListener('click', (e) => (e.stopPropagation(), fn()));
    return b;
  };
  const title = Object.assign(document.createElement('span'), { className: 'bv-name', textContent: `board ${name}` });
  // Every board fills the window, over its page or at its own address, so only one thing takes the presses (Leo, 23 Nov,
  // #422 pick 3B: no half view, no edge to drag). Back goes to the page where it was left.
  const closeBtn = o.own ? btn('‹ back', 'back to the page', () => backTo(o.of || '')) : btn('‹ back', 'back to the page', () => close());
  closeBtn.className = 'bv-close';
  // The board's own address: the way back only when it says which page it is about.
  bar.append(...(!o.own || o.of ? [closeBtn] : []), title);
  const box = document.createElement('div');
  box.className = 'bv-box';
  const root = document.createElement('div');
  box.append(root);
  view.attachShadow({ mode: 'open' }).append(Object.assign(document.createElement('style'), { textContent: CSS }), bar, box);
  view.classList.add('full');
  // The view's bar never scrolls the page behind (the board itself pans on the wheel).
  bar.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
  // A page's zoom on <html> or <body> scales what is drawn in the view: it zooms the other way, by what 100 px comes out as
  // (a probe, left in the shadow root).
  document.body.append(view);
  const k = view.shadowRoot!.appendChild(Object.assign(document.createElement('i'), { style: 'position:absolute;width:100px;height:0;visibility:hidden' })).getBoundingClientRect().width / 100;
  if (k > 0 && Math.abs(k - 1) > 0.001) view.style.setProperty('--bv-z', String(Math.min(10, Math.max(0.1, 1 / k))));
  // Where the view is, kept (it is asked for every pin of the page as the page scrolls under a half view). Watched
  // before the board watches its own box, so the board's word of a new size finds this one already right.
  let at = view.getBoundingClientRect();
  const ro = new ResizeObserver(() => (at = view.getBoundingClientRect()));
  ro.observe(view);
  // A phone's keyboard: iOS pans what the screen shows up by its height (visualViewport.offsetTop) and scrolls the page
  // under the fixed view, so the view slid up with it and came back down once the comment was sent (Leo, 21 Nov: "placing
  // pin shifts canvas when opening keyboard", "canvas still shifts after i drop comment"). The view goes down by the pan
  // instead, so the board holds its place on the screen; a draft pin that the sheet or the keyboard would cover is
  // brought above them by the camera (and the camera goes back when the keyboard goes). A half view whose top is under
  // what the keyboard leaves keeps sliding: there is nothing of it to hold.
  const vv = window.visualViewport;
  let pan = 0;
  let nudged = false; // the camera has glided to show a draft pin
  let settling = false; // …and is gliding back
  let scrollFrom = -1; // where the page was when the keyboard came up
  let typed = false; // the keyboard has been up since scrollFrom was taken
  let loop = 0;
  let quiet = 0;
  const follow = () => {
    if (!vv || !matchMedia('(pointer: coarse)').matches) return;
    const typing = Math.abs(vv.scale - 1) < 0.01 && innerHeight - vv.height > 60; // the keyboard is up
    const sr = document.querySelector('[data-lab-comments]')?.shadowRoot;
    // (A sheet on its way out is no sheet: the camera goes back as it slides away, not once it has gone.)
    const sheet = sr?.host.hasAttribute('data-leaving') ? undefined : sr?.querySelector('.float:not(.out)')?.getBoundingClientRect();
    const draft = sr?.querySelector<HTMLElement>('.pin.draft');
    const pin = draft?.style.position === 'fixed' ? draft.getBoundingClientRect() : null; // a new comment on the board (its pin is held to the screen)
    let changed = false;
    if (typing) {
      typed = true;
      if (scrollFrom < 0) scrollFrom = scrollY;
      if (settling) {
        settling = nudged = false; // typing again before the camera was back: it goes to the new pin from where it is
      }
    } else if (typed && !sheet && scrollFrom >= 0 && !vv.offsetTop) {
      if (Math.abs(scrollY - scrollFrom) > 1) scrollTo({ top: scrollFrom, behavior: 'instant' as ScrollBehavior }); // the page iOS scrolled for the keyboard goes back
      scrollFrom = -1;
      typed = false;
    }
    const viewTop = innerHeight - view.offsetHeight; // where the view starts when nothing is panned
    const next = typing && viewTop < vv.height - 160 ? Math.round(vv.offsetTop) : !typing ? Math.round(vv.offsetTop) : 0;
    if (next !== pan) {
      pan = next;
      view.style.setProperty('--bv-pan', `${pan}px`);
      const host = document.querySelector<HTMLElement>('[data-lab-comments]');
      host?.style.setProperty('--lab-pan', `${pan}px`); // the board's pins and its draft move down with the view (styles.css)
      host?.toggleAttribute('data-pan', pan > 0);
      at = view.getBoundingClientRect();
      quiet = 0;
      changed = true;
    }
    // (The pin was read before the view grew; the board holds it there on the screen, and a glide under way moves with the box.)
    if (typing && pin && sheet && !nudged && sheet.top > 0) {
      const over = pin.bottom + 16 - sheet.top;
      const dy = over > 0 ? -over - 24 : pin.top < 56 ? 56 - pin.top : 0;
      nudged = true; // looked at once per comment: the pin is not chased as the sheet moves
      if (dy) board.api.nudge(dy);
    } else if ((!typing || !/^(textarea|input)$/.test(sr?.activeElement?.localName || '')) && !sheet && !vv.offsetTop && nudged && !settling) {
      // The comment's sheet is leaving and nothing holds the keyboard any more (it is on its way down, or gone): the camera
      // glides back with them, not after them, to where it was.
      settling = true;
      board.api.nudgeBack(() => {
        if (settling) settling = nudged = false; // (not when typing again meanwhile)
      });
    }
    // Only when the view moved or changed its size: drawn again on every frame, the comment's box was made anew and took
    // the cursor again each time, which came back here as a focus and kept this going for as long as the box was open.
    if (changed) moved();
  };
  // Where the page was before the keyboard: taken as a field is focused, before iOS scrolls for it (taken when the keyboard
  // was already up, it was the scrolled place, and the page was put back there: 21 Nov simulator, 423 instead of 0).
  const focused = () => {
    if (scrollFrom < 0 && matchMedia('(pointer: coarse)').matches) scrollFrom = scrollY;
    watch();
  };
  addEventListener('focusin', focused);
  // iOS pans the screen in steps that come as events only now and then: the view follows every frame while it moves.
  const tick = () => {
    const before = pan;
    follow();
    quiet = before === pan ? quiet + 1 : 0;
    // …and for as long as the camera or the view is away for a keyboard: the sheet's going is no event.
    loop = quiet < 20 || (nudged && !settling) ? requestAnimationFrame(tick) : 0;
  };
  const watch = () => {
    quiet = 0;
    follow(); // now too, not only next frame: a frame late the view showed 323 px low for three frames as the keyboard went
    loop ||= requestAnimationFrame(tick);
  };
  vv?.addEventListener('resize', watch);
  vv?.addEventListener('scroll', watch);
  // A board that is about another page lives there (one set of pins): opened from this one, it goes over its own page.
  const home = (key: string, of: string) => {
    const flat = (p: string) => p.replace(/(\.html?|\/)$/i, '');
    if (o.own || key === o.page || flat(new URL(of, location.href).pathname) === flat(location.pathname)) return; // already on it
    history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    location.assign(`${of.split('#')[0]}#board=${name}`);
  };
  const board = mountBoard(root, name, o.own ? { of: o.of, back: o.of ? () => backTo(o.of || '') : undefined, hash: true, clip: true } : { of: o.of, back: () => close(), clip: true, home, keep: `lab-board-cam:${o.page}:${name}` });
  const covers = (x: number, y: number) => x >= at.left && x <= at.right && y >= at.top && y <= at.bottom;
  Object.assign(window, { __labBoard: { ...board.api, covers } });
  // The page scrolls under a half view: its pins and the board's are drawn again.
  addEventListener('scroll', scrolled, { passive: true });
  // Reduced motion: it fades in (started once the board is mounted: that blocks the page for a while) (Apple: a crossfade, not a pop of the whole window). Its opacity is !important in :host (all: initial),
  // which an animation or a transition can't beat, so --bv-o is stepped here, one frame at a time.
  // It comes up from the bottom, as the comment drawer does (not the board's own address: that is the whole page).
  // Where it is (at) and its pins are read again once it rests: a move is no resize, so the watch below misses it.
  if (!o.own && !matchMedia('(prefers-reduced-motion: reduce)').matches) setTimeout(() => cur?.view === view && ((at = view.getBoundingClientRect()), board.resized(), rested()), slide(view, true) + 20);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const d = token('calm');
    let t0 = 0;
    const fade = (now: number) => {
      const k = Math.min(1, ((t0 ||= now) === now ? 0 : now - t0) / d);
      if (k < 1) {
        view.style.setProperty('--bv-o', String(k));
        requestAnimationFrame(fade);
      } else view.style.removeProperty('--bv-o');
    };
    view.style.setProperty('--bv-o', '0');
    requestAnimationFrame(fade);
  }
  cur = { name, view, destroy: () => (ro.disconnect(), removeEventListener('focusin', focused), vv?.removeEventListener('resize', watch), vv?.removeEventListener('scroll', watch), cancelAnimationFrame(loop), board.destroy()), onClose: o.onClose, restoration, pushed };
  moved();
}

function teardown() {
  const c = cur;
  if (!c) return;
  cur = null;
  removeEventListener('scroll', scrolled);
  c.destroy();
  c.view.remove();
  document.querySelector('[data-lab-comments]')?.removeAttribute('data-board-slide');
  delete (window as unknown as { __labBoard?: unknown }).__labBoard;
  const y = keepY;
  keepY = null;
  const hold = () => y !== null && Math.abs(scrollY - y) > 1 && scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
  hold();
  requestAnimationFrame(() => (hold(), requestAnimationFrame(hold)));
  setTimeout(() => (history.scrollRestoration = c.restoration), 0);
  c.onClose?.();
  moved();
}

/** Close the view: back, when it was opened here (the entry it added goes), else the address loses its #board. */
// The view's slide, by the comment drawer's rules (../widget/sheetmove.ts): up into place (in: from below the screen, or
// back from where a finger left it, at `speed` px/ms toward its place), or down off the screen at the finger's speed
// (a tap on close: from rest, easing in). Its length in ms. No move is left on it once it rests (a moved box holds what
// is fixed inside it, the board's own layers).
function slide(view: HTMLElement, into: boolean, speed = 0) {
  const [quick, slow] = ['quick', 'slow'].map(token);
  const h = view.getBoundingClientRect().height;
  const off = /^\s*([\d.]+)px$/.exec(view.style.getPropertyValue('--bv-y'))?.[1];
  const now = off ? parseFloat(off) : into ? h + 8 : 0; // how far down it is now
  if (into && !off) {
    view.style.setProperty('--bv-t', '0ms');
    view.style.setProperty('--bv-y', `${now}px`);
    void view.offsetHeight;
  }
  const way = into ? now : h + 8 - now;
  // Opened by a tap (from below the screen, at rest) or closed by one: the chat sheet's own motion, its curve and length
  // (Leo, 21 Nov: "do same easing for open close as we do for chat for board drawer", then "ease in ease out tokens,
  // slower opened fast closed"): in over --lab-t-slow on --lab-ease-out, out over --lab-t-quick on --lab-ease-in. Let go by a finger, it keeps the finger's speed (sheetmove.ts).
  const [ms, curve] = into ? (off || speed ? move.glide(way, speed, slow, quick) : [slow, ease('ease-out', 'cubic-bezier(0, 0, .58, 1)')]) : speed > 0 ? move.carry(way, speed, slow, quick) : [quick, ease('ease-in', 'cubic-bezier(.4, 0, 1, 1)')];
  // What the widget holds to the board (its pins, an open card) is hidden for the slide, either way: gone with the first
  // frame of a close, back once the view has come to rest (Leo, 21 Nov: "closing board have pins not immediately hidden,
  // same opening not snappy"). Teardown lets go of it.
  const host = document.querySelector('[data-lab-comments]');
  host?.setAttribute('data-board-slide', '');
  if (into) setTimeout(() => cur?.view === view && host?.removeAttribute('data-board-slide'), ms + 20);
  view.style.setProperty('--bv-e', curve);
  view.style.setProperty('--bv-t', `${ms}ms`);
  view.style.setProperty('--bv-y', `${into ? 0 : h + 8}px`);
  if (into) setTimeout(() => ['--bv-t', '--bv-y', '--bv-e'].forEach((k) => view.style.removeProperty(k)), ms);
  return ms;
}
// A motion token of lab.css (--lab-t-quick, -base, -slow, -calm) in ms, as the comment widget has them (lab.css is served
// minified: .12s).
const token = (k: string) => {
  const v = /^\s*([\d.]+)(m?s)\s*$/.exec(getComputedStyle(document.documentElement).getPropertyValue(`--lab-t-${k}`));
  return v ? parseFloat(v[1]) * (v[2] === 's' ? 1000 : 1) : ({ quick: 120, base: 200, slow: 300 } as Record<string, number>)[k] || 120;
};
// A curve of lab.css (--lab-ease, --lab-ease-in), as the comment widget has them.
const ease = (k: string, or: string) => getComputedStyle(document.documentElement).getPropertyValue(`--lab-${k}`).trim() || or;
let closing = false;
/** Close the view: it slides down, then back, when it was opened here (the entry it added goes), else the address loses
 * its #board. The browser's own back takes it down at once (its own gesture is the motion). */
function close(speed = 0) {
  if (!cur || closing) return;
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches && !lastOpts?.own) {
    closing = true;
    return void setTimeout(() => ((closing = false), now()), slide(cur.view, false, speed));
  }
  now();
}
// Closing leaves the page where it is now, wherever it was scrolled to under the view: never back at the board's section
// (Leo, 21 Nov: "closing board by clicking on canvas after scrolled a bit should not return to board section").
let keepY: number | null = null;
function now() {
  if (!cur) return;
  keepY = scrollY;
  if (cur.pushed && nameInHash() === cur.name) return history.back(); // popstate (below) takes it down
  try {
    history.replaceState(history.state, '', `${location.pathname}${location.search}`);
  } catch {}
  teardown();
}

// Back and forward: the view follows the address's #board=<name>.
addEventListener('popstate', () => {
  if (lastOpts?.own) return; // the board's own address keeps the camera there instead
  const want = nameInHash();
  if (cur && want !== cur.name) teardown();
  if (want && !cur && lastOpts) show(want, { ...lastOpts, push: false });
});

// Back to the page this board is about, from the board's own address. Opened from that page in this tab: the browser's
// own back, which gives the page back where it was (bfcache / scroll restoration; Leo, 19 Nov: "closing board should
// back me from where i opened"). Otherwise a plain visit, and the page puts its scroll back from the key it left on its
// way here (the one a reload uses).
function backTo(of: string) {
  let came = false;
  try {
    const r = document.referrer && new URL(document.referrer);
    came = !!r && r.origin === location.origin && r.pathname === new URL(of, location.href).pathname && history.length > 1;
  } catch {}
  if (came) history.back();
  else location.href = of;
}

/** The board called name at its own address (/_lab/board/<name>[?of=/page]): the view over the whole of an empty page.
 * ⇧B, Esc on an empty board, "‹ back" and the browser's own back go to the page it is about, when the address names one. */
export function own(name: string) {
  show(name, { page: '', of: new URLSearchParams(location.search).get('of') || '', push: false, own: true });
}

// A board as a section of the page (<lab-board name>, put there by +board, src/widget/boardcam.ts): a strip of what is on it, the page itself
// left out. A tap opens the board over the page. Outside the lab the tag is an empty element, and shows nothing.
// In the page's own colours (its text colour; borders and fills from it), so it reads on a dark page as on a light one;
// straight under <body> it keeps off the screen's edges (in the shadow: what is on <lab-board> itself is the file's).
const STRIP = `:host{display:block!important;box-sizing:border-box!important;margin:16px 0!important;font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:inherit}
.edge{margin:0 16px}
.box{border:1px solid color-mix(in srgb,currentColor 16%,transparent);border-radius:var(--_radius,12px);padding:10px;background:color-mix(in srgb,rgb(52,199,89) 7%,transparent)}
.top{display:flex;align-items:center;gap:8px;margin:0 2px 8px}
.top b{font-weight:600}.top span{opacity:.65;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.top button{font:inherit;border:0;border-radius:var(--_radius,12px);padding:4px 11px;cursor:pointer;background:rgba(52,199,89,.18);color:inherit}
.row{display:flex;gap:8px;overflow-x:auto;scrollbar-width:thin}
.row>*{flex:none;height:120px;border-radius:var(--_r-s,6px);background:color-mix(in srgb,currentColor 6%,transparent)}
img{display:block;max-width:240px;object-fit:cover}
.page{width:160px;padding:10px;box-sizing:border-box;overflow:hidden;opacity:.8}
.none{opacity:.65;padding:4px 2px}`;
const el = (tag: string, props: object = {}, ...kids: (Node | string)[]) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
};
/** A board as a section of the page: <lab-board name> (src/widget/boardcam.ts), filled with a strip of what is on the board. */
export const section = async (host: HTMLElement, o: { page: string }) => {
  const name = host.getAttribute('name') || '';
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) return;
  const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
  const b = await fetch(`/_lab/api/board?name=${name}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null), () => null);
  // No board to show here (it is gone, can't be read, or is about another page: a copied file): nothing, never an empty
  // box (Leo, 21 Nov: "no stray board on pages without access to them").
  if (!b || String(b.of || '').split('#')[0] !== o.page) return void root.replaceChildren(); // an empty shadow: nothing shows
  const frames = (b?.frames || []).filter((f: { state?: string; src: string }) => f.state !== 'archived' && f.src.split(/[?#]/)[0] !== o.page);
  const thumb = (f: { kind?: string; src: string; label?: string; id: string }) => (f.kind === 'image' ? el('img', { src: f.src, alt: f.label || '', loading: 'lazy' }) : el('div', { className: 'page' }, f.label || (f.src.startsWith('/_lab/board/') ? `variant ${f.id}` : f.src)));
  const said = String(b.title || '');
  root.replaceChildren(
    el('style', {}, STRIP),
    el('div', { className: host.parentElement === document.body ? 'box edge' : 'box' },
      el('div', { className: 'top' }, el('b', {}, 'Board'), el('span', {}, [`${frames.length || 'nothing'} on it`, b.status === 'needs your reply' ? 'board needs your reply' : b.status, said.slice(0, 60)].filter(Boolean).join(' · ')), el('button', {}, 'Open')),
      frames.length ? el('div', { className: 'row' }, ...frames.map(thumb)) : el('div', { className: 'none' }, 'Open it to add pictures and pages for the agent.'),
    ),
  );
};
