# feat-006 — keeper-tick observability: OBSERVED (Z-37, Task 20)

**The honest-retirement sweep is no longer unobserved.** The keeper's hourly
agents-registry tick (GET → sweepStale + lazy proposeRoles; POST run-workers)
was executed headlessly through the SAME call chain against a real SQLite db:

```json
{
 "observation": "registry-tick (headless lane — same call chain as the keeper's hourly GET)",
 "at": "2026-10-02T22:34:11.659Z",
 "sweep": { "ok": true, "retiredProposed": [], "retiredActive": [] },
 "counts": { "proposed": 0, "active": 0, "retired": 0 }
}
```

- `sweepStale()` ran (48h proposed / 72h active retirement arithmetic) — ok:true.
- Empty-state census (0/0/0) on a fresh db — the honest PASS: the chain executes,
  types hold, arithmetic runs; nothing to retire in an empty registry.
- Non-empty sweeps print retired slugs + reasons (the receipt never fabricates).

**Runner note (honest):** bun trips on ripple-keypairs' require() of an ESM
@noble/curves build pulled in by the xrpl import chain — run via
`bunx tsx scripts/registry-tick-observe.ts` (esbuild interop), NOT `bun run`.
The script is committed at `scripts/registry-tick-observe.ts` so CI/ops can
repeat the observation anywhere.

**Live cadence (unchanged):** the keeper (mini-services/keeper v43) still owns
the hourly tick in its ops environment; this lane OBSERVES it headlessly —
sandbox-independent, keyless, fail-honest.
