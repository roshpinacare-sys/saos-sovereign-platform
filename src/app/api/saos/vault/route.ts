import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appendChainedReceipt } from "@/lib/chained-receipt";
import {
  isKnownNetwork,
  isValidPublicAddress,
  manifestSlotFor,
  VAULT_MANIFEST,
  vaultFingerprint
} from "@/lib/saos/broadcast";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/vault — vault readiness registry (public addresses only).
 * POST /api/saos/vault — register a public watch address for a network+slot.
 * Honesty: registering an address is NOT a signing key. keyState stays "missing"
 * until stage 2 (offline AES vault keys return). Every registration is receipted.
 */

export async function GET() {
  try {
    const rows = await db.vaultSlot.findMany({ orderBy: [{ network: "asc" }, { slot: "asc" }] });
    const byKey = new Map(rows.map((r) => [`${r.network}:${r.slot}`, r]));
    const slots = VAULT_MANIFEST.map((m) => {
      const row = byKey.get(`${m.network}:${m.slot}`);
      return {
        network: m.network,
        slot: m.slot,
        purpose: m.purpose,
        address: row?.address ?? null,
        fingerprint: row?.fingerprint ?? null,
        keyState: row?.keyState ?? "missing",
        updatedAt: row?.updatedAt?.toISOString() ?? null
      };
    });
    const registered = slots.filter((s) => s.address !== null).length;
    return NextResponse.json({
      ok: true,
      slots,
      stats: { total: slots.length, registered },
      productionAuthority: "NONE"
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "vault failed" },
      { status: 200 } // errors are data — never a 500
    );
  }
}

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json().catch(() => ({}));
    const obj = (typeof body === "object" && body !== null ? body : {}) as {
      network?: unknown;
      slot?: unknown;
      address?: unknown;
    };

    const network = obj.network;
    if (!isKnownNetwork(network)) {
      return NextResponse.json(
        { ok: false, error: "רשת לא נתמכת — STEEM/BLURT/HIVE/TRON" },
        { status: 200 }
      );
    }

    const slot = manifestSlotFor(network, obj.slot);
    if (!slot) {
      return NextResponse.json(
        { ok: false, error: "חריץ לא קיים במניפסט הכספת לרשת זו" },
        { status: 200 }
      );
    }

    const address = typeof obj.address === "string" ? obj.address.trim() : "";
    if (address.length === 0 || address.length > 40) {
      return NextResponse.json({ ok: false, error: "כתובת נדרשת (עד 40 תווים)" }, { status: 200 });
    }
    if (!isValidPublicAddress(network, address)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            network === "TRON"
              ? "כתובת TRON תקינה: T ואחריה 34 תווי Base58"
              : "חשבון Graphene תקין: 3–16 תווים, אותיות קטנות/ספרות/נקודה/מקף"
        },
        { status: 200 }
      );
    }

    const fingerprint = await vaultFingerprint(network, slot, address);
    const row = await db.vaultSlot.upsert({
      where: { network_slot: { network, slot } },
      create: { network, slot, address, fingerprint, keyState: "missing" },
      update: { address, fingerprint, keyState: "missing" }
    });

    const receipt = await appendChainedReceipt(
      "vault-register",
      { network, slot, address, fingerprint }
    );
    await db.opLog.create({
      data: { op: "vault-register", detail: `${network}/${slot}=${address}` }
    });

    return NextResponse.json({
      ok: true,
      slot: {
        network: row.network,
        slot: row.slot,
        address: row.address,
        fingerprint: row.fingerprint,
        keyState: row.keyState
      },
      receipt: receipt.digest
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "vault-register failed" },
      { status: 200 }
    );
  }
}
