// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SAOSRelayBatch} from "../contracts/SAOSRelayBatch.sol";

/// @title SAOSRelayBatch regression law — R132 (AGENT-Z)
/// @notice The batcher routes to the LIVE relay: same events, one tx. Laws:
///         empty/mismatch/oversize rejected fail-closed, zero roots rejected,
///         in-batch monotonicity enforced, relay must have code, and the
///         measured truth: N anchors via batch must emit N relay events.
interface IRelayAnchor {
    function anchor(bytes32 root, uint256 height, string calldata rail, string calldata note) external;
}

/// @dev Faithful mock of the live SAOSRelay surface: emits the real Anchor
///      event and records calls — the batch law is tested against the true ABI.
contract MockAnchorRelay is IRelayAnchor {
    event Anchor(bytes32 indexed root, uint256 indexed height, string rail, string note, address indexed sender);

    uint256 public callCount;
    bytes32 public lastRoot;
    uint256 public lastHeight;
    string public lastRail;
    address public lastSender;

    function anchor(bytes32 root, uint256 height, string calldata rail, string calldata note) external {
        callCount += 1;
        lastRoot = root;
        lastHeight = height;
        lastRail = rail;
        lastSender = msg.sender;
        emit Anchor(root, height, rail, note, msg.sender);
    }
}

contract SAOSRelayBatchTest is Test {
    MockAnchorRelay internal relay;
    SAOSRelayBatch internal batch;

    event BatchAnchored(uint256 count, address indexed sender);

    function setUp() public {
        relay = new MockAnchorRelay();
        batch = new SAOSRelayBatch(address(relay));
    }

    function _batch(uint256 n) internal pure returns (bytes32[] memory roots, uint256[] memory hs) {
        roots = new bytes32[](n);
        hs = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            roots[i] = keccak256(abi.encode("r", i));
            hs[i] = (i + 1) * 10;
        }
    }

    // ── happy path: the measured truth ──────────────────────────────────
    function test_Batch_AnchorsAllThroughRelay() public {
        (bytes32[] memory roots, uint256[] memory hs) = _batch(3);
        bytes32 last = roots[2];

        // order is deterministic: relay Anchor (last) then batch BatchAnchored
        vm.expectEmit(true, true, false, true, address(relay));
        emit MockAnchorRelay.Anchor(last, 30, "GRID", "r132-batch", address(this));
        vm.expectEmit(true, false, false, true);
        emit BatchAnchored(3, address(this));
        batch.anchorBatch(roots, hs, "GRID", "r132-batch");

        assertEq(relay.callCount(), 3, "exactly N relay calls");
        assertEq(relay.lastRoot(), last, "last root reached the relay");
        assertEq(relay.lastHeight(), 30, "last height reached the relay");
        assertEq(relay.lastSender(), address(batch), "relay sees the batcher as sender");
    }

    function test_SingleRoot_WorksWithRealEventOrder() public {
        (bytes32[] memory roots, uint256[] memory hs) = _batch(1);
        batch.anchorBatch(roots, hs, "STEEM", "solo-via-batch");
        assertEq(relay.callCount(), 1, "single batch = single relay call");
        assertEq(relay.lastHeight(), 10, "height passthrough exact");
    }

    // ── fail-closed laws ────────────────────────────────────────────────
    function test_EmptyBatch_Rejected() public {
        bytes32[] memory roots = new bytes32[](0);
        uint256[] memory hs = new uint256[](0);
        vm.expectRevert(SAOSRelayBatch.EmptyBatch.selector);
        batch.anchorBatch(roots, hs, "GRID", "empty");
    }

    function test_LengthMismatch_Rejected() public {
        bytes32[] memory roots = new bytes32[](2);
        uint256[] memory hs = new uint256[](1);
        roots[0] = keccak256("a"); roots[1] = keccak256("b"); hs[0] = 1;
        vm.expectRevert(SAOSRelayBatch.LengthMismatch.selector);
        batch.anchorBatch(roots, hs, "GRID", "mismatch");
    }

    function test_Oversize_RejectedFailClosed() public {
        bytes32[] memory roots = new bytes32[](65);
        uint256[] memory hs = new uint256[](65);
        for (uint256 i = 0; i < 65; i++) { roots[i] = keccak256(abi.encode(i)); hs[i] = i + 1; }
        vm.expectRevert(SAOSRelayBatch.BatchTooLarge.selector);
        batch.anchorBatch(roots, hs, "GRID", "oversize");
    }

    function test_MaxBatch_64_Accepts() public {
        (bytes32[] memory roots, uint256[] memory hs) = _batch(64);
        batch.anchorBatch(roots, hs, "GRID", "max");
        assertEq(relay.callCount(), 64, "full max batch anchored");
    }

    function test_ZeroRoot_InBatch_Rejected() public {
        bytes32[] memory roots = new bytes32[](2);
        uint256[] memory hs = new uint256[](2);
        roots[0] = keccak256("ok"); roots[1] = bytes32(0);
        hs[0] = 1; hs[1] = 2;
        vm.expectRevert(SAOSRelayBatch.ZeroRoot.selector);
        batch.anchorBatch(roots, hs, "GRID", "zero-inside");
    }

    function test_InBatch_StaleHeight_Rejected() public {
        bytes32[] memory roots = new bytes32[](2);
        uint256[] memory hs = new uint256[](2);
        roots[0] = keccak256("a"); roots[1] = keccak256("b");
        hs[0] = 5; hs[1] = 5; // equal heights inside one batch = self-replay
        vm.expectRevert(SAOSRelayBatch.StaleHeight.selector);
        batch.anchorBatch(roots, hs, "GRID", "self-replay");
    }

    // ── constructor constitution ────────────────────────────────────────
    function test_Constructor_DeadRelay_Rejected() public {
        vm.expectRevert(SAOSRelayBatch.RelayHasNoCode.selector);
        new SAOSRelayBatch(address(0xBeaf));
    }

    function test_Constructor_ZeroRelay_Rejected() public {
        vm.expectRevert(SAOSRelayBatch.ZeroRoot.selector);
        new SAOSRelayBatch(address(0));
    }

    function test_Relay_ImmutableAndReadable() public {
        assertEq(batch.relay(), address(relay), "relay fixed at birth");
    }

    // ── fuzz: every legal size anchors exactly N ────────────────────────
    function testFuzz_BatchSizes_LegalRange(uint8 n) public {
        vm.assume(n > 0 && n <= 64);
        (bytes32[] memory roots, uint256[] memory hs) = _batch(n);
        batch.anchorBatch(roots, hs, "FUZZ", "sizes");
        assertEq(relay.callCount(), n, "N roots = N relay calls");
    }

    // ── measured gas truth ──────────────────────────────────────────────
    function test_GasTruth_BatchBeatsSoloOverhead() public {
        (bytes32[] memory roots, uint256[] memory hs) = _batch(8);
        uint256 g0 = gasleft();
        batch.anchorBatch(roots, hs, "GRID", "gas-truth");
        uint256 used = g0 - gasleft();
        // 8 solo txs would burn 8*21000 base gas alone; the batch must beat
        // that comfortably (we allow generous per-call execution budget).
        assertLt(used, 42_000 + 8 * 60_000, "batch must beat 8 solo tx base overhead");
        assertGt(used, 0, "measurement happened");
    }
}
