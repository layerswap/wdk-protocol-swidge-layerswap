# @layerswap/wdk-protocol-swidge-layerswap-evm

WDK Swidge module that lets `@tetherto/wdk-wallet-evm` (and `wdk-wallet-evm-erc-4337`) accounts swap and bridge tokens across chains via the Layerswap public API, using the `ISwidgeProtocol` interface from `@tetherto/wdk-wallet/protocols`.

Unlike on-chain bridges, Layerswap is HTTP-orchestrated:

1. `POST /api/v2/swaps` creates a swap and returns a deposit address plus encoded deposit calldata.
2. Your account signs and broadcasts the deposit on the source chain.
3. Layerswap performs the destination-chain payout off-chain.

## Installation

```bash
npm install @layerswap/wdk-protocol-swidge-layerswap-evm
```

`@tetherto/wdk-wallet`, `@tetherto/wdk-wallet-evm` and `@tetherto/wdk-wallet-evm-erc-4337` are regular dependencies, pinned to exact versions: while the WDK is in pre-release, a new beta can contain breaking changes, so each release of this module is tied to the WDK versions it was tested against.

## Usage

```javascript
import LayerswapProtocolEvm from '@layerswap/wdk-protocol-swidge-layerswap-evm'
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

### `new LayerswapProtocolEvm(account, config?)`

- `account` — A WDK EVM wallet account (full or read-only, standard or ERC-4337), or `undefined` for discovery-only use. The source chain is detected through the provider the account was built with (`account._provider`), so every provider shape the wallet supports works as-is: an rpc url, an EIP-1193 provider, an ethers `Provider`, or a list of them (wrapped in the WDK fail-over provider).
- `config` — `LayerswapProtocolConfig` (API key/url, fee guards, timeout).

The protocol API (`quoteSwidge`, `swidge`, `getSwidgeStatus`, `getSupportedChains`, `getSupportedTokens`, `getTransactionStatus`, the legacy `bridge`/`quoteBridge`), its options, fee semantics and errors are shared by every Layerswap VM package and documented once in the [core package's Protocol API reference](../layerswap-core/README.md#protocol-api-reference). All of its types and error classes are re-exported from this package.

### EVM specifics

- **Deposit transaction** — ERC-20 sources send Layerswap's `call_data` to the token contract with `value: 0`; native sources send `amount_in_base_units` as `value` with empty calldata. Its gas is quoted with `quoteSendTransaction` before the fee guards run.
- **Quotes** — the source-chain gas entry is estimated with `quoteTransfer` (ERC-20) or `quoteSendTransaction` (native) and omitted when the estimate fails (e.g. unfunded account).
- **ERC-4337** — with a `WalletAccountEvmErc4337`, the deposit goes through the array form `sendTransaction([tx], config)`; `swidge(options, config)` / `bridge(options, config)` accept the wallet overrides (`LayerswapEvmSwidgeConfig` / `LayerswapEvmBridgeConfig`: paymaster token, sponsorship policy, native coins).
- **Errors** — a node `INSUFFICIENT_FUNDS` rejection becomes a `SwidgeError` with reason `INSUFFICIENT_BALANCE` (a `BridgeError` through `bridge`).

## Development

```bash
npm install
npm test          # Jest with ESM
npm run lint      # standard
npm run build:types
```

## License

Apache-2.0
