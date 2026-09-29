// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./MeshTypes.sol";

/// @title SAOS Microgrid — GRID-98 על השרשרת (mesh link #6, החוזה התשיעי).
/// @notice הפורט האמיתי של מנוע-המיקרו-גריד ההיסטורי (grid98.cjs, SAOS-NET):
///         סולם-סחר 1.2% לרמה · שער-שוליים 40bps · גודל-רמה 0.25 · רווח-אוצר
///         מצטבר-מונוטונית · יומן-פר-מילוי. כאן הסולם עצמו חוזה: כל מילוי
///         הוא אירוע-שרשרת בלתי-ניתן-לשינוי, וכל ריצת-mesh מתקתקת את כל
///         הגרידים בתוך אותה עסקה אחת (חוזה ⇄ חוזה ⇄ חוזה).
///
///         האורקל: ה-HQ מפרסם מחירי DEX אמיתיים שנמדדו (Uniswap/Pancake,
///         eth_call קריאה-בלבד — המקור ב-dex-live.ts). הגריד הולך במעלה
///         המחיר → מוכר רמה (inventory-- , רווח) ; במורד → קונה בחזרה רמה
///         (inventory++). סבב שלם = קנה-נמוך מכר-גבוה = LADDER_AMT × STEP.
///
///         גלגל-התמרים (flywheel): sweepToPayroll מעביר את הרווח שנצבר
///         לקופת העבודה (SAOSWorkBoard) דרך מסילת-הערך ללא-העמלה —
///         רווח המיקרו-גריד מממן REAL WORK לחיילים.
///
///         גבול-האמת: מחירי השוק אמיתיים (נמדדו) · הכסף SAOS-M פנימי
///         (מטבע-מעבדה) · הרווח נשטף רק ככל שיכוסה ע"י יתרת החוזה —
///         אף ספרות לא מומצאות.
contract SAOSMicrogrid {
    address public owner;
    address public relay;
    address public workboard; // payroll destination — the flywheel target
    ILedgerRail public ledger;

    // ── GRID-98 (historic parameters, grid98.cjs): 1.2% · 40bps · 0.25 ──
    uint16 public constant STEP_BPS = 120;        // 1.2% ladder step (LADDER_STEP)
    uint16 public constant EDGE_BPS = 40;         // 40bps minimum edge (TAKER_EDGE)
    uint256 public constant LADDER_AMT = 0.25 ether; // per-level size in SAOS-M
    uint16 public constant MAX_LEVELS = 64;
    int16 public constant DRIFT_LIMIT = 48;       // ±48 levels → pause (re-anchor)
    uint8 public constant MAX_CROSS_PER_TICK = 8; // gas guard — the rest carries over

    struct Grid {
        string pair;        // "WETH/USDC" — the REAL market being tracked
        uint64 anchorE6;    // level-0 price (price × 1e6)
        int16 cursor;       // current level index
        uint16 inventory;   // levels currently held (seeded full)
        uint16 levels;      // ladder depth
        uint256 crossings;  // total fills (buy + sell)
        uint256 realizedPnl;  // wei SAOS-M — monotonic, accrues on SELL fills
        uint256 sweptPnl;     // realized already swept to the payroll
        uint256 ticks;
        uint64 lastTickAt;
        bool live;
    }
    Grid[] private _grids;

    // ── oracle: REAL measured DEX prices, posted by the HQ (read-only source) ──
    mapping(string => uint64) public priceOf;       // pair → price × 1e6
    mapping(string => uint64) public pricePostedAt; // pair → unix ts

    uint256 public fillSeq;       // the on-chain journal sequence (immutable)
    uint256 public totalRealized; // across all grids
    uint256 public totalSwept;    // money actually moved to the payroll

    event PricePosted(string pair, uint64 priceE6, uint64 at);
    event GridCreated(uint256 indexed gridId, string pair, uint64 anchorE6, uint16 levels, uint16 inventory);
    event GridFill(uint256 indexed gridId, int16 level, bool isSell, uint256 amount, uint256 profit, uint64 priceE6, uint256 seq);
    event GridTicked(uint256 indexed gridId, uint64 priceE6, int16 cursor, uint256 crossings, uint256 realizedPnl);
    event GridSwept(uint256 indexed gridId, uint256 amount, address to);
    event GridPaused(uint256 indexed gridId, string reason);
    event GridReanchored(uint256 indexed gridId, uint64 newAnchorE6, int16 cursor);

    error NotOwner();
    error NotRelay();
    error PriceNotPosted();
    error BadLevels();
    error StepBelowEdge();
    error GridNotLive();
    error ZeroAddress();
    error AlreadyWired();

    constructor() { owner = msg.sender; }

    /// @dev v91 — one-time, zero-address-free wiring.
    function wire(address relayAddr, address ledgerAddr, address workboardAddr) external {
        if (msg.sender != owner) revert NotOwner();
        if (relayAddr == address(0) || ledgerAddr == address(0) || workboardAddr == address(0)) revert ZeroAddress();
        if (relay != address(0) || address(ledger) != address(0) || workboard != address(0)) revert AlreadyWired();
        relay = relayAddr;
        ledger = ILedgerRail(ledgerAddr);
        workboard = workboardAddr;
    }

    // ── oracle (HQ only): post the REAL measured price of a live DEX pair ──
    function postPrice(string calldata pair, uint64 priceE6) external {
        if (msg.sender != owner) revert NotOwner();
        if (priceE6 == 0) revert PriceNotPosted();
        priceOf[pair] = priceE6;
        pricePostedAt[pair] = uint64(block.timestamp);
        emit PricePosted(pair, priceE6, uint64(block.timestamp));
    }

    function oracle(string calldata pair) external view returns (uint64 priceE6, uint64 at) {
        return (priceOf[pair], pricePostedAt[pair]);
    }

    // ── grid lifecycle (HQ only) ─────────────────────────────────────────────

    function createGrid(string calldata pair, uint16 levels) external returns (uint256 gridId) {
        if (msg.sender != owner) revert NotOwner();
        if (STEP_BPS < EDGE_BPS) revert StepBelowEdge(); // edge gate — by construction
        if (levels == 0 || levels > MAX_LEVELS) revert BadLevels();
        uint64 anchor = priceOf[pair];
        if (anchor == 0) revert PriceNotPosted();
        // seeded FULL: the whole ladder is inventory from the start — up-moves
        // sell into profit immediately, down-moves restock (classic grid boot).
        _grids.push(Grid(pair, anchor, 0, levels, levels, 0, 0, 0, 0, 0, true));
        gridId = _grids.length - 1;
        emit GridCreated(gridId, pair, anchor, levels, levels);
        return gridId;
    }

    function reanchor(uint256 gridId) external {
        if (msg.sender != owner) revert NotOwner();
        Grid storage g = _grids[gridId];
        uint64 price = priceOf[g.pair];
        if (price == 0) revert PriceNotPosted();
        g.anchorE6 = price;
        g.cursor = 0;
        g.live = true;
        emit GridReanchored(gridId, price, 0);
    }

    // ── the engine ───────────────────────────────────────────────────────────

    /// @dev level-k boundary price = anchor × (1 + step)^k (6-decimal fixed point).
    function levelPriceE6(uint256 gridId, int16 k) external view returns (uint64) {
        return _levelPriceE6(_grids[gridId].anchorE6, k);
    }

    function _levelPriceE6(uint64 anchorE6, int16 k) internal pure returns (uint64) {
        uint256 p = anchorE6;
        if (k >= 0) {
            for (int16 i = 0; i < k; i++) p = p * (10000 + STEP_BPS) / 10000;
        } else {
            for (int16 i = k; i < 0; i++) p = p * 10000 / (10000 + STEP_BPS);
        }
        return uint64(p);
    }

    function _tickOne(uint256 gridId, Grid storage g) internal {
        if (!g.live) return;
        uint64 price = priceOf[g.pair];
        if (price == 0) return; // honest skip — the oracle is silent for this pair
        g.ticks += 1;
        g.lastTickAt = uint64(block.timestamp);
        uint8 moved = 0;

        // up-crossing: price entered the band above → SELL one level there
        while (moved < MAX_CROSS_PER_TICK && price >= _levelPriceE6(g.anchorE6, g.cursor + 1)) {
            g.cursor += 1;
            moved += 1;
            g.crossings += 1;
            uint256 profit = 0;
            if (g.inventory > 0) {
                g.inventory -= 1;
                // round-trip captured: LADDER_AMT × step — edge-gated by
                // construction (STEP_BPS ≥ EDGE_BPS, enforced at creation)
                profit = LADDER_AMT * STEP_BPS / 10000;
                g.realizedPnl += profit;
                totalRealized += profit;
            }
            fillSeq += 1;
            emit GridFill(gridId, g.cursor, true, LADDER_AMT, profit, price, fillSeq);
        }

        // down-crossing: the resting BUY at L(cursor-1) fills ONLY when the
        // price REACHES that line (strict line-touch — classic grid; a hair
        // below the band floor must NOT trigger a fill one level down)
        while (moved < MAX_CROSS_PER_TICK && price <= _levelPriceE6(g.anchorE6, g.cursor - 1)) {
            g.cursor -= 1; // the line that just filled
            moved += 1;
            g.crossings += 1;
            if (g.inventory < g.levels) g.inventory += 1;
            fillSeq += 1;
            emit GridFill(gridId, g.cursor, false, LADDER_AMT, 0, price, fillSeq);
        }

        if (g.cursor > DRIFT_LIMIT || g.cursor < -DRIFT_LIMIT) {
            g.live = false;
            emit GridPaused(gridId, "drift-limit: re-anchor required (honest)");
        }
        emit GridTicked(gridId, price, g.cursor, g.crossings, g.realizedPnl);
    }

    /// @dev open to the chain: uses only posted prices — ticking is honest work.
    function tick(uint256 gridId) external {
        _tickOne(gridId, _grids[gridId]);
    }

    function tickAll() external {
        for (uint256 i = 0; i < _grids.length; i++) _tickOne(i, _grids[i]);
    }

    // ── mesh link #6: every mesh run ticks the grids, then the chain goes on ──
    function process(uint256 runId, bytes calldata context) external returns (bytes memory) {
        if (msg.sender != relay) revert NotRelay();
        for (uint256 i = 0; i < _grids.length; i++) _tickOne(i, _grids[i]);
        IRelayPass(relay).pass(runId, context);
        return context;
    }

    // ── the flywheel: sweep accrued profit → the work board payroll ──────────
    function _sweep(uint256 gridId) internal returns (uint256) {
        Grid storage g = _grids[gridId];
        uint256 unswept = g.realizedPnl - g.sweptPnl;
        uint256 bal = ledger.balanceOf(address(this));
        uint256 amount = unswept > bal ? bal : unswept; // honest: capped by the real balance
        if (amount > 0 && workboard != address(0)) {
            ledger.transfer(workboard, amount);
            g.sweptPnl += amount;
            totalSwept += amount;
            emit GridSwept(gridId, amount, workboard);
            return amount;
        }
        return 0;
    }

    function sweepToPayroll(uint256 gridId) external returns (uint256) {
        if (msg.sender != owner) revert NotOwner();
        return _sweep(gridId);
    }

    function sweepAllToPayroll() external returns (uint256 total) {
        if (msg.sender != owner) revert NotOwner();
        for (uint256 i = 0; i < _grids.length; i++) {
            total += _sweep(i);
        }
        return total;
    }

    // ── views ────────────────────────────────────────────────────────────────
    function gridCount() external view returns (uint256) { return _grids.length; }

    function gridAt(uint256 i) external view returns (Grid memory) { return _grids[i]; }
}

/// @dev the zero-fee value rail the microgrid sweeps through (SAOSLedger).
interface ILedgerRail {
    function balanceOf(address who) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}
