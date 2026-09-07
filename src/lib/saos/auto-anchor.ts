/**
 * lib/saos/auto-anchor.ts — AUTO-ANCHOR: every new seal gets anchored (v9).
 * =====================================================================
 * The roadmap line "פעימה אוטומטית בכל איטום חדש" made real. Until v8 the
 * live STEEM pulse required a human to press the button. From v9 the
 * platform anchors every fresh seal AUTOMATICALLY — same discipline as
 * the manual pulse, one shared code path:
 *
 *   seal POST → after(response) → fireAutoAnchorForNewSeal()
 *     → setting check (default ON, togglable from the console)
 *     → dedupe (one live anchor per seal — forever)
 *     → vault gate (STEEM slot must be sealed)
 *     → fail-closed self-verify → broadcast → inclusion proof
 *     → AnchorTx row + chained receipt + oplog — הוכחה או לא קרה
 *
 * The manual route (/api/saos/broadcast/live POST) and this module call
 * THE SAME fireLiveAnchorOnSteem() — there is exactly one discipline,
 * whether the pulse is human-pressed or platform-fired.
 *
 * Additive module — the canonical kernel modules are untouched.
 */

import { db } from "@/lib/db";
import { appendChainedReceipt } from "@/lib/chained-receipt";
import { anchorSealLiveOnSteem, explorerLink, type LiveSeal } from "./anchor-live";

const AUTO_ANCHOR_KEY = "autoAnchor";

export type AutoAnchorSource = "manual" | "auto";

export interface FireResult {
  ok: boolean;
  skipped?: string; // honest skip reason (dedupe / setting / gate)
  already?: boolean;
  height?: number;
  account?: string;
  txid?: string | null;
  block?: number | null;
  confirmedByHistory?: boolean;
  explorer?: string | null;
  anchorId?: string;
  receipt?: string;
  error?: string;
}

// ─── settings (PlatformSetting — control-plane, never secrets) ────────────

export async function getAutoAnchorEnabled(): Promise<boolean> {
  try {
    const row = await db.platformSetting.findUnique({ where: { key: AUTO_ANCHOR_KEY } });
    if (!row) return true; // default ON — the roadmap's whole point
    return row.value === "1";
  } catch {
    return true; // fail-open on the CONTROL plane only; the pulse itself
    // still dedupes + gates + self-verifies before anything is signed
  }
}

export async function setAutoAnchorEnabled(enabled: boolean): Promise<boolean> {
  await db.platformSetting.upsert({
    where: { key: AUTO_ANCHOR_KEY },
    update: { value: enabled ? "1" : "0" },
    create: { key: AUTO_ANCHOR_KEY, value: enabled ? "1" : "0" }
  });
  return enabled;
}

// ─── the ONE discipline: fire + record (manual & auto both land here) ──────

/**
 * Fires a live STEEM anchor for the given seal and records EVERYTHING —
 * success and failure alike. Returns a FireResult; never throws.
 */
export async function fireLiveAnchorOnSteem(
  seal: { id: string; height: number; root: string; stateRoot: string; leavesCount: number; gasUsed: number },
  source: AutoAnchorSource
): Promise<FireResult> {
  // dedupe — one live anchor per seal height, forever
  const existing = await db.anchorTx.findFirst({
    where: { kind: "weave", network: "STEEM", sealId: seal.id, txid: { not: null } },
    orderBy: { createdAt: "desc" }
  });
  if (existing) {
    return {
      ok: true,
      skipped: "dedupe",
      already: true,
      height: seal.height,
      txid: existing.txid,
      explorer: existing.txid ? explorerLink(existing.txid) : null
    };
  }

  // gate — the vault must be sealed for STEEM (the signing identity)
  const slot = await db.vaultSlot.findFirst({ where: { network: "STEEM", keyState: "sealed" } });
  if (!slot) {
    return { ok: false, skipped: "vault-gate", error: "כספת STEEM לא נאטמה — הפעימה לא ירתה (כנות)" };
  }

  const liveSeal: LiveSeal = {
    height: seal.height,
    root: seal.root,
    stateRoot: seal.stateRoot,
    leaves: seal.leavesCount,
    gasUsed: seal.gasUsed
  };

  try {
    const outcome = await anchorSealLiveOnSteem(liveSeal);
    const row = await db.anchorTx.create({
      data: {
        sealId: seal.id,
        network: "STEEM",
        kind: "weave",
        txid: outcome.txid, // from the chain node — never fabricated
        status: outcome.confirmedByHistory ? "anchored" : "broadcast",
        gate: null,
        meta: JSON.stringify({
          live: true,
          source,
          payload: outcome.payload,
          account: outcome.account,
          authority: outcome.authority,
          block: outcome.block,
          confirmedByHistory: outcome.confirmedByHistory,
          selfVerified: outcome.selfVerified,
          explorer: outcome.explorer,
          at: outcome.at
        })
      }
    });
    const receipt = await appendChainedReceipt(
      "anchor-live-steem",
      {
        height: outcome.height,
        root: outcome.root,
        txid: outcome.txid,
        block: outcome.block,
        confirmedByHistory: outcome.confirmedByHistory,
        source,
        anchorRowId: row.id
      },
      { sealId: seal.id }
    );
    await db.opLog.create({
      data: {
        op: source === "auto" ? "anchor-auto-steem" : "anchor-live-steem",
        detail: `height=${outcome.height} txid=${outcome.txid ?? "—"} confirmed=${outcome.confirmedByHistory}`
      }
    });
    return {
      ok: true,
      height: outcome.height,
      account: outcome.account,
      txid: outcome.txid,
      block: outcome.block,
      confirmedByHistory: outcome.confirmedByHistory,
      explorer: outcome.explorer,
      anchorId: row.id,
      receipt: receipt.digest
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "live broadcast failed";
    // a failed pulse is still evidence — recorded honestly, txid never faked
    const row = await db.anchorTx.create({
      data: {
        sealId: seal.id,
        network: "STEEM",
        kind: "weave",
        txid: null,
        status: "failed",
        gate: msg.slice(0, 200),
        meta: JSON.stringify({
          live: true,
          source,
          attemptedAt: new Date().toISOString(),
          height: seal.height,
          root: seal.root,
          error: msg.slice(0, 300)
        })
      }
    });
    const receipt = await appendChainedReceipt(
      "anchor-live-steem-failed",
      { height: seal.height, root: seal.root, source, error: msg.slice(0, 200), anchorRowId: row.id },
      { sealId: seal.id }
    );
    await db.opLog.create({
      data: {
        op: source === "auto" ? "anchor-auto-failed" : "anchor-live-failed",
        detail: `height=${seal.height} ${msg.slice(0, 120)}`
      }
    });
    return { ok: false, error: msg, anchorId: row.id, receipt: receipt.digest };
  }
}

/**
 * The auto pulse for a FRESH seal — called after the seal response is sent
 * (Next `after()`). Checks the setting, then fires the same discipline.
 * Never throws; failures are recorded as evidence and returned as data.
 */
export async function fireAutoAnchorForNewSeal(sealId: string): Promise<FireResult> {
  const enabled = await getAutoAnchorEnabled();
  if (!enabled) {
    return { ok: false, skipped: "setting-off", error: "פעימה אוטומטית כבויה — החותם ממתין ללחיצת אדם (כנות)" };
  }
  const seal = await db.sealRecord.findUnique({
    where: { id: sealId },
    select: { id: true, height: true, root: true, stateRoot: true, leavesCount: true, gasUsed: true }
  });
  if (!seal) {
    return { ok: false, skipped: "seal-missing", error: "החותם לא נמצא" };
  }
  return fireLiveAnchorOnSteem(seal, "auto");
}
