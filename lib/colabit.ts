// labit and colabit never share a page. colabit (co/README.md) is labit's widget for deployed sites: its own comment
// store, no agent. A site made for a colabit carries its script tag (<lab>/_lab/co.js), and when a labit lab on this
// computer serves that site the page would get two comment layers, with pins split between two stores. So the lab takes
// colabit's tag out of every page it serves (here), and colabit's script stays off where it finds a lab's widget and
// says so in the console (src/comments.js). Nothing is moved or merged between the two stores. (No note of the lab's
// own here: the package is at its size cap.)

// The lab's own widget tag (a page made for the lab may load it itself; the lab adds its own) and colabit's, wherever
// either is loaded from, with or without a query or hash on its address.
const TAGS = /<script\b[^>]*?\ssrc=["'][^"']*\/_lab\/(?:comments|co)\.js(?:[?#][^"']*)?["'][^>]*>\s*<\/script>\s*/gi;

// The page without either tag.
export const stripTags = (html: string): string => html.replace(TAGS, '');
