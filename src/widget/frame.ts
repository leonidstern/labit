// A page inside a board's frame (the board names the iframe "lab:<id>" and sets top.__labBoard): it draws nothing and
// binds nothing. No bar, no pill, no pins, no menu, no listeners of the widget's own. The board is the one widget.
// What it keeps: the page's live updates (a save patches or reloads this frame, never the board), reading the lab's
// state from the board's stream and not opening its own, and a way to pass keys on to the board.
import { bindLive, startLive } from './live.ts';

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
  motionUrl = new URL('motion.js', script?.src || location.href).href;
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
  });
  startLive();
  // An entered frame's wheel scrolls its own page and stops at its end: it never runs on into the page behind a board's view.
  document.documentElement.style.overscrollBehavior = 'contain';
  // A press in this page (the frame is entered: only then do presses reach it) is a press outside whatever the board's
  // widget has open, a comment or the chat: the board is told, and closes it as a click outside does on a page.
  addEventListener('pointerdown', (e) => e.button === 0 && board()?.pressed?.(), true);
  // What the board may ask of this page (the rest of the bridge comes with the pins).
  Object.assign(window, { __labSpot: { clear: () => getSelection()?.removeAllRanges() } });
  // A key heard here goes to the board unless the page used it or is typing in it: the board's keys work in a focused frame.
  addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    // Esc is the board's only when nothing in the page has the focus: with a field or a menu focused it is the page's first.
    if (e.key === 'Escape' && document.activeElement && document.activeElement !== document.body && document.activeElement !== document.documentElement) return;
    if (e.defaultPrevented || t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName || '')) return;
    if (frameKey(e)) return;
    const k = { key: e.key, code: e.code, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, repeat: e.repeat };
    // Not the board's: the widget's (D draws, E shows done, M, T, W...) as if pressed on the board's page: with the focus
    // in a live frame D drew nothing (Mac test, 21 Nov).
    if (!board()?.key?.(k)) top?.document.dispatchEvent(new KeyboardEvent('keydown', { ...k, bubbles: true, cancelable: true }));
  });
  addEventListener('keyup', (e) => top?.document.dispatchEvent(new KeyboardEvent('keyup', { key: e.key, code: e.code, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, bubbles: true, cancelable: true })));
}

// A video in an open frame steps as on a page (Leo, 23 Nov, 8a): ← → a frame, ⇧ a second, Space plays or pauses; an
// arrow on a playing one pauses it first. The focused video, else the one most in view; none on screen: the board's keys.
// The stepping itself is the motion script's (motion.ts frameKey), loaded on the first such key: not in every page.
let motionUrl = '';
const shown = (v: HTMLVideoElement) => {
  const r = v.getBoundingClientRect();
  return Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
};
function frameKey(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const space = e.key === ' ' && !e.shiftKey && !(e.target as HTMLElement | null)?.closest?.('button, a, summary');
  if (!space && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return false;
  const f = document.activeElement;
  const v = f instanceof HTMLVideoElement ? f : [...document.querySelectorAll('video')].filter((x) => shown(x) > 0).sort((a, b) => shown(b) - shown(a))[0];
  if (!v) return false;
  e.preventDefault();
  e.stopImmediatePropagation();
  const k = { key: e.key, shiftKey: e.shiftKey, metaKey: false, ctrlKey: false, altKey: false, repeat: e.repeat };
  void import(motionUrl).then((m) => m.frameKey(v, k)).catch(() => {});
  return true;
}
