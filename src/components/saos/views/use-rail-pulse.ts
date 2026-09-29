"use client";

/**
 * src/components/saos/views/use-rail-pulse.ts — hook פעימות-רכב אחיד (R16).
 *
 * חוב-מבני מ-R14: חמשת רכבי-העגינה החיים (evm · svm · bsc · tron · xrp)
 * נשאו כל אחד חמישה-שדות-מצב זהים ושני מטפלים זהים (~250 ש' משוכפלות)
 * בתוך ViewOps. ה-hook הזה מאחד את המצב והמטפלים; ההבדלים בין הרכבים
 * הם תוויות בלבד (netLabel · unit · via) + רענון-המסילות שנשאר ב-ViewOps
 * דרך onSettled/onRechecked — בדיוק ההתנהגות המקורית, ללא שינוי-JSX.
 *
 * שיפורי-אמת מוסדרים בדרך (מתועדים): (1) railRecheck המשותף ל-evm/svm
 * היה באג-תצוגה — "בודק…" היה נדלק על שני הפאנלים גם-יחד; כעת כל רכב
 * עצמאי. (2) כישלון-רשת ב-bsc לא הציג את התוצאה בפאנל — כעת אחיד לכולם
 * (כישלון מוצג ככישלון, הדוקטרינה).
 */

import { useState } from "react";
import { postJson, short } from "../lib";
import { useToast } from "../ui";
import type { RailPulseResult } from "../types";

export interface RailPulseOpts {
  /** מזהה-המסילה ב-API — /api/saos/anchor/{rail}. v91: zero (Z-CHAIN) הצטרף —
   *  הרכב השישי שהיה בנוי ומתועד בשרת אך יתום בתצוגה. */
  rail: "evm" | "svm" | "bsc" | "tron" | "xrp" | "zero";
  /** תווית-הרשת לטוסטים: ETHEREUM · SOLANA · BSC · TRON · XRPL. */
  netLabel: string;
  /** שם-שדה הזיהוי בתיאור-הטוסט: txid · signature · hash. */
  unit: "txid" | "signature" | "hash";
  /** סיומת-הרשת בתיאור-הטוסט: mainnet · BNB Chain · TRON mainnet · … */
  via: string;
  /** רענון-מסילות אחרי תשובת-שרת תקינה — בדיוק כמקורי (רק ענף-res.ok). */
  onSettled: () => void;
  /** רענון-ספר-העוגנים אחרי אימות-מחדש (רק למסילות עם כפתור-אימות). */
  onRechecked?: () => void;
}

export function useRailPulse(opts: RailPulseOpts) {
  const toast = useToast();
  const [pulsing, setPulsing] = useState(false);
  const [result, setResult] = useState<RailPulseResult | null>(null);
  const [rechecking, setRechecking] = useState<string | null>(null);

  const doPulse = async () => {
    if (pulsing) return;
    setPulsing(true);
    setResult(null);
    const res = await postJson<RailPulseResult>(`/api/saos/anchor/${opts.rail}`, {});
    setPulsing(false);
    if (res.ok && res.data) {
      setResult(res.data);
      opts.onSettled();
      if (res.data.ok) {
        toast.push({
          tone: res.data.already ? "gold" : "green",
          title: res.data.already
            ? `חותם #${res.data.height} כבר מעוגן ב-${opts.netLabel}`
            : `עוגן ${opts.netLabel} נחת — חותם #${res.data.height}`,
          desc: res.data.txid ? `${opts.unit} ${short(res.data.txid)} · ${opts.via}` : "הפעימה תועדה"
        });
      } else {
        toast.push({
          tone: res.data.gated ? "gold" : "rose",
          title: `פעימת ${opts.netLabel} נכשלה`,
          desc: res.data.error ?? "שגיאה לא ידועה — תועד בכנות"
        });
      }
    } else {
      setResult({ ok: false, error: res.error ?? "כשל רשת" });
      toast.push({ tone: "rose", title: "הפעימה נכשלה", desc: res.error ?? "השרת לא ענה" });
    }
  };

  const doRecheck = async (id: string) => {
    if (rechecking) return;
    setRechecking(id);
    try {
      const res = await fetch(`/api/saos/anchor/${opts.rail}?recheck=${encodeURIComponent(id)}`, {
        cache: "no-store"
      });
      const json = (await res.json()) as { ok: boolean; confirmed?: boolean; error?: string };
      if (json.ok && json.confirmed) {
        toast.push({ tone: "green", title: "אומת מול השרשרת", desc: "קבלה + read-back — העוגן נראה ב-mainnet" });
      } else if (json.ok) {
        toast.push({ tone: "gold", title: "עדיין לא אומת", desc: "האינדוקס מפגר — נסה שוב בעוד דקה" });
      } else {
        toast.push({ tone: "rose", title: "אימות-מחדש נכשל", desc: json.error ?? "שגיאה" });
      }
    } catch {
      toast.push({ tone: "rose", title: "אימות-מחדש נכשל", desc: "כשל רשת" });
    }
    setRechecking(null);
    opts.onRechecked?.();
  };

  return { pulsing, result, rechecking, doPulse, doRecheck };
}
