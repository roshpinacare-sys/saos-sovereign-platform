"use client";

/**
 * SAOS Sovereign Platform v14 — SOVEREIGN RELAY (BSC נפתח + חוזה חכם באיתריום).
 * הרכבה דקה: AppShell (פס-פיקוד 8-רשתות חי) + 10 עמודים. קיצורי-מקלדת Alt+1..0.
 */

import { useEffect, useState } from "react";
import { AppShell, VIEWS, type ViewId } from "@/components/saos/shell";
import { ToastProvider } from "@/components/saos/ui";
import { useLive } from "@/components/saos/lib";
import type { StatusData } from "@/components/saos/types";
import { ViewOverview } from "@/components/saos/views/overview";
import { ViewNetworks } from "@/components/saos/views/networks";
import { ViewAgents } from "@/components/saos/views/agents";
import { ViewSeals } from "@/components/saos/views/seals";
import { ViewOps } from "@/components/saos/views/ops";
import { ViewFleet } from "@/components/saos/views/fleet";
import { ViewProofs } from "@/components/saos/views/proofs";
import { ViewEnergy } from "@/components/saos/views/energy";
import { ViewEconomy } from "@/components/saos/views/economy";
import { ViewResearch } from "@/components/saos/views/research";

const TITLES: Record<ViewId, string> = {
  overview: "לוח בקרה",
  networks: "רשתות חיות",
  agents: "מעקב סוכנים",
  seals: "איטום ועגינה",
  ops: "מבצעי עגינה",
  fleet: "חימוש הצי",
  proofs: "הוכחות",
  energy: "ריבונות אנרגיה",
  economy: "כלכלה",
  research: "מחקר ומפת-דרך"
};

export default function Home() {
  const [view, setView] = useState<ViewId>("overview");
  const status = useLive<StatusData>("/api/saos/status", 12000);

  // קיצורי-מקלדת: Alt+1..0 לניווט מהיר
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
        {view === "networks" && <ViewNetworks status={status} />}
        {view === "agents" && <ViewAgents />}
        {view === "seals" && <ViewSeals status={status} />}
        {view === "ops" && <ViewOps status={status} />}
        {view === "fleet" && <ViewFleet />}
        {view === "proofs" && <ViewProofs seals={status.data?.seals ?? []} />}
        {view === "energy" && <ViewEnergy />}
        {view === "economy" && <ViewEconomy />}
        {view === "research" && <ViewResearch />}
      </AppShell>
    </ToastProvider>
  );
}
