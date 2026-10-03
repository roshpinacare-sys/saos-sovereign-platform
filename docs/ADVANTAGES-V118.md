# ADVANTAGES V118 — יתרונות · פריצות-דרך · חוסמים (the connect-the-dots synthesis)

Owner directive (trace 1a1031ccb5bdaf21): deep-survey ALL the git, connect the dots, identify technological
advantages and breakthroughs ON the networks and IN our estate, name what BLOCKS us, and push all agents
forward TOGETHER with full wiring. This document is the synthesis; the five parallel waves (118-a..118-e)
are the execution.

---

## 1. What the full-git survey shows (295 commits · 110 saos modules · 75 APIs · 51 views · 5 services)

**The estate already holds, wired and measured:**
- **Sovereign key infrastructure** (v117): vault rebuilt from the R11 estate (partner-repo git history = the
  vault, as the owner said), owner-password derivation re-materialized 4/4 live STEEM authorities, signing
  durable across restarts (disk pass + 7 mirrored homes).
- **Market-making on a real order book** (v116 + v118): the ladder engine semantics (symmetric rungs,
  spread floors, drift-regrid, honest budget law) — running in PAPER on HIVE, running LIVE on STEEM by the
  fleet soldier (7-op limit_order_create2 ladders measured on-chain), now OBSERVED by our own dashboard.
- **Agent discipline stack** (v109-v114): real browser hands (CDP), terminal-state taxonomy (7 honest
  endpoints), goal compiler rejecting vagueness, red team with boundary walls + counter-evidence schema,
  declarative AX runner with suspend/checkpoint/resume, review with sha256-locked skill library.
- **EVM mesh**: 10+ contracts, receipts chain, anchors across EVM/BSC/TRON/SVM/XRP rails (cornerstone
  EVM/SOL/TRON reproduce; XRP family-proven), and NOW a deployed live HookPool with v4 hook semantics.

## 2. The advantages identified — and their state

| # | Advantage | Source | State after v118 |
|---|-----------|--------|------------------|
| A1 | **LLM resilience chain** — mid-turn failover + cache fast-path + ledger; kills the 429-class failure that honest-failed the ax runner | FCC semantics (clean-room) | **BUILT+WIRED** (118-a): selfreview on the chain; drill live; KPIs real (failover 0.6, tokensSaved 333) |
| A2 | **Market observability = trading feedback loop** — you cannot improve what you cannot see; the fleet ladder was invisible to its own network | our own chain account | **BUILT** (118-b): 17 open orders, fills (0.576 @ 0.100694 measured), locked 9.097 STEEM, unrealized +0.70 SBD — native-rpc + history forensics |
| A3 | **12× curation surface** — 12 accounts with posting authority = 12 windows of votes/posts/day; the measured blocker: the current single loop DRAINS VP (capableVoters=0) | vault roster + chain census | **BUILT** (118-c): census + 12-window orchestra plan; the plan is the cure for VP exhaustion |
| A4 | **Memory sovereignty** — the #1 infra killer (4 kernel OOMs) now has a three-layer defense: runner valve (700MB) + keeper anvil valve (900MB backstop) + death-revive ×3 + web RSS gate (1200MB) | keeper/runner | **BUILT** (118-d): valves live, keeper v49, journal events coded |
| A5 | **v4 hook economics on our own chain** — swap fees route through owner-gated, capped, fail-open hooks; the door to real fee-revenue + dynamic-fee strategies | Uniswap-v4 semantics | **BUILT+DEPLOYED** (118-e): 5/5 proofs + live anvil deploy 0x95db…646a; 50bps adoption proven by exact reserve arithmetic |
| A6 | **Zero-marginal-cost broadcasting** — headcorner 6.37M VESTS → RC 99%+ → anchors/votes/orders at $0.00 | STEEM RC | LIVE since v116 (weave anchors + curation measured on-chain) |
| A7 | **Deterministic key federation** — sha256(account+role+password) means every soldier holding the owner password derives the SAME live key: the fleet traded headcorner's ladder all day without any central signer | Graphene derivation | PROVEN (v117 forensics) — the doctrine of "owner gives all keys" |
| A8 | **History-as-vault recovery** — partner-repo git history held the full R11 key estate; 975-candidate GCM forensics closed the wrong path honestly | our estate | PROVEN (v117) |

## 3. What BLOCKS us (the honest list)

| Blocker | Impact | Cure | Owner material needed? |
|---------|--------|------|------------------------|
| **HIVE keys not derivable** (52-derivation sweep = 0) | HIVE market/savings/HBD-20% income blocked; hive-grid stays paper | owner supplies HIVE key material (or account_update from the HIVE owner key) | **YES** |
| **Soldier VP exhaustion** (the loop votes 30s-cadence from one account-family) | curation surface stuck at ×0 capable at measure time | the 118-c orchestra spread (12 windows) wired into the queue — next wave: connect plan → broadcast-queue scheduling | no |
| **XRP exact-identity mismatch** (r3Tq66 family-proven, not byte-exact) | XRP rail fail-closed | re-measure the doc identity vs derivation; one-line doc fix once proven | no |
| **Steem node trust list** (boylikegirl works but unregistered) | single-node dependency for market reads | register 2-3 vetted STEEM RPC nodes in the trusted-endpoints law | no |
| **Anvil lab state is ephemeral** | HookPool deploy dies with the process | keeper valve (done) + reproducible deploy script (done); optionally persistent datadir | no |
| **Single-region SQLite** | scale ceiling | out of scope until real load; the ledger pattern is portable | no |

## 4. The value ladder from here (next waves, in value order)

1. **Wire the orchestra into the broadcast queue** (the plan exists — scheduling it = 12× surface, zero cost).
2. **HookPool → fee routing**: a real hook that routes swap fees to the sovereign treasury — the first
   self-owned revenue primitive on our own chain (semantics proven end-to-end today).
3. **Fill-driven grid evolution**: the observatory's fills feed the drift-regrid logic — the ladder learns.
4. **SBD premium loop**: convert-vs-sell optimizer (SBD→STEEM conversion at feed price vs selling into the
   ladder) — pure spread economics on rails we already hold.
5. **Witness governance**: headcorner votes witnesses → protocol-level influence (free, permanent).
6. **XRP doc fix + HIVE material** (owner-dependent) — unlock the two blocked rails.

## 5. The wave-118 record (all agents together, coordinated, wired)

- 118-a: llm-chain rebuild (5 files + schema + wiring) — tsc 0, drill live, ledger rows real
- 118-b: steem-market observatory (lib+API+view+docs) — tsc 0, native-rpc found, chain-cross-checked
- 118-c: soldiers orchestra (lib+API+view+docs) — tsc 0, 12/12 census real, honest zeros
- 118-d: keeper valves (+231/−14, one file) — build 0, hot-reloaded, probes live
- 118-e: foundry died at dispatch limit → **main session finished**: forge v1.8.4 official, 5/5 hook
  proofs, live deploy + cast proofs, docs/HOOKPOOL-PROOF.md
- main: wiring (3 views → shell/page), version 118.0.0 תזמורת, this synthesis, verification sweep,
  commit+PUSH
