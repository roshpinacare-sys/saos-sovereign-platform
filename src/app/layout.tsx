import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SAOS Sovereign Foundry v2 — אנחנו מנצחים את הבלוקצ'יין",
  description:
    "פלטפורמת עגינה חוצת-רשתות: שורשי-איטום ל-STEEM/BLURT/HIVE/TRON, ריבונות אנרגיה (TRX energize), כלכלת גלגל-חור והוכחות ציבוריות נושאות-ראיות."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
