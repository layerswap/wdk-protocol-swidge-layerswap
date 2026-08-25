# @layerswap/wdk-protocol-swidge-layerswap-solana

WDK module that lets `@tetherto/wdk-wallet-solana` accounts swap and bridge tokens across chains via the Layerswap public API. Implements `SwidgeProtocol` from `@tetherto/wdk-wallet/protocols`: `quoteSwidge` / `swidge` / `getSwidgeStatus` / `getSupportedChains` / `getSupportedTokens`.

Sibling of `@layerswap/wdk-protocol-swidge-layerswap-evm`. Shares HTTP/network/decimal plumbing via `@layerswap/wdk-protocol-swidge-layerswap-core`.

## Install

```bash
npm install @layerswap/wdk-protocol-swidge-layerswap-solana \
            @tetherto/wdk-wallet @tetherto/wdk-wallet-solana
```

## Quick example

```js
import WalletManagerSolana from '@tetherto/wdk-wallet-solana'
import LayerswapSolana from '@layerswap/wdk-protocol-swidge-layerswap-solana'

const wallet = new WalletManagerSolana({ provider: 'https://api.mainnet-beta.solana.com' })
const account = await wallet.account('<seed phrase>', "0'/0'/0'")

const protocol = new LayerswapSolana(account, {
  apiUrl: 'https://api.layerswap.io',
  bridgeMaxFee: 1_000_000n // max acceptable Layerswap fee in source-token base units
})

// 1. Quote (non-binding, no swap is created)
const quote = await protocol.quoteSwidge({
  fromToken: 'USDC',             // SPL mint symbol or base58 mint address
  toToken: 'USDC',
  toChain: 'ARBITRUM_MAINNET',
  fromTokenAmount: 10_000_000n,  // 10 USDC, in base units (USDC has 6 decimals)
  slippage: 0.005                // 0.5%, as a decimal
})
// quote.toTokenAmount / quote.toTokenAmountMin / quote.fees / quote.estimatedDuration

// 2. Execute (resolves once the source-chain deposit tx is broadcast)
const result = await protocol.swidge({
  fromToken: 'USDC',
  toToken: 'USDC',
  toChain: 'ARBITRUM_MAINNET',
  recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
  fromTokenAmount: 10_000_000n
})
// result.id (Layerswap swap id), result.hash (deposit signature), result.fees

// 3. Track the destination payout
const status = await protocol.getSwidgeStatus(result.id)
// status.status: 'pending' | 'completed' | 'failed' | ... — plus observed transactions

// Discovery (also works without an account: new LayerswapSolana(undefined))
const chains = await protocol.getSupportedChains()
const tokens = await protocol.getSupportedTokens({ toChain: 'SOLANA_MAINNET' })
```

### Legacy bridge surface

The pre-swidge `bridge` / `quoteBridge` methods are kept as thin adapters over `swidge` / `quoteSwidge` for backwards compatibility:

```js
const { hash, fee, bridgeFee, swapId } = await protocol.bridge({
  targetChain: 'ARBITRUM_MAINNET',
  recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
  token: 'USDC',
  amount: 10_000_000n,
  slippage: '0.5' // legacy: percent string (swidge takes a decimal, 0.005)
})
```

`fee` sums the non-included fee entries (source-chain gas, lamports); `bridgeFee` sums the included entries (Layerswap's fee, source-token base units); `swapId` is the Layerswap swap id for `getSwidgeStatus`.

## Semantic notes

- Layerswap is HTTP-orchestrated and exact-in only: `swidge()` rejects `toTokenAmount` (exact-out) options, and same-chain swaps are not supported (`toChain` is required and must differ from the source chain).
- Fee entries: Layerswap deducts its fees from the source amount, so the 'protocol' and Layerswap 'network' entries are denominated in the **source token** with `included: true`. Source-chain gas is a separate non-included 'network' entry in **SOL (lamports)**. Never sum amounts across entries with different `token` values. `bridgeMaxFee` is compared against the included fees only; the WDK `maxNetworkFeeBps`/`maxProtocolFeeBps` guards are also enforced.
- Source network detection uses the connected RPC's genesis hash → known network name table (`SOLANA_MAINNET`, `SOLANA_DEVNET`, `SOLANA_TESTNET`). Pass `fromChain: 'SOLANA_<...>'` in the swidge options (legacy: `sourceChain`) to override.
- `recipient` defaults to the account's own address only when the destination network has the same address format (VM type) as Solana; cross-VM destinations (e.g. EVM chains) require an explicit `recipient`.
- `call_data` returned by Layerswap is treated as a base64-encoded legacy Solana `Transaction` wire format and broadcast as-is (matches Layerswap's own web app code path). The package uses `@solana/web3.js` to deserialise and broadcast — the `@tetherto/wdk-wallet-solana` account only provides identity (`getAddress`, `keyPair`).

## Development

```bash
pnpm install
pnpm -F @layerswap/wdk-protocol-swidge-layerswap-solana lint
pnpm -F @layerswap/wdk-protocol-swidge-layerswap-solana test
pnpm -F @layerswap/wdk-protocol-swidge-layerswap-solana build:types
```

See [`AGENTS.md`](./AGENTS.md) for the per-package agent guide and the repo root [`AGENTS.md`](../../AGENTS.md) for monorepo-wide conventions.
