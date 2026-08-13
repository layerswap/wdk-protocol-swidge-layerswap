# Agent Guide — layerswap-ton

Sibling of `layerswap-evm`, `layerswap-solana`, and `layerswap-tron` for the TON source VM. Extends `SwidgeProtocol` (from `@tetherto/wdk-wallet/protocols`, >= 1.0.0-beta.16) for `@tetherto/wdk-wallet-ton` accounts, with the legacy `bridge`/`quoteBridge` surface kept as thin adapters over `swidge`.

## Project Overview

- **Architecture:** Single `LayerswapProtocolTon` class. The chain-agnostic HTTP client (`LayerswapApiClient`) and the network/token/decimal helpers live in `@layerswap/wdk-protocol-bridge-layerswap-core` — do not duplicate them here.
- **Runtime:** Node.js and Bare. No browser-only globals; HTTP via `fetch`.

## Key Files

- `index.js` — public entry: default export of `LayerswapProtocolTon` plus its config/options/result typedefs.
- `bare.js` — Bare runtime wrapper.
- `src/layerswap-protocol-ton.js` — `SwidgeProtocol` implementation.
- `tests/fixtures/RESEARCH-NOTES.md` — records what was verified live against Layerswap vs assumed from the Layerswap UI source code.
- `types/` — generated; do not edit by hand.

## Why we use `account.sendTransaction({ to, value, body })`

Unlike Tron/Bitcoin where the wallet's high-level helpers don't let us inject the Layerswap memo before signing, the TON wallet's `sendTransaction` accepts an optional `body` cell. We can therefore:

1. Build the message body ourselves (a comment cell for native TON, or a jetton-transfer body cell for jettons) — including Layerswap's `call_data` comment in the forward payload.
2. Hand the `{ to, value, body }` to the wallet, which sets up the v5r1 wallet contract, signs, and broadcasts.

For jetton transfers we cannot use `account.transfer(...)` because it bakes its own (empty) forward payload — Layerswap's UI puts the comment in the forward payload, and we need to mirror that. So we resolve the jetton wallet address via the protected `account._getJettonWalletAddress(token)` and send a manually-built jetton-transfer body to that address.

## Source network detection

TON does not expose a stable network id the way EVM exposes `chainId`. Layerswap's `network.chain_id` is also `null` for `TON_MAINNET` (see `tests/fixtures/RESEARCH-NOTES.md`), and Layerswap only lists `TON_MAINNET` in the public catalog.

The protocol therefore defaults to `TON_MAINNET` for the source chain. Users can override by passing `fromChain: 'TON_<...>'` (legacy: `sourceChain`) if Layerswap ever adds testnet support.

## Semantic notes (carried over from sibling packages)

- Swidge fees are itemised: Layerswap's `included: true` entries are in **source-token base units**; the gas entry is non-included and in **nanotons**. Never sum across entries with different `token`s.
- The TON wallet only reports actual gas from `sendTransaction`'s return, so `assertFeeGuards` runs pre-broadcast against the included Layerswap fees only; the actual gas entry is appended to the result afterwards.
- Legacy `BridgeResult.bridgeFee` is in **source-token base units** (= sum of `included` swidge fees). `LayerswapProtocolConfig.bridgeMaxFee` is compared against that sum only.

## wdk-wallet version pin

All packages pin `@tetherto/wdk-wallet@1.0.0-beta.16` (the version verified to ship `SwidgeProtocol` with the current contract) as the dev dependency, with peer dep `>=1.0.0-beta.16`. The wallet-account packages bundle their own older copy of `@tetherto/wdk-wallet` — that's fine because accounts are consumed duck-typed, never via `instanceof`.

## Coding conventions

Same as the rest of the monorepo (see [`/AGENTS.md`](../../AGENTS.md)). ESM, JSDoc-only types, `standard` lint, `cross-env NODE_OPTIONS=--experimental-vm-modules jest`.
