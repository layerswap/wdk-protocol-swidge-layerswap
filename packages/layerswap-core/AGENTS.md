# Agent Guide — layerswap-core

Chain-agnostic Layerswap building blocks consumed by every sibling `layerswap-<vm>` protocol package.

## Scope

This package must remain **VM-agnostic**. It contains:
- `LayerswapApiClient` — HTTP wrapper over the Layerswap v2 API.
- Network/token resolution helpers (`resolveSourceNetwork`, `resolveNetworkByName`, `resolveToken`).
- Decimal/base-unit conversion helpers (`formatBaseUnits`, `parseDecimal`).

Nothing in `src/` may import from a VM-specific wallet package, a chain SDK (`ethers`, `@solana/web3.js`, `tronweb`, `@ton/ton`, etc.), or reference an EVM-specific concept like ERC-20 contract addresses or 0x-prefixed hex. `resolveToken` currently matches "looks like an EVM address" — that's *opportunistic* address matching, not an EVM-only behaviour; the fallback to symbol matching is what every non-EVM VM uses.

## Conventions

Same as the rest of the monorepo (see [`/AGENTS.md`](../../AGENTS.md)):
- ESM (`type: module`), explicit `.js` import extensions.
- JSDoc-only types — `@typedef`, `@param`, `@returns`, `@throws`. No TypeScript syntax inside JSDoc.
- `standard` lint, Jest with `--experimental-vm-modules`.
- Apache 2.0 header on every source file.

## When to extend this package

A helper belongs in `layerswap-core` if **and only if** it would be copy-pasted verbatim into every VM sibling. If the helper carries any VM-specific assumption (signing, tx shape, gas model, address format beyond opportunistic 0x detection) it belongs in the VM package instead.

## Key files

- `index.js` — public entry. Default export is `LayerswapApiClient`; named exports include the API client and the resolvers/helpers.
- `bare.js` — Bare runtime wrapper.
- `src/layerswap-api-client.js` — fetch-based wrapper over the Layerswap v2 API. Caches `/networks` per instance.
- `src/networks.js` — resolution + decimal helpers.
- `types/` — generated; do not edit by hand.
