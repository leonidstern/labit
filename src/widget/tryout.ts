// A question's choice tried in the page, in its own file (public/_lab/tryout.js, scripts/build-widget.mjs): the swap of
// the quoted words for a choice's, putting them back, and the block's height held while trying. trial.ts keeps what a
// card reads as it is drawn and loads this once a card offers its rows to try in place (before any row is pointed at).
// What it uses of the page script comes through bind, so nothing of it is built in twice.
import type { Ctx, Tried } from './trial.ts';

let C: Ctx;
export const bind = (c: Ctx) => void (C = c);

/** Each swapped node's words back, unless the page changed them meanwhile. */
export function putBack(t: Tried) {
  for (const { node, was, now } of t.nodes) {
    try {
      if (node.data === now) node.data = was;
    } catch {}
  }
  C.forgetLetters(); // the pins and the highlight find the words as they are again
}
// No jump while trying (Leo, 18 Nov): the quote's block keeps the height of its tallest version until the card closes,
// so a longer version that wraps to a new line never pushes the page below it. Measured once per question, all versions
// tried and put back before the next paint.
let held: { block: HTMLElement; was: string; ask: string } | null = null;
export function letGoHeight() {
  if (held) {
    held.block.style.minHeight = held.was;
    // An attribute left empty goes, so the page's markup is exactly as before (read first: an engine writes a style set
    // through .style into the attribute lazily).
    if (!held.block.getAttribute('style')) held.block.removeAttribute('style');
  }
  held = null;
}
export function holdHeight(c, ask) {
  if (held?.ask === ask.id) return;
  letGoHeight();
  const range = C.quoteRangeOf(c.anchor);
  const block = range && (C.blockOf(range.startContainer) as HTMLElement | null);
  if (!block) return;
  const keep = C.st.keep;
  let h = block.offsetHeight;
  for (const [i, words] of (ask.choices || []).entries()) if (tryWords(c, ask, i, words)) h = Math.max(h, block.offsetHeight);
  C.untry(true);
  C.st.keep = keep;
  held = { block, was: block.style.minHeight, ask: ask.id };
  block.style.minHeight = `${h}px`;
}
// Swap the quoted words for words. Returns false (and changes nothing) when the words can't be found as plain text.
export function tryWords(c, ask, n: number, words: string): boolean {
  C.untry(true);
  try {
    const quote = C.quoteRangeOf(c.anchor);
    if (!quote || quote.startContainer.nodeType !== 3 || quote.endContainer.nodeType !== 3) return false;
    const all: Text[] = [];
    const walker = document.createTreeWalker(quote.commonAncestorContainer, NodeFilter.SHOW_TEXT);
    for (let t = (quote.commonAncestorContainer.nodeType === 3 ? quote.commonAncestorContainer : walker.nextNode()) as Text | null; t; t = walker.nextNode() as Text | null) {
      if (C.W.host.contains(t)) continue;
      if (quote.intersectsNode(t)) all.push(t);
    }
    if (!all.length) return false;
    // Only the words that differ are swapped: whole words the quote and the choice share at either end stay where they
    // are, so the link, <em> or <code> they sit in keeps them ("the full guide" → "this short guide": "guide" stays the link).
    const text = quote.toString();
    const like = (a: string, b: string) => a === b || (/\s/.test(a) && /\s/.test(b));
    let head = 0;
    while (head < text.length && head < words.length && like(text[head], words[head])) head++;
    while (head > 0 && !/\s/.test(text[head - 1])) head--; // at a word's start
    let tail = 0;
    while (tail < text.length - head && tail < words.length - head && like(text[text.length - 1 - tail], words[words.length - 1 - tail])) tail++;
    while (tail > 0 && !/\s/.test(text[text.length - tail - 1])) tail--; // from a word's start (its space is swapped)
    // The quote's k-th letter as [its text node, the place in it]. At a node's edge, the start is in the later node and
    // the end in the earlier one, so new words go where the words they replace were.
    const at = (k: number, end: boolean): [Text, number] => {
      for (const node of all) {
        const from = node === quote.startContainer ? quote.startOffset : 0;
        const to = node === quote.endContainer ? quote.endOffset : node.length;
        if (end ? k <= to - from : k < to - from) return [node, from + k];
        k -= to - from;
      }
      return [quote.endContainer as Text, quote.endOffset];
    };
    const [first, start] = at(head, false);
    // Nothing of the quote replaced (the choice only adds words): the new ones go in at that one place.
    const [last, end] = head === text.length - tail ? [first, start] : at(text.length - tail, true);
    const middle = words.slice(head, words.length - tail);
    const nodes = all.slice(all.indexOf(first), all.indexOf(last) + 1);
    // Read before the swap: a live Range's places in a text node reset when its data is set.
    const [qs, qsAt, qe, qeAt] = [quote.startContainer as Text, quote.startOffset, quote.endContainer as Text, quote.endOffset];
    const t: Tried = { thread: c.id, ask: ask.id, n, nodes: [] };
    C.st.tried = t;
    C.st.keep = { thread: c.id, ask: ask.id, n };
    for (const node of nodes) {
      const was = node.data;
      const now =
        node === first && node === last ? was.slice(0, start) + middle + was.slice(end)
        : node === first ? was.slice(0, start) + middle
        : node === last ? was.slice(end)
        : '';
      t.nodes.push({ node, was, now });
      node.data = now;
    }
    C.forgetLetters();
    // The tried words wear the quote's green, as the quoted words did: from the quote's start (untouched) to its end,
    // which moved with the swap when it is in the last node changed.
    const lit = document.createRange();
    lit.setStart(qs, qsAt);
    lit.setEnd(qe, qe === last ? qeAt - end + (first === last ? start + middle.length : 0) : qeAt);
    t.lit = lit;
    C.relight();
    return true;
  } catch {
    C.untry();
    return false;
  }
}
