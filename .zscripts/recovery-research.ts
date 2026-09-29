/**
 * recovery-research.ts — live web research: how account recovery actually works
 * on STEEM/HIVE when recovery_account=steem (dead on HIVE). Zero-secrets probe.
 */
import ZAI from "z-ai-web-dev-sdk";

const QUERIES = [
  "HIVE blockchain account recovery request_account_recovery recovery account steem dead",
  "hive account recovery top witnesses recover_account operation who can request",
  "steem account recovery service steemit support stolen account 2025",
  "steem recover_account operation request recovery_account window 30 days"
];

async function main() {
  const zai = await ZAI.create();
  for (const q of QUERIES) {
    try {
      const res = (await zai.functions.invoke("web_search", {
        query: q,
        num: 6
      })) as Array<{ title?: string; url?: string; snippet?: string }>;
      console.log("\n== Q:", q);
      for (const r of res.slice(0, 6)) {
        console.log("-", (r.title || "").slice(0, 110));
        console.log("  ", (r.url || "").slice(0, 110));
        console.log("  ", (r.snippet || "").replace(/\s+/g, " ").slice(0, 260));
      }
    } catch (e) {
      console.log("== Q:", q, "\n  SEARCH-ERROR:", String(e).slice(0, 200));
    }
  }
}
main().catch((e) => {
  console.error("FATAL", String(e).slice(0, 300));
  process.exit(1);
});
