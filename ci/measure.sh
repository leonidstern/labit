#!/usr/bin/env bash
# Measure one tree. The same steps run in CI and locally.
#
#   ci/measure.sh <tree> <out.json> [<ruler-tree>]
#
# ruler-tree: take tsconfig.json and .oxlintrc.json from here, so base and PR are checked with the same rules.
#             A PR that adds a rule then isn't blamed for problems that already existed. There is no .oxlintrc.json
#             yet (oxlint's defaults); ci/meta-improve.sh may add one, so it is copied (or removed) like tsconfig.json.
# JUDGE_METRICS: which metrics.mjs to use (CI and the agent pass a trusted copy).
# RUN_TESTS=1: also run npm test first (the agent loop does; in CI, test.yml does).
set -euo pipefail

abs() { case "$1" in /*) echo "$1" ;; *) echo "$PWD/$1" ;; esac; }

TREE="$(cd "$1" && pwd)"
OUT="$(abs "$2")"
RULER="${3:+$(cd "$3" && pwd)}"
JUDGE_METRICS="$(abs "${JUDGE_METRICS:-$TREE/ci/metrics.mjs}")"

cd "$TREE"

if [ -n "$RULER" ] && [ "$RULER" != "$TREE" ]; then
  for f in .oxlintrc.json tsconfig.json; do
    if [ -f "$RULER/$f" ]; then cp "$RULER/$f" "$f"; elif [ -f "$f" ]; then rm "$f"; fi
  done
fi

if [ "${RUN_TESTS:-}" = "1" ]; then npm test --silent; fi
node "$JUDGE_METRICS" collect "$OUT"
