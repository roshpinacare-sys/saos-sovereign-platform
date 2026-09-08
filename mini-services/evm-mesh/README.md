# SAOS-EVM — the sovereign laboratory chain (mini-service)

Port **8545** · chainId **31337** (anvil, in-memory — regenesis on restart,
the deployer rebuilds the mesh automatically).

## What runs here

The **7-contract CONTRACT MESH** (v15):

```
SAOSMeshHub.dispatch(intent)
  → SAOSMeshRelay.start
      → SAOSIdentity   (auto-enlist the initiator)
      → SAOSLedger     (mint 10 SAOS-M reward — fee 0 forever)
      → SAOSSolutions  (commit the solution hash)
      → SAOSBridge     (stamp the LIVE 8-chain anchors)
  → SAOSMeshRelay → SAOSMeshHub.complete
      → SAOSValueEngine.finalize (ערך · יעילות score)
```

Every arrow is a real contract-to-contract call inside ONE transaction —
חוזה שמדבר לחוזה שמדבר לחוזה.

- `bun run dev` — the service (anvil + deploy + auto-runner + watchdog)
- `bun run src/deploy-only.ts` — manual redeploy on a running anvil

## Files

- `src/index.ts` — service loop (auto mesh run every 120s, zero-fee
  transfers every 3rd cycle, watchdog, artifact watcher)
- `src/deploy.ts` — deployment + wiring + seeding (fleet identities via the
  platform API — public addresses only, never keys)
- `state/deployment.json` — runtime state consumed by the platform backend
  (`src/lib/saos/mesh-client.ts`). Gitignored — regenerated on every deploy.

The canonical artifact lives in the main repo:
`src/lib/saos/generated/SAOSMesh.json` (committed). The same EVM bytecode
deploys on ETHEREUM and BSC.
