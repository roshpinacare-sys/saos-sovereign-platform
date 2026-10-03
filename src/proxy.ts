import { NextResponse, type NextRequest } from "next/server";

/**
 * src/proxy.ts — v121.0.0 preview-loophole (התיקון-שנועל-את-הבעלים-בחוץ) — שכבת-כותרות-האבטחה.
 * =====================================================================
 * Next 16 שינה את שם-הקובץ: middleware.ts → proxy.ts. אין ליצור middleware.ts לצד זה.
 *
 * v121 — תיקון-חור-התצוגה-המקדימה (נמדד-חי 2026-10-03): לוח-התצוגה-המקדימה של
 * הבעלים מטמיע את הקונסולה ב-iframe על תחום-הפלטפורמה (preview-chat-*.space-z.ai) —
 * ו-X-Frame-Options: DENY (מ-v111) חסם את-הבעלים-עצמו: "refused to connect".
 * התרופה המדורגת: ביטול-XFO (ה-API המיושן לא-יודע-רשימות-היתר) ומעבר-ל-frame-ancestors
 * מודרני-מאוכף-בלבד: CSP אוכף-מינימלי שמכיל את-הנחיה-הזו-בלבד (frame-ancestors
 * https://*.space-z.ai) — לא-נוגע-בשום-הנחיה-אחרת, אפס-סיכון-שבירת-UI, וההגנה
 * מול-קליק-ג'קינג נשארת (כל-מקור-אחר נחסם).
 *
 * מדיניות-ה-CSP המלאה ממשיכה מדורגת (v111 doctrine): Report-Only בלבד —
 * האכיפה-המלאה צעד-עצמאי אחרי סקירת-ההפרות.
 */

export function proxy(req: NextRequest) {
  const res = NextResponse.next();

  // ── אוכף מיד (בטוח-שחרור) ──
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  // v121 — הגנת-המסגור בלבד, מאוכפת, עם-רשימת-היתר-לפלטפורמה:
  // (XFO הוסר — הוא חסם גם את תצוגת-הבעלים; frame-ancestors מדויק-יותר)
  res.headers.set("Content-Security-Policy", "frame-ancestors https://*.space-z.ai");

  // ── CSP מדורג: Report-Only תחילה (v111 doctrine) — המלאי נאסף, האכיפה בצעד-הבא ──
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // dev-compile + Next inline bootstrap — מצטמצם לאחר סקירת-ההפרות
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors https://*.space-z.ai", // v121 — הבעלים-דרך-הפלטפורמה; שאר-העולם נחסם
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
