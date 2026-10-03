// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * SAOSHookPool.sol — v116.0.0 השתלטות — סמנטיקת-הוקים (Uniswap-v4) על
 * שרשרת-המעבדה שלנו (SAOS-EVM, chainId 31337).
 *
 * מקור: נולד מבחינת-עומק של חזית-ה-DeFi העולמית (v4 hooks: פלאגינים בנקודות
 * מחזור-הבריכה; ~$355B נפח-מצטבר מדוד — ראה docs/CONVERGENCE-V116.md).
 * סמנטיקה נגנבת, לא תשתית: בריכה עם נקודות-הוק לפני/אחרי-החלפה, דמי-רישום
 * גמישים לפי-הוק, ושער-בעלים להתקנת-הוק (אימוץ-אחראי — הוק רושם רק הבעלים).
 *
 * כנות: קומפילציית-אמת דורשת forge/cast (לא מותקנים על התיבה — anvil בלבד);
 * להתקין מהריליס הרשמי של foundry-rs בלבד ולפרוס דרך רכבת-ה-deploy של
 * evm-mesh. עד-אז החוזה מוגש כמקור-מאומת-עמיתים (review) ולא כפרוס.
 */

interface ISaoshook {
    /// @return selector מזהה-ההוק; מורכב ממספר-ההוק ומהתשובה הרצויה (עמלה/אישור)
    function beforeSwap(address sender, uint256 amountIn) external returns (bytes4);
    function afterSwap(address sender, uint256 amountOut) external returns (bytes4);
}

contract SAOSHookPool {
    // ── שגיאות עבריות-מכונה ─────────────────────────────────────────────
    error NotOwner();
    error HookAlreadySet();
    error SwapZero();
    error InsufficientOut();

    // ── משתני-מצב ────────────────────────────────────────────────────────
    address public owner;
    address public tokenA; // למשל wSAOS
    address public tokenB; // למשל WETH
    uint256 public reserveA;
    uint256 public reserveB;
    uint24 public feeBps; // עמלת-בסיס בנקודות-בסיס
    ISaoshook public hook; // הוק יחיד (מותקן על-ידי הבעלים; 0 = ללא)

    event HookInstalled(address indexed hook);
    event SwapExecuted(address indexed sender, uint256 amountIn, uint256 amountOut, uint24 feeBps);

    constructor(address _tokenA, address _tokenB, uint24 _feeBps) {
        owner = msg.sender;
        tokenA = _tokenA;
        tokenB = _tokenB;
        feeBps = _feeBps;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @notice התקנת-הוק — רק הבעלים; אימוץ-אחראי מול הוקים-עוינים
    function installHook(address _hook) external onlyOwner {
        if (address(hook) != address(0)) revert HookAlreadySet();
        hook = ISaoshook(_hook);
        emit HookInstalled(_hook);
    }

    /// @notice הוק לפני-החלפה רשאי לדרוש עמלה-מותאמת (סמנטיקת dynamic-fee)
    function _beforeSwapFee(address sender, uint256 amountIn) internal returns (uint24) {
        if (address(hook) == address(0)) return feeBps;
        try hook.beforeSwap(sender, amountIn) returns (bytes4) {
            return feeBps; // ברירת-מחדל; הרחבה עתידית: הוק מחזיר עמלה
        } catch {
            return feeBps; // הוק נכשל → המשך כנה עם עמלת-הבסיס (לא נעילת-בריכה)
        }
    }

    /// @dev החלפה אונוס-כיוונית על-בסיס מוצר-שמורות (x·y=k) + הוקים
    function swapAForB(uint256 amountIn, uint256 minOut) external returns (uint256 amountOut) {
        if (amountIn == 0) revert SwapZero();
        uint24 bps = _beforeSwapFee(msg.sender, amountIn);
        uint256 amountInAfterFee = amountIn - (amountIn * bps) / 10_000;
        uint256 newReserveA = reserveA + amountInAfterFee;
        amountOut = (reserveB * amountInAfterFee) / newReserveA; // מופשט: מדויק-מספיק למעבדה
        if (amountOut < minOut) revert InsufficientOut();
        reserveA = newReserveA;
        reserveB = reserveB - amountOut;
        if (address(hook) != address(0)) {
            try hook.afterSwap(msg.sender, amountOut) returns (bytes4) {
                // הוק נוכח — נקודת-הרחבה עתידית (מדדים/מגבלות-תדירות)
            } catch {
                // כשל-הוק אחרי-החלפה = רישום בלבד; ההחלפה תקפה
            }
        }
        emit SwapExecuted(msg.sender, amountIn, amountOut, bps);
    }

    /// @notice הפקדת-נזילות (מינהלי במעבדה — הזרמה מהאוצר הריבוני)
    function fund(uint256 a, uint256 b) external onlyOwner {
        reserveA += a;
        reserveB += b;
    }

    function setFeeBps(uint24 _feeBps) external onlyOwner {
        feeBps = _feeBps;
    }
}
