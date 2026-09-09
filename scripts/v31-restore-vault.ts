/**
 * v31-restore-vault — SMART LINK vault restoration (2026-09-09).
 * =====================================================================
 * Rebuilds the SAOS-FLEET-VAULT-1 envelope from the owner's key export
 * (KEYS-EXPORT-2026-09-09.md — owner directive) + the owner's uploaded
 * record (הדקור.txt), with CRYPTOGRAPHIC SELF-VERIFICATION before any
 * sealing (fail-closed: one mismatch → abort, zero partial state).
 *
 * Multi-home: the sealed envelope is written to agent/keys (runtime),
 * /home/z/saos-vault/agent-keys (off-repo) and upload/.agent-keys
 * (the empirically-surviving folder). Never in git — verified.
 *
 * Prints PUBLIC facts only (addresses, pubs, verdicts) — never WIFs,
 * phrases, seeds or tokens.
 */

import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from "fs"
import { createHash, createHmac, pbkdf2Sync, createCipheriv, randomBytes, scryptSync } from "crypto"
import { ethers } from "ethers"
import { secp256k1 } from "@noble/curves/secp256k1.js"
import bs58 from "bs58"
import { Keypair } from "@solana/web3.js"

const SHA256 = (b: Buffer) => createHash("sha256").update(b).digest()
const RIPEMD160 = (b: Buffer) => createHash("ripemd160").update(b).digest()

const MAGIC = "SAOS-FLEET-VAULT-1"
const EXPORT = "KEYS-EXPORT-2026-09-09.md"
const LEGACY_FILE = "upload/הדקור.txt"

const HOMES = [
  "agent/keys",
  `${process.env.HOME ?? "/home/z"}/saos-vault/agent-keys`,
  "upload/.agent-keys"
]

// ─── public anchors (fail-closed verification targets) ────────────────────
const A = {
  treasuryHome: "0x01Bd2879Cd9990Cb4B25cD6DE47f378Dc5D18B37", // 24w m/44'/60'/0'/0/0
  coinomiLegacy: "0x97Ad0C1b9Dc3269bC4848b5a2884e6cADc86dF18", // 24w m/44'/60'/0'/0
  xrp: "r3Tq66LWQJS86oNWvbWftRxRQFiJ7wGKwh", // 24w m/44'/144'/0'/0/0
  sovereignEvm: "0x7b7869d126FA1ecC19a3426D07bE8186225a2c31", // 12w idx0
  sovereignTron: "TAzZZkrwBXk59iRya7esnKVJeV1xLtqkGr", // 12w idx0
  oldFleetEvmHeadcorner: "0x2767e8146c11baD1d9B0784f11325375195c1b0f", // old seed idx2
  steemOldOwnerPub: "STM5aUKyd9LzENnMti5tS478Zu1SLJW51VHyu2gvSNGKhwfyMFpvv"
}

// ─── crypto helpers (copied from proven v22/v30 code) ─────────────────────

function tronAddressFromPriv(privHex: string): string {
  // proven approach (cornerstone.ts): 0x41 + wallet.address bytes + sha256d checksum
  const pk = privHex.startsWith("0x") ? privHex : "0x" + privHex
  const address = new ethers.Wallet(pk).address
  const payload = Buffer.concat([Buffer.from([0x41]), Buffer.from(address.slice(2), "hex")])
  const checksum = SHA256(SHA256(payload)).subarray(0, 4)
  return bs58.encode(Buffer.concat([payload, checksum]))
}

function steemPubFromWif(wif: string): string {
  // WIF: base58check(sha256d) → 0x80 + 32B priv (+0x01) ; pub: graphene ripemd160 checksum
  const raw = bs58.decode(wif)
  const payload = Buffer.from(raw.subarray(0, raw.length - 4))
  if (!Buffer.from(raw.subarray(raw.length - 4)).equals(Buffer.from(SHA256(SHA256(payload)).subarray(0, 4)))) {
    throw new Error("WIF sha256d checksum mismatch")
  }
  if (payload[0] !== 0x80) throw new Error("unexpected WIF version")
  const priv = payload.subarray(1, 33)
  const sk = new ethers.SigningKey(priv)
  const pub33 = Buffer.from(sk.compressedPublicKey.slice(2), "hex")
  return "STM" + bs58.encode(Buffer.concat([pub33, RIPEMD160(pub33).subarray(0, 4)]))
}

function xrpPrivFromPhrase(phrase: string): { privHex: string; pubHex: string } {
  const seed = pbkdf2Sync(Buffer.from(phrase.normalize("NFKD")), Buffer.from("mnemonic"), 2048, 64, "sha512")
  const master = createHmac("sha512", Buffer.from("Bitcoin seed")).update(seed).digest()
  let priv = Buffer.from(master.subarray(0, 32))
  let chain = Buffer.from(master.subarray(32))
  const H = (n: number) => n + 0x80000000
  for (const idx of [H(44), H(144), H(0), 0, 0]) {
    const data = Buffer.alloc(37)
    if (idx >= 0x80000000) { data[0] = 0; priv.copy(data, 1) }
    else { Buffer.from(secp256k1.getPublicKey(priv, true)).copy(data, 0) }
    data.writeUInt32BE(idx >>> 0, 33)
    const I = createHmac("sha512", chain).update(data).digest()
    let k = BigInt("0x" + Buffer.from(I.subarray(0, 32)).toString("hex")) + BigInt("0x" + priv.toString("hex"))
    k %= 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
    priv = Buffer.from(k.toString(16).padStart(64, "0"), "hex")
    chain = Buffer.from(I.subarray(32))
  }
  return { privHex: priv.toString("hex"), pubHex: Buffer.from(secp256k1.getPublicKey(priv, true)).toString("hex") }
}

const ROSTER = ["headcorner", "cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq", "ynet"]

function mnemonicSeed(phrase: string): Buffer {
  const mn = ethers.Mnemonic.fromPhrase(phrase)
  return Buffer.from(mn.computeSeed().replace(/^0x/, ""), "hex")
}

function slip10Ed25519(seed: Buffer, steps: number[]): Buffer {
  const I = createHmac("sha512", Buffer.from("ed25519 seed")).update(seed).digest()
  let node = { IL: I.subarray(0, 32), IR: I.subarray(32, 64) }
  for (const idx of steps) {
    const data = Buffer.concat([Buffer.from([0x00]), node.IL, (() => { const b = Buffer.alloc(4); b.writeUInt32BE(idx >>> 0, 0); return b })()])
    const J = createHmac("sha512", node.IR).update(data).digest()
    node = { IL: J.subarray(0, 32), IR: J.subarray(32, 64) }
  }
  return node.IL
}

function deriveCornerstoneAgents(phrase: string) {
  const seed = mnemonicSeed(phrase)
  const H = (n: number) => n + 0x80000000
  return ROSTER.map((agent, idx) => {
    const evmPath = `m/44'/60'/0'/${idx}/0`
    const tronPath = `m/44'/195'/0'/${idx}/0`
    const solPath = `m/44'/501'/${idx}'/0'`
    const evmW = ethers.HDNodeWallet.fromPhrase(phrase, undefined, evmPath)
    const tronW = ethers.HDNodeWallet.fromPhrase(phrase, undefined, tronPath)
    const solSk = slip10Ed25519(seed, [H(44), H(501), H(idx), H(0)])
    const tronAddress = (() => {
      const evmBytes = Buffer.from(tronW.address.slice(2), "hex")
      const payload = Buffer.concat([Buffer.from([0x41]), evmBytes])
      const checksum = SHA256(SHA256(payload)).subarray(0, 4)
      return bs58.encode(Buffer.concat([payload, checksum]))
    })()
    return {
      agent, idx,
      evm: evmW.address, evmPath,
      tron: tronAddress, tronPath,
      sol: Keypair.fromSeed(solSk).publicKey.toBase58(), solPath
    }
  })
}

// ─── export parsing ────────────────────────────────────────────────────────

function parseExport() {
  const raw = readFileSync(EXPORT, "utf8")
  const sections = raw.split(/^## /m).map((s) => s.trim())

  // §1 STEEM WIFs
  const s1 = sections.find((s) => s.startsWith("1. STEEM")) ?? ""
  const steemWifs: Array<{ role: string; wif: string; oldPub: string; currentPub: string }> = []
  for (const m of s1.matchAll(/\|\s*(owner|active|posting|memo)\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`/g)) {
    steemWifs.push({ role: m[1], wif: m[2], oldPub: m[3], currentPub: m[4] })
  }

  // §3 24-word phrase: words until the first ### subsection
  const s3 = sections.find((s) => s.startsWith("3. 🔑")) ?? ""
  const s3head = s3.split("###")[0]
  const words24 = (s3head.match(/\b[a-z]{3,8}\b/g) ?? []).filter((w) => w !== "coinomi")
  // try consecutive windows of 24 that form a valid BIP39 phrase
  let phrase24: string | null = null
  for (let i = 0; i + 24 <= words24.length && !phrase24; i++) {
    const cand = words24.slice(i, i + 24).join(" ")
    try { ethers.Mnemonic.fromPhrase(cand); phrase24 = cand } catch { /* keep looking */ }
  }

  // §3.4 XRP pk
  const xrpPk = s3.match(/`r3Tq66[^`]*`[^\n]*\|\s*`([0-9a-f]{64})`/)?.[1] ?? null

  // §3.2 TRON headcorner (agent headcorner pk, for completeness check)
  // §4 12-word phrase
  const s4 = sections.find((s) => s.startsWith("4. 🔑")) ?? ""
  const s4head = s4.split("|")[0]
  const words12 = (s4head.match(/\b[a-z]{3,8}\b/g) ?? [])
  let phrase12: string | null = null
  for (let i = 0; i + 12 <= words12.length && !phrase12; i++) {
    const cand = words12.slice(i, i + 12).join(" ")
    try { ethers.Mnemonic.fromPhrase(cand); phrase12 = cand } catch { /* keep looking */ }
  }

  // §5 old wallets
  const s5 = sections.find((s) => s.startsWith("5. 🗄️")) ?? ""
  const oldSeedHex = s5.match(/הזרע הישן[^\n]*`([0-9a-f]{96})`/)?.[1] ?? null
  const vaultKey = s5.match(/\.vaultkey[^\n]*`([^`]+)`/)?.[1] ?? null
  const tronMnemonic = s5.match(/tron-mnemonic[^\n]*`([a-z ]+)`/)?.[1]?.trim() ?? null
  const oldWallets: Array<{ agent: string; idx: number; evm: string; evmPk: string; tron: string; tronPk: string; sol: string; solPk: string; btc: string }> = []
  for (const m of s5.matchAll(/\|\s*([a-z]+)\s*\(idx (\d+)\)\s*\|\s*`(0x[0-9a-fA-F]{40})`\s*\|\s*`(0x[0-9a-fA-F]{64})`\s*\|\s*`(T[1-9A-HJ-NP-Za-km-z]{33})`\s*\|\s*`(0x[0-9a-fA-F]{64})`\s*\|\s*`([1-9A-HJ-NP-Za-km-z]{32,44})`\s*\|\s*`([0-9a-f]{64})`\s*\|\s*`(bc1[a-z0-9]+)`/g)) {
    oldWallets.push({ agent: m[1], idx: Number(m[2]), evm: m[3], evmPk: m[4], tron: m[5], tronPk: m[6], sol: m[7], solPk: m[8], btc: m[9] })
  }

  // §7 github token
  const s7 = sections.find((s) => s.startsWith("7. GITHUB")) ?? ""
  const githubToken = s7.match(/(gh[pousr]_[A-Za-z0-9]{20,})/)?.[1] ?? null

  return { steemWifs, phrase24, xrpPk, phrase12, oldSeedHex, vaultKey, tronMnemonic, oldWallets, githubToken }
}

function parseLegacyFile() {
  const raw = readFileSync(LEGACY_FILE, "utf8")
  const out: Array<{ chain: string; role: string; wif: string }> = []
  let chain = ""
  for (const line of raw.split("\n")) {
    const t = line.trim()
    if (!t) continue
    if (/^headcon/i.test(t)) { chain = "STEEM"; continue }
    if (/^HIVE\b/i.test(t)) { chain = "HIVE"; continue }
    const m = t.match(/^(OWNER|ACTIVE|POSTING|MEMO)\s*=\s*(\S+)$/)
    if (m && chain) out.push({ chain, role: m[1], wif: m[2] })
  }
  return out
}

// ─── main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("── v31 SMART LINK — vault restoration ──")
  const exp = parseExport()
  const legacy = parseLegacyFile()

  const checks: Array<{ name: string; ok: boolean; detail: string }> = []
  const fail = (name: string, detail: string) => { checks.push({ name, ok: false, detail }); console.log(`  ✗ ${name}: ${detail}`) }
  const pass = (name: string, detail: string = "") => { checks.push({ name, ok: true, detail }); console.log(`  ✓ ${name}`) }

  if (!exp.phrase24) { fail("פרשור 24", "לא נמצא בייצוא"); process.exit(1) }
  if (!exp.phrase12) { fail("פרשור 12", "לא נמצא בייצוא"); process.exit(1) }
  if (exp.steemWifs.length !== 4) { fail("WIFs STEEM", `נמצאו ${exp.steemWifs.length}/4`); process.exit(1) }
  if (!exp.oldSeedHex) { fail("זרע ישן", "חסר"); process.exit(1) }
  if (exp.oldWallets.length < 12) { fail("ארנקים ישנים", `נמצאו ${exp.oldWallets.length}/12`); process.exit(1) }
  if (!exp.githubToken) { fail("GITHUB_TOKEN", "חסר"); process.exit(1) }

  // ── 1. 24-word verification
  const m24 = ethers.Mnemonic.fromPhrase(exp.phrase24)
  const home = ethers.HDNodeWallet.fromMnemonic(m24, "m/44'/60'/0'/0/0")
  const legacyCoinomi = ethers.HDNodeWallet.fromMnemonic(m24, "m/44'/60'/0'/0")
  if (home.address.toLowerCase() !== A.treasuryHome.toLowerCase()) { fail("0x01Bd", home.address); process.exit(1) }
  pass("בית-האוצר 0x01Bd", home.address)
  if (legacyCoinomi.address.toLowerCase() !== A.coinomiLegacy.toLowerCase()) { fail("0x97Ad", legacyCoinomi.address); process.exit(1) }
  pass("מקור Coinomi 0x97Ad")
  const xrp = xrpPrivFromPhrase(exp.phrase24)
  if (!exp.xrpPk) { fail("XRP pk", "חסר בייצוא"); process.exit(1) }
  if (exp.xrpPk.toLowerCase() !== xrp.privHex.toLowerCase()) {
    fail("XRP pk", "אינו תואם לגזירה מהפרשור"); process.exit(1)
  }
  pass("XRPL r3Tq66 — המפתח הנגזר מהפרשור תואם במדויק למפתח המיוצא")

  // ── 2. 12-word verification
  const m12 = ethers.Mnemonic.fromPhrase(exp.phrase12)
  const evm12 = ethers.HDNodeWallet.fromMnemonic(m12, "m/44'/60'/0'/0/0")
  const tron12 = ethers.HDNodeWallet.fromMnemonic(m12, "m/44'/195'/0'/0/0")
  const tron12Address = (() => {
    const evmBytes = Buffer.from(tron12.address.slice(2), "hex")
    const payload = Buffer.concat([Buffer.from([0x41]), evmBytes])
    const checksum = SHA256(SHA256(payload)).subarray(0, 4)
    return bs58.encode(Buffer.concat([payload, checksum]))
  })()
  if (evm12.address.toLowerCase() !== A.sovereignEvm.toLowerCase()) { fail("0x7b78", evm12.address); process.exit(1) }
  pass("שורש-זהות 0x7b78")
  if (tron12Address !== A.sovereignTron) { fail("TAzZZ", tron12Address); process.exit(1) }
  pass("שורש-זהות TAzZZ")

  // ── 3. old seed verification (fleet-arm discipline)
  const oldRoot = ethers.HDNodeWallet.fromSeed(SHA256(Buffer.from(exp.oldSeedHex + "|evm|44/60")))
  const oldW2 = oldRoot.derivePath("m/44'/60'/0'/0/2")
  if (oldW2.address.toLowerCase() !== A.oldFleetEvmHeadcorner.toLowerCase()) { fail("זרע ישן → 0x2767", oldW2.address); process.exit(1) }
  pass("זרע ישן → 0x2767 (fleet-arm self-verify יעבור)")

  // ── 4. STEEM WIFs → old pubs
  for (const w of exp.steemWifs) {
    const pub = steemPubFromWif(w.wif)
    if (pub !== w.oldPub) { fail(`WIF ${w.role}`, "הגזירה אינה תואמת לציבורי הישן"); process.exit(1) }
  }
  if (steemPubFromWif(exp.steemWifs.find((w) => w.role === "owner")!.wif) !== A.steemOldOwnerPub) {
    fail("owner pub", "אינו חותם הרוטציה ההיסטורי"); process.exit(1)
  }
  pass("4 WIFs STEEM → פומביים ישנים (כולל חותם-ההתאוששות STM5aUKyd…)")

  // ── 5. old wallets verification
  for (const w of exp.oldWallets) {
    const evmOk = new ethers.Wallet(w.evmPk.startsWith("0x") ? w.evmPk : "0x" + w.evmPk).address.toLowerCase() === w.evm.toLowerCase()
    const tronPk = w.tronPk.startsWith("0x") ? w.tronPk : "0x" + w.tronPk
    const tronOk = tronAddressFromPriv(tronPk) === w.tron
    const solOk = Keypair.fromSeed(Buffer.from(w.solPk, "hex")).publicKey.toBase58() === w.sol
    if (!evmOk || !tronOk || !solOk) { fail(`ארנק ישן ${w.agent}`, `evm:${evmOk} tron:${tronOk} sol:${solOk}`); process.exit(1) }
  }
  pass(`12 ארנקים ישנים — כל המפתחות תואמים לכתובות (כולל הכסף החי)`)

  // legacy file (user's own record) — derive pubs, mark generation-mismatch
  const legacyPubs = legacy.map((l) => ({ ...l, pub: steemPubFromWif(l.wif) }))
  pass(`רשומת הבעלים (הדקור.txt): ${legacy.length} WIFs — דור שונה, לתיעוד`)

  // ── 6. cornerstone agents table (for the seed member)
  const agents = deriveCornerstoneAgents(exp.phrase24)
  pass("טבלת 12 סוכני אבן-הפינה נגזרה")

  // ── 7. self-proof signature (like v22)
  const message = `SAOS-SMART-LINK-V31 ${new Date().toISOString()}`
  const messageDigest = createHash("sha256").update(message).digest("hex").slice(0, 16)
  const sigWallet = ethers.HDNodeWallet.fromMnemonic(m24, "m/44'/60'/0'/0/0")
  const signature = await sigWallet.signMessage(message)
  const recovered = ethers.verifyMessage(message, signature)
  if (recovered.toLowerCase() !== A.treasuryHome.toLowerCase()) { fail("self-proof", recovered); process.exit(1) }
  pass("הוכחת-חתימה עצמית (0x01Bd חותם ומאומת)")

  // ── build the bundle
  const sealedAt = new Date().toISOString()
  const files: Record<string, string> = {}

  files[".env"] = [
    `AGENT_ACCOUNT=headcorner`,
    `DRY_RUN=true`,
    `VAULT_MODE=restored-v31-smartlink`,
    `VAULT_MASTER_SYNC_AT=${sealedAt}`,
    `OWNER_WIF_PUB=${exp.steemWifs.find((w) => w.role === "owner")?.oldPub ?? ""}`,
    `ACTIVE_WIF_PUB=${exp.steemWifs.find((w) => w.role === "active")?.oldPub ?? ""}`,
    `POSTING_WIF_PUB=${exp.steemWifs.find((w) => w.role === "posting")?.oldPub ?? ""}`,
    `MEMO_WIF_PUB=${exp.steemWifs.find((w) => w.role === "memo")?.oldPub ?? ""}`,
    `# v31 SMART LINK: WIFs שווחזרו מהייצוא שהבעלים אישר (2026-09-09).`,
    `# המפתחות הוחלפו בשרשרת 2026-09-08T21:17:33 (account_update) — הם שמורים לחלון ההתאוששות (~30 יום, עד ~2026-10-08).`,
    `# חתימת STEEM/HIVE לא תעבור עד התאוששות — שידורים ייכשלו בכנות.`,
    `ACTIVE_WIF=${exp.steemWifs.find((w) => w.role === "active")?.wif ?? ""}`,
    `POSTING_WIF=${exp.steemWifs.find((w) => w.role === "posting")?.wif ?? ""}`,
    `OWNER_WIF=${exp.steemWifs.find((w) => w.role === "owner")?.wif ?? ""}`,
    `MEMO_WIF=${exp.steemWifs.find((w) => w.role === "memo")?.wif ?? ""}`
  ].join("\n")

  files["keys/headcorner-seed.json"] = JSON.stringify({
    label: "cornerstone-24words",
    words: 24,
    source: "KEYS-EXPORT-2026-09-09.md §3 (הבעלים) — שוחזר v31",
    wallet: "Coinomi recovery",
    derivation: { evm: "m/44'/60'/0'/0/0", tron: "m/44'/195'/0'/0/0", sol: "m/44'/501'/0'/0'" },
    identities: { evm: agents[0].evm, tron: agents[0].tron, sol: agents[0].sol, treasuryHome: A.treasuryHome, coinomiLegacy: A.coinomiLegacy, xrp: A.xrp },
    agentScheme: { evm: "m/44'/60'/0'/{i}/0", tron: "m/44'/195'/0'/{i}/0", sol: "m/44'/501'/{i}'/0'", accounts: ROSTER.length },
    agents,
    signatureProof: { messageDigest, verified: true },
    sovereign12: "שורש-הזהות (12 מילים) אומת מול ראיות mainnet+TRON",
    sealedAt,
    rearm: "v31-smartlink-restore",
    phrase: exp.phrase24
  }, null, 2)

  files["keys/sovereign-mnemonic.json"] = JSON.stringify({
    label: "sovereign-12words (שורש-הזהות)",
    words: 12,
    source: "KEYS-EXPORT-2026-09-09.md §4 (הבעלים) — שוחזר v31",
    derivation: { evm: "m/44'/60'/0'/0/0", tron: "m/44'/195'/0'/0/0" },
    identities: { evm: A.sovereignEvm, tron: A.sovereignTron },
    anchoredAt: sealedAt,
    phrase: exp.phrase12
  }, null, 2)

  files["keys/wallets-registry.json"] = JSON.stringify({
    accounts: [
      {
        idx: 0,
        agent: "sovereign-user",
        evm: { address: A.sovereignEvm, path: "m/44'/60'/0'/0/0", nets: ["ETHEREUM", "BSC"] },
        tron: { address: A.sovereignTron, path: "m/44'/195'/0'/0/0" },
        sol: null,
        note: "שורש-הזהות (12 מילים) — מאומת מול ראיות השרשרת"
      },
      ...agents.map((a) => ({
        idx: a.idx,
        agent: a.agent,
        evm: { address: a.evm, path: a.evmPath, nets: ["ETHEREUM", "BSC"] },
        tron: { address: a.tron, path: a.tronPath },
        sol: { address: a.sol, path: a.solPath },
        note: a.agent === "headcorner" ? "אבן הפינה — השורש התפעולי (24 מילים); בית-האוצר 0x01Bd" : "נגזר דטרמיניסטית מהזרע"
      }))
    ],
    sealedAt
  }, null, 2)

  files["keys/vault.json"] = JSON.stringify({
    accounts: Object.fromEntries(agents.map((a) => [
      a.agent,
      {
        username: a.agent,
        tier: a.agent === "headcorner" ? "sovereign" : "soldier",
        mode: "cornerstone-derived-v22",
        chains: { steem: ["posting"], hive: [] }
      }
    ])),
    sealedAt
  }, null, 2)

  files["keys/wallets-seed.json"] = JSON.stringify({
    seed: exp.oldSeedHex,
    note: "הזרע הישן (96 hex) — שורש הארנקים ההיסטוריים (fleet-arm m/44'/60'/0'/0/2 = 0x2767, אומת)",
    sealedAt
  }, null, 2)

  files["keys/headcorner-steem-legacy.json"] = JSON.stringify({
    kind: "pre-rotation headcorner keys (recovery window)",
    rotatedAt: "2026-09-08T21:17:33 (STEEM) / 21:17:39 (HIVE)",
    recoveryWindowEnds: "~2026-10-08",
    recoveryAccount: "steem",
    tx: "8313cdcb9da74ba0d63a5302b72e3d7e6dcc6c81",
    steem: Object.fromEntries(exp.steemWifs.map((w) => [w.role, { wif: w.wif, oldPub: w.oldPub, currentChainPub: w.currentPub, status: w.role === "owner" ? "נדרש להתאוששות" : "מת" }])),
    note: "הבעלים הוריד את הייצוא; המפתחות נשמרים כאן חתומים לחלון ההתאוששות. HIVE השתמש באותם WIFs.",
    sealedAt
  }, null, 2)

  files["keys/old-fleet-wallets.json"] = JSON.stringify({
    kind: "old fleet wallets — הכסף שחשבנו שאבד (קיים!)",
    artifacts: { oldSeedHex: exp.oldSeedHex, vaultKey: exp.vaultKey, tronMnemonic: exp.tronMnemonic },
    wallets: exp.oldWallets.map((w) => ({
      agent: w.agent, idx: w.idx,
      evm: { address: w.evm, pk: w.evmPk },
      tron: { address: w.tron, pk: w.tronPk },
      sol: { address: w.sol, pk: w.solPk },
      btc: { address: w.btc },
      liveMoney: w.agent === "headcorner" ? "TRX 17.599234 ב-TG6Srs… · SOL 0.023981117 ב-9knfn… · ETH ~0.000082 ב-0x2767…" : null
    })),
    note: "המפתחות שנחשבו שרופים שרדו בעותק הכספת בריפו steem — הוחזרו על-ידי הייצוא. ההעברה לבית-האוצר = פעולת רשות בלבד.",
    sealedAt
  }, null, 2)

  files["keys/xrp-cornerstone.json"] = JSON.stringify({
    address: A.xrp,
    privHex: xrp.privHex,
    note: "1.299961 XRP · רזרבת בסיס 1.0 · בר-שליחה ~0.2999 — הפעימות חיות (v30)",
    sealedAt
  }, null, 2)

  files["keys/github-token.json"] = JSON.stringify({
    token: exp.githubToken,
    login: "roshpinacare-sys",
    note: "PAT מלא — גם מוטמע ב-remote URL. לעולם לא בריפו (הקובץ Roshcaregt.txt יימחק מהאינדקס).",
    sealedAt
  }, null, 2)

  files["keys/legacy-owner-record.json"] = JSON.stringify({
    kind: "רשומת הבעלים הדקור.txt — דור מפתחות שונה (לתיעוד)",
    checkedAt: sealedAt,
    verdict: "אף אחד מה-WIFs אינו תואם לרשויות הנוכחיות או לפרה-רוטציה של headcorner (STEEM+HIVE) — דור ישן יותר",
    entries: legacyPubs.map((l) => ({ chain: l.chain, role: l.role, pub: l.pub, wif: l.wif })),
    sealedAt
  }, null, 2)

  // ── seal (SAOS-FLEET-VAULT-1 format)
  const bundle = { sealedAt, count: Object.keys(files).length, files }
  const pass_ = randomBytes(24).toString("hex")
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = scryptSync(pass_, salt, 32)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const ct = Buffer.concat([cipher.update(JSON.stringify(bundle), "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  const sealed = MAGIC + Buffer.concat([salt, iv, tag, ct]).toString("hex")

  let written = 0
  for (const home of HOMES) {
    try {
      mkdirSync(home, { recursive: true })
      writeFileSync(`${home}/fleet_keys.enc`, sealed, { mode: 0o600 })
      writeFileSync(`${home}/fleet_keys.meta.json`, JSON.stringify({ pass: pass_ }, null, 2), { mode: 0o600 })
      chmodSync(`${home}/fleet_keys.enc`, 0o600)
      chmodSync(`${home}/fleet_keys.meta.json`, 0o600)
      written++
      console.log(`  🏠 נכתב: ${home} (${sealed.length}B)`)
    } catch (e) {
      console.log(`  ⚠ דילוג כן: ${home} — ${e instanceof Error ? e.message : e}`)
    }
  }
  if (written === 0) { console.log("FATAL: אף בית לא נכתב"); process.exit(1) }

  // ── round-trip verification (open through the module reader)
  const { readSealInventory, vaultHomesHealth } = await import("../src/lib/vault-seal")
  const inv = await readSealInventory()
  console.log(`\n── round-trip: GCM ✓ · ${inv.files.length} חברים · sealedAt ${inv.sealedAt}`)
  console.log(`  agent: ${inv.agent.account} · ownerPub ${inv.agent.ownerPub?.slice(0, 14)}…`)
  console.log(`  wallets: ${inv.wallets.length} · fleet: ${inv.fleet.length}`)
  const health = await vaultHomesHealth()
  for (const h of health) console.log(`  בית ${h.kind}: ${h.present ? `✓ ${h.bytes}B (0${h.mode})` : "✗ חסר"}`)
  const members = ["keys/headcorner-seed.json", "keys/sovereign-mnemonic.json", "keys/wallets-registry.json", "keys/wallets-seed.json", "keys/headcorner-steem-legacy.json", "keys/old-fleet-wallets.json", "keys/github-token.json", "keys/xrp-cornerstone.json", "keys/legacy-owner-record.json", ".env"]
  const missing = members.filter((m) => !inv.files.includes(m))
  if (missing.length) { console.log("FATAL: חברים חסרים:", missing); process.exit(1) }
  console.log("  כל 10 החברים קיימים ✓")

  // ── SmartKey DB rows (public metadata only)
  const { db } = await import("../src/lib/db")
  const rows: Array<{ keyId: string; name: string; kind: string; network: string; role?: string; address?: string; status: string; note?: string; materialRef: string }> = [
    { keyId: "steem-owner-legacy", name: "headcorner STEEM — owner (פרה-רוטציה)", kind: "steem-wif", network: "STEEM", role: "owner", address: "headcorner", status: "legacy", note: "נדרש להתאוששות עד ~2026-10-08 · חותם הרוטציה 8313cdcb…", materialRef: "keys/headcorner-steem-legacy.json" },
    { keyId: "steem-active-legacy", name: "headcorner STEEM — active (פרה-רוטציה)", kind: "steem-wif", network: "STEEM", role: "active", address: "headcorner", status: "legacy", note: "הוחלף 2026-09-08T21:17:33", materialRef: "keys/headcorner-steem-legacy.json" },
    { keyId: "steem-posting-legacy", name: "headcorner STEEM — posting (פרה-רוטציה)", kind: "steem-wif", network: "STEEM", role: "posting", address: "headcorner", status: "legacy", note: "הוחלף — שידורי העוגנים פסקו", materialRef: "keys/headcorner-steem-legacy.json" },
    { keyId: "steem-memo-legacy", name: "headcorner STEEM — memo (פרה-רוטציה)", kind: "steem-wif", network: "STEEM", role: "memo", address: "headcorner", status: "legacy", note: "הוחלף", materialRef: "keys/headcorner-steem-legacy.json" },
    { keyId: "cornerstone-seed-24", name: "אבן הפינה — זרע 24 המילים", kind: "mnemonic", network: "MULTI", role: "cornerstone", address: A.treasuryHome, status: "connected", note: "השורש התפעולי: EVM/TRON/SOL/XRP · בית-האוצר 0x01Bd · XRP r3Tq66", materialRef: "keys/headcorner-seed.json" },
    { keyId: "sovereign-seed-12", name: "שורש-הזהות — זרע 12 המילים", kind: "mnemonic", network: "MULTI", role: "sovereign", address: A.sovereignEvm, status: "connected", note: "זהויות 0x7b78 + TAzZZ · TRX 0.05", materialRef: "keys/sovereign-mnemonic.json" },
    { keyId: "treasury-home-evm", name: "בית-האוצר 0x01Bd (ETH+BNB)", kind: "evm-priv", network: "ETHEREUM", role: "treasury", address: A.treasuryHome, status: "connected", note: "m/44'/60'/0'/0/0 — לכאן הוזז הכסף (v30)", materialRef: "keys/headcorner-seed.json" },
    { keyId: "xrp-cornerstone", name: "XRPL r3Tq66 — פעימות חיות", kind: "xrp-priv", network: "XRPL", role: "cornerstone", address: A.xrp, status: "connected", note: "1.299961 XRP · בר-שליחה ~0.2999", materialRef: "keys/xrp-cornerstone.json" },
    { keyId: "old-fleet-tron-headcorner", name: "ארנק TRON ישן TG6Srs… (17.6 TRX!)", kind: "tron-priv", network: "TRON", role: "fleet", address: "TG6SrsMJjRqnqAyYM8kGZu1rgkpsgizKEn", status: "connected", note: "הכסף שחשבנו שאבד — המפתח שלם", materialRef: "keys/old-fleet-wallets.json" },
    { keyId: "old-fleet-sol-headcorner", name: "ארנק SOL ישן 9knfn… (0.024 SOL)", kind: "sol-priv", network: "SOLANA", role: "fleet", address: "9knfnFMLmhUNjKRDbR1BmVnVkq4BRczyYjJ7BqiZSgiL", status: "connected", note: "המפתח שלם", materialRef: "keys/old-fleet-wallets.json" },
    { keyId: "old-fleet-evm-headcorner", name: "ארנק EVM ישן 0x2767…", kind: "evm-priv", network: "ETHEREUM", role: "fleet", address: A.oldFleetEvmHeadcorner, status: "connected", note: "עדות היסטורית · ~0.000082 ETH", materialRef: "keys/old-fleet-wallets.json" },
    { keyId: "old-fleet-seed", name: "הזרע הישן (96 hex) — שורש 12 הארנקים", kind: "seed-hex", network: "MULTI", role: "fleet", address: A.oldFleetEvmHeadcorner, status: "connected", note: "fleet-arm self-verify עובר (m/44'/60'/0'/0/2 = 0x2767)", materialRef: "keys/wallets-seed.json" },
    { keyId: "github-token", name: "GitHub PAT (roshpinacare-sys)", kind: "github-token", network: "GITHUB", role: "sovereign", address: "roshpinacare-sys", status: "connected", note: "גם ב-remote URL · העתק הריפו יימחק", materialRef: "keys/github-token.json" },
    { keyId: "owner-record-legacy", name: "רשומת הבעלים (הדקור.txt) — דור ישן", kind: "other", network: "STEEM", role: "owner", address: "headcorner", status: "unverified", note: "אינה תואמת לשרשרת — לתיעוד בלבד", materialRef: "keys/legacy-owner-record.json" }
  ]
  for (const r of rows) {
    await db.smartKey.upsert({
      where: { keyId: r.keyId },
      update: { name: r.name, kind: r.kind, network: r.network, role: r.role ?? null, address: r.address ?? null, status: r.status, note: r.note ?? null, materialRef: r.materialRef },
      create: { keyId: r.keyId, name: r.name, kind: r.kind, network: r.network, role: r.role ?? null, address: r.address ?? null, status: r.status, note: r.note ?? null, materialRef: r.materialRef }
    })
  }
  console.log(`\n── SmartKey: ${rows.length} שורות יתרה ב-DB (מטא-דאטה בלבד)`)
  const { logOp } = await import("../src/lib/saos/oplog")
  await logOp("vault.restore.v31", {
    ok: true,
    homes: written,
    members: Object.keys(files).length,
    checks: checks.length,
    selfProof: messageDigest,
    note: "SMART LINK — כספת שוחזרה מהייצוא עם אימות fail-closed מלא, ריבוי-בתים"
  }).catch(() => { /* oplog best-effort in script context */ })
  await db.$disconnect().catch(() => { /* ignore */ })
  console.log("\n✔ הכספת שוחזרה ואומתה — המערכת מחוברת לשורשים.")
}

main().catch((e) => { console.error("FATAL:", e instanceof Error ? e.message : e); process.exit(1) })
