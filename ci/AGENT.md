# Instructions for the labit improvement agent

You improve one metric per run. A deterministic judge (ci/metrics.mjs) decides, not you.

- Make the smallest change that improves the target metric.
- Nothing else may get worse: script size, package size, lint problems, tests.
- labit has zero dependencies. Keep it that way: no packages. The page script's source is `src/comments.js` and its modules in
  `src/widget/` (TypeScript, and the stylesheet as `styles.css`). `npm run build` (scripts/build-widget.mjs) bundles them into
  `public/_lab/comments.js`, minified, the stylesheet too. Never edit the generated file by hand; read and change `src/`.
- Don't change behaviour. Pins, comments, the agent link and local mode must work exactly as before.
  `npm test` must pass. If a change could alter behaviour that tests don't cover, skip it.
- Fix causes. Never add lint-disable comments, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `{any}` or `{*}` types,
  or `!important`. Patches that do are rejected.
- Types are JSDoc comments in plain JS (`npm run typecheck` lists the errors). Give the real type:
  `/** @type {HTMLTextAreaElement} */ (card.querySelector('.reply'))`, `/** @param {string} page */`.
- Don't edit tests, `bench/`, `ci/`, `.github/`, `tsconfig.json`, `package.json`, `README.md` or `CHANGELOG.md`.
  Patches that do are rejected.
- Before you finish, run `npm test` (it builds the page script first; the built files in `public/_lab/` are not kept in git) and `node --check` on every file you changed.
- End with one short paragraph: what you changed and why it can't change behaviour.

## The release waste review (a second, read-only agent)

Not part of the improvement loop above: on each release tag (`vX.Y.Z`), `waste.yml` runs `ci/waste.mjs` (`npm run waste`) and
makes a report of what the gate can't see: duplicated blocks (jscpd, 30+ tokens), functions over 150 lines, unused CSS
custom properties, listeners added on every redraw, state written and never read, and the page script's gzip size against its
cap with the files that make it up. Report-only; it fails only when `comments.js` is over its cap.

`ci/waste-review.sh [tag]` then hands that report to a reviewer (`ci/waste-review.md` is its prompt: dead code, duplicates,
leftovers, listeners per redraw, big functions, lazy-part candidates with gzip estimates). Same setup as the other agents here:
run from your machine, logged-in `claude` and `gh`, `MODEL` defaults to `claude-opus-5-5`, no API keys, no secrets in CI. The
reviewer gets `Read,Grep,Glob` only, in a checkout of the tag; it can't edit, build or run anything, and its estimates are
labelled estimates. Findings go to `waste-review.md`, the job summary when run in one, and **one issue per tag**
("Page-script waste review: vX.Y.Z"); never a PR. `NO_ISSUE=1` keeps it to the file.

To run the reviewer inside CI instead, add a step to `waste.yml` that installs claude and runs `ci/waste-review.sh`; that needs
a repository secret (an Anthropic API key or a Claude OAuth token), which no workflow uses today.

## Learned rules

<!-- Added by the weekly meta loop (ci/meta-improve.sh) and approved by a human. -->
