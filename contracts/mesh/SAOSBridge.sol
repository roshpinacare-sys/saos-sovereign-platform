// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./MeshTypes.sol";

/// @title SAOS Bridge — stamps the 8-chain grid state into every mesh run
///        (mesh link #4): the EXTERNAL network state (SAOS-NET, STEEM,
///        BLURT, HIVE, TRON, ETHEREUM, BSC, SOLANA) flows INTO the contract
///        mesh — the whole organism is anchored inside every run.
contract SAOSBridge {
    address public owner;
    address public relay;

    struct Anchor { string chain; uint256 height; bytes32 digest; uint64 at; }
    string[] private _chains;
    mapping(string => Anchor) private _latest;

    event ChainRegistered(string chain);
    event ExternalAnchored(string chain, uint256 height, bytes32 digest);
    event AnchorStamped(uint256 indexed runId, string chain, uint256 height, bytes32 digest);

    error NotOwner();
    error NotRelay();
    error UnknownChain();

    constructor() { owner = msg.sender; }

    function wire(address relayAddr) external {
        if (msg.sender != owner) revert NotOwner();
        relay = relayAddr;
    }

    function registerChain(string calldata chain) external {
        if (msg.sender != owner) revert NotOwner();
        if (_latest[chain].at != 0) return; // idempotent
        _chains.push(chain);
        _latest[chain] = Anchor(chain, 0, 0, uint64(block.timestamp));
        emit ChainRegistered(chain);
    }

    function chainCount() external view returns (uint256) { return _chains.length; }
    function chains() external view returns (string[] memory) { return _chains; }
    function latestAnchor(string calldata chain) external view returns (Anchor memory) { return _latest[chain]; }

    /// @dev The operator (mesh backend) pushes LIVE external heights in.
    function anchorExternal(string calldata chain, uint256 height, bytes32 digest) external {
        if (msg.sender != owner) revert NotOwner();
        Anchor storage a = _latest[chain];
        if (a.at == 0) revert UnknownChain();
        a.height = height;
        a.digest = digest;
        a.at = uint64(block.timestamp);
        emit ExternalAnchored(chain, height, digest);
    }

    /// @dev Bulk anchor refresh — one transaction, all rails at once.
    function anchorExternalBulk(
        string[] calldata chainList,
        uint256[] calldata heights,
        bytes32[] calldata digests
    ) external {
        if (msg.sender != owner) revert NotOwner();
        require(chainList.length == heights.length && chainList.length == digests.length, "SAOS: length mismatch");
        for (uint256 i = 0; i < chainList.length; i++) {
            Anchor storage a = _latest[chainList[i]];
            if (a.at == 0) continue; // not registered — skip honestly
            a.height = heights[i];
            a.digest = digests[i];
            a.at = uint64(block.timestamp);
            emit ExternalAnchored(chainList[i], heights[i], digests[i]);
        }
    }

    function process(uint256 runId, bytes calldata context) external returns (bytes memory) {
        if (msg.sender != relay) revert NotRelay();
        for (uint256 i = 0; i < _chains.length; i++) {
            Anchor memory a = _latest[_chains[i]];
            emit AnchorStamped(runId, a.chain, a.height, a.digest);
        }
        IRelayPass(relay).pass(runId, context);
        return context;
    }
}
