#!/bin/sh
# Emit one line per dispatched run as it reaches a terminal state, then exit.
BRANCH=worktree-feat-rgaa-broken-fixture
REPO=maxgfr/ultra11y
prev=""
while true; do
  cur=$(gh run list --repo "$REPO" --branch "$BRANCH" --limit 6 \
        --json databaseId,workflowName,status,conclusion \
        --jq '.[] | select(.status=="completed") | "\(.workflowName) #\(.databaseId): \(.conclusion)"' 2>/dev/null | sort)
  printf '%s\n' "$cur" | while IFS= read -r line; do
    [ -z "$line" ] && continue
    case "$prev" in
      *"$line"*) ;;
      *) echo "$line" ;;
    esac
  done
  prev="$cur"
  pending=$(gh run list --repo "$REPO" --branch "$BRANCH" --limit 6 \
            --json status --jq '[.[] | select(.status!="completed")] | length' 2>/dev/null)
  if [ "${pending:-1}" = "0" ]; then
    echo "ALL RUNS COMPLETE"
    exit 0
  fi
  sleep 45
done
