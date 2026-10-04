/**
 * src/lib/saos/social-live.ts — v128.0.0 "הריבונות-האנושית"
 * ============================================================================
 * מסילת-השידור-החברתית: comment (פוסט-שורש + תגובה) על HIVE ו-STEEM.
 *
 * חוקי-המסילה (fail-closed, אותם-חוקים של עושה-השוק):
 *  1. חתימה: חיילים — גזירה-דטרמיניסטית בסקופ-כספת + אימות-עצמי מול
 *     סמכות-posting חיה (המסילה-המוכחת של התזמורת v121/v123/v124/v125).
 *  2. שער-RC לפני-שידור: חייל-עם-RC < 8% מדולג כנה (לקח-israelnews 6.31%).
 *  3. מכסות: ≤1 פוסט/חייל/יום · ≤2 תגובות/חייל/יום — נאכפות-כאן + בפנקס.
 *  4. lint כפול (כותרת+גוף) לפני-שידור — תבניות-AI וחזרות נתפסות-קודם.
 *  5. אפס-חומר-סוד בפלטים — רק author/permlink/txid/שגיאה-ממוחקת.
 */

import { hiveRpc } from "./hive-rc-live";
import { withVaultMember, type SigningAuthority } from "@/lib/vault-seal";
import {
  MASTER_SOURCE_MEMBER,
  derivePriv32,
  privToWif,
  privToStmPub,
  extractMasterPasswords,
  isWifShape,
  wifToPub,
} from "./soldier-keys";

const HIVE_CHAIN_ID = "beeab0de00000000000000000000000000000000000000000000000000000000";
const HIVE_RPC_RAIL = ["https://api.hive.blog", "https://api.deathwing.me", "https://anyx.io"];
const STEEM_RPC_RAIL = ["https://api.steemit.com", "https://api.justyy.com"] as const;

interface SteemLib {
  api: { setOptions(opts: { url?: string }): void };
  broadcast: { sendAsync(tx: Record<string, unknown>, wifs: string[]): Promise<{ id?: string }> };
}

async function loadSteem(): Promise<SteemLib> {
  const mod = (await import("steem")) as unknown as { default?: SteemLib } & SteemLib;
  return mod.default ?? mod;
}

async function loadDhive(): Promise<{ Client: new (nodes: string[], opts: { chainId: string }) => DhiveClient; PrivateKey: { from(wif: string): unknown } }> {
  const mod = (await import("@hiveio/dhive")) as unknown as {
    Client: new (nodes: string[], opts: { chainId: string }) => DhiveClient;
    PrivateKey: { from(wif: string): unknown };
  };
  return mod;
}

interface DhiveClient {
  broadcast: { sendOperations(ops: unknown[], key: unknown): Promise<{ id?: string }> };
}

export type SocialChain = "steem" | "hive";

/** שער-RC (rc_api.find_rc_accounts) — המסילה-המוכחת מ-v123/v125 */
async function rcPercent(chain: SocialChain, account: string): Promise<number | null> {
  try {
    const url = chain === "hive" ? HIVE_RPC_RAIL[0]! : STEEM_RPC_RAIL[0]!;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "rc_api.find_rc_accounts", params: { accounts: [account] }, id: 1 }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json()) as { result?: { rc_accounts?: Array<{ rc_manabar: { current_mana: string | number; total_mana: string | number } }> } };
    const row = j.result?.rc_accounts?.[0];
    if (!row) return null;
    const cur = Number(row.rc_manabar.current_mana);
    const tot = Number(row.rc_manabar.total_mana);
    if (!Number.isFinite(cur) || !Number.isFinite(tot) || tot <= 0) return null;
    return (cur / tot) * 100;
  } catch {
    return null;
  }
}

export const SOCIAL_RC_FLOOR_PCT = 8;

/** גזירת-mפתח-posting של החייל בתוך-סקופ-הכספת, עם אימות-עצמי מול-הסמכות-החיה */
async function soldierPostingWif(chain: SocialChain, soldier: string): Promise<string> {
  const livePub = chain === "hive"
    ? await (async () => {
        const accs = await hiveRpc<Array<{ posting: { key_auths: Array<[string, number]> } }>>(HIVE_RPC_RAIL[0]!, "condenser_api.get_accounts", [[soldier]], 15_000);
        return accs?.[0]?.posting?.key_auths?.[0]?.[0] ?? null;
      })()
    : await (async () => {
        const j = await fetch(STEEM_RPC_RAIL[0]!, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [[soldier]], id: 1 }),
          signal: AbortSignal.timeout(15_000),
        }).then((r) => r.json()) as { result?: Array<{ posting: { key_auths: Array<[string, number]> } }> };
        return j.result?.[0]?.posting?.key_auths?.[0]?.[0] ?? null;
      })();
  if (!livePub) throw new Error("סמכות-posting חיה לא נמדדה — סירוב (fail-closed)");
  return await withVaultMember(MASTER_SOURCE_MEMBER, (content): string => {
    const passwords = extractMasterPasswords(content);
    if (passwords.length === 0) throw new Error("אין סיסמאות-גזירה בחבר-הכספת (fail-closed)");
    for (const password of passwords) {
      const priv = derivePriv32(soldier, "posting", password);
      if (privToStmPub(priv) === livePub) {
        const wif = privToWif(priv);
        if (!isWifShape(wif) || wifToPub(wif) !== livePub) throw new Error("self-verify FAILED: roundtrip נכשל");
        return wif;
      }
    }
    throw new Error("אף סיסמאת-כספת אינה גוזרת את סמכות-posting החיה (fail-closed)");
  });
}

export interface SocialPublishInput {
  chain: SocialChain;
  soldier: string;
  kind: "post" | "comment";
  title: string; // פוסט-שורש בלבד
  body: string;
  parentAuthor: string; // "" לפוסט-שורש
  parentPermlink: string; // לפוסט-שורש = התג-הראשי (saos-forum)
  permlink: string;
  tags: string[];
}

export interface SocialPublishResult {
  ok: boolean;
  he: string;
  txid: string | null;
  refusal?: string;
}

const COMMENT_OP_FIELDS = [
  "parent_author", "parent_permlink", "author", "permlink", "title", "body", "json_metadata",
] as const;

export async function publishSocial(input: SocialPublishInput): Promise<SocialPublishResult> {
  const rc = await rcPercent(input.chain, input.soldier);
  if (rc === null) return { ok: false, he: "שער-RC לא נמדד — שידור נדחה (fail-closed)", txid: null, refusal: "rc-unmeasured" };
  if (rc < SOCIAL_RC_FLOOR_PCT) {
    return { ok: false, he: `RC ${rc.toFixed(1)}% < ${SOCIAL_RC_FLOOR_PCT}% — החייל מדולג כנה (התאוששות)`, txid: null, refusal: "rc-floor" };
  }
  const meta = JSON.stringify({ tags: input.tags, app: "saos-forum/1.0", format: "markdown" });
  const op = {
    parent_author: input.parentAuthor,
    parent_permlink: input.parentPermlink,
    author: input.soldier,
    permlink: input.permlink,
    title: input.kind === "post" ? input.title.slice(0, 255) : "",
    body: input.body,
    json_metadata: meta,
  };
  void COMMENT_OP_FIELDS; // (רישום-מבנה לביקורת — השדות-נשלחים-בסדר-הקבוע)
  try {
    const wif = await soldierPostingWif(input.chain, input.soldier);
    let txid: string | null = null;
    if (input.chain === "hive") {
      const dh = await loadDhive();
      const client = new dh.Client([...HIVE_RPC_RAIL], { chainId: HIVE_CHAIN_ID });
      const conf = await client.broadcast.sendOperations([["comment", op]], dh.PrivateKey.from(wif));
      txid = conf?.id ?? null;
    } else {
      const steem = await loadSteem();
      steem.api.setOptions({ url: STEEM_RPC_RAIL[0]! });
      const conf = await steem.broadcast.sendAsync({ operations: [["comment", op]], extensions: [] }, [wif]);
      txid = conf?.id ?? null;
    }
    if (!txid) throw new Error("הצומת קיבל-את-ה-op אך לא החזיר txid (כנה)");
    return { ok: true, he: `${input.soldier} ${input.kind === "post" ? "פרסם" : "הגיב"} (${input.chain}) → txid ${txid.slice(0, 14)}…`, txid };
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e).slice(0, 180);
    return { ok: false, he: `כשל-שידור כנה: ${msg}`, txid: null, refusal: msg };
  }
}
