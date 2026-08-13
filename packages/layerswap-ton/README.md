# @layerswap/wdk-protocol-bridge-layerswap-ton

WDK module that lets `@tetherto/wdk-wallet-ton` accounts swap and bridge tokens across chains via the Layerswap public API. Implements `SwidgeProtocol` from `@tetherto/wdk-wallet/protocols` (`quoteSwidge` / `swidge` / `getSwidgeStatus` / `getSupportedChains` / `getSupportedTokens`).

Sibling of `@layerswap/wdk-protocol-bridge-layerswap-evm`, `@layerswap/wdk-protocol-bridge-layerswap-solana` and `@layerswap/wdk-protocol-bridge-layerswap-tron`. Shares HTTP/network/decimal plumbing via `@layerswap/wdk-protocol-bridge-layerswap-core`.

## Install

```bash
npm install @layerswap/wdk-protocol-bridge-layerswap-ton \
            @tetherto/wdk-wallet @tetherto/wdk-wallet-ton
```

## Quick example

```js
import { WalletAccountTon } from '@tetherto/wdk-wallet-ton'
import LayerswapTon from '@layerswap/wdk-protocol-bridge-layerswap-ton'

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

// 3. Track the destination payout (completes asynchronously).
const { status, transactions } = await swidge.getSwidgeStatus(result.id)
```

Chain/token discovery works without an account:

```js
const discovery = new LayerswapTon()
const chains = await discovery.getSupportedChains()          // ids are Layerswap network names
const tokens = await discovery.getSupportedTokens({ toChain: 'TON_MAINNET' })
```

## Legacy bridge surface

The pre-swidge `bridge()` / `quoteBridge()` methods of this package are kept as thin adapters over `swidge()` / `quoteSwidge()`:

```js
const { hash, fee, bridgeFee, swapId } = await swidge.bridge({
  targetChain: 'ARBITRUM_MAINNET',
  recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
  token: 'USDT',
  amount: 10_000_000n,
  slippage: '0.5'                // legacy: percent string, not a decimal
})
```

`hash` is the deposit-message hash, `swapId` the Layerswap swap id, `fee` the source-chain gas (nanotons) and `bridgeFee` the total Layerswap fee (source-token base units).

## Semantic notes

- Fee entries are itemised (`SwidgeFee[]`): Layerswap's 'protocol' and destination 'network' fees are deducted from the source amount, denominated in the **source token**, and flagged `included: true`. The source-chain gas is a separate non-included 'network' fee in **nanotons**. Never sum amounts across entries with different `token`s.
- `quoteSwidge` reports the gas as an approximation (~0.01 TON native, ~0.05 TON jetton — the wallet only reports the actual gas after broadcasting); `swidge` reports the actual gas from `sendTransaction`. For the same reason, the `maxNetworkFeeBps`/`maxProtocolFeeBps` guards are enforced before broadcasting against the included Layerswap fees.
- Layerswap only supports **exact-in** operations: pass `fromTokenAmount`; `toTokenAmount` throws.
- `toChain` is required — Layerswap does not support same-chain swaps.
- `recipient` defaults to the account's own address only when source and destination chains share the same address format (both `type: 'ton'`); otherwise it is required.
- The source network defaults to `TON_MAINNET` — at the time of writing Layerswap only lists TON mainnet, and TON doesn't expose a stable network id the way EVM `chainId` does. Pass `fromChain: 'TON_<...>'` (or legacy `sourceChain`) to override if Layerswap adds testnet support.
- Layerswap's `deposit_actions[].call_data` for TON is a JSON string `{"comment": "...", "amount": "..."}` containing a reference comment and the jetton amount in base units. The package mirrors the Layerswap web app's `TonWalletWithdraw` flow:
  - **Native TON** — build a cell with the comment as `storeStringTail`, send to the deposit address with the full TON value.
  - **Jetton** — resolve the source's jetton wallet address via the jetton master contract, build a jetton-transfer body (opcode `0x0f8a7ea5`) with the comment in the forward payload, send to the jetton wallet with a ~0.045 TON gas budget.

## Development

```bash
pnpm install
pnpm -F @layerswap/wdk-protocol-bridge-layerswap-ton lint
pnpm -F @layerswap/wdk-protocol-bridge-layerswap-ton test
pnpm -F @layerswap/wdk-protocol-bridge-layerswap-ton build:types
```

See [`AGENTS.md`](./AGENTS.md) for the per-package agent guide and the repo root [`AGENTS.md`](../../AGENTS.md) for monorepo-wide conventions.
