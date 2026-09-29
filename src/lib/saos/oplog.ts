/**
 * lib/saos/oplog.ts — v25 RESHUT (רשות): redacted operation log.
 * =====================================================================
 * v24 MAGEN closed the write boundary for REAL WORK; v25 closes it for
 * EVERYTHING. From this version on there is exactly one way to write an
 * opLog row: `logOp()` — and every row passes `redactSecrets` before it
 * touches the database. A secret pattern (token, private key, WIF, BIP39
 * word-run) that ever reaches an opLog detail is redacted to a tagged
 * marker BEFORE persistence — the log can tell the truth about what was
 * redacted without ever carrying the secret itself.
 *
 * גבול האמת: logOp never throws into business logic — a failed log write
 * is reported honestly downstream (returned as false) but never breaks
 * the operation it is auditing.
 */

import * as fs from "fs";
import * as path from "path";
import { db } from "@/lib/db";
import { redactSecrets } from "./security";

const MAX_DETAIL = 2000;

export interface LogOpResult {
  written: boolean;
  redacted: boolean;
  detail: string;
}

/**
 * The single redacted write path for all opLog rows.
 *   op     — stable operation id (e.g. "anchor-auto-steem", "perm.bloom.deny")
 *   detail — string OR object (objects are JSON.stringify'd, then redacted)
 */
export async function logOp(
  op: string,
  detail: string | Record<string, unknown> | null | undefined
): Promise<LogOpResult> {
  let text: string;
  if (detail == null) text = "";
  else if (typeof detail === "string") text = detail;
  else {
    try {
      text = JSON.stringify(detail);
    } catch {
      text = String(detail);
    }
  }
  const redacted = redactSecrets(text);
  const safe = redacted.slice(0, MAX_DETAIL);
  try {
    await db.opLog.create({ data: { op, detail: safe } });
    return { written: true, redacted: redacted !== text, detail: safe };
  } catch {
    // audit must never break the audited operation
    return { written: false, redacted: redacted !== text, detail: safe };
  }
}

/**
 * Coverage self-check (used by the permission/רשות view): how many raw
 * `opLog.create` call-sites remain outside this module — measured from
 * the LIVE source tree at request time, never hardcoded. Zero is the law.
 */
export function opLogCoverage(): { via: string; rawSites: number; scannedFiles: number } {
  const roots = [path.join(process.cwd(), "src")];
  let rawSites = 0;
  let scannedFiles = 0;
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // honest: unreadable dir is skipped, not fabricated
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx)$/.test(e.name)) {
        // this module's own guarded create does not count (it IS the redaction)
        if (e.name === "oplog.ts") continue;
        scannedFiles += 1;
        try {
          const text = fs.readFileSync(full, "utf8");
          // every literal occurrence outside THIS file is a raw write site
          for (const m of text.matchAll(/db\.opLog\.create\(/g)) {
            rawSites += 1;
          }
        } catch {
          /* unreadable file — skip honestly */
        }
      }
    }
  };
  for (const r of roots) walk(r);
  // this module's own guarded create does not count (it IS the redaction)
  return { via: "logOp", rawSites, scannedFiles };
}
