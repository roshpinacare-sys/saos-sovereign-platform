"use client";

/**
 * SAOS v4 — ליבת נתונים-חיים ופורמט (zero-dependency).
 * useLive: fetch מחזורי עם pause-on-hidden, שגיאות-כנתונים, רענון שקט.
 * useClock: שעון מוסדי (Asia/Jerusalem). useTick: פעימת-זמן ל-timeAgo.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface LiveResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
  updatedAt: number | null;
}

export function useLive<T>(url: string | null, intervalMs = 12000): LiveResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(
    async (silent: boolean) => {
      if (url === null || inFlight.current) return;
      inFlight.current = true;
      if (!silent) setLoading(true);
      try {
        const res = await fetch(url, { cache: "no-store" });
        const json: unknown = await res.json();
        if (
          typeof json === "object" &&
          json !== null &&
          "ok" in json &&
          (json as { ok: unknown }).ok === false
        ) {
          const msg = (json as { error?: unknown }).error;
          setError(typeof msg === "string" ? msg : "שגיאה לא ידועה");
        } else {
          setData(json as T);
          setError(null);
          setUpdatedAt(Date.now());
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "כשל רשת — השרת לא ענה");
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [url]
  );

  useEffect(() => {
    void load(false);
    const id = setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) void load(true);
    }, intervalMs);
    return () => clearInterval(id);
  }, [load, intervalMs]);

  const refresh = useCallback(() => void load(true), [load]);
  return { data, error, loading, refresh, updatedAt };
}

/** שעון מוסדי — Asia/Jerusalem */
export function useClock(): string {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const tick = () =>
      setNow(
        new Date().toLocaleTimeString("he-IL", {
          timeZone: "Asia/Jerusalem",
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        })
      );
    const raf = requestAnimationFrame(tick); // עדכון ראשון אסינכרוני — מונע mismatch
    const id = setInterval(tick, 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  }, []);
  return now || "--:--:--";
}

/** פעימת זמן לריענון זמנים-יחסית */
export function useTick(ms = 15000): number {
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return tick;
}

export async function postJson<T>(
  url: string,
  body: unknown
): Promise<{ ok: boolean; data: T | null; error: string | null }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const json: unknown = await res.json();
    if (typeof json === "object" && json !== null && "ok" in json) {
      const obj = json as { ok: boolean; error?: unknown };
      if (obj.ok === false) {
        return { ok: false, data: null, error: typeof obj.error === "string" ? obj.error : "שגיאה" };
      }
      return { ok: true, data: json as T, error: null };
    }
    return { ok: false, data: null, error: "תגובה לא צפויה" };
  } catch (e) {
    return { ok: false, data: null, error: e instanceof Error ? e.message : "כשל רשת" };
  }
}

// ─── פורמט ───────────────────────────────────────────────────────────────────

export const fmt = (n: number): string =>
  n.toLocaleString("he-IL", { maximumFractionDigits: 2 });

export const fmtInt = (n: number): string =>
  n.toLocaleString("he-IL", { maximumFractionDigits: 0 });

export const short = (s: string | null | undefined, head = 10): string =>
  s && s.length > 18 ? `${s.slice(0, head)}…${s.slice(-6)}` : s ?? "—";

export function timeAgo(at: string | number | null | undefined): string {
  if (at === null || at === undefined) return "—";
  const then = typeof at === "number" ? at : Date.parse(at);
  if (!Number.isFinite(then)) return "—";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 6) return "עכשיו";
  if (s < 60) return `לפני ${s} שנ׳`;
  const m = Math.floor(s / 60);
  if (m < 60) return `לפני ${m} דק׳`;
  const h = Math.floor(m / 60);
  if (h < 24) return `לפני ${h} שע׳`;
  return `לפני ${Math.floor(h / 24)} ימים`;
}

export function fullTime(at: string | number | null | undefined): string {
  if (at === null || at === undefined) return "—";
  const d = typeof at === "number" ? new Date(at) : new Date(at);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));
