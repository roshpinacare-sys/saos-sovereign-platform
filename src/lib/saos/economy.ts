/**
 * The economy — energy flow → capture → monetization (הכלכלה: הסטה→לכידה→מימוש).
 * Ported from: steem-main `sovereign/node/harvest.cjs` (4 monetization streams),
 * `sovereign/node/grid98.cjs` (GRID-98 DEX pools, ≤0.5%/step treasury ladder),
 * plus the flywheel: profit → RC/energy funding → more anchoring work.
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
}

export interface EconomyStream {
  name: string;
  he: string;
  amount: number;
  note: string;
}

export interface EconomyResult {
  streams: EconomyStream[];
  totalPerDay: number;
  reinvestedPerDay: number;
  retainedPerDay: number;
  energyFunded: { trx: number; settlements: number };
  verdict: string;
}

export const DEFAULT_ECONOMY: EconomyInput = {
  poolVolumePerDay: 50_000,
  poolFeePct: 0.3,
  gridRoundsPerDay: 1_800, // 8s ticks × 16 rounds hourly ≈ 1,800
  gridProfitPerRound: 0.4,
  inboundRailVolume: 3_000,
  inboundRate: 1000, // 0.001 STEEM = 1 SAOS
  doorCallsPerDay: 250,
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

  const verdict =
    totalPerDay > 0
      ? `גלגל-החור: ${input.flywheelPct}% מהרווח חוזר לריבונות — מממן ~${energyTrxBudget.toLocaleString()} TRX הימור ו-${settlements} יישובי USDT/יום`
      : "אין תנועה — הזז את המחוונים";

  return {
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
