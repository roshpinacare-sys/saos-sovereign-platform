/**
 * src/lib/saos/delegation.ts — v128.0.0 "הריבונות-האנושית"
 * ============================================================================
 * הוראת-הבעלים: "לוודא שהריבונות מעבירה ומטפלת בהאצלת כוח לחיילים ברשתות
 * בצורה שווה כדי שנוכל לקבל את מלוא סכום ההצבעות וגם כוח פעילות מלא".
 *
 * המדידה-החיה (2026-10-04): STEEM — headcorner 3811 netHP מול חיילים 30-49
 * (פער ×115) · HIVE — 25 HP סה"כ (אין-מה-להאציל — מדווח-כנה).
 *
 * התוכנית: רזרבה-ריבונית למפקד (ברירת-מחדל 1000 HP — נדרש ל-RC של פעולות-
 * השוק), העודף מפוצל שווה בין החיילים — כל-חייל מגיע לאותו-netHP.
 * הביצוע: delegate_vesting_shares עם מפתח-active של headcorner (המסילה-
 * המוכחת של fleet-arm/mm-live) — כמות-מוחלטת (ה-op קובע-מצב-מצטבר).
 */

import { withRoleWif, type SigningAuthority } from "@/lib/vault-seal";
import { isWifShape, wifToPub } from "./soldier-keys";
import { deliberate, isHalted } from "./deliberation";
import { withSignerLease } from "./signer-lease";

const STEEM_RPC = "https://api.steemit.com";
const HIVE_RPC = "https://api.hive.blog";
/** רזרבת-המפקד (HP) — נשארת-על-headcorner ל-RC של פעולות-השוק */
export const COMMANDER_RESERVE_HP = 1000;
export const DELEGATION_MIN_HP_STEP = 5; // מתחת-לזה לא שווה-שידור

interface ChainProps { fund: number; shares: number }
interface AccRow {
  name: string;
  vesting_shares: string;
  received_vesting_shares?: string;
  delegated_vesting_shares?: string;
}

async function rpc<T>(url: string, method: string, params: unknown): Promise<T> {
  const j = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    signal: AbortSignal.timeout(20_000),
  }).then((r) => r.json()) as { result?: T; error?: { message?: string } };
  if (j.error) throw new Error(String(j.error.message ?? "rpc-error").slice(0, 140));
  return j.result as T;
}

export const PARITY_SOLDIERS = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "wic", "wog", "woq"] as const;

async function propsOf(chain: "steem" | "hive"): Promise<ChainProps> {
  const url = chain === "steem" ? STEEM_RPC : HIVE_RPC;
  const field = chain === "steem" ? "total_vesting_fund_steem" : "total_vesting_fund_hive";
  const p = await rpc<Record<string, string>>(url, "condenser_api.get_dynamic_global_properties", []);
  return { fund: parseFloat(p[field] ?? "0"), shares: parseFloat(p.total_vesting_shares ?? "1") };
}

async function accountsOf(chain: "steem" | "hive", names: string[]): Promise<AccRow[]> {
  const url = chain === "steem" ? STEEM_RPC : HIVE_RPC;
  return await rpc<AccRow[]>(url, "condenser_api.get_accounts", [names]);
}

/** ההאצלה-הקיימת-פר-חייל — נמדדת מהחשבון-של-החייל עצמו (received_vesting_shares).
 *  condenser_api.list_vesting_delegations אינו-קיים-בצמתים-המוכחים שלנו
 *  (נמדד חי 2026-10-04: "Could not find method"). ההנחה-הגלויה: כל-ההאצלה
 *  שהחייל-מקבל מגיעה-מ-headcorner (החשבונות-פרטיים-שלנו). */
async function existingDelegations(chain: "steem" | "hive", soldiers: readonly string[]): Promise<Map<string, number>> {
  const url = chain === "steem" ? STEEM_RPC : HIVE_RPC;
  const rows = await rpc<AccRow[]>(url, "condenser_api.get_accounts", [[...soldiers]]);
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.name, parseFloat(r.received_vesting_shares ?? "0"));
  return map;
}

export interface ParityPlan {
  chain: "steem" | "hive";
  ratio: number; // HP ל-VEST
  commanderNetHP: number;
  commanderReserveHP: number;
  totalDelegableHP: number;
  equalShareHP: number;
  rows: Array<{ soldier: string; netHP: number; targetHP: number; deltaHP: number; currentlyDelegatedVESTS: number; toDelegateVESTS: number }>;
  note: string;
  skipped?: string; // סיבת-דילוג כנה (למשל HIVE-אפס-מלאי)
}

/** בניית-תוכנית-שוויון — מדידה-בלבד, אפס-שידור */
export async function buildParityPlan(chain: "steem" | "hive", commander: string): Promise<ParityPlan> {
  const props = await propsOf(chain);
  const ratio = props.fund / props.shares;
  const names = [commander, ...PARITY_SOLDIERS];
  const accs = await accountsOf(chain, names);
  const byName = new Map(accs.map((a) => [a.name, a]));
  const cmd = byName.get(commander);
  if (!cmd) throw new Error("המפקד לא נמדד");
  const netHP = (a: AccRow) =>
    parseFloat(a.vesting_shares) * ratio + parseFloat(a.received_vesting_shares ?? "0") * ratio - parseFloat(a.delegated_vesting_shares ?? "0") * ratio;
  const cmdNet = netHP(cmd);
  if (chain === "hive") {
    // כנות: סה"כ 25 HP על HIVE — אין-משמעות-כלכלית להאצלה-שם כרגע
    return {
      chain, ratio, commanderNetHP: cmdNet, commanderReserveHP: COMMANDER_RESERVE_HP,
      totalDelegableHP: 0, equalShareHP: 0, rows: [],
      note: "HIVE: סה\"כ ה-HP בקבוצה קטן מכדי שהאצלה תשנה-משהו — מדולג כנה עד-שתיבנה-סוללת-HP-אמיתית",
      skipped: "hive-no-stake",
    };
  }
  // v128 תיקון-אמת: האצלה-מתוך-ה-own-בלבד — חסם-שהתקבל (received) לא-ניתן-להאצלה-הלאה
  // (נמדד חי: ל-headcorner יש 244HP שהוא-מקבל מגורם-חיצוני — לא-חלק-מהמאגר-שלנו)
  const cmdOwnHP = parseFloat(cmd.vesting_shares) * ratio;
  const cmdOutHP = parseFloat(cmd.delegated_vesting_shares ?? "0") * ratio;
  const pool = Math.max(0, cmdOwnHP - cmdOutHP - COMMANDER_RESERVE_HP);
  // בניית-תוכנית-שוויון — מדידה-בלבד, אפס-שידור
  // v129 — שער-מפתח: חייל-בלי-מפתח-מוכח אינו-יעד-האצלה (הלקח: הואצל-כוח
  // ל-hcsoldier1/2/3 שאין-לנו-מפתחות-אליהם — כוח-מת על-השרשרת)
  const { actorCanSign } = await import("./deliberation");
  const keyOk: Array<{ soldier: string; ok: boolean; he: string }> = [];
  for (const s of PARITY_SOLDIERS) {
    const k = await actorCanSign(s, "steem", "active");
    keyOk.push({ soldier: s, ok: k.ok, he: k.he });
  }
  const keyless = keyOk.filter((k) => !k.ok).map((k) => k.soldier);
  const sold = PARITY_SOLDIERS.filter((s) => !keyless.includes(s));
  const soldierRows = sold.map((s) => ({ soldier: s, row: byName.get(s) })).filter((x) => x.row);
  const soldierNetSum = soldierRows.reduce((acc, x) => acc + netHP(x.row!), 0);
  const equalShare = soldierRows.length ? (pool + soldierNetSum) / soldierRows.length : 0;
  const current = await existingDelegations(chain, PARITY_SOLDIERS);
  const rows = soldierRows.map(({ soldier, row }) => {
    const net = netHP(row!);
    const ownHP = parseFloat(row!.vesting_shares) * ratio; // ה-own-של-החייל (בלי-האצלות-שהוא-מקבל)
    const currentlyDelegatedVESTS = current.get(soldier) ?? 0;
    // ה-op קובע-מצב-מצטבר: יעד-מוחלט = האצלה-שהופכת own+iעד ליעד-השוויון
    const toDelegateVESTS = Math.max(0, Math.floor((equalShare - ownHP) / ratio));
    return { soldier, netHP: net, targetHP: equalShare, deltaHP: equalShare - net, currentlyDelegatedVESTS, toDelegateVESTS };
  });
  return {
    chain, ratio, commanderNetHP: cmdNet, commanderReserveHP: COMMANDER_RESERVE_HP,
    totalDelegableHP: pool, equalShareHP: equalShare, rows,
    note: `STEEM: מאגר-המפקד-האציל-בר-האצלה ${pool.toFixed(0)} HP (own ${cmdOwnHP.toFixed(0)} − out ${cmdOutHP.toFixed(0)} − רזרבה ${COMMANDER_RESERVE_HP}) · יעד-שוויון ${equalShare.toFixed(0)} HP לכל-אחד` + (keyless.length ? ` · מרוחקים-מהתוכנית (אין-מפתח-מוכח): ${keyless.join(", ")}` : ""),
  };
}

/** ביצוע-התוכנית על STEEM — delegate_vesting_shares מאומת-עצמית.
 *  v129 — שער-המחשבה: עצירה + מפתח-פר-חייל + הצהרת-כוונה + ייעוץ לפני כל האצלה */
export async function executeParityPlan(plan: ParityPlan): Promise<{ ok: boolean; he: string; executed: Array<{ soldier: string; vests: string }>; failures: string[] }> {
  if (plan.chain !== "steem") return { ok: false, he: plan.note, executed: [], failures: ["hive-skipped"] };
  if (isHalted()) {
    return { ok: false, he: `האצלה נדחתה — עצירת-חירום פעילה (שער-המחשבה): ${isHalted() ? "halt" : ""}`, executed: [], failures: ["sovereign-halt"] };
  }
  const { actorCanSign } = await import("./deliberation");
  const steem = (await import("steem")) as unknown as { default?: SteemLib } & SteemLib;
  const lib = steem.default ?? steem;
  const executed: Array<{ soldier: string; vests: string }> = [];
  const failures: string[] = [];
  let leaseRef = "no-lease"; // v129.2 — פרובננס-ההשכרה של ההאצלות
  try {
    await withRoleWif("active", async (wif: string, auth: SigningAuthority) => {
      if (!isWifShape(wif)) throw new Error("self-verify FAILED: המפתח אינו WIF תקין");
      const derived = wifToPub(wif);
      if (auth.rolePub && auth.rolePub !== derived) throw new Error("self-verify FAILED: המפתח אינו גוזר לציבורי-הכספת");
      const liveAcc = await rpc<Array<{ active: { key_auths: Array<[string, number]> } }>>(STEEM_RPC, "condenser_api.get_accounts", [["headcorner"]]);
      const livePub = liveAcc?.[0]?.active?.key_auths?.[0]?.[0] ?? null;
      if (!livePub || livePub !== derived) throw new Error("self-verify FAILED: המפתח אינו סמכות-active החיה של headcorner");
      // שער-חותם-יחיד (v129.2): lease→sign→release — השכרה סביב מקטע-ההאצלות כולו
      await withSignerLease("headcorner", "power-parity-steem", async (lease) => {
      leaseRef = lease.ref;
      lib.api.setOptions({ url: STEEM_RPC });
      for (const row of plan.rows) {
        if (row.toDelegateVESTS <= 0) continue;
        if (Math.abs(row.deltaHP) < DELEGATION_MIN_HP_STEP) continue; // אין-טעם-בשידור-זעיר
        // v129 — שער-מפתח-פר-חייל: אין-האצלה-לחייל-בלי-מפתח-מוכח
        const k = await actorCanSign(row.soldier, "steem", "active");
        if (!k.ok) {
          failures.push(`${row.soldier}: נדחה בשער-המפתח — ${k.he.slice(0, 80)}`);
          continue;
        }
        // v129 — שער-המחשבה: הצהרת-כוונה + ייעוץ (האצלה = פעולת-כסף)
        const verdict = await deliberate(
          { kind: "delegate", action: "power-parity", subject: `האצלת-כוח ל-${row.soldier} לשוויון-HP`, actor: row.soldier, chain: "steem", params: { vests: row.toDelegateVESTS, targetHP: row.targetHP } },
          {
            why: `חייל מתחת-יעד-השוויון ב-${row.deltaHP.toFixed(0)} HP — דלתא-האצלה אחת-ביום לפי-התוכנית`,
            worstCase: `האצלת-כוח-מת אם החייל לא-פעיל; HP מוחזר-רק-אחרי-7 ימים`,
            expectedGain: `כוח-הצבעה-ופעילות מלא לכל-חייל — הכנסת-קיורציה אפשרית`,
            maxLoss: `HP-מושהה-7 ימים (${row.toDelegateVESTS.toFixed(0)} VESTS)`,
            reversible: true,
            alternative: `האצלה-גדולה-פעם-בשבוע — נדחתה כי דריפה-יומית-קטנה מדי`,
          }
        );
        if (!verdict.allowed) {
          failures.push(`${row.soldier}: שער-המחשבה (${verdict.gate}) — ${verdict.reasons.join(" · ").slice(0, 80)}`);
          continue;
        }
        const vestsStr = `${row.toDelegateVESTS.toFixed(6)} VESTS`;
        try {
          const conf = await lib.broadcast.sendAsync({
            operations: [["delegate_vesting_shares", { delegator: "headcorner", delegatee: row.soldier, vesting_shares: vestsStr }]],
            extensions: [],
          }, [wif]);
          const txid = conf?.id ?? null;
          if (!txid) throw new Error("אין-txid");
          executed.push({ soldier: row.soldier, vests: vestsStr });
        } catch (e) {
          failures.push(`${row.soldier}: ${String(e instanceof Error ? e.message : e).slice(0, 100)}`);
        }
      }
      }); // שחרור-השכרת-החתימה (lease→release)
    });
    return {
      ok: executed.length > 0 || failures.length === 0,
      he: executed.length
        ? `הואצל בהצלחה ל-${executed.length} חיילים (${failures.length} כשלים כנים) · lease=${leaseRef}`
        : `לא בוצעו האצלות (${failures.length ? "כשלים: " + failures.join(" · ").slice(0, 160) : "הכל-ביעד-כבר"}) · lease=${leaseRef}`,
      executed, failures,
    };
  } catch (e) {
    return { ok: false, he: `השער-נדחה (fail-closed): ${String(e instanceof Error ? e.message : e).slice(0, 160)}`, executed, failures };
  }
}

interface SteemLib {
  api: { setOptions(opts: { url?: string }): void };
  broadcast: { sendAsync(tx: Record<string, unknown>, wifs: string[]): Promise<{ id?: string }> };
}
