# Layerswap TON — research findings (2026-05-22)

Captured while implementing `@layerswap/wdk-protocol-swidge-layerswap-ton`. Carry forward to the next agent.

## What was verified

### Network catalog (`GET /api/v2/networks`)

- **Prod** (`api.layerswap.io`): one TON-typed network — `TON_MAINNET`. No testnet listed.
- Tokens on `TON_MAINNET`:
  - `TON` (native): `contract: null`, `decimals: 9`
  - `USDe` (jetton): `contract: 'UQAIb6KmdfdDR7CN1GBqVJuP25iCnLKCvBlJ07Evuu2dzKOa'`, `decimals: 6`
  - `USDT` (jetton): `contract: 'UQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_p0p'`, `decimals: 6`

**`chain_id` field is `null` for TON:** Layerswap doesn't propagate a network id. TON also doesn't expose a stable network id from the protocol layer (no `chainId` equivalent). The package defaults to `TON_MAINNET` and exposes `sourceChain` for override.

## `deposit_actions[].call_data` shape — confirmed from Layerswap UI

The Layerswap web app handles TON withdrawals like this:

```ts
// components/Swap/Withdraw/Wallet/WithdrawalProviders/TonWalletWithdraw.tsx
const parsedCallData = JSON.parse(callData)

// Native TON:
const body = beginCell()
  .storeUint(0, 32)
  .storeStringTail(parsedCallData.comment)
  .endCell()

const tx = {
  validUntil: Math.floor(Date.now() / 1000) + 360,
  messages: [{
    address: depositAddress,
    amount: toNano(amount).toString(),
    payload: body.toBoc().toString('base64')
  }]
}

// Jetton:
const forwardPayload = beginCell()
  .storeUint(0, 32)
  .storeStringTail(parsedCallData.comment)
  .endCell()

const body = beginCell()
  .storeUint(0x0f8a7ea5, 32)         // jetton transfer opcode
  .storeUint(0, 64)                  // query id
  .storeCoins(parsedCallData.amount) // jetton amount (from call_data, NOT options.amount)
  .storeAddress(depositAddress)
  .storeAddress(depositAddress)      // response excess destination
  .storeBit(0)
  .storeCoins(toNano('0.00002'))     // forward amount
  .storeBit(1)                       // has forward payload (ref)
  .storeRef(forwardPayload)
  .endCell()

const jettonMaster = tonClient.open(JettonMaster.create(Address.parse(token.contract)))
const jettonWalletAddress = await jettonMaster.getWalletAddress(userAddress)

const tx = {
  validUntil: Math.floor(Date.now() / 1000) + 360,
  messages: [{
    address: jettonWalletAddress.toString(),
    amount: toNano('0.045').toString(),
    payload: body.toBoc().toString('base64')
  }]
}
```

So:

1. **`call_data` is a JSON string** with `comment` (Layerswap reference) and `amount` (jetton amount in base units, as a string).
2. **Native TON sends use `account.sendTransaction({ to: depositAddress, value: amount, body: commentCell })`**. The wallet sets up the v5r1 contract and signs.
3. **Jetton sends use `account.sendTransaction({ to: jettonWalletAddress, value: 45_000_000n, body: jettonTransferCell })`**. The jetton wallet address is the sender's per-jetton wallet, resolved via the jetton master's `get_wallet_address` get-method. We use `account._getJettonWalletAddress(token)` (protected helper on `WalletAccountReadOnlyTon`) to avoid duplicating that logic.
4. **The jetton body's `forward_amount` is `toNano('0.00002') = 20_000n` nanotons** — the small TON value that travels with the jetton-transfer notification so the recipient's wallet can react to it. The 0.045 TON message value covers gas + this forward amount.

## `@tetherto/wdk-wallet-ton` account API (read from installed package)

`WalletAccountTon` (v1.0.0-beta.8) exposes:

- `account.getAddress() → Promise<string>` (TON friendly address, bounceable=false by default).
- `account.keyPair → { privateKey: Uint8Array(64), publicKey: Uint8Array(32) }` (nacl sign keypair from BIP-44 derivation).
- `account.sendTransaction({ to, value, body })` — opens the v5r1 contract, builds an internal message with `body`, signs with the secret key, broadcasts via `_contract.send`. Returns `{ hash, fee }`.
- `account.quoteSendTransaction({ to, value, body })` — same flow up to fee estimation, no broadcast.
- `account._getJettonWalletAddress(tokenAddress)` — protected; resolves the sender's per-jetton wallet via the jetton master.
- `account._tonClient` — protected; the underlying `TonClient`.

The protocol consumes:
- `getAddress()` to populate Layerswap's `source_address`.
- `quoteSendTransaction` to populate the quote-time `fee`.
- `sendTransaction` for the actual broadcast.
- `_getJettonWalletAddress` to address the right jetton wallet.

## First-real-swap checklist

When making the first live TON → EVM swap:

1. Capture the full `deposit_actions[0]` JSON and save as `createSwap.jetton.json` here.
2. Verify `JSON.parse(call_data)` exposes the expected `comment` and `amount` fields.
3. Confirm `parsedCallData.amount` equals our `options.amount` (Layerswap may re-quote the amount; if so, we should use Layerswap's value, not ours, for the jetton body — this is the UI's behaviour).
4. Verify the swap reaches `completed` status.

## Files

- `RESEARCH-NOTES.md` — this file.
- `createSwap.jetton.json` (TODO) — to be populated after first live swap with USDT-Jetton source.
- `createSwap.native.json` (TODO) — to be populated after first live swap with native TON source.
