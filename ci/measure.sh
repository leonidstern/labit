#!/usr/bin/env bash
# Measure one tree. The same steps run in CI and locally.
#
#   ci/measure.sh <tree> <out.json> [<ruler-tree>]
#
# ruler-tree: take tsconfig.json from here, so base and PR are checked with the same rules.
#             A PR that tightens a type rule then isn't blamed for problems that already existed.
# JUDGE_METRICS: which metrics.mjs to use (CI passes a trusted copy).
set -euo pipefail

abs() { case "$1" in /*) echo "$1" ;; *) echo "$PWD/$1" ;; esac; }

TREE="$(cd "$1" && pwd)"
OUT="$(abs "$2")"
RULER="${3:+$(cd "$3" && pwd)}"
JUDGE_METRICS="$(abs "${JUDGE_METRICS:-$TREE/ci/metrics.mjs}")"

cd "$TREE"

if [ -n "$RULER" ] && [ "$RULER" != "$TREE" ]; then
  if [ -f "$RULER/tsconfig.json" ]; then cp "$RULER/tsconfig.json" tsconfig.json; elif [ -f tsconfig.json ]; then rm tsconfig.json; fi
fi

node "$JUDGE_METRICS" collect "$OUT"
