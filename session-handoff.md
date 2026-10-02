# Session Handoff — saos-sovereign-platform

## Blockers
- Owner-only items (key material) belong to the steem estate, not here.
- feat-006 needs keeper live observation windows (time, not code).

## Files
- `AGENTS.md` — landing protocol (read first, run init.sh second)
- `feature_list.json` / `progress.md` / this file — state layer
- `prisma/schema.prisma` — the spine (roles, books, rules)
- `docs/BLOC-STATE-2026-10-02.md` — the 16-repo language map
- `mini-services/` — evm-mesh, gate-agent, keeper, swarm-agents
- `scripts/swarm-agents/` — army registration + detectors

## Next Session
1. `git pull --rebase origin main` (sibling waves are real).
2. `./init.sh` — red baseline? Repair before new scope.
3. Check BLOC-STATE still matches reality after any repo evolution.
4. One feature from `feature_list.json` to done-with-evidence.
5. Update state files; push rebase-first; env-first keys, fail-closed.
