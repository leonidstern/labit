// Phones: which taps act on the finger's lift instead of on the click iOS makes of them (comments.js). A pin (not one
// being dragged, nor a drawing's, which takes no touches) and the dimmed page under a sheet.

/** How far a finger may wander in a tap, px: a pin's drag starts past 5 (thread.ts grab), so a tap is under it. */
export const TAP_SLOP = 5;
/** How long a tap may last, ms: a hold on a pin is its drag, and iOS's own long press starts at ~500. */
export const TAP_MS = 350;

type Down = { x: number; y: number; t: number };
/** Whether a touch that went down at `down` and is now at (x, y), at time `now`, is still a tap. */
export const isTap = (down: Down, x: number, y: number, now: number): boolean => Math.hypot(x - down.x, y - down.y) <= TAP_SLOP && now - down.t <= TAP_MS;

/** Follows the touch that `e` started, on `at` (its moves and lift; `o` adds to each listener's options), and calls `tap`
 *  with its lift if it was a tap: one finger, still, short. A move past the slop or a cancel lets it go. */
export const followTap = (e: TouchEvent, at: EventTarget, tap: (lift: TouchEvent) => void, o: AddEventListenerOptions = {}) => {
  const t = e.changedTouches[0];
  const down = { x: t.clientX, y: t.clientY, t: performance.now() };
  const ac = new AbortController();
  const mine = (ev: TouchEvent) => [...ev.changedTouches].find((x) => x.identifier === t.identifier);
  const on = (type: string, f: (ev: TouchEvent) => void, passive = true) => at.addEventListener(type, f as EventListener, { ...o, passive, signal: ac.signal });
  on('touchmove', (ev) => { const m = mine(ev); if (m && !isTap(down, m.clientX, m.clientY, down.t)) ac.abort(); });
  on('touchend', (ev) => {
    const m = mine(ev);
    if (!m) return;
    ac.abort();
    if (!ev.touches.length && isTap(down, m.clientX, m.clientY, performance.now())) tap(ev);
  }, false); // the tap may stop its lift's default (the click iOS would send)
  on('touchcancel', () => ac.abort());
};

/** The pin or dimmed page a touch began on (its composed path), or null. */
export const liftTarget = (path: EventTarget[]): HTMLElement | null => {
  for (const n of path as HTMLElement[]) {
    if (!n?.classList) continue; // the shadow root, the document, the window
    if (n.classList.contains('scrim')) return n;
    if (n.localName === 'button' && n.classList.contains('pin')) return n.classList.contains('dragging') || n.classList.contains('ink') ? null : n;
    if (n.hasAttribute?.('data-lab-comments')) return null;
  }
  return null;
};
