"use client";

/**
 * SAOS Sovereign Platform v43 — מימוש (REALIZATION): מנוע שווי-הרשת החי —
 * התשובה הקודדת לשאלת הבעלים "מה יש לנו בידיים · מה הפוטנציאל האמיתי
 * שאפשר לממש ממנו מנקודה זו": מאזן חי מ-5 מקורות-אמת, מופרד לעולם
 * לממומש (הוכח) · אחזקה (חי ביד) · חמוש (ממתין לטריגר) · מנוע (תקרות
 * כנות) — ופעימת מימוש שמבצעת ערך על הרשת עכשיו (אורקל+סולם+שטיפה+
 * קציר→קופת-עבודה+ריצה ריבונית דרך כל 10 החוזים, txid לכל צעד).
 * הרכבה דקה: AppShell (פס-פיקוד 8-רשתות חי) + 25 עמודים. קיצורי-מקלדת Alt+1..9.
  */

import { useEffect, useState } from "react";
import { AppShell, VIEWS, type ViewId } from "@/components/saos/shell";
import { ToastProvider } from "@/components/saos/ui";
import { useLive } from "@/components/saos/lib";
import type { StatusData } from "@/components/saos/types";
import { ViewOverview } from "@/components/saos/views/overview";
import { ViewWorth } from "@/components/saos/views/worth";
import { Network360View } from "@/components/saos/views/network360";
import { SecurityView } from "@/components/saos/views/security";
import { PermissionsView } from "@/components/saos/views/permissions";
import { KeeperView } from "@/components/saos/views/keeper";
import { ViewNetworks } from "@/components/saos/views/networks";
import { ViewAgents } from "@/components/saos/views/agents";
import { ViewSeals } from "@/components/saos/views/seals";
import { ViewOps } from "@/components/saos/views/ops";
import { ViewMesh } from "@/components/saos/views/mesh";
import { ViewWorkboard } from "@/components/saos/views/workboard";
import { ViewFleet } from "@/components/saos/views/fleet";
import { ViewSovereignKey } from "@/components/saos/views/sovereign-key";
import { SmartLinkView } from "@/components/saos/views/smartlink";
import { AgentChatView } from "@/components/saos/views/agentchat";
import { ViewProofs } from "@/components/saos/views/proofs";
import { ViewEnergy } from "@/components/saos/views/energy";
import { MicrogridView } from "@/components/saos/views/microgrid";
import { ExchangeView } from "@/components/saos/views/exchange";
import { FlowView } from "@/components/saos/views/flow";
import { RosesView } from "@/components/saos/views/roses";
import { ViewEconomy } from "@/components/saos/views/economy";
import { RecoveryView } from "@/components/saos/views/recovery";
import { ViewResearch } from "@/components/saos/views/research";

const TITLES: Record<ViewId, string> = {
  overview: "לוח בקרה",
  worth: "מימוש — שווי הרשת החי",
  network360: "רשת-360",
  security: "מגן — ריבונות אבטחה",
  reshut: "רשות — מטריצת הסמכויות",
  keeper: "שומר — החייאה עצמית",
  networks: "רשתות חיות",
  agents: "מעקב סוכנים",
  seals: "איטום ועגינה",
  ops: "מבצעי עגינה",
  mesh: "רשת החוזים",
  workboard: "פקודות עבודה",
  fleet: "חימוש הצי",
  "sovereign-key": "המפתח הריבוני",
  smartlink: "החיבור החכם — כספת ריבוי-בתים",
  agentchat: "צ'אט הסוכנים — שער API",
  proofs: "הוכחות",
  energy: "ריבונות אנרגיה",
  microgrid: "מיקרו-גריד",
  exchange: "בורסת SAOS",
  flow: "נזילות וזרימה",
  roses: "שושנים",
  economy: "כלכלה",
  recovery: "התאוששות — מארב headcorner",
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
        {view === "worth" && <ViewWorth />}
        {view === "network360" && <Network360View />}
        {view === "security" && <SecurityView />}
        {view === "reshut" && <PermissionsView />}
        {view === "keeper" && <KeeperView />}
        {view === "networks" && <ViewNetworks status={status} />}
        {view === "agents" && <ViewAgents />}
        {view === "seals" && <ViewSeals status={status} />}
        {view === "ops" && <ViewOps status={status} />}
        {view === "mesh" && <ViewMesh />}
        {view === "workboard" && <ViewWorkboard />}
        {view === "fleet" && <ViewFleet />}
        {view === "sovereign-key" && <ViewSovereignKey />}
        {view === "smartlink" && <SmartLinkView />}
        {view === "agentchat" && <AgentChatView />}
        {view === "proofs" && <ViewProofs seals={status.data?.seals ?? []} />}
        {view === "energy" && <ViewEnergy />}
        {view === "microgrid" && <MicrogridView />}
        {view === "exchange" && <ExchangeView />}
        {view === "flow" && <FlowView />}
        {view === "roses" && <RosesView />}
        {view === "economy" && <ViewEconomy />}
        {view === "recovery" && <RecoveryView />}
        {view === "research" && <ViewResearch />}
      </AppShell>
    </ToastProvider>
  );
}
