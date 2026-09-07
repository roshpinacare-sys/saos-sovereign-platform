/**
 * Historic anchor references — the public record from the previous network
 * (recorded before this sandbox; partial txids as published in the report).
 * Never fabricated: these are partial references with explicit provenance.
 */

export interface HistoricAnchor {
  network: "STEEM" | "BLURT" | "HIVE" | "TRON";
  txRef: string | null;
  state: string;
  note: string;
}

export const HISTORIC_ANCHORS: HistoricAnchor[] = [
  {
    network: "STEEM",
    txRef: "3452e62bc3bf5b…dee9ee1003",
    state: "anchored",
    note: "custom_json saos.weave.v1 — מאומרת בהיסטוריה החיה, מסומנת כרפרנס חלקי"
  },
  {
    network: "BLURT",
    txRef: "50a857ccaf49bd…5c4c3e6a9c",
    state: "anchored",
    note: "חתימה קנונית ידנית — אימות חסימה נקרא-חזרה"
  },
  {
    network: "HIVE",
    txRef: null,
    state: "pending",
    note: "rc-gated: 0.6%<12% — רגן-תקציב, המתנה כנה לפעימה הבאה"
  },
  {
    network: "TRON",
    txRef: null,
    state: "transit",
    note: "root נישא בתוך stateRoot → רכבת tronbridge היומית"
  }
];
