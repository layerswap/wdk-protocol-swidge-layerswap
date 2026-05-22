# @layerswap/wdk-protocol-bridge-layerswap-core

Chain-agnostic building blocks for the Layerswap WDK bridge packages. This package is consumed only by sibling `@layerswap/wdk-protocol-bridge-layerswap-<vm>` packages — end users should depend on a VM-specific package (e.g. `@layerswap/wdk-protocol-bridge-layerswap-evm`) instead.

## What's in here

- `LayerswapApiClient` — minimal `fetch`-based wrapper over the Layerswap public v2 API (`/api/v2/networks`, `/api/v2/quote`, `/api/v2/swaps`, `/api/v2/swaps/{id}`, `/api/v2/swaps/{id}/deposit_speedup`). Caches `getNetworks()` per instance.
- `resolveSourceNetwork(client, chainId)` — finds the `LayerswapNetwork` whose `chain_id` string-matches the supplied id. Works for any VM (EVM numeric ids, Solana cluster names, etc.).
- `resolveNetworkByName(client, name)` — case-insensitive lookup by network name.
- `resolveToken(network, identifier)` — finds a token within a network by 0x-prefixed address or symbol.
- `formatBaseUnits(baseUnits, decimals)` / `parseDecimal(value, decimals)` — base-unit ⇄ decimal-string conversion. Used to build Layerswap API request bodies (which expect decimal strings).

## Semantic notes

- The Layerswap API returns the `chain_id` field as a string for every VM, but the value's meaning varies: EVM gives numeric ids (`'1'`, `'42161'`), Solana gives cluster names (`'mainnet-beta'`, `'devnet'`), TON / Bitcoin use their own conventions. `resolveSourceNetwork` does plain string equality, so each VM package is responsible for producing the right "chain id" string from its provider.
- `parseDecimal` truncates digits past `decimals` (it does not round). Layerswap returns fees with plenty of significant digits already, so any truncation is sub-base-unit.

## Runtime

- Node.js or Bare. No browser-only globals. HTTP via global `fetch`. `LayerswapApiClient` falls back to a `Math.random`-based correlation id when `crypto.randomUUID` is unavailable.

## Conventions

This package follows the repo-wide conventions in [`/AGENTS.md`](../../AGENTS.md): ESM, JSDoc-only types, `standard` lint, kebab-case files, PascalCase classes, explicit `.js` import extensions.
