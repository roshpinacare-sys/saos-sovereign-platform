/**
 * lib/saos/auto-expansion.ts — v66 התפשטות-אוטומטית (THE AUTO-EXPANSION).
 * =====================================================================
 * הוראת הבעלים (2026-09-11): "אין בעיה אתה יכול להשתמש בכסף תמשיך לפרוץ
 * דרך דחוף בסוף" — שלוש מילים-מפתח: כסף ביד (הרשאת v65), פריצת-דרך
 * ממשיכה, ודחיפה בסוף.
 *
 * מנוע הפריצה (v52) דירג את המועמד הזה מקום 2 מבין מה שהאורגניזם יכול
 * לעשות לבד — "ניתן להתחיל היום": הרגע שגז נוחת על דלת חשוכה, האורגניזם
 * מתפשט לבד. עד היום ההשקיה היתה "פקודה ואז טיפול" — הבעלים מעביר, ואז
 * מישהו צריך לשים לב, לפרוס, לעגן. מהיום: הבעלים מעביר — השאר קורה לבד.
 *
 * המבנה — שני איברים, משמעת אחת:
 *   (1) הגשש (השומר :3005, מחזור 10-דק') — קורא את מפקד-המסילות מהווב
 *       (/api/saos/auto-expand GET) וכשמסילה עוברת את שער היתרה ×2 — יורה
 *       את ה-POST (source=auto). השומר לא נוגע במפתחות אף-פעם; הוא בעל
 *       הקצב, הווב בעל המנוע — אותה חלוקה מוכחת ממארב-הירושה v41.
 *   (2) המנוע (המודול הזה) — צינור אחד לכל מסילה EVM: deploy(SAOSRelay)
 *       אם אין חוזה → anchor(root, height) דרך החוזה. אותם שערי-כנות
 *       מהמסלולים החיים: הכנות → מאזן ×2 → דה-דופה → קבלה מהצומת →
 *       קבלה משורשרת → יומן — שום התפשטות שקטה.
 *
 * גבול-האמת (מורשת מ-relay-contract/anchor-evm, מילה במילה):
 *   - הפריסה והעוגן הם הפעולות היחידות הניתנות להשגה כאן — המודול
 *     אינו יכול לחתום העברות. כתובת-היעד היחידה: ה-relay שלנו.
 *   - txid מהצומת בלבד — לעולם לא מומצא; כישלון = נתון (שורה כנה).
 *   - עלות מהקבלה (gasUsed × gasPrice) — נרשמת ב-meta לספר-האוצר.
 *   - read-only במפקד: הגשש קורא בלבד; המפתח נפתח רק בתוך הירי עצמו
 *     (deriveSovereignEvm עם אימות-כפול), ונסגר מיד.
 *
 * Additive module — המודולים הקנוניים לא נגעו.
 */

import { db } from "@/lib/db";
import { appendChainedReceipt } from "@/lib/chained-receipt";
import { logOp } from "./oplog";
import { bridgeCensus, type EvmRailState } from "./bridge-forge";
import { ensureChainMemory } from "./memory-house";
import {
  deploySovereignRelay,
  relayAnchorThroughContract,
  type RelayChain
} from "./relay-contract";
import { SAOS_VERSION } from "./version";

// ─── הגדרות (PlatformSetting — control-plane, לעולם לא סודות) ──────────────

const AUTO_EXPANSION_KEY = "autoExpansion";

export async function getAutoExpansionEnabled(): Promise<boolean> {
  try {
    const row = await db.platformSetting.findUnique({ where: { key: AUTO_EXPANSION_KEY } });
    if (!row) return true; // default ON — זה כל הרעיון: הפעם הראשונה שגז נוחת, האורגניזם שם
    return row.value === "1";
  } catch {
    return true; // fail-open במישור-הבקרה בלבד; הירי עצמו עדיין עובר הכנות+מאזן+דה-דופה
  }
}

export async function setAutoExpansionEnabled(enabled: boolean): Promise<boolean> {
  await db.platformSetting.upsert({
    where: { key: AUTO_EXPANSION_KEY },
    update: { value: enabled ? "1" : "0" },
    create: { key: AUTO_EXPANSION_KEY, value: enabled ? "1" : "0" }
  });
  return enabled;
}

// ─── מפת-הרשתות — 9 מסילות: 8 מ-v51 + SKALE אירופה (v69) ──────────────────

const RAILS: Array<{ chain: RelayChain; network: string; heName: string; symbol: string }> = [
  { chain: "ethereum", network: "ETHEREUM", heName: "את'ריום", symbol: "ETH" },
  { chain: "bsc", network: "BSC", heName: "BNB Smart Chain", symbol: "BNB" },
  { chain: "polygon", network: "POLYGON", heName: "פוליגון", symbol: "POL" },
  { chain: "arbitrum", network: "ARBITRUM", heName: "ארביטרום", symbol: "ETH" },
  { chain: "optimism", network: "OPTIMISM", heName: "אופטימיזם", symbol: "ETH" },
  { chain: "base", network: "BASE", heName: "בייס", symbol: "ETH" },
  { chain: "avalanche", network: "AVALANCHE", heName: "אבאלנש'", symbol: "AVAX" },
  { chain: "gnosis", network: "GNOSIS", heName: "נוסיס", symbol: "xDAI" },
  // v69 מסילה 9 — הדלת הזולה במערכה: גז נומינלי (100000 wei, מדוד),
  // יעד-×2 לכל הדלת ≈ 0.000000112 יחידות-ETH-נומינליות ≈ $0.0003 — כ-400×
  // מתחת לדלת EVM רגילה. המנוע פורס ומעוגן כמו כל מסילה אחרת.
  { chain: "skale", network: "SKALE", heName: "סקייל (אירופה)", symbol: "ETH" }
];

/** שדה-העלות ב-meta לפי רשת — אותו קונבנציה שספר-האוצר קורא (v65) */
const COST_FIELD: Record<string, string> = {
  ETHEREUM: "costEth", BSC: "costBnb", POLYGON: "costPol", ARBITRUM: "costEth",
  OPTIMISM: "costEth", BASE: "costEth", AVALANCHE: "costAvax", GNOSIS: "costXdai",
  SKALE: "costSkale" // v69 — נומינלי; הספר מציג ביחידות מקור עם הערת-כנות
};

// ─── המפקד — מצב ההתפשטות של כל מסילה ───────────────────────────────────────

export type RailExpansionState = "expanded" | "armed" | "dark" | "error";

export interface ExpansionRail {
  chain: string;
  network: string;
  heName: string;
  symbol: string;
  /** relay חי על השרשרת (מפקד v51) */
  relayLive: boolean | null;
  /** relayAddress מהספר/השרשרת */
  relayAddress: string | null;
  /** החותם האחרון מעוגן דרך ה-relay במסילה זו */
  relayAnchoredCurrent: boolean;
  /** יתרה חיה (מטבע מקומי) — null = גשש לא ענה */
  balanceNative: number | null;
  /** שער ×2 עבר (העלות הרלוונטית: פריסה אם אין relay, קריאה אם יש) */
  funded: boolean | null;
  state: RailExpansionState;
  stateHe: string;
  /** השלב הבא שהמנוע יעשה בירי (לתצוגה) */
  nextStepHe: string;
  explorerAddr: string | null;
  error?: string;
}

export interface ExpansionCensus {
  ok: boolean;
  at: string;
  version: string;
  setting: boolean;
  settingHe: string;
  seal: { height: number; root: string; leaves: number } | null;
  rails: ExpansionRail[];
  counts: { expanded: number; armed: number; dark: number; error: number };
  verdictHe: string;
  scoutHe: string;
  /** v68 בית-הזיכרון — מצב השחזור מהשרשרת (מלא רק כשקרה שחזור/בדיקה) */
  memoryHouseHe?: string | null;
  error?: string;
}

function railStateHe(state: RailExpansionState, relayLive: boolean | null): string {
  switch (state) {
    case "expanded": return "פרוץ — relay חי והחותם מעוגן דרכו";
    case "armed": return relayLive ? "דרוך — relay חי, החותם ממתין לעוגן דרך החוזה" : "דרוך — ממומן ×2, ממתין לפריסה+עוגן";
    case "dark": return "חשוך — ממתין לגז (הכתובת פורסמה לרשת)";
    case "error": return "גשש לא ענה — נתון, לא אפס";
  }
}

function nextStepHe(state: RailExpansionState): string {
  switch (state) {
    case "expanded": return "אין — המסילה מלאה";
    case "armed": return "anchor(root, height) דרך SAOSRelay — בירי הבא";
    case "dark": return "המתנה להשקיה — הגשש בודק כל 10 דק'";
    case "error": return "בדיקה חוזרת במחזור הגשש הבא";
  }
}

export async function expansionCensus(opts: { force?: boolean } = {}): Promise<ExpansionCensus> {
  const at = new Date().toISOString();
  const setting = await getAutoExpansionEnabled().catch(() => true);

  // v68 בית-הזיכרון: איפוס-הסנדבוקס מוחק את הספר — האורגניזם "שוכח" את
  // ה-relay שלו ומשתיק. לפני כל מפקד: אם אין חותם בספר (חתימת-האיפוס),
  // הספר נבנה מחדש מהשרשרת החיה (eth_getCode + קבלות מאומתות). אידמפוטנטי —
  // ספר בריא לא נוגע. כישלון = נתון כנה; המפקד ממשיך ומדווח מה שרואה.
  let memoryHouseHe: string | null = null;
  try {
    const mem = await ensureChainMemory();
    if (mem.recovered) {
      memoryHouseHe = `בית-הזיכרון שחזר את הספר מהשרשרת — ${mem.anchorRows} עוגני-relay · ${mem.dripRows} טפטופי-השקיה · חותם h=1 נזרע (החותם הבא יהיה h=2)`;
    } else if (mem.ok && mem.noteHe) {
      memoryHouseHe = mem.noteHe;
    }
  } catch {
    /* נתון כנה — המפקד עצמו ממשיך */
  }

  try {
    const [bridge, seal] = await Promise.all([
      bridgeCensus({ force: opts.force }),
      db.sealRecord.findFirst({
        orderBy: { height: "desc" },
        select: { id: true, height: true, root: true, leavesCount: true }
      })
    ]);

    // עוגני-relay קיימים לחותם האחרון — דה-דופה במפקד עצמו (לתצוגה)
    const relayAnchors = seal
      ? await db.anchorTx.findMany({
          where: { kind: "relay", sealId: seal.id, txid: { not: null } },
          select: { network: true }
        })
      : [];
    const anchoredNets = new Set(relayAnchors.map((r) => r.network));

    const evmByChain = new Map<string, EvmRailState>(
      (bridge.evm ?? []).map((e) => [e.chain as string, e])
    );

    const rails: ExpansionRail[] = RAILS.map((r) => {
      const st = evmByChain.get(r.chain);
      const relayLive = st?.relayLive ?? null;
      const relayAddress = st?.relayAddress ?? null;
      const funded = st?.funded ?? null;
      const balanceNative = st?.balanceNative ?? null;
      const relayAnchoredCurrent = anchoredNets.has(r.network);
      let state: RailExpansionState;
      if (st?.error && st.chainIdOk === null) {
        state = "error";
      } else if (relayLive === true && relayAnchoredCurrent) {
        state = "expanded";
      } else if (funded === true) {
        state = "armed";
      } else {
        state = "dark";
      }
      return {
        chain: r.chain,
        network: r.network,
        heName: r.heName,
        symbol: r.symbol,
        relayLive,
        relayAddress,
        relayAnchoredCurrent,
        balanceNative,
        funded,
        state,
        stateHe: railStateHe(state, relayLive),
        nextStepHe: nextStepHe(state),
        explorerAddr: st?.explorerAddr ?? null,
        ...(st?.error && state === "error" ? { error: st.error } : {})
      };
    });

    const counts = {
      expanded: rails.filter((x) => x.state === "expanded").length,
      armed: rails.filter((x) => x.state === "armed").length,
      dark: rails.filter((x) => x.state === "dark").length,
      error: rails.filter((x) => x.state === "error").length
    };

    const verdictHe =
      counts.armed > 0
        ? `${counts.armed} מסילה/ות דרוכות — הירי הבא (ידני או גשש-השומר) יפרוץ אותן: deploy → anchor(root, height) דרך SAOSRelay.`
        : counts.expanded > 0 && counts.dark > 0
          ? `${counts.expanded} מסילות פרוצות · ${counts.dark} חשוכות ממתינות לגז — ההשקיה היא העברת-הבעלים, ההתפשטות אוטומטית.`
          : counts.expanded === RAILS.length
            ? `כל ${RAILS.length} המסילות פרוצות — המרש חותם דרך relay חי בכל רשת.`
            : "המסילות ממתינות להשקיה — כתובת-המימון פורסמה לרשת בשידור v65.";

    return {
      ok: true,
      at,
      version: SAOS_VERSION,
      setting,
      settingHe: setting
        ? "מופעל — הגשש יורה לבד ברגע שהשער עובר"
        : "כבוי — הירי האוטומטי ממתין להפעלה (ירי ידני תמיד אפשרי)",
      seal: seal ? { height: seal.height, root: seal.root, leaves: seal.leavesCount } : null,
      rails,
      counts,
      verdictHe,
      memoryHouseHe,
      scoutHe: "השומר (:3005) קורא את המפקד כל 10 דק' — מסילה שעוברת את שער היתרה ×2 נורית אוטומטית (source=auto) תחת אותם שערי-כנות"
    };
  } catch (e) {
    return {
      ok: false,
      at,
      version: SAOS_VERSION,
      setting,
      settingHe: setting ? "מופעל" : "כבוי",
      seal: null,
      rails: [],
      counts: { expanded: 0, armed: 0, dark: 0, error: 0 },
      verdictHe: "מפקד-ההתפשטות נכשל — נתון, לא אפס",
      scoutHe: "השומר (:3005) קורא את המפקד כל 10 דק'",
      error: e instanceof Error ? e.message.slice(0, 200) : "census failed"
    };
  }
}

// ─── הירי — הצינור החי: deploy → anchor ────────────────────────────────────

export interface ExpansionFireResult {
  chain: string;
  network: string;
  ok: boolean;
  skipped?: "dedupe" | "setting-off" | "no-seal";
  already?: boolean;
  deployed?: boolean; // פריסה בוצעה בירי זה
  deployTxid?: string | null;
  relayAddress?: string | null;
  anchorTxid?: string | null;
  anchorBlock?: number | null;
  confirmed?: boolean;
  eventJson?: string | null;
  costNative?: string | null;
  explorer?: string | null;
  receipt?: string;
  error?: string;
}

export interface ExpansionFireOut {
  ok: boolean;
  at: string;
  source: "auto" | "manual";
  fired: number;
  results: ExpansionFireResult[];
  receipt?: string;
  error?: string;
}

/**
 * THE FIRE — for every armed rail (or the requested subset): deploy the relay
 * if missing, then anchor the LATEST seal root through it. One discipline for
 * manual and auto: dedupe → readiness gates (inside deploy/relayCall) →
 * receipt → oplog. Never throws — failures return as data, recorded.
 */
export async function autoExpand(opts: {
  source?: "auto" | "manual";
  chains?: string[];
} = {}): Promise<ExpansionFireOut> {
  const source = opts.source === "auto" ? "auto" : "manual";
  const at = new Date().toISOString();

  // הגדרה: הירי האוטומטי מכבד את ההגדרה; הידני הוא פקודת-מפעיל מפורשת
  // (מסלולי העיגון החיים תמיד באותם שערי-כנות — הכנות ומאזן ×2 בתוך
  // deploySovereignRelay/relayAnchorThroughContract עצמן).
  if (source === "auto") {
    const enabled = await getAutoExpansionEnabled().catch(() => true);
    if (!enabled) {
      return {
        ok: false,
        at,
        source,
        fired: 0,
        results: [],
        error: "התפשטות-אוטומטית כבויה — הגשש ממתין להפעלה (ירי ידני תמיד אפשרי)"
      };
    }
  }

  const seal = await db.sealRecord.findFirst({
    orderBy: { height: "desc" },
    select: { id: true, height: true, root: true, leavesCount: true, gasUsed: true, stateRoot: true }
  });
  if (!seal) {
    return { ok: false, at, source, fired: 0, results: [], error: "אין חותם — צור חותם קודם" };
  }

  // המפקד קובע מי דרוך — לא רשימה ידנית (גם בירי ידני: רק מסילות שעברו
  // את השער. מפעיל לא יכול "להכריח" מסילה חשוכה — השער הוא האמת).
  const census = await expansionCensus({ force: true });
  const wanted = opts.chains && opts.chains.length > 0 ? new Set(opts.chains) : null;
  const targets = census.rails.filter(
    (r) => r.state === "armed" && (!wanted || wanted.has(r.chain))
  );

  const results: ExpansionFireResult[] = [];
  for (const rail of RAILS.filter((r) => targets.some((t) => t.chain === r.chain))) {
    results.push(await fireOne(rail, seal, source));
  }

  const fired = results.filter((r) => r.ok && !r.skipped).length;
  const out: ExpansionFireOut = { ok: results.length > 0, at, source, fired, results };
  if (results.length === 0 && wanted) {
    out.ok = false;
    out.error = "אף מסילה מבוקשת אינה דרוכה (עברה את שער ×2) — השער הוא האמת";
  }
  if (results.length > 0) {
    const receipt = await appendChainedReceipt("auto-expansion-fire", {
      source,
      sealHeight: seal.height,
      sealRoot: seal.root,
      fired,
      chains: results.map((r) => ({ chain: r.chain, ok: r.ok, txid: r.anchorTxid ?? r.deployTxid ?? null }))
    }, { sealId: seal.id });
    out.receipt = receipt.digest;
    await logOp(
      "auto-expansion",
      `source=${source} fired=${fired}/${results.length} seal=h${seal.height} chains=${results.map((r) => `${r.chain}:${r.ok ? "ok" : "fail"}`).join(",")}`
    );
  }
  return out;
}

/** ירי מסילה אחת — deploy אם חסר, ואז anchor החותם האחרון דרך החוזה. */
async function fireOne(
  rail: { chain: RelayChain; network: string; heName: string; symbol: string },
  seal: { id: string; height: number; root: string; leavesCount: number },
  source: "auto" | "manual"
): Promise<ExpansionFireResult> {
  // ─── דה-דופה: עוגן-relay אחד לחותם בכל מסילה — לתמיד ───
  const existing = await db.anchorTx.findFirst({
    where: { kind: "relay", network: rail.network, sealId: seal.id, txid: { not: null } },
    orderBy: { createdAt: "desc" }
  });
  if (existing) {
    const m = safeParseMeta(existing.meta);
    return {
      chain: rail.chain, network: rail.network, ok: true, skipped: "dedupe", already: true,
      anchorTxid: existing.txid,
      relayAddress: typeof m?.contract === "string" ? (m.contract as string) : null,
      explorer: typeof m?.explorer === "string" ? (m.explorer as string) : null
    };
  }

  let relayAddress: string | null = null;
  let deployed = false;
  let deployTxid: string | null = null;

  // ─── שלב א' — ה-relay (אם אין חוזה פרוס ברשת זו) ───
  const contractRow = await db.sovereignContract.findFirst({
    where: { chain: rail.chain, status: "deployed" },
    orderBy: { createdAt: "desc" }
  });
  if (contractRow?.address && contractRow.address !== "0x0000000000000000000000000000000000000000") {
    relayAddress = contractRow.address;
  } else {
    try {
      const out = await deploySovereignRelay(rail.chain);
      deployTxid = out.txid;
      deployed = true;
      relayAddress = out.address;
      // הספר — שורת-חוזה כנה לכל תוצאה (גם כישלון-אישוש נרשם)
      await db.sovereignContract.create({
        data: {
          chain: rail.chain,
          kind: "saos-relay/v1",
          address: out.address ?? "0x0000000000000000000000000000000000000000",
          deployer: out.deployer,
          txid: out.txid,
          blockNumber: out.block,
          gasUsed: out.gasUsed,
          costNative: out.costNative,
          bytecodeHash: out.bytecodeHash,
          runtimeBytes: out.runtimeBytes,
          status: out.confirmed ? "deployed" : "failed",
          meta: JSON.stringify({
            engine: "auto-expansion",
            source,
            explorer: out.explorer,
            error: out.error ?? null,
            at: out.at
          })
        }
      });
      await appendChainedReceipt("auto-expansion-deploy", {
        chain: rail.chain, network: rail.network, source,
        address: out.address, txid: out.txid, block: out.block,
        gasUsed: out.gasUsed, costNative: out.costNative,
        bytecodeHash: out.bytecodeHash, confirmed: out.confirmed
      }, { sealId: seal.id });
      await logOp(
        "auto-expansion-deploy",
        `chain=${rail.chain} source=${source} address=${out.address} txid=${out.txid ?? "—"} confirmed=${out.confirmed}`
      );
      if (!out.confirmed || !out.address) {
        return {
          chain: rail.chain, network: rail.network, ok: false, deployed: true,
          deployTxid: out.txid, relayAddress: out.address,
          error: out.error ?? "הפריסה נכרתה אך לא אוששה — העוגן לא ירה (כנות)"
        };
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "deploy failed";
      await db.sovereignContract.create({
        data: {
          chain: rail.chain, kind: "saos-relay/v1",
          address: "0x0000000000000000000000000000000000000000",
          status: "failed",
          meta: JSON.stringify({ engine: "auto-expansion", source, error: errMsg.slice(0, 300), at: new Date().toISOString() })
        }
      }).catch(() => undefined);
      await appendChainedReceipt(
        "auto-expansion-deploy-failed",
        { chain: rail.chain, network: rail.network, source, error: errMsg.slice(0, 300) },
        { sealId: seal.id }
      );
      await logOp("auto-expansion-deploy-failed", `chain=${rail.chain} error=${errMsg.slice(0, 200)}`);
      return { chain: rail.chain, network: rail.network, ok: false, error: errMsg };
    }
  }

  // ─── שלב ב' — anchor(root, height) דרך החוזה ───
  try {
    const out = await relayAnchorThroughContract(rail.chain, relayAddress as string, {
      height: seal.height,
      root: seal.root
    });
    const costField = COST_FIELD[rail.network] ?? "costNative";
    const meta: Record<string, unknown> = {
      engine: "auto-expansion",
      source,
      contract: relayAddress,
      action: "anchor",
      height: seal.height,
      root: seal.root,
      block: out.block,
      confirmed: out.confirmed,
      eventJson: out.eventJson,
      costNative: out.costNative,
      [costField]: out.costNative, // ספר-האוצר קורא את השדה-הסמלי
      gasUsed: out.gasUsed,
      explorer: out.explorer,
      at: out.at
    };
    const row = await db.anchorTx.create({
      data: {
        sealId: seal.id,
        network: rail.network,
        kind: "relay",
        txid: out.txid,
        status: out.confirmed ? "anchored" : "broadcast",
        meta: JSON.stringify(meta)
      }
    });
    const receipt = await appendChainedReceipt(
      "auto-expansion-anchor",
      {
        chain: rail.chain, network: rail.network, source,
        height: seal.height, root: seal.root,
        contract: relayAddress, txid: out.txid, block: out.block,
        confirmed: out.confirmed, costNative: out.costNative,
        eventJson: out.eventJson, anchorRowId: row.id
      },
      { sealId: seal.id }
    );
    await logOp(
      "auto-expansion-anchor",
      `chain=${rail.chain} network=${rail.network} source=${source} height=${seal.height} txid=${out.txid ?? "—"} confirmed=${out.confirmed}`
    );
    return {
      chain: rail.chain, network: rail.network, ok: true, deployed, deployTxid,
      relayAddress, anchorTxid: out.txid, anchorBlock: out.block,
      confirmed: out.confirmed, eventJson: out.eventJson,
      costNative: out.costNative, explorer: out.explorer,
      receipt: receipt.digest
    };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "relay anchor failed";
    const row = await db.anchorTx.create({
      data: {
        sealId: seal.id,
        network: rail.network,
        kind: "relay",
        txid: null,
        status: "failed",
        gate: "expansion-error",
        meta: JSON.stringify({
          engine: "auto-expansion", source, contract: relayAddress,
          height: seal.height, error: errMsg.slice(0, 300),
          at: new Date().toISOString()
        })
      }
    }).catch(() => undefined);
    const receipt = await appendChainedReceipt(
      "auto-expansion-anchor-failed",
      { chain: rail.chain, network: rail.network, source, height: seal.height, error: errMsg.slice(0, 300), anchorRowId: row?.id },
      { sealId: seal.id }
    );
    await logOp("auto-expansion-anchor-failed", `chain=${rail.chain} height=${seal.height} error=${errMsg.slice(0, 200)}`);
    return {
      chain: rail.chain, network: rail.network, ok: false, deployed, deployTxid,
      relayAddress, error: errMsg, ...(receipt ? { receipt: receipt.digest } : {})
    };
  }
}

function safeParseMeta(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
