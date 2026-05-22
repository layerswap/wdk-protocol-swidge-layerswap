# @layerswap/wdk-protocol-bridge-layerswap-solana

WDK module that lets `@tetherto/wdk-wallet-solana` accounts bridge tokens across chains via the Layerswap public API. Implements `BridgeProtocol` from `@tetherto/wdk-wallet/protocols`.

Sibling of `@layerswap/wdk-protocol-bridge-layerswap-evm`. Shares HTTP/network/decimal plumbing via `@layerswap/wdk-protocol-bridge-layerswap-core`.

## Install

```bash
npm install @layerswap/wdk-protocol-bridge-layerswap-solana \
            @tetherto/wdk-wallet @tetherto/wdk-wallet-solana
```

## Quick example

```js
import WalletManagerSolana from '@tetherto/wdk-wallet-solana'
import LayerswapSolana from '@layerswap/wdk-protocol-bridge-layerswap-solana'

const wallet = new WalletManagerSolana({ provider: 'https://api.mainnet-beta.solana.com' })
const account = await wallet.account('<seed phrase>', "0'/0'/0'")

const bridge = new LayerswapSolana(account, {
  apiUrl: 'https://api.layerswap.io',
  bridgeMaxFee: 1_000_000n // max acceptable Layerswap fee in source-token base units
})

const { hash, fee, bridgeFee, swapId } = await bridge.bridge({
  targetChain: 'ARBITRUM_MAINNET',
  recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
  token: 'USDC',                 // SPL mint symbol or base58 mint address
  amount: 10_000_000n            // 10 USDC, in base units (USDC has 6 decimals)
})

// Poll completion via the Layerswap API:
const client = bridge.getApiClient()
const status = await client.getSwap(swapId)
```

## Semantic notes

- `BridgeResult.bridgeFee` is in **source-token base units** (Layerswap deducts its fee from the bridged amount, not as native gas). The base WDK type documents it as native — Layerswap diverges. `bridgeMaxFee` is compared against `bridgeFee` only.
- Source network detection uses the connected RPC's genesis hash → known network name table (`SOLANA_MAINNET`, `SOLANA_DEVNET`, `SOLANA_TESTNET`). Pass `sourceChain: 'SOLANA_<...>'` in the bridge options to override.
- `call_data` returned by Layerswap is treated as a base64-encoded legacy Solana `Transaction` wire format and broadcast as-is (matches Layerswap's own web app code path). The package uses `@solana/web3.js` to deserialise and broadcast — the `@tetherto/wdk-wallet-solana` account only provides identity (`getAddress`, `keyPair`).

## Development

```bash
pnpm install
pnpm -F @layerswap/wdk-protocol-bridge-layerswap-solana lint
pnpm -F @layerswap/wdk-protocol-bridge-layerswap-solana test
pnpm -F @layerswap/wdk-protocol-bridge-layerswap-solana build:types
```

See [`AGENTS.md`](./AGENTS.md) for the per-package agent guide and the repo root [`AGENTS.md`](../../AGENTS.md) for monorepo-wide conventions.
