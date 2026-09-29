// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./MeshTypes.sol";

/// @title SAOS Solutions — every mesh run commits a solution on-chain
///        (mesh link #3): פתרונות. Identity → value → solution: the run
///        itself becomes a durable, hash-committed artifact.
contract SAOSSolutions {
    address public owner;
    address public relay;

    struct Solution { uint256 runId; address agent; string title; bytes32 digest; uint64 at; }
    Solution[] private _solutions;

    event SolutionCommitted(uint256 indexed solutionId, uint256 indexed runId, address indexed agent, string title, bytes32 digest);

    error NotOwner();
    error NotRelay();
    error ZeroAddress();
    error AlreadyWired();

    constructor() { owner = msg.sender; }

    /// @dev v91 — one-time, zero-address-free wiring.
    function wire(address relayAddr) external {
        if (msg.sender != owner) revert NotOwner();
        if (relayAddr == address(0)) revert ZeroAddress();
        if (relay != address(0)) revert AlreadyWired();
        relay = relayAddr;
    }

    function solutionCount() external view returns (uint256) { return _solutions.length; }
    function solutionAt(uint256 i) external view returns (Solution memory) { return _solutions[i]; }

    function process(uint256 runId, bytes calldata context) external returns (bytes memory) {
        if (msg.sender != relay) revert NotRelay();
        (address initiator, string memory intent) = abi.decode(context, (address, string));
        bytes32 digest = keccak256(abi.encodePacked(runId, initiator, intent, block.number, block.timestamp));
        _solutions.push(Solution(runId, initiator, intent, digest, uint64(block.timestamp)));
        emit SolutionCommitted(_solutions.length - 1, runId, initiator, intent, digest);
        IRelayPass(relay).pass(runId, context);
        return context;
    }
}
