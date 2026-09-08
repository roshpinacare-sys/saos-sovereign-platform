// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./MeshTypes.sol";

/// @title SAOS Mesh Relay — the switchboard: routes each run through the
///        ordered chain of links, hop by hop, and measures the gas trail.
/// @notice דבר מוביל לדבר: each link calls pass() and the message jumps to
///         the NEXT contract. When the chain is exhausted the hub completes.
contract SAOSMeshRelay {
    address public owner;
    IHubComplete public hub;
    address[] public links;

    mapping(uint256 => uint256) public cursor;   // runId → next link index
    mapping(uint256 => uint256) public startGas; // runId → gas at chain start

    event Hop(uint256 indexed runId, uint256 indexed index, address indexed link, uint256 gasBefore);

    error NotOwner();
    error NotHub();
    error NotActiveLink();

    constructor() { owner = msg.sender; }

    function wireHub(address hubAddr) external {
        if (msg.sender != owner) revert NotOwner();
        hub = IHubComplete(hubAddr);
    }

    function addLink(address link) external {
        if (msg.sender != owner) revert NotOwner();
        links.push(link);
    }

    function linkCount() external view returns (uint256) { return links.length; }

    /// @dev The hub starts the chain here.
    function start(uint256 runId, bytes calldata context) external {
        if (msg.sender != address(hub)) revert NotHub();
        startGas[runId] = gasleft();
        cursor[runId] = 0;
        _pass(runId, context);
    }

    /// @dev The link that just processed the run continues the chain.
    function pass(uint256 runId, bytes calldata context) external {
        uint256 i = cursor[runId];
        if (i == 0 || i > links.length || links[i - 1] != msg.sender) revert NotActiveLink();
        _pass(runId, context);
    }

    function _pass(uint256 runId, bytes memory context) internal {
        uint256 i = cursor[runId];
        if (i >= links.length) {
            hub.complete(runId, startGas[runId] - gasleft());
            return;
        }
        address link = links[i];
        cursor[runId] = i + 1;
        emit Hop(runId, i, link, gasleft());
        IMeshLink(link).process(runId, context);
    }
}
