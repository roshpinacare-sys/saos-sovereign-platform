import { guardPermission } from "@/lib/saos/permissions";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appendChainedReceipt } from "@/lib/chained-receipt";
import { logOp } from "@/lib/saos/oplog";
import { readSovereignWallets, readSealInventory } from "@/lib/vault-seal";
import {
  RELAY_SOURCE,
  RELAY_VERSION,
  RELAY_COMPILER,
  chainCfg,
  deploySovereignRelay,
  relayAnchorThroughContract,
  relayEnlistThroughContract,
  relayReadiness,
  verifyRelayOnChain,
  type RelayChain
} from "@/lib/saos/relay-contract";

export const dynamic = "force-dynamic";

/**
 * GET  /api/saos/contract                     — status: contracts (per chain),
 *        live eth_getCode verification, source, costs, sovereign balance.
 * POST /api/saos/contract {action:"deploy", chain?} — deploy SAOSRelay
 *      (ETHEREUM live · BSC honestly gated until a BNB allocation).
 * POST /api/saos/contract {action:"relay", height?}  — anchor a seal root
 *      THROUGH the deployed contract (real tx, real event).
 * POST /api/saos/contract {action:"enlist", agent}   — enlist a vault-verified
 *      agent identity through the contract (whitelist from the seal).
 *
 * Honesty contract: txids only from the node · one deploy per chain ·
 * one relay per seal · one enlist per agent · failures recorded as rows.
 */

const NETWORK_OF: Record<RelayChain, string> = {
  ethereum: "ETHEREUM", bsc: "BSC", polygon: "POLYGON", arbitrum: "ARBITRUM",
  optimism: "OPTIMISM", base: "BASE", avalanche: "AVALANCHE", gnosis: "GNOSIS",
  skale: "SKALE" // v69 מסילה 9 — הדלת הזולה (גז נומינלי)
};

function safeParse(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface ContractRowOut {
  chain: string;
  network: string;
  kind: string;
  address: string;
  deployer: string | null;
  txid: string | null;
  blockNumber: number | null;
  gasUsed: number | null;
  costNative: string | null;
  bytecodeHash: string | null;
  runtimeBytes: number | null;
  status: string;
  explorer: string | null;
  createdAt: string;
}

function rowOut(r: {
  chain: string;
  kind: string;
  address: string;
  deployer: string | null;
  txid: string | null;
  blockNumber: number | null;
  gasUsed: number | null;
  costNative: string | null;
  bytecodeHash: string | null;
  runtimeBytes: number | null;
  status: string;
  meta: string | null;
  createdAt: Date;
}): ContractRowOut {
  const cfg = chainCfg(r.chain as RelayChain);
  return {
    chain: r.chain,
    network: NETWORK_OF[r.chain as RelayChain],
    kind: r.kind,
    address: r.address,
    deployer: r.deployer,
    txid: r.txid,
    blockNumber: r.blockNumber,
    gasUsed: r.gasUsed,
    costNative: r.costNative,
    bytecodeHash: r.bytecodeHash,
    runtimeBytes: r.runtimeBytes,
    status: r.status,
    explorer: r.txid ? cfg.explorerTx(r.txid) : r.address ? cfg.explorerAddr(r.address) : null,
    createdAt: r.createdAt.toISOString()
  };
}

export async function GET() {
  try {
    const rows = await db.sovereignContract.findMany({ orderBy: { createdAt: "asc" } });

    // live on-chain verification for every deployed row — truth from the chain
    const verified = await Promise.all(
      rows
        .filter((r) => r.status === "deployed" && r.address)
        .map(async (r) => ({ rowId: r.id, state: await verifyRelayOnChain(r.chain as RelayChain, r.address) }))
    );

    const [readinessEth, readinessBsc, relayLedger, enlists] = await Promise.all([
      relayReadiness("ethereum").catch(() => null),
      relayReadiness("bsc").catch(() => null),
      db.anchorTx.findMany({
        where: { kind: "relay", network: "ETHEREUM" },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { seal: { select: { height: true, root: true } } }
      }),
      db.anchorTx.findMany({
        where: { kind: "enlist", network: "ETHEREUM" },
        orderBy: { createdAt: "desc" },
        take: 12
      })
    ]);

    return NextResponse.json({
      ok: true,
      version: RELAY_VERSION,
      compiler: RELAY_COMPILER,
      source: RELAY_SOURCE,
      contracts: rows.map(rowOut),
      verified,
      readiness: { ethereum: readinessEth, bsc: readinessBsc },
      relayLedger: relayLedger.map((r) => {
        const meta = safeParse(r.meta);
        return {
          id: r.id,
          height: r.seal?.height ?? (typeof meta?.height === "number" ? (meta.height as number) : 0),
          root: r.seal?.root ?? "—",
          txid: r.txid,
          block: typeof meta?.block === "number" ? (meta.block as number) : null,
          confirmed: meta?.confirmed === true,
          eventJson: typeof meta?.eventJson === "string" ? (meta.eventJson as string) : null,
          costNative: typeof meta?.costNative === "string" ? (meta.costNative as string) : null,
          status: r.status,
          at: r.createdAt.toISOString()
        };
      }),
      enlists: enlists.map((r) => {
        const meta = safeParse(r.meta);
        return {
          id: r.id,
          agent: typeof meta?.agent === "string" ? (meta.agent as string) : "—",
          rail: typeof meta?.rail === "string" ? (meta.rail as string) : "—",
          identity: typeof meta?.identity === "string" ? (meta.identity as string) : "—",
          txid: r.txid,
          block: typeof meta?.block === "number" ? (meta.block as number) : null,
          confirmed: meta?.confirmed === true,
          eventJson: typeof meta?.eventJson === "string" ? (meta.eventJson as string) : null,
          status: r.status,
          at: r.createdAt.toISOString()
        };
      }),
      usage: 'POST {action:"deploy"|"relay"|"enlist", chain?, height?, agent?}'
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "contract status failed" },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {
  try {
    // v91 — RESHUT: this operator action is a declared, audited operation —
    // every attempt (allow AND deny) lands in the permission journal.
    const dec = await guardPermission("enlist", "hq", { note: "contract deploy/relay/enlist (8-chain relay whitelist)" });
    if (!dec.allowed) {
      return NextResponse.json({ ok: false, gated: true, error: `נחסם במטריצת-הרשויות: ${dec.reason}` });
    }
    const body: unknown = await req.json().catch(() => ({}));
    const obj = (typeof body === "object" && body !== null ? body : {}) as {
      action?: unknown;
      chain?: unknown;
      height?: unknown;
      agent?: unknown;
    };
    const action = typeof obj.action === "string" ? obj.action : "";
    // v51: רשימת-היתר של 8 רשתות ה-relay — פריסה על רשת חדשה עוברת
    // את אותם שערי-כנות (readiness → funded×2) כמו ETH/BSC המוכחות.
    const CHAIN_WHITELIST: RelayChain[] = [
      "ethereum", "bsc", "polygon", "arbitrum", "optimism", "base", "avalanche", "gnosis"
    ];
    const chain: RelayChain =
      typeof obj.chain === "string" && (CHAIN_WHITELIST as string[]).includes(obj.chain)
        ? (obj.chain as RelayChain)
        : "ethereum";

    // ─── deploy ─────────────────────────────────────────────────────────────
    if (action === "deploy") {
      const existing = await db.sovereignContract.findFirst({
        where: { chain, status: "deployed" }
      });
      if (existing) {
        return NextResponse.json({
          ok: true,
          already: true,
          chain,
          address: existing.address,
          txid: existing.txid,
          message: `החוזה כבר פרוס ב-${NETWORK_OF[chain]}`
        });
      }

      // pre-flight — honest readiness before any key is touched
      const ready = await relayReadiness(chain);
      if (!ready.ok) {
        return NextResponse.json({ ok: false, error: ready.error ?? "readiness failed" }, { status: 200 });
      }
      if (!ready.funded) {
        const row = await db.sovereignContract.create({
          data: {
            chain,
            kind: RELAY_VERSION,
            address: "0x0000000000000000000000000000000000000000",
            deployer: ready.address,
            status: "gated",
            meta: JSON.stringify({
              reason: `מאזן ${ready.balance} ${chain === "bsc" ? "BNB" : "ETH"} אינו מכסה פריסה×2 ${ready.deployCostEstimate}`,
              readiness: { balance: ready.balance, deployCostEstimate: ready.deployCostEstimate },
              at: new Date().toISOString()
            })
          }
        });
        const receipt = await appendChainedReceipt("relay-deploy-gated", {
          chain,
          reason: "balance-floor",
          rowId: row.id
        });
        return NextResponse.json({
          ok: false,
          gated: true,
          chain,
          error: `מאזן ${ready.balance} ${chain === "bsc" ? "BNB" : "ETH"} אינו מכסה עלות-פריסה×2 ${ready.deployCostEstimate} — לא נפרס (כנות)`,
          receipt: receipt.digest
        });
      }

      // THE LIVE DEPLOYMENT
      try {
        const out = await deploySovereignRelay(chain);
        const cfg = chainCfg(chain);
        const row = await db.sovereignContract.create({
          data: {
            chain,
            kind: RELAY_VERSION,
            address: out.address ?? "0x0000000000000000000000000000000000000000",
            deployer: out.deployer,
            txid: out.txid,
            blockNumber: out.block,
            gasUsed: out.gasUsed,
            costNative: out.costNative,
            bytecodeHash: out.bytecodeHash,
            runtimeBytes: out.runtimeBytes,
            status: out.confirmed ? "deployed" : "failed",
            meta: JSON.stringify({
              compiler: RELAY_COMPILER,
              explorer: out.explorer,
              contractExplorer: out.address ? cfg.explorerAddr(out.address) : null,
              error: out.error,
              at: out.at
            })
          }
        });
        const receipt = await appendChainedReceipt("relay-deploy", {
          chain,
          address: out.address,
          txid: out.txid,
          block: out.block,
          gasUsed: out.gasUsed,
          costNative: out.costNative,
          bytecodeHash: out.bytecodeHash,
          runtimeBytes: out.runtimeBytes,
          confirmed: out.confirmed,
          rowId: row.id
        });
        await logOp(
          "relay-deploy",
          `chain=${chain} address=${out.address} txid=${out.txid ?? "—"} confirmed=${out.confirmed}`
        );
        return NextResponse.json({
          ok: true,
          chain,
          address: out.address,
          deployer: out.deployer,
          txid: out.txid,
          block: out.block,
          gasUsed: out.gasUsed,
          costNative: out.costNative,
          bytecodeHash: out.bytecodeHash,
          runtimeBytes: out.runtimeBytes,
          confirmed: out.confirmed,
          explorer: out.explorer,
          contractExplorer: out.address ? cfg.explorerAddr(out.address) : null,
          receipt: receipt.digest
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : "deploy failed";
        await db.sovereignContract.create({
          data: {
            chain,
            kind: RELAY_VERSION,
            address: "0x0000000000000000000000000000000000000000",
            status: "failed",
            meta: JSON.stringify({ error: errMsg.slice(0, 300), at: new Date().toISOString() })
          }
        });
        const receipt = await appendChainedReceipt("relay-deploy-failed", {
          chain,
          error: errMsg.slice(0, 300)
        });
        await logOp("relay-deploy-failed", `chain=${chain} error=${errMsg.slice(0, 200)}`);
        return NextResponse.json({ ok: false, error: errMsg, receipt: receipt.digest });
      }
    }

    // ─── relay (anchor a seal root THROUGH the contract) ────────────────────
    if (action === "relay") {
      const contract = await db.sovereignContract.findFirst({
        where: { chain: "ethereum", status: "deployed" }
      });
      if (!contract) {
        return NextResponse.json({ ok: false, error: "אין חוזה פרוס — פרוס קודם (action: deploy)" }, { status: 200 });
      }

      const heightWanted =
        typeof obj.height === "number" && Number.isInteger(obj.height) && obj.height > 0 ? obj.height : null;
      const seal = heightWanted
        ? await db.sealRecord.findUnique({
            where: { height: heightWanted },
            select: { id: true, height: true, root: true, stateRoot: true, leavesCount: true, gasUsed: true }
          })
        : await db.sealRecord.findFirst({
            orderBy: { height: "desc" },
            select: { id: true, height: true, root: true, stateRoot: true, leavesCount: true, gasUsed: true }
          });
      if (!seal) {
        return NextResponse.json({ ok: false, error: "אין חותם — צור חותם קודם" }, { status: 200 });
      }

      // dedupe — one relay-anchor per seal, forever
      const existing = await db.anchorTx.findFirst({
        where: { kind: "relay", network: "ETHEREUM", sealId: seal.id, txid: { not: null } }
      });
      if (existing) {
        return NextResponse.json({
          ok: true,
          already: true,
          height: seal.height,
          txid: existing.txid,
          message: `חותם #${seal.height} כבר מעוגן דרך החוזה`
        });
      }

      try {
        const out = await relayAnchorThroughContract("ethereum", contract.address, {
          height: seal.height,
          root: seal.root
        });
        const row = await db.anchorTx.create({
          data: {
            sealId: seal.id,
            network: "ETHEREUM",
            kind: "relay",
            txid: out.txid,
            status: out.confirmed ? "anchored" : "broadcast",
            meta: JSON.stringify({
              contract: contract.address,
              action: "anchor",
              height: seal.height,
              block: out.block,
              confirmed: out.confirmed,
              eventJson: out.eventJson,
              costNative: out.costNative,
              gasUsed: out.gasUsed,
              explorer: out.explorer,
              at: out.at
            })
          }
        });
        const receipt = await appendChainedReceipt(
          "relay-anchor",
          { height: seal.height, root: seal.root, contract: contract.address, txid: out.txid, block: out.block, confirmed: out.confirmed, costNative: out.costNative, anchorRowId: row.id },
          { sealId: seal.id }
        );
        await logOp(
          "relay-anchor",
          `height=${seal.height} contract=${contract.address} txid=${out.txid ?? "—"} confirmed=${out.confirmed}`
        );
        return NextResponse.json({
          ok: true,
          height: seal.height,
          root: seal.root,
          contract: contract.address,
          txid: out.txid,
          block: out.block,
          confirmedByHistory: out.confirmed,
          eventJson: out.eventJson,
          costNative: out.costNative,
          explorer: out.explorer,
          receipt: receipt.digest
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : "relay call failed";
        const row = await db.anchorTx.create({
          data: {
            sealId: seal.id,
            network: "ETHEREUM",
            kind: "relay",
            txid: null,
            status: "failed",
            gate: "relay-error",
            meta: JSON.stringify({ contract: contract.address, error: errMsg.slice(0, 300), at: new Date().toISOString() })
          }
        });
        const receipt = await appendChainedReceipt(
          "relay-anchor-failed",
          { height: seal.height, error: errMsg.slice(0, 300), anchorRowId: row.id },
          { sealId: seal.id }
        );
        return NextResponse.json({ ok: false, error: errMsg, receipt: receipt.digest });
      }
    }

    // ─── enlist (bind an agent identity through the contract) ──────────────
    if (action === "enlist") {
      const contract = await db.sovereignContract.findFirst({
        where: { chain: "ethereum", status: "deployed" }
      });
      if (!contract) {
        return NextResponse.json({ ok: false, error: "אין חוזה פרוס — פרוס קודם (action: deploy)" }, { status: 200 });
      }
      const agentWanted = typeof obj.agent === "string" ? obj.agent.trim().toLowerCase() : "";
      if (!agentWanted) {
        return NextResponse.json({ ok: false, error: 'נדרש agent (למשל "headcorner")' }, { status: 200 });
      }

      // whitelist — ONLY identities that exist in the sealed vault (fail-closed)
      const [wallets, inventory] = await Promise.all([
        readSovereignWallets().catch(() => []),
        readSealInventory().catch(() => null)
      ]);
      const wallet = wallets.find((w) => w.agent.toLowerCase() === agentWanted);
      const fleetName = inventory?.fleet.find((f) => f.username.toLowerCase() === agentWanted);
      if (!wallet && !fleetName) {
        return NextResponse.json(
          { ok: false, error: `${agentWanted} לא נמצא ברישום הכספת (fail-closed)` },
          { status: 200 }
        );
      }
      // identity = PUBLIC material only: the agent's EVM address, or the account name
      const identity = wallet?.evm ?? agentWanted;
      const rail = wallet?.evm ? "ethereum" : "steem";

      // dedupe — one enlist per agent, forever
      const enlists = await db.anchorTx.findMany({
        where: { kind: "enlist", network: "ETHEREUM" }
      });
      const alreadyRow = enlists.find((r) => {
        const m = safeParse(r.meta);
        return typeof m?.agent === "string" && (m.agent as string).toLowerCase() === agentWanted && r.txid;
      });
      if (alreadyRow) {
        return NextResponse.json({
          ok: true,
          already: true,
          agent: agentWanted,
          txid: alreadyRow.txid,
          message: `${agentWanted} כבר גויס דרך החוזה`
        });
      }

      try {
        const out = await relayEnlistThroughContract("ethereum", contract.address, {
          agent: agentWanted,
          rail,
          identity
        });
        const row = await db.anchorTx.create({
          data: {
            network: "ETHEREUM",
            kind: "enlist",
            txid: out.txid,
            status: out.confirmed ? "anchored" : "broadcast",
            meta: JSON.stringify({
              contract: contract.address,
              agent: agentWanted,
              rail,
              identity,
              block: out.block,
              confirmed: out.confirmed,
              eventJson: out.eventJson,
              costNative: out.costNative,
              gasUsed: out.gasUsed,
              explorer: out.explorer,
              at: out.at
            })
          }
        });
        const receipt = await appendChainedReceipt("relay-enlist", {
          agent: agentWanted,
          rail,
          identity,
          contract: contract.address,
          txid: out.txid,
          block: out.block,
          confirmed: out.confirmed,
          anchorRowId: row.id
        });
        await logOp("relay-enlist", `agent=${agentWanted} rail=${rail} txid=${out.txid ?? "—"} confirmed=${out.confirmed}`);
        return NextResponse.json({
          ok: true,
          agent: agentWanted,
          rail,
          identity,
          contract: contract.address,
          txid: out.txid,
          block: out.block,
          confirmedByHistory: out.confirmed,
          eventJson: out.eventJson,
          costNative: out.costNative,
          explorer: out.explorer,
          receipt: receipt.digest
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : "enlist failed";
        const receipt = await appendChainedReceipt("relay-enlist-failed", {
          agent: agentWanted,
          error: errMsg.slice(0, 300)
        });
        return NextResponse.json({ ok: false, error: errMsg, receipt: receipt.digest });
      }
    }

    return NextResponse.json(
      { ok: false, error: 'action חייב להיות "deploy" | "relay" | "enlist"' },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "contract action failed" },
      { status: 200 }
    );
  }
}
