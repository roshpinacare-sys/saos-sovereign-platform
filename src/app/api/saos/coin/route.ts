import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mintPolicy, saosLedger } from "@/lib/saos/saos-mint";
import { exchangeStatus } from "@/lib/saos/exchange-live";
import { SAOS_VERSION } from "@/lib/saos/version";
import * as fs from "fs";
import * as path from "path";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/coin — כרטיס-הזהות המלא של המטבע שלנו (SAOS-M).
 * =====================================================================
 * הוראת הבעלים (trace 1a0936c3623f2a6d): "למה אין שום מידע מקיף על
 * המטבע שלנו מי מה — צריך לדעת עליו הכל מהכל". הזהות של המטבע הייתה
 * מפוזרת על 6+ חדרים ו-2 שרשרות; מהיום יש מקור אחד קנוני שמרכיב את
 * כל האמת הנמדדת מהמקורות הראשיים (לא ממציא כלום):
 *
 *   1. מדיניות ה-mint הקטן (saos-mint/v1) — lib/saos/saos-mint.ts
 *   2. הפנקס החי — SaosMint + SaosMintEntry (DB, העסקאות שבוצעו)
 *   3. הבורסה החיה — exchangeStatus() (חוזה SAOSExchange על SAOS-EVM)
 *   4. רשת-החוזים — state/deployment.json (10 חוזים, כתובות אמת)
 *   5. SAOS-NET — SealRecord (הגבהים/שורשים) — השרשרת הריבונית
 *   6. שערי-כנות — מה עדיין לא נאמת ולמה (בלי לייפות)
 *
 * אין סודות כאן — כתובות פומביות ומדיניות בלבד.
 */

interface DeploymentState {
  ok?: boolean;
  chain?: string;
  chainId?: number;
  rpc?: string;
  artifactVersion?: string;
  deployedAt?: string;
  deployBlock?: number;
  operator?: string;
  contracts?: Record<string, string>;
  links?: string[];
  rails?: string[];
}

function readDeployment(): DeploymentState | null {
  // v91 — candidates are cwd-relative (web runs from the platform root; the
  // runner state lives in mini-services/evm-mesh/state); no absolute layout.
  const candidates = [
    path.resolve(process.cwd(), "mini-services/evm-mesh/state/deployment.json"),
    path.resolve(process.cwd(), "..", "mini-services/evm-mesh/state/deployment.json")
  ];
  for (const p of candidates) {
    try {
      return JSON.parse(fs.readFileSync(p, "utf8")) as DeploymentState;
    } catch {
      continue;
    }
  }
  return null;
}

export async function GET() {
  try {
    // ── 1. מדיניות המטבע (מוגדרת-קוד — spec-frozen) ─────────────────────
    const policy = mintPolicy();

    // ── 2. הפנק החי: מה באמת הוטבע עד היום ──────────────────────────────
    const ledger = await saosLedger();
    const mintRows = await db.saosMint.findMany({
      orderBy: { createdAt: "desc" as const },
      take: 10,
      select: { mintId: true, total: true, soldiers: true, status: true, sealHeight: true, digest: true, createdAt: true }
    });

    // ── 3. SAOS-NET — השרשרת הריבונית שהמטבע חתום עליה ──────────────────
    const lastSeal = await db.sealRecord.findFirst({
      orderBy: { height: "desc" as const },
      select: { height: true, root: true, stateRoot: true, createdAt: true }
    });
    const sealCount = await db.sealRecord.count();

    // ── 4. הבורסה החיה על SAOS-EVM ───────────────────────────────────────
    let exchange: Awaited<ReturnType<typeof exchangeStatus>> | null = null;
    let exchangeError: string | null = null;
    try {
      exchange = await exchangeStatus();
    } catch (e) {
      exchangeError = e instanceof Error ? e.message.slice(0, 140) : "מדידת-הבורסה נכשלה";
    }

    // ── 5. רשת-החוזים (כתובות אמת מהפריסה) ──────────────────────────────
    const dep = readDeployment();

    // ── 6. שערי-כנות: מה עדיין לא נאמת ──────────────────────────────────
    const honestGates: Array<{ gate: string; he: string; opens: string }> = [];
    if (ledger.supply === 0) {
      honestGates.push({
        gate: "mint-קטן-טרם-בוצע",
        he: "מדיניות ה-mint הקטן (300,000 SAOS) מוגדרת ומקופאת בקוד — אבל הפנק החי מציג אפס: אף גרעין-הטבעה עוד לא רץ. הסיבה הנמדדת: רוסטר-החיילים נקרא מהכספת החתומה — והכספת נשרפה בפקודת-ההשמדה 2026-09-08. בלי כספת חתומה חדשה — המטבע לא מוטבע. לא מזויף.",
        opens: "פעולת-בעלים: איטום כספת חדשה → רוסטר חיילים → POST /api/saos/mint"
      });
    }
    if (exchange && exchange.totals.swaps === 0) {
      honestGates.push({
        gate: "אין-מסחר",
        he: "הבריכות זרועות אבל אף Swap לא רץ — הנזילות ממתינה.",
        opens: "חיילים סוחרים / פעימת-מימוש"
      });
    }
    honestGates.push({
      gate: "מחיר-מדיניות-פנימי",
      he: "$0.001 ל-SAOS-M הוא מחיר-מדיניות פנימי על הבורסה שלנו (הנחיית הבעלים: שווי נמוך בכוונה — לא $3) — הוא אינו מחיר-שוק חיצוני ואין לו ספר-ספרים חיצוני. כנות: עד היום אין הנפקה ציבורית, אין רישום בורסות חוץ, ואין טענה כזאת.",
      opens: "החלטת-בעלים עתידית בלבד"
    });

    return NextResponse.json({
      ok: true,
      version: SAOS_VERSION,
      measuredAt: new Date().toISOString(),
      identity: {
        name: "SAOS-M",
        he: "המטבע הריבוני של האורגניזם",
        symbol: "SAOS",
        decimals: 18,
        wrapped: "wSAOS (עטוף 1:1 מול פיקדון SAOS-M אמיתי — לעולם לא מוטבע ישירות)",
        chains: [
          { id: "SAOS-NET", kind: "kernel+seals", note: "השרשרת הריבונית — גרעין דטרמיניסטי + איטומים + עגינה חוץ" },
          { id: "SAOS-EVM (chainId 31337)", kind: "lab-chain", note: "שרשרת-המעבדה המתמשכת — SAOSLedger + SAOSExchange (10 חוזים)" }
        ],
        policyPriceUsd: 0.001,
        policyPriceNote: "מדיניות נמוכה בכוונה (לא $3): יחידות רבות לכל דולר גיבוי = בריכות רבות ועומק אמיתי — החלטת הבעלים",
        feeBps: exchange?.policy?.feeBps ?? 20,
        feeSplit: "10bps לקופת-האוצר · 10bps לצמיחת-הבריכה (הבריכה גדלה מעצמה)",
        swapCapBps: exchange?.policy?.swapCapBps ?? 500,
        motto: "אנחנו מנצחים את הבלוקצ'יין"
      },
      mintPolicy: policy,
      liveLedger: ledger,
      mintsRecent: mintRows,
      net: {
        lastSeal,
        sealCount,
        note: "SAOS-NET — השרשרת הריבונית: כל איטום גובה חדש, ומעוגן חוץ (STEEM/BLURT/ETHEREUM/SOLANA…)"
      },
      exchange: exchange
        ? {
            contract: exchange.contract,
            artifact: exchange.artifact,
            totals: exchange.totals,
            assets: exchange.assets,
            pools: exchange.pools,
            treasury: exchange.treasury,
            traders: exchange.traders
          }
        : null,
      exchangeError,
      deployment: dep
        ? {
            chain: dep.chain,
            chainId: dep.chainId,
            artifactVersion: dep.artifactVersion,
            deployedAt: dep.deployedAt,
            deployBlock: dep.deployBlock,
            operator: dep.operator,
            contracts: dep.contracts,
            rails: dep.rails
          }
        : null,
      economics: {
        streamsHe: [
          "עמלות בריכות (0.3% מדגם יומי) — GRID-98 ובריכות הבורסה",
          "רווחי מיקרו-טיק (סולם אוצר ≤0.5%/צעד)",
          "מסילת STEEM נכנסת (memo saos:harvest/v1) — 0.001 STEEM = 1 SAOS",
          "עמלות THE-DOOR (relay חינם לנו, ממומן מהמטבע)"
        ],
        flywheelPct: 30,
        flywheelHe: "30% מהרווח מוחזר למימון RC/אנרגיה — העגינה מממנת את עצמה"
      },
      honestGates
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "כרטיס-הזהות של המטבע נכשל" },
      { status: 200 }
    );
  }
}
