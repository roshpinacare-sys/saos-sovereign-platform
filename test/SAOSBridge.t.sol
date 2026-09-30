// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SAOSBridge} from "../contracts/mesh/SAOSBridge.sol";
import {MockRelay} from "./MockRelay.sol";

/// @title SAOSBridge regression law — B-2 (R130)
/// @notice The bridge is honestly an AnchorOracle (single-signer stamps), but
///         even an oracle must be MONOTONIC and evidence-backed. Locks
///         audit-fix v5: stale/replayed heights rejected, zero digests
///         rejected, unregistered chains skipped honestly in bulk mode.
contract SAOSBridgeTest is Test {
    SAOSBridge internal bridge;
    MockRelay internal relay;

    address internal attacker = makeAddr("attacker");

    event ExternalAnchored(string chain, uint256 height, bytes32 digest);
    event AnchorStamped(uint256 indexed runId, string chain, uint256 height, bytes32 digest);

    function setUp() public {
        bridge = new SAOSBridge();
        relay = new MockRelay();
        bridge.wire(address(relay));
        bridge.registerChain("ETHEREUM");
        bridge.registerChain("STEEM");
    }

    bytes32 internal constant D1 = bytes32(uint256(0x1111));
    bytes32 internal constant D2 = bytes32(uint256(0x2222));

    function test_Anchor_Monotonic_Forward_OK() public {
        bridge.anchorExternal("ETHEREUM", 100, D1);
        SAOSBridge.Anchor memory a = bridge.latestAnchor("ETHEREUM");
        assertEq(a.height, 100);
        assertEq(a.digest, D1);
        bridge.anchorExternal("ETHEREUM", 101, D2);
        a = bridge.latestAnchor("ETHEREUM");
        assertEq(a.height, 101);
        assertEq(a.digest, D2);
    }

    function test_Anchor_SameHeight_Reverts() public {
        bridge.anchorExternal("ETHEREUM", 100, D1);
        vm.expectRevert(SAOSBridge.StaleHeight.selector);
        bridge.anchorExternal("ETHEREUM", 100, D2);
    }

    function testFuzz_Anchor_ReplayedOrStale_Reverts(uint256 back) public {
        back = bound(back, 0, 99);
        bridge.anchorExternal("ETHEREUM", 100, D1);
        vm.expectRevert(SAOSBridge.StaleHeight.selector);
        bridge.anchorExternal("ETHEREUM", back, D2); // replay of an old truth
    }

    function test_Anchor_ZeroDigest_Reverts() public {
        vm.expectRevert(SAOSBridge.ZeroAddress.selector);
        bridge.anchorExternal("ETHEREUM", 101, bytes32(0));
    }

    function test_Anchor_UnknownChain_Reverts() public {
        vm.expectRevert(SAOSBridge.UnknownChain.selector);
        bridge.anchorExternal("SOLANA", 1, D1);
    }

    function test_Anchor_NonOwner_Reverts() public {
        vm.prank(attacker);
        vm.expectRevert(SAOSBridge.NotOwner.selector);
        bridge.anchorExternal("ETHEREUM", 999, D1);
    }

    function test_Bulk_Anchors_AllRegistered() public {
        string[] memory cs = new string[](2);
        uint256[] memory hs = new uint256[](2);
        bytes32[] memory ds = new bytes32[](2);
        cs[0] = "ETHEREUM"; hs[0] = 10; ds[0] = D1;
        cs[1] = "STEEM";    hs[1] = 20; ds[1] = D2;

        bridge.anchorExternalBulk(cs, hs, ds);
        assertEq(bridge.latestAnchor("ETHEREUM").height, 10);
        assertEq(bridge.latestAnchor("STEEM").height, 20);
    }

    function test_Bulk_SkipsUnregistered_RejectsStaleAndEmpty() public {
        bridge.anchorExternal("ETHEREUM", 100, D1);

        string[] memory cs = new string[](3);
        uint256[] memory hs = new uint256[](3);
        bytes32[] memory ds = new bytes32[](3);
        cs[0] = "SOLANA";   hs[0] = 5;  ds[0] = D1;  // unregistered → skipped
        cs[1] = "ETHEREUM"; hs[1] = 99; ds[1] = D2;  // stale → must revert
        cs[2] = "STEEM";    hs[2] = 7;  ds[2] = D2;

        vm.expectRevert(SAOSBridge.StaleHeight.selector);
        bridge.anchorExternalBulk(cs, hs, ds);
    }

    function test_Bulk_ZeroDigest_Reverts() public {
        string[] memory cs = new string[](1);
        uint256[] memory hs = new uint256[](1);
        bytes32[] memory ds = new bytes32[](1);
        cs[0] = "ETHEREUM"; hs[0] = 3; ds[0] = bytes32(0);
        vm.expectRevert(SAOSBridge.ZeroAddress.selector);
        bridge.anchorExternalBulk(cs, hs, ds);
    }

    function test_Bulk_LengthMismatch_Reverts() public {
        string[] memory cs = new string[](2);
        uint256[] memory hs = new uint256[](1);
        bytes32[] memory ds = new bytes32[](1);
        vm.expectRevert();
        bridge.anchorExternalBulk(cs, hs, ds);
    }

    function test_RegisterChain_Idempotent() public {
        bridge.registerChain("ETHEREUM"); // no-op, no duplicate
        assertEq(bridge.chainCount(), 2);
    }

    /// every mesh run stamps ALL registered chains — the whole grid rides
    /// inside each run (this is the "organism" property, kept under law)
    function test_Process_StampsAllChains_AndContinues() public {
        bridge.anchorExternal("ETHEREUM", 100, D1);
        bridge.anchorExternal("STEEM", 200, D2);

        vm.expectEmit(true, true, false, true, address(bridge));
        emit AnchorStamped(1, "ETHEREUM", 100, D1);
        vm.expectEmit(true, true, false, true, address(bridge));
        emit AnchorStamped(1, "STEEM", 200, D2);

        vm.prank(address(relay));
        bridge.process(1, abi.encode(address(this), "grid.run"));

        assertEq(relay.passCount(), 1);
    }

    function test_Process_NonRelay_Reverts() public {
        vm.prank(attacker);
        vm.expectRevert(SAOSBridge.NotRelay.selector);
        bridge.process(1, abi.encode(attacker, "x"));
    }
}
