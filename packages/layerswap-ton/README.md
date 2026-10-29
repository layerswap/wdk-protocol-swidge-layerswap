# @layerswap/wdk-protocol-swidge-layerswap-ton

WDK module that lets `@tetherto/wdk-wallet-ton` accounts swap and bridge tokens across chains via the Layerswap public API, using the `ISwidgeProtocol` interface from `@tetherto/wdk-wallet/protocols`.

`LayerswapProtocolTon` is a thin subclass of `LayerswapSwidgeProtocol` from [`@layerswap/wdk-protocol-swidge-layerswap-core`](../layerswap-core): the whole swidge flow (`quoteSwidge` / `swidge` / `getSwidgeStatus` / `getSupportedChains` / `getSupportedTokens` / `getTransactionStatus`, the legacy `bridge` / `quoteBridge` adapters, the fee guards, the types and the error contract) lives there and is shared with the evm, solana and bitcoin packages. This package only implements what is specific to TON: the default source network, the gas approximations and the deposit message. See the core README for the shared API reference.

## Install

```bash
npm install @layerswap/wdk-protocol-swidge-layerswap-ton
```

`@tetherto/wdk-wallet` (`1.0.0-beta.25`), `@tetherto/wdk-wallet-ton` (`1.0.0-beta.17`) and `@ton/ton` (`16.2.4`) are regular dependencies of this package, pinned to exact versions: the WDK is still in pre-release, and new beta versions may include breaking changes. Build your accounts with the same `@tetherto/wdk-wallet-ton` version to avoid duplicate copies of `@ton/core` (whose `Cell` objects are checked with `instanceof`).

## Quick example

```js
import { WalletAccountTon } from '@tetherto/wdk-wallet-ton'
import LayerswapTon from '@layerswap/wdk-protocol-swidge-layerswap-ton'

const account = new WalletAccountTon('<seed phrase>', "0'/0/0", {
  tonClient: { url: 'https://toncenter.com/api/v2/jsonRPC' }
})

const swidge = new LayerswapTon(account, {
  apiUrl: 'https://api.layerswap.io',
  maxProtocolFeeBps: 100,        // WDK guard: max protocol fee, in bps of the input amount
  bridgeMaxFee: 1_000_000n       // max acceptable Layerswap fee in source-token base units
})

// 1. Quote (non-binding, no swap is created).
const quote = await swidge.quoteSwidge({
  fromToken: 'USDT',             // jetton master address OR Layerswap symbol
  toToken: 'USDT',
  toChain: 'ARBITRUM_MAINNET',   // required — Layerswap does not support same-chain swaps
  fromTokenAmount: 10_000_000n,  // 10 USDT, in base units (USDT-Jetton has 6 decimals)
  slippage: 0.005                // 0.5%, as a decimal
})
console.log(quote.toTokenAmountMin, quote.fees)

// 2. Execute: creates the swap and broadcasts the TON deposit message.
const result = await swidge.swidge({
  fromToken: 'USDT',
  toToken: 'USDT',
  toChain: 'ARBITRUM_MAINNET',
  recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
  fromTokenAmount: 10_000_000n
})
console.log(result.id, result.hash) // Layerswap swap id + TON external-message hash

// 3. Track the destination payout (completes asynchronously). The optional chain hints
//    constrain the lookup: a swap on other chains is reported as not found.
const { status, transactions } = await swidge.getSwidgeStatus(result.id, { fromChain: 'TON_MAINNET' })
```

Chain/token discovery works without an account:

```js
const discovery = new LayerswapTon()
const chains = await discovery.getSupportedChains()          // ids are Layerswap network names
const tokens = await discovery.getSupportedTokens({ toChain: 'TON_MAINNET' })
```

## Public API

The entry point re-exports `@layerswap/wdk-protocol-swidge-layerswap-core/protocol` — every shared type (`LayerswapProtocolConfig`, `LayerswapSwidgeOptions`, `LayerswapBridgeOptions`, `LayerswapBridgeResult`, `GetTransactionStatusOptions`, the WDK swidge types, …), `LayerswapApiClient` (returned by `getApiClient()`), `LayerswapSwidgeProtocol` and the WDK error classes the methods throw — plus the `@tetherto/wdk-wallet-ton` account types:

```js
import LayerswapTon, { SwidgeError, SwidgeErrorReason, BridgeError, MaximumFeeExceededError } from '@layerswap/wdk-protocol-swidge-layerswap-ton'
```

The shared error contract is documented in the core README. TON-specific error mapping:

| Error | Thrown when |
|---|---|
| `ProviderRequiredError` | The wallet account is not connected to ton center. |
| `MaximumFeeExceededError` | The deposit message exceeds the account's `transactionMaxFee` (besides the shared `bridgeMaxFee` / bps guards). |
| `ProviderError` | Layerswap returns a deposit action without `to_address` or with a malformed TON address, or ton center fails (e.g. resolving the jetton wallet). |
| `DisposalError` | The account reports `disposed`, or its private key has been erased by `WalletAccountTon.dispose()` (`keyPair.privateKey === null`). |

`@tetherto/wdk-wallet-ton` throws plain `Error`s, so the "not connected to ton center" and "exceeded maximum fee" failures are mapped by message; any other wallet failure becomes a `ProviderError`.

## Semantic notes

- The source-chain gas entry is a non-included 'network' fee in **nanotons**. `quoteSwidge` reports it as an approximation (~0.01 TON native, ~0.05 TON jetton — the wallet only reports the actual gas after broadcasting); `swidge` reports the actual gas returned by `sendTransaction`. For the same reason, the `maxNetworkFeeBps`/`maxProtocolFeeBps` guards are enforced before broadcasting against the included Layerswap fees only.
- The source network is detected from the zero-state block of the ton center the wallet account is connected to (`TON_MAINNET` or `TON_TESTNET`); without an account it defaults to `TON_MAINNET`. A `fromChain` (legacy `sourceChain`) must match the detected network.
- `result.hash` is the wallet's body hash of the deposit message. `getTransactionStatus(result.hash)` traces it through ton center to the message Layerswap tracks (the jetton `transfer_notification`, or the native transfer).
- Layerswap's `deposit_actions[].call_data` for TON is a JSON string `{"comment": "...", "amount": "..."}` containing a reference comment and the amount in base units; without them nothing is sent (`ProviderError`). The package mirrors the Layerswap web app's `TonWalletWithdraw` flow:
  - **Native TON** — build a cell with the comment as `storeStringTail`, send it to the deposit address with the `call_data` amount.
  - **Jetton** — resolve the source's jetton wallet address via the jetton master contract, build a jetton-transfer body (opcode `0x0f8a7ea5`) with the comment in the forward payload, send to the jetton wallet with a ~0.045 TON gas budget.

## Development

```bash
pnpm install
pnpm -F @layerswap/wdk-protocol-swidge-layerswap-ton lint
pnpm -F @layerswap/wdk-protocol-swidge-layerswap-ton test
pnpm -F @layerswap/wdk-protocol-swidge-layerswap-ton build:types
```

See [`AGENTS.md`](./AGENTS.md) for the per-package agent guide and the repo root [`AGENTS.md`](../../AGENTS.md) for monorepo-wide conventions.
