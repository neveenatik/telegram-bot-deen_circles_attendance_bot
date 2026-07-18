#!/usr/bin/env bash
# Local, offline dry-run check for the agent-dispatch lane logic.
#
# It extracts the real "Pick and assign the next issue" run block from
# .github/workflows/agent-dispatch.yml (so this test can't drift from the
# workflow), stubs the `gh` CLI with canned answers, forces DRY_RUN=true, and
# asserts which lane/issue the dispatcher would choose in a few scenarios.
#
# Usage:  bash scripts/gh/dry-run-dispatch.sh
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
workflow="$repo_root/.github/workflows/agent-dispatch.yml"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# --- 1. Extract the step's run script straight from the workflow YAML ---------
ruby -ryaml -e '
  wf = YAML.load_file(ARGV[0])
  step = wf["jobs"]["dispatch"]["steps"].find { |s| s["name"] == "Pick and assign the next issue" }
  abort "step not found" unless step && step["run"]
  print step["run"]
' "$workflow" > "$work/dispatch.sh"

# --- 2. Stub gh with scenario-driven canned answers ---------------------------
cat > "$work/gh" <<'STUB'
#!/usr/bin/env bash
args="$*"
if [[ "${1:-}" == "issue" && "${2:-}" == "list" ]]; then
  if [[ "$args" == *"--assignee"* ]]; then echo "${FAKE_INFLIGHT:-0}"; exit 0; fi
  if [[ "$args" == *"needs-breakdown"* ]]; then echo "${FAKE_PLANNER:-}"; exit 0; fi
  for p in P0 P1 P2; do
    if [[ "$args" == *"priority:$p"* ]]; then var="FAKE_$p"; echo "${!var:-}"; exit 0; fi
  done
  echo ""; exit 0
fi
if [[ "${1:-}" == "issue" && "${2:-}" == "view" ]]; then
  echo "#${3} Example title  [example-labels]"; exit 0
fi
# `gh api` (the actual assignment) must never run in a dry run.
echo "UNEXPECTED: gh api called during dry run: $args" >&2
exit 99
STUB
chmod +x "$work/gh"

# --- 3. Run one scenario and assert its output --------------------------------
pass=0; fail=0
run_case() {
  local name="$1" expect="$2"; shift 2
  local out
  # Baseline env; per-case FAKE_* overrides are passed as extra args.
  out="$(env -i PATH="$work:$PATH" \
      GH_TOKEN=fake REPO=owner/repo BASE_BRANCH=main \
      MAX_CONCURRENT=1 FUNNEL_FILE=feature-ideas DRY_RUN=true \
      "$@" \
      bash "$work/dispatch.sh" 2>&1)" || true
  if grep -qF "$expect" <<<"$out"; then
    echo "PASS  $name"; pass=$((pass+1))
  else
    echo "FAIL  $name"; echo "  expected to contain: $expect"; echo "  got:"; sed 's/^/    /' <<<"$out"; fail=$((fail+1))
  fi
}

run_case "planner lane wins when needs-breakdown exists" \
  "would assign #42 to the agent in 'planner' mode" \
  FAKE_PLANNER=42 FAKE_P0=7

run_case "builder lane picks highest priority (P0 over P1)" \
  "Selected priority:P0 issue #7 (builder lane)" \
  FAKE_P0=7 FAKE_P1=8

run_case "builder lane falls through to P2" \
  "Selected priority:P2 issue #9 (builder lane)" \
  FAKE_P2=9

run_case "nothing to dispatch when queues are empty" \
  "Nothing to dispatch"

run_case "respects the concurrency cap" \
  "At capacity" \
  FAKE_INFLIGHT=1 FAKE_PLANNER=42

echo "----"
echo "$pass passed, $fail failed"
[[ "$fail" -eq 0 ]]
