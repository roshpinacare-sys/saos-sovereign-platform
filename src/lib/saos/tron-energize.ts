/**
 * TRON energy sovereignty (ריבונות אנרגיית TRON) — THE missing piece.
 * The historic archive proved: energy=0 across all 6 vault addresses;
 * "TRC20 settlement still waits energy delegation" (worklog Task 113/114).
 * No stake/delegate code existed anywhere — this module supplies the math
 * and the exact transaction plan (freezeBalanceV2 + delegateResource).
 *
 * Chain parameters (TRON mainnet, parametric — configurable):
 *   - 1 TRX = 10 sun × 100? no: 1 TRX = 1_000_000 sun
 *   - burn price: 420 sun per energy unit (TRONIP8 = 0.00042 TRX/energy)
 *   - USDT (TRC20) transfer ≈ 64,895 energy (~65k)
 *   - staking yield ≈ 10 energy per day per staked TRX (varies with total staked)
 */

export const SUN_PER_TRX = 1_000_000;
export const BURN_SUN_PER_ENERGY = 420;
export const USDT_TRANSFER_ENERGY = 64_895;
export const ENERGY_PER_TRX_PER_DAY = 10; // conservative mainnet average
export const STAKE_LOCK_DAYS = 14; // unstake unlock window

export interface EnergizePlanInput {
  trxStaked: number; // TRX to stake for energy
  txsPerDayWanted: number;
  trxPriceUsd?: number | null; // for USD reporting
}

export interface EnergizePlan {
  trxStaked: number;
  dailyEnergy: number;
  settlementsPerDay: number; // USDT transfers covered
  uncoveredPerDay: number;
  burnCostPerTxTrx: number;
  burnCostPerDayTrx: number;
  breakEvenTxs: number; // txs until staking beats burning
  usdPerDaySaved: number | null;
  txPlan: { step: string; call: string; detail: string }[];
  verdict: string;
}

export function planEnergize(input: EnergizePlanInput): EnergizePlan {
  const { trxStaked, txsPerDayWanted, trxPriceUsd = null } = input;
  const dailyEnergy = Math.floor(trxStaked * ENERGY_PER_TRX_PER_DAY);
  const settlementsPerDay = Math.floor(dailyEnergy / USDT_TRANSFER_ENERGY);
  const uncoveredPerDay = Math.max(0, txsPerDayWanted - settlementsPerDay);
  const burnCostPerTxTrx =
    (USDT_TRANSFER_ENERGY * BURN_SUN_PER_ENERGY) / SUN_PER_TRX; // ≈ 27.25 TRX
  const burnCostPerDayTrx = burnCostPerTxTrx * txsPerDayWanted;
  const breakEvenTxs = burnCostPerTxTrx > 0 ? Math.ceil(trxStaked / burnCostPerTxTrx) : 0;
  const usdPerDaySaved =
    trxPriceUsd !== null ? burnCostPerDayTrx * trxPriceUsd : null;

  const txPlan = [
    {
      step: "1. הימור אנרגיה (stake)",
      call: "transactionBuilder.freezeBalanceV2({ owner, resource: 'ENERGY', frozenBalance: sunAmount })",
      detail: `${trxStaked.toLocaleString()} TRX → ~${dailyEnergy.toLocaleString()} אנרגיה/יום`
    },
    {
      step: "2. האצלה עצמית (delegate)",
      call: "transactionBuilder.delegateResource({ owner, receiver, resource: 'ENERGY', balance: sunAmount, lock: false })",
      detail: "מהכתובת הראשית (idx0) אל כתובת המשדר של העגינה — האנרגיה זמינה מיידית"
    },
    {
      step: "3. יישוב ישיר (settle)",
      call: "TriggerSmartContract → USDT transfer עם stateRoot ב-memo/נתונים",
      detail: `${settlementsPerDay} יישובים/יום ללא שריפת TRX — עוגן אמיתי, לא תחבורת-עוקף`
    },
    {
      step: "4. שחרור (unstake lifecycle)",
      call: `unfreezeBalanceV2 → המתנה ${STAKE_LOCK_DAYS}d → withdrawExpireUnfreeze`,
      detail: `ההימור נזיל אחרי ${STAKE_LOCK_DAYS} ימי שחרור`
    }
  ];

  const verdict =
    settlementsPerDay >= txsPerDayWanted
      ? `מספיק: ${trxStaked.toLocaleString()} TRX מכסים ${txsPerDayWanted} יישובים/יום — חיסכון ${burnCostPerDayTrx.toFixed(1)} TRX/יום`
      : settlementsPerDay > 0
        ? `חלקי: מכסה ${settlementsPerDay}/${txsPerDayWanted} יישובים — השאר נשאר בשריפה או הגדל הימור`
        : "אפס כיסוי — הגדל את ההימור או הישאר ברכבת tronbridge היומית";

  return {
    trxStaked,
    dailyEnergy,
    settlementsPerDay,
    uncoveredPerDay,
    burnCostPerTxTrx: Number(burnCostPerTxTrx.toFixed(2)),
    burnCostPerDayTrx: Number(burnCostPerDayTrx.toFixed(1)),
    breakEvenTxs,
    usdPerDaySaved: usdPerDaySaved !== null ? Number(usdPerDaySaved.toFixed(2)) : null,
    txPlan,
    verdict
  };
}

/** minimum TRX to stake for a target number of USDT settlements per day */
export function minStakeForSettlements(target: number): number {
  return Math.ceil((target * USDT_TRANSFER_ENERGY) / ENERGY_PER_TRX_PER_DAY);
}
