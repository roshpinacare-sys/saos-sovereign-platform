/**
 * Canonical JSON — deterministic serialization (עיקרון: סדר שדות קבוע, בלי float).
 * Ported from: unified-platform `src/contracts/crypto.ts` + steem-main kernel discipline.
 * Rejects cycles, symbols, sparse arrays and accessors — fail-closed.
 */

export class CanonicalJsonError extends Error {}

function fail(msg: string): never {
  throw new CanonicalJsonError(msg);
}

export function canonicalize(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (v === null || v === undefined) return null;
    const t = typeof v;
    if (t === "number") {
      const n = v as number;
      if (!Number.isFinite(n)) fail("float/inf rejected — integers only");
      if (!Number.isSafeInteger(n)) fail("unsafe integer rejected");
      return n;
    }
    if (t === "bigint") return Number(v);
    if (t === "boolean") return v;
    if (t === "string") return v;
    if (t === "symbol" || t === "function") fail("symbol/function rejected");
    if (t === "object") {
      const o = v as object;
      if (seen.has(o)) fail("circular reference rejected");
      seen.add(o);
      if (Array.isArray(o)) {
        return o.map((x) => {
          if (x === undefined) return null; // sparse array collapsed
          return walk(x);
        });
      }
      if (o instanceof Date) return o.toISOString();
      const entries = Object.entries(o as Record<string, unknown>)
        .filter(([, val]) => val !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const out: Record<string, unknown> = {};
      for (const [k, val] of entries) out[k] = walk(val);
      return out;
    }
    fail(`unsupported type ${t}`);
  };
  return JSON.stringify(walk(value));
}

/** sha256 over canonical JSON — the universal digest of the platform */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function canonicalDigest(value: unknown): Promise<string> {
  return sha256Hex(canonicalize(value));
}
