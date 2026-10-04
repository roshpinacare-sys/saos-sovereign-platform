import ZAI from "z-ai-web-dev-sdk";

const queries: { tag: string; q: string }[] = [
  { tag: "BLURT-venues", q: "where to buy BLURT coin 2026 exchange XeggeX Ionomy delisted trading" },
  { tag: "BLURT-DEX", q: "\"Blurt Engine\" sidechain DEX tokens swap blurt" },
  { tag: "BT-pairs", q: "BlockTrades supported coins list steem hive blurt sbd hbd instant exchange" },
  { tag: "HIVE-bridge", q: "HIVE blockchain bridge EVM 2026 VSC protocol wrapped HIVE swapzone" },
  { tag: "HE-fees", q: "hive-engine market buy contractPayload SWAP.HIVE minimum order market fee percent" },
  { tag: "BBLURT", q: "BBlurt BSC PancakeSwap wrapped BLURT bridge token" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const zai = await ZAI.create();
let failStreak = 0;
for (const { tag, q } of queries) {
  let done = false;
  for (let attempt = 1; attempt <= 3 && !done; attempt++) {
    try {
      const r = await zai.functions.invoke("web_search", { query: q, num: 6 });
      const items = (r as any[]) ?? [];
      console.log(`\n===== ${tag} :: ${q}`);
      for (const it of items) {
        console.log(`- [${it.name}] ${it.url}`);
        console.log(`  ${String(it.snippet ?? "").slice(0, 250).replace(/\n/g, " ")}`);
      }
      done = true; failStreak = 0;
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      console.error(`[${tag}] attempt ${attempt}: ${msg.slice(0, 80)}`);
      if (msg.includes("429")) failStreak++;
      await sleep(20000);
    }
  }
  if (failStreak >= 3) { console.error("ABORT: persistent 429"); break; }
  await sleep(8000);
}
