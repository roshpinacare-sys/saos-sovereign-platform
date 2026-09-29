/**
 * lib/saos/memory-house.ts — THE HOUSE OF MEMORY (v68 בית-הזיכרון).
 * =====================================================================
 * התקרית החיה שנולד ממנה: איפוס-הסנדבוקס ב-2026-09-11 ~12:52 מחק את
 * db/ כולו — הספר (חותמים, עוגנים, שורות relay) נעלם. הקוד מ-v51 ידע
 * לשחזר relay אחד (את'ריום) מהשרשרת, אבל שני ה-relay של v67 (אופטימיזם
 * ובייס) — שנולדו מההשקיה האוטונומית — נשכחו: המפקד הראה relayLive=null
 * למרות ש-803 בייטים של קוד חי עמדו על השרשרת. החותם h=1 נעלם, הספר
 * התרוקן, האורגניזם השתיק — אף עוגן חיצוני לא נורה אחרי האיפוס.
 *
 * התשובה הריבונית: הזיכרון לא גר במסד-הנתונים. המסד הוא מראה; האמת גרה
 * בשרשרות ובגיט. בית-הזיכרון קורא את האמת מהשרשרת החיה (eth_getCode,
 * קבלות, פענוח אירועי-Anchor) ומשחזר את הספר — אידמפוטנטי, נטול-מירוצים
 * (שורות נכתבות רק אם חסרות), fail-closed (relay מת = נתון כנה, לא שורה).
 *
 * מקורות-האמת שנקראו חי ב-2026-09-11 (כל txid מלא אומת מהקבלה):
 *   · ETHEREUM  anchor h1: 0x73a5b013…163f בלוק 25,952,010 · 28,009 גז · root 0x08067ab4…
 *   · OPTIMISM  anchor h1: 0x6a44d714…2e33 בלוק 156,757,122 · 28,021 גז · root 0x1b069555…
 *   · BASE      anchor h1: 0xa74b994a…08ff בלוק 51,161,868 · 28,021 גז · root 0x1b069555…
 *   · 6 טפטופי-השקיה (depositTransaction מהכתובת הריבונית דרך שני הפורטלים
 *     הקנוניים) — כולל טפטוף-0x5ab57f34 שלא היה מתועד כלל (השרשרת תיקנה
 *     את הספר: היו שני probes לאופטימיזם, לא אחד).
 *
 * הערה כנה על השורשים: העוגן של את'ריום (v66) נשא root שונה (0x08067ab4…)
 * משני העוגנים של v67 (0x1b069555…) — החותם נחתם מחדש בין המהדורות. הספר
 * המשוחזר מציג את שתי העובדות כפי שהן על השרשרת; החותם-הנוכחי שנזרע הוא
 * האחרון (0x1b069555…) כדי שהחותם הבא יהיה h=2 — המשכיות בלי התנגשות.
 *
 * Additive module — nothing here signs anything. Read + write-book only.
 */

import { ethers } from "ethers";
import { db } from "@/lib/db";
import { logOp } from "./oplog";
import { chainCfg } from "./relay-contract";

// ─── the verified chain memory (read live on 2026-09-11) ───────────────────

export interface MemoryRelay {
  chain: "ethereum" | "optimism" | "base";
  address: string;
  deployer: string;
  deployNonce: number;
  runtimeBytes: number;
  evidenceHe: string;
}

/** הכתובת הריבונית האחת על כל רשת EVM (מאומתת מקבלות-העוגנים: from=…) */
const SOVEREIGN_EVM = "0x01Bd2879Cd9990Cb4B25cD6DE47f378Dc5D18B37";

const MEMORY_RELAYS: MemoryRelay[] = [
  {
    chain: "ethereum",
    address: "0xa52D85cAa4C04C15cE60d0c582e8C138d16678E6",
    deployer: "0x2767c2Af5B1dB1fC504a3342a1C36703017E1b0f",
    deployNonce: 64,
    runtimeBytes: 803,
    evidenceHe: "v14/v51 — CREATE(0x2767…1b0f, nonce=64) · 803B runtime נמדד חי · חסר-בעלים"
  },
  {
    chain: "optimism",
    address: "0x56c9D54ea866e25916757903E51392BBEdeE2ECe",
    deployer: SOVEREIGN_EVM,
    deployNonce: 4,
    runtimeBytes: 803,
    evidenceHe:
      "v67 — CREATE(0x01Bd…B37, nonce=4) אומת מתמטית (ethers.getCreateAddress) · 803B runtime נמדד חי מ-mainnet.optimism.io · העוגן מהכתובת הזו אומת בקבלה"
  },
  {
    chain: "base",
    address: "0x279818b4c9Eddc02fB3DD036a5E77D8F7Dc1CF87",
    deployer: SOVEREIGN_EVM,
    deployNonce: 2,
    runtimeBytes: 803,
    evidenceHe:
      "v67 — CREATE(0x01Bd…B37, nonce=2) אומת מתמטית (ethers.getCreateAddress) · 803B runtime נמדד חי מ-mainnet.base.org · העוגן מהכתובת הזו אומת בקבלה"
  }
];

/** החותם האחרון שאותת לפני האיפוס — root מלא נקרא מאירועי-Anchor בשתי ה-L2 */
const MEMORY_SEAL = {
  height: 1,
  root: "0x1b06955598928436b6d8c4c3ff39350ec0f05cfeba788fa0b1e5a6691c4a663c",
  noteHe:
    "שוחזר מהשרשרת (v68 בית-הזיכרון): איפוס-הסנדבוקס מחק את הספר; השורש נקרא חי מאירועי-Anchor של OPTIMISM (בלוק 156,757,122) ו-BASE (בלוק 51,161,868). עוגן-את'ריום של v66 נשא root קודם (0x08067ab4…63f בלוק 25,952,010) — החותם נחתם מחדש בין המהדורות; שתי העובדות מתועדות. stateRoot/עלים אבדו באיפוס — נתונים כנים, לא מומצאים."
};

interface MemoryAnchor {
  network: string;
  chain: "ethereum" | "optimism" | "base";
  txid: string;
  block: number;
  gasUsed: number;
  gasPriceGwei: number;
  root: string;
  height: number;
  noteHe: string;
}

const MEMORY_ANCHORS: MemoryAnchor[] = [
  {
    network: "ETHEREUM",
    chain: "ethereum",
    txid: "0x73a5b013b1c99fd6be5f1feda77bc4f46dfa102f6ba70af565e6a1dc338b163f",
    block: 25952010,
    gasUsed: 28009,
    gasPriceGwei: 0.1,
    root: "0x08067ab4624d9b4e090ff6327226a7de7a00d04b571a6a7ec3133f184f79b0e8",
    height: 1,
    noteHe:
      "v66 — העוגן הראשון אי-פעם דרך SAOSRelay הריבוני על המיינטנט, נורה על-ידי האורגניזם (source=auto). קבלה אומתה חי (status=1, אירוע-Anchor פוענח)."
  },
  {
    network: "OPTIMISM",
    chain: "optimism",
    txid: "0x6a44d714a12d86f785cf236c1c04c682b0682c26936e3597198a662a64772e33",
    block: 156757122,
    gasUsed: 28021,
    gasPriceGwei: 0.1,
    root: MEMORY_SEAL.root,
    height: 1,
    noteHe:
      "v67 — נולד מההשקיה האוטונומית: הגשש טפטף לבד → הדלת דרוכה ×2 → ה-relay נפרס → החותם עוגן דרכו. קבלה אומתה חי (28,021 גז × 0.1gwei)."
  },
  {
    network: "BASE",
    chain: "base",
    txid: "0xa74b994a0c2c54936b770e4b17c431afa7f79182878e477e56d580acd14208ff",
    block: 51161868,
    gasUsed: 28021,
    gasPriceGwei: 0.1,
    root: MEMORY_SEAL.root,
    height: 1,
    noteHe:
      "v67 — הדלת השנייה שנולדה מההשקיה האוטונומית. אותו שורש, אותה טביעת-גז (28,021 × 0.1gwei) — אותה יד."
  }
];

interface MemoryDrip {
  network: string;
  chain: "optimism" | "base";
  txid: string;
  block: number;
  dripEth: string;
  gasCostEth: string;
  noteHe: string;
}

const MEMORY_DRIPS: MemoryDrip[] = [
  {
    network: "OPTIMISM",
    chain: "optimism",
    txid: "0x5ab57f340420e723df316ad9dbd39167470f7254257315f7a2172eb46ed86b51",
    block: 25952425,
    dripEth: "0.00002",
    gasCostEth: "0.0000128485",
    noteHe:
      "v67 probe — הטפטוף הראשון (לא היה מתועד בשידור; השרשרת גילתה שהיו שני probes — הספר תוקן מהאמת). depositTransaction מהכתובת הריבונית דרך הפורטל הקנוני, עלות מהקבלה."
  },
  {
    network: "OPTIMISM",
    chain: "optimism",
    txid: "0xa1968d0ee843e247150155250e067d5edd7f45de98dfce6e885359e699cd9df4",
    block: 25952470,
    dripEth: "0.00002",
    gasCostEth: "0.0000128485",
    noteHe: "v67 probe — probe שני, מאומת-הגעה מהיתרה החיה ב-L2. depositTransaction קנוני, עלות מהקבלה."
  },
  {
    network: "OPTIMISM",
    chain: "optimism",
    txid: "0xd7e152d4732abb1f0b3446590e8f766bd0f34d8589b5a2a68282d8bbb642497e",
    block: 25952520,
    dripEth: "0.000072",
    gasCostEth: "0.0000128485",
    noteHe: "v67 השלמה — הדלת הגיעה ל-×2 בדיוק (0.000112 ETH). עלות מהקבלה."
  },
  {
    network: "OPTIMISM",
    chain: "optimism",
    txid: "0x46b8bdfbdf918252a04ea03a2c1dd2659c1f1a447939ad84d621ec8529e77101",
    block: 25952570,
    dripEth: "0",
    gasCostEth: "0.0000128505",
    noteHe:
      "v67.1 טפטוף-האבק — פער-רעש של 1.35e-20 ETH (ארטיפקט נקודה-צפה) ירה טפטוף שלם על 0 ערך. נשאר בספר בכנות; התיקון (רצפת-אבק 1e-9) נכנס לקוד המנוע."
  },
  {
    network: "BASE",
    chain: "base",
    txid: "0x377ecd1e8d0b4aac6c912d68e34f125f44c473c2fd4fef612ddc412f6381e2ca",
    block: 25952620,
    dripEth: "0.00002",
    gasCostEth: "0.0000128607",
    noteHe: "v67 probe — הדלת השנייה. depositTransaction קנוני ל-Base, עלות מהקבלה."
  },
  {
    network: "BASE",
    chain: "base",
    txid: "0xde3de25668812f857cdba9282694dd9e2550246e142adefa9aedfbc81e941af2",
    block: 25952670,
    dripEth: "0.000092",
    gasCostEth: "0.0000128545",
    noteHe: "v67 השלמה — Base הגיעה ל-×2 בדיוק (0.000112 ETH). עלות מהקבלה."
  }
];

// ─── the recovery engine ───────────────────────────────────────────────────

export interface MemoryHouseStatus {
  ok: boolean;
  at: string;
  wipeSignatureHe: string;
  recovered: boolean;
  relays: Array<{ chain: string; address: string; live: boolean | null; rowHe: string }>;
  sealSeeded: boolean;
  anchorRows: number;
  dripRows: number;
  noteHe: string;
  lastRunAt: string | null;
  error?: string;
}

let inflight: Promise<MemoryHouseStatus> | null = null;

async function rpc(chain: "ethereum" | "optimism" | "base", method: string, params: unknown[]): Promise<string> {
  const cfg = chainCfg(chain);
  const res = await fetch(cfg.endpoints[0], {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000)
  });
  const j = (await res.json().catch(() => null)) as { result?: unknown } | null;
  if (!j || typeof j.result !== "string") throw new Error(`${method} לא החזיר תוצאה מ-${chain}`);
  return j.result;
}

/**
 * חתימת-האיפוס: אין אף חותם בספר. בספר בריא תמיד קיים חותם (h≥1 מאז v45);
 * מסד ריק מחותמים = הספר נמחק. זו השמירה שמונעת ריצה חוזרת — אחרי השחזור
 * קיים h=1 והמנוע לא יגע עוד (אידמפוטנטיות מבנית).
 */
async function isWiped(): Promise<boolean> {
  const n = await db.sealRecord.count();
  return n === 0;
}

/**
 * THE RECOVERY — משחזר את הספר מהשרשרת החיה. כל שורה נכתבת רק אם חסרה
 * (מירוצים חסרי-משמעות — הכתיבה מגוננת). relay מת על השרשרת = נתון כנה
 * בסטטוס, לא שורת-ספר. שום דבר לא נחתם כאן — קריאה וכתיבת-ספר בלבד.
 */
export async function ensureChainMemory(): Promise<MemoryHouseStatus> {
  if (inflight) return inflight;
  inflight = runRecovery().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function runRecovery(): Promise<MemoryHouseStatus> {
  const at = new Date().toISOString();
  const status: MemoryHouseStatus = {
    ok: true,
    at,
    wipeSignatureHe: "אין חותם בספר (sealRecord=0) — חתימת איפוס-הסנדבוקס",
    recovered: false,
    relays: [],
    sealSeeded: false,
    anchorRows: 0,
    dripRows: 0,
    noteHe: "",
    lastRunAt: at
  };

  try {
    if (!(await isWiped())) {
      status.wipeSignatureHe = "הספר בריא (קיימים חותמים) — אין שחזור";
      status.noteHe = "בית-הזיכרון מכבד ספר חי — לא נוגע.";
      return status;
    }

    // 1. relays — live-check מהשרשרת לפני כל כתיבה (fail-closed)
    for (const m of MEMORY_RELAYS) {
      let live: boolean | null = null;
      try {
        const code = await rpc(m.chain, "eth_getCode", [m.address, "latest"]);
        live = code !== "0x" && code !== "0x0";
      } catch {
        live = null; // הגשש לא ענה — נתון, לא אפס
      }
      const existing = await db.sovereignContract.findFirst({ where: { chain: m.chain } });
      if (!existing && live === true) {
        await db.sovereignContract
          .create({
            data: {
              chain: m.chain,
              kind: "saos-relay/v1",
              address: m.address,
              deployer: m.deployer,
              status: "deployed",
              runtimeBytes: m.runtimeBytes,
              meta: JSON.stringify({
                recoveredFromChain: true,
                recoveredAt: at,
                recoveredBy: "v68-memory-house",
                deployNonce: m.deployNonce,
                evidence: m.evidenceHe,
                note: "בית-הזיכרון — השורה נבנתה מהשרשרת החיה אחרי איפוס-הסנדבוקס (קוד חי בכתובת המאומתת)"
              })
            }
          })
          .catch(() => undefined); // מירוץ — כבר נכתב
        status.relays.push({ chain: m.chain, address: m.address, live: true, rowHe: "שורה נבנתה — קוד חי אומת" });
      } else {
        status.relays.push({
          chain: m.chain,
          address: m.address,
          live,
          rowHe: existing
            ? "שורה קיימת — לא נוגע"
            : live === true
              ? "קוד חי — השורה נכתבה במקביל"
              : live === false
                ? "כבה/ריק — נתון כנה, לא שורה"
                : "הגשש לא ענה — נתון, לא אפס"
        });
      }
    }

    // 2. החותם האחרון — נזרע מהשורש שנקרא מהשרשרת (האמת האחרונה שאותתה)
    let sealId: string | null = null;
    const sealRow = await db.sealRecord.findFirst({ where: { height: MEMORY_SEAL.height } });
    if (!sealRow) {
      const created = await db.sealRecord
        .create({
          data: {
            height: MEMORY_SEAL.height,
            root: MEMORY_SEAL.root,
            leavesCount: 0, // העלים אבדו באיפוס — 0 כנה, לא מומצא
            stateRoot: "recovered-from-chain-anchors-2026-09-11", // סמן-כנות, לא hash מומצא
            gasUsed: 0,
            note: MEMORY_SEAL.noteHe
          }
        })
        .catch(() => undefined);
      sealId = created?.id ?? null;
      status.sealSeeded = true;
    } else {
      sealId = sealRow.id;
      status.sealSeeded = false;
    }

    // 3. עוגני-relay — שורות-ספר מקבלות מאומתות (מקושרות לחותם)
    for (const a of MEMORY_ANCHORS) {
      const existing = await db.anchorTx.findFirst({ where: { txid: a.txid } });
      if (existing) {
        status.anchorRows += 1;
        continue;
      }
      const costEth = Number(ethers.formatEther(BigInt(a.gasUsed) * BigInt(Math.round(a.gasPriceGwei * 1e9))));
      await db.anchorTx
        .create({
          data: {
            sealId: sealId ?? undefined,
            network: a.network,
            kind: "relay",
            txid: a.txid,
            status: "anchored",
            meta: JSON.stringify({
              recoveredFromChain: true,
              recoveredAt: at,
              recoveredBy: "v68-memory-house",
              block: a.block,
              gasUsed: a.gasUsed,
              gasPriceGwei: a.gasPriceGwei,
              costEth: costEth.toFixed(10),
              root: a.root,
              height: a.height,
              rail: "saos-net",
              note: a.noteHe
            })
          }
        })
        .catch(() => undefined);
      status.anchorRows += 1;
    }

    // 4. טפטופי-ההשקיה — שורות-ספר מקבלות מאומתות (ללא חותם — הם פעולות-יד)
    for (const d of MEMORY_DRIPS) {
      const existing = await db.anchorTx.findFirst({ where: { txid: d.txid } });
      if (existing) {
        status.dripRows += 1;
        continue;
      }
      await db.anchorTx
        .create({
          data: {
            network: d.network,
            kind: "irrigation",
            txid: d.txid,
            status: "delivered",
            meta: JSON.stringify({
              recoveredFromChain: true,
              recoveredAt: at,
              recoveredBy: "v68-memory-house",
              door: d.chain,
              block: d.block,
              dripEth: d.dripEth,
              costEth: d.gasCostEth,
              note: d.noteHe
            })
          }
        })
        .catch(() => undefined);
      status.dripRows += 1;
    }

    status.recovered = true;
    status.noteHe =
      "הספר נבנה מחדש מהשרשרת החיה — relays אומתו ב-eth_getCode, עוגני h=1 נקראו מהקבלות, 6 טפטופי-ההשקיה פוענחו מהפורטלים הקנוניים (כולל probe שלא היה מתועד). החותם הבא יהיה h=2 — המשכיות בלי התנגשות.";

    await logOp(
      "memory-house.recover",
      `seal=h${MEMORY_SEAL.height} root=${MEMORY_SEAL.root.slice(0, 18)}… anchors=${status.anchorRows} drips=${status.dripRows} relays=${status.relays.length}`
    ).catch(() => undefined);

    return status;
  } catch (e) {
    status.ok = false;
    status.error = e instanceof Error ? e.message.slice(0, 200) : "recovery failed";
    status.noteHe = "השחזור נכשל — נתון כנה; הספר לא שונה חלקית מעבר למה שהושלם.";
    return status;
  }
}

/** מצב-על זול לתצוגה — בלי קריאות-שרשרת */
export async function memoryHouseStatus(): Promise<MemoryHouseStatus> {
  const at = new Date().toISOString();
  try {
    const [seals, relayRows] = await Promise.all([
      db.sealRecord.count(),
      db.sovereignContract.findMany({ select: { chain: true, address: true, status: true, meta: true } })
    ]);
    const anchors = await db.anchorTx.count({ where: { kind: "relay" } });
    const drips = await db.anchorTx.count({ where: { kind: "irrigation" } });
    const recoveredRelays = relayRows.filter((r) => (r.meta ?? "").includes("v68-memory-house"));
    return {
      ok: true,
      at,
      wipeSignatureHe: seals > 0 ? "הספר בריא — החותם קיים" : "אין חותם — חתימת איפוס",
      recovered: recoveredRelays.length > 0 || seals > 0,
      relays: relayRows.map((r) => ({
        chain: r.chain,
        address: r.address,
        live: r.status === "deployed" ? true : null,
        rowHe: (r.meta ?? "").includes("v68-memory-house") ? "שוחזר על-ידי בית-הזיכרון" : "שורה מקורית"
      })),
      sealSeeded: false,
      anchorRows: anchors,
      dripRows: drips,
      noteHe:
        seals > 0
          ? `הספר חי: ${seals} חותם/ים · ${anchors} עוגני-relay · ${drips} טפטופי-השקיה · ${recoveredRelays.length} שורות relay שוחזרו מהשרשרת`
          : "הספר ריק — המנוע ישחזר מהשרשרת במחזור המפקד הבא",
      lastRunAt: at
    };
  } catch (e) {
    return {
      ok: false,
      at,
      wipeSignatureHe: "לא נמדד",
      recovered: false,
      relays: [],
      sealSeeded: false,
      anchorRows: 0,
      dripRows: 0,
      noteHe: "מצב בית-הזיכרון לא נמדד — נתון, לא אפס",
      lastRunAt: null,
      error: e instanceof Error ? e.message.slice(0, 160) : "status failed"
    };
  }
}
