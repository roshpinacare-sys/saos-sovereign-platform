/**
 * recovery-research2.ts — read the official HIVE recovery tutorial + targeted searches.
 */
import ZAI from "z-ai-web-dev-sdk";

const PAGES = [
  "https://developers.hive.io/tutorials-python/account_recovery.html"
];

const QUERIES = [
  "hive \"recovery account is steem\" OR \"recovery_account steem\" how to recover account",
  "hive recover account when steem is recovery account dead account solution",
  "steemit account recovery request account recovery steem faucet contact support"
];

async function main() {
  const zai = await ZAI.create();
  for (const url of PAGES) {
    try {
      const res = (await zai.functions.invoke("page_reader", { url })) as {
        title?: string;
        html?: string;
        text?: string;
      };
      const text = (res.text || res.html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      console.log("\n===== PAGE:", url);
      // focus on recovery-relevant paragraphs
      const idx = text.toLowerCase().indexOf("request_account_recovery");
      console.log(text.slice(Math.max(0, idx - 300), idx + 2400));
    } catch (e) {
      console.log("PAGE-ERROR:", url, String(e).slice(0, 200));
    }
  }
  for (const q of QUERIES) {
    try {
      const res = (await zai.functions.invoke("web_search", { query: q, num: 8 })) as Array<{
        title?: string; url?: string; snippet?: string;
      }>;
      console.log("\n== Q:", q);
      for (const r of res.slice(0, 8)) {
        console.log("-", (r.title || "").slice(0, 100), "|", (r.url || "").slice(0, 90));
        console.log("   ", (r.snippet || "").replace(/\s+/g, " ").slice(0, 240));
      }
    } catch (e) {
      console.log("== Q:", q, "ERROR:", String(e).slice(0, 160));
    }
  }
}
main().catch((e) => {
  console.error("FATAL", String(e).slice(0, 300));
  process.exit(1);
});
