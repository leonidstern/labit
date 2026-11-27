// A block named in a message (a #id link, anchoring.ts linked), in its own file (public/_lab/goto.js,
// scripts/build-widget.mjs): the page script loads it on the first such link followed (lab-goto in src/comments.js).
// host: the widget's own element; hold: how long the mark stays (2 × the hold token, anchoring.ts ms).

// The block's heading in view with room above, and outlined for a moment. On the element itself
// (the widget's layer is redrawn as comments arrive, which would drop an outline drawn there).
export function goToBlock(e: Element, host: HTMLElement, hold: number) {
  const r = e.getBoundingClientRect();
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  scrollTo({ top: Math.max(0, r.top + scrollY - 24), behavior: still ? 'auto' : 'smooth' });
  // A heading wears the half ink of words for a moment, not a box (Leo, 19 Nov: "green ink on
  // header not green box after click"): a band under the lower 44 % of each line of its words, green at 30 % (45 % on
  // dark), corners 3 px. In the page's own coordinates, so it scrolls with the heading; gone when it has faded.
  if (/^H[1-6]$/.test(e.tagName)) {
    const range = document.createRange();
    range.selectNodeContents(e);
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const green = getComputedStyle(host).getPropertyValue('--_green-fg').trim();
    const ink = document.createElement('div'); // in the widget's shadow root: a page's i, div or * rules don't reach it
    ink.setAttribute('aria-hidden', 'true');
    ink.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483646';
    for (const l of range.getClientRects()) {
      if (!l.width || !l.height) continue;
      const b = document.createElement('i');
      b.style.cssText = `position:absolute;left:${l.left + scrollX}px;top:${l.top + scrollY + l.height * 0.526}px;width:${l.width}px;height:${l.height * 0.44}px;border-radius:3px;background:color-mix(in srgb, ${green} ${dark ? 45 : 30}%, transparent)`;
      ink.append(b);
    }
    if (ink.childElementCount) {
      host.shadowRoot!.append(ink);
      const a = ink.animate([{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: hold });
      a.onfinish = a.oncancel = () => ink.remove();
      return;
    }
  }
  const ring = `2px solid ${getComputedStyle(host).getPropertyValue('--_green').trim()}`;
  e.animate([{ outline: ring, outlineOffset: '4px' }, { outline: ring, outlineOffset: '4px', offset: 0.7 }, { outline: '2px solid transparent', outlineOffset: '4px' }], { duration: hold });
}
