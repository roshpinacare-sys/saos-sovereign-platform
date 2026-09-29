#!/bin/sh
# SAOS GitHub askpass — chain version.
# Used by flows that explicitly set GIT_ASKPASS (e.g. node broadcast scripts).
# Same resolution chain as saos-git-cred.sh: canonical -> devgate broker -> legacy upload.
case "$1" in
  *Username*) echo "x-access-token" ;;
  *)
    for f in \
      /home/z/.secrets/github-token \
      /home/z/.devgate/secrets/github-pat \
      /home/z/my-project/upload/Roshcaregt.txt
    do
      if [ -s "$f" ]; then
        # first non-empty file wins
        exec cat "$f"
      fi
    done
    exit 1
    ;;
esac
