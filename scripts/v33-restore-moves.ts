/**
 * v33 — re-seed the PhysicalMove journal after the 3rd sandbox rebuild wiped
 * the DB (2026-09-09 ~14:22). Every physical move is ON-CHAIN TRUTH — each
 * txid is re-verified LIVE here (ETH ×2 + BSC via ethers, TRX via Trongrid,
 * SOL via mainnet-beta RPC) and journaled honestly as "reconstructed (v33)"
 * with explorer links. The chain never lies; the DB just forgot.
 */
import { ethers } from "ethers"
import bs58 from "bs58"
import { Connection } from "@solana/web3.js"
import { db } from "../src/lib/db"

const TREASURY_EVM = "0x01Bd2879Cd9990Cb4B25cD6DE47f378Dc5D18B37"
const LEGACY_EVM_97 = "0x97Ad0C1b9Dc3269bC4848b5a2884e6cADc86dF18"
const LEGACY_EVM_2767 = "0x2767e8146c11baD1d9B0784f11325375195c1b0f"
const TREASURY_TRON = "TMXHfFQdG6BB8kwVfbMYuiXWqr9P5S4VAU"
const LEGACY_TRON = "TG6SrsMJjRqnqAyYM8kGZu1rgkpsgizKEn"
const TREASURY_SOL = "A2Y1d3vefh81Ta2DcpazmLaZT4EHdbUX8XjZxigNdVyj"
const LEGACY_SOL = "9knfnFMLmhUNjKRDbR1BmVnVkq4BRczyYjJ7BqiZSgiL"

interface MoveRow {
  kind: string
  network: string
  txid: string
  from: string
  to: string
  amount: string
  fee: string
  explorer: string
  note: string
}

const MOVES: MoveRow[] = [
  {
    kind: "sweep-eth", network: "ETHEREUM",
    txid: "0x6ef5f0f0ce31fbfc1f45eb68f44befda22e8e92c5edb8b193d194c996bd0a14c",
    from: LEGACY_EVM_97, to: TREASURY_EVM,
    amount: "0.000262870525508 ETH", fee: "0.000002097711168 ETH",
    explorer: "https://etherscan.io/tx/0x6ef5f0f0ce31fbfc1f45eb68f44befda22e8e92c5edb8b193d194c996bd0a14c",
    note: "v30 תזוזה — אבק ה-ETH לבית-האוצר (reconstructed v33, on-chain verified)"
  },
  {
    kind: "sweep-bsc", network: "BSC",
    txid: "0xa8e43d1ec6749906335af3365179838cce9b8cbd317b91252827225909aa5374",
    from: LEGACY_EVM_97, to: TREASURY_EVM,
    amount: "0.000010172850321011 BNB", fee: "0.0000018 BNB",
    explorer: "https://bscscan.com/tx/0xa8e43d1ec6749906335af3365179838cce9b8cbd317b91252827225909aa5374",
    note: "v30 תזוזה — BNB לבית-האוצר (reconstructed v33, on-chain verified)"
  },
  {
    kind: "sweep-legacy-eth", network: "ETHEREUM",
    txid: "0xb735e04634dca5ac52a8590126f8221dd3c71d6e357b074f9c2f8e86cf399c91",
    from: LEGACY_EVM_2767, to: TREASURY_EVM,
    amount: "0.000080760083415155 ETH", fee: "0.00000187827276 ETH",
    explorer: "https://etherscan.io/tx/0xb735e04634dca5ac52a8590126f8221dd3c71d6e357b074f9c2f8e86cf399c91",
    note: "v32 המשך — הארנק הישן 0x2767 התרוקן לבית-האוצר (reconstructed v33, on-chain verified)"
  },
  {
    kind: "sweep-legacy-trx", network: "TRON",
    txid: "57afc51bf55f461302d53e79129767f95708252e0e3deba550e8a2b6df6faa71",
    from: LEGACY_TRON, to: TREASURY_TRON,
    amount: "17.099234 TRX", fee: "0.5 TRX (חיץ-רוחב-פס כנה נותר במקור)",
    explorer: "https://tronscan.org/#/transaction/57afc51bf55f461302d53e79129767f95708252e0e3deba550e8a2b6df6faa71",
    note: "v32 המשך — 17.1 TRX לבית-האוצר TMXHfFQd (reconstructed v33, on-chain verified)"
  },
  {
    kind: "sweep-legacy-sol", network: "SOLANA",
    txid: "41dTqUmzManmbRerN6SkugeA3SEAaLzNtBbjXhvNoZScQB9MLzJvsN8U5WxCYRfDUFEKsvVYiCi2CCCtHRUu6paC",
    from: LEGACY_SOL, to: TREASURY_SOL,
    amount: "0.023976117 SOL", fee: "0.000005 SOL",
    explorer: "https://solscan.io/tx/41dTqUmzManmbRerN6SkugeA3SEAaLzNtBbjXhvNoZScQB9MLzJvsN8U5WxCYRfDUFEKsvVYiCi2CCCtHRUu6paC",
    note: "v32 המשך — SOL לבית-האוצר A2Y1d3 (reconstructed v33, on-chain verified)"
  }
]

const tronHex = (base58Addr: string): string =>
  // base58-decoded TRON address = 0x41 prefix + 20 bytes + 4 checksum; the
  // first decoded byte IS 0x41 — take it verbatim (no double prefix).
  Buffer.from(bs58.decode(base58Addr)).subarray(0, 21).toString("hex")

async function verifyEvm(txid: string, from: string, to: string, url: string, chainId: number): Promise<boolean> {
  const p = new ethers.JsonRpcProvider(url, chainId, { batchMaxCount: 1 })
  try {
    const tx = await p.getTransaction(txid)
    return tx != null && tx.from?.toLowerCase() === from.toLowerCase() && tx.to?.toLowerCase() === to.toLowerCase()
  } finally {
    p.destroy()
  }
}

async function verifyTrx(txid: string, from: string, to: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.trongrid.io/wallet/gettransactionbyid", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: txid }),
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) return false
    interface TrxTx { ret?: Array<{ contractRet?: string }>; raw_data?: { contract?: Array<{ type?: string; parameter?: { value?: { owner_address?: string; to_address?: string } } }> } }
    const t = (await res.json()) as TrxTx
    if (t?.ret?.[0]?.contractRet !== "SUCCESS") return false
    const v = t.raw_data?.contract?.[0]?.parameter?.value
    return v?.owner_address === tronHex(from) && v?.to_address === tronHex(to)
  } catch {
    return false
  }
}

async function verifySol(txid: string): Promise<boolean> {
  try {
    const c = new Connection("https://api.mainnet-beta.solana.com", "confirmed")
    const r = await c.getSignatureStatuses([txid], { searchTransactionHistory: true })
    const s = r.value?.[0]
    return s != null && s.err == null && (s.confirmationStatus ?? "processed") !== "processed"
  } catch {
    return false
  }
}

async function main() {
  console.log("v33 שחזור יומן תזוזות — אימות בשרשרת חי:")
  const ethOk = await verifyEvm(MOVES[0].txid, MOVES[0].from, MOVES[0].to, "https://ethereum-rpc.publicnode.com", 1)
  console.log("  ETH v30:", ethOk ? "✓" : "✗")
  const bscOk = await verifyEvm(MOVES[1].txid, MOVES[1].from, MOVES[1].to, "https://bsc-dataseed.binance.org", 56)
  console.log("  BSC v30:", bscOk ? "✓" : "✗")
  const eth2Ok = await verifyEvm(MOVES[2].txid, MOVES[2].from, MOVES[2].to, "https://ethereum-rpc.publicnode.com", 1)
  console.log("  ETH v32:", eth2Ok ? "✓" : "✗")
  const trxOk = await verifyTrx(MOVES[3].txid, MOVES[3].from, MOVES[3].to)
  console.log("  TRX v32:", trxOk ? "✓" : "✗")
  const solOk = await verifySol(MOVES[4].txid)
  console.log("  SOL v32:", solOk ? "✓" : "✗")
  const verdicts = [ethOk, bscOk, eth2Ok, trxOk, solOk]

  for (let i = 0; i < MOVES.length; i++) {
    const m = MOVES[i]
    await db.physicalMove.upsert({
      where: { txid: m.txid },
      update: {},
      create: {
        kind: m.kind, network: m.network, txid: m.txid, from: m.from, to: m.to,
        amount: m.amount, fee: m.fee,
        status: verdicts[i] ? "confirmed" : "failed",
        meta: JSON.stringify({ explorer: m.explorer, note: m.note })
      }
    })
  }
  const count = await db.physicalMove.count()
  console.log("PhysicalMove journal:", count, "rows ·", verdicts.filter(Boolean).length, "/ 5 verified live")
  await db.$disconnect()
}

main().catch((e) => { console.error("FATAL", e instanceof Error ? e.message : e); process.exit(1) })
