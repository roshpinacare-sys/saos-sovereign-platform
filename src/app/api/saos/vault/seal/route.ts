import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appendChainedReceipt } from "@/lib/chained-receipt";
import {
  isKnownNetwork,
  manifestSlotFor,
  vaultFingerprint,
  VAULT_MANIFEST
} from "@/lib/saos/broadcast";
import { readSealInventory, sealExists, stage2Assignments } from "@/lib/vault-seal";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/vault/seal — STAGE 2 seal status + PUBLIC inventory.
 *   Sealed vault (SAOS-FLEET-VAULT-1, AES-256-GCM) existence, GCM
 *   verification, agent account, fleet usernames, watch addresses.
 *   ZERO private material — WIFs/mnemonics/seeds never leave the envelope.
 *
 * POST /api/saos/vault/seal — CONNECT STAGE 2:
 *   opens the seal server-side, verifies the GCM tag, maps the seal's
 *   public identities onto the vault manifest (STEEM/BLURT/HIVE → agent
 *   account; TRON vault-1..6 → wallets-registry watch addresses),
 *   registers every slot with a fingerprint, marks keyState="sealed"
 *   and chains a receipt. Errors are data — never a 500.
 */

export async function GET() {
  try {
    const exists = await sealExists();
    if (!exists) {
      return NextResponse.json({
        ok: true,
        stage2Ready: false,
        seal: null,
        assignments: [],
        stats: { manifestSlots: VAULT_MANIFEST.length }
      });
    }
    const inv = await readSealInventory(); // throws on tamper → catch below
    const assignments = stage2Assignments(inv);
    const registered = await db.vaultSlot.findMany({
      where: { keyState: "sealed" },
      select: { network: true, slot: true, address: true, fingerprint: true, updatedAt: true }
    });
    return NextResponse.json({
      ok: true,
      stage2Ready: true,
      seal: inv,
      assignments,
      connected: registered.map((r) => ({
        network: r.network,
        slot: r.slot,
        address: r.address,
        fingerprint: r.fingerprint,
        updatedAt: r.updatedAt?.toISOString() ?? null
      })),
      stats: {
        manifestSlots: VAULT_MANIFEST.length,
        assignments: assignments.length,
        fleetAccounts: inv.fleet.length,
        tronAddresses: inv.wallets.filter((w) => w.tron).length
      }
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        stage2Ready: false,
        error: `איטום הכספת נכשל באימות — ${e instanceof Error ? e.message : "שגיאה לא ידועה"} (fail-closed: אין אמון כברירת-מחדל)`
      },
      { status: 200 } // errors are data — never a 500
    );
  }
}

export async function POST() {
  try {
    // 1 — open the seal (GCM verify). Fail-closed: any tamper aborts.
    const inv = await readSealInventory();
    const assignments = stage2Assignments(inv);
    if (assignments.length === 0) {
      return NextResponse.json(
        { ok: false, error: "האיטום אומת אך לא נמצאו זהויות לרישום (חשבון-סוכן/כתובות חסרים)" },
        { status: 200 }
      );
    }

    // 2 — validate every assignment against the manifest + address rules
    const valid: Array<{ network: string; slot: string; address: string; source: string; fingerprint: string }> = [];
    for (const a of assignments) {
      if (!isKnownNetwork(a.network)) continue;
      if (manifestSlotFor(a.network, a.slot) === null) continue;
      // address validity (reuse the public address validator)
      const ok =
        a.network === "TRON"
          ? /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a.address)
          : /^[a-z][a-z0-9.-]{2,15}$/.test(a.address);
      if (!ok) continue;
      const fingerprint = await vaultFingerprint(a.network, a.slot, a.address);
      valid.push({ ...a, fingerprint });
    }
    if (valid.length === 0) {
      return NextResponse.json(
        { ok: false, error: "אף מיפוי לא עבר ולידציה — האיטום נפתח אך הכתובות אינן תקינות" },
        { status: 200 }
      );
    }

    // 3 — register slots (keyState=sealed: signing keys return WITH the seal)
    const registered: Array<{ network: string; slot: string; address: string; fingerprint: string; changed: boolean }> = [];
    for (const v of valid) {
      const before = await db.vaultSlot.findUnique({
        where: { network_slot: { network: v.network, slot: v.slot } },
        select: { address: true, fingerprint: true }
      });
      const row = await db.vaultSlot.upsert({
        where: { network_slot: { network: v.network, slot: v.slot } },
        create: {
          network: v.network,
          slot: v.slot,
          address: v.address,
          fingerprint: v.fingerprint,
          keyState: "sealed"
        },
        update: {
          address: v.address,
          fingerprint: v.fingerprint,
          keyState: "sealed"
        }
      });
      registered.push({
        network: row.network,
        slot: row.slot,
        address: row.address,
        fingerprint: row.fingerprint,
        changed: !(before?.fingerprint === row.fingerprint)
      });
    }

    // 4 — receipt + oplog (stage-2 connect is itself an audited event)
    const receipt = await appendChainedReceipt(
      "vault-stage2",
      {
        sealFormat: inv.format,
        sealedAt: inv.sealedAt,
        agentAccount: inv.agent.account,
        fleetAccounts: inv.fleet.length,
        tronAddresses: inv.wallets.filter((w) => w.tron).length,
        registered: registered.map((r) => `${r.network}/${r.slot}`)
      }
    );
    await db.opLog.create({
      data: {
        op: "vault-stage2",
        detail: `seal=${inv.format} agent=${inv.agent.account} slots=${registered.length}`
      }
    });

    return NextResponse.json({
      ok: true,
      connected: true,
      seal: {
        format: inv.format,
        sealedAt: inv.sealedAt,
        files: inv.files,
        agent: inv.agent.account,
        fleet: inv.fleet.length,
        tron: inv.wallets.filter((w) => w.tron).length
      },
      registered,
      receipt: receipt.digest
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: `חיבור שלב 2 נכשל — ${e instanceof Error ? e.message : "שגיאה לא ידועה"} (fail-closed: שום דבר לא נרשם)`
      },
      { status: 200 }
    );
  }
}
