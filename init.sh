#!/usr/bin/env bash
# platform harness init — the standard verification entrypoint (LHE adoption, Task 19)
cd "$(dirname "$0")"   # location-independent
set -e

echo "[platform-init] structure"
test -f package.json || { echo "FAIL: package.json missing"; exit 1; }
test -f prisma/schema.prisma || { echo "FAIL: prisma/schema.prisma missing"; exit 1; }
test -d mini-services || { echo "FAIL: mini-services/ missing"; exit 1; }
test -f docs/BLOC-STATE-2026-10-02.md || { echo "FAIL: BLOC-STATE map missing"; exit 1; }

echo "[platform-init] mini-services sanity (each is an independent bun project)"
for svc in mini-services/*/; do
  [ -f "${svc}package.json" ] || { echo "FAIL: ${svc} missing package.json"; exit 1; }
  echo "  ok ${svc}"
done

echo "[platform-init] lint (deps-installed only; org-selftests always runs tsc)"
if [ -d node_modules ]; then
  bun run lint >/dev/null 2>&1 && echo "  lint ok" || { echo "FAIL: lint"; exit 1; }
else
  echo "  SKIP: node_modules absent (fresh clone) — org-selftests covers lint/build/type in CI"
fi

echo "PLATFORM-INIT-OK — restartable from AGENTS.md + BLOC-STATE"
