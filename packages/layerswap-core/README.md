# @layerswap/wdk-protocol-bridge-layerswap-core

Chain-agnostic building blocks for the Layerswap WDK bridge packages. This package is consumed only by sibling `@layerswap/wdk-protocol-bridge-layerswap-<vm>` packages — end users should depend on a VM-specific package (e.g. `@layerswap/wdk-protocol-bridge-layerswap-evm`) instead.

## What's in here

- `LayerswapApiClient` — minimal `fetch`-based wrapper over the Layerswap public v2 API (`/api/v2/networks`, `/api/v2/quote`, `/api/v2/swaps`, `/api/v2/swaps/{id}`, `/api/v2/swaps/{id}/deposit_speedup`). Caches `getNetworks()` per instance.
- `resolveSourceNetwork(client, chainId)` — finds the `LayerswapNetwork` whose `chain_id` string-matches the supplied id. Works for any VM (EVM numeric ids, Solana cluster names, etc.).
- `resolveNetworkByName(client, name)` — case-insensitive lookup by network name.
- `resolveToken(network, identifier)` — finds a token within a network by 0x-prefixed address or symbol.
- `formatBaseUnits(baseUnits, decimals)` / `parseDecimal(value, decimals)` — base-unit ⇄ decimal-string conversion. Used to build Layerswap API request bodies (which expect decimal strings).
- WDK Swidge mapping helpers (`src/swidge.js`) — shared by every VM package so the `SwidgeProtocol` implementations stay thin:
  - `mapSwapStatus(status)` / `mapSwapTransactions(txs)` / `buildStatusResult(swapResponse)` — Layerswap swap lifecycle → WDK `SwidgeStatus`/`SwidgeTransaction` vocabulary.
  - `buildSupportedChains(networks)` / `buildSupportedTokens(networks, options)` — network catalog → WDK `SwidgeSupportedChain`/`SwidgeSupportedToken` shapes.
  - `buildSwidgeQuote(quote, sourceToken, destinationToken, sourceChain)` / `buildQuoteFees(...)` — Layerswap quote → WDK `SwidgeQuote` with itemised, source-token-denominated `included` fees (falls back to a single `total_fee` entry when the breakdown is absent).
  - `formatSlippage(slippage)` — WDK decimal slippage (0.01 = 1%) → Layerswap percent string (`'1'`).
  - `assertFeeGuards(fees, fromTokenAmount, sourceTokenSymbol, config)` — enforces the WDK `maxNetworkFeeBps`/`maxProtocolFeeBps` guards over same-unit fee entries.

  These helpers structurally match the swidge typedefs in `@tetherto/wdk-wallet/protocols` but are declared locally, so this package keeps zero WDK dependency.

## Semantic notes

- The Layerswap API returns the `chain_id` field as a string for every VM, but the value's meaning varies: EVM gives numeric ids (`'1'`, `'42161'`), Solana gives cluster names (`'mainnet-beta'`, `'devnet'`), TON / Bitcoin use their own conventions. `resolveSourceNetwork` does plain string equality, so each VM package is responsible for producing the right "chain id" string from its provider.
- `parseDecimal` truncates digits past `decimals` (it does not round). Layerswap returns fees with plenty of significant digits already, so any truncation is sub-base-unit.

## Runtime

- Node.js or Bare. No browser-only globals. HTTP via global `fetch`. `LayerswapApiClient` falls back to a `Math.random`-based correlation id when `crypto.randomUUID` is unavailable.

## Conventions

This package follows the repo-wide conventions in [`/AGENTS.md`](../../AGENTS.md): ESM, JSDoc-only types, `standard` lint, kebab-case files, PascalCase classes, explicit `.js` import extensions.
