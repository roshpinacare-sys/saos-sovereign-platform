#!/bin/bash
# hc-inbox-poller.sh — background poll of the temp mailbox for the Steemit
# verification email. Logs every poll; writes the raw email JSON when found.
source /tmp/hc-mail.env
OUT=/tmp/hc-inbox-status.txt
echo "poller started $(date -u +%H:%M:%S)" > "$OUT"
for i in $(seq 1 60); do
  RESP=$(curl -s --max-time 15 "https://api.mail.tm/messages" -H "Authorization: Bearer $TOKEN")
  N=$(echo "$RESP" | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('hydra:member',[])))" 2>/dev/null || echo "ERR")
  echo "poll#$i $(date -u +%H:%M:%S) messages=$N" >> "$OUT"
  if [ "$N" != "0" ] && [ "$N" != "ERR" ] && [ -n "$N" ]; then
    echo "$RESP" > /tmp/hc-inbox-found.json
    echo "FOUND $N message(s) at $(date -u +%H:%M:%S)" >> "$OUT"
    exit 0
  fi
  sleep 45
done
echo "TIMEOUT no email after 60 polls" >> "$OUT"
