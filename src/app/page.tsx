"use client";

/**
 * SAOS Sovereign Platform v18 — REAL WORK (מנוע הפתרונות: לכל פקודה מסירה
 * אמיתית — תוכן LLM קונקרטי, דיגסט sha256 מעוגן במסילת SAOS-WORK,
 * קבלה משורשרת-האש — מעל לוח העבודה: המפקדה מפרסמת, חיילים מבצעים
 * דרך 8 החוזים, השכר זורם ללא-עמלה).
 * הרכבה דקה: AppShell (פס-פיקוד 8-רשתות חי) + 13 עמודים. קיצורי-מקלדת Alt+1..9.
 */

import { useEffect, useState } from "react";
import { AppShell, VIEWS, type ViewId } from "@/components/saos/shell";
import { ToastProvider } from "@/components/saos/ui";
import { useLive } from "@/components/saos/lib";
import type { StatusData } from "@/components/saos/types";
import { ViewOverview } from "@/components/saos/views/overview";
import { Network360View } from "@/components/saos/views/network360";
import { ViewNetworks } from "@/components/saos/views/networks";
import { ViewAgents } from "@/components/saos/views/agents";
import { ViewSeals } from "@/components/saos/views/seals";
import { ViewOps } from "@/components/saos/views/ops";
import { ViewMesh } from "@/components/saos/views/mesh";
import { ViewWorkboard } from "@/components/saos/views/workboard";
import { ViewFleet } from "@/components/saos/views/fleet";
import { ViewSovereignKey } from "@/components/saos/views/sovereign-key";
import { ViewProofs } from "@/components/saos/views/proofs";
import { ViewEnergy } from "@/components/saos/views/energy";
import { ViewEconomy } from "@/components/saos/views/economy";
import { ViewResearch } from "@/components/saos/views/research";

const TITLES: Record<ViewId, string> = {
  overview: "לוח בקרה",
  network360: "רשת-360",
  networks: "רשתות חיות",
  agents: "מעקב סוכנים",
  seals: "איטום ועגינה",
  ops: "מבצעי עגינה",
  mesh: "רשת החוזים",
  workboard: "פקודות עבודה",
  fleet: "חימוש הצי",
  "sovereign-key": "המפתח הריבוני",
  proofs: "הוכחות",
  energy: "ריבונות אנרגיה",
  economy: "כלכלה",
  research: "מחקר ומפת-דרך"
};

export default function Home() {
  const [view, setView] = useState<ViewId>("overview");
  const status = useLive<StatusData>("/api/saos/status", 12000);

  // קיצורי-מקלדת: Alt+1..9 לניווט מהיר
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= VIEWS.length) {
        e.preventDefault();
        setView(VIEWS[n - 1]!.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // כותרת דינמית
  useEffect(() => {
    document.title = `SAOS · ${TITLES[view]}`;
  }, [view]);

  return (
    <ToastProvider>
      <AppShell view={view} onNav={setView} status={status}>
        {view === "overview" && <ViewOverview status={status} onNav={setView} />}
        {view === "network360" && <Network360View />}
        {view === "networks" && <ViewNetworks status={status} />}
        {view === "agents" && <ViewAgents />}
        {view === "seals" && <ViewSeals status={status} />}
        {view === "ops" && <ViewOps status={status} />}
        {view === "mesh" && <ViewMesh />}
        {view === "workboard" && <ViewWorkboard />}
        {view === "fleet" && <ViewFleet />}
        {view === "sovereign-key" && <ViewSovereignKey />}
        {view === "proofs" && <ViewProofs seals={status.data?.seals ?? []} />}
        {view === "energy" && <ViewEnergy />}
        {view === "economy" && <ViewEconomy />}
        {view === "research" && <ViewResearch />}
      </AppShell>
    </ToastProvider>
  );
}
