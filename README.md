# swapui — GM dapp (Swap + Stake)

React + Vite dapp for the GM (Gwei Market) TaxHook pool. Uses **Reown AppKit** for wallet connection.

## Stack

- React 18 + Vite 6
- Reown AppKit (ethers5 adapter) — wallet only, no socials/email
- ethers v5 for contract interactions
- React Router v6 for navigation

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Config

All constants are hardcoded in `src/config.js`:
- HOOK, CHAIN_ID, TOKEN_SYMBOL
- Universal Router, V4 Quoter, Permit2 addresses
- Alchemy RPC endpoint
