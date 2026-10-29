# Agent Guide — layerswap-solana

Layerswap swidge protocol for `@tetherto/wdk-wallet-solana` accounts. `LayerswapProtocolSolana` is a thin subclass of `LayerswapSwidgeProtocol` (`@layerswap/wdk-protocol-swidge-layerswap-core`): the chain-agnostic flow, shared typedefs, legacy `bridge`/`quoteBridge` adapters and the WDK error contract all live in core. **Never re-implement shared logic here** — if something is not Solana-specific, it belongs in core.

## Key Files

- `index.js` — public entry: default export of `LayerswapProtocolSolana`, the wallet-solana account typedefs, and `export * from '@layerswap/wdk-protocol-swidge-layerswap-core/protocol'` (shared types, `LayerswapApiClient`, `LayerswapSwidgeProtocol`, WDK error classes).
- `bare.js` — Bare runtime wrapper.
- `src/layerswap-protocol-solana.js` — the Solana hooks of `LayerswapSwidgeProtocol`.
- `tests/` — Solana-specific tests only (shared behaviour is tested once in core). The Layerswap API is mocked with `@layerswap/wdk-protocol-swidge-layerswap-test-utils` (msw); the Solana JSON-RPC endpoint is mocked locally, and deposits run end-to-end through a real `WalletAccountSolana`.
- `tests/fixtures/` — captured Layerswap API responses + research notes (`RESEARCH-NOTES.md` documents what was verified live vs assumed).
- `types/` — generated; do not edit by hand.

## Solana hooks

- `_detectSourceNetwork()` — `account._rpc.getGenesisHash().send()` mapped to a Layerswap network name (cached per instance). Layerswap's `chain_id` is unreliable for Solana (`''` on prod, a numeric string on dev), hence the genesis-hash table:

  | Genesis hash | Layerswap name |
  | --- | --- |
  | `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` | `SOLANA_MAINNET` |
  | `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` | `SOLANA_DEVNET` |
  | `4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY` | `SOLANA_TESTNET` |

  Use the rpc client the wallet account was built with (`account._rpc`); never rebuild one from `account._config.provider` — that would ignore the rpc-client and fail-over provider shapes the wallet supports.
- `_isWritableAccount` / `_isDisposedAccount` — duck-typed (`sendTransaction` + 32-byte `keyPair.publicKey`); a disposed `WalletAccountSolana` erases its private key (`keyPair.privateKey === null`).
- `_assertSwidgeRoute` — `swidge()` requires an rpc (`ProviderRequiredError`).
- `_quoteSourceGas` — 5000-lamport per-signature fee approximation.
- `_prepareDeposit` / `_sendDeposit` — Layerswap's `call_data` is a base64-serialised transaction, treated as an unsigned template (like the Layerswap app): it is validated, decoded and decompiled with `@solana/kit` (lookup tables fetched through `account._rpc`), and its blockhash is replaced by a fresh one. The resulting transaction message is quoted (`account.quoteSendTransaction(message)`) and signed + broadcast (`account.sendTransaction(message)`) by the wallet, which rejects it if the fee payer is not the account. `@solana/kit` is the only Solana SDK in `src/` (`@solana/web3.js` is a test-only dependency).

## Dependencies

`@tetherto/wdk-wallet` and `@tetherto/wdk-wallet-solana` are regular `dependencies`, pinned to exact versions (no ranges, no peer dependencies) while the WDK is in pre-release.

## Coding conventions

Same as the rest of the monorepo (see [`/AGENTS.md`](../../AGENTS.md)). ESM, JSDoc-only types, `standard` lint, `cross-env NODE_OPTIONS=--experimental-vm-modules jest`.
