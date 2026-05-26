#!/usr/bin/env node

// CLI for exercising the Layerswap WDK bridge protocols end-to-end.
//
// Usage:
//   cli.mjs [--vm <evm|solana|tron|ton|bitcoin>] <command> [args]
//
// Subcommands:
//   networks                Lists Layerswap networks the configured endpoint supports.
//   quote                   Calls protocol.quoteBridge() with env-configured route.
//   bridge                  Calls quoteBridge, then bridge, then polls until terminal.
//   status <swapId>         Polls GET /swaps/<id> once and prints the result.
//
// VM dispatch:
//   --vm evm     (default) Uses @layerswap/wdk-protocol-bridge-layerswap-evm with
//                @tetherto/wdk-wallet-evm.
//   --vm solana  Uses @layerswap/wdk-protocol-bridge-layerswap-solana with
//                @tetherto/wdk-wallet-solana. Note: LAYERSWAP_DERIVATION_PATH segments
//                must all be hardened (e.g. "0'/0'/0'"); the default unhardened EVM
//                path is rejected by the Solana wallet and is auto-replaced with
//                "0'/0'/0'".
//   --vm tron    Uses @layerswap/wdk-protocol-bridge-layerswap-tron with
//                @tetherto/wdk-wallet-tron. The wallet prepends `m/44'/195'`
//                internally, so LAYERSWAP_DERIVATION_PATH is the post-prefix
//                segment (default "0'/0/0").
//   --vm ton     Uses @layerswap/wdk-protocol-bridge-layerswap-ton with
//                @tetherto/wdk-wallet-ton. The wallet prepends `m/44'/607'`
//                internally; LAYERSWAP_SOURCE_RPC should be a TON Center URL.
//   --vm bitcoin Uses @layerswap/wdk-protocol-bridge-layerswap-bitcoin with
//                @tetherto/wdk-wallet-btc. LAYERSWAP_SOURCE_RPC should be a Blockbook
//                URL. The wallet's network is derived from LAYERSWAP_SOURCE_CHAIN
//                (BITCOIN_MAINNET → mainnet, BITCOIN_TESTNET → testnet,
//                BITCOIN_REGTEST → regtest). Override LAYERSWAP_BTC_BIP (44 or 84)
//                if you need a legacy `1…` address instead of native segwit `bc1q…`.
//
// Configuration: copy .env.example → .env, fill values, then
//   `node --env-file=.env src/cli.mjs [--vm <vm>] <cmd>`

import { LayerswapApiClient } from '@layerswap/wdk-protocol-bridge-layerswap-core'

import { loadConfig, required } from './config.mjs'

const TERMINAL = new Set(['completed', 'failed', 'expired', 'cancelled', 'refunded'])

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function printHelp () {
  console.log('Usage: cli.mjs [--vm <evm|solana|tron|ton|bitcoin>] <command> [args]')
  console.log('Commands:')
  console.log('  networks                List Layerswap networks at the configured endpoint.')
  console.log('  quote                   Get a quote for the env-configured route.')
  console.log('  bridge                  Submit a bridge and poll until completion.')
  console.log('  status <swapId>         Poll a single swap once and print its state.')
}

function parseArgs (argv) {
  const out = { vm: 'evm', rest: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--vm') {
      out.vm = argv[++i]
      if (!out.vm) {
        console.error('Missing value for --vm.')
        process.exit(1)
      }
    } else if (arg && arg.startsWith('--vm=')) {
      out.vm = arg.slice('--vm='.length)
    } else {
      out.rest.push(arg)
    }
  }
  if (!['evm', 'solana', 'tron', 'ton', 'bitcoin'].includes(out.vm)) {
    console.error(`Unknown --vm '${out.vm}'. Expected 'evm', 'solana', 'tron', 'ton', or 'bitcoin'.`)
    process.exit(1)
  }
  return out
}

async function loadVm (vm) {
  if (vm === 'evm') {
    const [{ default: LayerswapEvm }, accountMod] = await Promise.all([
      import('@layerswap/wdk-protocol-bridge-layerswap-evm'),
      import('./account-evm.mjs')
    ])
    return { Protocol: LayerswapEvm, buildAccount: accountMod.buildAccount }
  }
  if (vm === 'solana') {
    const [{ default: LayerswapSolana }, accountMod] = await Promise.all([
      import('@layerswap/wdk-protocol-bridge-layerswap-solana'),
      import('./account-solana.mjs')
    ])
    return { Protocol: LayerswapSolana, buildAccount: accountMod.buildAccount }
  }
  if (vm === 'tron') {
    const [{ default: LayerswapTron }, accountMod] = await Promise.all([
      import('@layerswap/wdk-protocol-bridge-layerswap-tron'),
      import('./account-tron.mjs')
    ])
    return { Protocol: LayerswapTron, buildAccount: accountMod.buildAccount }
  }
  if (vm === 'ton') {
    const [{ default: LayerswapTon }, accountMod] = await Promise.all([
      import('@layerswap/wdk-protocol-bridge-layerswap-ton'),
      import('./account-ton.mjs')
    ])
    return { Protocol: LayerswapTon, buildAccount: accountMod.buildAccount }
  }
  if (vm === 'bitcoin') {
    const [{ default: LayerswapBitcoin }, accountMod] = await Promise.all([
      import('@layerswap/wdk-protocol-bridge-layerswap-bitcoin'),
      import('./account-bitcoin.mjs')
    ])
    return { Protocol: LayerswapBitcoin, buildAccount: accountMod.buildAccount }
  }
  throw new Error(`Unsupported VM '${vm}'.`)
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

async function cmdQuote (vm) {
  const cfg = loadConfig()
  required('LAYERSWAP_TARGET_CHAIN')
  required('LAYERSWAP_SOURCE_TOKEN')
  required('LAYERSWAP_AMOUNT')

  const { Protocol, buildAccount } = await loadVm(vm)
  const account = await buildAccount(cfg)
  const address = await account.getAddress()
  const protocol = new Protocol(account, { apiUrl: cfg.apiUrl, apiKey: cfg.apiKey })

  const amount = BigInt(cfg.amountStr)
  const options = {
    targetChain: cfg.targetChain,
    recipient: cfg.recipient ?? address,
    token: cfg.sourceToken,
    amount,
    destinationToken: cfg.destinationToken,
    sourceChain: cfg.sourceChainOverride
  }

  console.log(`Quoting route (vm=${vm}):`)
  console.log('  source address  :', address)
  console.log('  target chain    :', options.targetChain)
  console.log('  source token    :', options.token)
  console.log('  destination tok :', options.destinationToken ?? '(= source symbol)')
  console.log('  amount (base)   :', amount.toString())
  console.log()

  const result = await protocol.quoteBridge(options)
  console.log('Result:')
  console.log('  fee (source-chain gas, native units) :', result.fee.toString())
  console.log('  bridgeFee (source-token base units)  :', result.bridgeFee.toString())
}

async function cmdBridge (vm) {
  const cfg = loadConfig()
  required('LAYERSWAP_TARGET_CHAIN')
  required('LAYERSWAP_SOURCE_TOKEN')
  required('LAYERSWAP_AMOUNT')

  const { Protocol, buildAccount } = await loadVm(vm)
  const account = await buildAccount(cfg)
  const address = await account.getAddress()
  const protocol = new Protocol(account, { apiUrl: cfg.apiUrl, apiKey: cfg.apiKey })

  const amount = BigInt(cfg.amountStr)
  const options = {
    targetChain: cfg.targetChain,
    recipient: cfg.recipient ?? address,
    token: cfg.sourceToken,
    amount,
    destinationToken: cfg.destinationToken,
    sourceChain: cfg.sourceChainOverride
  }

  console.log(`Bridging (vm=${vm}):`)
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

  console.log(`\n>> polling /swaps/${swapId} + source-chain tx status every ${cfg.pollIntervalMs}ms (timeout ${cfg.pollTimeoutMs}ms)`)
  const client = protocol.getApiClient()
  const startedAt = Date.now()
  let lastSwapStatus = null
  let lastInputTxStatus = null

  while (Date.now() - startedAt < cfg.pollTimeoutMs) {
    let response
    try {
      response = await client.getSwap(swapId)
    } catch (err) {
      console.warn('   swap poll error:', err.message)
      await sleep(cfg.pollIntervalMs)
      continue
    }

    const swap = response && response.swap
    const swapStatus = swap && swap.status

    // Check the source-chain tx status independently. Layerswap surfaces 'failed' here
    // (e.g. Tron energy/bandwidth shortfall, smart-contract revert, dropped mempool)
    // before the swap as a whole transitions to a terminal state.
    let inputTxStatus = lastInputTxStatus
    try {
      const txStatus = await protocol.getTransactionStatus(result.hash, {
        sourceChain: cfg.sourceChainOverride
      })
      inputTxStatus = txStatus?.status ?? inputTxStatus
    } catch (err) {
      // NOT_FOUND while Layerswap is still indexing — keep waiting.
      if (!/NOT_FOUND/.test(err.message)) {
        console.warn('   txstatus poll error:', err.message)
      }
    }

    if (swapStatus !== lastSwapStatus || inputTxStatus !== lastInputTxStatus) {
      console.log(`   [${new Date().toISOString()}] swap=${swapStatus} inputTx=${inputTxStatus ?? '(not indexed yet)'}`)
      lastSwapStatus = swapStatus
      lastInputTxStatus = inputTxStatus
    }

    // Short-circuit: if Layerswap reports the source-chain tx as failed, the swap
    // cannot complete. Print and exit with an error so the operator can investigate
    // (typical Tron failure modes: insufficient energy / bandwidth, contract revert,
    // dropped tx).
    if (inputTxStatus === 'failed') {
      console.error('\nSource-chain transaction failed on-chain.')
      console.error(`  vm                : ${vm}`)
      console.error(`  source address    : ${address}`)
      console.error(`  source tx hash    : ${result.hash}`)
      console.error(`  swap id           : ${swapId}`)
      console.error(`  swap status       : ${swapStatus}`)
      if (swap?.fail_reason) console.error(`  swap fail reason  : ${swap.fail_reason}`)
      process.exit(3)
    }

    if (swapStatus && TERMINAL.has(swapStatus)) {
      const outputTx = (swap.transactions ?? []).find((t) => t.type === 'output')
      console.log('\nFinal state:')
      console.log(`  status            : ${swapStatus}`)
      console.log(`  input tx status   : ${inputTxStatus ?? '(unknown)'}`)
      if (swapStatus === 'completed' && outputTx) {
        console.log(`  destination tx    : ${outputTx.transaction_hash}`)
        console.log(`  destination amount: ${outputTx.amount}`)
      } else if (swap.fail_reason) {
        console.log(`  fail reason       : ${swap.fail_reason}`)
      }
      return
    }

    await sleep(cfg.pollIntervalMs)
  }

  console.error(`\nTimed out. Last seen swap=${lastSwapStatus}, inputTx=${lastInputTxStatus}. Swap id: ${swapId}`)
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
  const { vm, rest } = parseArgs(process.argv.slice(2))
  const [command, ...args] = rest

  switch (command) {
    case 'networks': await cmdNetworks(); break
    case 'quote': await cmdQuote(vm); break
    case 'bridge': await cmdBridge(vm); break
    case 'status': await cmdStatus(args[0]); break
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
