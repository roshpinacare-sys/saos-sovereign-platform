// ws2c — foreground batch runner: runs queries [start, end), skips done, appends results
import { appendFileSync, readFileSync, existsSync } from "fs";
const ALL: [string, string][] = [
  ["Q1-hbot", "Hummingbot pure market making v2 parameters refresh time bid ask spread inventory skew_enabled best practices"],
  ["Q2-as", "Avellaneda Stoikov market making optimal spread gamma inventory crypto practical parameters"],
  ["Q3-grid", "grid trading bot optimal spacing levels recenter trigger trend break stop loss parameters"],
  ["Q4-arb", "crypto cross exchange arbitrage scanner fees two-sided depth leg risk inventory vs atomic"],
  ["Q5-tri", "triangular arbitrage constant product AMM profit calculation route graph fees"],
  ["Q6-lp", "constant product AMM passive LP versus active grid rebalancing volatile range profit"],
  ["Q7-toxic", "market making adverse selection inventory limits kill switch toxic flow protection"],
  ["Q8-smallcap", "market making small cap illiquid crypto token spread order size inventory parameters"],
];
const OUT = "/home/z/my-project/tmp-ws2c-out.txt";
const start = parseInt(process.argv[2] ?? "0"), end = parseInt(process.argv[3] ?? "8");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function doneTags(): Set<string> {
  if (!existsSync(OUT)) return new Set();
  const txt = readFileSync(OUT, "utf8");
  return new Set([...txt.matchAll(/===== (Q\d+-\w+)$/gm)].map(m => m[1]));
}

async function search(q: string, tries: number): Promise<any> {
  const zai = await (await import("z-ai-web-dev-sdk")).default.create();
  for (let i = 0; i < tries; i++) {
    try {
      return await zai.functions.invoke("web_search", { query: q, num: 8 });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      console.log(`  [try ${i + 1}] ${/429/.test(msg) ? "429" : msg.slice(0, 80)}`);
      await sleep(/429/.test(msg) ? 55000 : 6000);
    }
  }
  return null;
}

const done = doneTags();
for (let i = start; i < Math.min(end, ALL.length); i++) {
  const [tag, q] = ALL[i];
  if (done.has(tag)) { console.log(`skip ${tag} (done)`); continue; }
  appendFileSync(OUT, `===== ${tag}\n`);
  console.log(`RUN ${tag}`);
  const r = await search(q, 3);
  if (!r) { appendFileSync(OUT, "EXHAUSTED\n"); console.log(`EXHAUSTED ${tag}`); continue; }
  if (!Array.isArray(r)) { appendFileSync(OUT, JSON.stringify(r).slice(0, 300) + "\n"); continue; }
  let block = "";
  for (const it of r) {
    block += `- ${it.name ?? it.title ?? ""}\n  ${it.url ?? it.link ?? ""}\n  ${String(it.snippet ?? it.description ?? "").slice(0, 380)}\n`;
  }
  appendFileSync(OUT, block);
  console.log(`OK ${tag} (${r.length} hits)`);
}
console.log("BATCH-END");
