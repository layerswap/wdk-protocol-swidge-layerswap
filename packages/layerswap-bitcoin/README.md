# @layerswap/wdk-protocol-bridge-layerswap-bitcoin

WDK module that lets `@tetherto/wdk-wallet-btc` accounts bridge bitcoin across chains via the Layerswap public API. Implements `BridgeProtocol` from `@tetherto/wdk-wallet/protocols`.

Sibling of `@layerswap/wdk-protocol-bridge-layerswap-evm`, `@layerswap/wdk-protocol-bridge-layerswap-solana`, `@layerswap/wdk-protocol-bridge-layerswap-tron`, and `@layerswap/wdk-protocol-bridge-layerswap-ton`. Shares HTTP/network/decimal plumbing via `@layerswap/wdk-protocol-bridge-layerswap-core`.

## Install

```bash
npm install @layerswap/wdk-protocol-bridge-layerswap-bitcoin \
            @tetherto/wdk-wallet @tetherto/wdk-wallet-btc
```

## Quick example

```js
import { WalletAccountBtc } from '@tetherto/wdk-wallet-btc'
import LayerswapBitcoin from '@layerswap/wdk-protocol-bridge-layerswap-bitcoin'

const account = new WalletAccountBtc('<seed phrase>', "0'/0/0", {
  network: 'bitcoin',
  client: { type: 'blockbook-http', clientConfig: { url: 'https://btc.example.com/api' } }
})

const bridge = new LayerswapBitcoin(account, {
  apiUrl: 'https://api.layerswap.io',
  bridgeMaxFee: 10_000n // max acceptable Layerswap fee in satoshis
})

const { hash, fee, bridgeFee, swapId } = await bridge.bridge({
  targetChain: 'ARBITRUM_MAINNET',
  recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
  token: 'BTC',
  amount: 100_000n // 0.001 BTC, in satoshis
})

// Poll completion via the Layerswap API:
const client = bridge.getApiClient()
const status = await client.getSwap(swapId)
```

## Semantic notes

- `BridgeResult.bridgeFee` is in **source-token base units** (satoshis for BTC). Layerswap deducts its fee from the bridged amount.
- Source network is taken from the wallet's `config.network` (`bitcoin`, `regtest`, `testnet`) and mapped to `BITCOIN_MAINNET`. Layerswap currently only lists `BITCOIN_MAINNET` in the public catalog; testnets are accepted in the protocol code but will error at Layerswap's API layer until the catalog gains them.
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
pnpm -F @layerswap/wdk-protocol-bridge-layerswap-bitcoin lint
pnpm -F @layerswap/wdk-protocol-bridge-layerswap-bitcoin test
pnpm -F @layerswap/wdk-protocol-bridge-layerswap-bitcoin build:types
```

See [`AGENTS.md`](./AGENTS.md) for the per-package agent guide and the repo root [`AGENTS.md`](../../AGENTS.md) for monorepo-wide conventions.
