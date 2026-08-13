# Agent Guide

This repository is the Layerswap analog of the Tether WDK (Wallet Development Kit) swidge protocol packages — it extends `SwidgeProtocol` from `@tetherto/wdk-wallet/protocols` (>= 1.0.0-beta.16) so a WDK EVM wallet account can swap and bridge tokens across chains via the Layerswap public API. The legacy `bridge`/`quoteBridge` surface is kept as thin adapters over `swidge`/`quoteSwidge`.

## Project Overview
- **Architecture:** Single `LayerswapProtocolEvm` class. The chain-agnostic HTTP client (`LayerswapApiClient`) and the network/token/decimal helpers live in the sibling package `@layerswap/wdk-protocol-bridge-layerswap-core` and are imported from there — do not duplicate them here.
- **Runtime:** Node.js and Bare. No browser-only globals; HTTP via `fetch`.

## Tech Stack & Tooling
- **Language:** JavaScript (ES2015+).
- **Module System:** ES Modules (`"type": "module"` in `package.json`).
- **Type Checking:** TypeScript only for generating `.d.ts` from JSDoc.
  - Command: `npm run build:types`
- **Linting:** `standard` (JavaScript Standard Style).
  - Command: `npm run lint` / `npm run lint:fix`
- **Testing:** `jest` with ESM support (`experimental-vm-modules`).
  - Command: `npm test`

## Coding Conventions
- **File Naming:** Kebab-case (e.g., `layerswap-protocol-evm.js`).
- **Class Naming:** PascalCase (e.g., `LayerswapProtocolEvm`).
- **Private Members:** Prefixed with `_` and documented with `@private`.
- **Imports:** Explicit `.js` file extensions.
- **Copyright:** Apache 2.0 header on every source file.

## Documentation (JSDoc)
- `@typedef` for shared shapes.
- `@param`, `@returns`, `@throws` on every public method.
- Avoid TypeScript syntax in JSDoc — stick to JSDoc forms so `tsc --declaration` emits clean types.

## Development Workflow
1. **Install:** `npm install`
2. **Lint:** `npm run lint`
3. **Test:** `npm test`
4. **Build types:** `npm run build:types`

## Key Files
- `index.js` — public entry: default export of `LayerswapProtocolEvm` plus its config/options/result typedefs. No `LayerswapApiClient` re-export — consumers import it directly from `@layerswap/wdk-protocol-bridge-layerswap-core`.
- `bare.js` — Bare runtime wrapper.
- `src/layerswap-protocol-evm.js` — `SwidgeProtocol` implementation. Only EVM-specific file in this package; the API client, resolvers, and swidge mapping helpers come from core.
- `types/` — generated; do not edit by hand.

## Semantic notes
- Swidge fees are itemised: Layerswap's `included: true` entries are in **source-token base units**; the source-chain gas entry is non-included and in **native units**. Never sum across entries with different `token`s.
- Exact-in only (`fromTokenAmount`); `toTokenAmount` (exact-out) throws. `toChain` is required — Layerswap has no same-chain swaps, so the inherited `swap()` always throws.
- WDK swidge `slippage` is a decimal (0.01 = 1%); legacy `BridgeOptions.slippage` stays a percent string and is divided by 100 in `_toSwidgeOptions`.
- Legacy `BridgeResult.bridgeFee` is in **source-token base units** (= sum of `included` swidge fees). `LayerswapProtocolConfig.bridgeMaxFee` is compared against that sum only.
