#!/usr/bin/env bash
# scripts/restore-backup.sh — SAOS v27 אחיזה: sovereign restore.
# ====================================================================
# The human act of restoring the platform's truth from the sovereign
# backups (db/backups — consistent VACUUM-INTO DB snapshots + daily
# chain snapshots, taken by the web tier on the keeper's 30-min
# schedule).
#
# RESTORE IS A HUMAN SOVEREIGN DECISION. This script:
#   · lists the available snapshots (--list)
#   · restores the DB (--db latest | --db custom-YYYYMMDD-HHMMSS.db)
#   · restores the chain state (--chain latest | --chain chain-YYYYMMDD)
#   · REFUSES to run while the web tier is answering on :3000 (the DB
#     must not be written during the swap) unless --force is given
#   · always preserves the CURRENT state as *.pre-restore-* before
#     swapping anything in (a restore is never itself a loss)
#
# Usage (from the project root):
#   bash scripts/restore-backup.sh --list
#   bash scripts/restore-backup.sh --db latest
#   bash scripts/restore-backup.sh --db latest --chain latest
#   bash scripts/restore-backup.sh --db custom-20260909-013000.db --force
# ====================================================================
set -euo pipefail

PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUPS="$PROJECT/db/backups"
DB="$PROJECT/db/custom.db"
CHAIN_STATE="$PROJECT/mini-services/evm-mesh/state"
STAMP="$(date +%Y%m%d-%H%M%S)"

say()  { printf '%s\n' "$*"; }
die()  { printf 'שגיאה: %s\n' "$*" >&2; exit 1; }

web_up() {
  curl -s -o /dev/null -m 3 "http://127.0.0.1:3000/api/saos/live-probes" 2>/dev/null && return 0 || return 1
}

list_snapshots() {
  say "── צילומי DB (VACUUM INTO עקבי) ──"
  ls -1t "$BACKUPS"/custom-*.db 2>/dev/null | while read -r f; do
    printf '  %s  (%s)\n' "$(basename "$f")" "$(du -h "$f" | cut -f1)"
  done || true
  say ""
  say "── צילומי שרשרת (יומיים) ──"
  ls -1t "$BACKUPS"/chain-* 2>/dev/null | while read -r d; do
    printf '  %s  (%s)\n' "$(basename "$d")" "$(du -sh "$d" | cut -f1)"
  done || true
  [ ! -d "$BACKUPS" ] && say "(אין תיקיית גיבויים עדיין — השומר מצלם כל 30 דק')"
  return 0
}

FORCE=0
DO_DB=""
DO_CHAIN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --list)   list_snapshots; exit 0 ;;
    --db)     DO_DB="${2:-latest}"; shift 2 ;;
    --chain)  DO_CHAIN="${2:-latest}"; shift 2 ;;
    --force)  FORCE=1; shift ;;
    *) die "דגל לא מוכר: $1 (ראה --list · --db · --chain · --force)" ;;
  esac
done

[ -z "$DO_DB" ] && [ -z "$DO_CHAIN" ] && { list_snapshots; die "ציין מה לשחזר: --db <שם|latest> ו/או --chain <שם|latest>"; }

# safety: never swap under a writing web tier (unless forced)
if [ "$FORCE" -eq 0 ] && web_up; then
  die "שכבת-הווב חיה וכותבת (:3000 עונה) — עצור אותה קודם (או השתמש ב---force באחריותך). השומר יחיה אותה אוטומטית אחרי השחזור."
fi
[ -d "$BACKUPS" ] || die "אין תיקיית גיבויים — אין מה לשחזר"

# ─── DB restore ────────────────────────────────────────────────────────────
if [ -n "$DO_DB" ]; then
  if [ "$DO_DB" = "latest" ]; then
    SRC="$(ls -1t "$BACKUPS"/custom-*.db 2>/dev/null | head -1 || true)"
  else
    SRC="$BACKUPS/$DO_DB"
  fi
  [ -f "$SRC" ] || die "צילום DB לא נמצא: $DO_DB"
  if [ -f "$DB" ]; then
    cp -p "$DB" "$DB.pre-restore-$STAMP"
    say "ה-DB הנוכחי נשמר: custom.db.pre-restore-$STAMP"
  fi
  cp -p "$SRC" "$DB"
  say "ה-DB שוחזר מ-$(basename "$SRC") → db/custom.db"
fi

# ─── chain restore ─────────────────────────────────────────────────────────
if [ -n "$DO_CHAIN" ]; then
  if [ "$DO_CHAIN" = "latest" ]; then
    CDIR="$(ls -1t "$BACKUPS"/chain-* 2>/dev/null | head -1 || true)"
  else
    CDIR="$BACKUPS/$DO_CHAIN"
  fi
  [ -d "$CDIR" ] || die "צילום שרשרת לא נמצא: $DO_CHAIN"
  mkdir -p "$CHAIN_STATE"
  for f in anvil-state.json deployment.json; do
    if [ -f "$CDIR/$f" ]; then
      [ -f "$CHAIN_STATE/$f" ] && cp -p "$CHAIN_STATE/$f" "$CHAIN_STATE/$f.pre-restore-$STAMP"
      cp -p "$CDIR/$f" "$CHAIN_STATE/$f"
      say "מצב השרשרת שוחזר: $f"
    fi
  done
  say "השרשרת שוחזרה מ-$(basename "$CDIR") — הראנר (bun --hot) יתחיל עם --load-state בהפעלה הבאה"
fi

say ""
say "השחזור הושלם. הפעל/המתן לשכבת-הווב (השומר יחיה אותה אוטומטית אם היא כבויה): bun run dev"
say "אחרי העלייה: הגשת בדיקה — http://127.0.0.1:3000/api/saos/audit (האמת מאומתת מהשרשרות, לא רק מה-DB)"
