# Agent Guide — layerswap-bitcoin

Sibling of `layerswap-evm`, `layerswap-solana`, `layerswap-tron`, and `layerswap-ton` for the Bitcoin source VM. Implements `BridgeProtocol` for `@tetherto/wdk-wallet-btc` accounts.

## Project Overview

- **Architecture:** Single `LayerswapProtocolBitcoin` class. The chain-agnostic HTTP client and helpers live in `@layerswap/wdk-protocol-bridge-layerswap-core` — do not duplicate them here.
- **Runtime:** Node.js and Bare. No browser-only globals; HTTP via `fetch`.

## Key Files

- `index.js` — public entry: default export of `LayerswapProtocolBitcoin` plus its config/options/result typedefs.
- `bare.js` — Bare runtime wrapper.
- `src/layerswap-protocol-bitcoin.js` — `BridgeProtocol` implementation.
- `tests/fixtures/RESEARCH-NOTES.md` — records what was verified live against Layerswap vs assumed from the Layerswap UI source code.
- `types/` — generated; do not edit by hand.

## Why we build the PSBT ourselves

`@tetherto/wdk-wallet-btc`'s `account.sendTransaction({ to, value, feeRate? })` builds + signs + broadcasts a simple "deposit + change" transaction with no seam for an `OP_RETURN` memo. Layerswap's deposit flow for Bitcoin requires that memo (the swap reference id, encoded as hex in the OP_RETURN output) so its watcher can correlate the deposit to the swap.

We therefore mirror the wallet's internal flow but inject the `OP_RETURN` output between the deposit and the change:

1. `account._client.listUnspent(address)` — UTXO set (Electrum/Blockbook).
2. `account._client.estimateFee(1)` — feeRate.
3. `@bitcoinerlab/coinselect` — pick UTXOs covering `amount + fee + opReturnOverhead`.
4. Build PSBT with bitcoinjs-lib:
   - Inputs: `witnessUtxo` (BIP-84) or `nonWitnessUtxo` (BIP-44), with `bip32Derivation` so `signInputHD` walks the right path.
   - Output #0: deposit address + value.
   - Output #1: `script.compile([opcodes.OP_RETURN, memoBytes])` with `value: 0`.
   - Output #2: change to sender if above the dust limit.
5. `psbt.signInputHD(idx, account._masterNode)` — uses the BIP-32 master node from the wallet.
6. `psbt.finalizeAllInputs(); psbt.extractTransaction()`.
7. `account._client.broadcast(tx.toHex())`.

The protocol reaches into several wallet internals (`_client`, `_masterNode`, `_account`, `_network`, `_dustLimit`, `_path`, `_bip`, `_ensureConnected`, `_toBigInt`). These are protected (`_` prefix) but exposed for subclass / sibling use — same access pattern as Solana's `account._config.provider` and Tron's `account._tronWeb`.

## Source network

Layerswap currently only lists `BITCOIN_MAINNET` in the public catalog. The wallet's `config.network` is one of `bitcoin` / `regtest` / `testnet`; the protocol maps these to `BITCOIN_MAINNET`, `BITCOIN_REGTEST`, `BITCOIN_TESTNET` respectively. Mainnet is the only one that resolves today; the others are reserved.

Users can override the mapping by passing `sourceChain` explicitly.

## `call_data` encoding (matches Layerswap UI)

Layerswap returns the swap reference id as a numeric string in `call_data`. The Layerswap web app converts it with `Number(callData).toString(16)` and stores the resulting hex string as the `OP_RETURN` payload bytes (`Buffer.from(hex, 'hex')`). We mirror that exactly. Bitcoin OP_RETURN payloads are capped at 80 bytes — we throw if `call_data` would overflow.

## Semantic notes (carried over from sibling packages)

- `BridgeResult.bridgeFee` is in **source-token base units** (satoshis), not native gas. Layerswap deducts its fee from the source amount.
- `LayerswapProtocolConfig.bridgeMaxFee` is compared against `bridgeFee` only.

## wdk-wallet version pin

`@tetherto/wdk-wallet-btc@1.0.0-beta.9` pins `@tetherto/wdk-wallet@1.0.0-beta.8`. This package keeps `1.0.0-beta.8` as the dev pin to match.

## Coding conventions

Same as the rest of the monorepo (see [`/AGENTS.md`](../../AGENTS.md)). ESM, JSDoc-only types, `standard` lint, `cross-env NODE_OPTIONS=--experimental-vm-modules jest`.
