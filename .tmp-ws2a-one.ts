import ZAI from "z-ai-web-dev-sdk";
const zai = await ZAI.create();
try {
  const r = await zai.functions.invoke("web_search", { query: "Blurt Engine sidechain DEX", num: 4 });
  console.log(JSON.stringify(r, null, 1).slice(0, 1500));
} catch (e: any) { console.log("ERR", String(e?.message ?? e).slice(0, 200)); }
