import { NextResponse, type NextRequest } from "next/server";

/**
 * src/proxy.ts — v111.0.0-content RED TEAM (strix) — שכבת-כותרות-האבטחה של הפלטפורמה.
 * =====================================================================
 * Next 16 שינה את שם-הקובץ: middleware.ts → proxy.ts (ה-RENAMED-של Next16 —
 * הקובץ ש-Next באמת טוען). אין ליצור middleware.ts לצד זה.
 *
 * מדיניות-ה-CSP מדורגת (v111 doctrine, staged): אנו מפרסמים
 * Content-Security-Policy-Report-Only ולא CSP אוכף — כי אכיפה על פלטפורמה
 * חיה-בת-113-גלים עם inline styles/scripts של Next dev תשבור את ה-UI בלי
 * מלאי-הפרות ללמוד ממנו. Report-Only מפיק את המלאי תחילה; ההחמרה לאכיפה
 * היא צעד-עצמאי לאחר סקירת-ההפרות (בלי-שינוי-חוזה-השער).
 *
 * שאר-הכותרות אוכפות מיד: nosniff · referrer-policy · permissions-policy
 * · X-Frame-Options DENY — כולן בטוחות-שחרור ונמדדות ע"י חיישן
 * headers ב-src/lib/saos/redteam.ts.
 */

export function proxy(req: NextRequest) {
  const res = NextResponse.next();

  // ── אוכף מיד (בטוח-שחרור) ──
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.headers.set("X-Frame-Options", "DENY");

  // ── CSP מדורג: Report-Only תחילה (v111 doctrine) — המלאי נאסף, האכיפה בצעד-הבא ──
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // dev-compile + Next inline bootstrap — מצטמצם לאחר סקירת-ההפרות
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'"
  ].join("; ");
  res.headers.set("Content-Security-Policy-Report-Only", csp);

  return res;
}

// Next 16 proxy config — לכל הנתיבים חוץ מנכסים-סטטיים ופאביק-פרימיטיבים
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
