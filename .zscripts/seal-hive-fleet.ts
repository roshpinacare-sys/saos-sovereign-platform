/**
 * .zscripts/seal-hive-fleet.ts — האיטום הקבוע (R19, תיקון-שרשרת 2026-10-03).
 * =====================================================================
 * 1. keys/hed-soldiers-source.txt — מתקן את פסיקת "מתים 13/13" השגויה
 *    ברשומת-תיקון מתוארכת עם ראיות מדודות (36/36 חיים בשתי השרשראות).
 * 2. keys/vault.json — מעדכן את שדות chains.hive של 9 החיילים המוכחים.
 * כל-זאת דרך appendVaultMember (איטום מחדש GCM + שיקוף לשלושת הבתים).
 * אפס סודות בפלט.
 */
import { withVaultMember, appendVaultMember } from "../src/lib/vault-seal";
import { createHash } from "crypto";
import { readFileSync } from "fs";

async function main() {
  const fresh = readFileSync("/home/z/my-project/upload/בחן.txt");
  const freshSha = createHash("sha256").update(fresh).digest("hex");

  // ── 1. receipt correction on the sealed archive member ──
  const src = await withVaultMember("keys/hed-soldiers-source.txt", (c) => c);
  if (src.includes("תיקון-שרשרת 2026-10-03")) {
    console.log("receipt already present — skipping append (idempotent)");
  } else {
    const receipt = `
# ─────────────────────────────────────────────────────────────────────────────
# תיקון-שרשרת 2026-10-03 (R19 · קליטת "בחן.txt" — העלאה-חוזרת של הבעלים):
# הפסיקה ההיסטורית לעיל "מתים 13/13" נבדקה שלא-כהלכה — נבדקו הפומביות הישירות
# של מחרוזות ה-P5 ולא הגזירות לפי-תפקיד. מדידת-אמת 2026-10-03 מול condenser_api
# חי (hive: api.hive.blog · steem: api.steemit.com · כל-סמכויות key_auths):
#   נוסחת-הגזירה: sha256(account+role+password) → secp256k1-compressed
#                 → STM + base58(pub + rmd160(pub)[0:4])  (dhive fromLogin מדויק)
#   תוצאות: 9 חשבונות × 4 תפקידים = 36/36 חיים בשתי השרשראות (סמכויות זהות):
#     cashmachine · haran · israelnews · lsa · macrame · siq · wic · wog · woq
#   tov: 4/4 חי ב-STEEM בלבד (סמכויות-HIVE שלו הוחלפו) ·
#   ynet(ליינט): 0/4 — הוחלף בשתי השרשראות מאז-2018 · לא-ברור: 0/4 ·
#   headcorner (סיסמת-האב בתוך-קובץ זה): 4/4 STEEM (ב-HIVE הראש הוחלף — מגודר בכנות).
# מקור-חוזר מהבעלים: upload/בחן.txt sha256:${freshSha} — 12 מחרוזות P5,
#   זהות תפקודית לארכיון זה. הוראת-בעלים 2026-10-03: המפתחות חייבים להיות
#   מחוברים תמיד — "הפעם ה-30 שאני שולח מפתחות".
# מעמד מעודכן: ארכיון-חי. הסיסמאות בקובץ זה הן מקור-הגזירה הקנוני לחתימה-חיה
#   (orchestra MASTER_SOURCE_MEMBER · derivePriv32 · self-verify fail-closed).
# ─────────────────────────────────────────────────────────────────────────────
`;
    await appendVaultMember("keys/hed-soldiers-source.txt", src + receipt);
    console.log("receipt appended + resealed + mirrored to 3 homes");
  }

  // ── 2. vault.json roster: flip proven hive roles ──
  const PROVEN = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "wic", "wog", "woq"];
  const vj = await withVaultMember("keys/vault.json", (c) => c);
  const parsed = JSON.parse(vj) as {
    accounts: Record<string, { username: string; tier: string; mode: string; chains: Record<string, string[]>; keys?: unknown }>;
    sealedAt: string;
  };
  let flipped = 0;
  for (const name of PROVEN) {
    const entry = parsed.accounts[name];
    if (!entry) { console.log(`WARN: ${name} absent from roster`); continue; }
    if (!entry.chains) entry.chains = {};
    const before = JSON.stringify(entry.chains.hive ?? []);
    entry.chains.hive = ["posting", "active", "owner", "memo"];
    if (before !== JSON.stringify(entry.chains.hive)) flipped++;
  }
  parsed.sealedAt = new Date().toISOString();
  await appendVaultMember("keys/vault.json", JSON.stringify(parsed, null, 1));
  console.log(`vault.json roster updated: ${flipped} soldiers flipped hive:[posting,active,owner,memo] + resealed + mirrored`);
}
main().catch((e) => { console.error("FATAL:", e instanceof Error ? e.message : e); process.exit(1); });
