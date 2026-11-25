// labit and colabit never share a page. colabit (co/README.md) is labit's widget for deployed sites: its own comment
// store, no agent. A site made for a colabit carries its script tag (<lab>/_lab/co.js), and when a labit lab on this
// computer serves that site the page would get two comment layers, with pins split between two stores. So the lab takes
// colabit's tag out of every page it serves (here) and says so in the console, and colabit's script stays off where it
// finds a lab's widget (src/comments.js). Nothing is moved or merged between the two stores.

// colabit's script tag, wherever the colabit lives, with or without a query or hash on its address.
const TAG = /<script\b[^>]*\bsrc=["'][^"']*\/_lab\/co\.js(?:[?#][^"']*)?["'][^>]*>\s*<\/script>\s*/gi;

// Said once on a page the lab took colabit out of, so a person who expected colabit's pill knows where it went.
export const COLABIT_OFF =
  '<script>console.info("[lab] colabit is off on this page: a labit lab serves it, and pins stay in the lab.")</script>\n';

// The page without colabit's tag, and whether it had one.
export function withoutColabit(html: string): { html: string; off: boolean } {
  const out = html.replace(TAG, '');
  return { html: out, off: out !== html };
}
