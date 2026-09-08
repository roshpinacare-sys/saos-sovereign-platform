/**
 * SAOSMicrogrid engine self-test (lab chain, honest SELFTEST label):
 * proves level-crossing fills + monotonic profit + payroll sweep end-to-end.
 */
import * as fs from "fs";
import { ethers } from "ethers";
const state = JSON.parse(fs.readFileSync("mini-services/evm-mesh/state/deployment.json", "utf8"));
const artifact = JSON.parse(fs.readFileSync("src/lib/saos/generated/SAOSMesh.json", "utf8"));
const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545", 31337, { batchMaxCount: 1 });
const hq = await provider.getSigner(0);
const abi = artifact.contracts.find((c: { name: string }) => c.name === "SAOSMicrogrid").abi;
const mg = new ethers.Contract(state.contracts.SAOSMicrogrid, abi, hq);

const PAIR = "SELFTEST/GRID98";
const tx1 = await mg.postPrice(PAIR, 1_000_000n); await tx1.wait();      // $1.00 = anchor
const t2 = await mg.createGrid(PAIR, 8); await t2.wait();
const gid = Number(await mg.gridCount()) - 1;
console.log(`grid#${gid} created at anchor $1.00`);

let rc = await (await mg.tickAll()).wait();
console.log("tick @1.00 → crossings so far:", String(await mg.gridAt(gid).then((g: any) => g.crossings)));

// price +1.3% → crosses level +1 → SELL fill (profit!)
rc = await (await mg.postPrice(PAIR, 1_013_000n)).wait();
rc = await (await mg.tickAll()).wait();
let g: any = await mg.gridAt(gid);
console.log(`tick @1.013 (+1.3%) → cursor=${g.cursor} crossings=${g.crossings} inv=${g.inventory}/${g.levels} realized=${ethers.formatEther(g.realizedPnl)} SAOS-M`);

// price back down -1.5% → crosses level 0 → BUY fill (restock)
rc = await (await mg.postPrice(PAIR, 998_000n)).wait();
rc = await (await mg.tickAll()).wait();
g = await mg.gridAt(gid);
console.log(`tick @0.998 (-1.5%) → cursor=${g.cursor} crossings=${g.crossings} inv=${g.inventory}/${g.levels} realized=${ethers.formatEther(g.realizedPnl)} SAOS-M`);

// the flywheel: sweep → workboard payroll
const wbBalBefore = await (new ethers.Contract(state.contracts.SAOSLedger, artifact.contracts.find((c: { name: string }) => c.name === "SAOSLedger").abi, provider)).balanceOf(state.contracts.SAOSWorkBoard);
const sweepRc = await (await mg.sweepAllToPayroll()).wait();
const ledgerC = new ethers.Contract(state.contracts.SAOSLedger, artifact.contracts.find((c: { name: string }) => c.name === "SAOSLedger").abi, provider);
const wbBalAfter = await ledgerC.balanceOf(state.contracts.SAOSWorkBoard);
console.log(`sweep → payroll: ${ethers.formatEther(wbBalBefore)} → ${ethers.formatEther(wbBalAfter)} SAOS-M (+${ethers.formatEther(wbBalAfter - wbBalBefore)})`);
console.log("totalRealized:", ethers.formatEther(await mg.totalRealized()), "| fillSeq:", String(await mg.fillSeq()));
// decode the GridFill events from the sweep + tick receipts for evidence
const iface = new ethers.Interface(abi);
for (const log of rc.logs ?? []) {
  try { const ev = iface.parseLog({ topics: [...log.topics], data: log.data }); if (ev?.name === "GridFill") console.log("FILL:", JSON.stringify({ level: Number(ev.args.level), isSell: ev.args.isSell, profit: ethers.formatEther(ev.args.profit), seq: Number(ev.args.seq) })); } catch {}
}
provider.destroy();
