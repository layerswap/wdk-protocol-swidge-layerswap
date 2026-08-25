# @layerswap/wdk-protocol-swidge-layerswap-bitcoin

WDK module that lets `@tetherto/wdk-wallet-btc` accounts swap and bridge bitcoin across chains via the Layerswap public API. Implements `SwidgeProtocol` from `@tetherto/wdk-wallet/protocols` (`quoteSwidge` / `swidge` / `getSwidgeStatus` / `getSupportedChains` / `getSupportedTokens`), which also provides the WDK `swap`/`bridge` module surfaces.

Sibling of `@layerswap/wdk-protocol-swidge-layerswap-evm`, `@layerswap/wdk-protocol-swidge-layerswap-solana`, `@layerswap/wdk-protocol-swidge-layerswap-tron`, and `@layerswap/wdk-protocol-swidge-layerswap-ton`. Shares HTTP/network/decimal plumbing via `@layerswap/wdk-protocol-swidge-layerswap-core`.

## Install

```bash
npm install @layerswap/wdk-protocol-swidge-layerswap-bitcoin \
            @tetherto/wdk-wallet @tetherto/wdk-wallet-btc
```

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

// Track the destination payout
const { status, transactions } = await protocol.getSwidgeStatus(result.id)

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

## Semantic notes

- Layerswap only supports **exact-in** operations: pass `fromTokenAmount`; passing `toTokenAmount` throws. Same-chain swaps are not supported: `toChain` is required and must differ from the source chain.
- Fee entries: Layerswap deducts its fees from the source amount, so the 'protocol' and Layerswap-charged 'network' entries are denominated in the **source token** (satoshis) with `included: true`. The source-chain PSBT fee is a separate non-included 'network' entry (satoshis). Never sum amounts across fee entries with different `token` values. In the legacy surface, `bridgeFee` = included fees, `fee` = the PSBT fee.
- `quoteSwidge`'s PSBT-fee entry is an approximation (1500 sats); `swidge()` reports the actual fee from coinselect.
- Source network is taken from the wallet's `config.network` (`bitcoin`, `regtest`, `testnet`) and mapped to `BITCOIN_MAINNET`/`BITCOIN_REGTEST`/`BITCOIN_TESTNET`; override it with `fromChain` (`sourceChain` in the legacy surface). Layerswap currently only lists `BITCOIN_MAINNET` in the public catalog; testnets are accepted in the protocol code but will error at Layerswap's API layer until the catalog gains them.
- `recipient` is required whenever the destination chain uses a different address format (VM type) than Bitcoin — which is every supported route today.
- Layerswap's `deposit_actions[].call_data` for Bitcoin is a numeric reference id that the package encodes as a hex string and stores in an `OP_RETURN` output — mirroring the Layerswap web app's `BitcoinWalletWithdraw` flow.
- Bitcoin has no token support on Layerswap (no BRC-20 / Runes). The package will throw if `sourceToken.contract` is set on the resolved token.

## How it builds the PSBT

The wallet's `account.sendTransaction(...)` does not expose an `OP_RETURN` seam, so the package builds a PSBT directly via `bitcoinjs-lib`:

1. List UTXOs via `account._client.listUnspent(address)` (Electrum/Blockbook transport set up by the wallet).
2. Coin-select with `@bitcoinerlab/coinselect` factoring the OP_RETURN overhead.
3. Build a PSBT with:
   - Inputs from the selected UTXOs (BIP-84 `witnessUtxo` for native segwit; BIP-44 `nonWitnessUtxo` for legacy).
   - Output #0 — deposit address, value = swap amount in sats.
   - Output #1 — `OP_RETURN` carrying the hex-encoded `call_data` reference.
   - Output #2 — change to the sender if above the dust limit.
4. Sign each input via `psbt.signInputHD(idx, account._masterNode)` (the BIP-32 master node owned by the wallet).
5. Finalize, extract, broadcast via `account._client.broadcast(hex)`.

The protocol re-uses several of the wallet account's protected helpers (`_client`, `_masterNode`, `_account` BIP-32 node, `_network`, `_dustLimit`, `_path`, `_bip`, `_ensureConnected`, `_toBigInt`). This mirrors the wallet's own `_buildSignedTransaction` flow but adds the `OP_RETURN` output between the deposit and the change, which the wallet's public API cannot inject.

## Development

```bash
pnpm install
pnpm -F @layerswap/wdk-protocol-swidge-layerswap-bitcoin lint
pnpm -F @layerswap/wdk-protocol-swidge-layerswap-bitcoin test
pnpm -F @layerswap/wdk-protocol-swidge-layerswap-bitcoin build:types
```

See [`AGENTS.md`](./AGENTS.md) for the per-package agent guide and the repo root [`AGENTS.md`](../../AGENTS.md) for monorepo-wide conventions.
