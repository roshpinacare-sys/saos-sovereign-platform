# SAOS Ecosystem — Full Git Audit Worklog

## Mission
Full audit of all 16 GitHub repos of roshpinacare-sys (EVM smart contracts, trading/options, systems & networks) with deep focus on saos-sovereign-platform.

## Environment
- Repos cloned (shallow) to /home/z/repos/
- GitHub token: /home/z/my-project/upload/pat.env (raw token file)
- User language: Hebrew (summaries in Hebrew)

---
Task ID: 2-c
Agent: Explore (wallet & multi-chain security auditor)
Task: Audit Saosmartwallet + steem (keys, signing, fleet)

Work Log:
- Read both CRITICAL docs: CRITICAL-KEY-EXPOSURE.md (steem, full forensic writeup) + CRITICAL-R11-KEY-BROADCAST.md (both repos — now G6 dedup stubs pointing to canonical anchor-baseline copy)
- Verified incident state LIVE: steem/agent/recovery-meta.json still git-tracked with keysZipPass+keysBackupPass (32 chars each, field names verified — no values printed) beside agent/vault/KEYS-BACKUP-2026-09-09.tar.enc + KEYS-ZIP-2026-09-10.zip.enc (both OpenSSL Salted__ containers, tracked); Saosmartwallet/db/custom.db (4.0MB) still tracked. fleet_keys.enc/.meta.json removed (fix #1 real, pattern search never done)
- Verified db/custom.db structurally: 248 VaultEntry rows (158 steem-key, AES-256-GCM shape encPriv/iv/tag, 0 WIF-shaped plaintext), 39 owner/39 active/40 posting/39 memo, autonomyEnabled=1, AuditEvent=0 rows vs GateAction=608 (hash-chained audit implemented but unwired)
- Audited Saosmartwallet core: packages/core crypto (Argon2id 64MiB×3, envelope AES-GCM/chacha20-poly1305 RFC8439 fallback, fresh CEK+wrap, constant-time compare, Schnorr ZK with context binding), vault.ts fail-closed session model, keys.ts seal/reveal single exit, signing orchestrator (session→policy→reveal→sign→broadcast-capability→audit)
- Audited production gate: session.ts (30d cookie secure:false + sealed master in session row), crypto.ts (module-global in-memory master), login route (paste-WIF + live chain authority proof + key-seals + auto-bootstrap deleteMany), reveal route (returns plaintext priv to operator, rate-limited), recovery-import.ts (reads plaintext key files at fixed machine paths), gateway on :81 = plain HTTP reverse proxy
- Audited per-chain signing: steem serializer (chain_id 32×00, ref-block, expiration guards ≥60s/≤7d, RFC6979 low-s), ETH adapter (ethers v6, EIP-1559, CAIP-2), SOL adapter (fresh blockhash+lastValidBlockHeight), broadcast opt-in fail-closed; bridges/router.ts honest gated rails with measured fee sources; /api/system/health honest composition, nano-exact wrapped invariant, no secrets
- Audited steem repo: sovereign/core/kernel.cjs (deterministic µ-integer state machine, canonical JSON, no tx signatures — single-operator ledger), CHAIN_SPEC v0 (wrap invariants, one-time refs, attest/seal), key-broker (localhost, timing-safe token, digest-only signing, JSONL audit), vault-lib.cjs (GCM envelope + .vaultkey beside it + plaintext mirrors), wallets.cjs/fleet_mint_v3 (seed-derived fleet, v3 random+owner anchor, identity-split v1/v2 documented), soldier_auth_audit.json (steem authorities drifted vs derived)
- CRITICAL auth finding: 61 /api/ops/* routes in steem with NO auth and no middleware — set-real-mode, daemon/restart, agent/exec, vault/master (paste secrets), reset (destructive) all unauthenticated
- Secrets sweep both repos (checksum-validated WIF, ghp_/github_pat_, PEM/AKIA/sk, 0x-64hex, mnemonic heuristics): no plaintext WIFs/tokens tracked; 0x-64hex = txids; noted /home/z/my-project/upload/pat.env exists outside repos (audit token itself)

Stage Summary:
- CRITICAL (unfixed): encrypted key archives + their passphrases committed together in steem (agent/recovery-meta.json + agent/vault/*.enc) — 2nd/3rd instances of the fleet_keys pattern; all keys in those archives must be treated as burned; rotation NOT evidenced
- CRITICAL (unfixed): Saosmartwallet/db/custom.db committed (live vault + control plane + derivation map); AuditEvent hash-chain still unwired (0 rows)
- CRITICAL: steem repo ops console (61 routes) unauthenticated incl. real-mode toggle, exec runner, secret-paste vault/master, destructive reset; gateway on :81 no TLS
- HIGH: "Sovereign Key Vault" in production is server-side custody: master in process memory + session-sealed, plaintext key files on disk expected by code, /api/gate/reveal returns private keys over the API, cookie secure:false
- HIGH: fleet = single sovereign seed (v1/v2) → one seed = whole army; headcorner owner key anchors all soldiers (threshold 1); steem soldier authorities drifted
- MEDIUM: 117o key-loss incident properly forensicated (docs/117o-KEY-INCIDENT.md) — keys rotated on-chain 2026-09-08 and never persisted; hardened via keyrotate write-block; residual: recover_account window depends on old+new owner keys
- GOOD: packages/core crypto/vault engine is genuinely solid (Argon2id, envelope AEAD, volatile session key, fail-closed policy); steem client-side signing (sign.ts) browser-only + verify_authority pre-check; key-broker digest-only localhost signing; /api/system/health honest
- Code quality: Saosmartwallet 7/10 (core 9, gate/prod posture 5) · steem 5/10 (kernel/spec 8, ops auth 1, secrets hygiene 3)
- Top recs: (1) rotate every key covered by the two .enc archives + revoke org-scoped PAT; (2) purge recovery-meta.json/vault archives/custom.db from git + history; (3) add auth middleware to all /api/ops/*; (4) TLS on the gateway, secure cookies; (5) wire AuditEvent; (6) move passphrases out of repo permanently, kill the "repo holder trusted by definition" doctrine (117i)
---
Task ID: 2-b
Agent: Explore (EVM notary & DeFi auditor)
Task: Audit saos-jummper, Defi, Sdk, saos-sovereign-foundry

Work Log:
- Read /home/z/my-project/worklog.md for context; mapped all 4 repos with LS/Glob
- saos-jummper: read README.md + .env.example + pyproject + core source (anchor.py, merkle.py, batch.py, canonical.py, claim.py, graphene.py, authority.py, packing.py, protocol.py, witness.py, solana.py, crosschain.py, budget.py, pipeline.py, ghwrite.py, signingcontract.py head, key-incident docs)
- Verified key-management claim by grep across src/: no key-loading, no WIF/privateKey/mnemonic handling — signing is external-only by design
- Ran test suite: PYTHONPATH=src python3 -m unittest discover → 673 tests OK; ran scripts/harden-check.py → GATE PASSED
- Searched all 4 repos + neighbors for *.sol: 0 in these repos (12 .sol exist in saos-sovereign-platform — out of scope, flagged to 2-a)
- Defi: read DOCTRINE.md, MISSION-1000.md, TRIGGER-CHAIN.md, charter/CONTRACT.md, registry.json, anchors.json, trigger-chain.json, events.jsonl, README, PHASE-0-KEY-HYGIENE.md, phase0-kit scripts (rotate-fresh.cjs, sweep-history.sh), .github/workflows (canary, gitleaks)
- Sdk: full inventory — docs/reports/broadcasts only (66 files, ~82KB), sdk-verify.yml just verifies docs exist; zero executable code
- saos-sovereign-foundry: package.json, .env.example, .gitignore, modes.ts, signer.ts, owner-keys route, external-signer/index.ts (1,710 lines: envelope, authority gates, idempotency single-flight, sync broadcast txid cross-check, RC feasibility gate), key-broker/index.ts, ci.yml, docs/KEYS-* and evidence docs
- Secrets sweep on all 4 repos: 0x-64hex, WIF (5HJK/L/K base58), 12/24-word mnemonics, ghp_/github_pat_, Infura/Alchemy/Etherscan/AWS patterns → NO committed secret values; all 0x-64hex hits are public txids/roots/entryHashes
- Verified EVM_ANCHOR_PK exists only as GitHub Actions secret reference in Domain repo (per Defi/fleet/CLAIMS.md), not committed anywhere

Stage Summary:
- saos-jummper: REAL code, excellent quality. 673 tests green. Key mgmt: external-signer-only, zero key material in repo (verified). Gas model exact-matches mainnet wei (EIP-2028+7623). Fail-closed budget/repeat guards, hardening gate passes. Gaps: in-memory persistence only (Phase 3), no RPC retry/failover implementation (node lists are constants), minor docstring drift (merkle "duplicated" vs carry-up). Score 8.5/10
- saos-sovereign-foundry: REAL Next.js system + signing mini-services. Strong: 3-flag live protection, keyless system-side, verify-then-write key ingest, requestId idempotency/single-flight, sync-broadcast txid cross-check, hard amount caps, timing-safe auth, log redaction. HIGH(design): vault passphrase stored in fleet_keys.meta.json ADJACENT to fleet_keys.enc (H-08-class; envelope is obfuscation vs filesystem reader) — external-signer/index.ts openSeal + embedded FLEET_VAULT_SCRIPT. MEDIUM: EVM_ANCHOR_PK hot key in Domain CI signs hourly. LOW: ci.yml malformed branch filter "branches: ain]"; WIF forwarded over HTTP to configurable SAOS_SIGNER_URL. Score 7/10
- Defi: docs + registry canon (charter/registry.json, anchors.json, trigger-chain.json, events.jsonl) — no executable product; engine lives in "Zip" repo. Honest doctrine; documents severe historic key exposures (burned mnemonics/WIF archives in OTHER repos' git history) with a real operator rotation kit. Score 6/10 (as docs-canon), no secrets committed
- Sdk: empty docs shell (66 files, no code), CI only checks docs presence. Score 3/10
- Secrets: NONE committed in any of the 4 repos (values); path references and public keys/hashes only. Historical estate-wide exposure documented in Defi/fleet/PHASE-0-KEY-HYGIENE.md — rotation pending (operator action)
---
Task ID: 2-d
Agent: Explore (systems & operations auditor)
Task: Audit Zip, Console, Domain, control-center + doc repos

Work Log:
- ניתוח Zip (weave-core): נבדקו src/lib/weave/ (chain.ts, ledger.ts, evm.ts, market-canon.ts, graphene.ts), scripts/ (weave-beat, weave-gate, weave-anchor-zero), SOVEREIGNTY.md, TRUTH-AUDIT.md, VERIFY.md, worklog.md.
- מדידה עצמאית: הרצת scripts/weave-verify-book.ts על sovereign/ledger.json → 916/916 חתימות EIP-191 תקינות, שרשרת תקינה, ספר שוק 37/37. מבחן-טמפר על עותק (שינוי תו אחד ב-evidence של seq 6) → VERDICT ✗ עם מיקום מדויק — fail-closed אומת בפועל.
- חיפוש מנגנון-קונצנזוס (consensus/validator/BFT/PoS) → לא קיים בקוד; המודל הוא single-writer hash-chain + עיגון חוץ (Steem/Hive custom_json posting, Zero Network chainId 9369 gas-0, EIP-712 על chainId 31337 devnet).
- Console/Domain: קריאת gate-crypto.js (secp256k1+RIPEMD160+base58check טהור, posting-only), acid-engine.js (מכונת מחסנית דטרמיניסטית), wallet.html (keystore מוצפן, WIF נמחק אחרי שימוש), סריקת innerHTML/esc בכל ה-HTML, בדיקת CDN (אפס), diff בין Console↔Domain.
- saos-control-center: זוהה כ-Sovereign Foundry v2 (מגדלי עיגון, TRON energize, mini-services dex-daemon/watchdog/revenue-governor עם נתיבי-sandbox קשיחים).
- ריפואי-דוק: תפקידים, CLAIMS-AUDIT של Adsmarket, CRITICAL-R11-KEY-BROADCAST, בדיקת md5 של SAOS-PULSE חוצי-ריפואים (כל העותקים הוחלפו במצבתות-G6 עם "sha256: undefined").
- git remotes + דפוסי קומיטים: כל הריפואים roshpinacare-sys/*; קומיטים בוטיים (claims-guard/archive-keeper/agent-verify PASS) — שכפול מתוכנן-מכונה, לא העתקה ידנית.
- סריקת סודות בכל 8 הריפואים: אפס PAT/AWS/PEM/sk- בעץ החי; 2 מחרוזות WIF ב-Zip/scripts (fixtures מוצהרים); אין .env בגיט. ריפואים shallow (depth=1) — אין אפשרות לאמת היסטוריה.

Stage Summary:
- גבוה (HIGH): (1) מסמך R11 (anchor-baseline/CRITICAL-R11-KEY-BROADCAST.md) מתעד שכספת-סודות+passphrase נדחפו ל-8 ריפואים ב-2026-09-12 — העץ החי נקי, אך נדרש ניקוי-היסטוריה מלא + רוטציה; (2) אין קונצנזוס — "רשת" היא שרשרת-חותם-יחיד; טרמינולוגיה מנופחת מול קוד; (3) סוד HEADCORNER (מפתח-מפעיל) ב-Actions Secrets של ריפו ציבורי (Console/Domain key-verify.yml:42).
- בינוני (MEDIUM): סטיית-עותקים Console↔Domain (index.html, saos-live.js, gate.html שונים); מצבתות-G6 עם metadata "undefined"; Project-files מכיל ~65MB zips בגיט; נתיבי /home/z/my-project קשיחים ב-mini-services; devKeyHex של סוכנים ב-DB (DEVNET מוצהר).
- נמוך (LOW): fixtures WIF ב-scripts (lab-broadcast-rejection.cjs:11, web-probe.ts:27); noImplicitAny=false; מודולי-ענק (sovereign-exchange.ts 106KB); ספר-Console מפגר 3 רשומות מאחורי Zip.
- חיובי: הליבה הקריפטוגרפית אמיתית ואומתה-מחדש ע"י הבודק; אפס-CDN ב-SPA; esc() עקבי; gitleaks ב-CI; תרבות תיעוד-טענות עם תיקון-עצמי חריג (TRUTH-AUDIT/CLAIMS-AUDIT).
- ציונים: קריפטו-ליבה Zip 8/10 · אבטחת Console/Domain 7.5/10 · היגיינת-ריפואים 5/10 · יושרת-תיעוד 8.5/10.
---
Task ID: 2-a
Agent: Explore (DEX trading systems auditor)
Task: Security & correctness audit of saos-dex

Work Log:
- Read README.md, ARCHITECTURE_ROADMAP.md, LIQUIDITY_STRATEGY.md, STATUS.md, audit-package/README.md + AUDIT_SCOPE.md (13 formal invariants I1–I13)
- Located core engine: heritage files saos-dex.ts / grid98.cjs / kernel.cjs are NOT in this repo — successors are src/lib/dex/{kernel,book,amm,mm,chain,canonical,canonical,invariant}.ts
- Deep-read kernel.ts (1,997 ln): GAS table, applyOp 40+ ops, escrow locking, genesis, wrap, vault/CDP, save, lend (Aave-style), launchpad, CoW, oracle_set glide, DCA/triggers
- Deep-read book.ts (matchBook: maker-price fills, escrow telescoping lock release, self-trade skip, formal invariants), amm.ts (x·y=k, 30bps split 70/30, dynamic fee EWMA, k-preservation check), canonical.ts (strict integers, RFC-6962-style merkle with domain tags — CVE-2012-2459 fixed), invariant.ts (fail-fast → HALT)
- Read chain.ts (buildBlock, seal() with 4 fail-closed assertions, ledgerAudit-at-seal, snapshot load with DB stateRoot corroboration, drift declaration, POL retro-mint, mempool free-op-cap), mm.ts (arena grid MM, pegkeeper, fuel economy, rearm caps in state), triggers.ts (DCA/trig keeperless execution), cow.ts (uniform clearing price, self-overlap neutralization, clamped allocation)
- Read settle.ts ledger audit (3 iron identities), skimmed relay.ts (env-memory keys, fenced fetch, verifyOnChain read-back), fence.ts (host pinning + redirect:"error" SSRF guard), master-key.ts, operator-auth.ts (timing-safe, fail-closed 503)
- Mapped auth on all 43 API routes: every mutating POST has operatorAuth+consoleGuard; GETs intentionally public; bench operator-gated after DoS fix
- Searched repo for secrets: .env.example placeholders only; .env/.secrets/upload gitignored (verified via git check-ignore); regex scan of tracked files found only public txids/signatures/hashes — no private keys/mnemonics/seeds in tracked tree. NOTE: shallow clone (depth=1) → full-history scan not possible; file docs/archive/CRITICAL-R11-KEY-BROADCAST.md is now a pointer stub ("content lives in git history") → recommend gitleaks on full clone
- Verified options/derivatives surface: NO true options/futures/perps — closest instruments are CDP vault, Aave-like money market, trigger orders (TP/SL), DCA, ve/bonds, launchpad bonding curve
- Checked determinism hygiene: zero Math.random in consensus paths (jitter only in relay backoff), zero TODO/FIXME, 1 stray console.log (bridge.ts:717); no unit/regression test suite (only tsc + ad-hoc selftest scripts)

Stage Summary:
- [HIGH] Single god-token authorization: one static DEX_OPERATOR_TOKEN (+ optional master-key file) controls ALL mutations; transfer route lets operator spend ANY account (issuer=from, src/app/api/dex/transfer/route.ts:40), reset/WIPE the chain, mint external-backed wraps. No per-account signatures; token in browser localStorage (src/app/page.tsx:2037) → XSS = total compromise; no rate-limit/lockout on auth endpoint. Acceptable for SIM, blocking for L3 real liquidity
- [MEDIUM] kernel wrap_mint external (kernel.ts:1396-1425) trusts claim dedupe only — RPC proof verification lives in caller (door route/peg-door.ts), not in kernel; kernel can mint unbacked W-assets if any caller path misbehaves
- [MEDIUM] Replay-after-restart window: nonce dedupe Set is process-memory; after restart only last ~6,000 nonces rebuilt → pre-restart gas-0 ops (xfer_free/relay/refuel) replayable (kernel.ts:466-490, disclosed in code)
- [MEDIUM] Oracle glide (≤25%/60s on >10% gap, kernel.ts:1477-1480) feeds refPrice used by vault/lend liquidations — no circuit breaker on oracle jumps; feed-median compromise → liquidation cascade in ~2-3 ticks
- [MEDIUM] lend_repay with zero suppliers parks interest in pot unclaimed (kernel.ts:1879-1895) breaking pot==Σclaims display invariant; borrow possible with zero suppliers when pot holds cash (kernel.ts:1811-1813)
- [LOW] Public compute DoS: long-poll /state 12s loops + GET /showcase (60s, runs 3 genesis replays/request) ungated/unthrottled
- [LOW] poolSwap k-preservation uses rIn*rOut products above 2^53 (amm.ts:106-108) — imprecise but deterministic; launch_buy raise-cap checks gross not net (kernel.ts:990); account-name length uncapped in kernel `to` (routes cap it); 1 console.log leftover (bridge.ts:717)
- Trading-correctness: order book is genuinely well-built — price-time priority, exact maker-price fills, crossing-at-placement, self-trade skip, precise escrow (lockMu + dust reconciliation), gas-before-mutation, fail-fast invariants, cancel owner-only; CoW uniform clearing with self-overlap neutralization and clamped allocation; batch atomicity with self-enrichment check. Main structural caveat: ~all flow is operator-owned agents (arena/soldiers/bots) — price discovery is synthetic; determinism caveat journal.t=nowMs disclosed as tech debt
- Engineering maturity: 7/10 — exceptional self-audit culture (13 invariants, forensic HALT reasons, honesty clauses), strong crypto hygiene (domain-separated merkle, canonical integers, SSRF fence, timing-safe auth), but zero automated regression tests, single-operator trust model, no per-account authz
- Top recommendations: 1) Signer/Executor + per-account signatures before real liquidity; 2) move deposit verification INTO kernel (proof-of-deposit op) or add on-chain-claim re-verification; 3) oracle circuit breaker on liquidation path; 4) gitleaks/trufflehog on full git history + rotate if R11 key doc leaked material; 5) regression test suite for matchBook/amm/kernel + restart-replay persistence

---
Task ID: 3
Agent: Main auditor (EVM smart contract & trading systems architect)
Task: Deep-dive audit of saos-sovereign-platform (12 Solidity contracts + Next.js backend + Python edge engine + key management)

Work Log:
- Read all 12 Solidity contracts (SAOSRelay, MeshHub, MeshRelay, Identity, Ledger, Solutions, Bridge, WorkBoard, Microgrid, Exchange, ValueEngine, MeshTypes)
- Reviewed relay-contract.ts (9 EVM chains deployment/anchoring), anchor-evm.ts (cornerstone derivation), vault-seal.ts (AES-256-GCM vault), cornerstone-derive.ts
- Enumerated all 76 API routes: found 48/51 POST endpoints with ZERO auth
- Discovered vault passphrase stored adjacent to ciphertext (fleet_keys.meta.json `pass` field) — same H-08 pattern as foundry
- Reviewed Python irrigation engine (1,201 lines, deterministic selftest 12/12, twin parity) and edge_runner.py
- Verified .gitignore key protection, CI workflow (platform-selftest.yml only — no Solidity tests)
- Secrets sweep: only public txids and compiled bytecode artifacts — no private keys in working tree (shallow clone depth=1, history NOT audited)

Stage Summary:
- CRITICAL: 48/51 POST API routes unauthenticated (mint/broadcast/anchor/vault/physical-move) behind Caddy :81 without TLS
- CRITICAL: vault passphrase adjacent to ciphertext (AES-256-GCM decorative)
- HIGH: SAOSWorkBoard._oldestOpen() linear scan in mandatory relay link = gas exhaustion → mesh liveness brick at scale
- HIGH: Microgrid PnL is virtual accounting (no token flow on fills); sweep capped by real balance (honest but "trading" is a demonstrator)
- HIGH: Zero Solidity tests (no foundry/hardhat); single-owner trust model everywhere
- MEDIUM: unbounded storage growth (runs/orders/solutions), Ledger.transfer missing zero-address check, setPayroll re-settable despite "one-time" comment
- POSITIVE: SAOSRelay immutability textbook; MINT_CAP fail-closed; two-step ownership; depositSaos race fix (approve/transferFrom); honest gates in relay-contract.ts (balance ×2, endpoint allowlist, event-parse inclusion proof); deterministic edge engine with parity testing
- Scores: Solidity 6.5/10 · Backend 4/10 · Keys 3/10 · Architecture 7/10
