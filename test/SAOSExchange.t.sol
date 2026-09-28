// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SAOSLedger} from "../contracts/mesh/SAOSLedger.sol";
import {SAOSExchange} from "../contracts/mesh/SAOSExchange.sol";
import {MockRelay} from "./MockRelay.sol";

/// @title SAOSExchange regression law — B-2 (R130)
/// @notice Locks the two deepest economic findings of the 2026-09 audit as
///         permanent test law:
///         (A) HARVEST = DEBIT-THEN-CREDIT. The pot fee is taken out of the
///             swap input before it reaches the reserves, so harvesting moves
///             existing value to the treasury and mints NOTHING. The invariant
///             totalMinted == Σ balances + Σ reserves + Σ pots must hold
///             through swaps, harvests, adds and removes — no phantom supply.
///         (B) DEPOSIT ATTRIBUTION. depositSaos pulls from the depositor
///             himself via approve/transferFrom — nobody can claim the
///             unaccounted global balance of another holder (wrap race closed).
contract SAOSExchangeTest is Test {
    SAOSLedger internal ledger;
    SAOSExchange internal exchange;
    MockRelay internal relay;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal treasury = makeAddr("treasury");

    uint256 internal wsaosId;
    uint256 internal wtrxId;
    uint256 internal poolId;

    address[] internal holders; // every address that can hold exchange balances

    event Harvested(uint256 indexed poolId, address indexed treasury, uint256 amountA, uint256 amountB);

    function setUp() public {
        ledger = new SAOSLedger();
        relay = new MockRelay();
        exchange = new SAOSExchange();
        exchange.wire(address(relay), address(ledger), treasury);

        wsaosId = exchange.registerAsset("WSAOS", "1:1 SAOS-M deposit");
        wtrxId = exchange.registerAsset("WTRX", "reserve-mirrored");
        poolId = exchange.createPool(wtrxId, wsaosId);

        // seed: this test contract is the founding LP (100k/100k pool)
        ledger.sovereignMint(address(this), 1_000_000 ether, "lp-seed");
        ledger.approve(address(exchange), 1_000_000 ether);
        exchange.depositSaos(500_000 ether);
        exchange.mintAsset(wtrxId, address(this), 500_000 ether, "reserve-mirror");
        exchange.addLiquidity(poolId, 100_000 ether, 100_000 ether);

        holders.push(address(this));
        holders.push(alice);
        holders.push(bob);
        holders.push(carol);
        holders.push(treasury);
        holders.push(address(exchange));
    }

    // ── the phantom-supply invariant ────────────────────────────────────────

    /// totalMinted[a] must equal Σ holder balances + Σ reserves + Σ pots
    /// (growth fees live inside the reserves, pot fees inside the pots).
    function assertNoPhantomSupply(uint256 assetId) internal view {
        (, , uint256 totalMinted, ) = exchange.assets(assetId);

        uint256 acc;
        uint256 n = exchange.poolCount();
        for (uint256 i = 0; i < n; i++) {
            (
                uint256 aId, uint256 bId, uint256 rA, uint256 rB, ,
                uint256 potA, uint256 potB, , , , ,
            ) = exchange.pools(i);
            if (aId == assetId) acc += rA + potA;
            if (bId == assetId) acc += rB + potB;
        }
        for (uint256 i = 0; i < holders.length; i++) {
            acc += exchange.balanceOf(assetId, holders[i]);
        }
        assertEq(acc, totalMinted, "phantom supply: accounting identity broken");
    }

    // ── (A) harvest: debit-then-credit, no minting ─────────────────────────

    function test_Swap_FeeSplit_IsExact() public {
        exchange.mintAsset(wtrxId, bob, 5_000 ether, "user");
        vm.startPrank(bob);
        uint256 out = exchange.swapExactIn(poolId, true, 5_000 ether, 0);
        vm.stopPrank();

        // inForOut = amountIn − 20bps ; pot = 10bps ; growth = 10bps
        // (5k input on a 100k pool → out ≈ 4.75% of output reserve, under the 5% cap)
        uint256 inForOut = 5_000 ether - 10 ether;
        uint256 expectedOut = (100_000 ether * inForOut) / (100_000 ether + inForOut);
        assertEq(out, expectedOut);

        (, , uint256 rA, uint256 rB, , uint256 potA, uint256 potB, uint256 gA, , , , ) = exchange.pools(poolId);
        assertEq(potA, 5 ether, "pot fee must be exactly 10bps of input");
        assertEq(gA, 5 ether, "growth fee must be exactly 10bps of input");
        assertEq(rA, 100_000 ether + (5_000 ether - 5 ether), "reserves must NOT include the pot fee");
        assertEq(rB, 100_000 ether - out);

        assertNoPhantomSupply(wtrxId);
        assertNoPhantomSupply(wsaosId);
    }

    function test_Harvest_CreditsTreasury_ZerosPot_MintsNothing() public {
        exchange.mintAsset(wtrxId, bob, 5_000 ether, "user");
        uint256 mintedBefore = _totalMinted(wtrxId); // measured AFTER the legit mint

        vm.prank(bob);
        exchange.swapExactIn(poolId, true, 5_000 ether, 0);

        vm.expectEmit(true, true, false, true, address(exchange));
        emit Harvested(0, treasury, 5 ether, 0);
        (uint256 amtA, uint256 amtB) = exchange.harvest(poolId);
        assertEq(amtA, 5 ether);
        assertEq(amtB, 0);

        assertEq(exchange.balanceOf(wtrxId, treasury), 5 ether, "treasury must receive the pot");
        (, , uint256 rA, , , uint256 potA, , , , , , ) = exchange.pools(poolId);
        assertEq(potA, 0, "pot must be zeroed on harvest");
        assertEq(rA, 100_000 ether + 4_995 ether, "reserves untouched by harvest");

        // second harvest pays nothing — no double credit
        (uint256 a2, uint256 b2) = exchange.harvest(poolId);
        assertEq(a2, 0);
        assertEq(b2, 0);

        // THE law: harvest minted nothing
        assertEq(_totalMinted(wtrxId), mintedBefore, "harvest must never change totalMinted");
        assertNoPhantomSupply(wtrxId);
    }

    function test_HarvestAll_SweepsOnlyPoolsWithPot() public {
        // pool 1: pot via a swap
        exchange.mintAsset(wtrxId, bob, 5_000 ether, "user");
        vm.prank(bob);
        exchange.swapExactIn(poolId, true, 5_000 ether, 0);

        // pool 2: new asset pair, no swaps → empty pot
        uint256 wsolId = exchange.registerAsset("WSOL", "reserve-mirrored");
        exchange.mintAsset(wsolId, address(this), 1_000 ether, "mirror");
        uint256 pool2 = exchange.createPool(wtrxId, wsolId);
        exchange.addLiquidity(pool2, 1_000 ether, 1_000 ether);

        vm.expectEmit(true, true, false, true, address(exchange));
        emit Harvested(0, treasury, 5 ether, 0);

        uint256 swept = exchange.harvestAll();
        assertEq(swept, 1, "only pools actually holding pot must be swept");

        (, , , , , uint256 potA1, uint256 potB1, , , , , ) = exchange.pools(poolId);
        (, , , , , uint256 potA2, uint256 potB2, , , , , ) = exchange.pools(pool2);
        assertEq(potA1 + potB1, 0);
        assertEq(potA2 + potB2, 0);
        assertEq(exchange.balanceOf(wtrxId, treasury), 5 ether);

        assertNoPhantomSupply(wtrxId);
        assertNoPhantomSupply(wsaosId);
        assertNoPhantomSupply(wsolId);
    }

    function test_Harvest_NonOwner_Reverts() public {
        exchange.mintAsset(wtrxId, bob, 5_000 ether, "user");
        vm.prank(bob);
        exchange.swapExactIn(poolId, true, 5_000 ether, 0);
        vm.prank(bob);
        vm.expectRevert(SAOSExchange.NotOwner.selector);
        exchange.harvest(poolId);
    }

    /// LP shares are minted against RESERVES only — a pot can never be
    /// extracted by removing liquidity, because pots never enter rA/rB.
    function test_Liquidity_CannotExtract_PotFees() public {
        exchange.mintAsset(wtrxId, bob, 5_000 ether, "user");

        uint256 inForOut = 5_000 ether - 10 ether;
        uint256 expectedOut = (100_000 ether * inForOut) / (100_000 ether + inForOut);

        vm.prank(bob);
        exchange.swapExactIn(poolId, true, 5_000 ether, 0);

        // founding LP removes 100% of shares → must receive reserves only
        uint256 shares = exchange.lpSharesOf(poolId, address(this));
        (uint256 outA, uint256 outB) = exchange.removeLiquidity(poolId, shares);
        assertEq(outA, 100_000 ether + 4_995 ether, "LP payout = reserves, pot excluded");
        assertEq(outB, 100_000 ether - expectedOut);
        assertEq(exchange.lpSharesOf(poolId, address(this)), 0);

        // the pot is still there and still only reachable via the treasury path
        (, , , , , uint256 potA, , , , , , ) = exchange.pools(poolId);
        assertEq(potA, 5 ether);
        exchange.harvest(poolId);
        assertEq(exchange.balanceOf(wtrxId, treasury), 5 ether);

        assertNoPhantomSupply(wtrxId);
        assertNoPhantomSupply(wsaosId);
    }

    /// second LP joins proportionally; shares can never over-mint the pool
    function test_AddLiquidity_ProportionalShares() public {
        exchange.mintAsset(wtrxId, alice, 10_000 ether, "user");
        ledger.sovereignMint(alice, 50_000 ether, "alice-wsaos-seed");
        vm.startPrank(alice);
        ledger.approve(address(exchange), 50_000 ether);
        exchange.depositSaos(10_000 ether);
        uint256 minted = exchange.addLiquidity(poolId, 10_000 ether, 10_000 ether);
        vm.stopPrank();

        // pool had 100k/100k with 100k LP → +10% reserves ⇒ ~10% new shares
        assertApproxEqRel(minted, 10_000 ether, 0.02e18);
        assertEq(exchange.lpSharesOf(poolId, alice), minted);
        assertNoPhantomSupply(wtrxId);
        assertNoPhantomSupply(wsaosId);
    }

    // ── (B) deposit attribution: no wrap race ──────────────────────────────

    function test_Deposit_CannotClaim_OthersUnaccountedBalance() public {
        // carol holds SAOS-M but has NOT approved anyone
        ledger.sovereignMint(carol, 100 ether, "carol-seed");

        // alice holds nothing. Under the pre-fix design she could claim
        // carol's unaccounted delta by being first to depositSaos — now the
        // pull is attributed and must fail closed.
        vm.prank(alice);
        vm.expectRevert();
        exchange.depositSaos(100 ether);
        assertEq(exchange.balanceOf(wsaosId, alice), 0);
    }

    function test_Deposit_Attributed_Exact_1to1() public {
        ledger.sovereignMint(carol, 100 ether, "carol-seed");
        vm.startPrank(carol);
        ledger.approve(address(exchange), 100 ether);
        exchange.depositSaos(100 ether);
        vm.stopPrank();

        assertEq(exchange.balanceOf(wsaosId, carol), 100 ether);
        assertEq(exchange.wSaosLive(), 500_000 ether + 100 ether);
        assertEq(exchange.saosUnaccounted(), 0, "honest deposits keep drift at zero");
    }

    function test_Wrap_Unwrap_RoundTrip_KeepsDriftZero() public {
        ledger.sovereignMint(alice, 250 ether, "alice-seed");
        vm.startPrank(alice);
        ledger.approve(address(exchange), 250 ether);
        exchange.depositSaos(250 ether);
        assertEq(exchange.balanceOf(wsaosId, alice), 250 ether);
        exchange.withdrawSaos(250 ether);
        vm.stopPrank();

        assertEq(exchange.balanceOf(wsaosId, alice), 0);
        assertEq(ledger.balanceOf(alice), 250 ether, "unwrap returns exactly what was wrapped");
        assertEq(exchange.saosUnaccounted(), 0);
    }

    function test_Deposit_ZeroAmount_Reverts() public {
        vm.expectRevert(SAOSExchange.Zero.selector);
        exchange.depositSaos(0);
    }

    function test_MintAsset_Wsaos_IsForbidden() public {
        // wSAOS may ONLY exist against real SAOS-M deposits — never minted
        vm.expectRevert(SAOSExchange.NotWrappedSaos.selector);
        exchange.mintAsset(wsaosId, bob, 1 ether, "forge-attempt");
    }

    // ── swap guards ─────────────────────────────────────────────────────────

    function test_Swap_Slippage_Reverts() public {
        exchange.mintAsset(wtrxId, bob, 10_000 ether, "user");
        vm.startPrank(bob);
        uint256 q = exchange.quote(poolId, true, 10_000 ether);
        vm.expectRevert(SAOSExchange.Slippage.selector);
        exchange.swapExactIn(poolId, true, 10_000 ether, q + 1);
        vm.stopPrank();
    }

    function test_Swap_SwapCap_Reverts() public {
        // a single swap may take at most 5% of the output reserve
        exchange.mintAsset(wtrxId, bob, 20_000 ether, "whale");
        vm.startPrank(bob);
        vm.expectRevert(SAOSExchange.SwapCap.selector);
        exchange.swapExactIn(poolId, true, 20_000 ether, 0);
        vm.stopPrank();
    }

    function test_Swap_InsufficientBalance_Reverts() public {
        vm.prank(alice); // holds nothing
        vm.expectRevert(SAOSExchange.InsufficientBalance.selector);
        exchange.swapExactIn(poolId, true, 1 ether, 0);
    }

    // ── mesh pulse ──────────────────────────────────────────────────────────

    function test_Process_RelaysPulse_AndContinuesChain() public {
        vm.prank(address(relay));
        exchange.process(9, abi.encode(alice, "grid.fill"));
        assertEq(exchange.pulses(), 1);
        assertEq(relay.passCount(), 1);
    }

    function test_Process_NonRelay_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(SAOSExchange.NotRelay.selector);
        exchange.process(9, abi.encode(alice, "x"));
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    function _totalMinted(uint256 assetId) internal view returns (uint256) {
        (, , uint256 minted, ) = exchange.assets(assetId);
        return minted;
    }
}
