"use client";

/**
 * SAOS v97 (ביקורת-התצוגה / THE PREVIEW TRUTH — מ-SAOS_VERSION) — מעטפת REAL WORK (COMMAND DECK + 8-CHAIN GRID + חוזי-המרש — ספירת-החוזים נגזרת מ-SAOSMesh.json + פקודות עבודה + מסירות אמיתיות) + כניסת-מנהל (fail-closed).
 * סרגל-צד (דסקטופ) + סרגל-עליון חי (שעון, חיבור, רענון) + **פס-פיקוד 8-רשתות חי**
 * (SAOS-NET · STEEM · BLURT · HIVE · TRON · ETHEREUM · BSC · SOLANA) + ניווט-גלילה (מובייל)
 * + כותרת-תחתונה דביקה.
 */

import { Anchor, ArrowLeftRight, Boxes, ChevronDown, Coins, Crosshair, Droplets, ExternalLink, Flame, Flower2, Gem, GitBranch, Globe2, Hammer, Hand, HardHat, HeartPulse, KeyRound, Landmark, Lightbulb, Link2, MessagesSquare, Radar, RadioTower, RefreshCcw, Scale, ShieldCheck, Sprout, Swords, Users, Waypoints, Workflow, Zap, Gauge } from "lucide-react";
import { Fragment, memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { cn, LiveDot, Pill, useToast } from "./ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtInt, timeAgo, useClock, useLive, useTick } from "./lib";
import type { LiveResult } from "./lib";
import { SAOS_VERSION, SAOS_CODENAME, SAOS_CODENAME_SHORT } from "@/lib/saos/version";
import { MESH_CONTRACT_COUNT, MESH_LINK_CHAIN_LENGTH } from "@/lib/saos/mesh-facts";
import type { LiveProbesData, StatusData } from "./types";

export type ViewId = "overview" | "worth" | "treasury" | "irrigation" | "agri" | "snapshot" | "syncradar" | "roast" | "networkmap" | "bridges" | "breakthrough" | "conversion" | "tuner" | "sovereign-net" | "network360" | "security" | "reshut" | "keeper" | "networks" | "agents" | "seals" | "ops" | "mesh" | "workboard" | "fleet" | "sovereign-key" | "sovereignty" | "hands" | "smartlink" | "agentchat" | "one-net" | "proofs" | "energy" | "microgrid" | "coin" | "exchange" | "flow" | "roses" | "economy" | "recovery" | "research" | "ax";

export interface ViewDef {
  id: ViewId;
  label: string;
  short: string;
  desc: string;
  icon: ReactNode;
  group: string;
}

export const VIEWS: ViewDef[] = [
  {
    id: "overview",
    label: "לוח בקרה",
    short: "בקרה",
    desc: "מצב הפלטפורמה בזמן אמת — שרשרת, מטריצה ובריאות הגרעין",
    icon: <Anchor size={16} />,
    group: "תפעול"
  },
  {
    id: "worth",
    label: "מימוש — שווי הרשת החי",
    short: "מימוש",
    desc: "מה יש בידיים ומה הפוטנציאל האמיתי — מאזן חי מ-5 מקורות-אמת (ממומש · אחזקה · חמוש · מנוע) ופעימת מימוש שמבצעת ערך על הרשת עכשיו",
    icon: <Gem size={16} />,
    group: "תפעול"
  },
  {
    id: "treasury",
    label: "ספר האוצר — הכסף מתועד",
    short: "האוצר",
    desc: "הוראת הבעלים 'אתה יכול להשתמש בכסף אין בעיה תעשה מה שצריך אבל שיהיה תיעוד ברור' — ההרשאה בקוד · מלאי האוצר החי · כל הוצאה אי-פעם (עלות חיה מהקבלות) · הוצאות מאז ההרשאה · תוכנית 7 הדלתות · מדיניות ההוצאה",
    icon: <Landmark size={16} />,
    group: "תפעול"
  },
  {
    id: "irrigation",
    label: "ההשקיה החכמה — אוטונומית אבל בחוכמה",
    short: "השקיה",
    desc: "הוראת הבעלים 'המטרה שההשקיה תהיה אוטונומית אבל בחוכמה' — האורגניזם מטפטף גז לדלתות החשוכות בעצמו דרך פורטלים קנוניים מאומתי-שלשה · probe קודם + אימות-הגעה מה-L2 · שער-ההמרה הכן (הדקס שלנו + SOL/TRX שבארנק) · יומן-הטפטוף עם הוכחות",
    icon: <Droplets size={16} />,
    group: "תפעול"
  },
  {
    id: "agri",
    label: "ההשקיה החקלאית — מנוע דו-שכבתי",
    short: "אגרו",
    desc: "אותה חוכמה, שדה אחר: חיישני-קרקע × מזג-אוויר אמיתי (Open-Meteo חי) × שכבה 1 של כללים דטרמיניסטיים (ספים פר-גידול · מינון לפי גרעון · דחיית-גשם עם סבלנות 6 מחזורים · חיישן חשוד = עצירה) × שכבה 2 של יועץ אגרונום LLM · יומן-ביקורת לכל טיפה",
    icon: <Sprout size={16} />,
    group: "תפעול"
  },
  {
    id: "snapshot",
    label: "עוגן-החוץ — שימור-האמת מחוץ לסנדבוקס",
    short: "עוגן-חוץ",
    desc: "הלקח של roast-84 נעשה מציאות (v73): תקציר-מצב קנוני (איטום אחרון · מנייני-אמת · יומן-טפטוף · שער-ההמרה) נשזר, נחתם sha256, ומעוגן על STEEM ב-$0.00 — ההצהרה הציבורית של האמת שלנו, שורדת את מות-המכונה · מקצב-חקלאי: עוגן חדש רק כשהמצב זז",
    icon: <Anchor size={16} />,
    group: "תפעול"
  },
  {
    id: "syncradar",
    label: "מכ\"ם-הסנכרון — האמת האחרונה מול גיטהאב",
    short: "מכ\"ם-סנכרון",
    desc: "המכונה שנופלת לא יודעת שנפלה — נמדד חי בפתיחת v74 (המקומי ב-v73 בעוד origin החזיק r36). מעתה האורגניזם מודד בעצמו: fetch קריאה-בלבד מול origin/main בכל מחזור · סיווג כנה (מסונכרן · מפגר · מקדים · מפוצל · עץ-מלוכלך · לא-נמדד) · ריפוי ff-only בלבד כשהעץ נקי — אין merge, אין rebase, אין push, אין כפייה",
    icon: <Radar size={16} />,
    group: "תפעול"
  },
  {
    id: "roast",
    label: "רוסט-אמת — חשיפה עצמית",
    short: "רוסט",
    desc: "החשיפה העצמית החיה — כסף אמיתי מול נייר, השרת כפי שהוא, הסוכנים במספרים, וכל פער: טענה מול מציאות",
    icon: <Flame size={16} />,
    group: "תפעול"
  },
  {
    id: "networkmap",
    label: "מפת-רשתות — הארנק הרב-רשתי",
    short: "מפת-רשתות",
    desc: "איך ארנק אחד פותח הרבה רשתות — 22 זהויות נגזרות מאבן-הפינה ב-4 משפחות קריפטו, מפקד יתרות חי, אימותים-משולשים ועוגנים שנורו",
    icon: <Waypoints size={16} />,
    group: "תפעול"
  },
  {
    id: "bridges",
    label: "בית-היוצר לגשרים",
    short: "גשרים",
    desc: "תשתית לעוד גשרים לעוד רשתות — מטרות הגישור המקודדות, 24 נתיבים עם מנגנון והליך-פתיחה, 9 מסילות EVM במפקד חי (כולל SKALE), וטיסת-בדיקה שמוכיחה שהצינור מוכן בלי לגעת במפתח",
    icon: <Hammer size={16} />,
    group: "תפעול"
  },
  {
    id: "breakthrough",
    label: "מנוע פריצת-הדרך",
    short: "פריצת דרך",
    desc: "התשובה החיה ל‘מה יש לנו ביד · מה מגביל · איזו פריצה ובאיזו יעילות’ — מלאי-נכסים חי, אילוצים מקוונטפים, מועמדים מדורגים בהשפעה/מאמץ, תוכנית-השקיה ב-USD חי וציון-ריבונות",
    icon: <Lightbulb size={16} />,
    group: "תפעול"
  },
  {
    id: "conversion",
    label: "חדר ההמרה",
    short: "המרה",
    desc: "הכסף שב-TRON וב-SOL — איך הכל מומר על הרשת שלנו: המשמרת הריבונית מול המראה על SAOS-NET, שני מסלולי המרה, סנכרון-המראה לאמת, הוכחת-המרה חיה שנמדדת על השרשרת, ויומן המוכנות לקראת היישום",
    icon: <ArrowLeftRight size={16} />,
    group: "תפעול"
  },
  {
    id: "tuner",
    label: "מכוון הרשת",
    short: "מכוונן",
    desc: "מה מגביל אותנו ומה חוסם — במדידה: הקפאת-הdump של 125MB חוסלה (ניתוח-מצב + keeper=96), ריעוף 4ש'→120ms בכל המסילות, דירוג מגבילים חי עם ייחוס מי-משחרר, עדות לפני/אחרי מגששי 35ש', וצילומי-מדידה שנשמרים",
    icon: <Gauge size={16} />,
    group: "תפעול"
  },
  {
    id: "sovereign-net",
    label: "הרחבת הריבונות",
    short: "הרחבה",
    desc: "פתרונות ריבוניים נוספים שנמצאו על הרשת — דלת EVM בגז-חינם (SKALE), מסילות-מודול ב-RPC חינם, שכבות-פרסום NOSTR — בבדיקה חיה · עוגן-ynet אומת עצמאית · 16 הריפואים · סוופ-סודות ריבוני",
    icon: <Globe2 size={16} />,
    group: "תפעול"
  },
  {
    id: "network360",
    label: "רשת-360",
    short: "רשת-360",
    desc: "מפת האורגניזם החיה — 16 ריפואים במדידה מול GitHub · הישגים מאומתי-שרשרת · הצעדים הקריטיים",
    icon: <Boxes size={16} />,
    group: "תפעול"
  },
  {
    id: "security",
    label: "מגן — ריבונות אבטחה",
    short: "מגן",
    desc: "סורק-דימומים חי (עץ · היסטוריה · קנרית-זרע) · רישום מארחים מהימן · שומר-טוקנים — פישינג נחסם",
    icon: <ShieldCheck size={16} />,
    group: "תפעול"
  },
  {
    id: "recovery",
    label: "התאוששות — מארב headcorner",
    short: "התאוששות",
    desc: "מנוע ההשתלטות הריבונית על החשבון הגנוב — ספירת-חלון חיה, הוכחת-החזקה קריפטוגרפית, ומארב אוטונומי שמשלים את ההתאוששות ברגע הטריגר",
    icon: <Swords size={16} />,
    group: "תפעול"
  },
  {
    id: "reshut",
    label: "רשות — מטריצת הסמכויות",
    short: "רשות",
    desc: "אין חתימה בלי רשות — מי מוסמך, דרך איזה מפתח, עם אילו מגבלות · שובל-ביקורת אדום · בדיקת-שער חיה",
    icon: <Scale size={16} />,
    group: "תפעול"
  },
  {
    id: "keeper",
    label: "שומר — החייאה עצמית",
    short: "שומר",
    desc: "האורגניזם מחיה את עצמו — שמירה הדדית על הווב, השרשרת, הראנר והשומר · לחץ זיכרון בהתראה מוקדמת",
    icon: <HeartPulse size={16} />,
    group: "תפעול"
  },
  {
    id: "networks",
    label: "רשתות חיות",
    short: "רשתות",
    desc: "רשת-10 שרשראות במדידה חיה — ETH · SOL · BSC + צמדי DEX אמיתיים",
    icon: <Globe2 size={16} />,
    group: "תפעול"
  },
  {
    id: "agents",
    label: "מעקב סוכנים",
    short: "סוכנים",
    desc: "כל ריפואי האורגניזם (16 — גדל 8→12 ב-v58) במדידה חיה מול GitHub — דחיפות, קומיטים וטריות",
    icon: <Users size={16} />,
    group: "תפעול"
  },
  {
    id: "seals",
    label: "איטום ועגינה",
    short: "איטום",
    desc: "פעימות איטום: replay → merkle root → עוגנים → קבלה משורשרת-האש",
    icon: <ShieldCheck size={16} />,
    group: "תפעול"
  },
  {
    id: "ops",
    label: "מבצעי עגינה",
    short: "מבצעים",
    desc: "רישום כספת, מעטפות שידור dry-run ויומן תפעול — מוכנות שלב 2",
    icon: <RadioTower size={16} />,
    group: "תפעול"
  },
  {
    id: "mesh",
    label: "רשת החוזים",
    short: "חוזים",
    desc: `${MESH_CONTRACT_COUNT} חוזים משורשרים (שרשור-ליבה ${MESH_LINK_CHAIN_LENGTH}) על SAOS-EVM — חוזה מדבר לחוזה, ערך ופתרונות ללא עמלה`,
    icon: <Waypoints size={16} />,
    group: "תפעול"
  },
  {
    id: "workboard",
    label: "פקודות עבודה",
    short: "עבודה",
    desc: "חוזה SAOSWorkBoard (השביעי מתוך 10) — המפקדה מפרסמת, חיילים מבצעים, ומנוע הפתרונות (LLM) מייצר מסירה אמיתית מעוגנת לכל משימה",
    icon: <HardHat size={16} />,
    group: "תפעול"
  },
  {
    id: "fleet",
    label: "חימוש הצי",
    short: "הצי",
    desc: "mint קטן ל-SAOS + יתרות-פעולה ל-12 האטומים (11 פעילים לפי שער-החיות) על STEEM · ETH · SOL — עם עתודת פיתוח",
    icon: <Crosshair size={16} />,
    group: "תפעול"
  },
  {
    id: "sovereign-key",
    label: "המפתח הריבוני",
    short: "המפתח",
    desc: "המפתח של הבעלים — חתום בכספת, זורם לנזילות הפרטית, מגויס ב-mainnet",
    icon: <KeyRound size={16} />,
    group: "תפעול"
  },
  {
    id: "sovereignty",
    label: "מרשם-הריבונות — 17 תיקיות-גיט",
    short: "ריבונות",
    desc: "הוראת הבעלים 'לחזק את האוטונומיה והריבונות על כלל תיקיות הגיט' (v93) — מפקד חי: ענף/HEAD/סנכרון/ניקיון-עץ לכל ריפו · שכבת-המפתחות (כספת · חתימת-STEEM 4/4 · חנות-PAT) · פערים מגושרים · פסקי-טענות v96 למסמכי-הקנון",
    icon: <ShieldCheck size={16} />,
    group: "תפעול"
  },
  {
    id: "hands",
    label: "ידיים-ריבוניות — הצבא שנוגע בעולם",
    short: "ידיים",
    desc: "הוראת הבעלים 'עוד יכולות ועוד כוח לאוטונומיה הריבונית' (v109, אימוץ trycua/cua) — פני-שטח נמדדים-חי (דפדפן · משמר-dcg · גיט · שרשרת · מערכת-קבצים) · משימות-bench עם trajectory מתועד · היסטוריית-עדויות בגיט",
    icon: <Hand size={16} />,
    group: "תפעול"
  },
  {
    id: "smartlink",
    label: "החיבור החכם",
    short: "חיבור",
    desc: "הכספת ריבוי-הבתים + מלאי המפתחות שלך — ייבוא חכם ואימות חי מול השרשרות",
    icon: <Link2 size={16} />,
    group: "תפעול"
  },
  {
    id: "agentchat",
    label: "צ'אט הסוכנים",
    short: "צ'אט",
    desc: "צרף סוכנים כמוני דרך API — כותבים לנו ומבצעים פקודות-עבודה",
    icon: <MessagesSquare size={16} />,
    group: "תפעול"
  },
  {
    id: "one-net",
    label: "רשת-אחת — היחידה המתואמת",
    short: "רשת-אחת",
    desc: "הוראת הבעלים 'יחידה אחת, רשת אחת, הכל מתואם' — תמונת-מצב אחת מורכבת מכל המצרפים החיים: שבעת השירותים עם דופק ויומן-זנב · מצבת-הסוכנים · 16 הריפואים · עשרת החוזים · העבודה האמיתית · פנקס-הדופק (חי ≤120ש') — נגזר וכנה, בלי ירוק-מזויף",
    icon: <RadioTower size={16} />,
    group: "תפעול"
  },

  {
    id: "proofs",
    label: "הוכחות",
    short: "הוכחות",
    desc: "חבילות-הוכחה ציבוריות ואימות עצמאי — בלי לסמוך עלינו",
    icon: <GitBranch size={16} />,
    group: "תפעול"
  },
  {
    id: "energy",
    label: "ריבונות אנרגיה",
    short: "אנרגיה",
    desc: "TRX energize ליישובים והתאוששות Hive RC — הכיסוי האנרגטי של הרשת",
    icon: <Anchor size={16} />,
    group: "כלכלה ואנרגיה"
  },
  {
    id: "microgrid",
    label: "מיקרו-גריד",
    short: "מיקרו-גריד",
    desc: "GRID-98 על השרשרת — החוזה השמיני מתוך 10: אורקל מחירי-DEX אמיתיים · סולם 1.2% · רווח שנשטף לקופת העבודה · עומק DEX",
    icon: <Zap size={16} />,
    group: "כלכלה ואנרגיה"
  },
  {
    id: "coin",
    label: "המטבע — SAOS-M",
    short: "המטבע",
    desc: "כרטיס-זהות מלא של SAOS-M — זהות · אספקה (מדיניות מול חי) · מגורים על שתי שרשרות · גיבוי 1:1 · 5 בריכות · כלכלה · שערי-כנות — התשובה ל-\"צריך לדעת עליו הכל מהכל\"",
    icon: <Coins size={16} />,
    group: "כלכלה ואנרגיה"
  },
  {
    id: "exchange",
    label: "הבורסה",
    short: "הבורסה",
    desc: "בורסה ריבונית על SAOS-NET — צמדי המטבעות שלנו מול הגדולים בלבד · SAOS-M $0.001 · קציר לאוצר · ראוטר לדקסים · השרת על הרשת שלנו",
    icon: <ArrowLeftRight size={16} />,
    group: "כלכלה ואנרגיה"
  },
  {
    id: "flow",
    label: "נזילות וזרימה",
    short: "נזילות",
    desc: "מכ\"ם-נזילות חי (9 מרחבים · USD) · מפת-הזרימה מקורות→מנועים→לכידה · חימוש-מחדש ריבוני (תמונה→אימות→איטום)",
    icon: <Droplets size={16} />,
    group: "כלכלה ואנרגיה"
  },
  {
    id: "roses",
    label: "שושנים",
    short: "שושנים",
    desc: "גבול היכולות (10 זרועות × מדידה/חתימה/שידור/לכידה) · מה שהזרע מספק (36 זרועות חתימה) · מה שהרשת צריכה · סבב-הפריחה: כל סוכן בתורו נגזר מהזרע וחותם בעצמו — השרשרת משלמת",
    icon: <Flower2 size={16} />,
    group: "כלכלה ואנרגיה"
  },
  {
    id: "economy",
    label: "כלכלה",
    short: "כלכלה",
    desc: "סימולטור זרמי הכנסה וגלגל-החור — המנוע הכלכלי של העגינה",
    icon: <Anchor size={16} />,
    group: "כלכלה ואנרגיה"
  },
  {
    id: "research",
    label: "מחקר ומפת-דרך",
    short: "מחקר",
    desc: "פסק-הדין של מחקר-העומק והשלבים הבאים",
    icon: <GitBranch size={16} />,
    group: "מחקר"
  },
  {
    id: "ax",
    label: "הכרזה — תזמון דקלרטיבי (AX)",
    short: "הכרזה",
    desc: "מישור-ההכרזה הדקלרטיבי לסוכנים (אימוץ google/ax): מניפסטי ax.saos/v1alpha1, שער-מחמיר, רץ-יחיד reconcile, חוקי-תקציב, suspend/resume, סוויפ-זומבים",
    icon: <Workflow size={16} />,
    group: "מחקר"
  }
];

/**
 * פוטר-המוסד (R16) — סטטי לחלוטין: גרסה, שם-קוד ומניפסט-האיברים בלבד.
 * memo עוצר את הבנייה-מחדש של עץ-ה-DOM הענק בכל שנייה — AppShell מרנדר
 * כל שנייה (useClock) + כל 8ש' (useTick), אך הפוטר אינו תלוי שעון/נתונים.
 * v99: המניפסט (2,672 תווים) מקופל ב-<details> — 2 שורות גלויות בלבד,
 * והפוטר נשאר דביק-לתחתית (mt-auto על ה-footer, בתוך flex-col).
 */
const ShellFooter = memo(function ShellFooter() {
  // כותרת-תחתונה — דביקה
  return (
      <footer className="mt-auto border-t border-white/[0.06] bg-zinc-950/90 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2 text-[11px] pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <details className="saos-fold group/manifest">
            <summary className="flex cursor-pointer select-none items-center justify-between gap-3 min-h-[44px] text-zinc-400 hover:text-zinc-200 transition-colors">
              <span className="flex items-center gap-2 min-w-0">
                <Anchor size={12} className="text-amber-500/80 shrink-0" />
                <span className="font-medium truncate">
                  SAOS Sovereign Platform v{SAOS_VERSION} — {SAOS_CODENAME}
                </span>
              </span>
              <span className="flex items-center gap-1 shrink-0 font-medium text-amber-400/80 group-open/manifest:text-amber-300 transition-colors">
                המניפסט המלא
                <ChevronDown size={13} aria-hidden className="transition-transform group-open/manifest:rotate-180" />
              </span>
            </summary>
            <p className="mt-1 mb-2 ps-3 border-s-2 border-amber-400/20 leading-relaxed text-zinc-400 max-h-60 overflow-y-auto scroll-slim">
              מניפסט האיברים המצטבר (היסטורי, מ-v44): רוסט-אמת (TRUTH ROAST) · מימוש (REALIZATION: מנוע שווי-הרשת החי + פעימת המימוש) — התשובה הקודדת לשאלת הבעלים "מה יש לנו בידיים · מה הפוטנציאל האמיתי שאפשר לממש ממנו מנקודה זו": מאזן חי מ-5 מקורות-אמת (10 חוזי-המש · בורסה · מיקרו-גריד · כסף אמיתי ETH/BNB/XRP/TRX · מארב STEEM) מופרד לעולם ל: ממומש (הוכח — ריצות · מסירות · תזוזות) · אחזקה (חי ביד) · חמוש (ממתין לטריגר — לא נספר כהון) · מנוע (תקרות כנות) · ופעימת מימוש שמבצעת ערך על הרשת עכשיו — אורקל+סולם+שטיפה+קציר→קופת-עבודה+ריצה ריבונית אמיתית דרך כל 10 החוזים, הכל עם txid וקבלה משורשרת-האש) + חיבור (CHIBUR: הכסף שנמצא — ETH אבק + BNB + XRP מארנק אבן-הפינה (Coinomi) — מחובר לבורסה החיה: WBNB + WRXP נרשמים 1:1 מול המדידה, בריכות #3/#4 נזרעות, אספקת WETH מסונכרנת לאוצר האמיתי · מסילת XRPL חיה במכ"ם · בורסה ריבונית על SAOS-NET — צמדי המטבעות שלנו מול הגדולים בלבד · SAOS-M $0.001 מדיניות-נמוכה בכוונה · עמלה 20bps — 10 לקופת האוצר ו-10 לצמיחת הבריכה · נזילות שקוצרת OUT לאוצר ומוזרמת לקופת העבודה · חיילים סוחרים בהון-מסחר · ראוטר לדקסים המובילים — סטייה &gt;0.8% מתוקנת ע"י סוכן-ארביטראז' אוטונומי · השרת על הרשת שלנו — RPC חי דרך הפתח הציבורי ?XTransformPort=8545) + אחיזה (MAACHEZ: השומר לא רק מחיה — הוא גם משמר: מיחזור-עדין לפני OOM ב-RSS 1350MB (v55) לפני שהקרנל הורג ב-1790 — ומ-keeperv43: חלונות-תחייה נפרדים לכל איבר + מיחזור מיידי בקו-ההרג (שיעור 2026-09-12: הקרנל ניצח פעם, לא ינצח שוב · גיבויים ריבוניים כל 10 דק' — DB עקבי VACUUM INTO + שרשרת יומית בסבב 48+7 · דד-ליין 9ש' לפסי-הרשת) + SHOMER (שומר: החייאה עצמית — השגחה הדדית ווב⇄שומר⇄ראנר⇄anvil⇄שער, גלאי-זומבים על בסיס בלוקים + אמת-תפקוד (חי ≠ משרת — פיד שלא מתקדם = מת), מושב-יחיד לכל שירות (נעילת-PID — אין כפילויות) ואב-סנדק לרץ מהשער — אף איבר לא נשאר מת-תפקוד) + RESHUT (רשות: מטריצת הסמכויות — אין חתימה בלי רשות; 10 פעולות-מפתח ברישום מפורש, שחקנים מוסמכים בלבד, מגבלות קצב/היקף לפני גזירת-מפתח, שובל-ביקורת אדום מעודכ; יומן-פעולות אדום 100% — logOp מעודכ בכל שורה; מגן אוטומטי — סריקה מלאה במחזור-משתנה מה-runner (המדידה בפאנל)) + MAGEN (מגן: שער-פישינג fail-closed · שומר-טוקנים · קנרית-זרע) + RECOVERY (התאוששות v41: מארב headcorner — אמת-שתי-שרשרות חיה, הוכחת-החזקה קריפטוגרפית מול previous_owner_authority, ספירת-חלון עד 2026-10-08, והשתלטות אוטונומית ברגע שבקשה נושאת את הסמכות הריבונית — השומר בודק כל 60ש') + ROSES (סבב-הפריחה: סוכן אחד כל מחזור נגזר מהזרע החתום וחותם בעצמו ריצה, השרשרת משלמת) + CORNERSTONE (דו-שורש + מפעל-מפתחות דטרמיניסטי) + FLOW (מכ״ם-נזילות · חימום-מחדש) + MICROGRID (GRID-98 · אורקל DEX חי · שטיפה לקופה) + REAL WORK (מנוע LLM מעוגן) + WORK ORDERS + SOVEREIGN KEY + CONTRACT MESH + 10-CHAIN LIVE GRID + מעקב סוכנים
            </p>
          </details>
          <div className="flex flex-wrap items-center justify-between gap-2 py-1 text-zinc-500">
            <a
              href="https://github.com/roshpinacare-sys/saos-sovereign-platform"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center min-h-[44px] hover:text-amber-300 transition-colors"
            >
              GitHub
            </a>
            <span className="text-amber-500/80 font-semibold">הוכחות נושאות-ראיות · משורשרות-האש</span>
          </div>
        </div>
      </footer>
  );
});

/**
 * v99 — פס-הניווט המובייל (40 צ'יפים · ~3,800px גלילה):
 * memo — לא נבנה מחדש בכל שנייה עם השעון (AppShell מרנדר כל-שנייה);
 * הצ'יפ הפעיל נגלל אל מרכז-הפס (scrollIntoView inline:center) על כל שינוי-ויו;
 * scroll-snap + מסכות-fade בקצוות + הפרדות-קבוצות — ב-globals.css (.mobile-nav-scroll);
 * מטרות-מגע min-h-[44px] · active:scale-95 · gold-underline על הצ'יפ הפעיל.
 */
const MobileNav = memo(function MobileNav({
  view,
  onNav
}: {
  view: ViewId;
  onNav: (v: ViewId) => void;
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    activeRef.current?.scrollIntoView({
      block: "nearest",
      inline: "center",
      behavior: reduce ? "auto" : "smooth"
    });
  }, [view]);
  return (
    <nav
      aria-label="ניווט מובייל"
      className="mobile-nav-scroll lg:hidden flex gap-1.5 overflow-x-auto scroll-slim px-4 pb-2.5"
    >
      {VIEWS.map((v, i) => {
        const active = view === v.id;
        const groupStart = i > 0 && VIEWS[i - 1].group !== v.group;
        return (
          <Fragment key={v.id}>
            {groupStart && <span aria-hidden className="my-auto h-5 w-px shrink-0 bg-white/[0.08]" />}
            <button
              ref={active ? activeRef : undefined}
              onClick={() => onNav(v.id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-medium min-h-[44px]",
                "transition active:scale-95",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60",
                active
                  ? "gold-underline border-amber-400/40 bg-amber-400/10 text-amber-200"
                  : "border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:text-zinc-200"
              )}
            >
              <span className={active ? "text-amber-300" : "text-zinc-500"}>{v.icon}</span>
              {v.short}
            </button>
          </Fragment>
        );
      })}
    </nav>
  );
});

export function AppShell({
  view,
  onNav,
  status,
  children
}: {
  view: ViewId;
  onNav: (v: ViewId) => void;
  status: LiveResult<StatusData>;
  children: ReactNode;
}) {
  useTick(8000);
  const clock = useClock();
  const [spinning, setSpinning] = useState(false);
  const def = VIEWS.find((v) => v.id === view)!;
  const stats = status.data?.stats;
  const live = !status.error && !!status.data;
  const probes = useLive<LiveProbesData>("/api/saos/live-probes", 20000);
  const toast = useToast();
  const router = useRouter();

  // v99 — גובה-הכותרת הדביקה נמדד חי (מובייל: פס-הניווט יושב בתוך הכותרת → ~103px)
  // ומוזרם ל-var --saos-header-h על עמודת-התוכן; הטיקר נדבק מתחתיה
  // (sticky-under-header) במקום להיבלע מאחורי ה-header השקוף.
  const mainColRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const col = mainColRef.current;
    const header = headerRef.current;
    if (!col || !header || typeof ResizeObserver === "undefined") return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const h = header.offsetHeight;
      if (h > 0) col.style.setProperty("--saos-header-h", `${h}px`);
    };
    measure();
    const ro = new ResizeObserver(() => {
      if (!raf) raf = requestAnimationFrame(measure);
    });
    ro.observe(header);
    window.addEventListener("orientationchange", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("orientationchange", measure);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // v99 — onNav יציב-זהות (latest-ref) כדי ש-MobileNav ה-memo לא ירנדר מחדש
  // בכל שנייה עם השעון — רק שינוי-ויו מרנדר את פס-הניווט.
  const onNavRef = useRef(onNav);
  onNavRef.current = onNav;
  const stableNav = useCallback((v: ViewId) => onNavRef.current(v), []);

  // v97 — כניסת-מנהל (fail-closed): המפתח נבדק מול השרת בלבד; עוגיית-הסשן
  // HttpOnly נקבעת ב-route — בקוד-הלקוח היא לא נשמרת מעבר לשדה-הסיסמה.
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginKey, setLoginKey] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);

  const doLogin = async () => {
    if (loginBusy || !loginKey) return;
    setLoginBusy(true);
    try {
      const res = await fetch("/api/saos/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: loginKey }),
        cache: "no-store"
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && json?.ok) {
        toast.push({ title: "חיבור-מנהל פעיל", desc: "עוגיית-סשן חתומה HttpOnly — פעולות-הרשות פתוחות", tone: "green" });
        setLoginOpen(false);
        setLoginKey("");
        router.refresh();
      } else {
        toast.push({ title: "כניסה נכשלה (כנות)", desc: json?.error ?? `HTTP ${res.status}`, tone: "rose" });
      }
    } catch (e) {
      toast.push({ title: "שגיאת רשת בכניסה", desc: e instanceof Error ? e.message : "", tone: "rose" });
    } finally {
      setLoginBusy(false);
    }
  };

  const doRefresh = () => {
    status.refresh();
    probes.refresh();
    setSpinning(true);
    setTimeout(() => setSpinning(false), 700);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* סרגל-צד — דסקטופ */}
      <aside className="hidden lg:flex fixed inset-y-0 start-0 z-40 w-64 flex-col border-e border-white/[0.06] bg-zinc-950/80 backdrop-blur-md">
        {/* מותג */}
        <div className="flex items-center gap-3 px-5 h-16 border-b border-white/[0.06]">
          <div className="grid place-items-center h-9 w-9 rounded-xl border border-amber-400/30 bg-gradient-to-b from-amber-400/15 to-transparent">
            <Anchor size={18} className="text-amber-300" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold tracking-tight text-zinc-50 leading-none">
              SAOS <span className="text-amber-400">Sovereign</span>
            </p>
            <p className="text-[11px] text-zinc-400 mt-1">Network 360 · v{SAOS_VERSION} · {SAOS_CODENAME_SHORT}</p>
          </div>
        </div>

        {/* סטטוס שרשרת */}
        <div className="mx-4 mt-4 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-[11px] font-medium text-zinc-300">
              <LiveDot tone={live ? "green" : "zinc"} />
              {live ? "שרשרת חיה" : "מתחבר…"}
            </span>
            {stats && (
              <span className="text-[11px] font-bold tabular-nums text-amber-300" dir="ltr">
                #{stats.lastHeight}
              </span>
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-zinc-500">
            <span>{stats ? `${stats.seals} חותמים` : "—"}</span>
            <span>{status.updatedAt ? `עודכן ${timeAgo(status.updatedAt)}` : "—"}</span>
          </div>
        </div>

        {/* ניווט */}
        <nav className="flex-1 overflow-y-auto scroll-slim px-3 py-4 space-y-4" aria-label="ניווט ראשי">
          {["תפעול", "כלכלה ואנרגיה", "מחקר"].map((group) => (
            <div key={group}>
              <p className="px-2 mb-1.5 text-[11px] font-semibold text-zinc-500 tracking-wide">{group}</p>
              <ul className="space-y-0.5">
                {VIEWS.filter((v) => v.group === group).map((v) => {
                  const active = view === v.id;
                  return (
                    <li key={v.id}>
                      <button
                        onClick={() => onNav(v.id)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "relative w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors min-h-[44px]",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50",
                          active
                            ? "bg-white/[0.05] text-zinc-50"
                            : "text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.03]"
                        )}
                      >
                        {active && (
                          <span className="absolute inset-y-1.5 start-0 w-[2.5px] rounded-full bg-amber-400" aria-hidden />
                        )}
                        <span className={cn(active ? "text-amber-300" : "text-zinc-500")}>{v.icon}</span>
                        {v.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* תחתית סרגל */}
        <div className="border-t border-white/[0.06] px-4 py-3 space-y-1.5">
          <a
            href="https://github.com/roshpinacare-sys/saos-sovereign-platform"
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between text-[11px] text-zinc-500 hover:text-amber-300 transition-colors rounded-md min-h-[44px]"
          >
            הריפו הקנוני
            <ExternalLink size={11} />
          </a>
          <p dir="ltr" className="text-[11px] text-zinc-700 font-mono text-left">
            productionAuthority: NONE
          </p>
        </div>
      </aside>

      {/* אזור ראשי */}
      <div ref={mainColRef} className="flex flex-col flex-1 lg:ps-64">
        {/* סרגל-עליון */}
        <header ref={headerRef} className="sticky top-0 z-30 border-b border-white/[0.06] bg-zinc-950/85 backdrop-blur-md">
          <div className="flex items-center justify-between gap-3 h-14 px-4 sm:px-6">
            <div className="flex items-center gap-3 min-w-0">
              {/* מותג מובייל */}
              <div className="lg:hidden grid place-items-center h-8 w-8 rounded-lg border border-amber-400/30 bg-amber-400/10">
                <Anchor size={15} className="text-amber-300" />
              </div>
              <div className="hidden lg:block min-w-0">
                <h1 className="text-[15px] font-bold tracking-tight text-zinc-50 truncate">{def.label}</h1>
                <p className="text-[11px] text-zinc-400 truncate">{def.desc}</p>
              </div>
              <p className="lg:hidden text-sm font-bold text-zinc-100 truncate">{def.label}</p>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <Pill tone={live ? "green" : "zinc"} pulse={live} className="hidden sm:inline-flex">
                {live ? "מחובר" : "מנותק"}
              </Pill>
              <span
                dir="ltr"
                className="hidden md:inline-flex items-center text-xs font-semibold tabular-nums text-zinc-400"
                title="שעון מוסדי — Asia/Jerusalem"
              >
                {clock}
              </span>
              {/* v97 — כניסת-מנהל: השער לפעולות-הרשות (POST-ים רגישים 401 בלעדיה) */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLoginOpen(true)}
                className="h-11 gap-1.5 border-white/[0.08] bg-white/[0.02] px-2.5 text-[11px] text-zinc-300 hover:border-amber-400/40 hover:bg-amber-400/10 hover:text-amber-200 focus-visible:ring-amber-400/60"
                aria-label="כניסת-מנהל — אימות לפעולות רגישות"
              >
                <KeyRound size={13} className="text-amber-300/80" />
                <span className="hidden sm:inline">כניסת-מנהל</span>
                <span className="sm:hidden">מנהל</span>
              </Button>
              <button
                onClick={doRefresh}
                title="רענון נתונים"
                aria-label="רענון"
                className="grid place-items-center h-11 w-11 rounded-lg border border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:text-amber-300 hover:border-amber-400/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
              >
                <RefreshCcw size={14} className={cn(spinning && "animate-spin")} />
              </button>
            </div>
          </div>

          {/* ניווט מובייל — גלילה אופקית · v99: memo + scrollIntoView + snap + fade */}
          <MobileNav view={view} onNav={stableNav} />
        </header>

        {/* פס-פיקוד 10-רשתות — חי מול live-probes (SAOS-NET + 9 מסילות חיצוניות) */}
        <ChainTicker height={stats?.lastHeight} status={status} probes={probes} />

        {/* תוכן */}
        <main className="relative flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 pt-6 pb-10">
          <div className="console-grid pointer-events-none absolute inset-x-0 top-0 h-64" aria-hidden />
          <div className="relative">{children}</div>
        </main>

        {/* כותרת-תחתונה — דביקה · R16: memo, אינה נבנית-מחדש עם השעון */}
        <ShellFooter />
      </div>

      {/* v97 — דיאלוג כניסת-מנהל: POST /api/saos/auth {key} — fail-closed */}
      <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
        <DialogContent dir="rtl" className="max-w-[380px] gap-4 border-white/[0.08] bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <KeyRound size={15} className="text-amber-300" />
              כניסת-מנהל
            </DialogTitle>
            <DialogDescription className="text-[11.5px] leading-relaxed text-zinc-400">
              המפתח נבדק מול ה-hash בשרת בלבד (fail-closed) — העוגייה חתומה, HttpOnly, ולא נשמרת בקוד-הלקוח. מגבלה: 8 ניסיונות לדקה.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void doLogin();
            }}
            className="space-y-4"
          >
            <Input
              type="password"
              value={loginKey}
              onChange={(e) => setLoginKey(e.target.value)}
              placeholder="מפתח-מנהל"
              autoComplete="off"
              dir="ltr"
              aria-label="מפתח-מנהל"
              className="h-10 border-white/[0.1] bg-zinc-950/60 text-zinc-100"
            />
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setLoginOpen(false)}
                className="h-11 text-zinc-400 hover:text-zinc-200"
              >
                ביטול
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={loginBusy || !loginKey}
                className="h-11 gap-1.5 bg-amber-400 text-zinc-950 hover:bg-amber-300"
              >
                {loginBusy ? (
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-zinc-500/40 border-t-zinc-200 animate-spin" aria-hidden />
                ) : (
                  <KeyRound size={13} />
                )}
                התחבר
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── ChainTicker — פס-פיקוד 10-רשתות חי ───────────────────────────────────────
// SAOS-NET (גובה) · STEEM/BLURT (עוגן) · HIVE (RC) · TRON (מעבר)
// · ETHEREUM (בלוק) · BSC (בלוק + מאזן BNB) · SOLANA (slot) · XRPL (עוגן אבן-הפינה v96) · ZERO (גז-אפס)
// — מדידה read-only מול RPC ציבורי.

interface TickerChip {
  id: string;
  name: string;
  value: string;
  tone: "gold" | "green" | "amber" | "rose" | "zinc";
  label: string;
}

function dotTone(t: TickerChip["tone"]): string {
  switch (t) {
    case "gold":
      return "bg-amber-400";
    case "green":
      return "bg-emerald-400";
    case "amber":
      return "bg-amber-300";
    case "rose":
      return "bg-rose-400";
    default:
      return "bg-zinc-500";
  }
}

function ChainTicker({
  height,
  status,
  probes
}: {
  height: number | undefined;
  status: LiveResult<StatusData>;
  probes: LiveResult<LiveProbesData>;
}) {
  const matrix = status.data?.matrix ?? [];
  const gateOf = (n: string) => matrix.find((m) => m.network === n);
  const p = probes.data;

  const hive = gateOf("HIVE");
  const tronGate = gateOf("TRON");
  const hiveRc = p?.hive?.rcPct ?? null;

  const chips: TickerChip[] = [
    {
      id: "saosnet",
      name: "SAOS-NET",
      value: height != null ? `#${height}` : "…",
      tone: "gold",
      label: "שרשרת ריבונית"
    },
    {
      id: "steem",
      name: "STEEM",
      value: "עוגן",
      tone: gateOf("STEEM")?.status === "anchored" ? "green" : "amber",
      label: "מסילת-עגינה"
    },
    {
      id: "blurt",
      name: "BLURT",
      value: "עוגן",
      tone: gateOf("BLURT")?.status === "anchored" ? "green" : "amber",
      label: "מסילת-עגינה"
    },
    {
      id: "hive",
      name: "HIVE",
      value: hiveRc != null ? `RC ${hiveRc.toFixed(1)}%` : hive?.status === "gated" ? "חסום-RC" : "…",
      tone: hive?.status === "gated" || (hiveRc != null && hiveRc < 8) ? "rose" : "green",
      label: "RC-gated"
    },
    {
      id: "tron",
      name: "TRON",
      value: tronGate?.status === "transit" ? "מעבר" : (tronGate?.status ?? "…"),
      tone: tronGate?.status === "anchored" ? "green" : "zinc",
      label: "רכב-מעבר"
    },
    {
      id: "eth",
      name: "ETHEREUM",
      value: p?.eth?.blockNumber != null ? fmtInt(p.eth.blockNumber) : "…",
      tone: p?.eth?.ok ? "green" : "zinc",
      label: p?.eth?.gasPriceGwei != null ? `${p.eth.gasPriceGwei} Gwei` : "רכב-חי"
    },
    {
      id: "bsc",
      name: "BSC",
      value: p?.bsc?.blockNumber != null ? fmtInt(p.bsc.blockNumber) : "…",
      tone: p?.bsc?.ok ? "green" : "zinc",
      label:
        p?.bsc?.sovereign?.bnb != null
          ? `BNB ${Number(p.bsc.sovereign.bnb).toFixed(4)} · ${p.bsc.gasPriceGwei ?? "—"} Gwei`
          : "רכב-חי (ממתין להקצאה)"
    },
    {
      id: "sol",
      name: "SOLANA",
      value: p?.sol?.slot != null ? fmtInt(p.sol.slot) : "…",
      tone: p?.sol?.ok ? "green" : "zinc",
      label:
        p?.sol?.epoch != null
          ? `epoch ${p.sol.epoch}${p.sol.epochProgressPct != null ? ` · ${p.sol.epochProgressPct}%` : ""}`
          : "רכב-חי"
    },
    {
      // v98 — XRPL joins the ticker: the flagship v96 cornerstone anchor is a
      // measured matrix row (/api/saos/status) — no longer invisible in the bar.
      id: "xrpl",
      name: "XRPL",
      value: gateOf("XRPL")?.status === "anchored" ? "עוגן" : "…",
      tone: gateOf("XRPL")?.status === "anchored" ? "green" : "zinc",
      label: "מסילת-עגינה · אבן-הפינה v96"
    },
    {
      // v98 — ZERO joins the ticker: the zero-gas rail (anchored since v94).
      id: "zero",
      name: "ZERO",
      value: gateOf("ZERO")?.status === "anchored" ? "עוגן" : "גז-אפס",
      tone: gateOf("ZERO")?.status === "anchored" ? "green" : "zinc",
      label: "מסילת-האפס · Z Chain גז-אפס"
    }
  ];

  const online =
    (p?.hive?.ok ? 1 : 0) +
    (p?.tron?.ok ? 1 : 0) +
    (p?.eth?.ok ? 1 : 0) +
    (p?.sol?.ok ? 1 : 0) +
    (p?.bsc?.ok ? 1 : 0);

  return (
    <div
      className="sticky sticky-under-header z-20 border-b border-white/[0.05] bg-zinc-950/80 backdrop-blur-md"
      role="status"
      aria-label="פס-פיקוד 10 רשתות חי"
    >
      <div className="max-w-6xl mx-auto px-3 sm:px-6 flex items-center gap-1 overflow-x-auto scroll-slim h-9">
        <span className="hidden sm:inline-flex items-center gap-1.5 shrink-0 pe-2 me-1 border-e border-white/[0.06] text-[11px] font-bold tracking-wider text-amber-400/80 uppercase">
          10-Chain
        </span>
        {chips.map((c) => (
          <span
            key={c.id}
            title={c.label}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 hover:bg-white/[0.04] transition-colors"
          >
            <span className="relative flex h-1.5 w-1.5" aria-hidden>
              <span className={`absolute inline-flex h-full w-full rounded-full ${dotTone(c.tone)} opacity-60 animate-ping`} />
              <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dotTone(c.tone)}`} />
            </span>
            <span dir="ltr" className="text-[11px] font-bold tracking-tight text-zinc-300">
              {c.name}
            </span>
            <span
              dir={/[0-9]/.test(c.value) ? "ltr" : "rtl"}
              className="text-[11px] font-semibold tabular-nums text-zinc-400 whitespace-nowrap"
            >
              {c.value}
            </span>
          </span>
        ))}
        <span className="shrink-0 ms-auto ps-2 text-[11px] text-zinc-500 hidden sm:inline" dir="ltr">
          probes {online}/5
        </span>
      </div>
    </div>
  );
}

// ─── PageHead — כותרת עמוד פנימית ───────────────────────────────────────────

export function PageHead({
  title,
  sub,
  actions
}: {
  title: string;
  sub?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div className="min-w-0 flex-1">
        <h2 className="text-xl font-bold tracking-tight text-zinc-50">{title}</h2>
        {sub && <p className="mt-1 text-xs text-zinc-500 leading-relaxed max-w-2xl">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
