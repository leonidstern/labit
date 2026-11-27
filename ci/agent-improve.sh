#!/usr/bin/env bash
# The agent loop. Runs outside CI (your machine or a Claude Code session), so CI needs no secrets.
# The agent proposes; the same judge CI uses decides locally; CI re-checks after the push.
#
#   ci/agent-improve.sh            improve one metric on main, then open a PR
#   ci/agent-improve.sh --pr 123   make PR #123 pass the gate (or improve it), push to it
#
# Run it from an up-to-date main: the judge is frozen from there before any PR code is checked out.
# Needs git, node 20+, gh (logged in) and claude (logged in). No API keys.
set -euo pipefail

PR=""
if [ "${1:-}" = "--pr" ]; then PR="${2:?usage: agent-improve.sh --pr <number>}"; fi
MAX_ATTEMPTS="${MAX_ATTEMPTS:-3}"
MODEL="${MODEL:-claude-opus-5-5}"
cd "$(git rev-parse --show-toplevel)"
ROOT="$PWD"

# Run the judge from a frozen copy outside the repo. Bash reads scripts as it goes, so
# otherwise an agent (or a PR) editing these files could change the guard mid-run.
if [ -z "${JUDGE:-}" ]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "commit or stash your changes first"; exit 1
  fi
  # Untracked files would be committed with the agent's patch, or deleted by git clean when a patch is rejected.
  if [ -n "$(git ls-files --others --exclude-standard)" ]; then
    echo "move or commit your untracked files first:"; git ls-files --others --exclude-standard; exit 1
  fi
  RUN="$(mktemp -d)"
  export RUN JUDGE="$RUN/judge"
  mkdir -p "$JUDGE"
  cp ci/agent-improve.sh ci/measure.sh ci/metrics.mjs ci/AGENT.md "$JUDGE/"
  exec bash "$JUDGE/agent-improve.sh" "$@"
fi
export JUDGE_METRICS="$JUDGE/metrics.mjs"
metrics() { node "$JUDGE_METRICS" "$@"; }
measure() { bash "$JUDGE/measure.sh" "$@"; }
# The page script is built from src/, not kept in git: build a tree before it is measured, as CI does.
# Steps log to $RUN; on failure the end of the log is printed and the run stops.
logged() {
  local log="$RUN/$1.log"; shift
  if ! "$@" > "$log" 2>&1; then echo "$* failed ($log):"; tail -n 40 "$log"; exit 1; fi
}
build() { (cd "$1" && npm run --silent build); }
trap 'git -C "$ROOT" worktree remove --force "$RUN/base" 2>/dev/null || true' EXIT

# Paths the agent may never touch, so it can't edit the judge, the tests or the claims instead of the code.
PROTECTED='^(\.github/|ci/|test/|bench/|\.oxlintrc|tsconfig\.json$|package\.json$|README\.md$|CHANGELOG\.md$|LICENSE$)'
# Ways to silence a check instead of fixing the cause.
SUPPRESS='(oxlint-disable|eslint-disable|@ts-ignore|@ts-expect-error|@ts-nocheck|\{ *(any|\*) *\}|!important)'
reset_tree() { git reset -q; git checkout -- .; git clean -fdq; }

# Reference = what CI will compare against. For a PR: its base, linted with the PR's rules.
if [ -n "$PR" ]; then
  gh pr checkout "$PR"
  BASE="$(gh pr view "$PR" --json baseRefName -q .baseRefName)"
  # The size-approved label lifts the per-PR budgets in CI (gates.yml); the same here.
  if gh pr view "$PR" --json labels -q '.labels[].name' | grep -qx size-approved; then export ALLOW_GROWTH=1; fi
  git fetch -q origin "$BASE"
  git worktree add -q --detach "$RUN/base" "origin/$BASE"
  logged build-base build "$RUN/base"
  logged measure-base measure "$RUN/base" "$RUN/reference.json" "$ROOT"
  REF="$RUN/reference.json"
fi

logged build-before build "$ROOT"
logged measure-before measure "$ROOT" "$RUN/before.json"
REF="${REF:-$RUN/before.json}"

if ! PICK="$(metrics pick "$RUN/before.json" ${PR:+"$REF"})"; then
  echo "nothing for the agent to do (record: $RUN)"
  exit 1
fi
IFS=$'\t' read -r TARGET HINT <<<"$PICK"
echo "target: $TARGET   (record: $RUN)"

# The gate CI will run, with tests, plus: the target metric must actually move, and nothing else may
# grow at all against the run's start (AGENT.md), not even within the per-PR budgets.
gates() {
  build "$ROOT" &&
  RUN_TESTS=1 measure "$ROOT" "$RUN/after.json" &&
  metrics compare "$RUN/after.json" "$REF" &&
  metrics compare "$RUN/after.json" "$RUN/before.json" --must-improve "$TARGET" --no-growth
}

FEEDBACK=""
for i in $(seq 1 "$MAX_ATTEMPTS"); do
  PROMPT="$(cat "$JUDGE/AGENT.md")

## This run
Target metric: $TARGET
Task: $HINT
Metrics now: $(cat "$RUN/before.json")

$FEEDBACK"
  printf '%s\n' "$PROMPT" > "$RUN/prompt-$i.md"

  # The only non-deterministic step. Limited tools, limited turns.
  claude -p "$PROMPT" --model "$MODEL" --max-turns 30 \
    --allowedTools "Read,Edit,Write,Glob,Grep,Bash(npm test),Bash(npm run build),Bash(npm run typecheck),Bash(node --check:*),Bash(npx --yes oxlint@1.93.0:*)" \
    > "$RUN/agent-$i.log" 2>&1 || true

  git add -A
  git diff --cached > "$RUN/patch-$i.diff"
  # No renames: a file moved out of a protected path must show its old path too.
  CHANGED="$(git diff --cached --name-only --no-renames)"

  if [ -z "$CHANGED" ]; then
    FEEDBACK="## Previous attempt
Attempt $i made no changes."
    git reset -q
    continue
  fi

  if BAD="$(grep -E "$PROTECTED" <<<"$CHANGED")"; then
    FEEDBACK="## Previous attempt was rejected
It edited protected files: $(tr '\n' ' ' <<<"$BAD")"
    reset_tree
    continue
  fi

  # Added lines into a variable first: grep -q ending a pipe early would fail it under pipefail.
  ADDED="$(git diff --cached -U0 --no-renames | grep -E '^\+' | grep -Ev '^\+\+\+ ' || true)"
  if grep -Eq "$SUPPRESS" <<<"$ADDED"; then
    FEEDBACK="## Previous attempt was rejected
It added a lint suppression, @ts-ignore or !important. Fix the cause instead."
    reset_tree
    continue
  fi

  git reset -q
  if gates > "$RUN/gates-$i.log" 2>&1; then
    {
      node -e '
        const [before, after, k, i, n] = process.argv.slice(1);
        console.log(`Agent target: \`${k}\`, ${require(before)[k]} → ${require(after)[k]} (attempt ${i} of ${n})`);
      ' "$RUN/before.json" "$RUN/after.json" "$TARGET" "$i" "$MAX_ATTEMPTS"
      echo
      echo "Gate, compared with $([ -n "$PR" ] && echo "the PR's base" || echo "main"):"
      echo
      metrics compare "$RUN/after.json" "$REF" || true
      echo
      echo "### Agent's note"
      tail -n 20 "$RUN/agent-$i.log"
    } > "$RUN/summary.md"
    # A new branch before the commit, so main is never committed to.
    if [ -z "$PR" ]; then
      BRANCH="agent/improve-$TARGET-$(date -u +%Y%m%d)"
      git switch -q -c "$BRANCH"
    fi
    git add -A
    git commit -q -m "agent: improve $TARGET" -m "$(cat "$RUN/summary.md")"

    if [ -n "$PR" ]; then
      if ! git push -q; then
        echo "couldn't push to the PR branch; the commit is local on $(git branch --show-current) (record: $RUN)"
        exit 1
      fi
    else
      git push -q -u origin "$BRANCH"
      gh pr create --title "agent: improve $TARGET" --body-file "$RUN/summary.md"
    fi
    echo "accepted on attempt $i"
    exit 0
  fi

  FEEDBACK="## Previous attempt was rejected by the gate
$(tail -n 40 "$RUN/gates-$i.log")"
  reset_tree
done

echo "no patch passed the gate after $MAX_ATTEMPTS attempts (record: $RUN)"
exit 1
