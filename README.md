# wdk-protocol-bridge-layerswap

Monorepo of [WDK](https://docs.wdk.tether.io/) bridge modules for the [Layerswap](https://layerswap.io/) protocol.

Each package lets WDK wallet accounts of a specific source-VM family drive a Layerswap swap via the Layerswap public HTTP API:

1. `POST /api/v2/swaps` creates a swap and returns a deposit address + deposit calldata.
2. The user's wallet signs and broadcasts the deposit on the source chain.
3. Layerswap performs the destination-chain payout off-chain.

## Packages

| Package | Source VM | Status |
| --- | --- | --- |
| [`@layerswap/wdk-protocol-bridge-layerswap-evm`](./packages/layerswap-evm) | EVM | ✅ |
| `@layerswap/wdk-protocol-bridge-layerswap-solana` | Solana | planned |
| `@layerswap/wdk-protocol-bridge-layerswap-tron` | Tron | planned |
| `@layerswap/wdk-protocol-bridge-layerswap-ton` | TON | planned |

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
# wdk-protocol-bridge-layerswap
