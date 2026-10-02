import { NextResponse } from "next/server";
import { requireAuth, audit } from "@/lib/saos/auth";
import { logOp } from "@/lib/saos/oplog";
import {
  listBroadcastQueue,
  queueItemBody,
  requestPublishRetry,
  autoPublishGitRail
} from "@/lib/saos/broadcast-queue";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/broadcast/queue          — תור-הפרסום: רשימה + ספירות + שער-החתימה החי
 * GET /api/saos/broadcast/queue?full=1   — אותו דבר + גוף-הטקסט המלא (publish-ready) לכל פריט
 * POST /api/saos/broadcast/queue         — מפעיל-בלבד (fail-closed): סימון publish-retry לפריט
 *
 * חוזה-הכנות:
 *   - התור אפנד-אונלי על OpLog (op="broadcast-queue") — אפס מודלים חדשים
 *   - הגוף חי בקובץ broadcasts/<bodyRef> (הערוץ המוסדי) — הפנקס נושא sha256 לשלמות
 *   - השער נמדד חי: כספת אטומה = gate "vault-sealed" — ואז שום דרך לא יורה לרשת חוץ
 *   - POST אף פעם לא מפרסם בעצמו: הוא מסמן armed/retry; הירי יקרה במסילת-החתימה
 *     רק כשהכספת חומשה, וירשום txid מהצומת בלבד (לעולם לא מומצא)
 */
export async function GET(req: Request) {
  try {
    const full = new URL(req.url).searchParams.get("full") === "1";
    const { gate, gitRail, counts, items } = await listBroadcastQueue();
    const withBody = items.map((it) => {
      const body = full && it.bodyRef ? queueItemBody(it.bodyRef) : null;
      return {
        ...it,
        ...(body ? { bodyMd: body.bodyMd, bodySha256Live: body.sha256, bodyBytesLive: body.bytes } : {}),
        ...(full && it.bodyRef && !body ? { bodyError: "קובץ-הגוף לא נקרא" } : {})
      };
    });
    return NextResponse.json({
      ok: true,
      gate: gate.gate,
      armed: gate.armed,
      vaultPassState: gate.passState,
      steemSigning: gate.steemSigning,
      // v105 — מסילת-הגיט הציבורית: מדידה חיה; פרסום = commit+push, txid=sha
      gitRail,
      counts,
      items: withBody,
      usage:
        "GET ?full=1 — גוף מלא · POST {slug, action:'publish-retry'} — סימון (fail-closed) · POST {action:'publish-git'} — פרסום-אמיתי של כל פריטי git-public (commit+push, txid=sha)"
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "broadcast-queue failed" },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {
  // שער P0: POST רגיש — fail-closed (מודל-הפאונדרי). כשאין מפתח-מנהל → 401/403 כנה.
  const __auth = await requireAuth(req);
  if (!__auth.ok) {
    await audit({ kind: "sensitive-denied", actor: __auth.actorRef, action: "POST /api/saos/broadcast/queue", allowed: false, req });
    return NextResponse.json({ ok: false, error: __auth.error ?? "auth-required" }, { status: __auth.status });
  }

  try {
    const body: unknown = await req.json().catch(() => ({}));
    const obj = (typeof body === "object" && body !== null ? body : {}) as { slug?: unknown; action?: unknown; trigger?: unknown };

    // v105 — פרסום-אמיתי במסילת-הגיט: commit+push מול origin, txid=sha.
    // fail-closed requireAuth (מעלה); המסילה עצמה נמדדת בתוך המנוע.
    if (obj.action === "publish-git") {
      const trigger = typeof obj.trigger === "string" && obj.trigger.length <= 40 ? obj.trigger : "manual";
      const out = await autoPublishGitRail(`${__auth.actorRef ?? "operator"}:${trigger}`);
      await logOp("broadcast-queue-publish-git", { ...out, by: __auth.actorRef ?? "operator", trigger });
      return NextResponse.json({ ok: true, action: "publish-git", ...out });
    }

    if (obj.action !== "publish-retry") {
      return NextResponse.json(
        { ok: false, error: "action נתמך: publish-retry (סימון) או publish-git (פרסום-אמיתי במסילת-הגיט)" },
        { status: 400 }
      );
    }
    if (typeof obj.slug !== "string" || !/^[a-z0-9][a-z0-9-]{2,80}$/.test(obj.slug)) {
      return NextResponse.json({ ok: false, error: "slug חסר או לא תקין" }, { status: 400 });
    }
    const result = await requestPublishRetry(obj.slug, __auth.actorRef ?? "operator");
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.message }, { status: 200 });
    }
    await logOp("broadcast-queue-retry", { slug: obj.slug, by: __auth.actorRef ?? "operator" });
    return NextResponse.json({
      ok: true,
      slug: obj.slug,
      action: "publish-retry",
      status: result.status,
      gate: result.gate,
      armed: result.armed,
      message: result.message
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "broadcast-queue-post failed" },
      { status: 200 }
    );
  }
}
