# Layerswap Solana — research findings (2026-05-22)

Captured while implementing `@layerswap/wdk-protocol-bridge-layerswap-solana`. Carry forward to the next agent.

## What was verified

### Network catalog (`GET /api/v2/networks`)

- **Prod** (`api.layerswap.io`): three Solana-typed networks — `SOLANA_MAINNET`, `SOON_MAINNET`, `ECLIPSE_MAINNET`. Only `SOLANA_MAINNET` is canonical Solana; the others are L2s.
- **Dev** (`api-dev.layerswap.cloud`): `SOLANA_DEVNET`, plus the same L2 testnets.
- See `networks.json` — captured fixture with `SOLANA_MAINNET` + `ARBITRUM_MAINNET` entries.

**`chain_id` field is unreliable for Solana:**
- `SOLANA_MAINNET.chain_id` → `''` (empty string)
- `SOLANA_DEVNET.chain_id` → `'1399811149'` (a number, not a cluster name)
- The doc's assumption that Layerswap returns `'mainnet-beta'` / `'devnet'` is **wrong**.

**Implication for the protocol:** do not call `resolveSourceNetwork(client, …)` to auto-detect the source. Instead, detect via Solana RPC `getGenesisHash()` and map to a network *name*, then call `resolveNetworkByName`. Genesis hashes are well-known constants — see `src/layerswap-protocol-solana.js` (`GENESIS_HASH_TO_NETWORK_NAME`).

### Read-only `/quote` (works on prod)

`GET /api/v2/quote?source_network=SOLANA_MAINNET&source_token=USDC&destination_network=ARBITRUM_MAINNET&destination_token=USDC&amount=10&use_deposit_address=true`

- Returns the same envelope shape as EVM quotes (`requested_amount`, `receive_amount`, `total_fee`, `total_fee_in_usd`, `blockchain_fee`, `service_fee`, `min_receive_amount`, `slippage`, `avg_completion_time`).
- See `quote.spl.json` — captured fixture.
- No Solana-specific fields in the quote response. The `LayerswapQuote` typedef from core covers it.

## `deposit_actions[].call_data` shape — confirmed from Layerswap UI

The Layerswap web app (`layerswapapp-1`) handles Solana withdrawals like this:

```ts
// components/Swap/Withdraw/Wallet/WithdrawalProviders/SVMWalletWithdraw/index.tsx
const arrayBufferCallData = Uint8Array.from(atob(callData), c => c.charCodeAt(0))
const transaction = Transaction.from(arrayBufferCallData)
// ... fee check via transaction.getEstimatedFee(connection)
// ... signed + broadcast via wallet.signTransaction + connection.sendRawTransaction
```

So:

1. **`call_data` is base64-encoded.** Decode with `Buffer.from(callData, 'base64')` (or `atob`).
2. **The bytes are a legacy `Transaction` wire format** (the v0 / unversioned Solana transaction format that `@solana/web3.js` exposes as `Transaction.from(buffer)`). It is **not** a `VersionedTransaction` — the UI uses the legacy class exclusively.
3. **The recovered `Transaction` is sent as-is.** The UI does not rebuild instructions; it signs the recovered tx and broadcasts via `Connection.sendRawTransaction`. Layerswap embeds whatever instructions / memos they need (probably a memo with the swap reference) inside that tx.

**Implication for this package:** we need to take Layerswap's wire-format legacy Transaction, attach the wallet's signature, and broadcast it. The newer `@tetherto/wdk-wallet-solana` uses the modular v3 `@solana/*` SDK and its `sendTransaction(message)` expects a v3 `TransactionMessage`, not a legacy wire-format Transaction — so the protocol cannot just hand the deserialised tx to `account.sendTransaction(tx)` and call it a day.

We solve this by pulling in `@solana/web3.js` (legacy SDK) as a runtime dep of this package and going through the same path as the UI:
- `Transaction.from(Buffer.from(callData, 'base64'))` for deserialisation
- Build a `Connection` from `account._config.provider` (or `rpcUrl`)
- Sign with `Keypair.fromSecretKey(...)` constructed from `account.keyPair.privateKey + publicKey` (the v3 wallet exposes the raw 32-byte private + public keys via the `keyPair` getter)
- Broadcast via `Connection.sendRawTransaction(transaction.serialize())`

This keeps the wallet account responsible for key management (`account.keyPair`, `account.getAddress()`) and delegates Layerswap-specific wire-format handling to `@solana/web3.js`, exactly matching the UI's tested code path.

## `to_address` and amount fields (assumed; confirm on first live swap)

Still un-captured live, but the format is reasonably constrained:

- `to_address` is a base58 Solana pubkey of Layerswap's deposit account. (For SPL, Layerswap likely embeds the actual destination — owner or ATA — inside the `call_data` transaction; our package doesn't need to interpret it.)
- `amount_in_base_units` is a decimal string of lamports (native) or smallest token unit. Already string-typed in `LayerswapDepositAction`.

## First-real-swap checklist

When making the first live Solana → EVM swap:

1. Capture the full `deposit_actions[0]` JSON and save as `createSwap.native.json` / `createSwap.spl.json` here.
2. Verify `Buffer.from(callData, 'base64')` decodes cleanly; verify `Transaction.from(...)` succeeds.
3. Verify the broadcast signature is accepted and the swap reaches `completed` status.

## Files

- `networks.json` — `GET /networks` slice for SOLANA_MAINNET + ARBITRUM_MAINNET. Used by unit tests as the canonical network catalog.
- `quote.spl.json` — live quote envelope for SOLANA_MAINNET USDC → ARBITRUM_MAINNET USDC. Used by `quoteBridge` unit tests.
- `createSwap.native.json` (TODO) — to be populated after first live swap with native SOL source.
- `createSwap.spl.json` (TODO) — to be populated after first live swap with SPL token source.
