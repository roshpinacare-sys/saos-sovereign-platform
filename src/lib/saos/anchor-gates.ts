/**
 * Anchor gates — honest resource gating (שערי-העגינה: כנות, לא תיאטרון).
 * Ported from: steem-main `agent/hive_rc.cjs` (RC floors), `agent/blurt_health.json`
 * (measured cooldowns), weave_batch honesty notes ("rc-gated: honest skip, parity waits").
 *
 * Why HIVE was pending (from the live run, weave_last.json):
 *   "hive: rc-gated: rc-floor(0.6%<12%) (regen budget — honest skip, parity waits)"
 * Hive RC regenerates ≈20%/day; floors are 8% (light) / 12% (heavy) + 2× headroom.
 */

export interface ChainGate {
  network: "STEEM" | "BLURT" | "HIVE" | "TRON";
  status: "anchored" | "pending" | "gated" | "transit";
  gate: string | null;
  detail: string;
  recovery: string | null;
}

export const HIVE_RC_REGEN_PCT_PER_DAY = 20;
export const HIVE_RC_FLOOR_LIGHT = 8;
export const HIVE_RC_FLOOR_HEAVY = 12;
export const BLURT_COOLDOWN_MIN = 30;
export const BLURT_FEE_FORMULA = "0.05 + 0.2 × KB"; // measured blurt fee law

/** hours until Hive RC reaches a target percent (linear 20%/day regen) */
export function hiveRcHoursToTarget(currentPct: number, targetPct: number): number {
  if (currentPct >= targetPct) return 0;
  return ((targetPct - currentPct) / HIVE_RC_REGEN_PCT_PER_DAY) * 24;
}

export interface HiveRcPlan {
  currentPct: number;
  lightFloorHours: number;
  heavyFloorHours: number;
  verdict: string;
  path: { step: string; detail: string; hours: number }[];
}

export function hiveRcRecoveryPlan(currentPct: number): HiveRcPlan {
  const lightH = hiveRcHoursToTarget(currentPct, HIVE_RC_FLOOR_LIGHT);
  const heavyH = hiveRcHoursToTarget(currentPct, HIVE_RC_FLOOR_HEAVY);
  const path: HiveRcPlan["path"] = [
    {
      step: "התאוששות טבעית (regen)",
      detail: `RC מתחדש ~${HIVE_RC_REGEN_PCT_PER_DAY}%/יום — ללא הוצאה`,
      hours: 0
    },
    {
      step: "סף קל (8%) — custom_json עדין",
      detail: `עוד ${lightH.toFixed(1)} שעות עד לעגינת weave קלה`,
      hours: Number(lightH.toFixed(1))
    },
    {
      step: "סף כבד (12%) — weave מלא + account_update",
      detail: `עוד ${heavyH.toFixed(1)} שעות עד פעולות כבדות`,
      hours: Number(heavyH.toFixed(1))
    },
    {
      step: "האצה ריבונית: power-up / delegate",
      detail:
        "rc_sovereign --hive-powerup: SWAP.HIVE→HIVE→vesting (הכלי קיים בקוד ההיסטורי) או delegate VESTS מחייל בריא",
      hours: 1
    }
  ];
  const verdict =
    currentPct < HIVE_RC_FLOOR_LIGHT
      ? "gated — עוגן בכנות: רגן-תקציב, לא תיאטרון"
      : currentPct < HIVE_RC_FLOOR_HEAVY
        ? "light ops possible — weave אפשרי, כבד נשאר נעול"
        : "open — כל פעולות העגינה זמינות";
  return { currentPct, lightFloorHours: Number(lightH.toFixed(1)), heavyFloorHours: Number(heavyH.toFixed(1)), verdict, path };
}

/** the full anchoring matrix as the platform sees it today */
export function anchoringMatrix(rcPct: number, tronEnergy: number): ChainGate[] {
  const steem: ChainGate = {
    network: "STEEM",
    status: "anchored",
    gate: null,
    detail: "custom_json id=saos.weave.v1 (active, חינם-RC) + קריאת-היסטוריה לאימות",
    recovery: null
  };
  const blurt: ChainGate = {
    network: "BLURT",
    status: "anchored",
    gate: null,
    detail: `חתימה קנונית ידנית (low-s loop), עמלה ${BLURT_FEE_FORMULA}, cooldown ${BLURT_COOLDOWN_MIN} דק׳ מדוד`,
    recovery: null
  };
  const hive: ChainGate = {
    network: "HIVE",
    status: rcPct >= HIVE_RC_FLOOR_LIGHT ? "pending" : "gated",
    gate: rcPct >= HIVE_RC_FLOOR_LIGHT ? null : `rc-floor(${rcPct}%<${HIVE_RC_FLOOR_LIGHT}%)`,
    detail: "אותה משפחת Graphene — dhive raw sign, chain_id קבוע; הקוד מוכח, החסם הוא RC בלבד",
    recovery:
      rcPct >= HIVE_RC_FLOOR_LIGHT
        ? "הפעמה הבאה תעגן בפועל"
        : `התאוששות: ${hiveRcHoursToTarget(rcPct, HIVE_RC_FLOOR_LIGHT).toFixed(1)} שעות, או power-up מיידי`
  };
  const tron: ChainGate = {
    network: "TRON",
    status: tronEnergy > 0 ? "pending" : "transit",
    gate: tronEnergy > 0 ? null : "energy-0 (כל 6 כתובות הכספת)",
    detail:
      tronEnergy > 0
        ? "מסלול ישיר פתוח: TriggerSmartContract עם stateRoot בנתוני הקריאה"
        : "מעבר: root נסחר בתוך stateRoot → רכבת tronbridge היומית (קידוד 6 תווי hash בשבר ה-TRX)",
    recovery:
      tronEnergy > 0
        ? null
        : "energize: freezeBalanceV2 + delegateResource — המודול מוכן בפלטפורמה זו"
  };
  return [steem, blurt, hive, tron];
}
