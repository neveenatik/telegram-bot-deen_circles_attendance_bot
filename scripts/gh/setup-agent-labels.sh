#!/usr/bin/env bash
# Create (or update) the labels the agent-dispatch funnel relies on. Idempotent.
# Requires the GitHub CLI (`gh auth login`). Run from the repo root:
#   bash scripts/gh/setup-agent-labels.sh
set -euo pipefail

gh label create "ready"        --color "0e8a16" --description "Scoped & unblocked; safe for the agent to start" --force
gh label create "agent-ok"     --color "1d76db" --description "Approved for autonomous agent work"               --force
gh label create "priority:P0"  --color "b60205" --description "Critical / do first"                             --force
gh label create "priority:P1"  --color "d93f0b" --description "High"                                            --force
gh label create "priority:P2"  --color "fbca04" --description "Normal"                                          --force
gh label create "needs-triage" --color "ededed" --description "Awaiting grooming"                               --forcegh label create "needs-breakdown" --color "5319e7" --description "Too big for one PR; agent should split it into sub-tasks first" --force
gh label create "epic"         --color "c5def5" --description "A large body of work tracked as sub-tasks"          --force
echo "Labels ready."
