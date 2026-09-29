import { NextResponse } from "next/server";
import {
  importKey,
  removeKey,
  smartVaultStatus,
  verifyAll,
  verifyKey,
  exportVaultMembers
} from "@/lib/saos/smartvault";

export const dynamic = "force-dynamic";

/**
 * /api/saos/smartvault — v31 SMART LINK (החיבור החכם).
 * GET  — multi-home vault health + key inventory + agents summary
 * POST — {op:"import", name, blob, network?, role?, note?}
 *      | {op:"verify", keyId?}      (all keys when absent)
 *      | {op:"remove", keyId}
 *      | {op:"export"}              (owner one-time material surface — never persisted)
 */

export async function GET() {
  try {
    const status = await smartVaultStatus();
    return NextResponse.json(status);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "שגיאת כספת-חכמה" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      op?: string;
      name?: string;
      blob?: string;
      network?: string;
      role?: string;
      note?: string;
      keyId?: string;
    };
    switch (body.op) {
      case "import": {
        if (!body.name || !body.blob) {
          return NextResponse.json({ ok: false, error: "name + blob נדרשים" }, { status: 400 });
        }
        const res = await importKey({
          name: body.name,
          blob: body.blob,
          network: body.network,
          role: body.role,
          note: body.note
        });
        return NextResponse.json(res, { status: res.ok ? 200 : 400 });
      }
      case "verify": {
        if (body.keyId) {
          const out = await verifyKey(body.keyId);
          return NextResponse.json({ ok: out.ok, result: out });
        }
        const results = await verifyAll();
        return NextResponse.json({
          ok: true,
          results,
          summary: {
            total: results.length,
            ok: results.filter((r) => r.ok).length,
            current: results.filter((r) => r.status === "current").length,
            connected: results.filter((r) => r.status === "connected").length,
            legacy: results.filter((r) => r.status === "legacy").length
          }
        });
      }
      case "remove": {
        if (!body.keyId) return NextResponse.json({ ok: false, error: "keyId נדרש" }, { status: 400 });
        const res = await removeKey(body.keyId);
        return NextResponse.json(res, { status: res.ok ? 200 : 404 });
      }
      case "export": {
        try {
          const members = await exportVaultMembers();
          return NextResponse.json({
            ok: true,
            members,
            note: "ייצוא בעלים — חד-פעמי בתצוגה; לעולם לא נכתב לדיסק או לריפו. העתק ושמור במקום בטוח."
          });
        } catch (e) {
          return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "ייצוא נכשל" }, { status: 400 });
        }
      }
      default:
        return NextResponse.json({ ok: false, error: "op לא מוכר (import|verify|remove|export)" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "שגיאת smartvault" },
      { status: 500 }
    );
  }
}
