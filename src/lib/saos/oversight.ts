/**
 * src/lib/saos/oversight.ts — פיקוח-הריבונות (THE SOVEREIGN OVERSIGHT) — v125.
 * =====================================================================
 * הפקודה הריבונית (2026-10-04): "לתת לריבונות גם לפקח וגם לחפש עוד מה
 * לתקן, לייעל, לשפר, להוסיף — הכל למען הריבונות והאוטונומיה".
 *
 * זו הלולאה שמסתכלת על האורגניזם מבפנים — לא טענות, מדידות:
 *  1. חיות-האיברים: web (3000) · keeper (3005) · gate-agent (3006) ·
 *     swarm-agents (3007) · laya (3037) · anvil (8545) — TCP/HTTP אמת.
 *  2. שלמות-הכספת: 3 בתי-המעטפת קיימים ובגדלים צפויים (אפס קריאת-תוכן).
 *  3. סנכרון-הגיט: כמה commits מקומיים לא נדחפו ל-origin (דימום-ראיות).
 *  4. רענון-הממסר: /api/saos/mesh/rpc עונה (המסילה שהוחיה ב-v125).
 *  5. דופק-ה-autodrive: חותמת-הטיק האחרון לא זקנה מ-2 שעות.
 *  6. רעש-הפנקס: כמה שורות-שגיאה ב-OpLog בשעה האחרונה (מדידת-בריאות כנה).
 *
 * משמעת: כל-ממצא הוא נתון — לא אלרם. הסריקה כושלת-כנה חלק-חלק
 * (per-part catch), נרשמת ב-OpLog ונשמרת ב-state/oversight-latest.json.
 * אפס סוד: רק גדלים/קיום/מספרים.
 */

import fs from "fs";
import path from "path";
import net from "net";
import { execFile } from "child_process";

const OVERSIGHT_INTERVAL_MS = 5 * 60 * 1000; // כל 5 דק'
const OVERSIGHT_WARMUP_MS = 45 * 1000;
const LATEST_PATH = "state/oversight-latest.json";

export interface OversightCheck {
  part: string; // שם-החלק (איבר/מסילה/שער)
  ok: boolean;
  detail: string; // עובדה-מדודה בלבד (אין סוד, אין תוכן-מפתח)
  ms?: number;
}

export interface OversightReport {
  ts: string;
  tookMs: number;
  ok: boolean; // true רק אם כל-החלקים הקריטיים חיים
  checks: OversightCheck[];
  findings: string[]; // המלצות-תיקון כנות (עברית)
}

const g = globalThis as unknown as { __saos_oversight_timer?: NodeJS.Timeout };

function tcpAlive(port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: "127.0.0.1" });
    const done = (v: boolean) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

async function httpJson(url: string, timeoutMs = 4000): Promise<unknown | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

function vaultEnvelopeState(): OversightCheck {
  const homes = [
    "agent/keys/fleet_keys.enc",
    "/home/z/saos-vault/agent-keys/fleet_keys.enc",
    "upload/.agent-keys/fleet_keys.enc"
  ];
  const parts: string[] = [];
  let allOk = true;
  for (const h of homes) {
    try {
      const st = fs.statSync(path.resolve(process.cwd(), h));
      parts.push(`${h.split("/").slice(-2).join("/")}:${Math.round(st.size / 1024)}KB`);
    } catch {
      allOk = false;
      parts.push(`${h.split("/").slice(-2).join("/")}:חסר`);
    }
  }
  return { part: "כספת-המעטפת", ok: allOk, detail: parts.join(" · ") };
}

function gitUnpushedCount(): Promise<number> {
  return new Promise((resolve) => {
    execFile("git", ["log", "origin/main..HEAD", "--oneline"], { cwd: process.cwd(), timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(-1); // לא נמדד — כנה
      resolve(stdout.trim() ? stdout.trim().split("\n").length : 0);
    });
  });
}

function oplogErrorCountLastHour(): Promise<number> {
  return (async () => {
    try {
      const { db } = await import("@/lib/db");
      const since = new Date(Date.now() - 3_600_000);
      return await db.opLog.count({ where: { op: { contains: "error" }, createdAt: { gte: since } } });
    } catch {
      return -1;
    }
  })();
}

function autodriveFresh(): OversightCheck {
  try {
    const p = path.join(process.cwd(), "state/orchestra-autodrive-last.json");
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as { ts?: number };
    const ts = Number(raw.ts ?? 0);
    const ageMin = Math.round((Date.now() - ts) / 60_000);
    return { part: "דופק-ה-autodrive", ok: ts > 0 && ageMin <= 120, detail: ts > 0 ? `טיק-אחרון לפני ${ageMin} דק'` : "אין-חותמת" };
  } catch {
    return { part: "דופק-ה-autodrive", ok: false, detail: "אין-חותמת-על-הדיסק" };
  }
}

async function sweep(): Promise<OversightReport> {
  const t0 = Date.now();
  const checks: OversightCheck[] = [];
  const findings: string[] = [];

  // 1 — חיות-האיברים (TCP אמת)
  const members: Array<[string, number]> = [
    ["web", 3000],
    ["keeper", 3005],
    ["gate-agent", 3006],
    ["swarm-agents", 3007],
    ["laya", 3037],
    ["anvil-8545", 8545]
  ];
  for (const [name, port] of members) {
    const alive = await tcpAlive(port);
    checks.push({ part: `איבר:${name}:${port}`, ok: alive, detail: alive ? "TCP חי" : "אין-מאזין" });
    if (!alive && (port === 3000 || port === 8545)) findings.push(`${name} (${port}) מת — דרושה החיאה מיידית (keeper/supervisor)`);
  }

  // 2 — הכספת
  checks.push(vaultEnvelopeState());

  // 3 — הגיט
  const unpushed = await gitUnpushedCount();
  checks.push({ part: "גיט-דחיפות", ok: unpushed === 0, detail: unpushed < 0 ? "לא נמדד (אין origin)" : `${unpushed} commits לא-נדחפו` });
  if (unpushed > 2) findings.push(`${unpushed} commits לא נדחפו ל-origin — ראיות-חיות בסיכון`);

  // 4 — הממסר שהוחיה ב-v125
  const relay = (await httpJson("http://127.0.0.1:3000/api/saos/mesh/rpc")) as { ok?: boolean; block?: number } | null;
  checks.push({ part: "ממסר-SAOS-NET", ok: relay?.ok === true, detail: relay?.ok ? `בלוק ${String(relay.block)}` : "לא-עונה" });
  if (relay?.ok !== true) findings.push("ממסר /api/saos/mesh/rpc אינו עונה — SAOS-NET או הלולאה רדומים");

  // 5 — דופק-האוטודרייב
  checks.push(autodriveFresh());

  // 6 — רעש-הפנקס
  const errs = await oplogErrorCountLastHour();
  checks.push({ part: "רעש-פנקס-שעה", ok: errs === 0 || errs === -1 ? true : errs < 25, detail: errs >= 0 ? `${errs} שורות-שגיאה בשעה` : "לא נמדד" });

  const ok = checks.every((c) => c.ok);
  return { ts: new Date().toISOString(), tookMs: Date.now() - t0, ok, checks, findings };
}

async function runSweep(): Promise<void> {
  try {
    const report = await sweep();
    // כתיבה אטומית tmp+rename — חוק-הנרמול של הבית
    try {
      const p = path.join(process.cwd(), LATEST_PATH);
      const tmp = `${p}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(report, null, 2), "utf8");
      fs.renameSync(tmp, p);
    } catch {
      // כשל-כתיבה לא מפיל את הסריקה — הדיסק יתפוס בסבב-הבא
    }
    const { logOp } = await import("./oplog");
    await logOp("oversight.sweep", {
      ok: report.ok,
      tookMs: report.tookMs,
      failed: report.checks.filter((c) => !c.ok).map((c) => c.part),
      findings: report.findings.length
    });
    if (!report.ok) {
      const { logOp: log2 } = await import("./oplog");
      await log2("oversight.finding", report.findings.slice(0, 3).join(" | ").slice(0, 180));
    }
  } catch {
    // לעולם לא זורק מתוך-הלולאה — הסריקה-הבאה תנסה שוב
  }
}

/** נרשם מ-instrumentation.ts — עם guard-תהליכי + שער-קצב-דיסק כמו ה-autodrive */
export function startSovereignOversight(): void {
  if (g.__saos_oversight_timer) return;
  const lastGate = path.join(process.cwd(), "state/oversight-last.json");
  const gated = (): boolean => {
    try {
      const raw = JSON.parse(fs.readFileSync(lastGate, "utf8")) as { ts?: number };
      return Date.now() - Number(raw.ts ?? 0) >= OVERSIGHT_INTERVAL_MS - 60_000;
    } catch {
      return true;
    }
  };
  const stamp = (): void => {
    try {
      const tmp = `${lastGate}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify({ ts: Date.now() }), "utf8");
      fs.renameSync(tmp, lastGate);
    } catch {
      /* כנה */
    }
  };
  const loop = async (): Promise<void> => {
    if (!gated()) return;
    stamp();
    await runSweep();
  };
  g.__saos_oversight_timer = setInterval(() => void loop(), OVERSIGHT_INTERVAL_MS);
  setTimeout(() => void loop(), OVERSIGHT_WARMUP_MS);
  console.log(`[saos-oversight] live — sweep every ${OVERSIGHT_INTERVAL_MS / 60_000}min (6 parts, honest findings, zero secrets)`);
}

/** קריאה-ידנית ל-route — מדידה-רגעית בלי לגעת בטיימרים */
export async function runOversightNow(): Promise<OversightReport> {
  return sweep();
}

/** הדוח המתמשך האחרון מהדיסק (או null — עוד לא רץ) */
export function readLatestOversight(): OversightReport | null {
  try {
    const p = path.join(process.cwd(), LATEST_PATH);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8")) as OversightReport;
  } catch {
    return null;
  }
}
