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

# v107 · שיעור-ה-OOM (נתפס-חי 2026-10-02 ×4): uncapped lint נהרג SIGKILL (global OOM)
# כש-next-server+anvil אוחזים ~2GB מתוך 4GB. תקרת-heap של 768MB מכריחה GC אקטיבי —
# נמדד-חי: SIGKILL → pass (1024MB עבר; 768MB = מרווח-לספייק-השער מול שרת-חי).
# לא דורך NODE_OPTIONS קיים.
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=768}"

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

# ── Stage 1.5 (v107-final · GATE-PARK): the gate OWNS the machine's memory
#    during the heavy stages. Caught live ×6: even a freshly-recycled young
#    server grows under poller load and the gate's own spike (tsc+lint ≈1.5GB)
#    triggers global OOM that kills the server mid-gate. The keeper parks the
#    web tier (SIGTERM, auto-revive suppressed 180s) → heavy stages run inside
#    the budget → web-resume respawns → live-api meets a warm server.
#    Best-effort: keeper absent → proceed honestly (live-api reports truth).
# v107-final: resume is UNCONDITIONAL (caught live: fail-fast before web-resume
# left the server parked — a failed gate must still hand the machine back).
# The trap fires on every exit path, fail-fast included.
PARKED=0
curl -s --max-time 4 -X POST http://127.0.0.1:3005/park-web 2>/dev/null | grep -q '"parked"' && PARKED=1
export PARKED
trap 'if [ "$PARKED" = "1" ]; then curl -s --max-time 4 -X POST http://127.0.0.1:3005/resume-web >/dev/null 2>&1; fi' EXIT
run_stage "gate-clear" bash -c '
  if [ "$PARKED" = "1" ]; then
    echo "web parked — heavy stages own the memory budget (resume is unconditional via EXIT trap)"
  else
    echo "keeper absent or park refused — gate proceeds without park (best-effort)"
  fi
  exit 0
'

# ── Stage 2: dependencies installed (node_modules resolves) ──
run_stage "deps" bash -c '[ -d node_modules ] && [ -e node_modules/.bin/next ] && echo "node_modules present"'

# ── Stage 3: type check — the first real gate (measured: ~5s; v107: incremental —
#    content-hash tsbuildinfo in .cache/, identical checks at a fraction of the spike) ──
run_stage "tsc" bash -c 'mkdir -p .cache/tsc && bunx tsc --noEmit --incremental --tsBuildInfoFile .cache/tsc/tsbuildinfo'

# ── Stage 4: lint — code quality gate ──
run_stage "lint" bun run lint

# ── Stage 5: prisma schema/DB drift gate (live-caught: 'migrate status' exits 0 even
#    when the repo uses db:push with no migrations dir — a spurious pass. The honest
#    gate: idempotent db push — "already in sync" = pass, applies-drift = pass but
#    reported, needs-data-loss non-interactively = refuse + exit 1 = honest fail.) ──
run_stage "db-sync" bunx prisma db push --skip-generate

# ── Stage 6: harness files alive (the state the next session depends on) ──
run_stage "harness-files" bash -c 'for f in AGENTS.md feature_list.json progress.md session-handoff.md scripts/verify.sh scripts/init.sh; do [ -f "$f" ] || exit 1; done && echo "6/6 harness files present"'

# ── Stage 7 (v107-final · WEB-RESUME): the heavy stages are done — ask the
#    keeper to respawn the web tier, then live-api polls until warm.
run_stage "web-resume" bash -c '
  curl -s --max-time 4 -X POST http://127.0.0.1:3005/resume-web >/dev/null 2>&1 || { echo "keeper absent — resume skipped (live-api reports truth)"; exit 0; }
  for i in $(seq 1 25); do
    code=$(curl -s --max-time 3 -o /dev/null -w "%{http_code}" http://localhost:3000/api/saos/status 2>/dev/null || true)
    [ "$code" = "200" ] && { echo "web resumed and warm ($((i*4))s)"; exit 0; }
    sleep 4
  done
  echo "web not warm after 100s — live-api will report honestly"; exit 1
'

# ── Stage 8: the live server answers (live-caught v106: '|| echo' swallowed
#    the failure exit-code → a dead server "passed". Honest gate: down = fail
#    with the exact status recorded; the platform that declares done must be alive.
#    v107-final: polls up to ~30s — the resumed server needs a few seconds.) ──
run_stage "live-api" bash -c 'for i in $(seq 1 10); do code=$(curl -s --max-time 6 -o /dev/null -w "%{http_code}" http://localhost:3000/api/saos/status); [ "$code" = "200" ] && { echo "status API live (200)"; exit 0; }; sleep 3; done; echo "status API not-200/down (code=$code)"; exit 1;'

# ── Stage 8 (v107 · THE INVISIBLE GUARD): destructive-command protection is
#    functional, not merely installed. dcg blocks known-catastrophic commands
#    (rm -rf, git reset --hard, DROP TABLE…) before they run — the mechanical
#    blast-radius cap that lets the fleet stay fully autonomous (owner doctrine:
#    nothing waits for a human). Fail-closed HERE: a platform that declares done
#    without a working guard is a platform one typo away from losing itself.
#    Checks: binary present · deny-proof (rm -rf / denied) · allow-proof (echo
#    allowed — guard never blocks legitimate work) · project .dcg.toml in-repo.
export GUARD_BIN="${DCG_BIN:-$HOME/.local/bin/dcg}"
run_stage "guard" bash -c '"$GUARD_BIN" --robot test "rm -rf /" | grep -q "\"decision\": \"deny\"" && "$GUARD_BIN" --robot test "echo saos-gate-probe" | grep -q "\"decision\": \"allow\"" && [ -f .dcg.toml ] && echo "guard functional: deny-proof + allow-proof + .dcg.toml in-repo"'

# ── Stage 11 (wave-20 · MINI-PARSE): every mini-service source (and its
#    import graph) must PARSE. Caught live (v107-final): a latent SyntaxError
#    inside the keeper's Bun.serve handler was invisible to the root tsconfig
#    scope (mini-services are unchecked by tsc) AND to bun --hot, which fails
#    silently on reload — the running keeper served OLD code from memory.
#    bun build fail-closed per file: a service that cannot parse cannot
#    claim to run. Evidence-first: every file measured 2026-10-03 (8/8 pass)
#    BEFORE the gate was committed.
run_stage "mini-parse" bash -c '
  rc=0; n=0
  root="$PWD"; mkdir -p "$root/.cache/parse"
  for d in mini-services/*/; do
    [ -d "$d/src" ] || continue
    for f in "$d"src/*.ts; do
      [ -f "$f" ] || continue
      n=$((n+1))
      name="$(basename "${d%/}")-$(basename "$f" .ts)"
      if ! (cd "$d" && bun build "src/$(basename "$f")" --target bun --outfile "$root/.cache/parse/$name.js" >/dev/null 2>&1); then
        echo "parse FAIL: $f"
        rc=1
      fi
    done
  done
  [ "$rc" = "0" ] && echo "$n/$n mini-service sources parse clean" || exit 1
'

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
  "gates": ["toolchain","gate-clear","deps","tsc","lint","db-sync","harness-files","web-resume","live-api","guard","mini-parse"],
  "stages": $STAGES_JSON,
  "doctrine": "no done without runnable proof (harness engineering, adopted v106)"
}
EOF
mv "$TMP" "$EVIDENCE"

printf '[verify] VERDICT=%s pass=%s fail=%s evidence=%s\n' "$VERDICT" "$PASS_COUNT" "$FAIL_COUNT" "$EVIDENCE"
exit $([ "$VERDICT" = "pass" ] && echo 0 || echo 1)
