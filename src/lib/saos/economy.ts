/**
 * The economy — energy flow → capture → monetization (הכלכלה: הסטה→לכידה→מימוש).
 * Ported from: steem-main `sovereign/node/harvest.cjs` (4 monetization streams),
 * `sovereign/node/grid98.cjs` (GRID-98 DEX pools, ≤0.5%/step treasury ladder),
 * plus the flywheel: profit → RC/energy funding → more anchoring work.
 *
 * HONESTY FIX (2026-09-29, autonomy audit מ-2): DEFAULT_ECONOMY was a wish
 * sheet (50K pool volume, 1,800 grid rounds × 0.4, 3K STEEM rail, 250 door
 * calls) — NONE of it measured anywhere. The measured truth (Defi/
 * MISSION-1000.md) is $0.0103/day on $29.37 capital. Defaults are now ZEROS
 * and every result carries mode:"sim"|"measured" + a verdict that refuses to
 * dress simulation as income. Feed real numbers from the income ledger
 * (sovereign/income/daily-*.json) — the UI must show MEASURED as MEASURED.
 */

export interface EconomyInput {
  poolVolumePerDay: number; // SAOS-equivalent daily volume through grid pools
  poolFeePct: number; // e.g. 0.3
  gridRoundsPerDay: number; // micro-tick rounds (8s × 16 historically)
  gridProfitPerRound: number; // avg captured per round (SAOS)
  inboundRailVolume: number; // inbound STEEM via memo saos:harvest/v1 (STEEM/day)
  inboundRate: number; // SAOS per STEEM (historic: 0.001 STEEM = 1 SAOS → inverse)
  doorCallsPerDay: number; // sponsored relay (THE-DOOR) calls
  doorFee: number; // flat SAOS fee per sponsored call
  flywheelPct: number; // % of profit recycled into RC/energy funding
  /** honesty fix: true ONLY when inputs come from the measured income ledger */
  measured?: boolean;
}

export interface EconomyStream {
  name: string;
  he: string;
  amount: number;
  note: string;
}

export interface EconomyResult {
  /** "sim" = assumptions, "measured" = fed from the real income ledger */
  mode: "sim" | "measured";
  streams: EconomyStream[];
  totalPerDay: number;
  reinvestedPerDay: number;
  retainedPerDay: number;
  energyFunded: { trx: number; settlements: number };
  verdict: string;
}

/**
 * ZEROS by default (honesty fix). The old defaults simulated $720+/day
 * from streams that have never been measured; the measured baseline is
 * ~$0.01/day. Real inputs must come from the income ledger — never from
 * hope.
 */
export const DEFAULT_ECONOMY: EconomyInput = {
  poolVolumePerDay: 0,
  poolFeePct: 0.3,
  gridRoundsPerDay: 0,
  gridProfitPerRound: 0,
  inboundRailVolume: 0,
  inboundRate: 1000, // 0.001 STEEM = 1 SAOS (definition, not a measurement)
  doorCallsPerDay: 0,
  doorFee: 2,
  flywheelPct: 30
};

export function simulateEconomy(input: EconomyInput): EconomyResult {
  const poolFees = (input.poolVolumePerDay * input.poolFeePct) / 100;
  const gridFees = input.gridRoundsPerDay * input.gridProfitPerRound;
  const inboundRail = input.inboundRailVolume * input.inboundRate;
  const doorFees = input.doorCallsPerDay * input.doorFee;

  const streams: EconomyStream[] = [
    {
      name: "pool-fees",
      he: "עמלות בריכות GRID-98 (WSBD/ENERGY/WBLURT נגד SAOS)",
      amount: round2(poolFees),
      note: `${input.poolFeePct}% על מחזור ${input.poolVolumePerDay.toLocaleString()}`
    },
    {
      name: "grid-fees",
      he: "רווחי מיקרו-טיק (סולם אוצר ≤0.5%/צעד, ממומן מרווח אמיתי)",
      amount: round2(gridFees),
      note: `${input.gridRoundsPerDay.toLocaleString()} סבבים × ${input.gridProfitPerRound}`
    },
    {
      name: "inbound-rail",
      he: "מסילת STEEM נכנסת (memo saos:harvest/v1)",
      amount: round2(inboundRail),
      note: `${input.inboundRailVolume.toLocaleString()} STEEM × ${input.inboundRate}`
    },
    {
      name: "door-fees",
      he: "עמלות THE-DOOR (relay ב-gas-0 שאנחנו מממנים)",
      amount: round2(doorFees),
      note: `${input.doorCallsPerDay} קריאות × ${input.doorFee}`
    }
  ];

  const totalPerDay = round2(streams.reduce((s, x) => s + x.amount, 0));
  const reinvestedPerDay = round2((totalPerDay * input.flywheelPct) / 100);
  const retainedPerDay = round2(totalPerDay - reinvestedPerDay);

  // flywheel: reinvestment buys TRX energy + Hive RC — more anchoring capacity
  const energyTrxBudget = Math.floor(reinvestedPerDay * 0.6); // 60% to TRON energy
  const settlements = Math.floor((energyTrxBudget * 10) / 64_895);

  // honesty fix: a simulation with zero measured inputs must say so, loudly
  const measured = input.measured === true;
  const mode: "sim" | "measured" = measured ? "measured" : "sim";
  const verdict = !measured
    ? `סימולציה בלבד (mode=sim) — אף זרימה כאן לא נמדדה. המדידה האמתית (MISSION-1000): $0.0103/יום. הזן מספרים מפנקס-ההכנסה והעבר measured=true כדי שזה יקרא "כלכלה".`
    : totalPerDay > 0
      ? `נמדד (mode=measured): גלגל-החור ${input.flywheelPct}% מהרווח חוזר לריבונות — מממן ~${energyTrxBudget.toLocaleString()} TRX הימור ו-${settlements} יישובי USDT/יום`
      : "נמדד (mode=measured): אין תנועה — הזז את המחוונים";

  return {
    mode,
    streams,
    totalPerDay,
    reinvestedPerDay,
    retainedPerDay,
    energyFunded: { trx: energyTrxBudget, settlements },
    verdict
  };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
