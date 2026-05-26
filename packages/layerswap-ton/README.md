# @layerswap/wdk-protocol-bridge-layerswap-ton

WDK module that lets `@tetherto/wdk-wallet-ton` accounts bridge tokens across chains via the Layerswap public API. Implements `BridgeProtocol` from `@tetherto/wdk-wallet/protocols`.

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

const bridge = new LayerswapTon(account, {
  apiUrl: 'https://api.layerswap.io',
  bridgeMaxFee: 1_000_000n // max acceptable Layerswap fee in source-token base units
})

const { hash, fee, bridgeFee, swapId } = await bridge.bridge({
  targetChain: 'ARBITRUM_MAINNET',
  recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
  token: 'USDT',                 // jetton master address OR Layerswap symbol
  amount: 10_000_000n            // 10 USDT, in base units (USDT-Jetton has 6 decimals)
})

// Poll completion via the Layerswap API:
const client = bridge.getApiClient()
const status = await client.getSwap(swapId)
```

## Semantic notes

- `BridgeResult.bridgeFee` is in **source-token base units** (Layerswap deducts its fee from the bridged amount, not as native gas). The base WDK type documents it as native — Layerswap diverges. `bridgeMaxFee` is compared against `bridgeFee` only.
- Source network detection defaults to `TON_MAINNET` — at the time of writing Layerswap only lists TON mainnet, and TON doesn't expose a stable network id the way EVM `chainId` does. Pass `sourceChain: 'TON_<...>'` in the bridge options to override if Layerswap adds testnet support.
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
