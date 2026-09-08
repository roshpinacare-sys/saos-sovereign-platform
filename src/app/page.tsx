"use client";

/**
 * SAOS Sovereign Platform v25 — RESHUT (רשות: מטריצת הסמכויות — אין חתימה בלי רשות · שובל-ביקורת אדום מעודכ · מגן אוטומטי) (מכ"ם-נזילות חי: 8 מרחבים · USD ·
 * מפת-הזרימה מקורות→מנועים→לכידה · חימוש-מחדש ריבוני — התמונה של
 * הבעלים נקראת בקצה-האחורי, מאומתת מול ראיות-השרשרת, נאטמת כספת
 * חדשה; מיקרו-גריד עם חוסן-ריאנקור אוטומטי) מעל לוח העבודה.
 * הרכבה דקה: AppShell (פס-פיקוד 8-רשתות חי) + 16 עמודים. קיצורי-מקלדת Alt+1..9.
 */

import { useEffect, useState } from "react";
import { AppShell, VIEWS, type ViewId } from "@/components/saos/shell";
import { ToastProvider } from "@/components/saos/ui";
import { useLive } from "@/components/saos/lib";
import type { StatusData } from "@/components/saos/types";
import { ViewOverview } from "@/components/saos/views/overview";
import { Network360View } from "@/components/saos/views/network360";
import { SecurityView } from "@/components/saos/views/security";
import { PermissionsView } from "@/components/saos/views/permissions";
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
import { MicrogridView } from "@/components/saos/views/microgrid";
import { FlowView } from "@/components/saos/views/flow";
import { RosesView } from "@/components/saos/views/roses";
import { ViewEconomy } from "@/components/saos/views/economy";
import { ViewResearch } from "@/components/saos/views/research";

const TITLES: Record<ViewId, string> = {
  overview: "לוח בקרה",
  network360: "רשת-360",
  security: "מגן — ריבונות אבטחה",
  reshut: "רשות — מטריצת הסמכויות",
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
  microgrid: "מיקרו-גריד",
  flow: "נזילות וזרימה",
  roses: "שושנים",
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
        {view === "security" && <SecurityView />}
        {view === "reshut" && <PermissionsView />}
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
        {view === "microgrid" && <MicrogridView />}
        {view === "flow" && <FlowView />}
        {view === "roses" && <RosesView />}
        {view === "economy" && <ViewEconomy />}
        {view === "research" && <ViewResearch />}
      </AppShell>
    </ToastProvider>
  );
}
