/**
 * recovery-research3.ts — read the official stolen-account-recovery pages +
 * the HIVE consensus source for request_account_recovery validation rules.
 */
import ZAI from "z-ai-web-dev-sdk";

const PAGES = [
  "https://steemitwallet.com/recover_account_step_1",
  "https://developers.hive.io/tutorials-python/account_recovery.html"
];

async function main() {
  const zai = await ZAI.create();
  for (const url of PAGES) {
    try {
      const res = (await zai.functions.invoke("page_reader", { url })) as {
        title?: string; html?: string; text?: string;
      };
      const text = (res.text || res.html || "")
        .replace(/<script[\s\S]*?<\/script>/g, " ")
        .replace(/<style[\s\S]*?<\/style>/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ");
      console.log("\n===== PAGE:", url, "TITLE:", res.title || "-");
      console.log(text.slice(0, 2600));
    } catch (e) {
      console.log("\nPAGE-ERROR:", url, String(e).slice(0, 250));
    }
  }
}
main().catch((e) => {
  console.error("FATAL", String(e).slice(0, 300));
  process.exit(1);
});
