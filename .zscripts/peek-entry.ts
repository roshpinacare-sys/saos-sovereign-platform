import { withVaultMember } from "../src/lib/vault-seal";
async function main() {
  const vj = await withVaultMember("keys/vault.json", (c) => c);
  const parsed = JSON.parse(vj) as { accounts: Record<string, Record<string, unknown>>; sealedAt: string };
  const e = parsed.accounts["israelnews"]!;
  const redact = (o: unknown): unknown => {
    if (typeof o === "string") {
      if (o.startsWith("STM")) return o;
      if (/^(P5|5[KJH])[1-9A-HJ-NP-Za-km-z]{20,}$/.test(o)) return o.slice(0, 4) + "<REDACTED>" + o.slice(-2);
      return o;
    }
    if (Array.isArray(o)) return o.map(redact);
    if (o && typeof o === "object") { const r: Record<string, unknown> = {}; for (const [k, v] of Object.entries(o)) r[k] = redact(v); return r; }
    return o;
  };
  console.log("israelnews entry (redacted):");
  console.log(JSON.stringify(redact(e), null, 1));
  console.log("\nentry keys of headcorner:", Object.keys(parsed.accounts["headcorner"]!));
}
main().catch((e) => { console.error("FAIL:", e instanceof Error ? e.message : e); process.exit(1); });
