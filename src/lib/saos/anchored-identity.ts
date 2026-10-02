/**
 * lib/saos/anchored-identity.ts — wave-16: the anchored sovereign identity
 * values, extracted to a DEPENDENCY-FREE leaf module.
 *
 * Why: wave-16's role-workers (role→worker wiring, 15-d gap) reads the
 * anchored EVM address for the fuel census — without dragging anchor-evm's
 * heavy graph (ethers + xrpl) into dependency-light executors and standalone
 * runners. Single source of truth preserved: anchor-evm.ts re-exports this
 * constant, so every existing importer is unchanged.
 */

/**
 * The EXPECTED sovereign EVM address — the CORNERSTONE treasuryHome
 * (headcorner-seed identities.evm, vault-registry headcorner, the
 * address holding the network's real ETH). The derived key must
 * reproduce this address or NOTHING is signed.
 */
export const ANCHORED_EVM_ADDRESS = "0x01Bd2879Cd9990Cb4B25cD6DE47f378Dc5D18B37";
