"use client";

/**
 * SAOS Sovereign Platform v97 (SAOS_VERSION) — רוסט-אמת (TRUTH ROAST): החשיפה העצמית
 * החיה — התשובה הקודדת להוראת הבעלים "חפש בעיות רבות ותקן את כולן חפש
 * פערים רבים וסדר אותם יש לנו מלא פערים מה אמת למציאות תעשה לעצמך
 * roast חריף לרשת כדי לחשוף אותך ותתקן דחוף": מנוע truthRoast (5
 * מקורות-אמת: כסף USD חי · keeper · herald · swarm · מדידת-עצמי) + ויו
 * 'רוסט-אמת' מקום 3 — פסק-דין, נייר מול אמת, ופערים fixed/open/honest.
 * הרכבה דקה: AppShell (פס-פיקוד 10-רשתות חי) + 39 עמודים. קיצורי-מקלדת Alt+1..9.
 */

import { useEffect, useState } from "react";
import { AppShell, VIEWS, type ViewId } from "@/components/saos/shell";
import { ToastProvider } from "@/components/saos/ui";
import { useLive } from "@/components/saos/lib";
import type { StatusData } from "@/components/saos/types";
import { ViewOverview } from "@/components/saos/views/overview";
import { ViewWorth } from "@/components/saos/views/worth";
import { TreasuryView } from "@/components/saos/views/treasury";
import { IrrigationView } from "@/components/saos/views/irrigation";
import { AgriView } from "@/components/saos/views/agri";
import { SnapshotView } from "@/components/saos/views/snapshot";
import { SyncRadarView } from "@/components/saos/views/syncradar";
import { RoastView } from "@/components/saos/views/roast";
import { NetworkMapView } from "@/components/saos/views/networkmap";
import { BridgesView } from "@/components/saos/views/bridges";
import { BreakthroughView } from "@/components/saos/views/breakthrough";
import { ConversionView } from "@/components/saos/views/conversion";
import { TunerView } from "@/components/saos/views/tuner";
import { SovereignNetView } from "@/components/saos/views/sovereign-net";
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
import { SovereigntyView } from "@/components/saos/views/sovereignty";
import { HandsView } from "@/components/saos/views/hands";
import { SmartLinkView } from "@/components/saos/views/smartlink";
import { AgentChatView } from "@/components/saos/views/agentchat";
import { OneNetView } from "@/components/saos/views/one-net";
import { ViewProofs } from "@/components/saos/views/proofs";
import { ViewEnergy } from "@/components/saos/views/energy";
import { MicrogridView } from "@/components/saos/views/microgrid";
import CoinView from "@/components/saos/views/coin";
import { ExchangeView } from "@/components/saos/views/exchange";
import { FlowView } from "@/components/saos/views/flow";
import { RosesView } from "@/components/saos/views/roses";
import { ViewEconomy } from "@/components/saos/views/economy";
import { RecoveryView } from "@/components/saos/views/recovery";
import { ViewResearch } from "@/components/saos/views/research";
import { AxView } from "@/components/saos/views/ax";
import { RedteamView } from "@/components/saos/views/redteam";

const TITLES: Record<ViewId, string> = {
  overview: "לוח בקרה",
  worth: "מימוש — שווי הרשת החי",
  treasury: "ספר האוצר — הכסף של הריבון, מתועד",
  irrigation: "ההשקיה החכמה — אוטונומית אבל בחוכמה",
  agri: "ההשקיה החקלאית — מנוע דו-שכבתי",
  snapshot: "עוגן-החוץ — שימור-האמת מחוץ לסנדבוקס",
  syncradar: "מכ\"ם-הסנכרון — האמת האחרונה מול גיטהאב",
  roast: "רוסט-אמת — חשיפה עצמית",
  networkmap: "מפת-רשתות — הארנק הרב-רשתי",
  bridges: "בית-היוצר לגשרים — תשתית לעוד רשתות",
  breakthrough: "מנוע פריצת-הדרך — מה יש ביד · מה מגביל · מה הפריצה",
  conversion: "חדר ההמרה — TRON ו-SOL על הרשת שלנו",
  tuner: "מכוון הרשת — מה מגביל · מה חוסם · מה יועל ומה נאמת",
  "sovereign-net": "הרחבת הריבונות — פתרונות נוספים שנמצאו על הרשת",
  network360: "רשת-360",
  security: "מגן — ריבונות אבטחה",
  sovereignty: "ריבונות — מפת-השליטה העצמית",
  hands: "ידיים-ריבוניות — הצבא שנוגע בעולם",
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
  "one-net": "רשת-אחת — היחידה המתואמת",
  proofs: "הוכחות",
  energy: "ריבונות אנרגיה",
  microgrid: "מיקרו-גריד",
  coin: "המטבע — SAOS-M · כרטיס-זהות",
  exchange: "בורסת SAOS",
  flow: "נזילות וזרימה",
  roses: "שושנים",
  economy: "כלכלה",
  recovery: "התאוששות — מארב headcorner",
  research: "מחקר ומפת-דרך",
  ax: "הכרזה — תזמון דקלרטיבי (AX)",
  redteam: "אדום — צוות-האדום על הפלטפורמה (RED TEAM)"
};

export default function Home() {
  // v87 — ברירת-מחדל: לוח-הבקרה. הוראת הבעלים (trace 1a098f97a6f85e95):
  // "הוא נפתח לי קבוע על האגרו" — נחיתה דטרמיניסטית על תמונת-המצב הכללית;
  // האגרו ושאר 39 הפאנלים בני-השגה בקליק (סרגל · Alt+1..9).
  // v91 — DEEP-LINKING: התצוגה נשמרת ב-location.hash — קישור-שיתוף לכל
  // פאנל, כפתור-אחורה/קדימה של הדפדפן עובד, ורענון-עמוד נשאר באותה תצוגה.
  const viewFromHash = (): ViewId => {
    const h = window.location.hash.replace(/^#/, "") as ViewId;
    return VIEWS.some((v) => v.id === h) ? h : "overview";
  };
  const [view, setViewState] = useState<ViewId>("overview");
  const setView = (v: ViewId) => {
    setViewState(v);
    try {
      if (window.location.hash !== `#${v}`) window.history.pushState(null, "", `#${v}`);
    } catch {
      /* hash best-effort */
    }
    window.scrollTo({ top: 0, behavior: "auto" }); // nav always lands on top
  };
  const status = useLive<StatusData>("/api/saos/status", 12000);

  // hash boot + back/forward navigation
  useEffect(() => {
    const apply = () => setViewState(viewFromHash());
    apply(); // land on the shared/refreshed hash at mount
    window.addEventListener("popstate", apply);
    return () => window.removeEventListener("popstate", apply);
  }, []);

  // קיצורי-מקלדת: Alt+1..9 לניווט מהיר
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= 9 && n <= VIEWS.length) {
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
        {view === "treasury" && <TreasuryView />}
        {view === "irrigation" && <IrrigationView />}
        {view === "agri" && <AgriView />}
        {view === "snapshot" && <SnapshotView />}
        {view === "syncradar" && <SyncRadarView />}
        {view === "roast" && <RoastView />}
        {view === "networkmap" && <NetworkMapView />}
        {view === "bridges" && <BridgesView />}
        {view === "breakthrough" && <BreakthroughView />}
        {view === "conversion" && <ConversionView />}
        {view === "tuner" && <TunerView />}
        {view === "sovereign-net" && <SovereignNetView />}
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
        {view === "sovereignty" && <SovereigntyView />}
        {view === "hands" && <HandsView />}
        {view === "smartlink" && <SmartLinkView />}
        {view === "agentchat" && <AgentChatView />}
        {view === "one-net" && <OneNetView />}
        {view === "proofs" && <ViewProofs seals={status.data?.seals ?? []} />}
        {view === "energy" && <ViewEnergy />}
        {view === "microgrid" && <MicrogridView />}
        {view === "coin" && <CoinView />}
        {view === "exchange" && <ExchangeView />}
        {view === "flow" && <FlowView />}
        {view === "roses" && <RosesView />}
        {view === "economy" && <ViewEconomy />}
        {view === "recovery" && <RecoveryView />}
        {view === "research" && <ViewResearch />}
        {view === "ax" && <AxView />}
        {view === "redteam" && <RedteamView />}
      </AppShell>
    </ToastProvider>
  );
}
