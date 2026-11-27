// Part of the comment widget (src/comments.js bundles it).
//
// A message list that stays at its newest while it gets shorter (the phone's keyboard coming up as you write), and
// stays put once you scroll back to read. Used by the chat and by a thread.
//
// Whether you're "at the newest" is decided only by scrolls you make, not by the list changing size: Safari fires a
// scroll event as the list shrinks under the keyboard, before the resize is reported, and that scroll (100 px from the
// end, through no move of yours) used to say "scrolled back", so the list was left with the last message under the
// box (Leo's iPhone, 19 Nov: clientHeight 476 → 376, scrollTop unchanged).
export function stickToEnd(list: HTMLElement, on = true) {
  let stick = on;
  let h = list.clientHeight;
  // Set now and once more on the next frame: Safari can drop a scroll set while the keyboard is still sliding.
  const end = () => {
    list.scrollTop = list.scrollHeight;
    requestAnimationFrame(() => stick && (list.scrollTop = list.scrollHeight));
  };
  const fit = () => {
    if (list.clientHeight === h) return false;
    h = list.clientHeight;
    if (stick) end();
    return true;
  };
  list.addEventListener('scroll', () => {
    if (fit()) return; // the list changed size: not a scroll of yours
    stick = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
  }, { passive: true });
  new ResizeObserver(fit).observe(list);
  return {
    /** Go to the newest and stay there. */
    pin() {
      stick = true;
      h = list.clientHeight;
      end();
    },
  };
}
