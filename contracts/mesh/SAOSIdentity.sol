// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./MeshTypes.sol";

/// @title SAOS Identity — the sovereign agent registry (mesh link #1).
/// @notice Every initiator is auto-enlisted on its first run — the mesh
///         onboards its own agents. The real fleet EVM identities are also
///         registered here by the operator (public addresses only).
contract SAOSIdentity {
    address public owner;
    address public relay;

    struct Agent { address addr; string handle; uint64 joinedAt; uint64 runs; }
    Agent[] private _agents;
    mapping(address => uint256) private _indexPlusOne; // 0 = unknown

    event AgentRegistered(uint256 indexed agentIndex, address indexed agent, string handle);
    event IdentityStamped(uint256 indexed runId, address indexed initiator, uint256 agentIndex, uint64 totalRuns);

    error NotOwner();
    error NotRelay();

    constructor() { owner = msg.sender; }

    function wire(address relayAddr) external {
        if (msg.sender != owner) revert NotOwner();
        relay = relayAddr;
    }

    function register(address agent, string calldata handle) external {
        if (msg.sender != owner) revert NotOwner();
        _register(agent, handle);
    }

    function _register(address agent, string memory handle) internal {
        if (_indexPlusOne[agent] != 0) return; // idempotent
        _agents.push(Agent(agent, handle, uint64(block.timestamp), 0));
        _indexPlusOne[agent] = _agents.length;
        emit AgentRegistered(_agents.length - 1, agent, handle);
    }

    function agentCount() external view returns (uint256) { return _agents.length; }
    function agentAt(uint256 i) external view returns (Agent memory) { return _agents[i]; }

    function process(uint256 runId, bytes calldata context) external returns (bytes memory) {
        if (msg.sender != relay) revert NotRelay();
        (address initiator, ) = abi.decode(context, (address, string));
        uint256 idxPlus = _indexPlusOne[initiator];
        uint256 idx;
        if (idxPlus == 0) {
            string memory handle = string(abi.encodePacked("SAOS-", _itoa(_agents.length)));
            _agents.push(Agent(initiator, handle, uint64(block.timestamp), 1));
            idx = _agents.length - 1;
            _indexPlusOne[initiator] = _agents.length;
            emit AgentRegistered(idx, initiator, handle);
        } else {
            idx = idxPlus - 1;
            _agents[idx].runs += 1;
        }
        emit IdentityStamped(runId, initiator, idx, _agents[idx].runs);
        IRelayPass(relay).pass(runId, context);
        return context;
    }

    function _itoa(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 x = v;
        uint256 d;
        while (x != 0) { d++; x /= 10; }
        bytes memory b = new bytes(d);
        x = v;
        while (x != 0) { b[--d] = bytes1(uint8(48 + x % 10)); x /= 10; }
        return string(b);
    }
}
