# Layerswap Bitcoin — research findings (2026-05-22)

Captured while implementing `@layerswap/wdk-protocol-bridge-layerswap-bitcoin`. Carry forward to the next agent.

## What was verified

### Network catalog (`GET /api/v2/networks`)

- **Prod** (`api.layerswap.io`): one Bitcoin-typed network — `BITCOIN_MAINNET`. No testnet listed.
- Tokens on `BITCOIN_MAINNET`:
  - `BTC` (native): `contract: null`, `decimals: 8`

No BRC-20 or Runes tokens. The protocol throws if a non-native source token is resolved.

## `deposit_actions[].call_data` shape — confirmed from Layerswap UI

The Layerswap web app handles Bitcoin withdrawals like this:

```ts
// components/Swap/Withdraw/Wallet/WithdrawalProviders/BitcoinWalletWithdraw/sendTransaction.ts
const amountInSatoshi = Math.floor(amount * 1e8)
const hexMemo = Number(callData).toString(16)

const { psbt, inputsToSign } = await transactionBuilder({
  amount: amountInSatoshi,
  depositAddress,
  userAddress,
  memo: hexMemo,
  version: isTestnet ? 'testnet' : 'mainnet',
  publicClient,
  rpcClient
})

const psbtHex = psbt.toHex()
const signature = await provider.request({
  method: 'signPsbt',
  params: { psbt: psbtHex, inputsToSign, finalize: false, sighashTypes: isTaproot ? [0] : [1] }
})

const signedPsbt = Psbt.fromHex(signature).finalizeAllInputs()
const tx = signedPsbt.extractTransaction()
const txHex = tx.toHex()
const txHash = await rpcClient.call('sendrawtransaction', [txHex])
return txHash
```

Inside `transactionBuilder` / `buildPsbt.ts`:

```ts
// Main output (deposit)
psbt.addOutput({ address: depositAddress, value: BigInt(amount) })

// OP_RETURN memo
const data = Buffer.from(memo || '', 'utf8')
if (data.length > 80) throw new Error('Memo too long; max 80 bytes')
psbt.addOutput({ script: script.compile([opcodes.OP_RETURN, data]), value: 0n })

// Change
const change = totalSelected - BigInt(amount) - fee
if (change > 0n) psbt.addOutput({ address: userAddress, value: change })
```

Important: the UI does `Buffer.from(memo, 'utf8')` on the **hex string** — i.e. it stores the hex characters as UTF-8 bytes in OP_RETURN, not the decoded hex bytes. The package mirrors that exactly. (This is the same as Tron's UTF-8-of-hex-string pattern; treating the memo as plaintext.)

So:

1. **`call_data` is a numeric string** (e.g. `"7745"`).
2. **The UI converts it via `Number(callData).toString(16)`** — e.g. `"7745"` → `"1e41"`.
3. **The hex string is stored as raw UTF-8 bytes in OP_RETURN** (e.g. ascii `0x31 0x65 0x34 0x31`), not as the decoded bytes (`0x1e 0x41`).
4. **Cap at 80 bytes** (the standardness limit for OP_RETURN). The package validates.

The package mirrors the UI exactly, including the UTF-8-of-hex pattern, so Layerswap's watcher decodes the memo the same way regardless of which client initiated the swap.

## `@tetherto/wdk-wallet-btc` account API (read from installed package)

`WalletAccountBtc` (v1.0.0-beta.9) exposes:

- `account.getAddress() → Promise<string>` (BIP-44 P2PKH or BIP-84 P2WPKH depending on config).
- `account.sendTransaction({ to, value })` — builds + signs + broadcasts a simple 1-or-2-output tx. **No OP_RETURN seam**, hence we build the PSBT ourselves.
- `account._client` — Electrum/Blockbook client with `listUnspent`, `broadcast`, `estimateFee`, `getTransaction`, `connect`.
- `account._masterNode` — BIP-32 master node, used for `psbt.signInputHD(idx, masterNode)`.
- `account._account` — the derived BIP-32 child (has `.publicKey`).
- `account._network` — `bitcoinjs-lib` `Network` object (mainnet / testnet / regtest).
- `account._dustLimit` — 294n for BIP-84, 546n for BIP-44.
- `account._path` — full BIP-44 derivation path string.
- `account._bip` — 44 or 84.
- `account._ensureConnected()` — opens the client if not connected.
- `account._toBigInt(v)` — type-safe coercion.

The protocol reaches into these internals to build the PSBT (mirroring the wallet's own `_buildSignedTransaction` flow, with an extra `OP_RETURN` output injected). This is fragile across major wallet versions — when bumping the wallet peer, re-run the test suite and inspect any breakage.

## First-real-swap checklist

When making the first live BTC → EVM swap:

1. Capture the full `deposit_actions[0]` JSON and save as `createSwap.btc.json` here.
2. Verify `Number(call_data)` is a finite number (Layerswap could in principle return a non-numeric reference id).
3. Verify the OP_RETURN script in the broadcast transaction matches what the UI builds for the same swap.
4. Verify the swap reaches `completed` status.

## Files

- `RESEARCH-NOTES.md` — this file.
- `createSwap.btc.json` (TODO) — to be populated after first live swap.
