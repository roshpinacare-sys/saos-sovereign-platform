// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./MeshTypes.sol";

/// @title SAOS Work Board — פקודות עבודה (mesh link #5): HQ posts work,
///        soldiers deliver it, the ledger pays — all inside the mesh run.
/// @notice עבודה לחיילים: every mesh run is now WORK. The HQ (owner)
///         posts open orders with a mission, difficulty and reward. The
///         board is a mesh link — when a run reaches it, the run's
///         initiator (a soldier) delivers the oldest open order, and the
///         reward moves through the zero-fee ledger rail (payroll balance
///         is minted to the board on every run by SAOSLedger).
///         פתרונות · ערך · יעילות — solutions, pay and efficiency in
///         ONE chained transaction: Hub → Relay → Identity → Ledger →
///         Solutions → Bridge → **WorkBoard** → Hub → ValueEngine.
contract SAOSWorkBoard {
    address public owner;
    address public relay;
    ILedgerRail public ledger;

    enum Status { Open, Delivered }

    struct Order {
        string mission;       // the work: what the soldier must do
        uint256 difficulty;   // 1..5 — complexity level
        uint256 reward;       // SAOS-M, zero-fee, paid from the payroll
        Status status;
        address soldier;      // assigned on delivery
        uint256 runId;        // the mesh run that delivered this order
        uint64 postedAt;
        uint64 deliveredAt;
        bool paid;            // honest: reward actually moved
    }
    Order[] private _orders;
    uint256 public openHead; // v91 — queue cursor: orders BEFORE this index are all Delivered

    struct SoldierStat { address soldier; uint256 orders; uint256 earned; }
    mapping(address => uint256) private _soldierIndexPlusOne; // 0 = not yet
    SoldierStat[] private _soldiers;

    uint256 public ordersDelivered;
    uint256 public totalRewardPaid;

    event OrderPosted(uint256 indexed orderId, string mission, uint256 difficulty, uint256 reward);
    event OrderDelivered(uint256 indexed orderId, uint256 indexed runId, address indexed soldier, string mission, uint256 reward, bool paid);

    error NotOwner();
    error NotRelay();
    error OrderOutOfBounds();
    error ZeroAddress();
    error AlreadyWired();

    constructor() { owner = msg.sender; }

    /// @dev v91 — wiring is ONE-TIME and zero-address-free: a live work board
    ///      can no longer be silently re-aimed at a dead relay/ledger.
    function wire(address relayAddr, address ledgerAddr) external {
        if (msg.sender != owner) revert NotOwner();
        if (relayAddr == address(0) || ledgerAddr == address(0)) revert ZeroAddress();
        if (relay != address(0) || address(ledger) != address(0)) revert AlreadyWired();
        relay = relayAddr;
        ledger = ILedgerRail(ledgerAddr);
    }

    /// @dev HQ posts a new work order. Payroll must be able to cover it
    ///      (escrow discipline) — checked at delivery, never blocks the run.
    function postOrder(string calldata mission, uint256 difficulty, uint256 reward) external returns (uint256 orderId) {
        if (msg.sender != owner) revert NotOwner();
        _orders.push(Order(mission, difficulty, reward, Status.Open, address(0), 0, uint64(block.timestamp), 0, false));
        orderId = _orders.length - 1;
        emit OrderPosted(orderId, mission, difficulty, reward);
        return orderId;
    }

    function orderCount() external view returns (uint256) { return _orders.length; }

    function orderAt(uint256 i) external view returns (Order memory) {
        if (i >= _orders.length) revert OrderOutOfBounds();
        return _orders[i];
    }

    function soldierCount() external view returns (uint256) { return _soldiers.length; }

    function soldierAt(uint256 i) external view returns (SoldierStat memory) {
        if (i >= _soldiers.length) revert OrderOutOfBounds();
        return _soldiers[i];
    }

    /// @dev mesh link #5 — the run's initiator delivers the oldest open order
    ///      and gets paid through the zero-fee rail. If the payroll cannot
    ///      cover the reward the delivery is recorded but unpaid (honest
    ///      flag) — the chain NEVER breaks over money.
    ///      v91 — GAS FIX: the old _oldestOpen() scanned ALL orders on every
    ///      mesh run (O(n) gas — with history the run eventually exceeded the
    ///      block gas limit and the whole mesh bricked). The open queue is now
    ///      a cursor: orders before openHead are all delivered, so finding the
    ///      oldest open order is amortized O(1).
    function process(uint256 runId, bytes calldata context) external returns (bytes memory) {
        if (msg.sender != relay) revert NotRelay();
        (address initiator, ) = abi.decode(context, (address, string));
        uint256 orderId = _oldestOpen();
        if (orderId != type(uint256).max) {
            Order storage o = _orders[orderId];
            o.status = Status.Delivered;
            o.soldier = initiator;
            o.runId = runId;
            o.deliveredAt = uint64(block.timestamp);
            ordersDelivered += 1;
            // pay through the zero-fee ledger rail — only if funded
            bool paid = false;
            if (address(ledger) != address(0) && ledger.balanceOf(address(this)) >= o.reward && o.reward > 0) {
                ledger.transfer(initiator, o.reward);
                paid = true;
                totalRewardPaid += o.reward;
            }
            o.paid = paid;
            _bump(initiator, paid ? o.reward : 0);
            // v91 — advance the queue cursor past the delivered prefix: every
            // order before openHead is Delivered by invariant, so future scans
            // start here and the board never re-walks its own history.
            if (orderId == openHead) {
                openHead = orderId + 1;
                while (openHead < _orders.length && _orders[openHead].status == Status.Delivered) openHead += 1;
            }
            emit OrderDelivered(orderId, runId, initiator, o.mission, o.reward, paid);
        }
        IRelayPass(relay).pass(runId, context);
        return context;
    }

    /// @dev v91 — cursor-based: everything before openHead is delivered, so
    ///      the scan starts there and stops at the FIRST open order. Each
    ///      delivery advances the cursor permanently — total work per order
    ///      is O(1) amortized across the life of the board.
    function _oldestOpen() internal view returns (uint256) {
        for (uint256 i = openHead; i < _orders.length; i++) {
            if (_orders[i].status == Status.Open) return i;
        }
        return type(uint256).max;
    }

    function _bump(address soldier, uint256 paid) internal {
        uint256 ipo = _soldierIndexPlusOne[soldier];
        if (ipo == 0) {
            _soldiers.push(SoldierStat(soldier, 1, paid));
            _soldierIndexPlusOne[soldier] = _soldiers.length;
        } else {
            SoldierStat storage s = _soldiers[ipo - 1];
            s.orders += 1;
            s.earned += paid;
        }
    }
}

/// @dev the zero-fee value rail the board pays through (SAOSLedger).
interface ILedgerRail {
    function balanceOf(address who) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}
