// ── Shared GM dapp config (stake + swap) ──────────────────────────────────────
// Only the project-specific bits live here: the hook + chain. The swap page routes
// through Uniswap's already-deployed Universal Router + V4Quoter + Permit2 (baked
// into gwei-swap.html as mainnet constants) — nothing custom is deployed.
//
// On a non-mainnet chain, also set UNIVERSAL_ROUTER / V4_QUOTER / PERMIT2 below
// (see docs.uniswap.org/contracts/v4/deployments) — they get merged into both globals.
(function () {
  var HOOK     = "0x67Bd823d5435C1597f397151897D7Db3BF0940Cc"; // TaxHook (GM)
  var CHAIN_ID = 1;                                            // 1 = mainnet

  window.GWEI_CONFIG      = { HOOK: HOOK, CHAIN_ID: CHAIN_ID, TOKEN_SYMBOL: "GM" };
  window.GWEI_SWAP_CONFIG = { HOOK: HOOK, CHAIN_ID: CHAIN_ID, TOKEN_SYMBOL: "GM" };
})();
