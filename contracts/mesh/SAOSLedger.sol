// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./MeshTypes.sol";

/// @title SAOS Ledger — the zero-fee internal value rail (mesh link #2).
/// @notice ללא עמלה — the fee is a compile-time zero, forever. Every mesh
///         run mints a small sovereign reward (mint קטן) to the initiating
///         agent, and internal transfers never pay anything.
contract SAOSLedger {
    address public owner;
    address public relay;

    string public constant SYMBOL = "SAOS-M";
    uint256 public constant RUN_REWARD = 10 ether; // 10 SAOS-M per run (small mint)
    uint256 public constant FEE = 0;               // forever zero — by construction

    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;
    uint256 public runMinted;
    uint256 public transfersCount;
    uint256 public valueMoved;

    event RewardPaid(uint256 indexed runId, address indexed to, uint256 amount);
    event ZeroFeeTransfer(uint256 indexed seq, address indexed from, address indexed to, uint256 amount, uint256 fee);

    error NotOwner();
    error NotRelay();
    error InsufficientBalance();

    constructor() { owner = msg.sender; }

    function wire(address relayAddr) external {
        if (msg.sender != owner) revert NotOwner();
        relay = relayAddr;
    }

    function process(uint256 runId, bytes calldata context) external returns (bytes memory) {
        if (msg.sender != relay) revert NotRelay();
        (address initiator, ) = abi.decode(context, (address, string));
        balanceOf[initiator] += RUN_REWARD;
        totalSupply += RUN_REWARD;
        runMinted += RUN_REWARD;
        emit RewardPaid(runId, initiator, RUN_REWARD);
        IRelayPass(relay).pass(runId, context);
        return context;
    }

    /// @dev Sovereign internal transfer — zero fee, forever.
    function transfer(address to, uint256 amount) external returns (bool) {
        if (balanceOf[msg.sender] < amount) revert InsufficientBalance();
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        transfersCount += 1;
        valueMoved += amount;
        emit ZeroFeeTransfer(transfersCount, msg.sender, to, amount, FEE);
        return true;
    }
}
