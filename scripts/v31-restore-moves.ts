/**
 * v31 — re-seed the PhysicalMove journal (the DB was rebuilt from an older
 * snapshot; the v30 movements exist ON-CHAIN — verified live here, then
 * journaled honestly as "reconstructed" with on-chain proof).
 */
import { ethers } from "ethers"
import { db } from "../src/lib/db"

async function main() {
  const moves: Array<{ kind: string; network: string; txid: string; from: string; to: string; amount: string; fee: string; meta: Record<string, unknown> }> = [
    {
      kind: "sweep-eth", network: "ETHEREUM",
      txid: "0x6ef5f0f0ce31fbfc1f45eb68f44befda22e8e92c5edb8b193d194c996bd0a14c",
      from: "0x97Ad0C1b9Dc3269bC4848b5a2884e6cADc86dF18",
      to: "0x01Bd2879Cd9990Cb4B25cD6DE47f378Dc5D18B37",
      amount: "0.000262870525508 ETH", fee: "0.000002097711168 ETH",
      meta: { explorer: "https://etherscan.io/tx/0x6ef5f0f0ce31fbfc1f45eb68f44befda22e8e92c5edb8b193d194c996bd0a14c", note: "v30 תזוזה — הוחזר ליומן מהשרשרת (reconstructed, on-chain verified)" }
    },
    {
      kind: "sweep-bsc", network: "BSC",
      txid: "0xa8e43d1ec6749906335af3365179838cce9b8cbd317b91252827225909aa5374",
      from: "0x97Ad0C1b9Dc3269bC4848b5a2884e6cADc86dF18",
      to: "0x01Bd2879Cd9990Cb4B25cD6DE47f378Dc5D18B37",
      amount: "0.000010172850321011 BNB", fee: "0.0000018 BNB",
      meta: { explorer: "https://bscscan.com/tx/0xa8e43d1ec6749906335af3365179838cce9b8cbd317b91252827225909aa5374", note: "v30 תזוזה — הוחזר ליומן מהשרשרת (reconstructed, on-chain verified)" }
    }
  ]
  // verify on-chain before journaling
  const eth = new ethers.JsonRpcProvider("https://ethereum-rpc.publicnode.com", 1, { batchMaxCount: 1 })
  const tx = await eth.getTransaction(moves[0].txid)
  const okEth = tx != null && tx.from.toLowerCase() === moves[0].from.toLowerCase() && tx.to?.toLowerCase() === moves[0].to.toLowerCase()
  eth.destroy()
  const bsc = new ethers.JsonRpcProvider("https://bsc-dataseed.binance.org", 56, { batchMaxCount: 1 })
  const tx2 = await bsc.getTransaction(moves[1].txid)
  const okBsc = tx2 != null && tx2.from.toLowerCase() === moves[1].from.toLowerCase() && tx2.to?.toLowerCase() === moves[1].to.toLowerCase()
  bsc.destroy()
  console.log("on-chain verify: ETH", okEth ? "✓" : "✗", "· BSC", okBsc ? "✓" : "✗")
  for (const m of moves) {
    const ok = m.network === "ETHEREUM" ? okEth : okBsc
    await db.physicalMove.upsert({
      where: { txid: m.txid },
      update: {},
      create: { kind: m.kind, network: m.network, txid: m.txid, from: m.from, to: m.to, amount: m.amount, fee: m.fee, status: ok ? "confirmed" : "failed", meta: JSON.stringify(m.meta) }
    })
  }
  const count = await db.physicalMove.count()
  console.log("PhysicalMove journal:", count, "rows")
  await db.$disconnect()
}
main().catch((e) => { console.error("FATAL", e instanceof Error ? e.message : e); process.exit(1) })
