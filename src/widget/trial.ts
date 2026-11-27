// Part of the comment widget (src/comments.js bundles it). A question's choices tried in the page (its card is placed as
// every thread card is). Uses the widget's own parts through W, bound by thread.ts. The swap itself (the words, the
// block's height) is its own file, tryout.ts (public/_lab/tryout.js), loaded once a card offers rows to try in place.
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
export type Tried = { thread: string; ask: string; n: number; nodes: { node: Text; was: string; now: string }[]; lit?: Range };
// tried: the words swapped now. keep: the last try in place, kept over a redraw of the same card (live updates redraw
// it) so it can be put back.
const st: { tried: Tried | null; keep: { thread: string; ask: string; n: number } | null } = { tried: null, keep: null };
/** Whether the page's words are swapped right now (comments.js holds its re-placing of pins meanwhile). */
export const isTrying = () => !globalThis.__LAB_CO__ && Boolean(st.tried);
/** The tried words wear the quote's green again (after another pin's hover showed its own words). */
export const relight = () => void (st.tried?.lit && typeof Highlight === 'function' && CSS.highlights?.set('lab-quote', new Highlight(st.tried.lit)));
// The swap (tryout.ts), once loaded; asked counts the calls that change what is tried, so a try that waited for the file
// is dropped when another came meanwhile.
let swap: typeof import('./tryout.ts') | null = null;
let loading: Promise<unknown> | null = null;
let asked = 0;
const load = () => (loading ??= W.part('tryout').then((m: typeof import('./tryout.ts')) => {
  m.bind({ W, st, untry, relight, forgetLetters, quoteRangeOf, blockOf });
  swap = m;
}, () => {}));
export type Ctx = { W: typeof W; st: typeof st; untry: typeof untry; relight: typeof relight; forgetLetters: typeof forgetLetters; quoteRangeOf: typeof quoteRangeOf; blockOf: typeof blockOf };
/** Put the page's words back. keep: the same card is being drawn again, and tries the same row again. */
export function untry(keep = false) {
  if (globalThis.__LAB_CO__) return;
  asked++;
  const t = st.tried;
  st.tried = null;
  if (!keep) st.keep = null;
  if (!t) return;
  swap?.putBack(t); // only the swap sets tried
  if (!keep) swap?.letGoHeight();
}
/** Before every redraw (comments.js render): words back, and the try forgotten unless its thread stays open. */
export function pauseTry(openId) {
  if (globalThis.__LAB_CO__) return;
  untry(Boolean(st.keep && st.keep.thread === openId));
}
/** The open question's rows trying their row again (set by choicesEl), after the page's words changed under a try. */
let reshow: (() => void) | null = null;
/** The page's file was saved while a choice is tried (live.ts patches the page toward it): the page's words go back
 *  first, so the patch meets the words it knows and a word it writes is never undone after; then the row is tried again
 *  in the new words, if they still have the quote. */
export function aroundMorph(change: () => void) {
  if (globalThis.__LAB_CO__) return change();
  const had = Boolean(st.tried);
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
  const yes = Boolean(range && blockOf(range.startContainer) === blockOf(range.endContainer));
  if (yes) void load(); // fetched as the card is drawn: the swap is here before a row is pointed at or tapped
  return yes;
}

// Phones: the sheet is half the screen, so the quoted line is scrolled into the part above it, on open and after each
// try. Smooth only when motion is welcome.
function quoteInView(c, card) {
  if (!W.coarse) return;
  requestAnimationFrame(() => {
    const r = (st.tried?.lit || quoteRangeOf(c.anchor))?.getBoundingClientRect();
    const room = card.isConnected ? card.getBoundingClientRect().top : 0;
    if (!r || !r.height || room <= 0) return;
    if (r.top < 8 || r.bottom > room - 8) scrollBy({ top: r.top - Math.max(8, (room - r.height) / 2), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
}

/** The row of this question that was tried when its card was last drawn (kept over a redraw), or null. */
export const keptRow = (ask) => globalThis.__LAB_CO__ ? null : (st.keep && st.keep.ask === ask.id ? st.keep.n : null);
/** What the open question does after the page's words changed under it or came back from the back-forward cache. */
export const onReshow = (fn: () => void) => void (reshow = fn);
/** Show a row in the page: n < 0 or words === null is the page's own words; else its words in the quoted words' place. */
export function tryRow(c, ask, n: number, words: string | null, card) {
  if (globalThis.__LAB_CO__) return;
  if (words === null) {
    untry(true);
    st.keep = { thread: c.id, ask: ask.id, n };
    markQuote(c.anchor);
  } else if (swap) {
    asked++;
    swap.holdHeight(c, ask);
    if (!swap.tryWords(c, ask, n, words)) markQuote(c.anchor);
  } else {
    // Not here yet (it is asked for as the card is drawn, so this is rare): tried once it is, unless something else was
    // tried or put back meanwhile (a card that closes puts the words back: pauseTry).
    const mine = ++asked;
    return load().then(() => swap && mine === asked && tryRow(c, ask, n, words, card));
  }
  quoteInView(c, card);
}
