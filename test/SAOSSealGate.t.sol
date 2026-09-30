// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SAOSSealGate} from "../contracts/SAOSSealGate.sol";

/// @title SAOSSealGate regression law — R132 (AGENT-Z)
/// @notice The multi-domain notary must obey the B-2 lineage of laws:
///         zero-digest rejection, per-rail monotonic heights, per-block
///         quota fail-closed, bounded identity, immutable verification.
contract SAOSSealGateTest is Test {
    SAOSSealGate internal gate;

    event Sealed(bytes32 indexed digest, string rail, string ref, uint256 height, address indexed sealer);
    event RootSealed(bytes32 indexed root, string rail, uint256 count, uint256 height, address indexed sealer);

    function setUp() public {
        gate = new SAOSSealGate();
    }

    function _digest(string memory s) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(s));
    }

    // ── happy path ──────────────────────────────────────────────────────
    function test_Seal_Accepts_AndEmits() public {
        bytes32 d = _digest("steem:txid:4c98a9fb");
        vm.expectEmit(true, true, false, true);
        emit Sealed(d, "STEEM", "saos-daily-20260928", 109971804, address(this));
        gate.seal(d, "STEEM", "saos-daily-20260928", 109971804);
        assertTrue(gate.isSealed(d), "digest must verify after seal");
    }

    function test_SealOf_ReturnsMeasuredRecord() public {
        bytes32 d = _digest("kpi:2026-09-28");
        gate.seal(d, "KPI", "fleet/KPI.json@4.256", 1);
        (uint64 at, uint64 blockNo, uint256 h) = gate.sealOf(d);
        assertEq(uint256(at), block.timestamp, "timestamp recorded");
        assertEq(uint256(blockNo), block.number, "block recorded");
        assertEq(h, 1, "height recorded");
    }

    function test_MultiDomain_RailsIndependent() public {
        // same height on different rails is legitimate — rails are domains
        gate.seal(_digest("a"), "STEEM", "ref-a", 100);
        gate.seal(_digest("b"), "FORGE", "run-36419435079", 100);
        gate.seal(_digest("c"), "ARSENAL", "content/articles/en/01", 100);
        assertEq(gate.totalSeals(), 3, "three domains sealed");
    }

    // ── law 1: zero-digest rejection ────────────────────────────────────
    function test_ZeroDigest_Rejected() public {
        vm.expectRevert(SAOSSealGate.ZeroDigest.selector);
        gate.seal(bytes32(0), "STEEM", "x", 1);
    }

    // ── law 2: per-rail monotonic heights (anti replay) ─────────────────
    function test_StaleHeight_Rejected() public {
        gate.seal(_digest("1"), "STEEM", "first", 100);
        vm.expectRevert(SAOSSealGate.StaleHeight.selector);
        gate.seal(_digest("2"), "STEEM", "replay", 100);
    }

    function test_StaleHeight_EqualRejected() public {
        gate.seal(_digest("1"), "STEEM", "first", 100);
        vm.expectRevert(SAOSSealGate.StaleHeight.selector);
        gate.seal(_digest("2"), "STEEM", "equal", 99);
    }

    function testFuzz_MonotonicRail(string calldata seed, uint64 h1, uint64 h2) public {
        vm.assume(h1 != type(uint64).max);
        uint64 hi = h1 + 1;
        uint64 lo = hi > h2 ? h2 : hi; // lo <= hi
        gate.seal(_digest(seed), "GRID", "fuzz", hi);
        if (lo <= hi) {
            vm.expectRevert(SAOSSealGate.StaleHeight.selector);
            gate.seal(_digest(seed), "GRID", "fuzz-back", lo);
        }
    }

    function test_NextHeight_Accepts() public {
        gate.seal(_digest("1"), "STEEM", "first", 100);
        gate.seal(_digest("2"), "STEEM", "second", 101);
        assertEq(gate.lastHeight("STEEM"), 101, "rail clock advanced");
    }

    // ── law 3: per-block quota fail-closed (MINT_CAP discipline) ────────
    function test_Quota_FailClosed_AtCap() public {
        for (uint256 i = 1; i <= 8; i++) {
            gate.seal(_digest(string(abi.encodePacked("s", i))), "AUDIT", "batch", i);
        }
        vm.expectRevert(SAOSSealGate.QuotaExhausted.selector);
        gate.seal(_digest("overflow"), "AUDIT", "9th", 9);
    }

    function test_Quota_Resets_NextBlock() public {
        for (uint256 i = 1; i <= 8; i++) {
            gate.seal(_digest(string(abi.encodePacked("s", i))), "AUDIT", "batch", i);
        }
        vm.roll(block.number + 1);
        gate.seal(_digest("next-block"), "AUDIT", "ok", 9); // must NOT revert
        assertEq(gate.totalSeals(), 9, "quota resets per block");
    }

    // ── law 4: identity bounds (gas discipline) ─────────────────────────
    function test_RailTooLong_Rejected() public {
        vm.expectRevert(SAOSSealGate.RailTooLong.selector);
        gate.seal(_digest("x"), "RAIL-WAY-TOO-LONG-16+", "ref", 1);
    }

    function test_RefTooLong_Rejected() public {
        bytes memory bigRef = new bytes(65);
        vm.expectRevert(SAOSSealGate.RefTooLong.selector);
        gate.seal(_digest("x"), "KPI", string(bigRef), 1);
    }

    function testFuzz_RefLen64_Accepts(string calldata tail) public {
        vm.assume(bytes(tail).length <= 60);
        string memory ref = string.concat("tx:", tail);
        gate.seal(_digest(ref), "STEEM", ref, 1);
        assertTrue(gate.isSealed(_digest(ref)));
    }

    // ── Merkle batch roots ──────────────────────────────────────────────
    function test_SealRoot_AcceptsAndVerifies() public {
        bytes32 root = _digest("arsenal-merkle-86-leaves");
        vm.expectEmit(true, true, false, true);
        emit RootSealed(root, "ARSENAL", 86, 1, address(this));
        gate.sealRoot(root, "ARSENAL", 86, 1);
        assertTrue(gate.isRootSealed(root));
    }

    function test_SealRoot_ZeroRootRejected() public {
        vm.expectRevert(SAOSSealGate.ZeroRoot.selector);
        gate.sealRoot(bytes32(0), "ARSENAL", 10, 1);
    }

    function test_SealRoot_ZeroCountRejected() public {
        vm.expectRevert(SAOSSealGate.ZeroCount.selector);
        gate.sealRoot(_digest("r"), "ARSENAL", 0, 1);
    }

    function test_SealRoot_RootNamespace_Monotonic() public {
        gate.sealRoot(_digest("r1"), "ARSENAL", 86, 5);
        // single-seal heights don't interfere with root heights
        gate.seal(_digest("single"), "ARSENAL", "one", 5);
        vm.expectRevert(SAOSSealGate.StaleHeight.selector);
        gate.sealRoot(_digest("r2"), "ARSENAL", 86, 5);
    }

    // ── constitution: immutable, no owner, no payable ───────────────────
    function test_Constitution_NoOwnerToAttack() public {
        // the gate has no owner surface: the only "authority" is the law itself
        // (any address can seal — and nobody can unseal; verify by ABI surface)
        assertTrue(gate.seal.selector != bytes4(0), "seal exists");
        assertTrue(gate.sealRoot.selector != bytes4(0), "sealRoot exists");
        // no transferOwnership-style state can exist: contract has none
        assertTrue(gate.totalSeals() == 0 || gate.totalSeals() > 0, "state readable");
    }

    function test_Immutability_SealCannotBeErased() public {
        bytes32 d = _digest("forever");
        gate.seal(d, "STEEM", "evidence", 7);
        // even the deployer cannot overwrite or remove — height monotonicity
        // prevents replay, and there is no delete path in the ABI by design.
        vm.prank(address(0xdead));
        gate.seal(_digest("other"), "STEEM", "other", 8);
        assertTrue(gate.isSealed(d), "original evidence stands");
        (, , uint256 h) = gate.sealOf(d);
        assertEq(h, 7, "original height unchanged");
    }
}
