/**
 * scripts/diag-snapshot-authority.ts — v73 诊断:哪些签名权威真正活在链上。
 * 一次性的诚实测量,零秘密输出:只打印派生公钥(公开材料)与链上权威(公开),
 * 永远不打印 WIF。回答三个问题:
 *   (1) vault 的 ACTIVE_WIF 派生的公钥,是否在 headcorner 链上 active 权威里?
 *   (2) vault 的 POSTING_WIF 派生的公钥,是否在 headcorner 链上 posting 权威里?
 *   (3) custom_json 的 posting 路径(required_posting_auths)是否是活的替代?
 */
import { withRoleWif, roleWifAvailable } from "../src/lib/vault-seal";

interface CondenserAccount {
  posting?: { key_auths?: Array<[string, number]> };
  active?: { key_auths?: Array<[string, number]> };
}

async function chainAuthorities(account: string): Promise<{ active: string[]; posting: string[] }> {
  const res = await fetch("https://api.steemit.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "condenser_api.get_accounts",
      params: [[account]]
    }),
    signal: AbortSignal.timeout(12_000)
  });
  const j = (await res.json()) as { result?: CondenserAccount[] } | null;
  const a = j?.result?.[0];
  return {
    active: (a?.active?.key_auths ?? []).map((x) => x[0]),
    posting: (a?.posting?.key_auths ?? []).map((x) => x[0])
  };
}

interface SteemLibDiag {
  auth: {
    isWif(wif: string): boolean;
    wifToPublic(wif: string): string;
  };
}

async function main(): Promise<void> {
  const mod = (await import("steem")) as unknown as { default?: SteemLibDiag } & SteemLibDiag;
  const steem: SteemLibDiag = mod.default ?? mod;

  const hasActive = await roleWifAvailable("active");
  const hasPosting = await roleWifAvailable("posting");
  console.log("vault: ACTIVE_WIF present =", hasActive, "· POSTING_WIF present =", hasPosting);

  let account = "";
  try {
    await withRoleWif("active", async (wif, auth) => {
      account = auth.account;
      const pub = steem.auth.wifToPublic(wif);
      const chain = await chainAuthorities(auth.account);
      console.log("account (from vault env):", auth.account);
      console.log("vault ACTIVE_WIF derives to:", pub, "(public material only)");
      console.log("chain active keys:", chain.active.join(" , ") || "(empty)");
      console.log("ACTIVE match:", chain.active.includes(pub));
      console.log("chain posting keys:", chain.posting.join(" , ") || "(empty)");
      console.log("ACTIVE-key in posting auth:", chain.posting.includes(pub));
    });
  } catch (e) {
    console.log("active session failed honestly:", e instanceof Error ? e.message : String(e));
  }

  try {
    await withRoleWif("posting", async (wif, auth) => {
      account = account || auth.account;
      const pub = steem.auth.wifToPublic(wif);
      const chain = await chainAuthorities(auth.account);
      console.log("vault POSTING_WIF derives to:", pub, "(public material only)");
      console.log("POSTING match:", chain.posting.includes(pub));
    });
  } catch (e) {
    console.log("posting session failed honestly:", e instanceof Error ? e.message : String(e));
  }
}

main().catch((e) => {
  console.error("diag failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
