// Phones: which taps act on the finger's lift instead of on the click iOS makes of them (comments.js). A pin (not one
// being dragged, nor a drawing's, which takes no touches) and the dimmed page under a sheet.

/** How far a finger may wander in a tap, px: a pin's drag starts past 5 (thread.ts grab), so a tap is under it. */
export const TAP_SLOP = 5;
/** How long a tap may last, ms: a hold on a pin is its drag, and iOS's own long press starts at ~500. */
export const TAP_MS = 350;

type Down = { x: number; y: number; t: number };
/** Whether a touch that went down at `down` and is now at (x, y), at time `now`, is still a tap. */
export const isTap = (down: Down, x: number, y: number, now: number): boolean => Math.hypot(x - down.x, y - down.y) <= TAP_SLOP && now - down.t <= TAP_MS;

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
