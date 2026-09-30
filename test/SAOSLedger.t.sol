// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SAOSLedger} from "../contracts/mesh/SAOSLedger.sol";
import {MockRelay} from "./MockRelay.sol";

/// @title SAOSLedger regression law — B-2 (R130)
/// @notice Locks audit-fix v5 as test law:
///         (1) MINT_CAP — every mint path (sovereignMint, process+payroll)
///             is fail-closed under the 21M ceiling;
///         (2) attributed transfers — approve/transferFrom pull from the
///             depositor himself (no global unaccounted race);
///         (3) two-step ownership — no bricked ledgers;
///         (4) the run chain never dies — process() always continues via
///             relay.pass().
contract SAOSLedgerTest is Test {
    SAOSLedger internal ledger;
    MockRelay internal relay;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal payrollAddr = makeAddr("payroll");

    uint256 internal constant RUN_REWARD = 10 ether;
    uint256 internal constant CAP = 21_000_000 ether;

    event RewardPaid(uint256 indexed runId, address indexed to, uint256 amount);
    event PayrollFunded(uint256 indexed runId, address indexed payroll, uint256 amount);
    event Approval(address indexed tokenOwner, address indexed spender, uint256 amount);

    function setUp() public {
        ledger = new SAOSLedger();
        relay = new MockRelay();
        ledger.wire(address(relay));
    }

    function _ctx(address who) internal pure returns (bytes memory) {
        return abi.encode(who, "mesh.run");
    }

    // ── 1. the mint cap ────────────────────────────────────────────────────

    function test_SovereignMint_WithinCap() public {
        ledger.sovereignMint(alice, 1_000 ether, "float");
        assertEq(ledger.balanceOf(alice), 1_000 ether);
        assertEq(ledger.totalSupply(), 1_000 ether);
    }

    function test_SovereignMint_AtExactCap_IsAllowed() public {
        ledger.sovereignMint(alice, CAP, "float-at-cap");
        assertEq(ledger.totalSupply(), CAP);
    }

    function testFuzz_SovereignMint_BeyondCap_FailClosed(uint256 over) public {
        over = bound(over, 1, CAP); // any overshoot from 1 wei to a full cap
        vm.expectRevert(SAOSLedger.MintCapExceeded.selector);
        ledger.sovereignMint(alice, CAP + over, "over");
    }

    /// The run pipeline mints 1x RUN_REWARD (initiator) + 1x (payroll). Both
    /// hops together must respect the cap — fail closed, never silently skip.
    function test_Process_MintCapEnforced_WithPayroll() public {
        ledger.setPayroll(payrollAddr);
        ledger.sovereignMint(alice, CAP - 2 * RUN_REWARD, "seed");

        // first run lands exactly on the cap — allowed
        vm.prank(address(relay));
        ledger.process(1, _ctx(alice));
        assertEq(ledger.totalSupply(), CAP);

        // the next run would breach the cap — must revert, not partial-mint
        vm.prank(address(relay));
        vm.expectRevert(SAOSLedger.MintCapExceeded.selector);
        ledger.process(2, _ctx(alice));
    }

    function test_SovereignMint_NonOwner_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(SAOSLedger.NotOwner.selector);
        ledger.sovereignMint(alice, 1 ether, "nope");
    }

    function test_SovereignMint_ZeroAmount_Reverts() public {
        vm.expectRevert(SAOSLedger.InsufficientBalance.selector);
        ledger.sovereignMint(alice, 0, "zero");
    }

    // ── 2. run pipeline: rewards, payroll, chain continuation ──────────────

    function test_Process_PaysInitiatorAndPayroll_AndContinuesChain() public {
        ledger.setPayroll(payrollAddr);

        vm.expectEmit(true, true, false, true, address(ledger));
        emit RewardPaid(7, alice, RUN_REWARD);
        vm.expectEmit(true, true, false, true, address(ledger));
        emit PayrollFunded(7, payrollAddr, RUN_REWARD);

        vm.prank(address(relay));
        ledger.process(7, _ctx(alice));

        assertEq(ledger.balanceOf(alice), RUN_REWARD);
        assertEq(ledger.balanceOf(payrollAddr), RUN_REWARD);
        assertEq(ledger.runMinted(), 2 * RUN_REWARD);
        assertEq(ledger.totalSupply(), 2 * RUN_REWARD);
        // the chain MUST continue — pass() called exactly once
        assertEq(relay.passCount(), 1);
        assertEq(relay.lastRun(), 7);
    }

    function test_Process_WithoutPayroll_MintsOnlyInitiator() public {
        vm.prank(address(relay));
        ledger.process(1, _ctx(alice));
        assertEq(ledger.balanceOf(alice), RUN_REWARD);
        assertEq(ledger.runMinted(), RUN_REWARD);
        assertEq(ledger.totalSupply(), RUN_REWARD);
    }

    function test_Process_NonRelay_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(SAOSLedger.NotRelay.selector);
        ledger.process(1, _ctx(alice));
    }

    // ── 3. attributed transfers (the deposit-race closure) ─────────────────

    function test_Approve_TransferFrom_PullsFromDepositor() public {
        ledger.sovereignMint(alice, 100 ether, "seed");
        vm.startPrank(alice);
        ledger.approve(bob, 60 ether);
        vm.stopPrank();

        vm.prank(bob);
        ledger.transferFrom(alice, bob, 25 ether);

        assertEq(ledger.balanceOf(alice), 75 ether);
        assertEq(ledger.balanceOf(bob), 25 ether);
        // allowance consumed exactly
        assertEq(ledger.allowance(alice, bob), 35 ether);
    }

    function test_TransferFrom_WithoutAllowance_Reverts() public {
        ledger.sovereignMint(alice, 100 ether, "seed");
        vm.prank(bob);
        vm.expectRevert(SAOSLedger.InsufficientAllowance.selector);
        ledger.transferFrom(alice, bob, 1 ether);
    }

    function test_TransferFrom_BeyondBalance_Reverts() public {
        ledger.sovereignMint(alice, 10 ether, "seed");
        vm.startPrank(alice);
        ledger.approve(bob, 100 ether); // allowance covers more than balance
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(SAOSLedger.InsufficientBalance.selector);
        ledger.transferFrom(alice, bob, 11 ether);
    }

    function test_TransferFrom_MaxAllowance_NotConsumed() public {
        ledger.sovereignMint(alice, 1000 ether, "seed");
        vm.startPrank(alice);
        ledger.approve(bob, type(uint256).max);
        vm.stopPrank();
        vm.prank(bob);
        ledger.transferFrom(alice, bob, 400 ether);
        assertEq(ledger.allowance(alice, bob), type(uint256).max);
    }

    function test_Approve_EmitsEvent() public {
        vm.expectEmit(true, true, false, true, address(ledger));
        emit Approval(alice, bob, 5 ether);
        vm.prank(alice);
        ledger.approve(bob, 5 ether);
    }

    // ── 4. two-step ownership & wiring ─────────────────────────────────────

    function test_Ownership_TwoStep_Rotation() public {
        ledger.transferOwnership(bob);
        // wrong pending owner cannot accept
        vm.prank(alice);
        vm.expectRevert(SAOSLedger.NotPendingOwner.selector);
        ledger.acceptOwnership();
        // the real pending owner accepts
        vm.prank(bob);
        ledger.acceptOwnership();
        assertEq(ledger.owner(), bob);
        assertEq(ledger.pendingOwner(), address(0));
    }

    function test_Wire_ZeroAddress_Reverts() public {
        vm.expectRevert(SAOSLedger.ZeroAddress.selector);
        ledger.wire(address(0));
    }

    function test_Wire_NonOwner_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(SAOSLedger.NotOwner.selector);
        ledger.wire(address(relay));
    }
}
