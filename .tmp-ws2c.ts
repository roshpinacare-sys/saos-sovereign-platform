import ZAI from "z-ai-web-dev-sdk";
const sleep = (ms:number)=>new Promise(r=>setTimeout(r,ms));
const queries = process.argv.slice(2);
const zai = await ZAI.create();
for (const q of queries) {
  let done=false;
  for (let i=0;i<8 && !done;i++){
    try {
      const r = await zai.functions.invoke("web_search", { query: q, num: 8 });
      const items = Array.isArray(r) ? r : (r?.results ?? r?.data ?? []);
      console.log(`\n===== QUERY: ${q} =====`);
      for (const it of items) {
        console.log(`- [${it?.name ?? it?.title ?? ""}] ${it?.url ?? it?.link ?? ""}`);
        const sn = it?.snippet ?? it?.description ?? it?.content ?? "";
        console.log(`  ${(String(sn).replace(/\s+/g," ")).slice(0,400)}`);
      }
      done=true;
    } catch(e){
      const msg = String(e?.message ?? e);
      if (i<7){ await sleep(70000); }
      else console.log(`\n===== QUERY: ${q} ===== ERROR: ${msg.slice(0,200)}`);
    }
  }
  await sleep(5000);
}
