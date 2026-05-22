# Agent Guide

This repository is the Layerswap analog of the Tether WDK (Wallet Development Kit) bridge protocol packages — it implements `BridgeProtocol` from `@tetherto/wdk-wallet/protocols` so a WDK EVM wallet account can bridge tokens across chains via the Layerswap public API.

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
- `src/layerswap-protocol-evm.js` — `BridgeProtocol` implementation. Only EVM-specific file in this package; the API client and resolvers come from core.
- `types/` — generated; do not edit by hand.

## Semantic notes
- `BridgeResult.bridgeFee` is in **source-token base units** (Layerswap deducts its fee from the bridged amount, not paid as native gas). The WDK base type documents it as native — this divergence is intentional and called out in the protocol's JSDoc and README.
- `LayerswapProtocolConfig.bridgeMaxFee` is compared against `bridgeFee` only.
