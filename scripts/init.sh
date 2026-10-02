#!/usr/bin/env bash
# scripts/init.sh — THE SESSION LIFECYCLE (v106 · THE LIVING HARNESS)
# ===================================================================
# Harness engineering adoption: "Initialize at the start. Clean up at
# the end. Leave a clean restart path for the next session."
#
# WHY THIS EXISTS (measured, not theorized): the sandbox resets wiped
# ~/.secrets + the DB twice (v100 P0, v105.1 re-arm) and both times
# recovery was a long MANUAL procedure. This script makes that
# procedure ONE command — the next session (human or autonomous) runs
# `bash scripts/init.sh` and the platform restarts honestly.
#
# Order matters: toolchain → deps → prisma client → schema → operator
# key (presence only, per the v100 doctrine, ZERO prints) → harness
# files → done. Every step is idempotent: running it twice is safe.
set -o pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

step() { printf '[init] %s\n' "$1"; }
ok()   { printf '[init]   ✓ %s\n' "$1"; }
warn() { printf '[init]   ⚠ %s\n' "$1"; }

# ── 1. toolchain ──
step "1/7 toolchain"
command -v bun >/dev/null 2>&1 && ok "bun $(bun --version 2>/dev/null | head -1)" || { warn "bun missing — cannot continue"; exit 1; }

# ── 2. dependencies ──
step "2/7 dependencies"
if [ ! -e node_modules/.bin/next ]; then
  step "  bun install (node_modules missing/stale — measured, not assumed)"
  bun install
else
  ok "node_modules present (skipping install — idempotent)"
fi

# ── 3. prisma client ──
step "3/7 prisma client"
if [ ! -d node_modules/.prisma/client ] && [ ! -d node_modules/@prisma/client ]; then
  bunx prisma generate && ok "client generated"
else
  ok "client present (v102 lesson: regenerate after schema edits — 'bun run db:push' does that)"
fi

# ── 4. schema in sync ──
step "4/7 schema push"
bun run db:push >/dev/null 2>&1 && ok "db:push ok (in sync or migrated)" || warn "db:push non-zero — inspect manually, fail-honest"

# ── 5. operator key (presence-only doctrine — the P0 re-arm, automated) ──
step "5/7 operator key (presence check — zero content printed)"
KEY_HOME="${HOME}/.secrets"
KEY_FILE="${KEY_HOME}/saos-operator-key"
if [ -s "$KEY_FILE" ]; then
  MODE=$(stat -c '%a' "$KEY_FILE" 2>/dev/null || echo "?")
  ok "operator key present (mode ${MODE}, size $(stat -c '%s' "$KEY_FILE" 2>/dev/null || echo '?') bytes — content untouched)"
else
  step "  key missing (the standing sandbox-reset wound) — regenerating per v100 doctrine"
  mkdir -p "$KEY_HOME" && chmod 700 "$KEY_HOME" 2>/dev/null
  bun -e 'const fs=require("fs"),c=require("crypto");const p=process.env.HOME+"/.secrets/saos-operator-key";if(!fs.existsSync(p)){fs.writeFileSync(p,c.randomBytes(32).toString("hex"),{mode:0o600});console.log("[init]   ✓ operator key generated (randomBytes-32, 0600, outside git, zero prints)")}else{console.log("[init]   ✓ key already present")}'
  chmod 600 "$KEY_FILE" 2>/dev/null
fi
[ -d "$KEY_HOME" ] && chmod 700 "$KEY_HOME" 2>/dev/null

# ── 6. harness files ──
step "6/7 harness files"
MISSING=0
for f in AGENTS.md feature_list.json progress.md session-handoff.md scripts/verify.sh scripts/init.sh; do
  if [ -f "$f" ]; then ok "$f"; else warn "$f MISSING — the harness is broken, restore from git"; MISSING=1; fi
done

# ── 7. live probe + honest state ──
step "7/7 live probe"
if curl -sf --max-time 6 http://localhost:3000/api/saos/status -o /dev/null 2>/dev/null; then
  ok "web :3000 live"
else
  warn "web :3000 down — start it ('bun run dev') or let the supervisor revive it"
fi
if curl -sf --max-time 4 http://localhost:3005/status -o /dev/null 2>/dev/null || curl -sf --max-time 4 http://localhost:3005/ -o /dev/null 2>/dev/null; then
  ok "keeper :3005 live"
else
  warn "keeper :3005 down — the supervisor (child of next) owns its revival"
fi

# ── honest summary ──
step "IF-EMPTY bootstrap (the army's memory):"
step "  if the DB was wiped AND the live roster is gone, restore from the committed"
step "  snapshot: POST /api/saos/state-snapshot {\"op\":\"bootstrap\"} — the live roster"
step "  is sacred: if roles self-regenerated, the restore refuses (by design, v105.1)."
step "done. next: bash scripts/verify.sh — no done without runnable proof."
exit 0
