#!/usr/bin/env bash
# Weekly: turn repeated review feedback into lint rules (or agent instructions), as a PR you review.
# Run from an up-to-date main. Needs git, node 20+, gh (logged in) and claude (logged in). No API keys.
set -euo pipefail

MODEL="${MODEL:-claude-opus-5-5}"
cd "$(git rev-parse --show-toplevel)"
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "commit or stash your changes first"; exit 1
fi
RUN="$(mktemp -d)"
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
SINCE="$(node -e 'console.log(new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10))')"

# 1. Signals: plain queries, nothing interpreted yet.
gh api "repos/$REPO/pulls/comments?since=${SINCE}T00:00:00Z&per_page=100" --paginate \
  --jq '.[] | {path, body, url: .html_url}' > "$RUN/review-comments.jsonl"
gh pr list --state closed --search "head:agent/ is:unmerged closed:>=$SINCE" --limit 50 \
  --json title,url,closedAt > "$RUN/rejected-agent-prs.json"
git log --since="7 days ago" --grep='^Revert "agent:' --format='%s%n%b%n---' \
  > "$RUN/reverted-agent-commits.txt"

# Problems found with today's rules, to show what any new rule costs.
cp ci/metrics.mjs ci/measure.sh "$RUN/"
export JUDGE_METRICS="$RUN/metrics.mjs"
bash "$RUN/measure.sh" . "$RUN/old-rules.json" > /dev/null 2>&1

# 2. The agent proposes. Its final reply becomes the PR description.
ALLOWED='^(\.oxlintrc\.json|ci/AGENT\.md)$'
claude -p "$(cat <<EOF
You maintain this repo's lint rules. Signals from the last 7 days are in $RUN:
review-comments.jsonl, rejected-agent-prs.json, reverted-agent-commits.txt.

1. Find feedback that repeats at least 3 times.
2. If an oxlint rule can catch it, add or tighten it in .oxlintrc.json (create the file if needed).
   Only add or tighten. Never remove, disable or relax a rule.
3. If no rule can catch it, add one short line under "Learned rules" in ci/AGENT.md.
4. Reply with a short PR description: each change, the comments behind it (with links), and why.
If nothing repeats 3 times, change nothing and reply "No repeated feedback this week."
EOF
)" --model "$MODEL" --max-turns 30 --add-dir "$RUN" \
  --allowedTools "Read,Grep,Glob,Write(.oxlintrc.json),Edit(.oxlintrc.json),Edit(ci/AGENT.md)" \
  > "$RUN/proposal.md" 2> "$RUN/agent.err" || true

# 3. Deterministic guard on scope.
CHANGED="$( (git diff --name-only; git ls-files --others --exclude-standard) | sort -u)"
if [ -z "$CHANGED" ]; then
  echo "no rule changes proposed"
  exit 0
fi
if grep -Ev "$ALLOWED" <<<"$CHANGED"; then
  echo "agent edited files outside its scope; discarding"
  git checkout -- . && git clean -fdq
  exit 1
fi

# 4. Measure with the new rules. The gate lints both sides with the PR's rules, so this PR
#    passes; the numbers show the backlog the new rules uncovered.
bash "$RUN/measure.sh" . "$RUN/new-rules.json" > /dev/null 2>&1

BRANCH="meta/rules-$(date -u +%Y%m%d)"
git switch -q -c "$BRANCH"
git add -A
git commit -q -m "meta: tighten lint rules from repeated review feedback"
git push -q -u origin "$BRANCH"
{
  cat "$RUN/proposal.md"
  echo
  echo "### What the new rules found in existing code"
  echo
  node "$RUN/metrics.mjs" compare "$RUN/new-rules.json" "$RUN/old-rules.json" || true
} > "$RUN/body.md"
gh pr create --title "meta: tighten lint rules ($(date -u +%Y-%m-%d))" --body-file "$RUN/body.md"
