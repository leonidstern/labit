# Review of the page script for waste and code quality (read-only)

You review labit's page script, the code every commented page loads: `src/comments.js`, its modules in `src/widget/*.ts`,
the stylesheet `src/widget/styles.css`. You change nothing: you read, and you write a report. A deterministic check,
`ci/waste.mjs`, already ran; its report is below. Start from it, then read the code it points at and look for what a
tool can't see.

Scope, in the order that pays:

1. Dead code and leftovers: code nothing reaches (flags nobody can switch, a feature that was removed but its scaffold
   stayed), state written and never read, CSS properties and rules nothing uses, comments that describe code that is gone,
   names from an old design (a list that is now a chat), arguments a function ignores, over-defensive checks for things
   the widget already requires.
2. Duplicates: the same thing written two or more ways (modifier keys tracked in several places, "is something typed",
   clamping, reduced-motion checks, the same regex or hash twice, two copies of one message bubble). The exact-clone list
   in the report finds only literal copies; look for the same logic with other names.
3. Listeners and timers per redraw: `addEventListener` (or a timer, an observer) created inside a function that runs on
   every render and never removed, on something that outlives the redraw. Confirm each one the report lists by reading
   the call path (names can collide, so some are false leads: say which). Look for ones the heuristic missed.
4. Big functions: for each function the report lists, say whether it splits along a real seam and where, in one line.
   Don't propose splitting for its own sake.
5. Lazy-part candidates: code that every page downloads but few use, that could load on first use through the existing
   `part(name)` mechanism (see `PARTS` in `scripts/build-widget.mjs`). Use the report's gzip estimates per file and say
   which numbers are estimates. A candidate needs a trigger (what loads it) and a note on what calls into it synchronously.
6. Per-render cost: quadratic work, repeated storage reads, layout reads inside loops.

Rules:

- Evidence only. Every finding names `file:line`, quotes the one line that proves it, and says how sure you are. If you
  didn't verify it, say "unverified". Never invent a line number or a byte count.
- Savings: say "gzip est." and give the arithmetic basis (from the report's contributor table); never present an
  estimate as a measurement. You may not edit files or build, so you can't measure.
- The page script is capped at 80 KB gzip and sits near it; bytes matter, but behaviour matters more. Mark any change that
  could alter behaviour as a risk and say which test covers it (`test/browser/*.mjs`).
- Don't repeat the report's tables; refer to them. Don't list style preferences.

Output (markdown, nothing before the first heading, under 6000 words):

## Verdict
Three sentences: how much waste there is, the top three things to do, the gzip headroom.

## Findings
A table ordered by value over effort: `#`, finding, `file:line`, saves (gzip est. or "none, CPU"), effort (XS/S/M/L), risk.

## Details
One short section per finding in the table: what, proof (the quoted line), the fix in two or three lines, risk and the test that covers it.

## Checked and clean
One line per scope item above where you looked and found nothing.

# The waste report (input, not for you to repeat)
