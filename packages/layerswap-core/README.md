# @layerswap/wdk-protocol-swidge-layerswap-core

Chain-agnostic building blocks for the Layerswap WDK Swidge packages. This package is consumed only by sibling `@layerswap/wdk-protocol-swidge-layerswap-<vm>` packages — end users should depend on a VM-specific package (e.g. `@layerswap/wdk-protocol-swidge-layerswap-evm`) instead. The [Protocol API reference](#protocol-api-reference) below documents the API every VM package shares.

## What's in here

- `LayerswapApiClient` — minimal `fetch`-based wrapper over the Layerswap public v2 API (`/api/v2/networks`, `/api/v2/quote`, `/api/v2/swaps`, `/api/v2/swaps/{id}`, `/api/v2/swaps/{id}/deposit_speedup`, `/api/v2/transaction_status`). Caches `getNetworks()` per instance. Failed requests are thrown as WDK errors decorated with Layerswap's error `code` and the HTTP `status`:
  - `ProviderError` — network failure (`NETWORK_ERROR`), timeout (`REQUEST_TIMEOUT`), 401/403 (`UNAUTHORIZED`/`FORBIDDEN`), 5xx or malformed body (`INTERNAL_SERVER_ERROR`);
  - `NoSuchElementError` — 404 on a looked-up swap or transaction;
  - `ValueError` — any other 4xx (Layerswap rejected the request parameters).
- `resolveSourceNetwork(client, chainId)` — finds the `LayerswapNetwork` whose `chain_id` string-matches the supplied id. Works for any VM (EVM numeric ids, Solana cluster names, etc.).
- `resolveNetworkByName(client, name)` — case-insensitive lookup by network name. Both resolvers throw a `ValueError` for unsupported networks.
- `resolveToken(network, identifier)` — finds a token within a network by 0x-prefixed address or symbol. Throws an `InvalidTokenError` for unsupported tokens.
- `formatBaseUnits(baseUnits, decimals)` / `parseDecimal(value, decimals)` — base-unit ⇄ decimal-string conversion. Used to build Layerswap API request bodies (which expect decimal strings).
- WDK Swidge mapping helpers (`src/swidge.js`) — shared by every VM package so the `SwidgeProtocol` implementations stay thin:
  - `mapSwapStatus(status)` / `mapSwapTransactions(txs)` / `buildStatusResult(swapResponse, options)` — Layerswap swap lifecycle → WDK `SwidgeStatus`/`SwidgeTransaction` vocabulary. The optional `{ fromChain, toChain }` hints (WDK `SwidgeStatusOptions`) constrain the lookup: a swap whose source/destination network doesn't match (by name or chain id, case-insensitive) throws a `NoSuchElementError`.
  - `buildSupportedChains(networks)` / `buildSupportedTokens(networks, options)` — network catalog → WDK `SwidgeSupportedChain`/`SwidgeSupportedToken` shapes.
  - `buildSwidgeQuote(quote, sourceToken, destinationToken, sourceChain)` / `buildQuoteFees(...)` — Layerswap quote → WDK `SwidgeQuote` with itemised, source-token-denominated `included` fees (falls back to a single `total_fee` entry when the breakdown is absent).
  - `formatSlippage(slippage)` — WDK decimal slippage (0.01 = 1%) → Layerswap percent string (`'1'`).
  - `assertFeeGuards(fees, fromTokenAmount, sourceTokenSymbol, config)` — enforces the WDK `maxNetworkFeeBps`/`maxProtocolFeeBps` guards over same-unit fee entries; throws a `MaximumFeeExceededError`.
  - `normalizeWalletError(error)` — makes an error raised by a wallet account comply with the `ISwidgeProtocol` throw contract: contract errors pass through (matched by name, since wallets may bundle another `@tetherto/wdk-wallet` copy), insufficient-balance `TransactionError`/`TransferError` become a `SwidgeError`, anything else is wrapped in a `ProviderError`.

  The returned shapes structurally match the swidge typedefs in `@tetherto/wdk-wallet/protocols`. Every error is a WDK error class from `@tetherto/wdk-wallet` (an exact-pinned dependency), so each VM package honours the throw contract of the `ISwidgeProtocol` interface.

## `LayerswapSwidgeProtocol`

The chain-agnostic WDK swidge protocol, extended by every VM package. It implements the whole `ISwidgeProtocol` surface — `quoteSwidge`, `swidge`, `getSwidgeStatus`, `getSupportedChains`, `getSupportedTokens`, the legacy `bridge`/`quoteBridge` adapters and `getTransactionStatus` — and leaves only the chain-specific steps to its subclasses:

| hook | purpose |
| --- | --- |
| `_detectSourceNetwork()` *(required)* | The Layerswap network the wallet account is connected to (used when `fromChain` is omitted). |
| `_assertAccountNetwork(network)` | Checks that the account is connected to the network named by `fromChain` (default: compares it with `_detectSourceNetwork()`, skipped without a provider). |
| `_resolveTransactionId(hash)` | Maps a hash returned by `swidge()` to the id Layerswap tracks the deposit by, for `getTransactionStatus` (default: the hash itself). |
| `_isWritableAccount(account)` / `_isDisposedAccount(account)` | Stricter account checks than the default `sendTransaction` / `account.disposed` duck-typing. |
| `_prepareDeposit(context)` / `_sendDeposit(deposit, config)` *(required)* | Build (and quote) the source-chain deposit described by the Layerswap deposit action, then broadcast it. |
| `_quoteSourceGas(route, amount, sourceAddress)` | Estimated source-chain gas for quotes. |
| `_assertSwidgeRoute(route)` | VM-specific route checks run before a swap is created. |
| `_callWallet(call)` | Wallet-call error normalisation; override to map chain-specific errors first. |
| `_nativeTokenSymbol` | Fallback symbol of the native gas token. |

The class is generic over the swidge/bridge options and configs (`@template O, C, B, BC`), so a VM package can extend them with its own options (e.g. ERC-4337 overrides, Bitcoin `feeRate`) while keeping the typings exact.

## The `/protocol` entry point

`@layerswap/wdk-protocol-swidge-layerswap-core/protocol` is the public API shared by every VM package — the WDK swidge types, the Layerswap protocol types, `LayerswapApiClient`, `LayerswapSwidgeProtocol` and the WDK error classes the protocols throw. Each VM package re-exports it from its own entry point (`export * from '…-core/protocol'`), so a consumer never needs to depend on core directly.

## Protocol API reference

### Configuration (`LayerswapProtocolConfig`)

Every VM protocol is constructed as `new LayerswapProtocol<Vm>(account, config)`, where `account` is a WDK wallet account of that VM (full or read-only), or `undefined` for discovery-only use. Read-only accounts may call `quoteSwidge`/discovery/status methods but not `swidge`.

- `config.apiKey` *(optional)* — Layerswap API key, sent as `X-LS-APIKEY` when set. Use for higher rate limits / partner attribution.
- `config.apiUrl` — API base URL. Default: `https://api.layerswap.io`.
- `config.maxNetworkFeeBps` / `config.maxProtocolFeeBps` — WDK swidge fee guards, in basis points of the input amount. Checked against fee entries denominated in the source token before broadcasting.
- `config.bridgeMaxFee` — Maximum acceptable Layerswap fee, in **source-token base units** (legacy guard; compared against the sum of `included` fees).
- `config.requestTimeoutMs` — HTTP timeout. Default: `30000`.

### `quoteSwidge(options): Promise<SwidgeQuote>`

Returns a non-binding quote: `{ fromTokenAmount, toTokenAmount, toTokenAmountMin, fees, estimatedDuration }`. When an account is bound, `fees` includes a non-included `'network'` entry with the estimated source-chain gas.

### `swidge(options, config?): Promise<SwidgeResult>`

Creates the Layerswap swap, enforces the fee guards, broadcasts the source-chain deposit, and returns `{ id, hash, fees, transactions, fromTokenAmount, toTokenAmount, toTokenAmountMin }`. `id` is the Layerswap swap id (use it with `getSwidgeStatus`); `hash` is the deposit tx hash. `config` overrides the protocol's fee guards per call (VM packages may accept extra options, e.g. ERC-4337 wallet overrides).

### `getSwidgeStatus(id, options?): Promise<SwidgeStatusResult>`

`options` is the WDK `SwidgeStatusOptions` (`{ fromChain?, toChain? }`). The Layerswap swap id is globally unique, so the hints are not needed to find the swap; when given, they constrain the lookup — a swap whose source/destination network doesn't match (by Layerswap network name or chain id, case-insensitive) throws a `NoSuchElementError`.

Returns the WDK-mapped status plus the source/destination/refund transactions Layerswap has observed. The status is derived **transaction-first**: a completed output (payout) transaction means `'completed'` even if Layerswap's swap-level status lags behind; a refund transaction maps to `'refunded'`/`'refund-pending'`; an in-flight output means `'pending'`. Only without a decisive transaction does the swap-level status apply (`user_transfer_pending` → `'action-required'`, `ls_transfer_pending` → `'pending'`, terminal states 1:1).

### `getSupportedChains()` / `getSupportedTokens(options?)`

Expose the live Layerswap network catalog in the WDK shapes. Chain `id`s are Layerswap network names (`'ETHEREUM_MAINNET'`, …) — use them as `fromChain`/`toChain`.

### `getTransactionStatus(hash, options?): Promise<LayerswapTransactionStatus>`

Layerswap's assessment (`'completed' | 'failed' | 'pending'`) of the source-chain deposit transaction. `options.sourceChain` overrides the network detected from the wallet account. Throws a `NoSuchElementError` until Layerswap has indexed the transaction.

### `getApiClient(): LayerswapApiClient`

The underlying Layerswap v2 API client (also re-exported as `LayerswapApiClient`).

### Errors

Every method honours the throw contract of the WDK `ISwidgeProtocol` interface. The error classes are re-exported from this package:

| error | thrown when |
| --- | --- |
| `AccountRequiredError` | `swidge`/`bridge` without a non read-only account. |
| `DisposalError` | `swidge`/`bridge` with a disposed account. |
| `ValueError` | Invalid options (exact-out, missing `toChain`/`fromTokenAmount`/`recipient`, same-chain route, invalid slippage), unsupported networks, or parameters rejected by Layerswap. |
| `InvalidTokenError` | The source or destination token is not supported by Layerswap on that network. |
| `ProviderRequiredError` | The source chain must be detected but the account has no provider. |
| `ProviderError` | The Layerswap API or the chain provider fails (`reason`: `NETWORK_ERROR`, `REQUEST_TIMEOUT`, `UNAUTHORIZED`, `FORBIDDEN`, `INTERNAL_SERVER_ERROR`). |
| `NoSuchElementError` | `getSwidgeStatus`/`getTransactionStatus` for an unknown swap or transaction. |
| `SwidgeError` | The quoted minimum output is below `minAmountOut` (`COULD_NOT_MET_THRESHOLD`), or the account has insufficient funds (`INSUFFICIENT_BALANCE`). |
| `MaximumFeeExceededError` | The fees exceed `bridgeMaxFee`, `maxNetworkFeeBps` or `maxProtocolFeeBps`. |
| `BridgeError` | `bridge`/`quoteBridge` mask any `SwidgeError` as a `BridgeError` with the same `reason` (the original error is kept as `cause`). |

### `LayerswapSwidgeOptions` (WDK `SwidgeOptions` & `LayerswapSpecificSwidgeOptions`)

| field | type | required | notes |
| --- | --- | --- | --- |
| `fromToken` | `string` | ✓ | Source token: contract / mint address OR Layerswap symbol (`'USDC'`). |
| `fromTokenAmount` | `number \| bigint` | ✓ | Source amount in base units. **Exact-in only** — passing `toTokenAmount` throws. |
| `toChain` | `string \| number` | ✓ | Layerswap destination network name (`<CHAIN>_<ENV>` uppercase, e.g. `'ARBITRUM_MAINNET'`). Required: Layerswap does not support same-chain swaps. |
| `toToken` | `string` | | Destination token (address or symbol). Defaults to the source token's symbol. |
| `recipient` | `string` | | Destination recipient. Defaults to the account address when source and destination share the same VM type; required otherwise. |
| `fromChain` | `string \| number` | | Layerswap source network name. Defaults to the network detected from the wallet account; when an account with a provider is bound, it must name that network (a mismatch throws a `ValueError`, so a deposit is never sent on another chain than the swap's). |
| `slippage` | `number` | | Decimal, e.g. `0.01` for 1%. |
| `minAmountOut` | `number \| bigint` | | Minimum acceptable destination amount (base units); checked against the quoted minimum before broadcasting. |
| `refundAddress` | `string` | | Refund address if the swap fails after deposit. |
| `refuel` | `boolean` | | Request a native-gas drop on the destination. |
| `referenceId` | `string` | | External reference id for the swap. |

> **Fee semantics.** Layerswap deducts its fees from the source amount: the `'protocol'` (service) and `'network'` (destination) entries are denominated in the **source token** with `included: true`. Source-chain gas is a separate non-included `'network'` entry in the **native token**. Never sum amounts across fee entries with different `token`s.

### Legacy bridge surface

The pre-swidge interface is kept as a thin adapter over `swidge` (options: `LayerswapBridgeOptions`, result: `LayerswapBridgeResult`):

```javascript
const { fee, bridgeFee } = await protocol.quoteBridge({ targetChain, recipient, token, amount })
const { hash, swapId } = await protocol.bridge({ targetChain, recipient, token, amount })
```

`hash` is the source-chain deposit tx hash, `fee` the native-unit gas cost, `bridgeFee` the Layerswap fee in **source-token base units**, and `swapId` the Layerswap swap id. Legacy `slippage` remains a percent string (`'0.5'`). The WDK base class additionally derives `swap`/`quoteSwap`, but Layerswap cannot fulfil same-chain swaps, so those always throw a `ValueError`.

## Semantic notes

- The Layerswap API returns the `chain_id` field as a string for every VM, but the value's meaning varies: EVM gives numeric ids (`'1'`, `'42161'`), Solana gives cluster names (`'mainnet-beta'`, `'devnet'`), TON / Bitcoin use their own conventions. `resolveSourceNetwork` does plain string equality, so each VM package is responsible for producing the right "chain id" string from its provider.
- `parseDecimal` truncates digits past `decimals` (it does not round). Layerswap returns fees with plenty of significant digits already, so any truncation is sub-base-unit.

## Runtime

- Node.js or Bare. No browser-only globals. HTTP via global `fetch`. `LayerswapApiClient` falls back to a `Math.random`-based correlation id when `crypto.randomUUID` is unavailable.

## Conventions

This package follows the repo-wide conventions in [`/AGENTS.md`](../../AGENTS.md): ESM, JSDoc-only types, `standard` lint, kebab-case files, PascalCase classes, explicit `.js` import extensions.
