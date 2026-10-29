# Agent Guide — layerswap-ton

Sibling of `layerswap-evm`, `layerswap-solana` and `layerswap-bitcoin` for the TON source VM, for `@tetherto/wdk-wallet-ton` accounts.

## Project Overview

- **Architecture:** `LayerswapProtocolTon` is a thin subclass of core's `LayerswapSwidgeProtocol`. Everything chain-agnostic — the swidge flow, the legacy `bridge`/`quoteBridge` adapters, status/discovery, fee guards, the shared typedefs and the WDK error contract — lives in `@layerswap/wdk-protocol-swidge-layerswap-core`. Never duplicate it here: if a change is not TON-specific, it belongs in core.
- **What this package implements** (the base-class hooks): `_detectSourceNetwork` (zero-state root hash of the account's ton center, `TON_MAINNET` without an account), `_resolveTransactionId` (traces a deposit to the message Layerswap tracks), `_quoteSourceGas` (fee approximations), `_prepareDeposit` / `_sendDeposit` (the deposit message), `_callWallet` (wallet-ton error mapping) and `_nativeTokenSymbol`. The writable and disposal checks are core's defaults.
- **Runtime:** Node.js and Bare. No browser-only globals; HTTP via `fetch`.

## Key Files

- `index.js` — public entry: default export of `LayerswapProtocolTon`, the wallet-ton account typedefs, and `export * from '@layerswap/wdk-protocol-swidge-layerswap-core/protocol'` (every shared type, `LayerswapApiClient`, `LayerswapSwidgeProtocol` and the WDK error classes). Do not re-list shared exports here.
- `bare.js` — Bare runtime wrapper.
- `src/layerswap-protocol-ton.js` — the TON hooks of `LayerswapSwidgeProtocol`.
- `tests/` — cover the TON specifics only (default network, gas approximations, deposit message, account detection, wallet error mapping); shared behaviour is tested once in core. The Layerswap API is mocked with the shared msw fixtures of `@layerswap/wdk-protocol-swidge-layerswap-test-utils`.
- `tests/fixtures/RESEARCH-NOTES.md` — records what was verified live against Layerswap vs assumed from the Layerswap UI source code.
- `types/` — generated; do not edit by hand.

## Why we use `account.sendTransaction({ to, value, body })`

Unlike Bitcoin, where the wallet's high-level helpers don't let us inject the Layerswap memo before signing, the TON wallet's `sendTransaction` accepts an optional `body` cell. We can therefore:

1. Build the message body ourselves (a comment cell for native TON, or a jetton-transfer body cell for jettons) — including Layerswap's `call_data` comment in the forward payload.
2. Hand the `{ to, value, body }` to the wallet, which sets up the v5r1 wallet contract, signs, and broadcasts.

For jetton transfers we cannot use `account.transfer(...)` because it bakes its own (empty) forward payload — Layerswap's UI puts the comment in the forward payload, and we need to mirror that. So we resolve the jetton wallet address via the protected `account._getJettonWalletAddress(token)` and send a manually-built jetton-transfer body to that address.

## Source network detection

TON does not expose a stable network id the way EVM exposes `chainId`, and Layerswap's `network.chain_id` is `null` for `TON_MAINNET` (see `tests/fixtures/RESEARCH-NOTES.md`). The network is identified instead by the root hash of the zero-state (genesis) block, read through the ton center client the wallet account was built with (`account._tonClient.api.getMasterchainInfo()`): `F6OpKZKq…` → `TON_MAINNET`, `gj+B8wb/…` → `TON_TESTNET`. Without an account the source network defaults to `TON_MAINNET`; a `fromChain` must match the detected network.

## Transaction status

The hash `swidge()` returns is the wallet's body hash of the deposit's external message. Layerswap tracks TON deposits by the hash of the message that reaches its deposit address — the jetton `transfer_notification`, or the wallet's own outgoing message for native TON. `_resolveTransactionId` traces the deposit through ton center v3 (`transactionsByMessage` → `traces`) to find it, so `getTransactionStatus(result.hash)` works. `TonClient` keeps its api key in `api.parameters`, not in `parameters` where the wallet's `_resolveTonCenterEndpoint()` looks, so the key is read from there.

## Semantic notes

- The gas entry is non-included and in **nanotons**. The TON wallet only reports actual gas from `sendTransaction`'s return, so `_prepareDeposit` returns no fee: the shared fee guards run pre-broadcast against the included Layerswap fees only, and the base class appends the actual gas entry from `_sendDeposit`'s result.

## Dependencies

`@tetherto/wdk-wallet` (`1.0.0-beta.25`), `@tetherto/wdk-wallet-ton` (`1.0.0-beta.17`), `@ton/ton` (`16.2.4`), `@ton/core` (`0.63.1`) and `@ton/crypto` (`3.3.0`) are regular `dependencies`, pinned to **exact** versions (no ranges, no peer deps): the WDK is in pre-release and betas may break compatibility. Keep the `@ton/*` pins aligned with the ones `@tetherto/wdk-wallet-ton` uses, so pnpm resolves a single `@ton/core` copy. Accounts are consumed duck-typed, never via `instanceof`.

## Error contract

The shared contract (`ISwidgeProtocol` `@throws`, LSP) is implemented in core. TON-specific parts:

- disposed account: `account.disposed`, or `keyPair.privateKey === null` after `WalletAccountTon.dispose()` → `DisposalError` (core's default `_isDisposedAccount`);
- missing / malformed deposit `to_address` → `ProviderError`;
- `@tetherto/wdk-wallet-ton` throws plain `Error`s, so `_callWallet` maps "not connected to ton center" → `ProviderRequiredError`, "exceeded maximum fee" → `MaximumFeeExceededError`, and everything else through core's `normalizeWalletError` (→ `ProviderError`).

## Coding conventions

Same as the rest of the monorepo (see [`/AGENTS.md`](../../AGENTS.md)). ESM, JSDoc-only types, `standard` lint, `cross-env NODE_OPTIONS=--experimental-vm-modules jest`.
