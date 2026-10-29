# Agent Guide — layerswap-bitcoin

Bitcoin source-VM package. `LayerswapProtocolBitcoin` is a **thin subclass** of `LayerswapSwidgeProtocol` from `@layerswap/wdk-protocol-swidge-layerswap-core`, which holds all chain-agnostic swidge logic (quote/swidge flow, fee guards, `getSwidgeStatus`, discovery, legacy `bridge`/`quoteBridge` adapters, error contract) and the shared types. This package only implements the Bitcoin hooks — never re-implement shared logic or re-declare shared types here.

## Project Overview

- **Architecture:** `LayerswapProtocolBitcoin extends LayerswapSwidgeProtocol<LayerswapBitcoinSwidgeOptions, LayerswapSwidgeConfig, LayerswapBitcoinBridgeOptions>`. Implemented hooks:
  - `_detectSourceNetwork()` — maps `account._config.network` to the Layerswap network (resolved through the network catalog);
  - `_isWritableAccount(account)` / `_isDisposedAccount(account)`;
  - `_assertSwidgeRoute(route)` — only native BTC can be deposited (`InvalidTokenError`, before any swap is created);
  - `_quoteSourceGas()` — the 1500-sat quote approximation;
  - `_prepareDeposit(context)` / `_sendDeposit(deposit)` — build + sign the PSBT, then broadcast it via `account._client`;
  - `_toSwidgeOptions(options)` — forwards the legacy `feeRate` bridge option.
- **Runtime:** Node.js and Bare. No browser-only globals; HTTP via `fetch`.

## Key Files

- `index.js` — public entry: default export of `LayerswapProtocolBitcoin`, the Bitcoin-specific typedefs (`LayerswapBitcoinProtocolConfig`, `LayerswapSpecificBitcoinProtocolConfig`, `LayerswapSpecificBitcoinOptions`, `LayerswapBitcoinSwidgeOptions`, `LayerswapBitcoinBridgeOptions`, `WalletAccountBtc`, `WalletAccountReadOnlyBtc`), and `export * from '@layerswap/wdk-protocol-swidge-layerswap-core/protocol'` for the shared public API (WDK/core types, `LayerswapApiClient`, `LayerswapSwidgeProtocol`, WDK error classes).
- `bare.js` — Bare runtime wrapper.
- `src/layerswap-protocol-bitcoin.js` — the Bitcoin hooks.
- `tests/fixtures/RESEARCH-NOTES.md` — records what was verified live against Layerswap vs assumed from the Layerswap UI source code.
- `types/` — generated; do not edit by hand.

## Why we build the PSBT ourselves

`@tetherto/wdk-wallet-btc`'s `account.sendTransaction({ to, value, feeRate? })` builds + signs + broadcasts a simple "deposit + change" transaction with no seam for an `OP_RETURN` memo. Layerswap's deposit flow for Bitcoin requires that memo (the swap reference id, encoded as hex in the OP_RETURN output) so its watcher can correlate the deposit to the swap.

We therefore mirror the wallet's internal flow but inject the `OP_RETURN` output between the deposit and the change:

1. `account._client.listUnspent(address)` — UTXO set (Electrum/Blockbook).
2. `account._client.estimateFee(confirmationTarget)` — feeRate (`config.confirmationTarget`, default 1), unless the `feeRate` option overrides it.
3. `@bitcoinerlab/coinselect` — pick UTXOs covering `amount + fee + opReturnOverhead`.
4. Build PSBT with bitcoinjs-lib:
   - Inputs: `witnessUtxo` (BIP-84) or `nonWitnessUtxo` (BIP-44), with `bip32Derivation` so `signInputHD` walks the right path.
   - Output #0: deposit address + value.
   - Output #1: `script.compile([opcodes.OP_RETURN, memoBytes])` with `value: 0`.
   - Output #2: change to sender if above the dust limit.
5. `psbt.signInputHD(idx, account._masterNode)` — uses the BIP-32 master node from the wallet.
6. `psbt.finalizeAllInputs(); psbt.extractTransaction()`.
7. `account._client.broadcast(tx.toHex())`.

The protocol reaches into several wallet internals (`_client`, `_masterNode`, `_account`, `_network`, `_dustLimit`, `_path`, `_bip`, `_ensureConnected`, `_toBigInt`), verified against `@tetherto/wdk-wallet-btc@1.0.0-beta.17`. These are protected (`_` prefix) but exposed for subclass / sibling use. Re-check them whenever the wallet-btc pin is bumped.

## Source network

Layerswap currently only lists `BITCOIN_MAINNET` in the public catalog. The wallet's `config.network` is one of `bitcoin` / `regtest` / `testnet`; the protocol maps these to `BITCOIN_MAINNET`, `BITCOIN_REGTEST`, `BITCOIN_TESTNET` respectively and resolves them through the catalog, so the testnet mappings throw a `ValueError` until Layerswap lists them.

A `fromChain` (legacy: `sourceChain`) must match the account's network; a mismatch throws a `ValueError`.

The deposit amount is the decimal `amount` of the Layerswap deposit action (like the web app): Layerswap reports `amount_in_base_units` as `0` for Bitcoin. A missing `call_data` throws a `ProviderError` — without its OP_RETURN reference the deposit cannot be matched to the swap.

## Error contract

The `ISwidgeProtocol` throw contract is implemented once in core. Bitcoin-specific mappings in the hooks:

- dust-limit amount → `ValueError`; non-native source token → `InvalidTokenError`;
- no / insufficient UTXOs (incl. after the OP_RETURN overhead) → `SwidgeError` `INSUFFICIENT_BALANCE` (→ `BridgeError` through `bridge`);
- missing or malformed `to_address` (incl. an address of another network), malformed or oversized `call_data` memo → `ProviderError` (`INTERNAL_SERVER_ERROR`), checked before anything is signed;
- bitcoin client failures (`_ensureConnected`, `estimateFee`, `listUnspent`, `getTransaction`, `broadcast`) go through core's `_callWallet` / `normalizeWalletError` → `ProviderError`;
- `WalletAccountBtc.dispose()` sets `_masterNode` to `undefined` while keeping `_account`, so a full account without a master node is treated as disposed (`DisposalError`); read-only accounts (no `_account`) → `AccountRequiredError`.

## `call_data` encoding (matches Layerswap UI)

Layerswap returns the swap reference id in `call_data` as a numeric sequence, optionally followed by a `;`-separated tail. Like the Layerswap web app (`packages/wallets/adapters/bitcoin/src/transferProvider/sendTransaction.ts`), the sequence is hex-encoded via `BigInt(seq).toString(16)` (not `Number`, which loses precision above 2^53), the tail (`;` included) is appended verbatim, and the resulting string is stored as **UTF-8 bytes** in the `OP_RETURN` payload. Bitcoin OP_RETURN payloads are capped at 80 bytes — we throw a `ProviderError` if `call_data` would overflow. `tests/fixtures/RESEARCH-NOTES.md` records the earlier `Number(...)` form observed during research.

## Semantic notes

- The PSBT fee entry is non-included and in satoshis, keyed to the `'BTC'` token. See the root `AGENTS.md` for the shared fee semantics.
- `_prepareDeposit` builds and signs the PSBT before core runs the fee guards (the real fee is only knowable from the built PSBT); `_sendDeposit` broadcasts strictly after all guards pass.

## wdk-wallet version pin

`@tetherto/wdk-wallet` and `@tetherto/wdk-wallet-btc` are regular `dependencies` (the source and the generated type definitions depend on them), pinned to exact versions (`1.0.0-beta.25` / `1.0.0-beta.17`) — never ranges, since new WDK beta versions can include breaking changes. Accounts are consumed duck-typed, never via `instanceof`.

## Tests

Tests cover **only the Bitcoin specifics** (network mapping, memo encoding, PSBT deposit, fee rate / confirmation target, balance and client errors, account detection); the shared behaviour is tested once in core (`packages/layerswap-core/tests/layerswap-swidge-protocol.test.js`). The Layerswap API is mocked with the shared msw fixtures of `@layerswap/wdk-protocol-swidge-layerswap-test-utils` (`setupLayerswapServer`, `layerswapApi`) — never redeclare them here. The wallet account is a duck-typed fixture exposing the protected members above, with a real BIP-32 master node so inputs are actually signed.

## Coding conventions

Same as the rest of the monorepo (see [`/AGENTS.md`](../../AGENTS.md)). ESM, JSDoc-only types, `standard` lint, `cross-env NODE_OPTIONS=--experimental-vm-modules jest`.
