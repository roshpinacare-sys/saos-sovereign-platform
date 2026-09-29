// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./MeshTypes.sol";

/// @title SAOS Value Engine — efficiency & value scoring: ערך · יעילות.
/// @dev score = (BASE + HOP_VALUE × hops)² / (gasUsed/GAS_DIV + 1) —
///      denser value per gas unit earns a higher sovereign score. Every
///      completed run is scored; aggregates track the mesh economy.
contract SAOSValueEngine {
    address public owner;
    address public hub;
    address public relay;

    uint256 public constant BASE = 1000;      // base value units
    uint256 public constant HOP_VALUE = 250;  // value units per mesh hop
    uint256 public constant GAS_DIV = 1000;   // gas normalization divisor

    struct Score { uint256 gasUsed; uint256 hops; uint256 score; uint64 at; }
    mapping(uint256 => Score) public scores;

    uint256 public scoredRuns;
    uint256 public totalScore;
    uint256 public totalGas;
    uint256 public bestScore;

    event ValueScored(uint256 indexed runId, uint256 score, uint256 gasUsed, uint256 hops);

    error NotOwner();
    error NotHub();
    error ZeroAddress();
    error AlreadyWired();

    constructor() { owner = msg.sender; }

    /// @dev v91 — one-time, zero-address-free wiring.
    function wire(address hubAddr, address relayAddr) external {
        if (msg.sender != owner) revert NotOwner();
        if (hubAddr == address(0) || relayAddr == address(0)) revert ZeroAddress();
        if (hub != address(0) || relay != address(0)) revert AlreadyWired();
        hub = hubAddr;
        relay = relayAddr;
    }

    function efficiencyOf(uint256 hops, uint256 gasUsed) public pure returns (uint256) {
        uint256 value = (BASE + HOP_VALUE * hops) * (BASE + HOP_VALUE * hops);
        return value / (gasUsed / GAS_DIV + 1);
    }

    function finalize(uint256 runId, uint256 gasUsed) external returns (uint256) {
        if (msg.sender != hub) revert NotHub();
        uint256 hops = IRelayLinkCount(relay).linkCount();
        uint256 score = efficiencyOf(hops, gasUsed);
        scores[runId] = Score(gasUsed, hops, score, uint64(block.timestamp));
        scoredRuns += 1;
        totalScore += score;
        totalGas += gasUsed;
        if (score > bestScore) bestScore = score;
        emit ValueScored(runId, score, gasUsed, hops);
        return score;
    }

    function averageScore() external view returns (uint256) {
        return scoredRuns == 0 ? 0 : totalScore / scoredRuns;
    }
}
