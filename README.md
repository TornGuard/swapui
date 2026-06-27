# swapui — GM dapp (Swap + Stake)

Two static pages for the GM (Gwei Market) TaxHook pool. **No custom contracts** — the swap page builds
a Uniswap **v4** swap and sends it through Uniswap's already-deployed **Universal Router** + **Permit2**,
targeting the GM `PoolKey` directly. That sidesteps the routing API's hook allowlist (the reason
app.uniswap.org shows *"no route"*) without deploying anything.

## Files
| file | what it is |
|------|------------|
| `gwei-swap.html`  | **Swap** page. Quotes via the live **V4Quoter** (tax-accurate), executes via the **Universal Router** (Permit2 for sells), with slippage control. |
| `gwei-stake.html` | **Stake** page — stake/unstake/claim directly on the hook (ETH rewards, penalty taper). |
| `gwei-config.js`  | Shared config: just `HOOK` + `CHAIN_ID`. Sets `window.GWEI_CONFIG` (stake) and `window.GWEI_SWAP_CONFIG` (swap). |

Nav is **SWAP → STAKE**. Both are wired to the live hook `0xE092670a1CB16F826cb4E0207782c1368347c506`.

## Run it
Serve over **http** (wallets don't inject into `file://`) and open in a browser with MetaMask:
```bash
cd swapui
python3 -m http.server 8801
# open http://127.0.0.1:8801/gwei-swap.html   (and /gwei-stake.html)
```
Connect a wallet on the GM chain — the pages talk to mainnet directly through your wallet. No node, no
deploy, no local chain needed.

## How the swap works (no middle contract)
v4 swaps can't be called from an EOA — they must run inside `PoolManager.unlock()`, which calls back a
contract. So a router is unavoidable; we use Uniswap's **canonical, already-deployed** one instead of
shipping our own:

- **Quote:** `V4Quoter.quoteExactInputSingle(poolKey, zeroForOne, amountIn, "0x")` → output **net of the
  ETH-leg tax**.
- **Execute:** `UniversalRouter.execute(0x10 /*V4_SWAP*/, [encoded actions], deadline)` with actions
  `SWAP_EXACT_IN_SINGLE → SETTLE_ALL → TAKE_ALL`. `TAKE_ALL`'s `minAmount` is the slippage guard.
- **Buy** (ETH→GM): native ETH sent as `msg.value`, no approval.
- **Sell** (GM→ETH): one-time Permit2 setup — `approve(GM → Permit2)` then `Permit2.approve(GM → router)` —
  then the router pulls GM via Permit2. The UI walks you through both steps.

Mainnet infra (baked into `gwei-swap.html`; override in `gwei-config.js` for other chains):
- Universal Router `0x66a9893cc07d91d95644aedd05d03f95e1dba8af`
- V4Quoter `0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203`
- Permit2 `0x000000000022d473030f116ddee9f6b43ac78ba3`
- PoolManager `0x000000000004444c5dc75cb358380d2e3de08a90`

> If GM is **not** on mainnet, set `CHAIN_ID` and the three infra addresses in `gwei-config.js` to that
> chain's deployments (docs.uniswap.org/contracts/v4/deployments).
