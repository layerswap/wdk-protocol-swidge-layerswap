# Agent Guide — layerswap-ton

Sibling of `layerswap-evm`, `layerswap-solana`, and `layerswap-tron` for the TON source VM. Implements `BridgeProtocol` for `@tetherto/wdk-wallet-ton` accounts.

## Project Overview

- **Architecture:** Single `LayerswapProtocolTon` class. The chain-agnostic HTTP client (`LayerswapApiClient`) and the network/token/decimal helpers live in `@layerswap/wdk-protocol-bridge-layerswap-core` — do not duplicate them here.
- **Runtime:** Node.js and Bare. No browser-only globals; HTTP via `fetch`.

## Key Files

- `index.js` — public entry: default export of `LayerswapProtocolTon` plus its config/options/result typedefs.
- `bare.js` — Bare runtime wrapper.
- `src/layerswap-protocol-ton.js` — `BridgeProtocol` implementation.
- `tests/fixtures/RESEARCH-NOTES.md` — records what was verified live against Layerswap vs assumed from the Layerswap UI source code.
- `types/` — generated; do not edit by hand.

## Why we use `account.sendTransaction({ to, value, body })`

Unlike Tron/Bitcoin where the wallet's high-level helpers don't let us inject the Layerswap memo before signing, the TON wallet's `sendTransaction` accepts an optional `body` cell. We can therefore:

1. Build the message body ourselves (a comment cell for native TON, or a jetton-transfer body cell for jettons) — including Layerswap's `call_data` comment in the forward payload.
2. Hand the `{ to, value, body }` to the wallet, which sets up the v5r1 wallet contract, signs, and broadcasts.

For jetton transfers we cannot use `account.transfer(...)` because it bakes its own (empty) forward payload — Layerswap's UI puts the comment in the forward payload, and we need to mirror that. So we resolve the jetton wallet address via the protected `account._getJettonWalletAddress(token)` and send a manually-built jetton-transfer body to that address.

## Source network detection

TON does not expose a stable network id the way EVM exposes `chainId`. Layerswap's `network.chain_id` is also `null` for `TON_MAINNET` (see `tests/fixtures/RESEARCH-NOTES.md`), and Layerswap only lists `TON_MAINNET` in the public catalog.

The protocol therefore defaults to `TON_MAINNET` for the source chain. Users can override by passing `sourceChain: 'TON_<...>'` if Layerswap ever adds testnet support.

## Semantic notes (carried over from sibling packages)

- `BridgeResult.bridgeFee` is in **source-token base units**, not native nanotons. Layerswap deducts its fee from the source amount.
- `LayerswapProtocolConfig.bridgeMaxFee` is compared against `bridgeFee` only.
- Do not naively sum `fee + bridgeFee` — different units.

## wdk-wallet version pin

`@tetherto/wdk-wallet-ton@1.0.0-beta.8` pins `@tetherto/wdk-wallet@1.0.0-beta.8`. This package keeps `1.0.0-beta.8` as the dev pin so the `BridgeProtocol` base class and the wallet account's superclass come from the same copy. Peer dep is loosened to `>=1.0.0-beta.7` to remain compatible with the other siblings.

## Coding conventions

Same as the rest of the monorepo (see [`/AGENTS.md`](../../AGENTS.md)). ESM, JSDoc-only types, `standard` lint, `cross-env NODE_OPTIONS=--experimental-vm-modules jest`.
