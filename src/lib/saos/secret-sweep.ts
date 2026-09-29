/**
 * lib/saos/secret-sweep.ts — v58 סוופ-סודות ריבוני (SOVEREIGN SECRET SWEEP).
 * =====================================================================
 * אומץ מהסוכן השני (steem · secret_sweep_r18e.cjs — 687 קבצים, 0 חורים
 * אמיתיים) והותאם לריפו שלנו: סורק-סודות שנכתב בבית, בלי שירות-צד-שלישי,
 * שעונה על השאלה "האם חומר-סוד הודלף לגיטהאב?" — שטח-הסריקה הוא בדיוק
 * מה שנדחף: `git ls-files` (ה-.env · upload/ · הכספות המוצפנות — כולם
 * מחוץ לריפו מעיקרם).
 *
 * גבול-האמת של המודול — קשיח:
 *   · אפס חומר-סוד בפלט: COUNTS בלבד. לא שמות-קבצים, לא שורות, לא קטעים.
 *   · הסורק עצמו לא קורא את .env (הוא מחוץ לשטח הגלוי) — זו הנקודה.
 *   · תבניות-פומביות (כתובות ציבוריות) נספרות בנפרד ומסומנות public —
 *     בדיוק כמו R18e: "5 התראות=פומביות-בלבד".
 *   · כישלון git = נתון כנה (fallback: הליכה עצמית שמדלגת על .git ·
 *     node_modules · .next · db · upload · agent — מה שמקורו פרטי).
 *
 * התבניות: WIF של STEEM/HIVE (STM…) · WIF משפחת-ביטקוין (K/L/5…) ·
 * hex64 (0x וחשוף) · הקצאות-סוד (PRIVATE_KEY=…) · מנמוניק-מועמד
 * (מסך-היוריסטי: ≥12 מילים, ≥8 מאוצר-מילות BIP39) · ומולם — כתובות
 * פומביות (0x40hex · T…base58 · r/XRP) כ-public.
 */

import { execFile } from "child_process";
import { createHash } from "crypto";
import { readFile, readdir, stat } from "fs/promises";
import path from "path";
import { promisify } from "util";

const execFileP = promisify(execFile);

const REPO = process.cwd();

// ─── types ──────────────────────────────────────────────────────────────────

export type SweepSeverity = "alert" | "public" | "note";

export interface SweepPattern {
  id: string;
  label: string;
  he: string;
  severity: SweepSeverity;
  count: number;
}

export interface SecretSweepResult {
  ok: boolean;
  surface: string;
  scannedFiles: number;
  scannedBytes: number;
  skippedBinary: number;
  patterns: SweepPattern[];
  realAlerts: number;
  verdict: string;
  tookMs: number;
  measuredAt: string;
  error?: string;
}

// ─── scan surface (exactly what is pushed) ─────────────────────────────────

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svgz",
  ".zip", ".tar", ".gz", ".tgz", ".enc", ".7z",
  ".wasm", ".bin", ".o", ".so", ".a",
  ".db", ".sqlite", ".sqlite3",
  ".pdf", ".mp4", ".mp3", ".woff", ".woff2", ".ttf",
  ".lock", ".tsbuildinfo"
]);

const MAX_FILE_BYTES = 1_500_000;
const MAX_FILES = 3_000;

async function gitTrackedFiles(): Promise<string[] | null> {
  try {
    const { stdout } = await execFileP("git", ["ls-files"], {
      cwd: REPO,
      timeout: 6_000,
      maxBuffer: 8 * 1024 * 1024
    });
    const files = stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    return files.length > 0 ? files : null;
  } catch {
    return null; // כישלון git = נתון; נופלים להליכה עצמית
  }
}

const FS_SKIP_DIRS = new Set([
  ".git", "node_modules", ".next", ".turbo", "db", "upload",
  "agent", "tool-results", "dist", ".zscripts-cache"
]);

async function walkVisible(dir: string, out: string[], budget: { left: number }): Promise<void> {
  if (out.length >= budget.left) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= budget.left) return;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!FS_SKIP_DIRS.has(e.name)) await walkVisible(p, out, budget);
    } else if (e.isFile()) {
      out.push(path.relative(REPO, p));
    }
  }
}

// ─── detectors — counts ONLY (zero material ever leaves this module) ───────

const RX_STEEM_WIF = /\bSTM[1-9A-HJ-NP-Za-km-z]{50,51}\b/g;
const RX_WIF_KL = /\b[KL][1-9A-HJ-NP-Za-km-z]{51}\b/g;
const RX_WIF_5 = /\b5[HJK][1-9A-HJ-NP-Za-km-z]{49,50}\b/g;
const RX_HEX64_0X = /\b0x[0-9a-fA-F]{64}\b/g;
const RX_HEX64 = /(?<!0x)\b[0-9a-fA-F]{64}\b/g;
const RX_SECRET_ASSIGN =
  /\b(PRIVATE_KEY|MNEMONIC|SEED_PHRASE|SEED|WIF|API_SECRET|SECRET|PASSWORD|PASSPHRASE|ACCESS_TOKEN|AUTH_TOKEN)\b\s*[:=]\s*["'][^"'\s]{16,}["']/gi;
const RX_WORD_RUN = /\b[a-z]{3,12}(?:\s+[a-z]{3,12}){11,23}\b/g;

/** כתובות פומביות — לא סוד; נספרות בנפרד (public) */
const RX_PUB_EVM = /\b0x[0-9a-fA-F]{40}\b/g;
const RX_PUB_TRON = /\bT[1-9A-HJ-NP-Za-km-z]{33}\b/g;
const RX_PUB_XRP = /\br[1-9A-HJ-NP-Za-km-z]{24,34}\b/g;
const RX_PUB_STEEM = /\b@?[a-z0-9][a-z0-9.-]{2,15}\b/g; // חשבונות steem — רועש; לא נספור

/**
 * אוצר-מילות BIP39 חלקי (~230 מילים נפוצות) — מסך-היוריסטי בלבד:
 * רצף ≥12 מילים שמתוכן ≥8 באוצר = מועמד-מנמוניק. לא "גלאי-ודאי" —
 * וכך הוא מתויג בכנות (note).
 */
const BIP39_SUBSET = new Set(
  ("abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid acoustic acquire across act action " +
    "actor actual adapt add addict address adjust admit adult advance advice affair afford afraid again age agent agree ahead aim air airport aisle alarm " +
    "album alcohol alert alien all alley allow almost alone alpha already also alter always amateur amazing among amount amused analyst anchor ancient " +
    "anger angle angry animal ankle announce annual another answer antenna antique anxiety any apart apple april architect arctic area arena argue arm " +
    "armed armor army around arrange arrest arrive arrow art artefact artist artwork ask aspect assault asset assist assume asthma athlete atom attack " +
    "attend attitude attract auction audit august aunt author auto autumn average avocado avoid awake aware away awesome awful awkward axis baby bachelor " +
    "bacon badge bag balance balcony ball bamboo banana banner bar barely bargain barrel base basic basket battle beach bean beauty because become beef " +
    "before begin behave behind believe below belt bench benefit best betray better between beyond bicycle bid bike bind biology bird birth bitter black " +
    "blade blame blanket blast bleak bless blind blood blossom blouse blue blur blush board boat body boil bomb bone bonus book boost border boring borrow " +
    "boss bottom bounce box boy bracket brain brand brass brave bread breeze brick bridge brief bright bring brisk broccoli broken bronze broom brother " +
    "brown brush bubble buddy budget buffalo build bulb bulk bullet bundle bunker burden burger burst bus business busy butter buyer buzz cabbage cabin " +
    "cable cactus cage cake call calm camera camp can canal cancel candy cannon canoe canvas canyon capable capital captain car carbon card cargo carpet " +
    "carry cart case cash casino castle casual cat catalog catch category cattle caught cause caution cave ceiling celery cement census century cereal " +
    "certain chair chalk champion change chaos chapter charge chase chat cheap check cheese chef cherry chest chicken chief child chimney choice choose " +
    "chronic chuckle chunk churn cigar cinnamon circle citizen city civil claim clap clarify claw clay clean clerk clever click client cliff climb clinic " +
    "clip clock clog close cloth cloud clown club clump cluster clutch coach coast coconut code coffee coil coin collect color column combine come comfort " +
    "comic common company concert conduct confirm congress connect consider control convince cook cool copper copy coral core corn correct cost cottage " +
    "cotton couch country couple course cousin cover coyote crack cradle craft cram crane crash crater crawl crazy cream credit creek crew cricket crime " +
    "crisp critic crop cross crouch crowd crucial cruel cruise crumble crunch crush cry crystal cube culture cup cupboard curious current curtain curve " +
    "cushion custom cute cycle dad damage damp dance danger daring dash daughter dawn day deal debate debris decade december decide decline decorate " +
    "decrease deer defense define defy degree delay deliver demand demise denial dentist deny depart depend deposit depth deputy derive describe desert " +
    "design desk despair destroy detail detect develop device devote diagram dial diamond diary dice diesel diet differ digital dignity dilemma dinner " +
    "dinosaur direct dirt disagree discover disease dish dismiss disorder display distance divert divide divorce dizzy doctor document dog doll dolphin " +
    "domain donate donkey donor door dose double dove draft dragon drama drastic draw dream dress drift drill drink drip drive drop drum dry duck dumb " +
    "dune during dust dutch duty dwarf dynamic eager eagle early earn earth easily east easy echo ecology economy edge edit educate effort egg eight " +
    "either elbow elder electric elegant element elephant elevator elite else embark embody embrace emerge emotion employ empower empty enable enact " +
    "end endless endorse enemy energy enforce engage engine enhance enjoy enlist enough enrich enroll ensure enter entire entry envelope episode equal " +
    "equip era erase erode erosion error erupt escape essay essence estate eternal ethics evidence evil evoke evolve exact example excess exchange excite " +
    "exclude excuse execute exercise exhaust exhibit exile exist exit exotic expand expect expire explain expose express extend extra eye eyebrow fabric " +
    "face faculty fade faint faith fall false fame family famous fan fancy fantasy farm fashion fat fatal father fatigue fault favorite feature february " +
    "federal fee feed feel female fence festival fetch fever few fiber fiction field figure file film filter final find fine finger finish fire firm " +
    "fiscal fish fit fitness fix flag flame flash flat flavor flee flight flip float flock floor flower fluid flush flute foam focus fog foil fold follow " +
    "food foot force forest forget fork fortune forum forward fossil foster found fox fragile frame famous frog front frost frown frozen fruit fuel fun " +
    "funny furnace fury future gadget gain galaxy gallery game gap garage garbage garden garlic garment gas gasp gate gather gauge gaze general genius " +
    "genre gentle genuine gesture ghost giant gift giggle ginger giraffe girl give glad glance glare glass glide glimpse globe gloom glory glove glow " +
    "glue goat goddess gold good goose gorilla gospel gossip govern gown grab grace grain grant grape grass gravity great green grid grief grit grocery " +
    "group grow grunt guard guess guide guilt guitar gut habit haircut half halo hammer hamster hand happy harbor hard harsh harvest hat have hawk hazard " +
    "head health heart heavy hedgehog height hello helmet help hen hero hidden high hill hint hip hire history hobby hockey hold hole holiday hollow home " +
    "honey hood hope horn horror horse hospital host hotel hour hover hub huge human humble humor hundred hungry hunt hurdle hurry hurt husband hybrid " +
    "ice icon idea identify idle ignore ill illegal illness image imitate immense immune impact impose improve impulse inch include income increase index " +
    "indoor infant inform inhale inherit initial inject injury inmate inner innocent input inquiry insane insect inside inspire install intact interest " +
    "into invest invite involve iron island isolate issue item ivory jacket jaguar jar jazz jealous jeans jelly jewel job join joke journey joy judge " +
    "juice jump jungle junior junk just kangaroo keen keep ketchup key kick kid kidney kind kingdom kiss kit kitchen kite kitten kiwi knee knife knock " +
    "know lab label labor ladder lady lake lamp language laptop large later latin laugh laundry lava law lawn lawsuit layer lazy leader leaf learn " +
    "leave lecture left leg legal legend leisure lemon lend length lens leopard lesson letter level liar liberty library license life lift light like " +
    "limbo limit line link lion list little live lizard load loan lobster local lock logic lonely long loop lottery loud lounge love loyal lucky luggage " +
    "lumber lunar lunch luxury lyrics machine mad magic magnet maid mail main major make mammal man manage mandate mango mansion manual maple marble march " +
    "margin marine market marriage mask mass master match material math matrix matter maximum maze meadow mean measure meat mechanic medal media melody " +
    "melon melt member memory mention menu mercy merge merit merry mesh message metal method middle midnight milk million mimic mind minimum minor minute " +
    "miracle mirror misery miss mistake mix mixed mixture mobile model modify mom moment monitor monkey monster month moon moral more morning mosaic " +
    "mother motion motor mountain mouse move movie much muffin mule multiply muscle museum mushroom music must mutual myself mystery myth").split(" ")
);

function countMnemonicCandidates(text: string): number {
  let n = 0;
  for (const m of text.matchAll(RX_WORD_RUN)) {
    const words = m[0].split(/\s+/);
    let inSet = 0;
    for (const w of words) if (BIP39_SUBSET.has(w)) inSet++;
    if (inSet >= 8) n++;
  }
  return n;
}

// ─── מסווג-האמת (הצלבת R18e): WIF פרטי מול מפתח-ציבורי מול tx-hash ─────────
// ההבחנה שהרוסט-הראשוני פספס: STM5… יכול להיות WIF פרטי (בית-גרסה 0x80)
// או מפתח-ציבורי דחוס (0x02/0x03) — אותו אורך בדיוק. הסיווג קריפטוגרפי:
// פענוח base58, אימות checksum (sha256d), ואז בית-ראשון. אפס חומר יוצא —
// רק הספירה משתנה.

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(raw: string): Buffer | null {
  try {
    let n = BigInt(0);
    for (const ch of raw) {
      const v = B58_ALPHABET.indexOf(ch);
      if (v < 0) return null;
      n = n * 58n + BigInt(v);
    }
    const hex = n.toString(16).padStart(Math.ceil((n.toString(16).length + 1) / 2) * 2, "0");
    const buf = Buffer.from(hex, "hex");
    // התחיות-קידומת לאפסים מובילים
    const zeros = raw.length - raw.replace(/^1+/, "").length;
    return Buffer.concat([Buffer.alloc(zeros), buf]);
  } catch {
    return null;
  }
}

/** true אם checksum של base58check תקין (sha256d-4) */
function b58ChecksumOk(buf: Buffer): boolean {
  if (buf.length < 5) return false;
  const payload = buf.subarray(0, buf.length - 4);
  const chk = createHash("sha256")
    .update(createHash("sha256").update(payload).digest())
    .digest()
    .subarray(0, 4);
  return chk.equals(buf.subarray(buf.length - 4));
}

interface SteemKeyClass {
  wifPrivate: number; // 0x80 — חומר-סוד מלא
  pubKey: number; // 0x02/0x03 — מפתח ציבורי (לא סוד)
  malformed: number; // checksum שגוי — כנראה טקסט תמים/דוקומנטציה מוסווית
}

function classifySteemKeys(text: string): SteemKeyClass {
  const out: SteemKeyClass = { wifPrivate: 0, pubKey: 0, malformed: 0 };
  for (const m of text.matchAll(/\bSTM[1-9A-HJ-NP-Za-km-z]{50,51}\b/g)) {
    const buf = base58Decode(m[0].slice(3)); // בלי קידומת STM
    if (!buf || !b58ChecksumOk(buf)) {
      out.malformed++;
      continue;
    }
    const first = buf[0]!;
    if (first === 0x80) out.wifPrivate++;
    else if (first === 0x02 || first === 0x03) out.pubKey++;
    else out.malformed++;
  }
  return out;
}

/**
 * הקשר-שורה עבור hex64: tx-hash ציבורי מול הקשר-מפתח. קדימות הבחנה:
 * (1) חלון-השדה — 70 התווים לפני ההתאמה (איפה שיושב שם-השדה: txid:, tx , root…);
 * (2) שורה שלמה; (3) מסך. נלמד חי מהריפו שלנו: השורות "SWEEP ETH — tx 0x…"
 * ביומן מזכירות מפתח-ריבוני באותה שורה אבל ה-hex עצמו txid מתועד — החלון
 * מכריע, לא השורה.
 */
const HEX_PUB_CTX = /(txid|tx_hash|txhash|transaction|\btx\b|explorer|etherscan|bscscan|solscan|tronscan|xrp|block|genesis|root|digest|seal|sha256|sha-256|merkle|codehash|selector|bytecode|artifact|placeholder|example)/i;
const HEX_KEY_CTX = /(private[_-]?key|privkey|signer|wallet|secret|mnemonic|seed)/i;

interface Hex64Class {
  keyCtx: number; // הקשר-מפתח — alert
  txCtx: number; // הקשר-tx/hash ציבורי — public
  unknown: number; // מסך — note
}

function classifyHex64(text: string, with0x: boolean): Hex64Class {
  const rx = with0x ? RX_HEX64_0X : RX_HEX64;
  const out: Hex64Class = { keyCtx: 0, txCtx: 0, unknown: 0 };
  for (const m of text.matchAll(rx)) {
    const idx = m.index ?? 0;
    const lineStart = text.lastIndexOf("\n", idx) + 1;
    const lineEnd = text.indexOf("\n", idx);
    const line = text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
    const before = text.slice(Math.max(lineStart, idx - 70), idx);
    if (HEX_PUB_CTX.test(before)) out.txCtx++;
    else if (HEX_KEY_CTX.test(before)) out.keyCtx++;
    else if (HEX_PUB_CTX.test(line)) out.txCtx++;
    else if (HEX_KEY_CTX.test(line)) out.keyCtx++;
    else out.unknown++;
  }
  return out;
}

// ─── the sweep ──────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 600_000;
let cache: { at: number; value: SecretSweepResult } | null = null;
let inflight: Promise<SecretSweepResult> | null = null;

async function runSweep(): Promise<SecretSweepResult> {
  const t0 = Date.now();
  const tracked = await gitTrackedFiles();
  const surface = tracked ? "git ls-files (בדיוק מה שנדחף)" : "הליכה-עצמית (git נכשל — נתון כנה)";
  const files = (tracked ?? []).slice(0, MAX_FILES);
  if (!tracked) {
    const out: string[] = [];
    await walkVisible(REPO, out, { left: MAX_FILES });
    files.push(...out.slice(0, MAX_FILES - files.length));
  }

  const counts = {
    steemWifPrivate: 0, // 0x80 — חומר-סוד מלא
    steemPubKey: 0, // 0x02/0x03 — מפתח ציבורי (הצלבת-האמת)
    steemMalformed: 0, // checksum שגוי — טקסט תמים/מוסווה
    wifKL: 0,
    wif5: 0,
    hex0xKeyCtx: 0,
    hex0xTxCtx: 0,
    hex0xUnknown: 0,
    hex64KeyCtx: 0,
    hex64TxCtx: 0,
    hex64Unknown: 0,
    secretAssign: 0,
    mnemonic: 0,
    pubEvm: 0,
    pubTron: 0,
    pubXrp: 0
  };
  let scannedFiles = 0;
  let scannedBytes = 0;
  let skippedBinary = 0;

  for (const rel of files) {
    const ext = path.extname(rel).toLowerCase();
    if (BINARY_EXT.has(ext)) {
      skippedBinary++;
      continue;
    }
    let text: string;
    try {
      const st = await stat(path.join(REPO, rel));
      if (!st.isFile() || st.size > MAX_FILE_BYTES) {
        skippedBinary++;
        continue;
      }
      text = await readFile(path.join(REPO, rel), "utf8");
    } catch {
      continue;
    }
    scannedFiles++;
    scannedBytes += Buffer.byteLength(text, "utf8");

    // הצלבת-האמת (R18e-style): סיווג קריפטוגרפי לפני הספירה — אפס חומר יוצא
    const skc = classifySteemKeys(text);
    counts.steemWifPrivate += skc.wifPrivate;
    counts.steemPubKey += skc.pubKey;
    counts.steemMalformed += skc.malformed;
    counts.wifKL += (text.match(RX_WIF_KL) ?? []).length;
    counts.wif5 += (text.match(RX_WIF_5) ?? []).length;
    const h0 = classifyHex64(text, true);
    counts.hex0xKeyCtx += h0.keyCtx;
    counts.hex0xTxCtx += h0.txCtx;
    counts.hex0xUnknown += h0.unknown;
    const h1 = classifyHex64(text, false);
    counts.hex64KeyCtx += h1.keyCtx;
    counts.hex64TxCtx += h1.txCtx;
    counts.hex64Unknown += h1.unknown;
    counts.secretAssign += (text.match(RX_SECRET_ASSIGN) ?? []).length;
    counts.mnemonic += countMnemonicCandidates(text);
    counts.pubEvm += (text.match(RX_PUB_EVM) ?? []).length;
    counts.pubTron += (text.match(RX_PUB_TRON) ?? []).length;
    counts.pubXrp += (text.match(RX_PUB_XRP) ?? []).length;
  }

  const patterns: SweepPattern[] = [
    {
      id: "steem-wif-private",
      label: "WIF פרטי Steem/Hive (0x80)",
      he: "חומר-סוד מלא — פוענח base58 + checksum + בית-גרסה 0x80",
      severity: "alert",
      count: counts.steemWifPrivate
    },
    {
      id: "steem-pubkey",
      label: "מפתחות ציבוריים STM (0x02/0x03)",
      he: "מפתח פומבי מאומת-checksum — לא סוד (הצלבת-האמת)",
      severity: "public",
      count: counts.steemPubKey
    },
    {
      id: "steem-malformed",
      label: "STM… checksum שגוי",
      he: "טקסט תמים או דוקומנטציה מוסווית — לא מפתח תקין",
      severity: "note",
      count: counts.steemMalformed
    },
    {
      id: "wif-kl",
      label: "WIF דחוס (K/L…)",
      he: "מפתח פרטי דחוס משפחת-ביטקוין",
      severity: "alert",
      count: counts.wifKL
    },
    {
      id: "wif-5",
      label: "WIF רגיל (5H/5J/5K…)",
      he: "מפתח פרטי לא-דחוס",
      severity: "alert",
      count: counts.wif5
    },
    {
      id: "hex64-0x-key",
      label: "hex64-0x בהקשר-מפתח",
      he: "שורה עם private/key/signer/wallet — alert",
      severity: "alert",
      count: counts.hex0xKeyCtx
    },
    {
      id: "hex64-0x-tx",
      label: "hex64-0x בהקשר-tx/hash",
      he: "txid · explorer · block · digest — פומבי",
      severity: "public",
      count: counts.hex0xTxCtx
    },
    {
      id: "hex64-0x-unknown",
      label: "hex64-0x ללא הקשר",
      he: "מסך-כנות — לא ניתן להכריע מההקשר",
      severity: "note",
      count: counts.hex0xUnknown
    },
    {
      id: "hex64-key",
      label: "hex64 חשוף בהקשר-מפתח",
      he: "בלי 0x, שורה עם מילות-מפתח",
      severity: "alert",
      count: counts.hex64KeyCtx
    },
    {
      id: "hex64-tx",
      label: "hex64 חשוף בהקשר-tx/hash",
      he: "פומבי",
      severity: "public",
      count: counts.hex64TxCtx
    },
    {
      id: "hex64-unknown",
      label: "hex64 חשוף ללא הקשר",
      he: "מסך-כנות",
      severity: "note",
      count: counts.hex64Unknown
    },
    {
      id: "secret-assign",
      label: "הקצאת-סוד (=…)",
      he: "PRIVATE_KEY=… / SECRET=… בטקסט",
      severity: "alert",
      count: counts.secretAssign
    },
    {
      id: "mnemonic",
      label: "מנמוניק-מועמד",
      he: "מסך-היוריסטי (≥12 מילים, ≥8 באוצר BIP39) — לא ודאי",
      severity: "note",
      count: counts.mnemonic
    },
    {
      id: "pub-evm",
      label: "כתובות EVM פומביות",
      he: "0x…40 — פומבי מעיקרו",
      severity: "public",
      count: counts.pubEvm
    },
    {
      id: "pub-tron",
      label: "כתובות TRON פומביות",
      he: "T… — פומבי מעיקרו",
      severity: "public",
      count: counts.pubTron
    },
    {
      id: "pub-xrp",
      label: "כתובות XRP פומביות",
      he: "r… — פומבי מעיקרו",
      severity: "public",
      count: counts.pubXrp
    }
  ];

  const realAlerts = patterns.filter((p) => p.severity === "alert").reduce((a, p) => a + p.count, 0);
  const publicCount = patterns.filter((p) => p.severity === "public").reduce((a, p) => a + p.count, 0);
  const noteCount = patterns.filter((p) => p.severity === "note").reduce((a, p) => a + p.count, 0);

  const verdict =
    realAlerts === 0
      ? `0 חומר-סוד אמיתי בשטח הגלוי (${scannedFiles} קבצים · ${publicCount} תוויות-פומביות מאומתות — כולל ${counts.steemPubKey} מפתחות-ציבוריים שסווגו קריפטוגרפית · ${noteCount} מסכי-כנות) — ה-.env והכספות מחוץ לריפו מעיקרם`
      : `${realAlerts} התאמות-חשודות בשטח הגלוי (הצלבת-הקשר+checksum בוצעה; לא כל התאמה מוכחת-סוד) — דורש בדיקת-עומק ידנית. counts-only בכנות; החומר עצמו לא נאסף.`;

  return {
    ok: true,
    surface,
    scannedFiles,
    scannedBytes,
    skippedBinary,
    patterns,
    realAlerts,
    verdict,
    tookMs: Date.now() - t0,
    measuredAt: new Date().toISOString()
  };
}

/**
 * סוופ-סודות ריבוני. מטמון 10 דק' · dedupe-inflight · never throws.
 */
export async function runSecretSweep(opts: { force?: boolean } = {}): Promise<SecretSweepResult> {
  if (!opts.force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  if (inflight) return inflight;
  inflight = runSweep().catch((e): SecretSweepResult => ({
    ok: false,
    surface: "—",
    scannedFiles: 0,
    scannedBytes: 0,
    skippedBinary: 0,
    patterns: [],
    realAlerts: 0,
    verdict: "הסוופ נכשל — נתון כנה",
    tookMs: 0,
    measuredAt: new Date().toISOString(),
    error: e instanceof Error ? e.message.slice(0, 160) : "secret sweep failed"
  }));
  try {
    const v = await inflight;
    if (v.ok) cache = { at: Date.now(), value: v };
    return v;
  } finally {
    inflight = null;
  }
}
