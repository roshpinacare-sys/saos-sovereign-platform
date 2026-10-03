# AX ADOPTION — v113 · הכרזה (DECLARATIVE AGENT ORCHESTRATION)

**Directive (rebuild-v113):** rebuild the lost v113.0.0 "הכרזה (AX)" wave (google/ax adoption) from the preserved recovery-v110 spec, after the tree-rollback incident rolled the platform back to v110.0.0.

**Method note:** the original wave's measured exam of google/ax was lost with the tree; the exam facts below are the ones established and preserved in the recovery spec ("already established, do not re-clone"). Everything else on this page is measured live on THIS box against THIS repo's code.

---

## The exam facts (established, preserved through the incident)

- **google/ax** is a **declarative agentic orchestration runtime**, license **Apache-2.0**.
- **kubectl-shaped semantics**: YAML manifests (`ax.io/v1alpha1`) for `Task` / `Workspace` / `Model`; the verb set is `apply` / `get` / `describe` / `suspend` / `resume` / `delete`.
- The **control plane is gated on Kubernetes** — the original exam asked it to run on this box and it **refused honestly** (no cluster). That refusal is itself the finding: the runtime's value is its semantics, not its substrate.

## The roast (honest, one plate)

1. **Cluster-gated quickstart** — the "try it" path assumes a live K8s control plane. On a 2-core sandbox box the entire quickstart is a refusal screen. Fine for an infra product; a wall for anyone who wanted to learn the semantics. **SAOS verdict: steal the semantics, rebuild the substrate.**
2. **v1alpha1 breaking-changes posture** — an `alpha` API version line means the manifest contract itself may shift under you between releases. Any system whose declared resources are the unit of work needs the gate to be version-exact; "close enough" parsing would translate drift into silent behavior changes. **SAOS verdict: exact-string apiVersion matching, near-misses refused.**
3. **Sandbox outside the repo** — the runtime's execution sandbox lives outside the working tree (cluster/containers/cloud). For an estate whose whole doctrine is "the hand passes through the guard, inside the house", delegating execution to an out-of-tree substrate is an audit hole. **SAOS verdict: workspace roots must be absolute paths inside the repo tree, verified to exist at apply time.**

## Adoption decisions (measured, each with a landing point)

| # | Source concept | Decision | Landing point | Why |
|---|---|---|---|---|
| 1 | Declarative manifests + strict shape (protojson discipline) | **ADOPTED — in code** | `src/lib/saos/ax.ts` `gateManifest()`: exact `ax.saos/v1alpha1`, zod `.strict()` at every level (unknown fields refused with the field path), YAML **and** JSON accepted, multi-doc refused, RFC1123 name port | A declaration that parses "generously" is a lie waiting to execute; the gate is the law |
| 2 | `apply` / `get` / `describe` / `suspend` / `resume` / `delete` verb set | **ADOPTED — in code** | `/api/saos/ax` (POST verbs; GET = get/describe) + the הכרזה view board | kubectl-shaped operations are the right human surface for long-lived agent work |
| 3 | Task ↔ Workspace/Model references | **ADOPTED — in code** | `AxWorkspace` / `AxModel` registries; `workspaceRef`/`modelRef` must name existing entries — undeclared refs refused (422) | References to things that do not exist are how declarative systems lie |
| 4 | Budgeted agent loop | **ADOPTED — in code** | `maxSteps ≤ 12`, `maxMs ≤ 300000` enforced at the gate AND before every step in `runTaskLoop()`; budgets visible as bars in the UI | Unbounded agent loops are OOM-generators on a 2-core body (see the v107/v112 OOM wars) |
| 5 | suspend / checkpoint / resume | **ADOPTED — in code** | `axSuspend()` writes `{stepsUsed, msUsed, historyDigest}`; `axResume()` returns to `Running` with identical counters; the loop re-reads fresh state before every step | Exact continuation is the difference between pause and restart-with-amnesia |
| 6 | Single-runner reconcile | **ADOPTED — in code** | `axReconcile()`: zombie sweep → continue Running → claim oldest Pending; module-level single-flight; others stay `Pending` | 2-core law: one task runs, the queue is visible and honest |
| 7 | Zombie honesty | **ADOPTED — in code** | `axZombieSweep()`: `Running` with no step for >10min → `RunnerLost` + condition | A task that lies "Running" forever corrupts the whole board |
| 8 | K8s control plane, isolated substrate, redis state, GCR runner | **REJECTED** | — | Cloud/gated/cluster-bound; adopting them on this box would be green-lies. The semantics run on SQLite+Prisma+zod+house-LLM instead |

## What changed in SAOS (the wave's measured surface)

- `prisma/schema.prisma` — additive: `AxTask` (name unique RFC1123, status lifecycle `Pending|Running|Suspended|Succeeded|Failed|Terminating|RunnerLost`, `conditionsJson`, budgets, `checkpointJson`), `AxStep` (per-step journal: kind work|finish|abort|repair, ok|fail, rawOutput ≤8KB, real tokens, ms), `AxWorkspace`, `AxModel`.
- `src/lib/saos/ax.ts` — the gate + the runner + the registries + the describe board (single module, ~700 lines, house-law comments).
- `src/app/api/saos/ax` — house API shape: 64KB body cap, 4s POST rate-limit, requireAuth fail-closed, oplog entry per POST, audit, Hebrew fail-closed errors, 422-style gate refusals.
- `src/components/saos/views/ax.tsx` — the הכרזה view (מחקר group): KPI row, apply console with explicit refusal rendering, tasks board with status pills / conditions / budget bars / suspend-resume-delete, step journal (`max-h-96` scroll), registries panels, stolen-vs-refused callout, version stamp v113.0.0 הכרזה.
- `skills/ax-orchestrator/SKILL.md` — the playbook with provenance (adapted-from google/ax Apache-2.0) and gate laws.
- `.gitignore` — `!skills/ax-orchestrator/` exception (house artifact, tracked).
- `src/lib/saos/version.ts` — `113.0.0` + codename הכרזה (AX).

## Live proofs (measured in the rebuild-v113 verification, 2026-10-03 — raw curl JSONs quoted in the worklog entry `rebuild-v113`)

- **Gate refusals ×4, all HTTP 422 with explicit Hebrew reasons** — unknown field (`typoField` named inside the refusal), bad apiVersion (`ax.io/v1alpha1` refused with the exact-string law), bad name (`Bad_Name_Uppercase` refused by the RFC1123 port), 2-doc YAML (refused with the document count). The house 4s POST rate-limit was also measured live — back-to-back POSTs answered `429` with the window message before the gate even parsed.
- **Live single run to an honest terminal** — a real small task (summarize `src/lib/saos/version.ts`, workspace `saos-repo`, maxSteps 4/maxMs 120000) went Scheduled → Claimed → step journal → terminal. During the verification window the upstream LLM was quota-blocked (429): the runner retried inside the step (5s → 20s backoff, all waits counted in the journaled ms), then failed **closed** — `Failed` + `RunnerError` condition + a journaled `fail` step with honest 0 tokens. Never a fake success. When quota was available (same code path, measured at 14:09 before the quota window closed), the identical shape ran to `Succeeded`/`TaskFinished` with real usage tokens journaled per step (5406 in / 181 out, 6043ms) and the analyst's summary in the terminal condition.
- **Suspend/resume exact continuation (measured mid-step)** — suspend landed while a step was in flight: checkpoint `{stepsUsed, msUsed, historyDigest}` written at the suspend state; the in-flight step then journaled (its `ms` counted); resume returned the task to Running with the counters untouched (`stepsUsed=1 · 5086ms` carried exactly into the post-resume loop, which continued to step 2 — no restart, no amnesia, no double-count). The condition chain shows the full honest story: `Scheduled → Claimed → TaskSuspended → TaskResumed`.
- **Delete ×2** — tasks deleted via `Terminating` teardown (steps journal cascaded): follow-up `kubectl get` proves absence (`ax_v113_walk_present:false`, `ax_v113_walk2_present:false`) — no ghost rows.
- **Zombie sweep** — code-reviewed: `axZombieSweep()` runs first in every reconcile; a `Running` task silent >10min becomes `RunnerLost` with a condition naming the silence window.
- **Board (final GET)** — KPIs by status, per-task budget bars, conditions, and the single-runner state (`busy:false`, law quoted) all read back from `/api/saos/ax` alone — provable without touching the source.

## Honest non-goals

- The analyst is a **blocked-JSON LLM loop**, not a tool-calling runtime: it reads only the context measured from the workspace root and injected into its prompt (≤4 files × 5KB + shallow listing, capped 16KB). It cannot execute, write, or network. That is law-8 discipline, not a missing feature.
- One runner per process by design; a multi-node fleet would need the queue to move to a real lock — deliberately not built (there is exactly one web body in this house).
- `ax.io/v1alpha1` upstream shapes are NOT wire-compatible with `ax.saos/v1alpha1`: we adopted the semantics and the verb set, not the schema. The SAOS schema is what `gateManifest()` says it is — no pretending otherwise.
