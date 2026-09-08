// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SAOS Sovereign Relay — הממסר הריבוני
/// @notice The fee-free on-chain link of the SAOS network: seal roots and
///         agent enlistments become immutable events on Ethereum (and any
///         EVM chain — the same code deploys on BSC). Zero protocol fees —
///         senders pay only chain gas. No owner, no upgrade path, no
///         pauser, no payable functions: the relay is immutable by
///         construction and can never hold or take funds.
/// @dev    saos-relay/v1 · source of truth: saos-sovereign-platform
contract SAOSRelay {
    /// @dev A SAOS-NET seal root anchored through the relay (merkle root → chain event).
    event Anchor(bytes32 indexed root, uint256 indexed height, string rail, string note, address indexed sender);

    /// @dev An agent of the SAOS network enlists under its PUBLIC identity (never a secret).
    event Enlist(string agent, string rail, string identity, address indexed sender);

    /// @notice Anchor a SAOS-NET seal root. No fee, no gatekeeping, immutable log.
    function anchor(bytes32 root, uint256 height, string calldata rail, string calldata note) external {
        emit Anchor(root, height, rail, note, msg.sender);
    }

    /// @notice Enlist an agent identity (public info only — addresses/account names).
    function enlist(string calldata agent, string calldata rail, string calldata identity) external {
        emit Enlist(agent, rail, identity, msg.sender);
    }
}
