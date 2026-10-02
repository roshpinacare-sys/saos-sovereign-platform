# AGENTS.md — saos-sovereign-platform (kernel + army + mini-services)

> Task 19: full LHE harness protocol adopted from walkinglabs/learn-harness-engineering
> (five subsystems at this repo root). Platform is the fleet's kernel: the Prisma
> schema of record, the swarm-army (roles, recruits, keepers), the mini-services
> (evm-mesh, gate-agent, keeper, swarm-agents), and BLOC-STATE — the one language
> map of all 16 repos. Zero secrets at HEAD (env-first key chains, Task 13-c2b).

## Startup Workflow (before writing code)
1. **Before writing code**: run `./init.sh` — structure + schema presence +
   lint when deps are installed; fix a red baseline before new scope.
2. Read `docs/BLOC-STATE-2026-10-02.md` — the language map: every repo × role
   × engine × proof pointer. Do not invent parallel vocabulary.
3. Read `feature_list.json` — pick **one feature at a time**.
4. Check `progress.md` (Current State · Current Objective · Recommended Next
   Step) and `session-handoff.md` (Blockers · Files · Next Session).
5. `git log --oneline -5` — sibling waves are real (v99→v101 lesson):
   `git pull --rebase` before any push; restore byte-exact, never clobber.

## Working rules (the law)
- **The schema is the spine**: `prisma/schema.prisma` defines the army's
  roles, books, and rules; primitive types are never lists; the db file lives
  in `db/`. Change the schema → `bun run db:generate` + document.
- **Env-first key chains**: tokens/WIFs arrive via env / canonical
  `steem/agent/keys` paths (gh-token.ts chains, Task 13-c2b); fail-closed.
- **Measured, never estimated**: books carry executor identity + timestamps;
  `[object Object]`-class concat bugs are the third-time family.
- **One writer per book**: desks own their lanes; reconciliation beats drift;
  never double-run another runtime's lane (DELEGATION-SELECTION LAW).
- **Rebase-first, never force.**

## Verification Commands
- `./init.sh` — the standard entrypoint (structure + schema + lint-if-deps)
- `bun run lint` — ESLint over the tree (deps installed)
- `bun run db:generate` — Prisma client regenerates clean (schema sanity)
- Full type/build gates run in org CI (org-selftests: platform leg tsc)

## Scope rules
- **One feature at a time** — exactly one unfinished feature from
  `feature_list.json` to done-with-evidence.
- **Stay in scope** — mini-services are independent bun projects with their
  own ports; don't cross-wire them into the Next.js app; keep the gateway
  contract (`?XTransformPort=`) intact.

## Definition of Done
A change is done only when ALL of the following are true: behavior
implemented, verification actually ran (evidence in `feature_list.json` or
`progress.md`), schema/docs consistent, commit pushed rebase-first, and the
repo stays restartable from this file + `./init.sh`.

## End of Session (before ending)
1. Update `progress.md` and `feature_list.json` (status + evidence).
2. Record unresolved risks in `session-handoff.md`.
3. Commit with a fact-bearing message; `git pull --rebase` then push.
4. Leave the tree clean for the next session to run `./init.sh`.
