// A page inside a board's frame (the board names the iframe "lab:<id>" and sets top.__labBoard): it draws nothing and
// binds nothing. No bar, no pill, no pins, no menu, no listeners of the widget's own. The board is the one widget.
// What it keeps: the page's live updates (a save patches or reloads this frame, never the board), reading the lab's
// state from the board's stream and not opening its own, and a way to pass keys on to the board.
import { bindLive, startLive } from './live.ts';
import { anchorAt, bindAnchoring, position } from './anchoring.ts';

/** True in a board's frame: the name the board gave it, and a board on top (the name alone could be anyone's frame). */
export const inFrame = (): boolean => {
  try {
    return window.name.startsWith('lab:') && Boolean((top as unknown as { __labBoard?: unknown }).__labBoard);
  } catch {
    return false;
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Board = { busy?: () => boolean; key?: (k: Record<string, unknown>) => unknown } & Record<string, any>;

export function startFrame(script: HTMLScriptElement | null) {
  const board = () => (top as unknown as { __labBoard: Board }).__labBoard;
  // live.ts runs on this: what it touches of the widget is a detached stand-in that is never put on the page.
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<div class="left"></div><button class="chat-btn"></button><button class="list-btn"></button>';
  const none = () => {};
  const S = { page: script?.dataset.page || location.pathname.replace(/\/+$/, '') || '/', frame: window.name, busy: () => Boolean(board()?.busy?.()) };
  bindLive({
    S, script, host, root, coarse: false, pageStyle: null, pinCursorStyle: null, still: matchMedia('(prefers-reduced-motion: reduce)'), tabTitle: { base: '' },
    chatBtn: root.querySelector('.chat-btn'), listBtn: root.querySelector('.list-btn'),
    drawList: none, reflow: none, relook: none, load: none, loadChanges: none, syncReads: none,
    // Live reload in place (reload.js) is fetched from beside this script on the first save, as on a page.
    part: (name: string) => import(new URL(`${name}.js`, script?.src || location.href).href),
  });
  startLive();
  // A press in this page (the frame is entered: only then do presses reach it) is a press outside whatever the board's
  // widget has open, a comment or the chat: the board is told, and closes it as a click outside does on a page.
  addEventListener('pointerdown', (e) => e.button === 0 && board()?.pressed?.(), true);
  // The middle or a side button pans the board here too, as on its canvas, and a side button's lift steps no page back or
  // forward (Leo, 26 Nov: "mouse side buttons to pan board", "and wheel down too"). Screen px: the frame is zoomed.
  let pan: { x: number; y: number } | null = null;
  let cursor = ''; // the page's own, put back when the pan ends
  addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || ![1, 3, 4].includes(e.button)) return;
    e.preventDefault();
    if (!pan) cursor = document.documentElement.style.cursor;
    pan = { x: e.screenX, y: e.screenY };
    document.documentElement.style.cursor = 'grabbing'; // the hand, as on the board (Leo, 26 Nov: "show hand on all three")
    document.documentElement.setPointerCapture?.(e.pointerId);
  }, true);
  addEventListener('pointermove', (e) => {
    if (!pan) return;
    board()?.pan?.(e.screenX - pan.x, e.screenY - pan.y);
    pan = { x: e.screenX, y: e.screenY };
  }, true);
  // Only a pan's end puts the cursor back: every other lift cleared a cursor the page had set on itself.
  for (const t of ['pointerup', 'pointercancel', 'mouseup'])
    addEventListener(t, (e) => {
      if (pan) document.documentElement.style.cursor = cursor;
      pan = null;
      if ((e as MouseEvent).button > 2) e.preventDefault();
    }, true);
  // What the board may ask of this page: a pin on this frame is on an element of the page, found again the way a page's
  // own pins are (anchoring.ts, here, on this page): when the page changes (a frame showing only its section, an edit), the
  // pin goes with its element, not left at the px it was put at (Leo, 26 Nov: "points on boards doesnt find their location
  // after changes"). Each spot is kept until the page changes (a pan asks every pin again, many times a second).
  bindAnchoring({ host, layer: host, el: (tag) => document.createElement(tag) });
  let gen = 0;
  let told = 0;
  const spots = new WeakMap<object, { gen: number; at: { left: number; top: number } | null }>();
  new MutationObserver((list) => {
    gen++;
    // Its words or elements changed (not a style that moves on its own): the board draws its pins again, once it settles.
    if (!told && list.some((m) => m.type !== 'attributes')) told = window.setTimeout(() => ((told = 0), board()?.changed?.()), 150);
  }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  addEventListener('resize', () => gen++);
  const spot = (a: Record<string, unknown>) => {
    const had = spots.get(a);
    if (had?.gen === gen) return had.at;
    // A board pin keeps the page's anchor flat on itself; its kind on the page is text when it quoted words.
    const s = position({ ...a, kind: a.quote ? 'text' : 'element' });
    const at = s.moved || s.hidden ? null : { left: s.left, top: s.top };
    spots.set(a, { gen, at });
    return at;
  };
  Object.assign(window, { __labSpot: { clear: () => getSelection()?.removeAllRanges(), anchor: (x: number, y: number) => anchorAt(x, y), spot } });
  // A key heard here goes to the board unless the page used it or is typing in it: the board's keys work in a focused frame.
  addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    // Esc is the board's only when nothing in the page has the focus: with a field or a menu focused it is the page's first.
    if (e.key === 'Escape' && document.activeElement && document.activeElement !== document.body && document.activeElement !== document.documentElement) return;
    if (e.defaultPrevented || t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName || '')) return;
    const k = { key: e.key, code: e.code, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, repeat: e.repeat };
    // Not the board's: the widget's (D draws, E shows done, M, T, W...) as if pressed on the board's page: with the focus
    // in a live frame D drew nothing (Mac test, 21 Nov).
    if (!board()?.key?.(k)) top?.document.dispatchEvent(new KeyboardEvent('keydown', { ...k, bubbles: true, cancelable: true }));
  });
  addEventListener('keyup', (e) => top?.document.dispatchEvent(new KeyboardEvent('keyup', { key: e.key, code: e.code, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, bubbles: true, cancelable: true })));
}
