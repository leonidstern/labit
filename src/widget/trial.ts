// Part of the comment widget (src/comments.js bundles it). A question's choices tried in the page (its card is placed as
// every thread card is). Uses the widget's own parts through W, bound by thread.ts.
import { forgetLetters, markQuote, quoteRangeOf } from './anchoring.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let W: any;
export function bindTrial(w: unknown) {
  if (globalThis.__LAB_CO__) return;
  W = w;
}

// On quoted words (anchor.quote.exact) the rows are tried in place: the row you point at or tap puts its
// words in the page where the quoted words are, so each version is read in its sentence. Only the text nodes' data is
// changed (no node is added or removed, so the page's own scripts keep theirs), each node's old data is kept, and it
// goes back exactly: leaving the rows, closing the card, any redraw (the next one tries again), pagehide and leaving the
// page. A node the page itself changed in the meantime is left as the page made it.
type Tried = { thread: string; ask: string; n: number; nodes: { node: Text; was: string; now: string }[]; lit?: Range };
let tried: Tried | null = null;
/** The last try in place, kept over a redraw of the same card (live updates redraw it) so it can be put back. */
let keepTry: { thread: string; ask: string; n: number } | null = null;
/** Whether the page's words are swapped right now (comments.js holds its re-placing of pins meanwhile). */
export const isTrying = () => !globalThis.__LAB_CO__ && Boolean(tried);
/** The tried words wear the quote's green again (after another pin's hover showed its own words). */
export const relight = () => void (tried?.lit && typeof Highlight === 'function' && CSS.highlights?.set('lab-quote', new Highlight(tried.lit)));
/** Put the page's words back. keep: the same card is being drawn again, and tries the same row again. */
export function untry(keep = false) {
  if (globalThis.__LAB_CO__) return;
  const t = tried;
  tried = null;
  if (!keep) keepTry = null;
  if (!t) return;
  for (const { node, was, now } of t.nodes) {
    try {
      if (node.data === now) node.data = was;
    } catch {}
  }
  forgetLetters(); // the pins and the highlight find the words as they are again
  if (!keep) letGoHeight();
}
// No jump while trying (Leo, 18 Nov): the quote's block keeps the height of its tallest version until the card closes,
// so a longer version that wraps to a new line never pushes the page below it. Measured once per question, all versions
// tried and put back before the next paint.
let held: { block: HTMLElement; was: string; ask: string } | null = null;
function letGoHeight() {
  if (held) {
    held.block.style.minHeight = held.was;
    // An attribute left empty goes, so the page's markup is exactly as before (read first: an engine writes a style set
    // through .style into the attribute lazily).
    if (!held.block.getAttribute('style')) held.block.removeAttribute('style');
  }
  held = null;
}
function holdHeight(c, ask) {
  if (held?.ask === ask.id) return;
  letGoHeight();
  const range = quoteRangeOf(c.anchor);
  const block = range && (blockOf(range.startContainer) as HTMLElement | null);
  if (!block) return;
  const keep = keepTry;
  let h = block.offsetHeight;
  for (const [i, words] of (ask.choices || []).entries()) if (tryWords(c, ask, i, words)) h = Math.max(h, block.offsetHeight);
  untry(true);
  keepTry = keep;
  held = { block, was: block.style.minHeight, ask: ask.id };
  block.style.minHeight = `${h}px`;
}
/** Before every redraw (comments.js render): words back, and the try forgotten unless its thread stays open. */
export function pauseTry(openId) {
  if (globalThis.__LAB_CO__) return;
  untry(Boolean(keepTry && keepTry.thread === openId));
}
/** The open question's rows trying their row again (set by choicesEl), after the page's words changed under a try. */
let reshow: (() => void) | null = null;
/** The page's file was saved while a choice is tried (live.ts patches the page toward it): the page's words go back
 *  first, so the patch meets the words it knows and a word it writes is never undone after; then the row is tried again
 *  in the new words, if they still have the quote. */
export function aroundMorph(change: () => void) {
  if (globalThis.__LAB_CO__) return change();
  const had = Boolean(tried);
  untry(true);
  try {
    change();
  } finally {
    if (had) reshow?.();
  }
}
// No listener for script errors: one elsewhere on the page says nothing about our swap, and dropping the words then would
// leave the row selected with the page's own words showing. Every way out of a try above puts them back.
addEventListener('pagehide', () => untry());
addEventListener('pageshow', (e) => e.persisted && reshow?.()); // back from the back-forward cache: tried again
addEventListener('beforeunload', () => untry());
// Swap the quoted words for words. Returns false (and changes nothing) when the words can't be found as plain text.
function tryWords(c, ask, n: number, words: string): boolean {
  untry(true);
  try {
    const quote = quoteRangeOf(c.anchor);
    if (!quote || quote.startContainer.nodeType !== 3 || quote.endContainer.nodeType !== 3) return false;
    const all: Text[] = [];
    const walker = document.createTreeWalker(quote.commonAncestorContainer, NodeFilter.SHOW_TEXT);
    for (let t = (quote.commonAncestorContainer.nodeType === 3 ? quote.commonAncestorContainer : walker.nextNode()) as Text | null; t; t = walker.nextNode() as Text | null) {
      if (W.host.contains(t)) continue;
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
    tried = t;
    keepTry = { thread: c.id, ask: ask.id, n };
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
    forgetLetters();
    // The tried words wear the quote's green, as the quoted words did: from the quote's start (untouched) to its end,
    // which moved with the swap when it is in the last node changed.
    const lit = document.createRange();
    lit.setStart(qs, qsAt);
    lit.setEnd(qe, qe === last ? qeAt - end + (first === last ? start + middle.length : 0) : qeAt);
    t.lit = lit;
    relight();
    return true;
  } catch {
    untry();
    return false;
  }
}


// Whether this thread's question is tried in the page: on quoted words that are there now.
// Words that run across two blocks (paragraphs, list items…) are not tried: the new words would land in the first and
// pull the second's text into it, so such a question shows its rows only.
const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, td, th, figcaption, blockquote, pre, dd, dt';
const blockOf = (n: Node) => {
  const e = n.nodeType === 1 ? (n as Element) : n.parentElement;
  return e?.closest(BLOCKS) || e;
};
export function triesInPlace(c) {
  if (globalThis.__LAB_CO__) return false;
  const range = c.anchor?.quote?.exact && !c.anchor.quote.line ? quoteRangeOf(c.anchor) : null;
  return Boolean(range && blockOf(range.startContainer) === blockOf(range.endContainer));
}

// Phones: the sheet is half the screen, so the quoted line is scrolled into the part above it, on open and after each
// try. Smooth only when motion is welcome.
function quoteInView(c, card) {
  if (!W.coarse) return;
  requestAnimationFrame(() => {
    const r = (tried?.lit || quoteRangeOf(c.anchor))?.getBoundingClientRect();
    const room = card.isConnected ? card.getBoundingClientRect().top : 0;
    if (!r || !r.height || room <= 0) return;
    if (r.top < 8 || r.bottom > room - 8) scrollBy({ top: r.top - Math.max(8, (room - r.height) / 2), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
}

/** The row of this question that was tried when its card was last drawn (kept over a redraw), or null. */
export const keptRow = (ask) => globalThis.__LAB_CO__ ? null : (keepTry && keepTry.ask === ask.id ? keepTry.n : null);
/** What the open question does after the page's words changed under it or came back from the back-forward cache. */
export const onReshow = (fn: () => void) => void (reshow = fn);
/** Show a row in the page: n < 0 or words === null is the page's own words; else its words in the quoted words' place. */
export function tryRow(c, ask, n: number, words: string | null, card) {
  if (globalThis.__LAB_CO__) return;
  if (words === null) {
    untry(true);
    keepTry = { thread: c.id, ask: ask.id, n };
    markQuote(c.anchor);
  } else {
    holdHeight(c, ask);
    if (!tryWords(c, ask, n, words)) markQuote(c.anchor);
  }
  quoteInView(c, card);
}
