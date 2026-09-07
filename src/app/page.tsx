"use client";

/**
 * SAOS Sovereign Foundry v3 — Sovereign Command Deck.
 * הרכבה דקה: shell + 5 מגדלים. כל הלוגיקה במודולים (components/saos/*).
 */

import { useState } from "react";
import { ToastProvider } from "@/components/ui/kit";
import { Footer, Header, NavTabs, type TowerId } from "@/components/saos/shell";
import { useLive } from "@/components/saos/hooks";
import type { StatusData } from "@/components/saos/types";
import { TowerOverview } from "@/components/saos/tower-overview";
import { TowerEnergy } from "@/components/saos/tower-energy";
import { TowerEconomy } from "@/components/saos/tower-economy";
import { TowerProofs } from "@/components/saos/tower-proofs";
import { TowerVerdict } from "@/components/saos/tower-verdict";

export default function Home() {
  const [tab, setTab] = useState<TowerId>("tower");
  const status = useLive<StatusData>("/api/saos/status", 12000);

  return (
    <ToastProvider>
      <div className="flex flex-col min-h-screen">
        <Header stats={status.data?.stats} updatedAt={status.updatedAt} live={!status.error} onRefresh={status.refresh} />
        <main className="flex-1 w-full max-w-6xl mx-auto px-4 pb-10">
          <NavTabs value={tab} onChange={setTab} />
          <div key={tab} className="animate-rise">
            {tab === "tower" && <TowerOverview status={status} />}
            {tab === "energy" && <TowerEnergy />}
            {tab === "economy" && <TowerEconomy />}
            {tab === "proofs" && <TowerProofs seals={status.data?.seals ?? []} />}
            {tab === "verdict" && <TowerVerdict />}
          </div>
        </main>
        <Footer />
      </div>
    </ToastProvider>
  );
}
