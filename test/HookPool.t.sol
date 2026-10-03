// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * HookPool.t.sol — v118 תזמורת — THE FIVE HOOK PROOFS (forge, in-memory EVM).
 * (a) install from non-owner reverts (owner-gated)
 * (b) install from owner succeeds + event + registered
 * (c) beforeSwap/afterSwap actually fire with the right payloads
 * (d) reverting hook = fail-open (swap valid, base fee)
 * (e) dynamic fee: hook-set fee adopted (≤ cap), hostile fee > cap → base fee
 */
import {Test} from "forge-std/Test.sol";
import {SAOSHookPool, ISaoshook} from "../contracts/mesh/SAOSHookPool.sol";

contract MockHook is ISaoshook {
    bool public revertBefore;
    bool public revertAfter;
    uint24 public feeWanted;
    address public lastBeforeSender;
    uint256 public lastBeforeAmountIn;
    address public lastAfterSender;
    uint256 public lastAfterAmountOut;
    uint256 public beforeCalls;
    uint256 public afterCalls;

    function configure(bool _revertBefore, bool _revertAfter, uint24 _feeWanted) external {
        revertBefore = _revertBefore;
        revertAfter = _revertAfter;
        feeWanted = _feeWanted;
    }

    function beforeSwap(address sender, uint256 amountIn) external returns (bytes4, uint24) {
        beforeCalls++;
        lastBeforeSender = sender;
        lastBeforeAmountIn = amountIn;
        if (revertBefore) revert("hook-before-boom");
        return (this.beforeSwap.selector, feeWanted);
    }

    function afterSwap(address sender, uint256 amountOut) external returns (bytes4) {
        afterCalls++;
        lastAfterSender = sender;
        lastAfterAmountOut = amountOut;
        if (revertAfter) revert("hook-after-boom");
        return this.afterSwap.selector;
    }
}

contract HookPoolTest is Test {
    SAOSHookPool pool;
    MockHook hook;
    address alice = makeAddr("alice");
    address owner_ = makeAddr("owner");

    function setUp() public {
        vm.prank(owner_);
        pool = new SAOSHookPool(address(0xA), address(0xB), 30); // base fee 30bps
        vm.prank(owner_);
        pool.fund(1_000_000 ether, 1_000_000 ether);
        hook = new MockHook();
    }

    // (a) owner-gated install
    function test_Install_NonOwner_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(SAOSHookPool.NotOwner.selector);
        pool.installHook(address(hook));
        assertEq(address(pool.hook()), address(0), "no hook installed by non-owner");
    }

    // (b) owner install succeeds + event + registered
    function test_Install_Owner_Ok_Event() public {
        vm.prank(owner_);
        vm.expectEmit(true, false, false, true, address(pool));
        emit SAOSHookPool.HookInstalled(address(hook));
        pool.installHook(address(hook));
        assertEq(address(pool.hook()), address(hook), "hook registered");
        vm.prank(owner_);
        vm.expectRevert(SAOSHookPool.HookAlreadySet.selector);
        pool.installHook(address(hook)); // double-install refused
    }

    // (c) both callbacks fire with exact payloads
    function test_Hooks_Fire_WithPayloads() public {
        vm.prank(owner_);
        pool.installHook(address(hook));
        uint256 out = pool.swapAForB(1_000 ether, 0);
        assertEq(hook.beforeCalls(), 1, "beforeSwap fired exactly once");
        assertEq(hook.lastBeforeSender(), address(this), "beforeSwap saw sender");
        assertEq(hook.lastBeforeAmountIn(), 1_000 ether, "beforeSwap saw amountIn");
        assertEq(hook.afterCalls(), 1, "afterSwap fired exactly once");
        assertEq(hook.lastAfterSender(), address(this), "afterSwap saw sender");
        assertEq(hook.lastAfterAmountOut(), out, "afterSwap saw the real amountOut");
        assertTrue(out > 0 && out < 1_000_000 ether, "sane swap output");
    }

    // (d) reverting hook = fail-open (swap valid, base fee 30bps applied).
    // NOTE: the hook's beforeCalls++ is rolled back by EVM revert semantics —
    // the proof that the pool took the catch path is the FEE MATH itself:
    // out == base-30bps expectation (hook wanted 0 — adoption would give a bigger out).
    function test_RevertingHook_FailOpen_SwapStillValid() public {
        vm.prank(owner_);
        pool.installHook(address(hook));
        hook.configure(true, true, 0); // both callbacks revert
        uint256 raBefore = pool.reserveA();
        uint256 rbBefore = pool.reserveB();
        uint256 out = pool.swapAForB(1_000 ether, 0);
        assertTrue(out > 0, "swap succeeded despite hook reverts (fail-open)");
        uint256 inAfterFee = 1_000 ether - (1_000 ether * 30) / 10_000;
        uint256 expected = (rbBefore * inAfterFee) / (raBefore + inAfterFee);
        assertEq(out, expected, "base fee applied on hook failure");
        // counterfactual: had the pool adopted the hook's 0bps, out would be strictly larger
        uint256 counterfactual0 = (rbBefore * 1_000 ether) / (raBefore + 1_000 ether);
        assertTrue(out < counterfactual0, "catch path ran - hook fee NOT adopted on revert");
    }

    // (e) dynamic fee: adopted under cap (exact 50bps math), refused above cap (base 30bps math)
    function test_DynamicFee_HookSets_Adopted_And_Capped() public {
        vm.prank(owner_);
        pool.installHook(address(hook));

        // e1: hook wants 50bps → adopted (exact arithmetic)
        hook.configure(false, false, 50);
        uint256 ra = pool.reserveA();
        uint256 rb = pool.reserveB();
        uint256 inAfter50 = 1_000 ether - (1_000 ether * 50) / 10_000;
        uint256 expected50 = (rb * inAfter50) / (ra + inAfter50);
        uint256 out50 = pool.swapAForB(1_000 ether, 0);
        assertEq(out50, expected50, "hook fee 50bps adopted (dynamic-fee live)");

        // e2: hostile hook wants 50_000bps (500%) → cap law → base 30bps math
        hook.configure(false, false, 50_000);
        ra = pool.reserveA();
        rb = pool.reserveB();
        uint256 inAfter30 = 1_000 ether - (1_000 ether * 30) / 10_000;
        uint256 expected30 = (rb * inAfter30) / (ra + inAfter30);
        uint256 out30 = pool.swapAForB(1_000 ether, 0);
        assertEq(out30, expected30, "hostile fee refused, base fee applied");
        assertTrue(out30 > out50, "50bps fee visibly cost more than 30bps");
    }
}
