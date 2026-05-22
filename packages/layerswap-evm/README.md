# @layerswap/wdk-protocol-bridge-layerswap-evm

WDK module that lets `@tetherto/wdk-wallet-evm` accounts bridge tokens across chains via the Layerswap public API.

Unlike on-chain bridges, Layerswap is HTTP-orchestrated:

1. `POST /api/v2/swaps` creates a swap and returns a deposit address plus encoded deposit calldata.
2. Your EOA signs and broadcasts the deposit on the source chain.
3. Layerswap performs the destination-chain payout off-chain.

## Installation

```bash
npm install @layerswap/wdk-protocol-bridge-layerswap-evm
```

## Usage

```javascript
import LayerswapProtocolEvm from '@layerswap/wdk-protocol-bridge-layerswap-evm'
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'

const wallet = new WalletManagerEvm('your mnemonic...', {
  provider: 'https://eth-mainnet.example/rpc'
})
const account = await wallet.getAccount()

// API key is optional — pass one for higher rate limits / partner attribution.
const protocol = new LayerswapProtocolEvm(account, {
  apiKey: process.env.LAYERSWAP_API_KEY // optional
})

// Quote
const { fee, bridgeFee } = await protocol.quoteBridge({
  targetChain: 'ARBITRUM_MAINNET',
  recipient: '0x...',
  token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC on ethereum
  amount: 100_000_000n // 100 USDC (6 decimals)
})

// Bridge (returns once the source-chain deposit tx is broadcast)
const { hash } = await protocol.bridge({
  targetChain: 'ARBITRUM_MAINNET',
  recipient: '0x...',
  token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  amount: 100_000_000n
})

// Optional: poll for destination-chain completion.
// The api client is exposed for this purpose.
const client = protocol.getApiClient()
```

## API Reference

### `new LayerswapProtocolEvm(account, config)`

- `account` — A WDK EVM wallet account (full or read-only). Read-only accounts may call `quoteBridge` but not `bridge`.
- `config.apiKey` *(optional)* — Layerswap API key, sent as `X-LS-APIKEY` when set. Use for higher rate limits / partner attribution.
- `config.apiUrl` — API base URL. Default: `https://api.layerswap.io`.
- `config.bridgeMaxFee` — Maximum acceptable swap fee, in **source-token base units**. If the live quote exceeds this, `bridge()` throws before broadcasting.
- `config.requestTimeoutMs` — HTTP timeout. Default: `30000`.

### `bridge(options): Promise<BridgeResult>`

Creates a Layerswap swap, broadcasts the source-chain deposit, and returns `{ hash, fee, bridgeFee }`. The hash is the source-chain deposit tx; the destination-chain payout proceeds asynchronously.

### `quoteBridge(options): Promise<Omit<BridgeResult, 'hash'>>`

Returns `{ fee, bridgeFee }` without creating a swap. `fee` is an approximation of source-chain gas (estimated via `quoteTransfer` for ERC-20s or `quoteSendTransaction` for native sends); `bridgeFee` is the Layerswap swap fee from the live quote.

### `BridgeOptions`

| field | type | required | notes |
| --- | --- | --- | --- |
| `targetChain` | `string` | ✓ | Layerswap destination network name. Uses the `<CHAIN>_<ENV>` uppercase convention: `'ETHEREUM_MAINNET'`, `'ARBITRUM_MAINNET'`, `'ARBITRUM_SEPOLIA'`, etc. Call `protocol.getApiClient().getNetworks()` for the live list. Matching is case-insensitive but use the canonical uppercase form. |
| `recipient` | `string` | ✓ | Destination-chain recipient address. |
| `token` | `string` | ✓ | Source token: contract address (`0x…`) OR Layerswap symbol (`'USDC'`). |
| `amount` | `number \| bigint` | ✓ | Source amount in base units. |
| `destinationToken` | `string` | | Destination token (address or symbol). Defaults to the source token's symbol. |
| `sourceChain` | `string` | | Override auto-detected source network name. |
| `refuel` | `boolean` | | Request a native-gas drop on the destination. |
| `slippage` | `string` | | Slippage tolerance percentage, e.g. `'0.5'`. |
| `referenceId` | `string` | | External reference id for the swap. |
| `refundAddress` | `string` | | Refund address if the swap fails after deposit. |

### `BridgeResult`

| field | type | notes |
| --- | --- | --- |
| `hash` | `string` | Source-chain deposit tx hash. |
| `fee` | `bigint` | Source-chain gas cost (in native base units). |
| `bridgeFee` | `bigint` | Layerswap swap fee in **source-token base units**. |

> **Semantic note.** `BridgeResult.bridgeFee` is documented in `@tetherto/wdk-wallet` as "native tokens paid to the bridge protocol". Layerswap deducts its fee from the bridged amount rather than charging native gas, so we return it in source-token units. Don't sum `fee + bridgeFee` — they are in different units.

## Development

```bash
npm install
npm test          # Jest with ESM
npm run lint      # standard
npm run build:types
```

## License

Apache-2.0
