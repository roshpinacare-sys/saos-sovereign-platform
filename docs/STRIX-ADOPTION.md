# STRIX ADOPTION — v111.0.0-content · RED TEAM (strix)

**Directive (rebuild-v111):** rebuild the lost v111.0.0 "RED TEAM (strix)" wave (usestrix/strix adoption — the autonomous security-audit team member) from the preserved recovery-v110 spec, after the tree-rollback incident rolled the platform back to v110.0.0. The v113.0.0 line already shipped; this wave's **content** re-materializes as `red-team-v111-rebuild` inside the v113.0.0 version line — the version number itself is NOT rewound.

**Method note:** the original wave's measured exam of usestrix/strix was lost with the tree; the exam facts below are the ones established and preserved through the recovery spec. Everything else on this page is measured live on THIS box against THIS repo's code.

---

## The exam facts (established, preserved through the incident)

- **usestrix/strix** is an **autonomous security-audit team member** (a pentest agent with its own harness, not a library).
- Measured on the original exam session: **clone `99c0711` · 15MB · 517 files · 130 python files · 75 internal packs · 9 consumer skills** — a small, dense core with a skills surface.
- Its discipline: findings are evidence-backed with explicit confidence, probes end in an honest exit code, and the agent operates inside a declared authorization boundary.
- The **harness is docker-gated** — the original exam asked it to run on this box and it **refused honestly** (no docker, no kali tooling). That refusal is itself the finding: the value is the discipline, not the container.

## The roast (honest, one plate)

1. **Docker-gated harness** — the "run it" path assumes a live docker runtime with the kali toolchain. On a 2-core sandbox box the entire quickstart is a refusal screen. **SAOS verdict: steal the discipline, rebuild the harness** on fetch + node:fs + git plumbing.
2. **External-scan posture** — a pentest member that free-roams the internet is a legal/ops liability for a sovereign estate; most of its real value on this platform is pointing at **itself**. **SAOS verdict: the wall — loopback (127.0.0.1/localhost) + repo tree (`/home/z/my-project/**`) only; foreign targets refuse BEFORE any network/fs touch, and the wall gates the house's own targets too.**
3. **Secret-material handling** — audit tooling that reads key files becomes a key-custody problem of its own. **SAOS verdict: zero content ever read — filename patterns (`git ls-files` × `*.pem`/`*key*`/`.env*`) and `git check-ignore` status only.**

## Adoption decisions (measured, each with a landing point)

| # | Source concept | Decision | Landing point | Why |
|---|---|---|---|---|
| 1 | Exit-code taxonomy (0 = clean-within-declared-coverage, 1 = fatal, 2 = findings) | **ADOPTED — in code** | `src/lib/saos/redteam.ts` `runRedteam()` — exit derived from findings + probe health; failed probes shrink declared coverage and are reported, never dropped | An exit code that can mean two things is a lie generator; failed sensors must never read as "clean" |
| 2 | Mandatory counterevidence finding schema (evidence · poc · confidence+rationale · severity_change_conditions · fix_effort · cwe) | **ADOPTED — in code** | `mkFinding()` — **build-time rejection** of any finding missing the falsification path | A finding without a way to be disproven is an opinion; opinions do not ship |
| 3 | Authorization wall before any touch (strix authorization-wall) | **ADOPTED — in code** | `assertInBoundary()` — loopback + repo-tree only, Hebrew refusal, called by every probe AND at the API gate (`refusedBeforeTouch:true` on the 403) | The wall that exempts "trusted callers" is not a wall |
| 4 | Raw-facts-even-when-clean per probe | **ADOPTED — in code** | `probesRun[]` carries `facts` for all 7 probes (header sets, status codes, hit counts, tracked-file counts) | Clean must be a measurement, not a shrug |
| 5 | Artifacts per run | **ADOPTED — in code** | `scripts/artifacts/redteam-run-<ts>.json` on every run (including partial failures) + board reads the last run | The evidence outlives the console |
| 6 | Budget honesty (whole-run ≤60s · per-probe 8s) | **ADOPTED — in code** | `RUN_BUDGET_MS` / `PROBE_TIMEOUT_MS` + skipped-probes ledger (`budgetExhausted:true`) | Unbounded scans are OOM/timeout generators on a 2-core body (v107/v112 wars) |
| 7 | Dedup discipline between overlapping sensors | **ADOPTED — in code** | secret-sweep results land as `source:"bridged:secret-sweep"`; name-level (tracked-secrets) vs content-level (sweep) layers explicitly non-overlapping | Two sensors reporting one issue twice is how noise kills signal |
| 8 | Docker harness · kali deps · free-roam external scanning | **REJECTED** | — | Gated/cloud/out-of-boundary; adopting them on this box would be green-lies. The discipline runs on house parts, loopback-only |

## What changed in SAOS (the wave's measured surface)

- `src/lib/saos/redteam.ts` — the engine: `assertInBoundary` (the wall) + 7 probes + `mkFinding` (schema enforces counterevidence at build time) + exit taxonomy + artifacts writer (single module, house-law comments).
- `src/proxy.ts` — **the Next 16 file (middleware.ts was RENAMED to proxy.ts — this is the file Next actually loads)**: X-Content-Type-Options nosniff · Referrer-Policy strict-origin-when-cross-origin · Permissions-Policy camera=()/microphone=()/geolocation=() · X-Frame-Options DENY enforced now; **CSP staged as Content-Security-Policy-Report-Only** per v111 doctrine (report-first, enforcement after violation-inventory review); matcher excludes `_next/static` and `favicon.ico`.
- `src/app/api/saos/redteam` — house API shape: GET public board (flat envelope), POST `{action:"run", target?}` with requireAuth, 64KB body cap, 4s POST rate-limit, oplog per POST (boundary refusals logged too), audit, Hebrew fail-closed errors, 403 `refusedBeforeTouch:true` on foreign targets.
- `src/components/saos/views/redteam.tsx` — the אדום view (מחקר group): boundary-law panel, stolen-vs-refused callout, run console (7 probe cards with per-probe ok/findings/ms), live boundary-refusal console, exit-code banner (0/2 both honest, 1 red), findings board grouped by severity with evidence + counterevidence visible, artifacts list (`max-h-96` slim scroll), stamp v113.0.0 · RED-TEAM-v111.
- `skills/strix-pentest/SKILL.md` — the playbook with provenance (adapted-from usestrix/strix) and the wall/taxonomy/schema laws; `.gitignore` exception `!skills/strix-pentest/` (house artifact, tracked).
- `feature_list.json` — `red-team-v111-rebuild` entry (active, following the ax-orchestrator-v113 shape).
- `src/lib/saos/version.ts` — **NOT touched**: the platform line is v113.0.0; this wave records v111.0.0 content rebuilt post-recovery.

## Live proofs (measured in the rebuild-v111 verification — raw curl JSONs quoted in the worklog entry `rebuild-v111`)

- **Boundary refusal (BEFORE any network/fs touch)** — authenticated POST with `{action:"run", target:"http://example.com"}` → HTTP 403, `refusedBeforeTouch:true`, Hebrew refusal naming the wall (loopback + repo-tree only). Zero packets toward the foreign host.
- **Auth fail-closed live** — credential-less POSTs to the 3 sensitive endpoints measured 401/403 (gate proven); the auth-fail-closed probe reports the same statuses as raw facts.
- **Headers before/after proxy.ts** — measured live: before = no security headers at all (8 plain headers incl. `X-Powered-By`); after proxy.ts lands = the 4 enforced headers + CSP-Report-Only present **on the next server load of proxy.ts** (Next 16 dev loads proxy at boot; if a recycle is needed it is recorded honestly in the run's facts).
- **Artifacts on disk** — `scripts/artifacts/redteam-run-<ts>.json` written per run; the GET board lists them with size/age.

## Honest non-goals

- The original spec's "hands surface redteam loopback-only + bench task redteam-self-probe" wiring is **not** part of this rebuild's scope (recorded honestly; the hands layer can be wired in a later wave without contract changes — the engine and its exit taxonomy are already library-shaped).
- CSP ships **Report-Only** by doctrine: enforcement is one flag away but requires the violation-inventory review first (breaking the live 113-wave UI with an unreviewed CSP would trade honesty for theater).
- The engine measures patterns and gates — it does not attempt exploit development, runtime fuzzing, or deep data-flow analysis; those are declared out of coverage rather than pretended.
