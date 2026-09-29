// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./MeshTypes.sol";

/// @title SAOS Exchange — הבורסה שלנו, על הרשת שלנו (mesh link #7).
/// @notice פריצת-הדרך: בורסה פעילה שלמה על SAOS-NET — צמדים של כל מה שיש
///         לנו (רק מול הגדולים: TRX/SOL/ETH), שווי-SAOS נמוך ($0.001) שמאפשר
///         בריכות רבות, סוכנים שסוחרים, בריכות שגדלות אוטונומית (חצי העמלה
///         נשארת ברזרבות), ונזילות שנקצרות החוצה לאוצר (חצי העמלה → קופת-קציר
///         שנקצרת ל-treasury). ערך פנימי; הגיבוי האמיתי מנוהל בהתאמה לאוצר
///         האמיתי (ה-HQ מטביע אספקת-גיבוי בהתאם למדידת-המכ"ם, ורושם זאת
///         בהערת-הגיבוי של כל נכס — אמת גלויה, לא כסף מומצא).
/// @dev    internal-ledger AMM: constant-product pools (x·y=k), fee 20bps
///         (10bps pot + 10bps pool growth), LP shares, quotes, harvest.
///         wSAOS is wrapped SAOS-M: 1:1 backed by real ledger deposits
///         (depositSaos/withdrawSaos, unaccounted-balance discipline).
contract SAOSExchange {
    address public owner;
    address public relay;
    address public ledger;    // SAOSLedger — the zero-fee SAOS-M rail
    address public treasury;  // the reserve custodian (harvest lands here)

    uint256 public constant FEE_BPS = 20;        // 0.2% per swap
    uint256 public constant POT_SHARE_BPS = 10;  // half the fee → harvest pot
    uint256 public constant SWAP_CAP_BPS = 500;  // max 5% of output reserve per swap
    // HARDEN v6 (audit 2026-09-29): locked-forever shares on first deposit —
    // Uniswap-V2 discipline: the pool can never be fully drained and the
    // first-minter can never inflate share value by a dust seed.
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    error NotOwner();
    error NotRelay();
    error UnknownAsset();
    error DupAsset();
    error UnknownPool();
    error DupPool();
    error Zero();
    error InsufficientBalance();
    error BadAmounts();
    error Slippage();
    error SwapCap();
    error NotWrappedSaos();
    error UnaccountedTooLow();
    error WsaosNotLive();
    error ZeroAddress();

    // ── assets (majors only — the sovereign whitelist) ─────────────────────
    struct Asset {
        string symbol;         // "WSAOS" | "WTRX" | "WSOL" | "WETH"
        string backingNote;    // honesty: what backs this asset
        uint256 totalMinted;   // internal supply
        uint256 potHarvested;  // cumulative harvest (per asset)
    }
    Asset[] public assets;
    mapping(string => uint256) public assetIndexOf; // symbol → id+1 (0 = missing)

    mapping(uint256 => mapping(address => uint256)) public bal; // assetId → holder → balance
    uint256 public wSaosLive; // live wSAOS outstanding (must be ledger-backed)

    // ── pools (x·y = k) ─────────────────────────────────────────────────────
    struct Pool {
        uint256 aId;      // the asset side (WTRX/WSOL/WETH)
        uint256 bId;      // the wSAOS side (or second asset for cross pools)
        uint256 rA;       // reserve A
        uint256 rB;       // reserve B
        uint256 lpTotal;  // total LP shares
        uint256 potA;     // harvest pot (treasury share, per side)
        uint256 potB;
        uint256 growthA;  // pool-share fees (autonomous growth, per side)
        uint256 growthB;
        uint256 volA;     // cumulative input volume
        uint256 volB;
        uint256 swaps;
    }
    Pool[] public pools;
    mapping(bytes32 => uint256) public poolIndexOf; // keccak256(min,max ids) → id+1
    mapping(uint256 => mapping(address => uint256)) public lpOf;

    uint256 public pulses; // mesh runs that flowed through the exchange

    // ── events (the on-chain journal) ──────────────────────────────────────
    event AssetRegistered(uint256 indexed assetId, string symbol, string backingNote);
    event AssetMinted(uint256 indexed assetId, address indexed to, uint256 amount, string note);
    event AssetBurned(uint256 indexed assetId, address indexed from, uint256 amount, string note);
    event SaosDeposited(address indexed who, uint256 amount);
    event SaosWithdrawn(address indexed who, uint256 amount);
    event InternalTransfer(uint256 indexed assetId, address indexed from, address indexed to, uint256 amount);
    event PoolCreated(uint256 indexed poolId, uint256 aId, uint256 bId);
    event LiquidityAdded(uint256 indexed poolId, address indexed lp, uint256 amountA, uint256 amountB, uint256 shares);
    event LiquidityRemoved(uint256 indexed poolId, address indexed lp, uint256 shares, uint256 amountA, uint256 amountB);
    event Swap(
        uint256 indexed poolId,
        address indexed trader,
        bool assetInIsA,
        uint256 amountIn,
        uint256 amountOut,
        uint256 potFee,
        uint256 growthFee
    );
    event Harvested(uint256 indexed poolId, address indexed treasury, uint256 amountA, uint256 amountB);
    event TreasurySet(address indexed treasury);
    event MeshPulse(uint256 indexed runId, uint256 pulses);

    constructor() { owner = msg.sender; }

    function wire(address relayAddr, address ledgerAddr, address treasuryAddr) external {
        if (msg.sender != owner) revert NotOwner();
        // HARDEN v6 (audit 2026-09-29): zero-address guards — Bridge/Ledger
        // already enforced them; the exchange was the one wire() without.
        if (relayAddr == address(0) || ledgerAddr == address(0) || treasuryAddr == address(0)) revert ZeroAddress();
        relay = relayAddr;
        ledger = ledgerAddr;
        treasury = treasuryAddr;
    }

    function setTreasury(address treasuryAddr) external {
        if (msg.sender != owner) revert NotOwner();
        treasury = treasuryAddr;
        emit TreasurySet(treasuryAddr);
    }

    // ── mesh link #7: every mesh run flows through the exchange ────────────
    function process(uint256 runId, bytes calldata context) external returns (bytes memory) {
        if (msg.sender != relay) revert NotRelay();
        pulses += 1;
        emit MeshPulse(runId, pulses);
        IRelayPass(relay).pass(runId, context);
        return context;
    }

    // ── asset registry (owner-only; majors only by policy) ─────────────────
    function registerAsset(string calldata symbol, string calldata backingNote) external returns (uint256) {
        if (msg.sender != owner) revert NotOwner();
        if (assetIndexOf[symbol] != 0) revert DupAsset();
        assets.push(Asset(symbol, backingNote, 0, 0));
        uint256 id = assets.length - 1;
        assetIndexOf[symbol] = id + 1;
        emit AssetRegistered(id, symbol, backingNote);
        return id;
    }

    function assetCount() external view returns (uint256) { return assets.length; }
    function poolCount() external view returns (uint256) { return pools.length; }

    function assetIdOf(string calldata symbol) external view returns (uint256) {
        uint256 idx = assetIndexOf[symbol];
        if (idx == 0) revert UnknownAsset();
        return idx - 1;
    }

    /// @dev HQ mints the backing-mirrored supply (WTRX/WSOL/WETH — never WSAOS:
    ///      wSAOS is minted ONLY against real SAOS-M deposits).
    function mintAsset(uint256 assetId, address to, uint256 amount, string calldata note) external {
        if (msg.sender != owner) revert NotOwner();
        if (assetId >= assets.length) revert UnknownAsset();
        if (keccak256(bytes(assets[assetId].symbol)) == keccak256(bytes("WSAOS"))) revert NotWrappedSaos();
        if (amount == 0) revert Zero();
        assets[assetId].totalMinted += amount;
        bal[assetId][to] += amount;
        emit AssetMinted(assetId, to, amount, note);
    }

    /// @dev reserve sync: real funds moved out → internal supply shrinks (owner).
    function burnAsset(uint256 assetId, address from, uint256 amount, string calldata note) external {
        if (msg.sender != owner) revert NotOwner();
        if (assetId >= assets.length) revert UnknownAsset();
        if (bal[assetId][from] < amount) revert InsufficientBalance();
        bal[assetId][from] -= amount;
        assets[assetId].totalMinted -= amount;
        emit AssetBurned(assetId, from, amount, note);
    }

    // ── wSAOS: the wrapped sovereign coin (1:1 SAOS-M backed) ──────────────
    function saosUnaccounted() public view returns (uint256) {
        // ledger.balanceOf(this) is read through the interface below
        uint256 held = ILedgerRail(ledger).balanceOf(address(this));
        return held > wSaosLive ? held - wSaosLive : 0;
    }

    /// @dev HARDEN v5 — the deposit is ATTRIBUTED and ATOMIC.
    /// לפני-כאן: הפיקדון היה יתרה-גלובלית-לא-מיוחסת (held − wSaosLive),
    /// ומי-שקרא-ראשון ל-depositSaos טען-לו גם הפקדות-של-אחרים (wrap race).
    /// עכשיו: המפקיד approve→transferFrom — כל-פיקדון נשלף מהמפקיד-עצמו
    /// באטומיות, ו-wSaosLive מוחזק 1:1 מול היתרה-בפועל. saosUnaccounted
    /// נשאר כמדד-סטייה בלבד (drift view), לא כדלתא לתביעה.
    function depositSaos(uint256 amount) external {
        uint256 wsaosId = this.assetIdOf("WSAOS");
        if (amount == 0) revert Zero();
        ILedgerRail(ledger).transferFrom(msg.sender, address(this), amount);
        wSaosLive += amount;
        assets[wsaosId].totalMinted += amount;
        bal[wsaosId][msg.sender] += amount;
        emit SaosDeposited(msg.sender, amount);
    }

    function withdrawSaos(uint256 amount) external {
        uint256 wsaosId = this.assetIdOf("WSAOS");
        if (amount == 0) revert Zero();
        if (bal[wsaosId][msg.sender] < amount) revert InsufficientBalance();
        if (amount > wSaosLive) revert WsaosNotLive();
        bal[wsaosId][msg.sender] -= amount;
        wSaosLive -= amount;
        assets[wsaosId].totalMinted -= amount;
        ILedgerRail(ledger).transfer(msg.sender, amount);
        emit SaosWithdrawn(msg.sender, amount);
    }

    // ── internal transfers (agent fills, treasury ops) ─────────────────────
    function transfer(uint256 assetId, address to, uint256 amount) external {
        if (assetId >= assets.length) revert UnknownAsset();
        if (bal[assetId][msg.sender] < amount) revert InsufficientBalance();
        bal[assetId][msg.sender] -= amount;
        bal[assetId][to] += amount;
        emit InternalTransfer(assetId, msg.sender, to, amount);
    }

    function balanceOf(uint256 assetId, address who) external view returns (uint256) {
        return bal[assetId][who];
    }

    // ── pools ───────────────────────────────────────────────────────────────
    function poolKey(uint256 x, uint256 y) internal pure returns (bytes32) {
        return x < y ? keccak256(abi.encodePacked(x, y)) : keccak256(abi.encodePacked(y, x));
    }

    function createPool(uint256 aId, uint256 bId) external returns (uint256) {
        if (msg.sender != owner) revert NotOwner();
        if (aId >= assets.length || bId >= assets.length) revert UnknownAsset();
        if (aId == bId) revert BadAmounts();
        bytes32 k = poolKey(aId, bId);
        if (poolIndexOf[k] != 0) revert DupPool();
        pools.push(Pool(aId, bId, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0));
        uint256 pid = pools.length - 1;
        poolIndexOf[k] = pid + 1;
        emit PoolCreated(pid, aId, bId);
        return pid;
    }

    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = x;
        uint256 y = (x + 1) / 2;
        while (y < z) { z = y; y = (z + x / z) / 2; }
        return z;
    }

    /// @dev HARDEN v6 (audit 2026-09-29) — two closings:
    ///      (1) DONATION/IMBALANCE VECTOR closed: v5 kept the full amounts
    ///      while minting min(sA, sB) — the excess was silently donated to the
    ///      pool, diluting existing LPs and opening a rounding-seed surface.
    ///      Now the caller mints min(sA, sB) and pulls ONLY the proportional
    ///      pair — the excess never leaves the caller (refund-by-not-taking).
    ///      (2) MINIMUM_LIQUIDITY: first deposit locks 1000 shares to
    ///      address(0) forever — no dust-seed share inflation, no empty-pool
    ///      division edge.
    function addLiquidity(uint256 poolId, uint256 amountA, uint256 amountB) external returns (uint256) {
        if (poolId >= pools.length) revert UnknownPool();
        Pool storage p = pools[poolId];
        if (amountA == 0 || amountB == 0) revert BadAmounts();
        if (bal[p.aId][msg.sender] < amountA || bal[p.bId][msg.sender] < amountB) revert InsufficientBalance();
        uint256 minted;      // total new shares (incl. the locked ones, first deposit only)
        uint256 shares;      // shares credited to the caller
        uint256 usedA;       // actually pulled from the caller (proportional pair)
        uint256 usedB;
        if (p.lpTotal == 0) {
            minted = _sqrt(amountA * amountB);
            if (minted <= MINIMUM_LIQUIDITY) revert BadAmounts();
            shares = minted - MINIMUM_LIQUIDITY;
            usedA = amountA;
            usedB = amountB;
            lpOf[poolId][address(0)] += MINIMUM_LIQUIDITY; // locked forever
        } else {
            uint256 sA = (amountA * p.lpTotal) / p.rA;
            uint256 sB = (amountB * p.lpTotal) / p.rB;
            if (sA <= sB) {
                minted = sA;
                shares = sA;
                usedA = amountA;
                usedB = (amountA * p.rB) / p.rA; // ≤ amountB by sA ≤ sB (floor keeps it)
            } else {
                minted = sB;
                shares = sB;
                usedB = amountB;
                usedA = (amountB * p.rA) / p.rB; // ≤ amountA by sB < sA
            }
            if (minted == 0 || usedA == 0 || usedB == 0) revert BadAmounts(); // dust rejected
        }
        bal[p.aId][msg.sender] -= usedA;
        bal[p.bId][msg.sender] -= usedB;
        p.rA += usedA;
        p.rB += usedB;
        p.lpTotal += minted;
        lpOf[poolId][msg.sender] += shares;
        emit LiquidityAdded(poolId, msg.sender, usedA, usedB, shares);
        return shares;
    }

    function removeLiquidity(uint256 poolId, uint256 shares) external returns (uint256, uint256) {
        if (poolId >= pools.length) revert UnknownPool();
        Pool storage p = pools[poolId];
        if (shares == 0) revert Zero();
        if (lpOf[poolId][msg.sender] < shares) revert InsufficientBalance();
        uint256 outA = (p.rA * shares) / p.lpTotal;
        uint256 outB = (p.rB * shares) / p.lpTotal;
        lpOf[poolId][msg.sender] -= shares;
        p.lpTotal -= shares;
        p.rA -= outA;
        p.rB -= outB;
        bal[p.aId][msg.sender] += outA;
        bal[p.bId][msg.sender] += outB;
        emit LiquidityRemoved(poolId, msg.sender, shares, outA, outB);
        return (outA, outB);
    }

    // ── the AMM core: x·y=k, 20bps fee (10 pot + 10 growth) ────────────────
    function quote(uint256 poolId, bool assetInIsA, uint256 amountIn) external view returns (uint256) {
        if (poolId >= pools.length) revert UnknownPool();
        Pool storage p = pools[poolId];
        uint256 rIn = assetInIsA ? p.rA : p.rB;
        uint256 rOut = assetInIsA ? p.rB : p.rA;
        if (rIn == 0 || rOut == 0) return 0;
        uint256 inForOut = amountIn - (amountIn * FEE_BPS) / 10000;
        return (rOut * inForOut) / (rIn + inForOut);
    }

    function swapExactIn(uint256 poolId, bool assetInIsA, uint256 amountIn, uint256 minOut) external returns (uint256) {
        if (poolId >= pools.length) revert UnknownPool();
        Pool storage p = pools[poolId];
        if (amountIn == 0) revert Zero();
        uint256 inId = assetInIsA ? p.aId : p.bId;
        uint256 outId = assetInIsA ? p.bId : p.aId;
        if (bal[inId][msg.sender] < amountIn) revert InsufficientBalance();

        // fee split: 10bps → harvest pot, 10bps → autonomous pool growth
        uint256 potFee = (amountIn * POT_SHARE_BPS) / 10000;
        uint256 inForOut = amountIn - (amountIn * FEE_BPS) / 10000;
        uint256 growthFee = (amountIn - potFee) - inForOut;

        uint256 rIn = assetInIsA ? p.rA : p.rB;
        uint256 rOut = assetInIsA ? p.rB : p.rA;
        if (rIn == 0 || rOut == 0) revert BadAmounts();
        uint256 out = (rOut * inForOut) / (rIn + inForOut);
        if (out < minOut) revert Slippage();
        if (out > (rOut * SWAP_CAP_BPS) / 10000) revert SwapCap();

        // the trader pays, the pool keeps (input − pot) and releases `out`
        bal[inId][msg.sender] -= amountIn;
        bal[outId][msg.sender] += out;

        if (assetInIsA) {
            p.rA = rIn + (amountIn - potFee);
            p.rB = rOut - out;
            p.potA += potFee;
            p.growthA += growthFee;
            p.volA += amountIn;
        } else {
            p.rB = rIn + (amountIn - potFee);
            p.rA = rOut - out;
            p.potB += potFee;
            p.growthB += growthFee;
            p.volB += amountIn;
        }
        p.swaps += 1;

        emit Swap(poolId, msg.sender, assetInIsA, amountIn, out, potFee, growthFee);
        return out;
    }

    // ── the harvest: fees flow OUT to the treasury (נזילות החוצה) ──────────
    /// @dev v46 — the pot-emptying core, callable internally: harvestAll()
    ///      used to route through this.harvest(i) (external self-call) which
    ///      flips msg.sender to the contract → NotOwner revert — the function
    ///      was dead bytecode on the live chain (the runner harvested per-pool
    ///      as a workaround since v28.1). The core is now internal so both
    ///      the owner-facing harvest() and the loop share it, no self-call.
    function _harvestCore(uint256 poolId) internal returns (uint256, uint256) {
        if (poolId >= pools.length) revert UnknownPool();
        Pool storage p = pools[poolId];
        uint256 amountA = p.potA;
        uint256 amountB = p.potB;
        p.potA = 0;
        p.potB = 0;
        if (treasury == address(0)) revert BadAmounts();
        if (amountA > 0) {
            bal[p.aId][treasury] += amountA;
            assets[p.aId].potHarvested += amountA;
        }
        if (amountB > 0) {
            bal[p.bId][treasury] += amountB;
            assets[p.bId].potHarvested += amountB;
        }
        emit Harvested(poolId, treasury, amountA, amountB);
        return (amountA, amountB);
    }

    function harvest(uint256 poolId) external returns (uint256, uint256) {
        if (msg.sender != owner) revert NotOwner();
        return _harvestCore(poolId);
    }

    function harvestAll() external returns (uint256 totalPools) {
        if (msg.sender != owner) revert NotOwner();
        for (uint256 i = 0; i < pools.length; i++) {
            if (pools[i].potA > 0 || pools[i].potB > 0) {
                _harvestCore(i);
                totalPools += 1;
            }
        }
        return totalPools;
    }

    function lpSharesOf(uint256 poolId, address who) external view returns (uint256) {
        return lpOf[poolId][who];
    }
}

/// @dev the zero-fee value rail (SAOSLedger) seen by the exchange.
interface ILedgerRail {
    function balanceOf(address who) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    // HARDEN v5: attributed pulls — closes the deposit race (see depositSaos)
    function allowance(address holder, address spender) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}
