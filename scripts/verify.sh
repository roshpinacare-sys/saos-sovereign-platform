#!/usr/bin/env bash
# scripts/verify.sh — THE VERIFICATION GATE (v106 · THE LIVING HARNESS)
# =====================================================================
# Harness engineering adoption (walkinglabs/learn-harness-engineering,
# measured 20/100 on this repo before adoption): "Only a passing test
# suite counts as evidence. The agent cannot declare victory without
# runnable proof."
#
# THE LAW: no worker, agent, or session may declare ANYTHING done
# without running this script and recording its evidence. Fails fast:
# the first failed stage stops the battery (a broken gate is a stopped
# gate, not a green one). Evidence is written to
# scripts/artifacts/harness-verify-<UTC-date>.json — one per UTC day,
# the LAST run of the day wins (atomic rename, sha256 digest recorded
# by the harness executor).
#
# Zero secrets: reads no key material, prints no key material, ever.
set -o pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ARTIFACTS_DIR="$REPO_ROOT/scripts/artifacts"
mkdir -p "$ARTIFACTS_DIR"
UTC_DATE="$(date -u +%Y-%m-%d)"
UTC_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
EVIDENCE="$ARTIFACTS_DIR/harness-verify-$UTC_DATE.json"
TMP="$EVIDENCE.tmp.$$"

STAGES_JSON="["
PASS_COUNT=0
FAIL_COUNT=0

# record <stage> <status pass|fail> <detail> <ms>
record() {
  local stage="$1" status="$2" detail="$3" ms="$4"
  [ "$FAIL_COUNT" -gt 0 ] && return 0   # after first failure the battery is stopped
  if [ "$status" = "pass" ]; then PASS_COUNT=$((PASS_COUNT + 1)); else FAIL_COUNT=$((FAIL_COUNT + 1)); fi
  detail_escaped="$(printf '%s' "$detail" | tr -d '\000' | sed 's/\\/\\\\/g; s/"/\\"/g' | cut -c1-300)"
  [ $(( $(printf '%s' "$STAGES_JSON" | wc -c) )) -gt 2 ] && STAGES_JSON="$STAGES_JSON,"
  STAGES_JSON="$STAGES_JSON{\"stage\":\"$stage\",\"status\":\"$status\",\"detail\":\"$detail_escaped\",\"ms\":$ms}"
  printf '[verify] %-12s %s (%sms) %s\n' "$stage" "$status" "$ms" "$detail"
}

# run_stage <name> <command...>
run_stage() {
  [ "$FAIL_COUNT" -gt 0 ] && return 0
  local stage="$1"; shift
  local t0 t1 ms out rc
  t0=$(date +%s%3N)
  out="$("$@" 2>&1)"
  rc=$?
  t1=$(date +%s%3N)
  ms=$((t1 - t0))
  if [ $rc -eq 0 ]; then
    record "$stage" "pass" "$(printf '%s' "$out" | tail -n 2 | tr '\n' ' ' | cut -c1-200)" "$ms"
  else
    record "$stage" "fail" "$(printf '%s' "$out" | tail -n 6 | tr '\n' ' ' | cut -c1-300)" "$ms"
  fi
}

# ── Stage 1: toolchain present (fails fast — a session without a toolchain is not a session) ──
run_stage "toolchain" bash -c 'command -v bun >/dev/null && command -v node >/dev/null && echo "bun+node present"'

# ── Stage 2: dependencies installed (node_modules resolves) ──
run_stage "deps" bash -c '[ -d node_modules ] && [ -e node_modules/.bin/next ] && echo "node_modules present"'

# ── Stage 3: type check — the first real gate (measured: ~5s) ──
run_stage "tsc" bunx tsc --noEmit

# ── Stage 4: lint — code quality gate ──
run_stage "lint" bun run lint

# ── Stage 5: prisma schema/DB drift gate (live-caught: 'migrate status' exits 0 even
#    when the repo uses db:push with no migrations dir — a spurious pass. The honest
#    gate: idempotent db push — "already in sync" = pass, applies-drift = pass but
#    reported, needs-data-loss non-interactively = refuse + exit 1 = honest fail.) ──
run_stage "db-sync" bunx prisma db push --skip-generate

# ── Stage 6: harness files alive (the state the next session depends on) ──
run_stage "harness-files" bash -c 'for f in AGENTS.md feature_list.json progress.md session-handoff.md scripts/verify.sh scripts/init.sh; do [ -f "$f" ] || exit 1; done && echo "6/6 harness files present"'

# ── Stage 7: the live server answers (live-caught v106: '|| echo' swallowed
#    the failure exit-code → a dead server "passed". Honest gate: down = fail
#    with the exact status recorded; the platform that declares done must be alive.) ──
run_stage "live-api" bash -c 'code=$(curl -s --max-time 8 -o /dev/null -w "%{http_code}" http://localhost:3000/api/saos/status); [ "$code" = "200" ] && echo "status API live (200)" || { echo "status API not-200/down (code=$code)"; exit 1; }'

STAGES_JSON="$STAGES_JSON]"

# Fail-fast means: stages after the first failure were SKIPPED (not passed)
if [ "$FAIL_COUNT" -gt 0 ]; then
  VERDICT="fail"
else
  VERDICT="pass"
fi

# ── Evidence file (atomic rename; the last run of the UTC day wins) ──
cat > "$TMP" <<EOF
{
  "kind": "harness-verify",
  "date": "$UTC_DATE",
  "measuredAt": "$UTC_TS",
  "verdict": "$VERDICT",
  "pass": $PASS_COUNT,
  "fail": $FAIL_COUNT,
  "failFast": $( [ "$VERDICT" = "fail" ] && echo true || echo false ),
  "gates": ["toolchain","deps","tsc","lint","db-sync","harness-files","live-api"],
  "stages": $STAGES_JSON,
  "doctrine": "no done without runnable proof (harness engineering, adopted v106)"
}
EOF
mv "$TMP" "$EVIDENCE"

printf '[verify] VERDICT=%s pass=%s fail=%s evidence=%s\n' "$VERDICT" "$PASS_COUNT" "$FAIL_COUNT" "$EVIDENCE"
exit $([ "$VERDICT" = "pass" ] && echo 0 || echo 1)
