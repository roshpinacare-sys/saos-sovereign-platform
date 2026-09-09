// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./MeshTypes.sol";

/// @title SAOS Ledger — the zero-fee internal value rail (mesh link #2).
/// @notice ללא עמלה — the fee is a compile-time zero, forever. Every mesh
///         run mints a small sovereign reward (mint קטן) to the initiating
///         agent, and internal transfers never pay anything.
///         v2 — payroll: every run also mints the same reward to the work
///         board (set by the owner), so the HQ can always pay its soldiers
///         through the zero-fee rail. עבודה ממומנת: mint קטן לחייל + mint
///         קטן לקופת העבודה — בכל ריצה.
contract SAOSLedger {
    address public owner;
    address public relay;
    address public payroll; // the SAOSWorkBoard — funded by every run

    string public constant SYMBOL = "SAOS-M";
    uint256 public constant RUN_REWARD = 10 ether; // 10 SAOS-M per run (small mint)
    uint256 public constant FEE = 0;               // forever zero — by construction

    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;
    uint256 public runMinted;
    uint256 public transfersCount;
    uint256 public valueMoved;

    event RewardPaid(uint256 indexed runId, address indexed to, uint256 amount);
    event PayrollFunded(uint256 indexed runId, address indexed payroll, uint256 amount);
    event ZeroFeeTransfer(uint256 indexed seq, address indexed from, address indexed to, uint256 amount, uint256 fee);
    event FloatMinted(address indexed to, uint256 amount, string reason);

    error NotOwner();
    error NotRelay();
    error InsufficientBalance();

    constructor() { owner = msg.sender; }

    /// @dev v4 — הבורסה: sovereign exchange float. A policy mint (owner-only,
    ///      journaled with its reason) that seeds the SAOS-NET exchange pools.
    ///      Lab-internal value: SAOS-M stays מטבע-מעבדה — the float is
    ///      LIQUIDITY, not circulation; every unit sits in pools/traders.
    function sovereignMint(address to, uint256 amount, string calldata reason) external {
        if (msg.sender != owner) revert NotOwner();
        if (amount == 0) revert InsufficientBalance();
        balanceOf[to] += amount;
        totalSupply += amount;
        emit FloatMinted(to, amount, reason);
    }

    function wire(address relayAddr) external {
        if (msg.sender != owner) revert NotOwner();
        relay = relayAddr;
    }

    /// @dev v2 — the work board's payroll address (owner-only, one-time).
    function setPayroll(address payrollAddr) external {
        if (msg.sender != owner) revert NotOwner();
        payroll = payrollAddr;
    }

    function process(uint256 runId, bytes calldata context) external returns (bytes memory) {
        if (msg.sender != relay) revert NotRelay();
        (address initiator, ) = abi.decode(context, (address, string));
        balanceOf[initiator] += RUN_REWARD;
        totalSupply += RUN_REWARD;
        runMinted += RUN_REWARD;
        emit RewardPaid(runId, initiator, RUN_REWARD);
        if (payroll != address(0)) {
            balanceOf[payroll] += RUN_REWARD;
            totalSupply += RUN_REWARD;
            runMinted += RUN_REWARD;
            emit PayrollFunded(runId, payroll, RUN_REWARD);
        }
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
