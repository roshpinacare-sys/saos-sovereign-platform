/**
 * Broadcast envelopes — מעטפות שידור (הכנה לשלב 2).
 * בונה את הפעולה הקנונית המדויקת שתיחתם לכל רשת עבור חותם — dry-run בלבד:
 *   - broadcastable: false תמיד — אין מפתחות חתימה בפלטפורמה (productionAuthority: NONE)
 *   - blockers מפורטים וכנים (signing-key, rc-floor, energy)
 *   - הפעולות מבוססות על ספריית החתימה ההיסטורית agent/anchor.cjs (Graphene מרובה-רשתות)
 * פורט מתוך: steem-main weave_batch + anchor.cjs, tronbridge transit notes.
 */

import { canonicalDigest, canonicalize } from "./canonical-json";
import { BLURT_FEE_FORMULA } from "./anchor-gates";

// ─── מניפסט הכספת — מבנה החריצים המוגדר מציאות הרשתות ────────────────────

export interface VaultManifestEntry {
  network: "STEEM" | "BLURT" | "HIVE" | "TRON";
  slot: string;
  purpose: string;
}

/**
 * מבנה החריצים: 6 כתובות כספת TRON (כפי שתועד בארכיון — energy-0 בכולן),
 * וחריץ חתימה אחד לכל רשת Graphene. החריצים קיימים; הכתובות נרשמות על-ידי המפעיל.
 */
export const VAULT_MANIFEST: VaultManifestEntry[] = [
  { network: "STEEM", slot: "foundry/active", purpose: "custom_json saos.weave.v1 — זהות השידור הפעילה" },
  { network: "BLURT", slot: "foundry/manual-sign", purpose: "חתימה קנונית ידנית (low-s loop)" },
  { network: "HIVE", slot: "foundry/active", purpose: "weave + account_update (rc-gated)" },
  { network: "TRON", slot: "vault-1", purpose: "כתובת כספת 1 — יעד האצלת אנרגיה" },
  { network: "TRON", slot: "vault-2", purpose: "כתובת כספת 2 — גיבוי ופיזור" },
  { network: "TRON", slot: "vault-3", purpose: "כתובת כספת 3 — גיבוי ופיזור" },
  { network: "TRON", slot: "vault-4", purpose: "כתובת כספת 4 — גיבוי ופיזור" },
  { network: "TRON", slot: "vault-5", purpose: "כתובת כספת 5 — גיבוי ופיזור" },
  { network: "TRON", slot: "vault-6", purpose: "כתובת כספת 6 — גיבוי ופיזור" },
  // v94 — כיסאות-צפייה ריבוניים: שורות-בקרה לזהויות הרישום האטום
  // (לא מסילות-שידור — החתימה חיה ב-anchor-evm/anchor-svm בלבד)
  { network: "ETHEREUM", slot: "sovereign/headcorner", purpose: "כיסא-צפייה ריבוני EVM (wallets-registry headcorner)" },
  { network: "SOLANA", slot: "sovereign/headcorner", purpose: "כיסא-צפייה ריבוני SOL (wallets-registry headcorner)" }
];

/** v94 — רשתות-כיסאות-צפייה בלבד (לא מסילות-שידור גרפניות) */
export const VAULT_SOVEREIGN_NETWORKS = ["ETHEREUM", "SOLANA"] as const;

export const NETWORKS = ["STEEM", "BLURT", "HIVE", "TRON"] as const;
export type SaosNetwork = (typeof NETWORKS)[number];

export function isKnownNetwork(n: unknown): n is SaosNetwork {
  return typeof n === "string" && (NETWORKS as readonly string[]).includes(n);
}

export function manifestSlotFor(network: string, slot: unknown): string | null {
  if (typeof slot !== "string") return null;
  return VAULT_MANIFEST.some((m) => m.network === network && m.slot === slot) ? slot : null;
}

/** ולידציית כתובת ציבורית לפי רשת (Graphene account / TRON base58check) */
export function isValidPublicAddress(network: string, address: string): boolean {
  if (network === "TRON") return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
  return /^[a-z][a-z0-9.-]{2,15}$/.test(address);
}

export async function vaultFingerprint(network: string, slot: string, address: string): Promise<string> {
  return canonicalDigest({ network, slot, address });
}

// ─── בונה המעטפות ──────────────────────────────────────────────────────────

export interface BroadcastSeal {
  height: number;
  root: string;
  stateRoot: string;
  leaves: number;
  gasUsed: number;
}

export interface EnvelopeContext {
  rcPct: number;
  tronEnergy: number;
  /** כתובות רשומות לפי רשת (המשתמשת שתשדר) */
  addresses: Partial<Record<SaosNetwork, string>>;
}

export interface Envelope {
  network: SaosNetwork;
  mode: string;
  broadcastable: false; // טיפוס מילולי — תמיד false, כנות מובנית
  blockers: string[];
  payload: string; // canonical JSON — בדיוק מה שייחתם
  fee: string | null;
  signing: string;
  digest: string;
}

const KEY_BLOCKER = "signing-key: מפתח חתימה בכספת הלא-מקוונת (שלב 2)";
const HIVE_RC_FLOOR_LIGHT = 8;

/** weave payload — הלב המשותף לרשתות Graphene (custom_json) */
function weaveJson(seal: BroadcastSeal): string {
  return canonicalize({
    v: 1,
    h: seal.height,
    root: seal.root,
    stateRoot: seal.stateRoot,
    leaves: seal.leaves,
    alg: "sha256/merkle-odd-duplicate"
  });
}

export async function buildEnvelopes(
  seal: BroadcastSeal,
  ctx: EnvelopeContext
): Promise<Envelope[]> {
  const at = new Date().toISOString();
  const json = weaveJson(seal);
  const envelopes: Envelope[] = [];

  // ─── STEEM — custom_json פעיל, חינם-RC ──────────────────────────────────
  const steemPayload = canonicalize({
    network: "STEEM",
    op: "custom_json",
    id: "saos.weave.v1",
    json,
    required_posting_auths: [ctx.addresses.STEEM ?? "vault:pending"],
    required_auths: []
  });
  envelopes.push({
    network: "STEEM",
    mode: "custom_json",
    broadcastable: false,
    blockers: [KEY_BLOCKER],
    payload: steemPayload,
    fee: "0.000 STEEM — custom_json במסלול posting (חינם)",
    signing: "agent/anchor.cjs — Graphene חתימת-פעימה (המסלול שהוכח בייצור)",
    digest: await canonicalDigest({ network: "STEEM", height: seal.height, payload: steemPayload, at })
  });

  // ─── BLURT — חתימה קנונית ידנית עם עמלה מדודה ───────────────────────────
  const blurtPayload = canonicalize({
    network: "BLURT",
    op: "custom_json",
    id: "saos.weave.v1",
    json,
    required_posting_auths: [ctx.addresses.BLURT ?? "vault:pending"]
  });
  const kb = Math.max(1, Math.ceil(new TextEncoder().encode(blurtPayload).length / 1024));
  envelopes.push({
    network: "BLURT",
    mode: "manual-sign",
    broadcastable: false,
    blockers: [KEY_BLOCKER, `עמלה: ${BLURT_FEE_FORMULA} · cooldown 30 דק׳ מדוד`],
    payload: blurtPayload,
    fee: `≈ ${(0.05 + 0.2 * kb).toFixed(3)} BLURT (${kb}KB · ${BLURT_FEE_FORMULA})`,
    signing: "חתימה קנונית ידנית — low-s loop (המסלול שהוכח בייצור)",
    digest: await canonicalDigest({ network: "BLURT", height: seal.height, payload: blurtPayload, at })
  });

  // ─── HIVE — אותה משפחת Graphene, rc-gated בכנות ─────────────────────────
  const hivePayload = canonicalize({
    network: "HIVE",
    op: "custom_json",
    id: "saos.weave.v1",
    json,
    required_posting_auths: [ctx.addresses.HIVE ?? "vault:pending"]
  });
  const hiveBlockers = [KEY_BLOCKER];
  if (ctx.rcPct < HIVE_RC_FLOOR_LIGHT) {
    hiveBlockers.unshift(`rc-floor: ${ctx.rcPct}%<${HIVE_RC_FLOOR_LIGHT}% — התאוששות ~20%/יום או power-up`);
  }
  envelopes.push({
    network: "HIVE",
    mode: ctx.rcPct < HIVE_RC_FLOOR_LIGHT ? "custom_json/rc-gated" : "custom_json",
    broadcastable: false,
    blockers: hiveBlockers,
    payload: hivePayload,
    fee: "0.000 HIVE — custom_json (כש-RC מעל הרצפה)",
    signing: "dhive raw sign — chain_id קבוע בספריית החתימה ההיסטורית",
    digest: await canonicalDigest({ network: "HIVE", height: seal.height, payload: hivePayload, at })
  });

  // ─── TRON — ישיר כשיש אנרגיה, אחרת רכבת tronbridge ─────────────────────
  if (ctx.tronEnergy > 0) {
    const tronPayload = canonicalize({
      network: "TRON",
      op: "TriggerSmartContract",
      owner_address: ctx.addresses.TRON ?? "vault:pending",
      call_data: `stateRoot=${seal.stateRoot}`,
      fee_limit_sun: 1_000_000
    });
    envelopes.push({
      network: "TRON",
      mode: "smart-contract",
      broadcastable: false,
      blockers: [KEY_BLOCKER, "energize: הימור TRX נדרש לכיסוי אנרגיית הקריאה"],
      payload: tronPayload,
      fee: "אנרגיה מומרת — לא burn (לאחר freezeBalanceV2)",
      signing: "tronsign — חתימת מפתח כספת TRON",
      digest: await canonicalDigest({ network: "TRON", height: seal.height, payload: tronPayload, at })
    });
  } else {
    const tronPayload = canonicalize({
      network: "TRON",
      op: "bridge-transit",
      carrier: "tronbridge-daily",
      carries: seal.stateRoot,
      encoding: "6 תווי hash בשבר ה-TRX (כפי שהוכח ברכבת היומית)"
    });
    envelopes.push({
      network: "TRON",
      mode: "bridge-transit",
      broadcastable: false,
      blockers: [KEY_BLOCKER, "energy-0 בכל 6 כתובות הכספת — energize פותח מסלול ישיר"],
      payload: tronPayload,
      fee: "0 — המעבר נישא ברכבת היומית (עד energize)",
      signing: "רכבת tronbridge — נשלח מחשבון הגשר, לא מהכספת",
      digest: await canonicalDigest({ network: "TRON", height: seal.height, payload: tronPayload, at })
    });
  }

  return envelopes;
}
