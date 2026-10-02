#!/usr/bin/env bash
# init.sh — THE SESSION ENTRYPOINT (v106 · THE LIVING HARNESS)
# ============================================================
# Root-level entrypoint (harness convention adopted from
# walkinglabs/learn-harness-engineering): a fresh session — human or
# autonomous — runs ONE command and the platform is restartable.
#
# What it does, in order (fails fast via set -e):
#   0. Structure sanity (package.json · schema spine · mini-services ·
#      BLOC-STATE map) — folded from the parallel Task-19 wave (merged v106)
#   1. Bootstraps the environment (deps · prisma client · schema ·
#      operator-key presence · harness files · live probes)
#      → delegates to scripts/init.sh (the full lifecycle)
#   2. Runs the verification gate (scripts/verify.sh) so the session
#      starts from MEASURED truth, not assumptions — evidence JSON is
#      written under scripts/artifacts/ automatically.
#
# Exit code 0 = bootstrapped + gate passed. Non-zero = the gate said
# no. That is the harness working, not a bug.
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

echo "[init] === SESSION BOOTSTRAP (v106 · THE LIVING HARNESS) ==="

# ── 0. structure sanity (parallel-wave merge: Task-19 checks, kept) ──
echo "[init] 0/7 structure"
test -f package.json || { echo "FAIL: package.json missing"; exit 1; }
test -f prisma/schema.prisma || { echo "FAIL: prisma/schema.prisma missing (the spine)"; exit 1; }
test -d mini-services || { echo "FAIL: mini-services/ missing"; exit 1; }
test -f docs/BLOC-STATE-2026-10-02.md || { echo "FAIL: BLOC-STATE map missing"; exit 1; }
for svc in mini-services/*/; do
  [ -f "${svc}package.json" ] || { echo "FAIL: ${svc} missing package.json (independent bun project)"; exit 1; }
done
echo "[init]   structure ok (schema spine + mini-services independent)"

bash scripts/init.sh

echo "[init] === VERIFICATION GATE (no done without runnable proof) ==="
bash scripts/verify.sh

echo "=== Verification Complete ==="
echo ""
echo "Next steps:"
echo "1. Read feature_list.json to see current feature state"
echo "2. Pick ONE unfinished feature to work on (the active_feature row)"
echo "3. Implement only that feature"
echo "4. Re-run verification (bash scripts/verify.sh) before claiming done"
echo "5. Update progress.md + session-handoff.md + worklog.md, then commit + pull --rebase + push"
