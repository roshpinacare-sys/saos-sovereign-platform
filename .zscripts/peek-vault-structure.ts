import { withVaultMember } from "../src/lib/vault-seal";
async function main() {
  const vj = await withVaultMember("keys/vault.json", (c) => c);
  const parsed = JSON.parse(vj) as Record<string, unknown>;
  console.log("top-level keys:", Object.keys(parsed));
  const accs = parsed.accounts;
  if (Array.isArray(accs)) {
    console.log("accounts: ARRAY of", accs.length);
    // print structure of first entry with secrets redacted
    const e0 = accs[0] as Record<string, unknown>;
    const redact = (o: unknown, d = 0): unknown => {
      if (typeof o === "string") return o.startsWith("STM") ? o : o.startsWith("P5") || /^[5KL]/.test(o) && o.length > 40 ? "<REDACTED>" : o;
      if (Array.isArray(o)) return o.map((x) => redact(x, d + 1));
      if (o && typeof o === "object") { const r: Record<string, unknown> = {}; for (const [k, v] of Object.entries(o)) r[k] = redact(v, d + 1); return r; }
      return o;
    };
    console.log(JSON.stringify(redact(e0), null, 1).slice(0, 1500));
  } else if (accs && typeof accs === "object") {
    console.log("accounts: MAP with keys:", Object.keys(accs).slice(0, 20));
  }
  const src = await withVaultMember("keys/hed-soldiers-source.txt", (c) => c);
  console.log("\nhed-soldiers-source.txt: length=", src.length, "lines=", src.split("\n").length);
  // show only non-secret structural hints: lines with labels, redact key material
  const safe = src.split("\n").slice(0, 12).map((l) => l.replace(/P5[1-9A-HJ-NP-Za-km-z]{20,}/g, "P5<REDACTED>").replace(/5[KJH][1-9A-HJ-NP-Za-km-z]{20,}/g, "5<REDACTED>"));
  console.log(safe.join("\n"));
}
main().catch((e) => { console.error("FAIL:", e instanceof Error ? e.message : e); process.exit(1); });
