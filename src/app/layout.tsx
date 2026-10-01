import type { Metadata, Viewport } from "next";
import { Rubik } from "next/font/google";
import "./globals.css";

// v99 — גופן-אמת: Rubik (עברית+לטיני) דרך next/font — self-hosted בבנייה,
// עם fallback-metric מותאם אוטומטית (אין קפיצת-פונט). המשתנה --font-rubik
// נחתך על <html> ונקשר ל--font-sans ב-globals.css.
const rubik = Rubik({
  subsets: ["hebrew", "latin"],
  weight: "variable",
  variable: "--font-rubik",
  display: "swap"
});

export const metadata: Metadata = {
  title: "SAOS Sovereign Platform — קונסולת עגינה ריבונית",
  description:
    "פלטפורמת עגינה מוסדית חוצת-רשתות: שורשי-איטום ל-STEEM/BLURT/HIVE/TRON, ריבונות אנרגיה, כלכלת גלגל-חור והוכחות ציבוריות נושאות-ראיות."
};

// v99 — מובייל: themeColor תואם-ערכה + viewport-fit cover לשוליים-בטוחים (נוף-שלם).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#09090b"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={rubik.variable}>
      <body className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
