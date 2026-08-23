#!/bin/sh
REPO=maxgfr/ultra11y
RUN=32663129267
while true; do
  st=$(gh run view "$RUN" --repo "$REPO" --json status --jq '.status' 2>/dev/null)
  if [ "$st" = "completed" ]; then
    gh run view "$RUN" --repo "$REPO" --json jobs --jq '.jobs[] | "\(.conclusion)\t\(.name)"' 2>/dev/null
    echo "CI #$RUN COMPLETE"
    exit 0
  fi
  sleep 45
done
