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
    address public pendingOwner; // HARDEN v5: two-step ownership — no typos, no dead lock
    address public relay;
    address public payroll; // the SAOSWorkBoard — funded by every run

    string public constant SYMBOL = "SAOS-M";
    uint256 public constant RUN_REWARD = 10 ether; // 10 SAOS-M per run (small mint)
    uint256 public constant FEE = 0;               // forever zero — by construction
    /// HARDEN v5: supply cap — the same doctrine as SAOS (21,000,000).
    /// אין-מנוע-כלכלי בריא בלי-תקרה: sovereignMint + run-rewards + payroll
    /// כולם נשאבים מאותה תקרה — fail-closed.
    uint256 public constant MINT_CAP = 21_000_000 ether;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance; // HARDEN v5: ERC-20-style
    uint256 public totalSupply;
    uint256 public runMinted;
    uint256 public transfersCount;
    uint256 public valueMoved;

    event RewardPaid(uint256 indexed runId, address indexed to, uint256 amount);
    event PayrollFunded(uint256 indexed runId, address indexed payroll, uint256 amount);
    event ZeroFeeTransfer(uint256 indexed seq, address indexed from, address indexed to, uint256 amount, uint256 fee);
    event FloatMinted(address indexed to, uint256 amount, string reason);
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipAccepted(address indexed from, address indexed to);
    event Approval(address indexed tokenOwner, address indexed spender, uint256 amount);
    event PayrollSet(address indexed payroll);

    error NotOwner();
    error NotPendingOwner();
    error NotRelay();
    error InsufficientBalance();
    error InsufficientAllowance();
    error MintCapExceeded();
    error ZeroAddress();

    constructor() { owner = msg.sender; }

    /// HARDEN v5: mint cap enforcement — the one gate that makes every mint path honest.
    modifier _cap(uint256 amount) {
        if (totalSupply + amount > MINT_CAP) revert MintCapExceeded();
        _;
    }

    /// @dev v4 — הבורסה: sovereign exchange float. A policy mint (owner-only,
    ///      journaled with its reason) that seeds the SAOS-NET exchange pools.
    ///      Lab-internal value: SAOS-M stays מטבע-מעבדה — the float is
    ///      LIQUIDITY, not circulation; every unit sits in pools/traders.
    ///      HARDEN v5: capped.
    function sovereignMint(address to, uint256 amount, string calldata reason) external _cap(amount) {
        if (msg.sender != owner) revert NotOwner();
        if (amount == 0) revert InsufficientBalance();
        balanceOf[to] += amount;
        totalSupply += amount;
        emit FloatMinted(to, amount, reason);
    }

    function wire(address relayAddr) external {
        if (msg.sender != owner) revert NotOwner();
        if (relayAddr == address(0)) revert ZeroAddress(); // HARDEN v5: no dead relay
        relay = relayAddr;
    }

    /// HARDEN v5: two-step ownership transfer (commit/reveal) — a wrong address
    /// can no longer brick the ledger forever.
    function transferOwnership(address newOwner) external {
        if (msg.sender != owner) revert NotOwner();
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipAccepted(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    /// @dev v2 — the work board's payroll address (owner-only).
    ///      v91 — zero-checked and journaled: a silent re-aim of the payroll
    ///      (the destination of every run's payroll mint) is now an event.
    function setPayroll(address payrollAddr) external {
        if (msg.sender != owner) revert NotOwner();
        if (payrollAddr == address(0)) revert ZeroAddress();
        payroll = payrollAddr;
        emit PayrollSet(payrollAddr);
    }

    function process(uint256 runId, bytes calldata context) external _cap(2 * RUN_REWARD) returns (bytes memory) {
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

    /// ── HARDEN v5: approve/transferFrom — closes the SAOSExchange deposit race.
    /// הפיקדון נמדד-מיוחס: transferFrom שולף מהמפקיד עצמו באטומיות,
    /// במקום תחרות על יתרה-גלובלית-לא-מיוחסת (saosUnaccounted).
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a < amount) revert InsufficientAllowance();
        if (balanceOf[from] < amount) revert InsufficientBalance();
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        transfersCount += 1;
        valueMoved += amount;
        emit ZeroFeeTransfer(transfersCount, from, to, amount, FEE);
        return true;
    }
}
