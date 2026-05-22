#!/usr/bin/env node

// CLI for exercising the Layerswap WDK bridge protocol end-to-end.
//
// Subcommands:
//   networks                Lists Layerswap networks the configured endpoint supports.
//   quote                   Calls protocol.quoteBridge() with env-configured route.
//   bridge                  Calls quoteBridge, then bridge, then polls until terminal.
//   status <swapId>         Polls GET /swaps/<id> once and prints the result.
//
// Configuration: copy .env.example → .env, fill values, then `node --env-file=.env src/cli.mjs <cmd>`
// or export env vars directly.

import LayerswapEvm, { LayerswapApiClient } from '@layerswap/wdk-protocol-bridge-layerswap-evm'

import { loadConfig, required } from './config.mjs'
import { buildAccount } from './account.mjs'

const TERMINAL = new Set(['completed', 'failed', 'expired', 'cancelled', 'refunded'])

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function printHelp () {
  console.log('Usage: cli.mjs <command> [args]')
  console.log('Commands:')
  console.log('  networks                List Layerswap networks at the configured endpoint.')
  console.log('  quote                   Get a quote for the env-configured route.')
  console.log('  bridge                  Submit a bridge and poll until completion.')
  console.log('  status <swapId>         Poll a single swap once and print its state.')
}

async function cmdNetworks () {
  const cfg = loadConfig()
  const client = new LayerswapApiClient({ apiUrl: cfg.apiUrl, apiKey: cfg.apiKey })
  const networks = await client.getNetworks()

  console.log(`${networks.length} networks at ${cfg.apiUrl}:`)
  console.log()
  for (const n of networks) {
    const tokens = (n.tokens ?? []).map((t) => t.symbol).join(', ')
    console.log(`  ${n.name.padEnd(28)} chainId=${String(n.chain_id ?? '-').padEnd(10)} type=${n.type.padEnd(8)} tokens=${tokens}`)
  }
}

async function cmdQuote () {
  const cfg = loadConfig()
  required('LAYERSWAP_TARGET_CHAIN')
  required('LAYERSWAP_SOURCE_TOKEN')
  required('LAYERSWAP_AMOUNT')

  const account = await buildAccount(cfg)
  const address = await account.getAddress()
  const protocol = new LayerswapEvm(account, { apiUrl: cfg.apiUrl, apiKey: cfg.apiKey })

  const amount = BigInt(cfg.amountStr)
  const options = {
    targetChain: cfg.targetChain,
    recipient: cfg.recipient ?? address,
    token: cfg.sourceToken,
    amount,
    destinationToken: cfg.destinationToken,
    sourceChain: cfg.sourceChainOverride
  }

  console.log('Quoting route:')
  console.log('  source address  :', address)
  console.log('  target chain    :', options.targetChain)
  console.log('  source token    :', options.token)
  console.log('  destination tok :', options.destinationToken ?? '(= source symbol)')
  console.log('  amount (base)   :', amount.toString())
  console.log()

  const result = await protocol.quoteBridge(options)
  console.log('Result:')
  console.log('  fee (source-chain gas, wei)        :', result.fee.toString())
  console.log('  bridgeFee (source-token base units):', result.bridgeFee.toString())
}

async function cmdBridge () {
  const cfg = loadConfig()
  required('LAYERSWAP_TARGET_CHAIN')
  required('LAYERSWAP_SOURCE_TOKEN')
  required('LAYERSWAP_AMOUNT')

  const account = await buildAccount(cfg)
  const address = await account.getAddress()
  const protocol = new LayerswapEvm(account, { apiUrl: cfg.apiUrl, apiKey: cfg.apiKey })

  const amount = BigInt(cfg.amountStr)
  const options = {
    targetChain: cfg.targetChain,
    recipient: cfg.recipient ?? address,
    token: cfg.sourceToken,
    amount,
    destinationToken: cfg.destinationToken,
    sourceChain: cfg.sourceChainOverride
  }

  console.log('Bridging:')
  console.log('  source address  :', address)
  console.log('  target chain    :', options.targetChain)
  console.log('  source token    :', options.token)
  console.log('  amount (base)   :', amount.toString())
  console.log()

  console.log('>> quoteBridge…')
  const q = await protocol.quoteBridge(options)
  console.log(`   fee=${q.fee} bridgeFee=${q.bridgeFee}`)

  console.log('>> bridge…  (broadcasting real tx)')
  const result = await protocol.bridge(options)
  const swapId = result.swapId
  console.log(`   tx hash : ${result.hash}`)
  console.log(`   swap id : ${swapId}`)

  if (!swapId) {
    console.error('No swap id available — cannot poll.')
    process.exit(1)
  }

  console.log(`\n>> polling /swaps/${swapId} every ${cfg.pollIntervalMs}ms (timeout ${cfg.pollTimeoutMs}ms)`)
  const client = protocol.getApiClient()
  const startedAt = Date.now()
  let lastStatus = null

  while (Date.now() - startedAt < cfg.pollTimeoutMs) {
    let response
    try {
      response = await client.getSwap(swapId)
    } catch (err) {
      console.warn('   poll error:', err.message)
      await sleep(cfg.pollIntervalMs)
      continue
    }

    const swap = response && response.swap
    const status = swap && swap.status
    if (status !== lastStatus) {
      console.log(`   [${new Date().toISOString()}] status=${status}`)
      lastStatus = status
    }

    if (status && TERMINAL.has(status)) {
      const outputTx = (swap.transactions ?? []).find((t) => t.type === 'output')
      console.log('\nFinal state:')
      console.log(`  status            : ${status}`)
      if (status === 'completed' && outputTx) {
        console.log(`  destination tx    : ${outputTx.transaction_hash}`)
        console.log(`  destination amount: ${outputTx.amount}`)
      } else if (swap.fail_reason) {
        console.log(`  fail reason       : ${swap.fail_reason}`)
      }
      return
    }

    await sleep(cfg.pollIntervalMs)
  }

  console.error(`\nTimed out. Last seen status: ${lastStatus}. Swap id: ${swapId}`)
  process.exit(2)
}

async function cmdStatus (swapId) {
  if (!swapId) {
    console.error('Usage: cli.mjs status <swapId>')
    process.exit(1)
  }
  const cfg = loadConfig()
  const client = new LayerswapApiClient({ apiUrl: cfg.apiUrl, apiKey: cfg.apiKey })
  const response = await client.getSwap(swapId)
  console.log(JSON.stringify(response, null, 2))
}

async function main () {
  const [command, ...args] = process.argv.slice(2)

  switch (command) {
    case 'networks': await cmdNetworks(); break
    case 'quote':    await cmdQuote(); break
    case 'bridge':   await cmdBridge(); break
    case 'status':   await cmdStatus(args[0]); break
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      printHelp()
      break
    default:
      console.error(`Unknown command: ${command}`)
      printHelp()
      process.exit(1)
  }
}

main().catch((err) => {
  console.error('\nError:', err && err.message ? err.message : err)
  if (process.env.DEBUG && err && err.stack) console.error(err.stack)
  process.exit(1)
})
