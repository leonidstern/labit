// Text the lab puts into the agent's words is cut to a size, and a cut by count can fall inside a letter: half of an
// emoji (a lone surrogate, which prints as U+FFFD), a flag or a family cut to its first part, a letter without its accent.
// One place cuts, at a boundary a person would see as one character (grapheme); `whole` mends a string somebody else cut.

const SEGMENTS = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
// A surrogate with no partner: the first half of a pair with nothing after it, or the second half with nothing before it.
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * The string without halves of characters (a lone surrogate, where a cut by count fell inside an emoji).
 * @param {string} s
 */
export const whole = (s) => s.replace(LONE, '');

/**
 * At most `max` UTF-16 units of `s`, ending where a character ends (an emoji, a flag, a letter with its accents stay whole).
 * @param {string} s
 * @param {number} max
 */
export function cut(s, max) {
  if (s.length <= max) return whole(s);
  let out = '';
  // (Only the start is looked at, so a very long string costs no more than a short one.)
  for (const { segment } of SEGMENTS.segment(s.slice(0, max + 64))) {
    if (out.length + segment.length > max) break;
    out += segment;
  }
  // One character longer than the whole room (a letter under a hundred accents): by code points, never through a pair.
  return whole(out || s.slice(0, max));
}
