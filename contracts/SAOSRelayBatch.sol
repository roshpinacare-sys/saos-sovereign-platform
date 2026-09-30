// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SAOS Relay Batch — the gas optimizer of the LIVE relay (R132, AGENT-Z)
/// @notice The fleet's anchoring rail (SAOSRelay, live on Ethereum/OP/Base)
///         costs one transaction per anchor. On daily cadence that is fine;
///         on per-digest cadence (grid ticks, forge runs, receipts) it is
///         3x the L2 overhead. This batcher anchors N roots in ONE call —
///         same immutable events, one base-fee, one signature.
/// @dev    saos-relaybatch/v1 · the relay is immutable and permissionless —
///         anyone may route through the batcher; no owner, no fees, no
///         payable, immutable by construction.
interface ISAOSRelay {
    function anchor(bytes32 root, uint256 height, string calldata rail, string calldata note) external;
}

contract SAOSRelayBatch {
    /// @dev Emitted once per batch — the relay's own Anchor events carry the detail.
    event BatchAnchored(uint256 count, address indexed sender);

    error EmptyBatch();
    error LengthMismatch();
    error BatchTooLarge();
    error ZeroRoot();
    error RelayHasNoCode();
    error StaleHeight();

    /// @dev fail-closed batch bound (the cap is the law, not a knob)
    uint256 public constant MAX_BATCH = 64;

    /// @dev The live relay this batcher routes to (immutable — like the chain it lives on).
    address public immutable relay;

    constructor(address relay_) {
        if (relay_ == address(0)) revert ZeroRoot();
        uint256 size;
        assembly { size := extcodesize(relay_) }
        if (size == 0) revert RelayHasNoCode();
        relay = relay_;
    }

    /// @notice Anchor a batch of seal roots to the live relay in one tx.
    ///         Roots must be non-zero; heights are domain-local and enforced
    ///         monotonic BY THE CALLER's domain law (the relay itself is a
    ///         fee-free log; monotonicity here protects the batch from
    ///         self-replay inside a single call).
    function anchorBatch(
        bytes32[] calldata roots,
        uint256[] calldata heights,
        string calldata rail,
        string calldata note
    ) external {
        uint256 n = roots.length;
        if (n == 0) revert EmptyBatch();
        if (n != heights.length) revert LengthMismatch();
        if (n > MAX_BATCH) revert BatchTooLarge();

        uint256 prev = 0;
        for (uint256 i = 0; i < n; ++i) {
            if (roots[i] == bytes32(0)) revert ZeroRoot();
            if (heights[i] <= prev && i > 0) revert StaleHeight();
            prev = heights[i];
            ISAOSRelay(relay).anchor(roots[i], heights[i], rail, note);
        }

        emit BatchAnchored(n, msg.sender);
    }

}
