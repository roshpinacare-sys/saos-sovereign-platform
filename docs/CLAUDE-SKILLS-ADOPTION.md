# CLAUDE-SKILLS ADOPTION — v110 · בית-המלאכה-לכישורים (SKILL FOUNDRY)

**Owner directive (2026-10-03):** "מה לגבי זה https://github.com/alirezarezvani/claude-skills"

**Method:** shallow-clone of the full repo to /tmp (measured: **65MB, 3104 markdown files, 41 top-level domains, 388 declared skills + 118 agents + 7 personas + 150 commands, 706 Python CLI tools**, README-claimed 5,200+ stars). Every number below was measured on the clone — not quoted from its README.

---

## The roast (honest, one plate)

### What it actually is

A **content-marketing-shaped skills catalog**: the same SKILL.md discipline (agentskills.io standard, YAML frontmatter + instructions + optional scripts/references) replicated across every professional domain someone might search for — engineering, marketing, C-level personas, finance, compliance, research ops, productivity, project management. It is good at what a catalog is good at: breadth, discoverability, consistent packaging, multi-tool distribution (.claude/.codex/.gemini/.vibe/.hermes mirror trees).

### Where it is genuinely strong

1. **The packaging standard itself** — frontmatter `name/description` with trigger phrases, `license`, `metadata` provenance. Small, machine-loadable, human-readable. This is the right unit of capability, and the ecosystem momentum behind it is real (13 tools speaking the same format).
2. **A handful of disciplines are first-rate** — `loop-library`, `agent-harness`, `zero-hallucination-coder`, `hivemind`, `grill-me`, and the `aeo` skill are tight, opinionated, and written by people who clearly ran the loops they describe. These six are what we stole (below).
3. **Honest attribution culture** — MIT, upstream credits preserved (e.g. grill-me credits Matt Pocock verbatim), "derived from" headers everywhere. A catalog that admits its lineage is a catalog you can trust enough to steal from.

### Where it is theater (and why we reject it)

1. **3104 markdown files, and the mass is not expertise** — the majority is domain prose (copywriting guides, contract templates, persona flavor text, wedding/oncology-domain content). A skills repo whose skill-to-filler ratio needs this much padding is optimizing for search presence, not agent capability. **SAOS verdict: catalog ≠ capability. We took the 6 disciplines, not the shelf.**
2. **706 "stdlib-only Python tools"** — a different runtime (SAOS is bun/TS), a different trust model, and most are thin wrappers around prompts (extract decision branches, generate questions). Vendoring them would be dependency bloat disguised as power. **Rejected: the tool is the discipline's shadow; we took the discipline and wrote it into TS where it earns its keep.**
3. **The 13-platform mirror trees** (`.gemini/`, `.codex/`, `.vibe/`, `.hermes/`) — distribution infrastructure for a catalog product. SAOS has exactly one runtime and one loader. **Rejected.**
4. **Metric-as-identity** — the README's identity is its badge row (388! 118! 150! 5,200+ stars!). Counting is not capability; SAOS's own doctrine (feature_list evidence rows, verify gates, measured runs) exists precisely because "N shipped" without runnable proof is the הצגה we purge here weekly. **Lesson taken, not just roast: our own version bumps must keep passing the same test we just applied to them.**
5. **The orchestration doc's Rule 5** — "The human decides" as the closing rule of the coordination pattern. Understandable for a public catalog; wrong for a sovereign autonomy whose owner directive is explicit and standing: **the sovereign is the manager; nothing waits.** We adopt the pattern (phases, personas, handoffs) and replace the rule with house law: decisions are made by the standing directives, evidence gates arbitrate, and the owner audits afterwards.
6. **hivemind's external dependency** — the actual swarm runs on a third-party free-tier opencode CLI. SAOS declines the dependency (trust boundary + free-tier pricing is not ours to guarantee) and keeps the five invariants, which transfer perfectly onto role-workers + mini-services + hands.

### Scoring the catalog as a whole

Measured against our own harness-engineering scale (the same one that scored learn-harness-engineering 20/100 on this repo pre-adoption): **claude-skills scores high on packaging and distribution, medium on discipline density, low on verification** — almost none of the 388 skills ship a runnable gate that proves its own loop works. The six we adopted are the exceptions that prove the rule. Net: a **quarry, not a foundation** — come, take specific stones, leave the mountain.

---

## Adoption decisions (measured, each with a landing point)

| # | Source | Decision | Landing point | Why |
|---|---|---|---|---|
| 1 | `loop-library` (named terminal states + feedback cycle) | **ADOPTED — in code** | `src/lib/saos/loop-discipline.ts`: `TERMINAL_STATES` (7 states), `classifyRunOutcome` (error never maps to success; missing evidence = fail, fail-closed), `terminalFromBench`; wired into every bench trajectory via `runBenchTask` (the single choke point) + visible `TerminalBadge` in the hands board UI | The crisp missing piece of our cycle discipline: runs used to end in pass/fail only; now a run can end honestly in no-op/blocked/approval-required/exhausted/stagnated — named, enforced, displayed |
| 2 | `agent-harness` (goal_compiler refuses vague goals) | **ADOPTED — in code** | `compileGoal()` in `loop-discipline.ts`: deterministic fail-closed rejection with explicit reasons (no action verb / vagueness markers / no verify criterion) | "A goal without a verb is a dream" — the fleet's worker ops should be refused at the gate, not interpreted generously |
| 3 | `zero-hallucination-coder` (5-phase loop, KNOWN/INFERRED/UNKNOWN, YAGNI ladder) | **ADOPTED — as skill** | `skills/zero-hallucination-coder/SKILL.md` (SAOS-adapted: house stack, OOM lessons, fail-closed, version.ts single-source) | Matches the anti-fake-green doctrine 1:1; its Phase-5 "it compiles is not evidence" is already house law — now it has a nameable procedure |
| 4 | `hivemind` (swarm invariants) | **ADOPTED — as skill, dependency declined** | `skills/swarm-discipline/SKILL.md` — worktree isolation, single compact-JSON contract, parallel spawn, orchestrator-only merger, fallback ladder + anti-pattern table | The invariants govern our existing swarm (role-workers, swarm-agents, hands); the opencode dependency does not cross our trust boundary |
| 5 | `grill-me` (interrogation discipline) | **ADOPTED — as skill** | `skills/grill-me/SKILL.md` (SAOS additions: codebase-first is house law; evidence-cited recommendations; terminal state per branch) | The roast procedure formalized: one branch, one question, one recommended verdict with evidence |
| 6 | `aeo` (Answer Engine Optimization) | **ADOPTED — as skill + policy input** | `skills/aeo-answer-engine-optimization/SKILL.md` with the SAOS dual policy: AEO for the public story, hard stealth for army internals, keys/vault never | Direct input to the standing SEO+stealth directive: citability techniques + the explicit "citing an internal detail would be a leak" boundary |
| 7 | SKILL.md packaging standard (frontmatter + provenance metadata) | **ADOPTED — de facto** | All five vendored skills follow it (name/description/license/metadata with adapted-from + saos-adoption) | The right unit of loadable capability; provenance keeps lineage honest |
| 8 | 706 Python tools, 13-platform mirrors, ~380 domain-skill mass, "the human decides" closing rule | **REJECTED** | — | Runtime mismatch; distribution theater; filler mass; and a closing rule contradicted by the owner's standing sovereignty directives |

## What changed in SAOS (the wave's measured surface)

- `src/lib/saos/loop-discipline.ts` — new module: the two code-level thefts (terminal-state taxonomy + goal compiler), fail-closed by construction.
- `src/lib/saos/hands.ts` — additive: `terminal` field on every `BenchTrajectory`, derived uniformly at the `runBenchTask` choke point (budget overrun → `exhausted`, pass → `success`, else `fail`); no runner was hand-edited to state its own verdict — the gate derives it.
- `src/components/saos/views/hands.tsx` — the hands board now displays the named terminal state (Hebrew-labeled badge) next to the pass/fail verdict: honesty, visible.
- `skills/` +5 SAOS-adapted playbooks with provenance metadata (zero-hallucination-coder, loop-doctor, grill-me, swarm-discipline, aeo-answer-engine-optimization).
- Version bump 109.0.0 → **110.0.0 · בית-המלאכה-לכישורים (SKILL FOUNDRY)** in `src/lib/saos/version.ts` (single source of truth).

## Honest non-goals

- The `compileGoal` gate is exported and tested by tsc but is **not yet wired into role-worker invocation** — wiring it is wave-23 work (needs a measured caller-contract change; doing it silently today would break live workers).
- `stagnated` and `approval-required` are defined and displayed but not yet produced by any live loop — they exist because the taxonomy is now enforced in code, and the next loops that need them inherit them honestly.
- We did not add a new verify gate for loop-discipline: tsc covers compile; the existing gate-12 hands-probe exercises the touched file. A dedicated gate for a taxonomy module would be a gate for a type definition — ceremony, not proof.
