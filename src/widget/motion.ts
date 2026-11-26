// Part of the comment widget, built as its own file (public/_lab/motion.js, scripts/build-widget.mjs) that src/comments.js
// loads once the page has something that moves (a video, an animation), P or S is pressed, or a comment has a moment. Its styles come with it. Uses the widget's own parts through W, set once at startup.
import { clock, momentText } from '../../lib/moment.mjs';
import css from './motion.css';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let W: any;
let S: any; // the widget's state (W.S), read once at startup
// Motion menus (Leo, 23 Nov, #421: 1a 2a 3a 4c 5a): nothing of labit sits on a moving thing any more. Computers: a
// right-click on a video or a loop opens labit's motion menu at the pointer (its moment, pause, speed ¼ ½ 1, comment at
// that moment, pause all); a right-click anywhere else is the browser's own. Phones: ⋯ → motion opens a sheet (pick on
// page, pause all, speed for all); picking a moving thing brings the same sheet for that one. P pauses all, S slows all.
// The widget's own animations keep moving, and a comment on a moving thing says which second (anchoring.ts).
const held = new Set<any>(); // the videos and elements labit paused
const LONG_MS = 5000; // an animation that ends counts as motion from this long on
const pageAnims = () => document.getAnimations().filter((a) => {
  const t = (a.effect as KeyframeEffect | null)?.target;
  if (!t || W.root.contains(t)) return false;
  if (held.has(t)) return true;
  // Only motion that goes on (a loop) gets a pause: a transition, or an animation that ends, is a moment, like the
  // highlight on a heading you just went to (Leo, 19 Nov: "what's with the animation pause thing on headers").
  if (typeof CSSTransition !== 'undefined' && a instanceof CSSTransition) return false;
  const end = a.effect?.getComputedTiming().endTime;
  if (!(typeof end === 'number' && Number.isFinite(end))) return true;
  // A long one that is still going gets a pause too: a film or a slideshow run on one clock (Leo, 23 Nov: the motion
  // menu didn't come on a 2-minute film). Short ones that end stay moments.
  return end >= LONG_MS && a.playState !== 'finished';
});
const targetOf = (a) => (a.effect as KeyframeEffect).target;
// An element's own animations first, then those inside it.
const animsOf = (el) => pageAnims().filter((a) => el.contains(targetOf(a))).sort((a, b) => Number(targetOf(b) === el) - Number(targetOf(a) === el));
const videosIn = (el) => (el instanceof HTMLVideoElement ? [el] : [...el.querySelectorAll('video')]);
const moving = () => [...new Set([...document.querySelectorAll('video'), ...held, ...pageAnims().filter((a) => a.playState === 'running').map(targetOf)])].filter((el) => el?.isConnected);
const isStill = (el) => videosIn(el).every((v) => v.paused) && animsOf(el).every((a) => a.playState !== 'running');
const setItem = (el, stop) => {
  for (const v of videosIn(el)) {
    if (stop) v.pause();
    else v.play?.().catch(() => {});
  }
  for (const a of animsOf(el)) {
    if (stop && a.playState === 'running') a.pause();
    else if (!stop && a.playState === 'paused') a.play();
  }
  if (!stop) for (const h of held) if (el.contains(h)) held.delete(h); // played from around it: what is inside plays too
  held[stop ? 'add' : 'delete'](el);
  S.paused = held.size > 0; // a comment written now says the page was paused
};
// The moving thing a pin is about (Leo, 19 Nov: pins on a dot, a video and a GIF all got the loop next to them): the
// pinned element's own motion wins, the video or animation it is, holds or sits in, and of several the one under
// the pin's own spot (else the nearest to it). Only a pin with no motion of its own (the page, a heading) takes the
// paused thing most in view, nearest the screen's middle.
const ownMotion = (anchor) => {
  let at = null;
  try {
    at = anchor?.selector ? document.querySelector(anchor.selector) : null;
  } catch {}
  if (at === document.body || at === document.documentElement || (at && W.root.contains(at))) at = null;
  const things = [...new Set([...held, ...document.querySelectorAll('video'), ...pageAnims().map(targetOf)])].filter((el) => el?.isConnected && !W.root.contains(el));
  const area = (r) => r.width * r.height;
  if (at) {
    const ar = at.getBoundingClientRect();
    const px = ar.left + (Number.isFinite(anchor.x) ? anchor.x : 0.5) * ar.width, py = ar.top + (Number.isFinite(anchor.y) ? anchor.y : 0.5) * ar.height;
    const own = things.filter((el) => at.contains(el) || el.contains(at));
    const box = (el) => el.getBoundingClientRect();
    const under = own.filter((el) => { const r = box(el); return px >= r.left && px <= r.right && py >= r.top && py <= r.bottom; });
    if (under.length) return under.sort((p, q) => area(box(p)) - area(box(q)))[0]; // the smallest under the spot: the thing itself, not what holds it
    const off = (el) => { const r = box(el); return Math.hypot(Math.max(r.left - px, 0, px - r.right), Math.max(r.top - py, 0, py - r.bottom)); };
    if (own.length) return own.sort((p, q) => off(p) - off(q))[0];
  }
  return null;
};
// A pin with no motion of its own, while paused: the paused thing most in view, nearest the screen's middle.
export const pausedEl = (anchor) => ownMotion(anchor) || inView();
const inView = () => {
  const all = [...held].filter((el) => el.isConnected);
  const cx = innerWidth / 2, cy = innerHeight / 2;
  const score = (el) => {
    const r = el.getBoundingClientRect();
    const seen = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return [seen > 0 ? 0 : 1, Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy)];
  };
  return all.map((el) => [el, score(el)]).sort((p, q) => p[1][0] - q[1][0] || p[1][1] - q[1][1])[0]?.[0];
};
// A short name for it, as a person would point at it: ".hero video", "#spinner", "div.dot".
const nameOf = (el) => {
  const own = (n) => n.localName + (n.id ? `#${n.id}` : n.classList[0] ? `.${n.classList[0]}` : '');
  const me = own(el);
  if (el.id || el.classList.length) return me.slice(0, 80);
  const up = el.parentElement?.closest('[id], [class]');
  return (up && up !== document.body ? `${up.id ? `#${up.id}` : `.${up.classList[0]}`} ${me}` : me).slice(0, 80);
};
// Where a paused thing stands: a video's second of its length; an animation's second inside one pass and which pass
// (a loop's total time, 835734 ms, says neither). lib/moment.mjs words it.
const momentOf = (el) => {
  if (!el) return undefined;
  const what = nameOf(el), sel = W.selectorFor(el);
  const playing = isStill(el) ? undefined : true; // nothing paused: the moment it was showing as the pin went down
  if (el instanceof HTMLVideoElement) {
    if (!Number.isFinite(el.currentTime)) return undefined;
    return { kind: 'video', at: el.currentTime, of: Number.isFinite(el.duration) ? el.duration : undefined, what, sel, playing };
  }
  const a = animsOf(el)[0];
  const t = a?.effect?.getComputedTiming();
  const dur = Number(t?.duration), local = Number(t?.localTime);
  if (!t || !(dur > 0) || !Number.isFinite(local)) return undefined;
  const pass = Number.isFinite(t.currentIteration) ? t.currentIteration : 0;
  const at = Math.min(Math.max(local - (t.delay || 0) - pass * dur, 0), dur);
  return { kind: t.iterations === Infinity ? 'loop' : 'anim', at: at / 1000, of: dur / 1000, pass: pass + 1, what, sel, ms: Number(a.currentTime), playing };
};
// A pin's moment chip: the page pauses and the thing goes back to that moment, to see what was meant. It stays
// paused; play it again as usual (the control or the pause key).
const seekMoment = (m) => {
  let el = null;
  try {
    el = m?.sel ? document.querySelector(m.sel) : null;
  } catch {}
  if (!el || m.kind === 'gif') return false;
  setPause(true);
  if (!held.has(el)) setItem(el, true);
  if (el instanceof HTMLVideoElement) el.currentTime = m.at;
  else {
    const a = animsOf(el)[0];
    const t = a?.effect?.getComputedTiming();
    if (!a) return false;
    a.currentTime = Number.isFinite(m.ms) ? m.ms : (t?.delay || 0) + ((m.pass || 1) - 1) * Number(t?.duration) + m.at * 1000;
  }
  refresh();
  return true;
};
// Opening a pin placed on a video takes that video back to the frame it was placed on (Leo, 24 Nov), and holds it
// there to be seen: only that video stops, the rest of the page goes on. Play it again as usual.
export const showMoment = (m) => {
  if (m?.kind !== 'video') return;
  let el = null;
  try {
    el = m.sel ? document.querySelector(m.sel) : null;
  } catch {}
  if (!(el instanceof HTMLVideoElement) || W.root.contains(el)) return;
  if (!isStill(el)) setItem(el, true);
  el.currentTime = m.at;
  refresh();
};
// The moment, as a quiet line (Leo, 23 Nov, 4c): under the first message of a thread, beside its time, and above the box
// of a comment being written; every kind, in the words the agent gets. A button where the page can go back to it (a
// video, an animation); a GIF's only says (it can't be sought).
const momentLine = (m, seek = false) => {
  const line = W.el(seek && m.kind !== 'gif' ? 'button' : 'span', { class: 'moment' }, momentText(m));
  if (line.localName === 'button') {
    line.setAttribute('type', 'button');
    line.title = 'pause the page at this moment';
    line.addEventListener('click', (e) => (e.stopPropagation(), seekMoment(m)));
  }
  return line;
};
// A pin's moment: on a GIF (it can't be paused), how long it had been showing; else, while paused, where the paused
// thing it is about stood.
// Every way (Leo, 19 Nov: "it says only if i pause one"): the page paused, one thing paused, or nothing paused, a pin
// on a moving thing takes that thing's moment as the pin goes down (begin); a pin on still things, while paused, the
// paused thing most in view.
export const momentFor = (anchor) => {
  if (anchor.shownFor !== undefined) return { kind: 'gif', at: anchor.shownFor };
  const el = ownMotion(anchor) || (S.paused ? inView() : null);
  return el ? momentOf(el) : undefined;
};
export const msOf = (el) => {
  if (!el) return undefined;
  const t = el instanceof HTMLVideoElement ? el.currentTime * 1000 : Number(animsOf(el)[0]?.currentTime);
  return Number.isFinite(t) ? Math.round(t) : undefined;
};
// Speed (Leo, 23 Nov: ¼ ½ 1). S, or the speed in a phone's first sheet, sets the page's; a thing's menu sets its own,
// which wins for it and what is inside it. Each animation and video goes back to its own rate at 1. Motion that starts
// later takes it as it starts (and by the 1 s look, for script animations).
let pageRate = 1;
const rateOf = new Map<Element, number>(); // a thing's own speed, from its menu
const ownRate = new WeakMap<object, number>(); // each animation's and video's own rate, to go back to
const wantRate = (t) => {
  let best = null;
  for (const [e, r] of rateOf) if (e.isConnected && e.contains(t) && (!best || best[0].contains(e))) best = [e, r];
  return best ? best[1] : pageRate;
};
export const anySlow = () => pageRate !== 1 || [...rateOf.values()].some((r) => r !== 1);
const applyRates = () => {
  const set = (x, r) => {
    if (r !== 1 && !ownRate.has(x)) ownRate.set(x, x.playbackRate);
    const base = ownRate.get(x);
    if (base === undefined) return;
    if (x instanceof HTMLMediaElement) x.playbackRate = base * r;
    else x.updatePlaybackRate(base * r);
    if (r === 1) ownRate.delete(x);
  };
  for (const a of document.getAnimations()) {
    const t = (a.effect as KeyframeEffect | null)?.target;
    if (t && !W.root.contains(t)) set(a, wantRate(t));
  }
  for (const v of document.querySelectorAll('video')) set(v, wantRate(v));
};
const setRate = (el, r) => {
  if (el) rateOf.set(el, r);
  else {
    pageRate = r;
    rateOf.clear();
  }
  S.slow = pageRate !== 1; // a comment written now says so (comments.js)
  applyRates();
  refresh();
};
export const setSlow = (on) => setRate(null, on ? 0.25 : 1);
export const setPause = (on) => {
  for (const el of on ? moving().filter((el) => !isStill(el)) : [...held]) setItem(el, on);
  refresh();
};

// The things a menu can be about: videos, loops, and what labit paused. Under a point: the innermost one that is the
// element there or holds it (the video under a play button laid over it, too); else the smallest whose box holds the
// point (a thing that slid out from under it).
const things = () => [...new Set([...held, ...document.querySelectorAll('video'), ...pageAnims().map(targetOf)])]
  .filter((el) => el?.isConnected && el !== document.body && el !== document.documentElement && el !== W.host && !W.root.contains(el));
const thingAt = (x, y) => {
  const all = things();
  for (const n of document.elementsFromPoint(x, y)) {
    if (n === W.host) continue;
    const own = all.filter((t) => t.contains(n));
    if (own.length) return own.sort((a, b) => (a.contains(b) ? 1 : b.contains(a) ? -1 : 0))[0];
  }
  const area = (r) => r.width * r.height;
  return all.map((t) => [t, t.getBoundingClientRect()] as const).filter(([, r]) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)
    .sort((p, q) => area(p[1]) - area(q[1]))[0]?.[0] || null;
};

// The menu (Leo, 23 Nov, 2a 3a 5a): the ⋯ menu's own box and rows, words only. Computers: a popover at the pointer,
// above the page's own dialogs. Phones: one of the widget's sheets (the chat's drawer: its handle, swipe and dimmed page).
let box: HTMLElement;
let open = false;
let target = null; // what it is about; none: the whole page (a phone's first sheet)
let spot = null; // where it was opened or picked: a comment from it goes there
let custom = null; // a pin's or a drawing's own rows (comments.js): [words, run, key?]
let under = null; // a computer's right-click: what was under the pointer (motion.ts's own menu: nothing moves there)
let moment; // the target's moment as the menu opened: its first line and its comment's
const words = (m) => momentText({ ...m, playing: undefined });
const short = (m) => (m.kind === 'video' ? clock(m.at, true) : `${Math.round(m.at * 10) / 10} s`);
const item = (label, run, keep = W.coarse, key = '') => {
  const b = W.el('button', { type: 'button' }, label);
  if (key) {
    b.append(W.el('kbd', {}, key));
    b.dataset.key = key;
  }
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    run();
    if (keep) refresh();
    else closeMotion();
  });
  return b;
};
const speedRow = (now, set) => {
  const row = W.el('div', { class: 'motion-speed', role: 'group', 'aria-label': 'speed' }, 'speed');
  const seg = W.el('span', {});
  for (const [t, v] of [['¼', 0.25], ['½', 0.5], ['1', 1]] as const) {
    const b = W.el('button', { type: 'button', 'aria-pressed': String(now === v), 'aria-label': v === 1 ? 'full speed' : `${t} speed` }, t);
    b.addEventListener('click', (e) => (e.stopPropagation(), set(v)));
    seg.append(b);
  }
  row.append(seg);
  return row;
};
// The right-click menu's rows where nothing moves (Leo, 26 Nov, option 3): comment first; on a link, button or field,
// commenting on it and (with the pin, where a click comments) using it; elsewhere drawing, and quoting selected words.
const CTL = 'a[href],button,input,select,textarea,summary,label,[role=button],[role=link]';
const hereRows = (rows: HTMLElement[]) => {
  const at = spot;
  const pin = () => (closeMotion(), W.begin(W.anchorAt(at.x, at.y)));
  const ctl = under?.closest?.(CTL);
  const said = String(getSelection?.() || '').trim();
  if (ctl) {
    const name = ctl.matches('a') ? 'link' : ctl.matches('input, select, textarea') ? 'field' : 'button';
    rows.push(item(`comment on this ${name}`, pin, false));
    if (W.commenting()) rows.push(item(`use this ${name}`, () => (name === 'field' ? ctl.focus() : ctl.click()), false));
  } else {
    rows.push(item('comment here', pin, false), item('draw here', W.drawOnce, false, `hold ${W.KEYS.draw}`));
    if (said) rows.push(item('quote these words', () => W.offerSelection(), false, '⇧ drag'));
  }
};
const fill = () => {
  const rows: HTMLElement[] = W.coarse ? [W.el('div', { class: 'handle' })] : [];
  if (custom) rows.push(...custom.map(([l, run, key]) => item(l, run, false, key)));
  else if (under && !target) hereRows(rows);
  else if (!target) {
    rows.push(W.el('div', { class: 'lab-head' }, 'motion'), item('pick on page', startPick, false), item(S.paused ? 'play all' : 'pause all', () => setPause(!S.paused)), speedRow(pageRate, (v) => setRate(null, v)));
  } else {
    rows.push(W.el('div', { class: 'lab-head' }, moment ? words(moment) : nameOf(target)));
    // A computer's menu says comment first (option 3); a phone's sheet keeps it after the controls.
    const said = moment ? item(`comment at ${short(moment)}`, comment, false) : under ? item('comment here', comment, false) : null;
    if (said && under) rows.push(said);
    const pause = item(isStill(target) ? 'play' : 'pause', () => (setItem(target, !isStill(target)), (moment = momentOf(target) || moment))); // its moment as it stopped
    pause.dataset.key = W.KEYS.pause; // P works while the menu is open, as R and E do
    rows.push(pause);
    rows.push(speedRow(rateOf.get(target) ?? pageRate, (v) => setRate(target, v)));
    if (said && !under) rows.push(said);
    if (!W.coarse) rows.push(W.el('hr', {}), item(S.paused ? 'play all motion' : 'pause all motion', () => setPause(!S.paused)));
  }
  if (under && !custom) { // the browser's own menu is a key away
    const hint = W.el('div', { class: 'hint-row' }, 'browser menu');
    hint.append(W.el('kbd', {}, '⌥ right-click'));
    rows.push(W.el('hr', {}), hint);
  }
  box.replaceChildren(...rows);
};
function refresh() {
  if (open) fill();
}
const comment = () => {
  const m = moment, at = spot;
  closeMotion();
  W.begin({ ...W.anchorAt(at.x, at.y), ...(m ? { moment: m } : {}) }); // the moment as the menu opened, not as the comment starts
};
const openFor = (el, at, t = null, list = null) => {
  target = el;
  spot = at;
  under = t;
  custom = list;
  moment = el ? momentOf(el) : undefined;
  fill();
  open = true;
  box.hidden = false;
  if (W.coarse) {
    S.motionOpen = true;
    return void W.render();
  }
  if (box.popover && !box.matches(':popover-open')) box.showPopover();
  // At the pointer, on screen: left of it or above it where there is no room.
  const w = box.offsetWidth, h = box.offsetHeight;
  const x = at.x + w + 4 > innerWidth ? Math.max(4, at.x - w) : at.x;
  const y = at.y + h + 4 > innerHeight ? Math.max(4, at.y - h) : at.y;
  box.style.inset = `${y}px auto auto ${x}px`;
};
/** Computers: the right-click menu at a point (comments.js): what moves there, else the page there. */
export const menuAt = (x: number, y: number, t: Element) => openFor(thingAt(x, y), { x, y }, t);
/** Computers: a pin's or a drawing's menu, its rows given (comments.js). */
export const menuWith = (x: number, y: number, list) => openFor(null, { x, y }, null, list);
/** Phones: ⋯ → motion, the sheet for the whole page. */
export const openMotion = () => openFor(null, null);
/** The open sheet (phones), for the widget's own sheet handling. */
export const motionSheet = () => (open && W.coarse ? box : null);
export function closeMotion() {
  if (!open) return;
  open = false;
  if (W.coarse) {
    box.hidden = true;
    S.motionOpen = false;
    return void W.render();
  }
  if (box.popover && box.matches(':popover-open')) box.hidePopover();
  box.hidden = true;
}
// Phones, pick on page: the sheet goes, and the next tap picks what moves there without doing what a tap does (a video's
// play, a link, a hold's pin); a drag still scrolls. A tap on nothing that moves brings the first sheet back.
let picking = false;
let down = null;
let pickedAt = -1e9;
const startPick = () => {
  picking = true;
  W.say('tap something moving');
};
const swallow = (e) => (e.preventDefault(), e.stopImmediatePropagation());

export function bindMotion(w: unknown) {
  W = w;
  S = W.S;
  W.root.append(W.el('style', {}, css)); // its styles come with it, after the widget's own
  S.momentLine = momentLine;
  box = W.el('div', { class: `more-menu motion-menu${W.coarse ? ' motion-sheet' : ''}`, role: 'menu', 'aria-label': 'motion', hidden: '' });
  (W.root.querySelector('.ui') || W.root).append(box);
  if (W.coarse) W.swipeDown(box, closeMotion);
  else {
    // A manual popover: above the page's own dialogs, closed here on a press elsewhere, Esc or leaving the window. An
    // auto one closed again in WebKit on the lift of the very right-click that opened it.
    if ('showPopover' in HTMLElement.prototype) box.popover = 'manual';
    // A press outside only closes it: the click it ends pins nothing (docs/design-rules.md, S.menuShut in comments.js).
    addEventListener('pointerdown', (e) => open && !e.composedPath().includes(box) && ((S.menuShut = Date.now()), closeMotion()), true);
    addEventListener('keydown', (e) => open && e.key === 'Escape' && (swallow(e), closeMotion()), true);
    // The keys a row shows work while the menu is open (Leo, 26 Nov: "shortcuts there doesnt work when menu opened"):
    // R replies, E resolves, P pauses, as the row would.
    addEventListener('keydown', (e) => {
      const key = open && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat ? W.KEYS[W.actionOf(e)] : '';
      const row = key && box.querySelector<HTMLElement>(`button[data-key="${CSS.escape(key)}"]`);
      if (!row) return;
      swallow(e);
      row.click();
    }, true);
    addEventListener('blur', () => closeMotion());
  }
  addEventListener('pointerdown', (e) => {
    if (!picking || e.composedPath().includes(W.host)) return;
    e.stopImmediatePropagation(); // not a hold
    down = { x: e.clientX, y: e.clientY };
  }, true);
  addEventListener('pointermove', (e) => picking && down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10 && (down = null), { capture: true, passive: true });
  addEventListener('touchend', (e) => (picking || performance.now() - pickedAt < 600) && e.cancelable && e.preventDefault(), { capture: true, passive: false }); // no click, no video controls
  addEventListener('pointerup', (e) => {
    if (!picking || !down) return;
    e.stopImmediatePropagation();
    picking = false;
    pickedAt = performance.now();
    const at = down;
    down = null;
    openFor(thingAt(at.x, at.y), at);
  }, true);
  addEventListener('click', (e) => (picking || performance.now() - pickedAt < 600) && !e.composedPath().includes(W.host) && swallow(e), true);
  for (const type of ['animationstart', 'transitionrun', 'play']) addEventListener(type, () => anySlow() && applyRates(), true);
  setInterval(() => anySlow() && applyRates(), 1000);
}
