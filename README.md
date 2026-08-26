# wdk-protocol-swidge-layerswap

[![Powered by WDK](./docs/assets/built-with-wdk.svg)](https://docs.wdk.tether.io/)

Monorepo of [WDK](https://docs.wdk.tether.io/) Swidge (swap + bridge) modules for the [Layerswap](https://layerswap.io/) protocol.

Every protocol package extends `SwidgeProtocol` from `@tetherto/wdk-wallet/protocols` and implements the WDK Swidge interface — `quoteSwidge`, `swidge`, `getSwidgeStatus`, `getSupportedChains`, `getSupportedTokens` — which also provides the WDK swap-module (`swap`/`quoteSwap`) and bridge-module (`bridge`/`quoteBridge`) surfaces via the base class.

Each package lets WDK wallet accounts of a specific source-VM family drive a Layerswap swap via the Layerswap public HTTP API (v2):

1. `POST /api/v2/swaps` creates a swap; the response includes `deposit_actions[]` with the source-chain deposit `to_address` and, where the source VM needs it, encoded `call_data`.
2. The wallet signs and broadcasts that deposit on the source chain.
3. Layerswap detects the source deposit and broadcasts the destination-chain payout transaction to `destination_address`.

`GET /api/v2/networks` exposes the chain/token catalog, `GET /api/v2/quote` previews fees and receive amount, and `GET /api/v2/transaction_status` / `GET /api/v2/swaps/{id}` are used to poll progress.

## Packages

| Package | Source VM | Status |
| --- | --- | --- |
| [`@layerswap/wdk-protocol-swidge-layerswap-evm`](./packages/layerswap-evm) | EVM | ✅ |
| [`@layerswap/wdk-protocol-swidge-layerswap-solana`](./packages/layerswap-solana) | Solana | ✅ |
| [`@layerswap/wdk-protocol-swidge-layerswap-bitcoin`](./packages/layerswap-bitcoin) | Bitcoin (UTXO) | ✅ |
| [`@layerswap/wdk-protocol-swidge-layerswap-ton`](./packages/layerswap-ton) | TON | ✅ |

## Apps

| App | Purpose |
| --- | --- |
| [`@layerswap/wdk-swidge-layerswap-test-app`](./apps/test-app) | CLI for end-to-end smoke tests against a real Layerswap endpoint. Consumes the protocol via `workspace:*`. |

All packages implement `SwidgeProtocol` from `@tetherto/wdk-wallet/protocols` (>= 1.0.0-beta.17). The chain catalog inside each package is dynamic — fetched from `GET /api/v2/networks` and cached per `LayerswapApiClient` instance — so new Layerswap-supported chains within a VM family are picked up without code changes; `getSupportedChains()`/`getSupportedTokens()` expose it in the WDK vocabulary.

## Installation and usage

Install the protocol package that matches the source wallet's VM together with its WDK wallet package. Each implementation guide contains a complete account setup and executable usage example:

- [EVM installation and usage](./packages/layerswap-evm#installation)
- [Solana installation and usage](./packages/layerswap-solana#install)
- [Bitcoin installation and usage](./packages/layerswap-bitcoin#install)
- [TON installation and usage](./packages/layerswap-ton#install)

For example, an EVM source integration starts with:

```bash
npm install @layerswap/wdk-protocol-swidge-layerswap-evm \
            @tetherto/wdk-wallet @tetherto/wdk-wallet-evm
```

```js
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import LayerswapProtocolEvm from '@layerswap/wdk-protocol-swidge-layerswap-evm'

const wallet = new WalletManagerEvm(process.env.MNEMONIC, {
  provider: process.env.ETHEREUM_RPC_URL
})
const account = await wallet.getAccount(0)
const protocol = new LayerswapProtocolEvm(account, {
  apiKey: process.env.LAYERSWAP_API_KEY // optional
})

const options = {
  fromToken: 'USDC',
  toToken: 'USDC',
  toChain: 'ARBITRUM_MAINNET',
  recipient: '0x...',
  fromTokenAmount: 10_000_000n, // 10 USDC in base units
  slippage: 0.01                // 1%
}

const quote = await protocol.quoteSwidge(options)
const result = await protocol.swidge(options)
const status = await protocol.getSwidgeStatus(result.id) // 'action-required' | 'pending' | 'completed' | …
```

Use `getSupportedChains()` and `getSupportedTokens()` to discover live Layerswap route identifiers before quoting. Swidge is exact-in only, and cross-VM routes require an explicit destination `recipient`.

## Development

This is a [pnpm](https://pnpm.io/) workspace (version pinned in `package.json#packageManager`).

```bash
pnpm install             # installs + symlinks workspaces
pnpm run lint
pnpm test
pnpm run build:types
```

## License

[Apache-2.0](./LICENSE)
