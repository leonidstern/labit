// Part of the comment widget (src/comments.js bundles it). Uses the widget's own parts through W, set once at startup.
//
// The Shift and Alt keys: Shift (drag to quote words) with its cursor, and Alt (Option) with its crosshair.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let W: any;
let S: any; // the widget's state (W.S), read once at startup
// The Shift cursor (lab-shift-cur) follows the key exactly, with no such wait: let go of Shift and the pin pointer is back
// at once (Leo, 18 Nov). Browsers repaint a still pointer's cursor only when the page under it changes, so the element
// under it gets a same-frame style flip.
const shiftCur = (on) => {
  const de = document.documentElement;
  if (de.classList.contains('lab-shift-cur') === on) return;
  de.classList.toggle('lab-shift-cur', on);
  const t = S.mouse && document.elementFromPoint(S.mouse.x, S.mouse.y);
  if (t instanceof HTMLElement) {
    const was = t.style.cursor;
    t.style.cursor = 'default';
    void t.offsetWidth;
    t.style.cursor = was;
  }
  W.recheck();
};
const shiftKey = (e) => {
  if (e.key === 'Shift') S.shiftUp = e.type === 'keyup';
  clearTimeout(S.shiftOff);
  shiftCur(e.shiftKey);
  if (e.shiftKey) document.documentElement.classList.add('lab-shift');
  else S.shiftOff = setTimeout(() => (document.documentElement.classList.remove('lab-shift'), W.recheck()), 400);
};
const setAlt = (down) => (document.documentElement.classList.toggle('lab-alt', Boolean(down)), W.host.toggleAttribute('data-lab-alt', Boolean(down))); // the bar's arrow lights while it's held
export function bindKeys(w: unknown) {
  W = w;
  S = W.S;
  // Letting go of Shift keeps text selectable a moment longer, so a selection made with it isn't dropped before its
  // comment opens.
  S.shiftOff = 0;
  // Shift's own key events are the truth for "is Shift held": right after a Shift keyup, Linux WebKit can still send the
  // next press with shiftKey set, which kept text selectable for a plain click (a CI-only flake). Shift pressed in
  // another window (no keydown seen here) still counts, as shiftUp stays false.
  S.shiftUp = false;
  addEventListener('keydown', shiftKey, true);
  addEventListener('keyup', shiftKey, true);
  addEventListener('pointermove', (e) => shiftCur(e.shiftKey && !S.shiftUp), { capture: true, passive: true }); // Shift pressed or let go while another window had focus
  document.addEventListener('visibilitychange', () => shiftCur(false));
  // A press without Shift is never a selection: drop the Shift state at once, not 400 ms later (a click right after typing
  // a capital letter, or after a screenshot shortcut, used to select the page's text).
  addEventListener('pointerdown', (e) => {
    // A Shift press on the page starts new words: the caret a box of the widget leaves (at the widget, the page's end)
    // stretched the selection from there instead, and the next quote after a comment came to nothing.
    if (e.shiftKey && !S.shiftUp) return S.on && !W.typing(e) && getSelection()?.removeAllRanges(), shiftKey(e);
    clearTimeout(S.shiftOff);
    document.documentElement.classList.remove('lab-shift');
    shiftCur(false);
  }, true);
  addEventListener('blur', () => ((S.shiftUp = false), document.documentElement.classList.remove('lab-shift'), shiftCur(false)));
  // The same, for engines that start a selection before restyling after the press (Linux WebKit kept one now and then):
  // in comment mode, a selection on the page starts only with Shift; fields and the widget select as always.
  addEventListener('selectstart', (e) => {
    const de = document.documentElement;
    const t = (e.target instanceof Element ? e.target : (e.target as Node)?.parentElement ?? null) as Element | null;
    if (W.host.hasAttribute('data-lab-pinning') && !de.classList.contains('lab-shift') && !t?.closest('input, textarea, select, [contenteditable], [data-lab-comments]')) e.preventDefault();
  }, true);
  addEventListener('keydown', (e) => e.key === 'Alt' && setAlt(true), true);
  addEventListener('keyup', (e) => e.key === 'Alt' && setAlt(false), true);
  addEventListener('pointermove', (e) => setAlt(e.altKey), { capture: true, passive: true }); // Option pressed while another window had focus
  addEventListener('blur', () => setAlt(false));
}
