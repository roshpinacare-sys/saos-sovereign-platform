# HOOKPOOL PROOF — v118 תזמורת (2026-10-03)

**SAOSHookPool.sol — Uniswap-v4 hook semantics on the SAOS lab chain (31337), compiled + tested + deployed LIVE.**
Closes the v116 honest open item "compile pending forge (install from official foundry-rs releases only)".

## Toolchain (official sources only)
- forge/cast/anvil **v1.8.4** — downloaded from the official foundry-rs GitHub release `v1.8.4` (`foundry_v1.8.4_linux_amd64.tar.gz`), build timestamp 2026-10-01, commit 50af4efe. The `foundryup` installer script panicked in this sandbox (Rust panic, recorded honestly); the release tarball IS the official channel the installer wraps — no unofficial mirrors used.
- solc via forge build. `forge build` exit 0 — ALL contracts compile including `contracts/mesh/SAOSHookPool.sol`.

## Contract upgrade (main session, v118)
The v116 stub documented dynamic-fee as a "future extension" (hook return value ignored). v118 completes the semantics:
- `ISaoshook.beforeSwap` now returns `(bytes4 selector, uint24 feeBps)` — the pool ADOPTS the hook fee
- Safety cap `MAX_HOOK_FEE_BPS = 1_000` — a hostile hook demanding >10% falls back to the base fee (fail-closed against owner-installed-but-rogue hooks)
- `afterSwap` unchanged (fail-open recording semantics)

## The FIVE proofs
### In-suite (forge test, in-memory EVM) — 5/5 PASS
| # | test | proves |
|---|------|--------|
| a | `test_Install_NonOwner_Reverts` | owner-gated install; non-owner reverts `NotOwner` |
| b | `test_Install_Owner_Ok_Event` | owner install registers + `HookInstalled` event + double-install refused |
| c | `test_Hooks_Fire_WithPayloads` | `beforeSwap`/`afterSwap` each fire exactly once with the real sender/amountIn/amountOut |
| d | `test_RevertingHook_FailOpen_SwapStillValid` | both hook callbacks revert → swap SUCCEEDS with base fee (fail-open); counterfactual arithmetic proves the hook fee was NOT adopted on revert |
| e | `test_DynamicFee_HookSets_Adopted_And_Capped` | 50bps hook fee adopted (exact reserve math); hostile 50_000bps refused → base 30bps |

### Live chain (anvil :8545, block ~19325+, broadcast transactions)
- **Deploy**: `SAOSHookPool` at **`0x95db7321f45b7e326c89b7cf20111abd5229646a`** (owner-funded 1M/1M reserves) — broadcast run `broadcast/DeployHookPool.s.sol/31337/`
- **(a) LIVE**: `cast send installHook(0x…42)` from a non-owner key → `execution reverted: custom error 0x30cd7471 … NotOwner`
- **(b)+(c)+(e) LIVE**: owner installed `RecordingHook(50bps)` (`0x9cdfe2af…77539`) + swapped 1,000e — on-chain reserve decode:
  - `reserveA` delta = **995.0e** = exactly 50bps `inAfterFee` (base 30 would be 997.0e)
  - `reserveB` drop = **994.010959095699778720e** = exactly the 50bps `x·y=k` output
  - `hook()` returns the RecordingHook address — registered on live state

## Full suite regression
`forge test` — pre-existing suites all green: 13+17+16+19+13 = **78 passed / 0 failed** + HookPool 5/5.

## Pending (honest)
- Live anvil is ephemeral lab state — the deploy is reproducible via `forge script script/DeployHookPool.s.sol --rpc-url http://127.0.0.1:8545 --broadcast` (anvil valve now guards the process, keeper Task 118-d).
- next step (future wave): wire a REAL fee-routing hook to the treasury (swap fees → sovereign wallet) — the semantics are now proven end-to-end.
