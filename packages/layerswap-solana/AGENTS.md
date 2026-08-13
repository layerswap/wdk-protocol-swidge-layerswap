# Agent Guide — layerswap-solana

Sibling of `layerswap-evm` for the Solana source VM. Extends `SwidgeProtocol` (from `@tetherto/wdk-wallet/protocols`, >= 1.0.0-beta.16) for `@tetherto/wdk-wallet-solana` accounts, with the legacy `bridge`/`quoteBridge` surface kept as thin adapters over `swidge`.

## Project Overview

- **Architecture:** Single `LayerswapProtocolSolana` class. The chain-agnostic HTTP client (`LayerswapApiClient`) and the network/token/decimal helpers live in `@layerswap/wdk-protocol-bridge-layerswap-core` — do not duplicate them here.
- **Runtime:** Node.js and Bare. No browser-only globals; HTTP via `fetch`.

## Key Files

- `index.js` — public entry: default export of `LayerswapProtocolSolana` plus its config/options/result typedefs.
- `bare.js` — Bare runtime wrapper.
- `src/layerswap-protocol-solana.js` — `SwidgeProtocol` implementation.
- `tests/fixtures/` — captured Layerswap API responses + research notes. `RESEARCH-NOTES.md` documents what was verified live vs assumed.
- `types/` — generated; do not edit by hand.

## Two SDKs side-by-side (intentional)

This package depends on **both** Solana SDKs:

1. `@tetherto/wdk-wallet-solana` (modular v3 `@solana/*` SDK under the hood) — provides identity. We call `account.getAddress()`, read `account.keyPair`, and do `instanceof WalletAccountSolana` checks.
2. `@solana/web3.js` (legacy SDK) — used to deserialise Layerswap's `call_data` and broadcast. Layerswap encodes `call_data` as a base64-serialised legacy `Transaction` (confirmed against the Layerswap web app source), and the WDK wallet's `sendTransaction` only accepts v3 `TransactionMessage`s. The path of least surprise is to mirror Layerswap's own UI: `Transaction.from(Buffer.from(callData, 'base64'))`, sign with `Keypair.fromSecretKey(...)`, broadcast via `connection.sendRawTransaction`.

If `@tetherto/wdk-wallet-solana` ever gains the ability to consume legacy wire-format transactions directly, drop `@solana/web3.js` and route through the wallet again.

## Source network detection

Layerswap's `chain_id` field is unreliable for Solana (`''` on prod, a numeric string on dev — see `tests/fixtures/RESEARCH-NOTES.md`). We detect the source by calling `connection.getGenesisHash()` and mapping the well-known constants to network names:

| Genesis hash | Layerswap name |
| --- | --- |
| `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` | `SOLANA_MAINNET` |
| `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` | `SOLANA_DEVNET` |
| `4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY` | `SOLANA_TESTNET` |

Users can override the auto-detection by passing `fromChain: 'SOLANA_<...>'` in the `swidge()` options (legacy: `sourceChain` in `bridge()`).

## Semantic notes (carried over from `layerswap-evm`)

- Swidge fees are itemised: Layerswap's `included: true` entries are in **source-token base units**; the gas entry is non-included and in **lamports**. Never sum across entries with different `token`s.
- Legacy `BridgeResult.bridgeFee` is in **source-token base units** (= sum of `included` swidge fees). `LayerswapProtocolConfig.bridgeMaxFee` is compared against that sum only.

## wdk-wallet version pin

All packages pin `@tetherto/wdk-wallet@1.0.0-beta.16` (the version verified to ship `SwidgeProtocol` with the current contract) as the dev dependency, with peer dep `>=1.0.0-beta.16`. The wallet-account packages bundle their own older copy of `@tetherto/wdk-wallet` — that's fine because accounts are consumed duck-typed, never via `instanceof`.

## Coding conventions

Same as the rest of the monorepo (see [`/AGENTS.md`](../../AGENTS.md)). ESM, JSDoc-only types, `standard` lint, `cross-env NODE_OPTIONS=--experimental-vm-modules jest`.
