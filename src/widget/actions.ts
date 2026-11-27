// Action buttons: an element on the page with data-lab-action="merge #224" is an action. With comments on,
// a click or a tap on it opens a new comment on it, its words already in the box (and data-lab-action-note after them);
// the person sends it, and the agent reads "action: merge #224". data-lab-confirm marks one the agent confirms first.
// Part of the comment widget (src/comments.js bundles it). Uses the widget's own parts through W, set once at startup.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function bindActions(W: any) {
  addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-lab-action]') : null;
    const act = t?.dataset.labAction?.trim();
    if (!t || !act || !W.S.on || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.composedPath().includes(W.host)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const r = t.getBoundingClientRect();
    const anchor = W.anchorAt(r.left + 2, r.top + 2); // its top left corner: the pin stands above the button, not on it
    anchor.act = act.slice(0, 120);
    if (t.hasAttribute('data-lab-confirm')) anchor.confirm = true;
    const note = t.dataset.labActionNote?.trim();
    // The new comment's box starts with these words, unless words not yet sent are in it: those stay.
    const key = `lab-typing:${W.S.page}:new`;
    if (!W.store.get(key)?.trim()) W.store.set(key, note ? `${act}\n${note}` : act);
    W.S.openId = null;
    W.begin(anchor);
  }, true);
}
