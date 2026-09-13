#!/bin/sh
# ============================================================================
# gh-rotate.sh — owner-driven GitHub PAT rotation (fail-closed, zero exposure)
# ============================================================================
# THE SECURE REPLACEMENT FLOW (owner runs the GitHub part; the token never
# passes through chat, argv, logs or git config — ADR-005 broker doctrine):
#
#   1. OWNER (in GitHub web): generate the new PAT
#        - recommended: fine-grained PAT, resource owner = roshpinacare-sys,
#          repository access = the 11 partner repos + saos-sovereign-platform,
#          permissions = Contents: Read+Write (+ Workflows: RW if workflow
#          files will ever be pushed).
#        - acceptable alternative: classic PAT with scopes: repo, workflow.
#   2. OWNER stages the new token on this machine WITHOUT chat:
#        - upload it as a file (like Roshcaregt.txt was uploaded), or
#          place it at:  /home/z/my-project/upload/new-pat.txt  (0600)
#   3. OWNER tells the chat only: "new PAT staged" (no value, ever).
#   4. Run:   bash /home/z/my-project/platform-latest/scripts/gh-rotate.sh
#        - validates the token against the GitHub API (login + per-repo push
#          permission on ALL 12 repos) BEFORE touching anything,
#        - installs atomically to every store (canonical, devgate broker,
#          legacy upload copy) — a rotation is a broker re-registration,
#        - re-verifies with a clean-env git ls-remote,
#        - prints login/scopes/fingerprint only. Never the token.
#   5. OWNER (in GitHub web): revoke the OLD PAT -> rotation complete.
# ============================================================================

set -u

STAGE_CANDIDATES="/home/z/my-project/upload/new-pat.txt /home/z/my-project/upload/pat.txt /home/z/my-project/upload/Roshcaregt.txt"
CANON="/home/z/.secrets/github-token"
LEGACY="/home/z/my-project/upload/Roshcaregt.txt"
DG_SECRETS="/home/z/.devgate/secrets/github-pat"
SECRETS_DIR="/home/z/.secrets"
export DG_DATA_DIR="/home/z/.devgate"
MAIN_REPO_URL="https://github.com/roshpinacare-sys/saos-sovereign-platform.git"
ORG="roshpinacare-sys"
REPOS="saos-sovereign-platform roshpina Saosmartwallet steem saos-jummper saos-sovereign-foundry saos-control-center saos-dex Adsmarket Sdk anchor-baseline Project-files"

fail() { echo "ROTATE-ABORT: $1" >&2; exit 1; }
ok()   { echo "  ok: $1"; }

echo "== SAOS GitHub PAT rotation =="

# --- locate staged new token ------------------------------------------------
STAGE=""
for c in $STAGE_CANDIDATES; do
  [ -s "$c" ] || continue
  # a staged rotation file must DIFFER from the currently installed token
  if [ -f "$CANON" ] && [ "$(sha256sum "$c" | cut -d' ' -f1)" = "$(sha256sum "$CANON" | cut -d' ' -f1)" ]; then
    echo "  skip: $c is identical to the installed token (not a rotation)"
    continue
  fi
  STAGE="$c"; break
done
[ -n "$STAGE" ] || fail "no NEW token staged. Owner: put the new PAT at /home/z/my-project/upload/new-pat.txt (never paste it in chat), then re-run."
echo "  staged new token found: $STAGE"

NEW=$(tr -d '[:space:]' < "$STAGE")
[ -n "$NEW" ] || fail "staged file is empty after trimming"
umask 077

GH() { curl -s --max-time 20 -H "Authorization: Bearer $NEW" -H "User-Agent: saos-rotate" "$@"; }

# --- validate BEFORE any change (fail-closed) -------------------------------
HDR=$(GH -D - -o /tmp/rotate-user.json https://api.github.com/user)
echo "$HDR" | grep -qi '^HTTP/.* 200' || fail "GitHub API rejected the staged token (HTTP $(echo "$HDR" | head -1 | awk '{print $2}')). Nothing was changed."
LOGIN=$(python3 -c "import json;print(json.load(open('/tmp/rotate-user.json')).get('login','?'))" 2>/dev/null)
[ "$LOGIN" != "?" ] && [ -n "$LOGIN" ] || fail "could not read login from API response. Nothing was changed."
echo "  validated: authenticates as $LOGIN"

SCOPES=$(echo "$HDR" | grep -i '^x-oauth-scopes:' | cut -d' ' -f2-)
if [ -n "$SCOPES" ]; then
  echo "  scopes: $SCOPES"
  echo "$SCOPES" | grep -q 'repo' || fail "classic PAT lacks the 'repo' scope — Contents push will fail. Nothing was changed."
fi

echo "  per-repo push permission check:"
MISSING=0
for r in $REPOS; do
  PERM=$(GH "https://api.github.com/repos/$ORG/$r" | python3 -c "
import json,sys
try:
  d=json.load(sys.stdin)
  p=d.get('permissions',{})
  print('PUSH' if p.get('push') else ('READ' if p.get('pull') else 'NONE'))
except Exception: print('NONE')")
  if [ "$PERM" = "PUSH" ]; then echo "    $r: push"; else echo "    $r: $PERM  <-- INSUFFICIENT"; MISSING=1; fi
done
rm -f /tmp/rotate-user.json
[ "$MISSING" = "0" ] || fail "staged token cannot push to all $ORG repos. Nothing was changed. Fix the PAT's repository access on GitHub and re-stage."

# --- atomic install to all stores (only after full validation) --------------
install_to() {  # install_to <target-path>
  d=$(dirname "$1"); [ -d "$d" ] || mkdir -p "$d"
  chmod 700 "$d" 2>/dev/null
  printf '%s\n' "$NEW" > "$1.tmp" && chmod 600 "$1.tmp" && mv -f "$1.tmp" "$1"
}

install_to "$CANON";               ok "canonical store updated: $CANON"
install_to "$LEGACY";              ok "legacy upload copy synced: $LEGACY"
if command -v devgate >/dev/null 2>&1; then
  install_to "$DG_SECRETS" && ok "devgate broker re-registered: github-pat (rotation = broker re-registration)"
else
  echo "  WARN: devgate CLI not found — broker copy left as-is; run saos-git-bootstrap.sh later"
fi

# --- post-install live proof (clean env, zero vars) -------------------------
FP=$(sha256sum "$CANON" | cut -c1-8)
if env -i PATH=/usr/bin:/bin:/usr/local/bin HOME=/home/z \
  git ls-remote "$MAIN_REPO_URL" HEAD >/dev/null 2>&1; then
  ok "clean-env git ls-remote on main repo: SUCCESS with the NEW token"
else
  fail "post-install ls-remote failed — investigate before revoking the old PAT (stores were already updated; check network)"
fi

echo "== ROTATION COMPLETE =="
echo "  login:       $LOGIN"
echo "  fingerprint: sha256:$FP"
echo "  stores:      $CANON + $LEGACY + devgate:github-pat (all 0600)"
echo "  NEXT STEP (owner, in GitHub web): revoke the OLD PAT —"
echo "  https://github.com/settings/tokens — until then both are live."
exit 0
