# Agent Guide

This repository is the Layerswap analog of the Tether WDK (Wallet Development Kit) swidge protocol packages — it extends `SwidgeProtocol` from `@tetherto/wdk-wallet/protocols` (exact-pinned, currently `1.0.0-beta.25`) so a WDK EVM wallet account can swap and bridge tokens across chains via the Layerswap public API. The legacy `bridge`/`quoteBridge` surface is kept as thin adapters over `swidge`/`quoteSwidge`.

## Project Overview
- **Architecture:** `LayerswapProtocolEvm` is a thin subclass of core's `LayerswapSwidgeProtocol` (`@layerswap/wdk-protocol-swidge-layerswap-core`), which implements the whole swidge/bridge surface. This package only implements the EVM hooks: `_detectSourceNetwork` (chain id of `account._provider`), `_quoteSourceGas`, `_prepareDeposit`/`_sendDeposit` (the deposit transaction, incl. ERC-4337) and `_callWallet` (ethers `INSUFFICIENT_FUNDS` mapping). Anything chain-agnostic belongs in core — never duplicate it here.
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
- `index.js` — public entry: the default `LayerswapProtocolEvm`, the EVM-specific typedefs (wallet account types, ERC-4337 configs, `LayerswapEvmSwidgeConfig`/`LayerswapEvmBridgeConfig`), and `export * from '@layerswap/wdk-protocol-swidge-layerswap-core/protocol'` — the shared public API (WDK and Layerswap types, `LayerswapApiClient`, `LayerswapSwidgeProtocol`, WDK error classes). Rule of thumb: if a public component depends on another component, that component is public too.
- `bare.js` — Bare runtime wrapper.
- `src/layerswap-protocol-evm.js` — the EVM hooks of `LayerswapSwidgeProtocol`.
- `tests/` — EVM specifics only (provider shapes, gas quotes, deposit transaction, ERC-4337, wallet errors). Shared behaviour is tested once in core. The Layerswap API is mocked with the msw fixtures of the private `@layerswap/wdk-protocol-swidge-layerswap-test-utils` package.
- `types/` — generated; do not edit by hand.

## Dependencies

`@tetherto/wdk-wallet`, `@tetherto/wdk-wallet-evm` and `@tetherto/wdk-wallet-evm-erc-4337` are regular `dependencies` pinned to **exact** versions (the source and the generated types depend on them, and pre-release WDK betas may break compatibility). Bump them deliberately, together with the tests.

## Contracts with the WDK

- Errors: hooks may only throw errors the corresponding `ISwidgeProtocol` method allows (LSP) — use the WDK error classes and route wallet calls through `_callWallet`. The public methods, their exact `@throws` lists, the account/disposal guards and the `SwidgeError` → `BridgeError` masking live in core's `LayerswapSwidgeProtocol`.
- The source chain is detected through `account._provider` (the provider the wallet already built), never rebuilt from `account._config`.
- Typedefs: never use `X & Object` with `@property` tags (tsc drops the properties) and avoid inline types — declare a top-level typedef and intersect it (e.g. `LayerswapEvmSwidgeConfig = LayerswapSwidgeConfig & LayerswapEvmErc4337Overrides`).

## Semantic notes
- Swidge fees are itemised: Layerswap's `included: true` entries are in **source-token base units**; the source-chain gas entry is non-included and in **native units**. Never sum across entries with different `token`s.
- Exact-in only (`fromTokenAmount`); `toTokenAmount` (exact-out) throws. `toChain` is required — Layerswap has no same-chain swaps, so the inherited `swap()` always throws.
- WDK swidge `slippage` is a decimal (0.01 = 1%); legacy `BridgeOptions.slippage` stays a percent string and is divided by 100 in `_toSwidgeOptions`.
- Legacy `BridgeResult.bridgeFee` is in **source-token base units** (= sum of `included` swidge fees). `LayerswapProtocolConfig.bridgeMaxFee` is compared against that sum only.
