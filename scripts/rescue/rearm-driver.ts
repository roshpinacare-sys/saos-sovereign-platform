/**
 * scripts/rescue/rearm-driver.ts — owner-key issuance drill (verdict-only).
 * 1. rearmSteemStatus — derive from sealed hed-soldiers source, verify vs LIVE chain
 * 2. rearmSteemExecute — verify-then-write into the sealed .env (fresh seal pass)
 * 3. roleWifAvailable — the platform's own gate must now answer true
 */
import { rearmSteemStatus, rearmSteemExecute } from "../../src/lib/saos/steem-rearm";
import { roleWifAvailable } from "../../src/lib/vault-seal";

const pub = (s: string | null | undefined) => (s ? String(s).slice(0, 10) + "…" + String(s).slice(-4) : "—");

console.log("── stage 1: derive-from-owner → LIVE chain match matrix ──");
const st = await rearmSteemStatus();
console.log("candidates(sealed source):", st.candidates, "| account:", st.account);
for (const [role, r] of Object.entries(st.roles)) {
  console.log(`  ${role.padEnd(7)} derived=${pub(r.derived)} live=${pub(r.live)} MATCH=${r.match}`);
}
console.log("ALL-FOUR-MATCH:", st.allMatch);

if (!st.allMatch) {
  console.log("[verdict] owner-passwords do NOT derive the live authority set — fail-closed, nothing written");
  process.exit(2);
}

console.log("── stage 2: verify-then-write (re-arm the signing envelope) ──");
const res = await rearmSteemExecute();
console.log("armed:", res.armed, "| account:", res.account, "| resealedAt:", res.resealedAt);
for (const [role, r] of Object.entries(res.roles)) {
  console.log(`  ${role.padEnd(7)} pub=${pub(r.pub)} live-verified=${r.live}`);
}
console.log("envKeysWritten:", res.envKeysWritten.join(","));
console.log("rosterUpdated:", res.rosterUpdated, "| mirroredHomes:", res.mirroredHomes.length);

console.log("── stage 3: platform gate re-measure ──");
console.log("roleWifAvailable(active):", await roleWifAvailable("active"));
console.log("roleWifAvailable(posting):", await roleWifAvailable("posting"));
console.log("[verdict] KEY-ISSUANCE-COMPLETE:", (await roleWifAvailable("active")) && (await roleWifAvailable("posting")) ? "FULL-SIGNING-ARMED" : "INCOMPLETE");
