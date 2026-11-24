# ci/: a deterministic gate, plus an agent that works to it

Agents propose. A deterministic judge decides. You merge. CI has no secrets.

## The gate (`.github/workflows/gates.yml`)

Every PR, forks included, is measured against its own base commit. Takes seconds; tests stay in `test.yml`.

| Metric | Rule | Why |
|---|---|---|
| `pageScriptGzipBytes` | may grow 2 KB per PR, never past 80 KB | every commented page loads `comments.js` |
| `npmPackBytes` | may grow 4 KB per PR, never past 190 KB | what `npx` users download |
| `oxlintProblems` | never more | pinned `oxlint@1.93.0` over lib, api, local.mjs, src/comments.js |
| `typeErrors` | never more | TypeScript (pinned 5.9.3) over the plain JS via `tsconfig.json`; `npm run typecheck` lists them |
| `staleBuild` | must be 0 | `public/_lab/comments.js` must equal a fresh `npm run build` of `src/comments.js` |
| `runtimeDependencies` | never more (it's 0) | the README promises none |
| `readmeClaimsWrong` | never more | the README's size and file-count claims vs what was measured |

- Over a per-PR budget on purpose? Add the `size-approved` label. Hard caps still apply;
  raising one means editing `ci/metrics.mjs`.
- Both sides are measured with the **base** branch's `ci/`, so a PR can't change how it's judged.
- Both sides use the **PR's** `.oxlintrc.json`, so adding a rule doesn't fail the PR that adds it.

## Tests (`.github/workflows/test.yml`)

Built so a PR, mostly opened by agents, hears back in about 3 minutes, and a failure says what broke.

- **Only what the PR can break.** `ci/affected.mjs` picks the browser tests from the files a PR changes (the plan job's
  summary says why). Docs and CI-only PRs run none; a release runs all of them in both engines.
- **The reach map.** `reach.yml` runs every browser test in Chromium on a GitHub runner after each code merge to main
  (`ci/reach.mjs`) and keeps which lines of `src/`, `local.mjs` and `lib/` each one ran, and which widget CSS
  classes it showed. A PR's change to those files runs the tests that reached its changed lines or CSS rules. Every
  test runs when the map can't say: no map, a widget line no test ran (it may be WebKit's alone), a CSS change with
  no class in it. A server line no browser test runs is left to the unit tests. Locally: `node ci/reach.mjs` writes
  `ci/reach-map.json`, which `ci/affected.mjs` and `npm run check` use.
- **Even shards.** `ci/browser-tests.json` lists every browser test CI runs with its WebKit time on a CI runner (seconds).
  The plan packs the picked tests into shards of about 2 minutes, up to 10 jobs at once. A new browser test goes in
  this list, or it never runs in CI; refresh a time from a run's log ("<test> took N s") when it drifts.
- **Unit tests in three jobs** (`node --test-shard`).
- **Failures by name.** `ci/unit-run.mjs` and `ci/browser-run.mjs` put each failing test, with its error or its FAIL
  lines, on the PR's checks page (at the file and line) and in the job summary.
- **One retry, then quarantine.** A browser file that fails runs once more (a warning). One that keeps failing on
  timing, not on a real break, can go in `ci/flaky.json` (`{"areacard": "#123: card opens late on a busy Mac"}`): it
  still runs, but its failure is a warning. Keep the list short and fix what is in it: a quarantined test guards nothing.
- **The same before a push.** `npm run check` runs the quick checks, the unit tests and the browser tests CI would pick
  for your changes against origin/main (WebKit, needs `npm i --no-save playwright@1.65.1`; `--no-browser` skips them).

## Waste check (`.github/workflows/waste.yml`)

On every release tag (and on demand), `npm run waste` reports duplicated blocks, long functions, unused CSS custom
properties, listeners added per redraw, state nothing reads, and the page script's gzip size with its biggest files. It
only reports; it fails when `comments.js` is over its gzip cap. `ci/waste-review.sh` adds an AI review of the report (see AGENT.md).

## The agent (run from your machine, from an up-to-date main)

```bash
ci/agent-improve.sh --pr 31   # fix what makes PR #31 fail the gate, push to it
ci/agent-improve.sh           # improve one metric, open a PR
ci/meta-improve.sh            # weekly: repeated review feedback → lint rules, as a PR
```

Needs `gh` and `claude` logged in; no API keys. Every run prints a folder with its prompts, patches
and logs. The agent must pass the gate *and* `npm test` *and* move its target. It can't edit
`ci/`, tests, `bench/`, `package.json` or the README, and can't add lint suppressions.
Dependency and README-claim failures are left to you.

## Numbers when this was set up (2026-11-16)

| | before | now |
|---|---|---|
| `comments.js` gzipped | 67.7 KB | 49.4 KB (code comments stripped from the shipped file; minified with its stylesheet since, see the CHANGELOG) |
| npm package | 139 kB | 121 kB, 11 files |
| oxlint problems | 27 | 0 |
| type errors | — | 180 (from here only down) |
| runtime dependencies | 0 | 0 |
| README claims that don't match | 4 | 0 |

## Native features (`ci/native.mjs`, in `test.yml`)

What Safari's engine (WebKit) and Chrome's (Chromium) can do natively that labit could use: 36 features (anchor
positioning, popover, invoker commands, field-sizing, scroll-driven animations, `if()`, customizable select…), each
probed in both engines and searched for in `src/`. The table goes to the job's summary, with two lists: in both
engines and not used yet (candidates), and used but missing in an engine. Only the second fails the job. Run it
locally with `node ci/native.mjs` (needs playwright). A new candidate is one line in `FEATURES`.
