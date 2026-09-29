import { assertTrustedUrl, assertKnownToken, assertKnownPair } from "../src/lib/saos/security";

function t(label: string, fn: () => void): void {
  try { fn(); console.log("PASS-THROUGH (חדירה!):", label); }
  catch (e) { const name = (e as Error).name; console.log(name === "PhishingGateError" ? "BLOCKED ✓" : "BLOCKED(?):", label, "-", name); }
}

t("מארח לא-רשום", () => { void assertTrustedUrl("https://evil-phish.example.com/api"); });
t("userinfo מוטמע", () => { void assertTrustedUrl("https://user:pass@api.binance.com/x"); });
t("IP פרטי (SSRF)", () => { void assertTrustedUrl("https://192.168.1.1/rpc"); });
t("http מחוץ למעבדה", () => { void assertTrustedUrl("http://api.binance.com/x"); });
t("פורט זר", () => { void assertTrustedUrl("https://api.binance.com:8443/x"); });
t("טוקן לא-ברישום", () => { void assertKnownToken("0x0000000000000000000000000000000000000000"); });
t("זוג לא-מוכר", () => { void assertKnownPair("SCAM/USDT"); });

// חיובי: היעדים הכשרים עוברים
try { void assertTrustedUrl("https://api.binance.com/api/v3/ticker"); console.log("PASS ✓ מארח רשום"); } catch { console.log("FAIL: מארח רשום נחסם!"); }
try { void assertKnownToken("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"); console.log("PASS ✓ WETH קנוני"); } catch { console.log("FAIL: WETH נחסם!"); }
try { void assertKnownPair("WETH/USDC"); console.log("PASS ✓ זוג מוכר"); } catch { console.log("FAIL: זוג מוכר נחסם!"); }
