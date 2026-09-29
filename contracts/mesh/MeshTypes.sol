// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SAOS Mesh Types — the shared interfaces of the contract mesh.
/// @notice פריסת כל החוזים: חוזה שמדבר לחוזה שמדבר לחוזה. The run context is
///         abi.encode(address initiator, string intent) and flows unchanged
///         through every hop — the events are the on-chain trail.

/// @dev One link in the mesh chain. A link processes a run and MUST continue
///      the chain by calling IRelayPass.pass(runId, context).
interface IMeshLink {
    function process(uint256 runId, bytes calldata context) external returns (bytes memory);
}

/// @dev The switchboard — links call pass() to hop to the next contract.
interface IRelayPass {
    function pass(uint256 runId, bytes calldata context) external;
}

/// @dev The hub starts each run here.
interface IRelayStart {
    function start(uint256 runId, bytes calldata context) external;
}

/// @dev The relay calls the hub when the chain is exhausted.
interface IHubComplete {
    function complete(uint256 runId, uint256 gasUsed) external;
}

/// @dev The value engine is finalized by the hub at run completion.
interface IValueFinalize {
    function finalize(uint256 runId, uint256 gasUsed) external returns (uint256 score);
}

/// @dev Read view used by the value engine (hops per run).
interface IRelayLinkCount {
    function linkCount() external view returns (uint256);
}
