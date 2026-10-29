# @layerswap/wdk-protocol-swidge-layerswap-solana

WDK module that lets `@tetherto/wdk-wallet-solana` accounts swap and bridge tokens across chains via the Layerswap public API. Implements `SwidgeProtocol` from `@tetherto/wdk-wallet/protocols`: `quoteSwidge` / `swidge` / `getSwidgeStatus` / `getSupportedChains` / `getSupportedTokens`.

`LayerswapProtocolSolana` is a thin subclass of `LayerswapSwidgeProtocol` from `@layerswap/wdk-protocol-swidge-layerswap-core`, which implements the whole chain-agnostic swidge flow (quotes, fee guards, swap creation, status, discovery, the legacy `bridge`/`quoteBridge` adapters) and the WDK error contract. This package only adds the Solana specifics listed below. Its entry point re-exports the shared public API (types, `LayerswapApiClient`, `LayerswapSwidgeProtocol`, WDK error classes) from `@layerswap/wdk-protocol-swidge-layerswap-core/protocol`.

## Install

```bash
npm install @layerswap/wdk-protocol-swidge-layerswap-solana
```

`@tetherto/wdk-wallet` and `@tetherto/wdk-wallet-solana` are regular dependencies of this package, pinned to exact versions (the WDK is still in pre-release, and beta versions may ship breaking changes).

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

// Optional chain hints constrain the lookup: a swap on other chains is reported as not found.
await protocol.getSwidgeStatus(result.id, { fromChain: 'SOLANA_MAINNET', toChain: 'ARBITRUM_MAINNET' })

// Discovery (also works without an account: new LayerswapSolana(undefined))
const chains = await protocol.getSupportedChains()
const tokens = await protocol.getSupportedTokens({ toChain: 'SOLANA_MAINNET' })
```

The legacy `bridge` / `quoteBridge` surface, the semantics of fee entries, `getSwidgeStatus` chain hints and the full error table are documented once in the [core package README](../layerswap-core/README.md) — they are identical for every VM package.

## Solana specifics

- **Source cluster detection:** the genesis hash reported by the account's rpc client is mapped to a Layerswap network (`SOLANA_MAINNET`, `SOLANA_DEVNET`, `SOLANA_TESTNET`). The rpc client is the one the wallet account was built with (`account._rpc`), so every provider shape the wallet supports (rpc url, rpc client, or a fail-over list of them) works as-is. A `fromChain` (legacy: `sourceChain`) must match the rpc cluster; for an rpc on another svm chain Layerswap lists (e.g. Eclipse), whose genesis hash is not known, pass its `fromChain`. Without it an unknown genesis hash throws a `ValueError`; a missing rpc throws a `ProviderRequiredError`.
- **Deposit transaction:** Layerswap's `call_data` is a base64-encoded, unsigned legacy Solana transaction. It is quoted, signed and broadcast through the wallet account (`account.quoteSendTransaction(callData)` / `account.sendTransaction(callData)`), so the wallet's `transactionMaxFee` option is honoured too. Missing or malformed `call_data` throws a `ProviderError`.
- **Fees:** the source-chain gas entry is in **lamports** (`token: 'SOL'`). Quotes approximate it with the 5000-lamport per-signature fee; `swidge()` reports the fee quoted by the wallet for the actual deposit transaction.
- **Accounts:** read-only accounts (no `keyPair` / `sendTransaction`) get an `AccountRequiredError`; a disposed `WalletAccountSolana` (its `keyPair.privateKey` erased to `null`) gets a `DisposalError`.

## Development

```bash
pnpm install
pnpm -F @layerswap/wdk-protocol-swidge-layerswap-solana lint
pnpm -F @layerswap/wdk-protocol-swidge-layerswap-solana test
pnpm -F @layerswap/wdk-protocol-swidge-layerswap-solana build:types
```

See [`AGENTS.md`](./AGENTS.md) for the per-package agent guide and the repo root [`AGENTS.md`](../../AGENTS.md) for monorepo-wide conventions.
