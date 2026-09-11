/**
 * scripts/skale-gas-probe.ts — v69 probe-first: האם SKALE Europa Hub באמת חינם?
 * ==========================================================================
 * לפני שמוסיפים את SKALE כמסילה ריבונית — אותה דיסציפלינה של ההשקיה (v67):
 * הטפטוף הראשון בכל מסלול הוא probe קטן שנאמת בהגעתו. כאן: עסקת-אפס
 * (21000 גז × מחיר-נומינלי) ממפתח חד-פעמי שנולד עם יתרת-אפס.
 *
 *   ─ מפתח ה-probe נזרק — אין לו שום תפקיד, אין לו שום כסף.
 *   ─ עלות העסקה אם הגז באמת נטען: 21000 × 100000 wei = 0.0000021 ETH —
 *     אבל למפתח אין כלום, אז קבלה = הוכחה שהצומת לא אוכף יתרה.
 *   ─ התוצאה נרשמת כפלט JSON כנה: או "FREE" או "BALANCE-ENFORCED"
 *     (או שגיאת רשת — נתון, לא אפס).
 *
 * עובד מול ה-RPC הציבורי: https://mainnet.skalenodes.com/v1/europa
 * chainId 2046399126 (נמדד חי: eth_chainId + net_version הסכימו).
 */

import { ethers } from "ethers";

// v69: פרמטריזציה — ברירת-מחדל Europa; אפשר לבדוק כל האב (bun run scripts/skale-gas-probe.ts <slug>)
const SLUG = process.argv[2] ?? "europa";
const EP = `https://mainnet.skalenodes.com/v1/${SLUG}`;

async function main() {
  const chainIdHex = await (async () => {
    const r = await fetch(EP, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] })
    });
    const j = (await r.json()) as { result?: string };
    return j.result ?? "0x1";
  })();
  const CHAIN_ID = parseInt(chainIdHex, 16);
  const provider = new ethers.JsonRpcProvider(EP, CHAIN_ID, { batchMaxCount: 1 });
  console.log(JSON.stringify({ step: "hub", slug: SLUG, chainId: CHAIN_ID }));

  // (1) מפתח חד-פעמי — נולד כאן, נזרק כאן. אפס קשר לכספת/לריבוני.
  const probe = ethers.Wallet.createRandom();
  const balBefore = await provider.getBalance(probe.address);
  const nominal = BigInt(await provider.send("eth_gasPrice", []));

  console.log(JSON.stringify({
    step: "born",
    probeAddress: probe.address,
    balanceBeforeWei: balBefore.toString(),
    nominalGasPriceWei: nominal.toString()
  }));

  // (2) עסקת-אפס אל עצמו — הצורה הזולה והתמימה ביותר שקיימת.
  const signer = probe.connect(provider);
  const tx = await signer.sendTransaction({
    to: probe.address,
    value: 0,
    gasLimit: 21000,
    gasPrice: 0, // הניסיון השני: מחיר-אפס — 0+0=0 עובר את השער החשבונאי. אם הצומת דוחה מחיר-0 גם זה נתון כנה.
    chainId: CHAIN_ID,
    nonce: 0,
    type: 0
  });

  console.log(JSON.stringify({ step: "submitted", txid: tx.hash }));

  // (3) קבלה — האמת מהשרשרת-המקבלת, לא מהשולחת.
  const receipt = await provider.waitForTransaction(tx.hash, 1, 90_000);
  const balAfter = await provider.getBalance(probe.address);

  const verdict =
    receipt && receipt.status === 1 && balAfter === 0n
      ? "FREE"
      : receipt && receipt.status === 1
        ? "FREE-BUT-BALANCE-MOVED"
        : "BALANCE-ENFORCED-OR-REVERTED";

  console.log(JSON.stringify({
    step: "verdict",
    verdict,
    txid: receipt?.hash ?? tx.hash,
    status: receipt?.status,
    blockNumber: receipt?.blockNumber,
    gasUsed: receipt?.gasUsed?.toString(),
    balanceAfterWei: balAfter.toString(),
    chargedWei: (balBefore - balAfter).toString(),
    note: verdict === "FREE"
      ? "קבלה status=1 מיתרת-אפס — הצומת לא אוכף יתרה; הגז נומינלי-חינם. מסילת SKALE אינה דלת — אין מה להשקות."
      : "נתון כנה — המסילה דורשת יתרה; SKALE נשאר מחוץ למפת-ההתפשטות עד שינוי."
  }));

  provider.destroy();
}

main().catch((e) => {
  console.error(JSON.stringify({ step: "error", error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
