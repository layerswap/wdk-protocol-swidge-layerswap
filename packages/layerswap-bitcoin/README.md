# @layerswap/wdk-protocol-swidge-layerswap-bitcoin

WDK module that lets `@tetherto/wdk-wallet-btc` accounts swap and bridge bitcoin across chains via the Layerswap public API, using the `ISwidgeProtocol` interface from `@tetherto/wdk-wallet/protocols` (`quoteSwidge` / `swidge` / `getSwidgeStatus` / `getSupportedChains` / `getSupportedTokens`, plus the legacy `bridge`/`quoteBridge`).

`LayerswapProtocolBitcoin` is a thin subclass of `LayerswapSwidgeProtocol` from `@layerswap/wdk-protocol-swidge-layerswap-core`: the swidge flow, fee guards, status, discovery, legacy bridge surface, shared types and error contract are documented in the [core package](../layerswap-core) and shared by every sibling (`-evm`, `-solana`, `-ton`). This README only covers what is specific to Bitcoin.

## Install

```bash
npm install @layerswap/wdk-protocol-swidge-layerswap-bitcoin
```

`@tetherto/wdk-wallet` (`1.0.0-beta.25`) and `@tetherto/wdk-wallet-btc` (`1.0.0-beta.17`) are regular dependencies of this package, pinned to exact versions: while the WDK is in pre-release, new beta versions can ship breaking changes, so each release of this package is tested against one specific WDK version.

## Quick example

```js
import { WalletAccountBtc } from '@tetherto/wdk-wallet-btc'
import LayerswapBitcoin from '@layerswap/wdk-protocol-swidge-layerswap-bitcoin'

const account = new WalletAccountBtc('<seed phrase>', "0'/0/0", {
  network: 'bitcoin',
  client: { type: 'blockbook-http', clientConfig: { url: 'https://btc.example.com/api' } }
})

const protocol = new LayerswapBitcoin(account, {
  apiUrl: 'https://api.layerswap.io',
  bridgeMaxFee: 10_000n // max acceptable Layerswap fee in satoshis
})

// Quote (non-binding; no swap is created)
const quote = await protocol.quoteSwidge({
  fromToken: 'BTC',
  toToken: 'WBTC',
  toChain: 'ARBITRUM_MAINNET',
  fromTokenAmount: 100_000n, // 0.001 BTC, in satoshis
  slippage: 0.005 // 0.5%, as a decimal
})
// quote.toTokenAmount / quote.toTokenAmountMin / quote.fees / quote.estimatedDuration

// Execute (resolves once the source-chain deposit tx is broadcast)
const result = await protocol.swidge({
  fromToken: 'BTC',
  toToken: 'WBTC',
  toChain: 'ARBITRUM_MAINNET',
  recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
  fromTokenAmount: 100_000n
})
// result.id = Layerswap swap id, result.hash = bitcoin deposit txid

// Track the destination payout. The optional chain hints constrain the lookup: a swap
// whose source/destination network does not match them is reported as not found.
const { status, transactions } = await protocol.getSwidgeStatus(result.id, {
  fromChain: 'BITCOIN_MAINNET',
  toChain: 'ARBITRUM_MAINNET'
})

// Discovery (works without an account: new LayerswapBitcoin(undefined))
const chains = await protocol.getSupportedChains()
const tokens = await protocol.getSupportedTokens({ toChain: 'ARBITRUM_MAINNET' })
```

### Legacy bridge surface

The pre-swidge `bridge`/`quoteBridge` methods are kept as thin adapters over `swidge`/`quoteSwidge` for backwards compatibility:

```js
const { hash, fee, bridgeFee, swapId } = await protocol.bridge({
  targetChain: 'ARBITRUM_MAINNET',
  recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
  token: 'BTC',
  amount: 100_000n,
  slippage: '0.5' // legacy percent string ('0.5' = 0.5%)
})
// hash = deposit txid; track completion with protocol.getSwidgeStatus(swapId)
```

`bridge`/`quoteBridge` take `LayerswapBitcoinBridgeOptions` and return the core `LayerswapBridgeResult` (plus `swapId`); see the core package for the adapter semantics.

## Configuration and options

- `LayerswapBitcoinProtocolConfig` = core `LayerswapProtocolConfig` & `LayerswapSpecificBitcoinProtocolConfig`: adds `confirmationTarget` (target confirmation block count for the fee estimate, default `1`).
- `LayerswapBitcoinSwidgeOptions` / `LayerswapBitcoinBridgeOptions` = core `LayerswapSwidgeOptions` / `LayerswapBridgeOptions` & `LayerswapSpecificBitcoinOptions`: adds `feeRate` (sat/vB override of the estimate; also honoured by the legacy `bridge`).

## Errors

The error classes (re-exported from this package) and the shared throw contract are described in the core package. Bitcoin-specific cases:

| Error | When |
|---|---|
| `ValueError` | amount at or below the dust limit |
| `InvalidTokenError` | non-native (BRC-20, Runes, …) source token — thrown before any swap is created |
| `SwidgeError` (`INSUFFICIENT_BALANCE`) | no / insufficient UTXOs, incl. after the OP_RETURN overhead (`BridgeError` through `bridge`) |
| `ProviderError` | missing deposit address, malformed or oversized `call_data` memo, bitcoin client failures |
| `AccountRequiredError` / `DisposalError` | read-only account / disposed account (master node wiped) |

## Exports

Besides the default `LayerswapProtocolBitcoin` export, `index.js` exports the Bitcoin typedefs above plus `WalletAccountBtc` / `WalletAccountReadOnlyBtc`, and re-exports the shared public API of `@layerswap/wdk-protocol-swidge-layerswap-core/protocol` (WDK and core types, `LayerswapApiClient`, `LayerswapSwidgeProtocol`, the WDK error classes and their reason enums).

## Semantic notes

- Fee entries: Layerswap's included fees are in the source token (satoshis); the source-chain PSBT fee is a separate non-included 'network' entry, also in satoshis. In the legacy surface, `bridgeFee` = included fees, `fee` = the PSBT fee.
- `quoteSwidge`'s PSBT-fee entry is an approximation (1500 sats); `swidge()` reports the actual fee from coinselect.
- Source network is taken from the wallet's `config.network` (`bitcoin`, `regtest`, `testnet`) and mapped to `BITCOIN_MAINNET`/`BITCOIN_REGTEST`/`BITCOIN_TESTNET`; a `fromChain` (`sourceChain` in the legacy surface) must match it. Layerswap currently only lists `BITCOIN_MAINNET` in the public catalog; the testnet mappings throw a `ValueError` until the catalog gains them.
- `recipient` is required whenever the destination chain uses a different address format (VM type) than Bitcoin — which is every supported route today.
- Layerswap's `deposit_actions[].call_data` for Bitcoin is a numeric reference id that the package encodes as a hex string and stores in an `OP_RETURN` output — mirroring the Layerswap web app's `BitcoinWalletWithdraw` flow.

## How it builds the PSBT

The wallet's `account.sendTransaction(...)` does not expose an `OP_RETURN` seam, so the package builds a PSBT directly via `bitcoinjs-lib`:

1. List UTXOs via `account._client.listUnspent(address)` (Electrum/Blockbook transport set up by the wallet), and estimate the fee rate via `account._client.estimateFee(confirmationTarget)` unless `feeRate` is given.
2. Coin-select with `@bitcoinerlab/coinselect` factoring the OP_RETURN overhead.
3. Build a PSBT with:
   - Inputs from the selected UTXOs (BIP-84 `witnessUtxo` for native segwit; BIP-44 `nonWitnessUtxo` for legacy).
   - Output #0 — deposit address, value = swap amount in sats.
   - Output #1 — `OP_RETURN` carrying the hex-encoded `call_data` reference.
   - Output #2 — change to the sender if above the dust limit.
4. Sign each input via `psbt.signInputHD(idx, account._masterNode)` (the BIP-32 master node owned by the wallet).
5. Finalize, extract, broadcast via `account._client.broadcast(hex)`.

The protocol re-uses several of the wallet account's protected helpers (`_client`, `_masterNode`, `_account` BIP-32 node, `_network`, `_dustLimit`, `_path`, `_bip`, `_ensureConnected`, `_toBigInt`), verified against `@tetherto/wdk-wallet-btc@1.0.0-beta.17`. This mirrors the wallet's own `_buildSignedTransaction` flow but adds the `OP_RETURN` output between the deposit and the change, which the wallet's public API cannot inject.

## Development

```bash
pnpm install
pnpm -F @layerswap/wdk-protocol-swidge-layerswap-bitcoin lint
pnpm -F @layerswap/wdk-protocol-swidge-layerswap-bitcoin test
pnpm -F @layerswap/wdk-protocol-swidge-layerswap-bitcoin build:types
```

See [`AGENTS.md`](./AGENTS.md) for the per-package agent guide and the repo root [`AGENTS.md`](../../AGENTS.md) for monorepo-wide conventions.
