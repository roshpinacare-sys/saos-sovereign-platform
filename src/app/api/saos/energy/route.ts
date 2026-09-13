import { NextResponse } from "next/server";
import {
  planEnergize,
  minStakeForSettlements,
  ENERGY_PER_TRX_PER_DAY,
  BURN_SUN_PER_ENERGY,
  USDT_TRANSFER_ENERGY
} from "@/lib/saos/tron-energize";
import { hiveRcRecoveryPlan, HIVE_RC_REGEN_PCT_PER_DAY } from "@/lib/saos/anchor-gates";
import { probeHiveRc, hiveAnchorAccount } from "@/lib/saos/hive-rc-live";

export const dynamic = "force-dynamic";

// R15 — GET הוא קריאה-בלבד. שיעור "חוסר-האמיתות": כל דפדוף בוויו רשם
// קבלה-שרשרתית לפנקס-הראיות (energy-plan) — ~4 שורות/דק' משני דפים פתוחים,
// ~4300 שורות-רעש ביום בספר שמבקרי-השלמות מעידים עליו "אפס-זיוף". התוכנית
// היא חישוב-טהור; קבלה נרשמת רק על פעולה-מפורשת של המפעיל (POST).

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const net = (url.searchParams.get("net") ?? "tron").toLowerCase();

    if (net === "hive") {
      // v9 — the RC behind the recovery plan is MEASURED live against the
      // public HIVE chain (60s cache). The ?rc= override stays (what-if
      // simulations are a legitimate planning tool) but the DEFAULT is
      // now reality, not a stale env snapshot.
      let rcPct: number;
      let rcSource: "live" | "sim";
      const sim = url.searchParams.get("rc");
      if (sim !== null && Number.isFinite(Number(sim))) {
        rcPct = Number(sim);
        rcSource = "sim";
      } else {
        const live = await probeHiveRc(hiveAnchorAccount());
        if (live.ok) {
          rcPct = live.rcPct;
          rcSource = "live";
        } else {
          rcPct = 0.6; // honest fallback — stated as such
          rcSource = "sim";
        }
      }
      const plan = hiveRcRecoveryPlan(rcPct);

      return NextResponse.json({
        ok: true,
        network: "HIVE",
        params: { regenPctPerDay: HIVE_RC_REGEN_PCT_PER_DAY, lightFloor: 8, heavyFloor: 12 },
        plan,
        rcSource
      });
    }

    // TRON energize (default)
    const trx = Math.max(0, Number(url.searchParams.get("trx") ?? 6500));
    const txs = Math.max(1, Number(url.searchParams.get("txs") ?? 4));
    const price = url.searchParams.get("price");
    const plan = planEnergize({
      trxStaked: trx,
      txsPerDayWanted: txs,
      trxPriceUsd: price !== null && Number.isFinite(Number(price)) ? Number(price) : null
    });

    return NextResponse.json({
      ok: true,
      network: "TRON",
      params: {
        sunPerTrx: 1_000_000,
        burnSunPerEnergy: BURN_SUN_PER_ENERGY,
        usdtTransferEnergy: USDT_TRANSFER_ENERGY,
        energyPerTrxPerDay: ENERGY_PER_TRX_PER_DAY
      },
      minStakeForSettlements: minStakeForSettlements(txs),
      plan
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "energy failed" },
      { status: 200 }
    );
  }
}
