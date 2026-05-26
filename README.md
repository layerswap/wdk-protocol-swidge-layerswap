# wdk-protocol-bridge-layerswap

Monorepo of [WDK](https://docs.wdk.tether.io/) bridge modules for the [Layerswap](https://layerswap.io/) protocol.

Each package lets WDK wallet accounts of a specific source-VM family drive a Layerswap swap via the Layerswap public HTTP API (v2):

1. `POST /api/v2/swaps` creates a swap; the response includes `deposit_actions[]` with the source-chain deposit `to_address` and, where the source VM needs it, encoded `call_data`.
2. The wallet signs and broadcasts that deposit on the source chain.
3. Layerswap detects the source deposit and broadcasts the destination-chain payout transaction to `destination_address`.

`GET /api/v2/networks` exposes the chain/token catalog, `GET /api/v2/quote` previews fees and receive amount, and `GET /api/v2/transaction_status` / `GET /api/v2/swaps/{id}` are used to poll progress.

## Packages

| Package | Source VM | Status |
| --- | --- | --- |
| [`@layerswap/wdk-protocol-bridge-layerswap-evm`](./packages/layerswap-evm) | EVM | ✅ |
| [`@layerswap/wdk-protocol-bridge-layerswap-solana`](./packages/layerswap-solana) | Solana | ✅ |
| [`@layerswap/wdk-protocol-bridge-layerswap-bitcoin`](./packages/layerswap-bitcoin) | Bitcoin (UTXO) | ✅ |
| [`@layerswap/wdk-protocol-bridge-layerswap-ton`](./packages/layerswap-ton) | TON | ✅ |
| [`@layerswap/wdk-protocol-bridge-layerswap-tron`](./packages/layerswap-tron) | Tron | soon |

## Apps

| App | Purpose |
| --- | --- |
| [`@layerswap/wdk-bridge-layerswap-test-app`](./apps/test-app) | CLI for end-to-end smoke tests against a real Layerswap endpoint. Consumes the protocol via `workspace:*`. |

All packages implement `BridgeProtocol` from `@tetherto/wdk-wallet/protocols`. The chain catalog inside each package is dynamic — fetched from `GET /api/v2/networks` and cached per `LayerswapApiClient` instance — so new Layerswap-supported chains within a VM family are picked up without code changes.

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
