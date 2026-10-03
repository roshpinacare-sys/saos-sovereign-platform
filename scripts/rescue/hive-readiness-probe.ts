/** verdict-only HIVE live readiness — the platform's own proof path */
import { hiveLiveReadiness } from "../../src/lib/saos/hive-live";

async function main() {
  const r = await hiveLiveReadiness();
  console.log("network:", r.network, "| account:", r.account, "| exists:", r.accountExists);
  console.log("rcPct:", r.rc?.pct, "| live:", r.rc?.live);
  console.log("vaultActivePub:", r.vaultActivePub ? r.vaultActivePub.slice(0, 10) + "…" : null);
  console.log("chainActivePub:", r.chainActivePub ? r.chainActivePub.slice(0, 10) + "…" : null);
  console.log("activeKeyAuthorized:", r.activeKeyAuthorized);
  console.log("gate:", r.gate);
  console.log("verdict:", r.verdict);
}
main().catch((e) => { console.error("probe failed:", e instanceof Error ? e.message : e); process.exit(1); });
