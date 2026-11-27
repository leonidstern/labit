#!/usr/bin/env bash
# Weekly: turn repeated review feedback into lint rules (or agent instructions), as a PR you review.
# Run from an up-to-date main. Needs git, node 20+, gh (logged in) and claude (logged in). No API keys.
set -euo pipefail

MODEL="${MODEL:-claude-opus-5-5}"
cd "$(git rev-parse --show-toplevel)"
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "commit or stash your changes first"; exit 1
fi
# Untracked files would count as the agent's changes, and be committed or deleted with them.
if [ -n "$(git ls-files --others --exclude-standard)" ]; then
  echo "move or commit your untracked files first:"; git ls-files --others --exclude-standard; exit 1
fi
RUN="$(mktemp -d)"
# Steps log to $RUN; on failure the end of the log is printed and the run stops.
logged() {
  local log="$RUN/$1.log"; shift
  if ! "$@" > "$log" 2>&1; then echo "$* failed ($log):"; tail -n 40 "$log"; exit 1; fi
}
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
# The page script is built from src/, not kept in git: build it first, as CI does.
cp ci/metrics.mjs ci/measure.sh "$RUN/"
export JUDGE_METRICS="$RUN/metrics.mjs"
logged build npm run --silent build
logged measure-old bash "$RUN/measure.sh" . "$RUN/old-rules.json"

# 2. The agent proposes. Its final reply becomes the PR description.
ALLOWED='^(\.oxlintrc\.json|ci/AGENT\.md)$'
# read, not $(cat <<EOF): macOS bash 3.2 can't parse a quote inside a heredoc inside $( ).
read -r -d '' PROMPT <<EOF || true
You maintain this repo's lint rules. Signals from the last 7 days are in $RUN:
review-comments.jsonl, rejected-agent-prs.json, reverted-agent-commits.txt.

1. Find feedback that repeats at least 3 times.
2. If an oxlint rule can catch it, add or tighten it in .oxlintrc.json (create the file if needed).
   Only add or tighten. Never remove, disable or relax a rule.
3. If no rule can catch it, add one short line under "Learned rules" in ci/AGENT.md.
4. Reply with a short PR description: each change, the comments behind it (with links), and why.
If nothing repeats 3 times, change nothing and reply "No repeated feedback this week."
EOF
claude -p "$PROMPT" --model "$MODEL" --max-turns 30 --add-dir "$RUN" \
  --allowedTools "Read,Grep,Glob,Write(.oxlintrc.json),Edit(.oxlintrc.json),Edit(ci/AGENT.md)" \
  > "$RUN/proposal.md" 2> "$RUN/agent.err" && AGENT_OK=1 || AGENT_OK=0

# 3. Deterministic guard on scope.
discard() { echo "$1; discarding"; git checkout -- . && git clean -fdq; exit 1; }
CHANGED="$( (git diff --name-only --no-renames; git ls-files --others --exclude-standard) | sort -u)"
if [ "$AGENT_OK" != 1 ]; then
  echo "the claude session failed ($RUN/agent.err):"; tail -n 20 "$RUN/agent.err"
  [ -z "$CHANGED" ] || discard "its changes may be half done"
  exit 1
fi
if [ -z "$CHANGED" ]; then
  echo "no rule changes proposed"
  exit 0
fi
if grep -Ev "$ALLOWED" <<<"$CHANGED"; then
  discard "agent edited files outside its scope"
fi
# AGENT.md may only gain lines.
if [ -n "$(git diff --numstat -- ci/AGENT.md | awk '$2 != 0')" ]; then
  discard "agent removed or changed lines in ci/AGENT.md"
fi
# Rules may only be added or tightened: nothing removed, turned off or lowered, no new ignores, no plugin dropped.
# Rule options aren't judged here; the PR review is.
cat > "$RUN/weaker.cjs" <<'JS'
const fs = require("node:fs");
const parse = (f) => (fs.existsSync(f) && fs.readFileSync(f, "utf8").trim() ? JSON.parse(fs.readFileSync(f, "utf8")) : {});
const [old, cur] = [parse(process.argv[2]), parse(process.argv[3])];
const level = (v) => { const s = Array.isArray(v) ? v[0] : v; return { off: 0, allow: 0, 0: 0, warn: 1, 1: 1, error: 2, deny: 2, 2: 2 }[s] ?? 0; };
const out = [];
const rules = (a = {}, b = {}, where) => {
  for (const [k, v] of Object.entries(a)) if (!(k in b) || level(b[k]) < level(v)) out.push(`${where} ${k} removed or lowered`);
  for (const [k, v] of Object.entries(b)) if (level(v) === 0 && !(k in a)) out.push(`${where} ${k} turned off`);
};
rules(old.rules, cur.rules, "rule");
rules(old.categories, cur.categories, "category");
(cur.overrides ?? []).forEach((o, i) => rules((old.overrides ?? [])[i]?.rules, o.rules, `override ${i}: rule`));
for (const p of cur.ignorePatterns ?? []) if (!(old.ignorePatterns ?? []).includes(p)) out.push(`ignore pattern ${p} added`);
// oxlint replaces its default plugins when the list is given.
for (const p of old.plugins ?? ["typescript", "unicorn", "oxc"]) if (cur.plugins && !cur.plugins.includes(p)) out.push(`plugin ${p} dropped`);
console.log(out.join("; "));
JS
git show HEAD:.oxlintrc.json > "$RUN/oxlintrc-old.json" 2>/dev/null || : > "$RUN/oxlintrc-old.json"
WEAKER="$(node "$RUN/weaker.cjs" "$RUN/oxlintrc-old.json" .oxlintrc.json 2>&1)" || discard "couldn't read .oxlintrc.json: $WEAKER"
[ -z "$WEAKER" ] || discard "agent weakened lint rules: $WEAKER"

# 4. Measure with the new rules. The gate lints both sides with the PR's rules, so this PR
#    passes; the numbers show the backlog the new rules uncovered.
logged measure-new bash "$RUN/measure.sh" . "$RUN/new-rules.json"

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
