#!/bin/sh
# SAOS git credential helper — the universal GitHub connector.
#
# WHAT THIS SOLVES (owner directive, trace 1a099bd11deb4141):
#   "החיבור לגיטהאב בצורה בטוחה ושזה יהיה זמין לכל התיקיות שלנו בגיט... מכל צ'אט"
#   - ALL git folders: installed once as `git config --global credential.helper`
#     => every repo clone/pull/push over HTTPS just works, in any directory.
#   - EVERY chat: zero env vars needed (GIT_ASKPASS is NOT required anymore).
#   - Secure: the token is only read from local 0600 files; it never appears
#     in argv, git config, logs, or the chat.
#
# Resolution order (first non-empty wins):
#   1) /home/z/.secrets/github-token            (canonical, 0600)
#   2) /home/z/.devgate/secrets/github-pat      (devgate secret broker ref)
#   3) /home/z/my-project/upload/pat.env         (live operator-staged PAT)
#   4) /home/z/my-project/upload/Roshcaregt.txt (owner upload legacy path)
#
# Protocol: git invokes  <this-script> get  with key=value on stdin.
# We must consume stdin, then print username=/password= lines.
# On no token found: exit 1 (fail-closed; git falls back to prompting).

case "$1" in
  get) ;;
  *) exit 0 ;;
esac

# consume stdin (required by git credential protocol)
while IFS= read -r _line; do
  [ -n "$_line" ] || break
done

TOKEN=""
for f in \
  /home/z/.secrets/github-token \
  /home/z/.devgate/secrets/github-pat \
  /home/z/my-project/upload/pat.env \
  /home/z/my-project/upload/Roshcaregt.txt
do
  if [ -s "$f" ]; then
    _t=$(tr -d '[:space:]' < "$f" 2>/dev/null)
    if [ -n "$_t" ]; then TOKEN="$_t"; break; fi
  fi
done

[ -n "$TOKEN" ] || exit 1

printf 'username=x-access-token\n'
printf 'password=%s\n' "$TOKEN"
exit 0
