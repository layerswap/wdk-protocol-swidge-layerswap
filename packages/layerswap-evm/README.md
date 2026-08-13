# @layerswap/wdk-protocol-bridge-layerswap-evm

WDK Swidge module that lets `@tetherto/wdk-wallet-evm` (and `wdk-wallet-evm-erc-4337`) accounts swap and bridge tokens across chains via the Layerswap public API, using the `ISwidgeProtocol` interface from `@tetherto/wdk-wallet/protocols`.

Unlike on-chain bridges, Layerswap is HTTP-orchestrated:

1. `POST /api/v2/swaps` creates a swap and returns a deposit address plus encoded deposit calldata.
2. Your account signs and broadcasts the deposit on the source chain.
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

// Discover routes
const chains = await protocol.getSupportedChains()
const tokens = await protocol.getSupportedTokens({ toChain: 'ARBITRUM_MAINNET' })

// Quote (non-binding, no swap created)
const quote = await protocol.quoteSwidge({
  fromToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC on ethereum
  toToken: 'USDC',                                          // defaults to source symbol
  toChain: 'ARBITRUM_MAINNET',
  fromTokenAmount: 100_000_000n, // 100 USDC (6 decimals), exact-in
  slippage: 0.01                 // 1%
})
// quote.toTokenAmount, quote.toTokenAmountMin, quote.fees[], quote.estimatedDuration

// Execute (returns once the source-chain deposit tx is broadcast)
const result = await protocol.swidge({
  fromToken: 'USDC',
  toChain: 'ARBITRUM_MAINNET',
  recipient: '0x...',
  fromTokenAmount: 100_000_000n
}, {
  maxProtocolFeeBps: 100 // optional WDK fee guard
})

// Track the destination payout
const { status, transactions } = await protocol.getSwidgeStatus(result.id)
// status: 'action-required' | 'pending' | 'completed' | 'failed' | 'refund-pending' | …
```

## API Reference

### `new LayerswapProtocolEvm(account, config)`

- `account` — A WDK EVM wallet account (full or read-only), or `undefined` for discovery-only use. Read-only accounts may call `quoteSwidge`/discovery/status methods but not `swidge`.
- `config.apiKey` *(optional)* — Layerswap API key, sent as `X-LS-APIKEY` when set. Use for higher rate limits / partner attribution.
- `config.apiUrl` — API base URL. Default: `https://api.layerswap.io`.
- `config.maxNetworkFeeBps` / `config.maxProtocolFeeBps` — WDK swidge fee guards, in basis points of the input amount. Checked against fee entries denominated in the source token before broadcasting.
- `config.bridgeMaxFee` — Maximum acceptable Layerswap fee, in **source-token base units** (legacy guard; compared against the sum of `included` fees).
- `config.requestTimeoutMs` — HTTP timeout. Default: `30000`.

### `quoteSwidge(options): Promise<SwidgeQuote>`

Returns a non-binding quote: `{ fromTokenAmount, toTokenAmount, toTokenAmountMin, fees, estimatedDuration }`. When an account is bound, `fees` includes a non-included `'network'` entry with the estimated source-chain gas.

### `swidge(options, config?): Promise<SwidgeResult>`

Creates the Layerswap swap, enforces the fee guards, broadcasts the source-chain deposit, and returns `{ id, hash, fees, transactions, fromTokenAmount, toTokenAmount, toTokenAmountMin }`. `id` is the Layerswap swap id (use it with `getSwidgeStatus`); `hash` is the deposit tx hash. With an ERC-4337 account, `config` wallet overrides (paymaster, sponsorship, …) are forwarded to `sendTransaction`.

### `getSwidgeStatus(id): Promise<SwidgeStatusResult>`

Returns the WDK-mapped status plus the source/destination/refund transactions Layerswap has observed. The status is derived **transaction-first**: a completed output (payout) transaction means `'completed'` even if Layerswap's swap-level status lags behind; a refund transaction maps to `'refunded'`/`'refund-pending'`; an in-flight output means `'pending'`. Only without a decisive transaction does the swap-level status apply (`user_transfer_pending` → `'action-required'`, `ls_transfer_pending` → `'pending'`, terminal states 1:1).

### `getSupportedChains()` / `getSupportedTokens(options?)`

Expose the live Layerswap network catalog in the WDK shapes. Chain `id`s are Layerswap network names (`'ETHEREUM_MAINNET'`, …) — use them as `fromChain`/`toChain`.

### `SwidgeOptions` (Layerswap extensions included)

| field | type | required | notes |
| --- | --- | --- | --- |
| `fromToken` | `string` | ✓ | Source token: contract address (`0x…`) OR Layerswap symbol (`'USDC'`). |
| `fromTokenAmount` | `number \| bigint` | ✓ | Source amount in base units. **Exact-in only** — passing `toTokenAmount` throws. |
| `toChain` | `string \| number` | ✓ | Layerswap destination network name (`<CHAIN>_<ENV>` uppercase, e.g. `'ARBITRUM_MAINNET'`). Required: Layerswap does not support same-chain swaps. |
| `toToken` | `string` | | Destination token (address or symbol). Defaults to the source token's symbol. |
| `recipient` | `string` | | Destination recipient. Defaults to the account address when source and destination share the same VM type; required otherwise. |
| `fromChain` | `string \| number` | | Layerswap source network name. Defaults to the connected provider's chain. |
| `slippage` | `number` | | Decimal, e.g. `0.01` for 1%. |
| `minAmountOut` | `number \| bigint` | | Minimum acceptable destination amount (base units); checked against the quoted minimum before broadcasting. |
| `refundAddress` | `string` | | Refund address if the swap fails after deposit. |
| `refuel` | `boolean` | | Request a native-gas drop on the destination. |
| `referenceId` | `string` | | External reference id for the swap. |

> **Fee semantics.** Layerswap deducts its fees from the source amount: the `'protocol'` (service) and `'network'` (destination) entries are denominated in the **source token** with `included: true`. Source-chain gas is a separate non-included `'network'` entry in the **native token**. Never sum amounts across fee entries with different `token`s.

## Legacy bridge surface

The pre-swidge interface is kept as a thin adapter over `swidge`:

```javascript
const { fee, bridgeFee } = await protocol.quoteBridge({ targetChain, recipient, token, amount })
const { hash, swapId } = await protocol.bridge({ targetChain, recipient, token, amount })
```

`hash` is the source-chain deposit tx hash, `fee` the native-unit gas cost, `bridgeFee` the Layerswap fee in **source-token base units**, and `swapId` the Layerswap swap id. Legacy `slippage` remains a percent string (`'0.5'`). The base class additionally derives `swap`/`quoteSwap`, but Layerswap cannot fulfil same-chain swaps, so those always throw.

## Development

```bash
npm install
npm test          # Jest with ESM
npm run lint      # standard
npm run build:types
```

## License

Apache-2.0
