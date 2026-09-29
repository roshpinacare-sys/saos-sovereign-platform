import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { probeHiveRc, hiveAnchorAccount } from "@/lib/saos/hive-rc-live";
import { probeTronVault } from "@/lib/saos/tron-live";
import { probeEthereum, probeSolana } from "@/lib/saos/eth-sol-live";
import { probeBsc } from "@/lib/saos/bsc-live";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/live-probes — LIVE measurements of the resource gates:
 *   hive  — RC mana of the HIVE anchor account (rc_api, live, 60s cache)
 *   tron  — funded/energy state of the 6 vault TRON addresses (90s cache)
 *   eth   — Ethereum mainnet: blockNumber + chainId + gasPrice (v10, 60s cache)
 *   sol   — Solana mainnet-beta: health + slot + epoch + version (v10, 60s cache)
 *   bsc   — BNB Smart Chain: blockNumber + chainId + gasPrice + sovereign
 *           BNB balance (v14, 60s cache — the 8th rail, same EVM address)
 *
 * Read-only public API calls; no keys, no broadcast. Failure is data:
 * each section carries its own ok/error — the matrix falls back honestly.
 *
 * v60 מסילת-הרכבת (אותו דפוס האמת של status/v55 + התזוזות/v59): בפג-מטמון
 * הקריאה רכבה על מלוא המסע חוצה-הרשתות — נמדד חי 3.6-9.0ש' (5 מסילות
 * ציבוריות עם פיילאובר רציפתי ותם-זמן 9ש' לכל קריאה). זו גם כתובת-
 * הבריאות של השומר (תם-זמן 6ש') — רינדור של 9ש' נקרא אצלו ככשל-ווב.
 * מעתה: המסלול החי (מקבילי — טרון שוחרר מהשרשור) רץ ברקע וממלא את
 * המטמון, והתשובה חוזרת תוך 2.5ש': האמת האחרונה (עם שורת-כנות
 * `refreshing: true`) או, לפני המדידה הראשונה, תשובת-המתנה כנה.
 * ?force=1 ממתין לאמת הטרייה במלואה — זו מדידה מכוונת.
 */

// ─── מסלול המדידה החי — מקבילי מלא ───────────────────────────────────────────

interface Batch {
  hive: Awaited<ReturnType<typeof probeHiveRc>>;
  tron: Awaited<ReturnType<typeof probeTronVault>>;
  eth: Awaited<ReturnType<typeof probeEthereum>>;
  sol: Awaited<ReturnType<typeof probeSolana>>;
  bsc: Awaited<ReturnType<typeof probeBsc>>;
}

async function runBatch(force: boolean): Promise<Batch> {
  // v60 — טרון בתוך המנה (היה שרשור אחרי ה-Promise.all: מקס(4 מסילות) +
  // טרון = זמן-קיר כפול). עכשיו: ה-DB המהיר נפתח מייד וטרון משורשר ממנו
  // בתוך אותה מנה — זמן-הקיר הוא המסילה האיטית מכולן, לא הסכום.
  const [hive, tron, eth, sol, bsc] = await Promise.all([
    probeHiveRc(hiveAnchorAccount(), { force }),
    db.vaultSlot
      .findMany({
        where: { network: "TRON", address: { not: null } },
        orderBy: { slot: "asc" },
        select: { slot: true, address: true }
      })
      .then((slots) =>
        // v57 — דה-דופ כתובות: אותה דלת יכולה לשמש חריץ sovereign וגם vault
        // (TMXHfFQd = sovereign/headcorner וגם vault-2 מהאיחוי) — גשש אחד לכל
        // כתובת, והטבלה בוויו לא תיתקע על React key כפול.
        probeTronVault(Array.from(new Set(slots.map((s) => s.address as string))), { force })
      ),
    probeEthereum({ force }),
    probeSolana({ force }),
    probeBsc({ force })
  ]);
  return { hive, tron, eth, sol, bsc };
}

function batchToResponse(b: Batch) {
  return {
    ok: b.hive.ok || b.tron.ok || b.eth.ok || b.sol.ok || b.bsc.ok,
    hive: {
      ok: b.hive.ok,
      account: b.hive.account,
      exists: b.hive.exists,
      rcPct: b.hive.rcPct,
      currentMana: b.hive.currentMana,
      maxRc: b.hive.maxRc,
      hoursToLightFloor: b.hive.hoursToLightFloor,
      hoursToHeavyFloor: b.hive.hoursToHeavyFloor,
      vestingShares: b.hive.vestingShares,
      delegatedVesting: b.hive.delegatedVesting,
      receivedVesting: b.hive.receivedVesting,
      apiNode: b.hive.apiNode,
      measuredAt: b.hive.measuredAt,
      error: b.hive.error
    },
    tron: {
      ok: b.tron.ok,
      checked: b.tron.checked,
      funded: b.tron.funded,
      totalBalanceTrx: b.tron.totalBalanceTrx,
      totalEnergy: b.tron.totalEnergy,
      energizeReady: b.tron.energizeReady,
      measuredAt: b.tron.measuredAt,
      addresses: b.tron.addresses,
      error: b.tron.error
    },
    eth: {
      ok: b.eth.ok,
      chainId: b.eth.chainId,
      blockNumber: b.eth.blockNumber,
      gasPriceGwei: b.eth.gasPriceGwei,
      endpoint: b.eth.endpoint,
      measuredAt: b.eth.measuredAt,
      error: b.eth.error
    },
    sol: {
      ok: b.sol.ok,
      health: b.sol.health,
      slot: b.sol.slot,
      blockHeight: b.sol.blockHeight,
      epoch: b.sol.epoch,
      epochProgressPct: b.sol.epochProgressPct,
      absoluteSlot: b.sol.absoluteSlot,
      transactionCount: b.sol.transactionCount,
      solanaCore: b.sol.solanaCore,
      endpoint: b.sol.endpoint,
      measuredAt: b.sol.measuredAt,
      error: b.sol.error
    },
    bsc: {
      ok: b.bsc.ok,
      chainId: b.bsc.chainId,
      blockNumber: b.bsc.blockNumber,
      gasPriceGwei: b.bsc.gasPriceGwei,
      endpoint: b.bsc.endpoint,
      sovereign: b.bsc.sovereign,
      measuredAt: b.bsc.measuredAt,
      error: b.bsc.error
    },
    usage: "GET ?force=1 — מדידה טרייה (עוקף מטמון)"
  };
}

// ─── מסילת-הרכבת: אמת-אחרונה + רענון-ברקע ──────────────────────────────────

const RAIL_MS = 2_500;

const G = globalThis as unknown as {
  __saosLiveProbes?: { at: number; value: ReturnType<typeof batchToResponse> };
  __saosLiveProbesInflight?: Promise<Batch>;
};

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const force = q.get("force") === "1";

    if (!G.__saosLiveProbesInflight) {
      G.__saosLiveProbesInflight = runBatch(force)
        .then((b) => {
          G.__saosLiveProbes = { at: Date.now(), value: batchToResponse(b) };
          return b;
        })
        .finally(() => {
          G.__saosLiveProbesInflight = undefined;
        });
    }

    // מדידה מכוונת — המפעיל ממתין לאמת הטרייה במלואה (כפתור "מדוד עכשיו").
    if (force) {
      const b = await G.__saosLiveProbesInflight;
      return NextResponse.json(G.__saosLiveProbes?.value ?? batchToResponse(b));
    }

    // המסילה: התשובה חוזרת תוך 2.5ש' לכל היותר — המסלול החי ממשיך ברקע
    // (דה-דופ בכל מודול-גשש מבטיח שאין כפילויות רשת) וממלא את האמת לבאים.
    const rail = new Promise<null>((resolve) => {
      const t = setTimeout(() => resolve(null), RAIL_MS);
      t.unref?.();
    });
    const winner = await Promise.race([G.__saosLiveProbesInflight, rail]);
    if (winner) {
      return NextResponse.json(G.__saosLiveProbes?.value ?? batchToResponse(winner));
    }
    const last = G.__saosLiveProbes;
    if (last) {
      const ageSec = Math.round((Date.now() - last.at) / 1000);
      return NextResponse.json({
        ...last.value,
        refreshing: true,
        honesty: `המסילות הציבוריות עדיין נמדדות ברקע — תשובה מהאמת האחרונה (לפני ${ageSec}ש'); המדידה החיה תמלא את המטמון ועוד מעט תיראה`
      });
    }
    // אין עדיין אמת ראשונה במופע הזה — המתנה כנה, לא נתונים מדומיינים
    return NextResponse.json({
      ok: false,
      pending: true,
      honesty: `מסילת ${RAIL_MS / 1000}ש' — המדידה הראשונה של המופע עדיין רצה ברקע (5 מסילות ציבוריות); הבקשה הבאה תקבל את האמת`,
      usage: "GET ?force=1 — מדידה טרייה (עוקף מטמון)"
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "live-probes failed" },
      { status: 200 }
    );
  }
}
