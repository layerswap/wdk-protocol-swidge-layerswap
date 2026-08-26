# @layerswap/wdk-swidge-layerswap-test-app

Workspace CLI for exercising the Layerswap WDK swidge protocol packages (e.g. [`@layerswap/wdk-protocol-swidge-layerswap-evm`](../../packages/layerswap-evm)) end-to-end against a real Layerswap endpoint. Lives inside the monorepo and consumes the protocol via pnpm's `workspace:*` protocol — so the test app and the protocol share a single copy of every dependency (`instanceof` works across the boundary).

## Install

Run from the monorepo root:

```bash
cd wdk-protocol-swidge-layerswap
pnpm install
```

## Configure

```bash
cp .env.example .env
# edit .env — at minimum:
#   LAYERSWAP_SEED            BIP-39 mnemonic
#   LAYERSWAP_SOURCE_RPC      JSON-RPC URL for the source chain
#   LAYERSWAP_TARGET_CHAIN    Layerswap destination network name (uppercase, e.g. ARBITRUM_SEPOLIA)
#   LAYERSWAP_SOURCE_TOKEN    'ETH' / 'USDC' / contract address
#   LAYERSWAP_AMOUNT          base units, e.g. '10000000000000000'
```

Then `cd` into this directory and run with `--env-file` (or export the env vars):

```bash
cd apps/test-app
node --env-file=.env src/cli.mjs <command>
```

(You can also run from the monorepo root via `pnpm --filter @layerswap/wdk-swidge-layerswap-test-app run swidge` etc.)

## Commands

### `networks` — list supported networks

```bash
node --env-file=.env src/cli.mjs networks
```

Helpful to figure out what to put in `LAYERSWAP_TARGET_CHAIN` and `LAYERSWAP_SOURCE_TOKEN`. Layerswap network names follow the `<CHAIN>_<ENV>` uppercase convention (e.g. `ETHEREUM_MAINNET`, `ARBITRUM_MAINNET`, `ETHEREUM_SEPOLIA`, `ARBITRUM_SEPOLIA`).

### `chains` — list the WDK-mapped chain catalog

```bash
node --env-file=.env src/cli.mjs chains
```

The same catalog as `networks`, but in the WDK `SwidgeSupportedChain` shape returned by `protocol.getSupportedChains()`.

### `quote` — quote a route, no broadcast

```bash
node --env-file=.env src/cli.mjs quote
```

Builds the wallet account, calls `protocol.quoteSwidge(...)`, and prints the receive amounts plus the itemised fee breakdown.

### `swidge` (alias: `bridge`) — full E2E

```bash
node --env-file=.env src/cli.mjs swidge
```

1. Quotes the route via `quoteSwidge`.
2. Executes `swidge` — submits the source-chain deposit transaction.
3. Polls `protocol.getSwidgeStatus(id)` every `LAYERSWAP_POLL_INTERVAL_MS` until the swap reaches a terminal WDK status (`completed`, `failed`, `expired`, `cancelled`, `refunded`) or `LAYERSWAP_POLL_TIMEOUT_MS` elapses.
4. On `completed`, prints the destination-chain output tx hash.

For Bitcoin, `LAYERSWAP_BTC_FEE_RATE` can override the Blockbook fee estimate
in sat/vB (for example, `2` on testnet).

### `status <swapId>` — single-shot poll

```bash
node --env-file=.env src/cli.mjs status 550e8400-e29b-41d4-a716-446655440000
```

Fetches and pretty-prints the full `GET /swaps/<id>` envelope, followed by the WDK-mapped swidge status and transactions. Useful when you want to look up a swap created in a previous `swidge` run.

## Faucets

| Chain | Faucet |
| --- | --- |
| Sepolia ETH | https://www.alchemy.com/faucets/ethereum-sepolia |
| Arbitrum Sepolia | https://www.alchemy.com/faucets/arbitrum-sepolia |
| Optimism Sepolia | https://www.alchemy.com/faucets/optimism-sepolia |
| Base Sepolia | https://www.alchemy.com/faucets/base-sepolia |

## Troubleshooting

- **`Layerswap does not support source chain with id '…'`** — the chain id your RPC returns isn't in the Layerswap catalog. Run `networks` to see what's supported, or set `LAYERSWAP_SOURCE_CHAIN` to a Layerswap network name to override auto-detection.
- **`Token '…' not supported on Layerswap network '…'`** — symbol/contract mismatch. Use the exact symbol Layerswap publishes (visible via `networks`).
- **`Exceeded maximum fee cost for bridge operation.`** — your `LAYERSWAP_BRIDGE_MAX_FEE` (if you set one) is below the live quote's `total_fee` in source-token base units.
- **HTTP 401/403 on sandbox** — try `LAYERSWAP_API_KEY=sandbox`; some Layerswap dev environments inspect the header even though it's not strictly required.
- **HTTP 403 `API_KEY_FORBIDDEN` on production** — set `LAYERSWAP_API_KEY=""` to omit the sandbox key, or provide a valid production key.

## Updating the package under test

The dependency is `workspace:*` — edits to `packages/layerswap-evm/` are picked up immediately, no reinstall needed. If you add or remove deps in the protocol package, re-run `pnpm install` at the monorepo root.
