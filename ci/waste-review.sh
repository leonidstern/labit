#!/usr/bin/env bash
# AI review of the page script for waste and code quality, for a release tag. Runs outside CI (your machine or a Claude Code
# session), like the other agents here, so CI needs no secrets: CI makes the deterministic report (waste.yml, on the tag),
# this adds a reviewer that reads the code with that report as input. Read-only: the agent can't edit, build or run anything.
# Findings go to a file, to the job summary when run in one, and into one issue per tag. No PR.
#
#   ci/waste-review.sh              review the newest vX.Y.Z tag
#   ci/waste-review.sh v0.7.0       review that tag
#   NO_ISSUE=1 ci/waste-review.sh   print and save the findings, open nothing
#
# Needs git, node 22+, gh (logged in) and claude (logged in). No API keys.
set -euo pipefail

MODEL="${MODEL:-claude-opus-5-5}"
cd "$(git rev-parse --show-toplevel)"
ROOT="$PWD"
git fetch -q --tags origin
TAG="${1:-$(git tag --list 'v*' --sort=-v:refname | head -1)}"
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || { echo "no tag $TAG"; exit 1; }
RUN="$(mktemp -d)"
trap 'git -C "$ROOT" worktree remove --force "$RUN/src" 2>/dev/null || true' EXIT

# The tag's own code, checked out beside the repo; the prompt is this checkout's, copied first so the agent can't change it.
cp ci/waste-review.md "$RUN/prompt.md"
git worktree add -q --detach "$RUN/src" "$TAG"
cd "$RUN/src"
grep -q '"waste"' package.json || { echo "$TAG predates the waste check (no npm run waste); review a newer tag"; exit 1; }
WASTE_OUT="$RUN/waste-report.md" npm run --silent waste > "$RUN/waste.log" 2>&1 || echo "note: the page script is over its cap at $TAG (see $RUN/waste.log)"

# The only non-deterministic step: read-only tools, limited turns, working in the tag's checkout.
{ cat "$RUN/prompt.md"; echo; cat "$RUN/waste-report.md"; } > "$RUN/full-prompt.md"
claude -p "$(cat "$RUN/full-prompt.md")" --model "$MODEL" --max-turns 40 \
  --allowedTools "Read,Grep,Glob" \
  > "$RUN/review.md" 2> "$RUN/agent.err" || true

# Guard: a review that edited something, or said nothing, is thrown away.
if [ -n "$(git status --porcelain)" ]; then echo "agent changed files; discarding (record: $RUN)"; exit 1; fi
if ! grep -q '^## Verdict' "$RUN/review.md"; then echo "no review came back (record: $RUN)"; exit 1; fi

BODY="$RUN/body.md"
{
  echo "AI review of the page script at \`$TAG\` (model \`$MODEL\`, read-only), from the waste report. Estimates are gzip estimates, not measurements."
  echo
  cat "$RUN/review.md"
  echo
  echo "<details><summary>Waste report it started from</summary>"
  echo
  cat "$RUN/waste-report.md"
  echo
  echo "</details>"
} > "$BODY"
# GitHub caps a body at 65,536 characters.
head -c 60000 "$BODY" > "$RUN/body-cut.md"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && cat "$RUN/body-cut.md" >> "$GITHUB_STEP_SUMMARY"
cp "$RUN/body-cut.md" "$ROOT/waste-review.md" 2>/dev/null || true
echo "review: $ROOT/waste-review.md (record: $RUN)"

if [ "${NO_ISSUE:-}" = "1" ]; then exit 0; fi
TITLE="Page-script waste review: $TAG"
if [ -n "$(gh issue list --state all --search "\"$TITLE\" in:title" --json title -q '.[] | select(.title == "'"$TITLE"'") | .title')" ]; then
  echo "there is already an issue for $TAG; review left in $ROOT/waste-review.md"
  exit 0
fi
gh issue create --title "$TITLE" --body-file "$RUN/body-cut.md"
