#!/usr/bin/env node

// Copyright 2026 Layerswap Labs, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License").
//
// End-to-end Layerswap bridge against a live testnet. This is NOT a unit test —
// it broadcasts real (testnet) transactions and waits for Layerswap to deliver
// on the destination chain.
//
// Run:
//   node tests/integration/bridge-testnet.mjs
//
// Required env vars:
//   LAYERSWAP_SEED              BIP-39 mnemonic for the source-chain wallet.
//   LAYERSWAP_SOURCE_RPC        JSON-RPC URL for the source chain (e.g. Sepolia).
//   LAYERSWAP_TARGET_CHAIN      Layerswap destination network name (e.g. 'ARBITRUM_SEPOLIA').
//                                Uses the <CHAIN>_<ENV> uppercase convention.
//   LAYERSWAP_SOURCE_TOKEN      Source token: contract address (0x…) or symbol ('ETH', 'USDC').
//   LAYERSWAP_AMOUNT            Amount in source-token base units (e.g. '10000000000000000' for 0.01 ETH).
//
// Optional env vars:
//   LAYERSWAP_API_URL           Default 'https://api-dev.layerswap.cloud' (sandbox).
//   LAYERSWAP_API_KEY           Default 'sandbox'. Pass empty string to omit the header.
//   LAYERSWAP_DERIVATION_PATH   Default "0'/0/0".
//   LAYERSWAP_DEST_TOKEN        Default = source token symbol.
//   LAYERSWAP_RECIPIENT         Default = source wallet address (round-trip).
//   LAYERSWAP_SOURCE_CHAIN      Override auto-detection (Layerswap network name).
//   LAYERSWAP_DRY_RUN           If set, only runs quoteBridge — no broadcast.
//   LAYERSWAP_POLL_INTERVAL_MS  Default 10000.
//   LAYERSWAP_POLL_TIMEOUT_MS   Default 900000 (15 min).

'use strict'

import LayerswapProtocolEvm from '../../index.js'

const TERMINAL_STATUSES = new Set([
  'completed',
  'failed',
  'expired',
  'cancelled',
  'refunded'
])

const required = (name) => {
  const v = process.env[name]
  if (!v || v.length === 0) {
    console.error(`Missing required env var ${name}.`)
    process.exit(1)
  }
  return v
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main () {
  const seed = required('LAYERSWAP_SEED')
  const sourceRpc = required('LAYERSWAP_SOURCE_RPC')
  const targetChain = required('LAYERSWAP_TARGET_CHAIN')
  const sourceToken = required('LAYERSWAP_SOURCE_TOKEN')
  const amountStr = required('LAYERSWAP_AMOUNT')
  const amount = BigInt(amountStr)

  const apiUrl = process.env.LAYERSWAP_API_URL ?? 'https://api-dev.layerswap.cloud'
  const apiKeyRaw = process.env.LAYERSWAP_API_KEY ?? 'sandbox'
  const apiKey = apiKeyRaw.length > 0 ? apiKeyRaw : undefined
  const derivationPath = process.env.LAYERSWAP_DERIVATION_PATH ?? "0'/0/0"
  const destinationToken = process.env.LAYERSWAP_DEST_TOKEN
  const sourceChainOverride = process.env.LAYERSWAP_SOURCE_CHAIN
  const dryRun = !!process.env.LAYERSWAP_DRY_RUN
  const pollIntervalMs = Number(process.env.LAYERSWAP_POLL_INTERVAL_MS ?? '10000')
  const pollTimeoutMs = Number(process.env.LAYERSWAP_POLL_TIMEOUT_MS ?? '900000')

  let WalletManagerEvm
  try {
    ({ default: WalletManagerEvm } = await import('@tetherto/wdk-wallet-evm'))
  } catch (err) {
    console.error('This script requires @tetherto/wdk-wallet-evm. Install it first:')
    console.error('  npm install --save-dev @tetherto/wdk-wallet-evm')
    process.exit(1)
  }

  console.log('--- Layerswap bridge testnet run ---')
  console.log('API URL          :', apiUrl)
  console.log('API key sent     :', apiKey ? 'yes' : 'no')
  console.log('Source RPC       :', sourceRpc)
  console.log('Target chain     :', targetChain)
  console.log('Source token     :', sourceToken)
  console.log('Destination token:', destinationToken ?? '(same symbol as source)')
  console.log('Amount (base)    :', amount.toString())
  console.log('Dry run          :', dryRun)

  const wallet = new WalletManagerEvm(seed, { provider: sourceRpc })
  const account = await wallet.getAccount(derivationPath)
  const address = await account.getAddress()
  console.log('Source address   :', address)

  const recipient = process.env.LAYERSWAP_RECIPIENT ?? address
  console.log('Recipient        :', recipient)

  const protocol = new LayerswapProtocolEvm(account, { apiUrl, apiKey })

  const bridgeOptions = {
    targetChain,
    recipient,
    token: sourceToken,
    amount,
    destinationToken,
    sourceChain: sourceChainOverride
  }

  console.log('\n>> quoteBridge…')
  const quote = await protocol.quoteBridge(bridgeOptions)
  console.log('  fee (source-chain gas, wei)        :', quote.fee.toString())
  console.log('  bridgeFee (source-token base units):', quote.bridgeFee.toString())

  if (dryRun) {
    console.log('\nDry run — exiting before broadcast.')
    return
  }

  console.log('\n>> bridge…  (broadcasts a real transaction)')
  const result = await protocol.bridge(bridgeOptions)
  const swapId = protocol.getLastSwapId()
  console.log('  Source deposit hash:', result.hash)
  console.log('  Source gas fee     :', result.fee.toString())
  console.log('  Layerswap fee      :', result.bridgeFee.toString())
  console.log('  Swap id            :', swapId)

  if (!swapId) {
    console.error('No swap id available — cannot poll for completion.')
    process.exit(1)
  }

  console.log('\n>> Polling for destination delivery…')
  const client = protocol.getApiClient()
  const startedAt = Date.now()
  let lastStatus = null

  while (Date.now() - startedAt < pollTimeoutMs) {
    let response
    try {
      response = await client.getSwap(swapId)
    } catch (err) {
      console.warn('  poll error:', err.message)
      await sleep(pollIntervalMs)
      continue
    }

    const swap = response && response.swap
    const status = swap && swap.status
    if (status !== lastStatus) {
      console.log(`  [${new Date().toISOString()}] status=${status}`)
      lastStatus = status
    }

    if (status && TERMINAL_STATUSES.has(status)) {
      const outputTx = (swap.transactions ?? []).find((t) => t.type === 'output')
      console.log('\n--- Final state ---')
      console.log('Status            :', status)
      if (status === 'completed' && outputTx) {
        console.log('Destination tx    :', outputTx.transaction_hash)
        console.log('Destination amount:', outputTx.amount)
      }
      if (status !== 'completed' && swap.fail_reason) {
        console.log('Fail reason       :', swap.fail_reason)
      }
      return
    }

    await sleep(pollIntervalMs)
  }

  console.error(`\nTimed out after ${pollTimeoutMs}ms waiting for terminal swap status.`)
  console.error(`Swap ${swapId} is still in status: ${lastStatus}`)
  process.exit(2)
}

main().catch((err) => {
  console.error('\nError:', err && err.message ? err.message : err)
  if (err && err.stack) console.error(err.stack)
  process.exit(1)
})
