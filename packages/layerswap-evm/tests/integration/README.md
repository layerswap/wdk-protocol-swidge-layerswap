# Integration tests

`bridge-testnet.mjs` is a runnable script that drives the full Layerswap flow against a real testnet — it creates a swap, broadcasts the source-chain deposit transaction, and polls Layerswap until the destination payout lands. **This is not a Jest test.** It spends testnet funds.

## Prerequisites

1. **Install the EVM wallet manager** (optional dev dep, not in default install):
   ```bash
   npm install --save-dev @tetherto/wdk-wallet-evm
   ```

2. **A funded testnet wallet** on the source chain. Faucets you can use:
   - **Sepolia ETH** — [sepoliafaucet.com](https://sepoliafaucet.com/), [alchemy.com/faucets/ethereum-sepolia](https://www.alchemy.com/faucets/ethereum-sepolia)
   - **Arbitrum Sepolia** — use the Arbitrum bridge to ferry Sepolia ETH
   - **Optimism Sepolia / Base Sepolia** — chain-specific faucets

3. **A JSON-RPC URL** for the source chain. Free providers: Alchemy, Infura, Ankr, public RPCs from chainlist.

4. **A Layerswap-supported route.** Sandbox accepts most major testnet routes (Sepolia ↔ Arbitrum Sepolia ↔ Optimism Sepolia ↔ Base Sepolia). Check [layerswap.io](https://layerswap.io) → sandbox mode for the live list, or call `getApiClient().getNetworks()` against the sandbox URL.

## Configure

Required env vars:

| name | example |
| --- | --- |
| `LAYERSWAP_SEED` | `"cook voyage document eight skate token alien guide drink uncle term abuse"` |
| `LAYERSWAP_SOURCE_RPC` | `https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY` |
| `LAYERSWAP_TARGET_CHAIN` | `ARBITRUM_SEPOLIA` (Layerswap network name) |
| `LAYERSWAP_SOURCE_TOKEN` | `ETH` (symbol) **or** `0xA0b8…48` (contract) |
| `LAYERSWAP_AMOUNT` | `10000000000000000` (= 0.01 ETH in wei) |

Optional env vars:

| name | default |
| --- | --- |
| `LAYERSWAP_API_URL` | `https://api-dev.layerswap.cloud` (sandbox) |
| `LAYERSWAP_API_KEY` | `sandbox` — pass empty string to send no header at all |
| `LAYERSWAP_DERIVATION_PATH` | `0'/0/0` |
| `LAYERSWAP_DEST_TOKEN` | same symbol as source |
| `LAYERSWAP_RECIPIENT` | the source wallet's own address (round-trip) |
| `LAYERSWAP_SOURCE_CHAIN` | auto-detected from RPC chainId |
| `LAYERSWAP_DRY_RUN` | unset — set to `1` to only run `quoteBridge` |
| `LAYERSWAP_POLL_INTERVAL_MS` | `10000` |
| `LAYERSWAP_POLL_TIMEOUT_MS` | `900000` (15 min) |

## Run

**Dry-run quote (no broadcast):**

```bash
LAYERSWAP_DRY_RUN=1 \
LAYERSWAP_SEED="your mnemonic..." \
LAYERSWAP_SOURCE_RPC="https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY" \
LAYERSWAP_TARGET_CHAIN="ARBITRUM_SEPOLIA" \
LAYERSWAP_SOURCE_TOKEN="ETH" \
LAYERSWAP_AMOUNT="10000000000000000" \
node tests/integration/bridge-testnet.mjs
```

**Real bridge:**

```bash
LAYERSWAP_SEED="your mnemonic..." \
LAYERSWAP_SOURCE_RPC="https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY" \
LAYERSWAP_TARGET_CHAIN="ARBITRUM_SEPOLIA" \
LAYERSWAP_SOURCE_TOKEN="ETH" \
LAYERSWAP_AMOUNT="10000000000000000" \
node tests/integration/bridge-testnet.mjs
```

## What it does

1. Loads the WDK EVM wallet account from the seed + RPC.
2. Calls `protocol.quoteBridge(...)` and prints `{ fee, bridgeFee }`.
3. If not dry-run, calls `protocol.bridge(...)` — broadcasts the source-chain deposit and prints the source tx hash + swap id.
4. Polls `GET /api/v2/swaps/{id}` every `POLL_INTERVAL_MS` until the swap reaches a terminal status (`completed`, `failed`, `expired`, `cancelled`, `refunded`) or `POLL_TIMEOUT_MS` elapses.
5. On `completed`, prints the destination-chain output tx hash.

## Discovering the right Layerswap network name

You can introspect the sandbox catalog directly:

```bash
curl https://api-dev.layerswap.cloud/api/v2/networks \
  -H "X-LS-APIKEY: sandbox" | jq '.data[] | {name, chain_id, type}'
```

Match the source chain's `chain_id` to the value your RPC returns from `eth_chainId`.

## Cleanup

This script broadcasts irreversible (but cheap) testnet transactions. Inspect the deposit hash on a block explorer (Etherscan for Sepolia, Arbiscan for Arbitrum Sepolia) to confirm it was mined as expected.
