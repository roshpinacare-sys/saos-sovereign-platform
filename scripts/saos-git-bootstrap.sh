#!/bin/sh
# ============================================================================
# saos-git-bootstrap.sh — one-shot GitHub connection layer installer + doctor
# ============================================================================
# Owner directive (trace 1a099bd11deb4141): secure GitHub connection, available
# to ALL our git folders, from EVERY chat, rotation-ready.
#
# ANY new chat / session / environment-reset recovery:
#     bash /home/z/my-project/platform-latest/scripts/saos-git-bootstrap.sh
#
# What it does (idempotent — safe to run any number of times):
#   1. Ensures /home/z/.secrets exists (0700) and the canonical token file
#      is present (seeds from the owner upload path if missing — never prints).
#   2. Installs the credential helper + askpass scripts from THIS repo
#      (repo copy = source of truth) into /home/z/.secrets (0700).
#   3. Writes the global git config:
#        credential.helper = /home/z/.secrets/saos-git-cred.sh
#        core.askpass      = /home/z/.secrets/saos-git-askpass.sh
#      => plain `git push/pull/fetch/clone` works in EVERY folder with ZERO
#         env vars — this was the missing piece that made the previous
#         setup fail ("what was prepared last time didn't really work").
#   4. Ensures the devgate secret broker (DG_DATA_DIR=/home/z/.devgate) holds
#      ref github-pat (rotation is a broker re-registration — ADR-005).
#   5. Verifies LIVE: GitHub API /user (prints login + scopes, NEVER the
#      token) and a clean-environment `git ls-remote` on the main repo.
#
# Exit 0 = verified. Exit non-zero = exact failing step printed. Fail-closed.
# ============================================================================

set -u

SECRETS_DIR="/home/z/.secrets"
CANON="$SECRETS_DIR/github-token"
LEGACY="/home/z/my-project/upload/Roshcaregt.txt"
DG_SECRETS="/home/z/.devgate/secrets/github-pat"
REPO_SCRIPTS="/home/z/my-project/scripts"
MAIN_REPO_URL="https://github.com/roshpinacare-sys/saos-sovereign-platform.git"
export DG_DATA_DIR="/home/z/.devgate"

fail() { echo "BOOTSTRAP-FAIL: $1" >&2; exit 1; }
ok()   { echo "  ok: $1"; }

echo "== SAOS GitHub connection bootstrap =="

# --- 1. secrets dir + canonical token --------------------------------------
mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"
if [ ! -s "$CANON" ]; then
  if [ -s "$LEGACY" ]; then
    umask 077; tr -d '[:space:]' < "$LEGACY" > "$CANON.tmp" && mv "$CANON.tmp" "$CANON"
    chmod 600 "$CANON"
    echo "  seeded canonical token from legacy upload path (values never printed)"
  else
    fail "no token found at $CANON nor $LEGACY — owner must stage a token first (gh-rotate.sh)"
  fi
fi
chmod 600 "$CANON" 2>/dev/null
ok "canonical token present: $CANON ($(stat -c '%a' "$CANON"))"

# --- 2. helper scripts from repo (source of truth) --------------------------
for s in saos-git-cred.sh saos-git-askpass.sh; do
  [ -f "$REPO_SCRIPTS/$s" ] || fail "missing repo script $REPO_SCRIPTS/$s"
  cp "$REPO_SCRIPTS/$s" "$SECRETS_DIR/$s"
  chmod 700 "$SECRETS_DIR/$s"
  ok "installed $SECRETS_DIR/$s"
done

# --- 3. global git config ----------------------------------------------------
git config --global credential.helper "$SECRETS_DIR/saos-git-cred.sh"
git config --global core.askpass "$SECRETS_DIR/saos-git-askpass.sh"
ok "git config --global: credential.helper + core.askpass installed"

# --- 4. devgate broker ref ---------------------------------------------------
if command -v devgate >/dev/null 2>&1; then
  if [ ! -s "$DG_SECRETS" ]; then
    devgate --data-dir "$DG_DATA_DIR" secrets register github-pat --file "$CANON" >/dev/null 2>&1 \
      && ok "devgate broker: registered github-pat" \
      || echo "  WARN: devgate broker registration failed (non-fatal)"
  else
    ok "devgate broker ref github-pat present"
  fi
else
  echo "  WARN: devgate CLI not found — broker layer skipped (git layer still works)"
fi

# --- 5. live verification ----------------------------------------------------
FP=$(sha256sum "$CANON" | cut -c1-8)
echo "  token fingerprint: sha256:$FP (identifier only — value never printed)"

LOGIN=$(curl -s --max-time 15 -H "Authorization: Bearer $(cat "$CANON")" \
  -H "User-Agent: saos-bootstrap" https://api.github.com/user \
  | python3 -c "import json,sys
try: print(json.load(sys.stdin).get('login','?'))
except Exception: print('?')" 2>/dev/null)
[ "$LOGIN" != "?" ] || fail "GitHub API /user rejected the token — owner must rotate (gh-rotate.sh)"
ok "GitHub API: authenticated as $LOGIN"

# clean-env proof: NO GIT_ASKPASS, NO SAOS_GH_TOKEN_FILE, NO credential env
if env -i PATH=/usr/bin:/bin:/usr/local/bin HOME=/home/z \
  git ls-remote "$MAIN_REPO_URL" HEAD >/dev/null 2>&1; then
  ok "clean-env git ls-remote on main repo: SUCCESS (zero env vars — every-folder proof)"
else
  fail "clean-env git ls-remote FAILED — credential.helper not effective"
fi

echo "== BOOTSTRAP OK — plain git works in every folder from every chat =="
exit 0
