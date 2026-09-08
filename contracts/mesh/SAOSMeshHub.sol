// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./MeshTypes.sol";

/// @title SAOS Mesh Hub — the sovereign dispatch of the contract chain.
/// @notice One intent, one transaction, seven contracts:
///         Hub → Relay → Identity → Ledger → Solutions → Bridge → Hub →
///         ValueEngine. Every arrow is a real contract-to-contract call.
contract SAOSMeshHub {
    address public owner;
    IRelayStart public relay;
    IValueFinalize public valueEngine;

    enum Status { Open, Completed }
    struct Run {
        address initiator;
        string intent;
        uint64 startedAt;
        uint64 completedAt;
        Status status;
    }
    mapping(uint256 => Run) public runs;
    uint256 public runCount;
    uint256 public completedCount;
    uint256 public totalGasUsed;

    event RunDispatched(uint256 indexed runId, address indexed initiator, string intent);
    event RunCompleted(uint256 indexed runId, uint256 gasUsed, uint256 score, uint64 duration);

    error NotOwner();
    error NotRelay();
    error AlreadyCompleted();

    constructor() { owner = msg.sender; }

    function wire(address relayAddr, address valueEngineAddr) external {
        if (msg.sender != owner) revert NotOwner();
        relay = IRelayStart(relayAddr);
        valueEngine = IValueFinalize(valueEngineAddr);
    }

    /// @dev Entry point of the mesh: dispatch a run through the whole chain.
    function dispatch(string calldata intent) external returns (uint256 runId) {
        runId = ++runCount;
        runs[runId] = Run(msg.sender, intent, uint64(block.timestamp), 0, Status.Open);
        emit RunDispatched(runId, msg.sender, intent);
        relay.start(runId, abi.encode(msg.sender, intent));
        return runId;
    }

    /// @dev Called by the relay when every link has processed the run.
    function complete(uint256 runId, uint256 gasUsed) external {
        if (msg.sender != address(relay)) revert NotRelay();
        Run storage r = runs[runId];
        if (r.status == Status.Completed) revert AlreadyCompleted();
        r.status = Status.Completed;
        r.completedAt = uint64(block.timestamp);
        completedCount += 1;
        totalGasUsed += gasUsed;
        uint256 score = valueEngine.finalize(runId, gasUsed);
        emit RunCompleted(runId, gasUsed, score, r.completedAt - r.startedAt);
    }
}
