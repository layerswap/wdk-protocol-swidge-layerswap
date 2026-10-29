# Agent Guide — layerswap-core

Chain-agnostic Layerswap building blocks consumed by every sibling `layerswap-<vm>` protocol package.

## Scope

This package must remain **VM-agnostic**. It contains:
- `LayerswapSwidgeProtocol` — the chain-agnostic `SwidgeProtocol` implementation every VM package extends. It owns the whole public surface (quote/swidge/status/discovery/bridge adapters/transaction status), the throw contract, and the shared typedefs; VM packages only implement its hooks (`_detectSourceNetwork`, `_prepareDeposit`, `_sendDeposit`, optional `_isWritableAccount`, `_isDisposedAccount`, `_quoteSourceGas`, `_assertSwidgeRoute`, `_callWallet`, `_nativeTokenSymbol`). The default `_isDisposedAccount` checks `account.disposed` and an erased `keyPair.privateKey` (`null`) — WDK accounts do not implement `disposed` yet, so the key check is what catches a disposed EVM/TON/Solana account.
- `protocol.js` (`…-core/protocol`) — the public API shared by every VM package (WDK/Layerswap types, `LayerswapApiClient`, `LayerswapSwidgeProtocol`, WDK errors); VM entry points `export *` it.
- `LayerswapApiClient` — HTTP wrapper over the Layerswap v2 API.
- Network/token resolution helpers (`resolveSourceNetwork`, `resolveNetworkByName`, `resolveToken`).
- Decimal/base-unit conversion helpers (`formatBaseUnits`, `parseDecimal`).
- WDK Swidge mapping helpers (`src/swidge.js`): status/transaction vocabulary mapping, chain/token discovery shapes, quote/fee itemisation, slippage conversion, fee-bps guards. These structurally match the swidge typedefs in `@tetherto/wdk-wallet/protocols`.
- WDK error mapping: every error thrown here is a WDK error class (`ValueError`, `InvalidTokenError`, `NoSuchElementError`, `ProviderError`, `MaximumFeeExceededError`, …) so the VM packages honour the `ISwidgeProtocol` throw contract (LSP). `normalizeWalletError` adapts errors raised by wallet accounts. `@tetherto/wdk-wallet` is the only WDK dependency allowed here (exact-pinned) — never a VM-specific wallet package.

Nothing in `src/` may import from a VM-specific wallet package, a chain SDK (`ethers`, `@solana/web3.js`, `tronweb`, `@ton/ton`, etc.), or reference an EVM-specific concept like ERC-20 contract addresses or 0x-prefixed hex. `resolveToken` currently matches "looks like an EVM address" — that's *opportunistic* address matching, not an EVM-only behaviour; the fallback to symbol matching is what every non-EVM VM uses.

## Conventions

Same as the rest of the monorepo (see [`/AGENTS.md`](../../AGENTS.md)):
- ESM (`type: module`), explicit `.js` import extensions.
- JSDoc-only types — `@typedef`, `@param`, `@returns`, `@throws`. No TypeScript syntax inside JSDoc.
- `standard` lint, Jest with `--experimental-vm-modules`.
- Apache 2.0 header on every source file.

## When to extend this package

Everything that can be shared **must** live here — no duplication across VM packages (code, typedefs, exports, docs or tests). Only code carrying a VM-specific assumption (signing, tx shape, gas model, address format beyond opportunistic 0x detection) belongs in a VM package, as an implementation of a `LayerswapSwidgeProtocol` hook. Shared behaviour is tested here once (`tests/layerswap-swidge-protocol.test.js`, through a minimal fake VM subclass); VM packages only test their hooks.

## Key files

- `index.js` — public entry. Default export is `LayerswapApiClient`; named exports include the API client and the resolvers/helpers.
- `bare.js` — Bare runtime wrapper.
- `src/layerswap-api-client.js` — fetch-based wrapper over the Layerswap v2 API. Caches `/networks` per instance.
- `src/networks.js` — resolution + decimal helpers.
- `src/swidge.js` — WDK Swidge mapping helpers shared by every VM package.
- `src/layerswap-swidge-protocol.js` — the `LayerswapSwidgeProtocol` base class and the shared protocol typedefs.
- `protocol.js` — the shared public API re-exported by every VM package.
- `types/` — generated; do not edit by hand.
