#!/usr/bin/env node

// CLI for exercising the Layerswap WDK swidge protocols end-to-end.
//
// Usage:
//   cli.mjs [--vm <evm|solana|tron|ton|bitcoin>] <command> [args]
//
// Subcommands:
//   networks                Lists Layerswap networks the configured endpoint supports.
//   chains                  Lists the WDK-mapped supported chains (getSupportedChains view).
//   quote                   Calls protocol.quoteSwidge() with the env-configured route.
//   swidge                  Calls quoteSwidge, then swidge, then polls getSwidgeStatus
//                           until the swap reaches a terminal WDK status.
//   bridge                  Alias of `swidge` (legacy name).
//   status <swapId>         Fetches GET /swaps/<id> once; prints the raw swap and the
//                           WDK-mapped swidge status.
//
// VM dispatch:
//   --vm evm     (default) Uses @layerswap/wdk-protocol-bridge-layerswap-evm with
//                @tetherto/wdk-wallet-evm.
//   --vm solana  Uses @layerswap/wdk-protocol-bridge-layerswap-solana with
//                @tetherto/wdk-wallet-solana. Note: LAYERSWAP_DERIVATION_PATH segments
//                must all be hardened (e.g. "0'/0'/0'"); the default unhardened EVM
//                path is rejected by the Solana wallet and is auto-replaced with
//                "0'/0'/0'".
//   --vm tron    Not available yet — the tron protocol package has not been implemented.
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

import {
  LayerswapApiClient,
  buildStatusResult,
  buildSupportedChains
} from '@layerswap/wdk-protocol-bridge-layerswap-core'

import { loadConfig, required } from './config.mjs'

// Terminal states in the WDK swidge status vocabulary.
const TERMINAL = new Set(['completed', 'failed', 'expired', 'cancelled', 'refunded'])

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function printHelp () {
  console.log('Usage: cli.mjs [--vm <evm|solana|tron|ton|bitcoin>] <command> [args]')
  console.log('Commands:')
  console.log('  networks                List Layerswap networks at the configured endpoint.')
  console.log('  chains                  List the WDK-mapped supported chains.')
  console.log('  quote                   Get a swidge quote for the env-configured route.')
  console.log('  swidge                  Execute a swidge and poll until completion.')
  console.log('  bridge                  Alias of `swidge`.')
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
    throw new Error("The '@layerswap/wdk-protocol-bridge-layerswap-tron' package has not been implemented yet.")
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

function buildSwidgeOptions (cfg, address) {
  return {
    fromToken: cfg.sourceToken,
    toToken: cfg.destinationToken,
    toChain: cfg.targetChain,
    fromChain: cfg.sourceChainOverride,
    recipient: cfg.recipient ?? address,
    fromTokenAmount: BigInt(cfg.amountStr)
  }
}

function printFees (fees) {
  for (const fee of fees) {
    const included = fee.included ? 'included' : 'extra'
    console.log(`    - ${fee.type.padEnd(9)} ${fee.amount.toString().padStart(16)} ${fee.token.padEnd(6)} (${included}) ${fee.description ?? ''}`)
  }
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

async function cmdChains () {
  const cfg = loadConfig()
  const client = new LayerswapApiClient({ apiUrl: cfg.apiUrl, apiKey: cfg.apiKey })
  const chains = buildSupportedChains(await client.getNetworks())

  console.log(`${chains.length} supported chains at ${cfg.apiUrl}:`)
  console.log()
  for (const c of chains) {
    console.log(`  ${String(c.id).padEnd(28)} name=${c.name.padEnd(20)} type=${c.type.padEnd(10)} native=${c.nativeToken}`)
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

  const options = buildSwidgeOptions(cfg, address)

  console.log(`Quoting route (vm=${vm}):`)
  console.log('  source address  :', address)
  console.log('  from chain      :', options.fromChain ?? '(auto-detected)')
  console.log('  to chain        :', options.toChain)
  console.log('  from token      :', options.fromToken)
  console.log('  to token        :', options.toToken ?? '(= source symbol)')
  console.log('  amount (base)   :', options.fromTokenAmount.toString())
  console.log()

  const quote = await protocol.quoteSwidge(options)
  console.log('Quote:')
  console.log('  fromTokenAmount :', quote.fromTokenAmount.toString())
  console.log('  toTokenAmount   :', quote.toTokenAmount.toString())
  console.log('  toTokenAmountMin:', quote.toTokenAmountMin.toString())
  if (quote.estimatedDuration !== undefined) {
    console.log('  est. duration   :', `${quote.estimatedDuration}s`)
  }
  console.log('  fees:')
  printFees(quote.fees)
}

async function cmdSwidge (vm) {
  const cfg = loadConfig()
  required('LAYERSWAP_TARGET_CHAIN')
  required('LAYERSWAP_SOURCE_TOKEN')
  required('LAYERSWAP_AMOUNT')

  const { Protocol, buildAccount } = await loadVm(vm)
  const account = await buildAccount(cfg)
  const address = await account.getAddress()
  const protocol = new Protocol(account, { apiUrl: cfg.apiUrl, apiKey: cfg.apiKey })

  const options = buildSwidgeOptions(cfg, address)

  console.log(`Swidging (vm=${vm}):`)
  console.log('  source address  :', address)
  console.log('  to chain        :', options.toChain)
  console.log('  from token      :', options.fromToken)
  console.log('  amount (base)   :', options.fromTokenAmount.toString())
  console.log()

  console.log('>> quoteSwidge…')
  const quote = await protocol.quoteSwidge(options)
  console.log(`   toTokenAmount=${quote.toTokenAmount} min=${quote.toTokenAmountMin}`)
  printFees(quote.fees)

  console.log('>> swidge…  (broadcasting real tx)')
  const result = await protocol.swidge(options)
  console.log(`   swap id : ${result.id}`)
  console.log(`   tx hash : ${result.hash}`)

  console.log(`\n>> polling getSwidgeStatus(${result.id}) + source-chain tx status every ${cfg.pollIntervalMs}ms (timeout ${cfg.pollTimeoutMs}ms)`)
  const startedAt = Date.now()
  let lastStatus = null
  let lastInputTxStatus = null
  let lastOutputTxHash = null

  while (Date.now() - startedAt < cfg.pollTimeoutMs) {
    let statusResult
    try {
      statusResult = await protocol.getSwidgeStatus(result.id)
    } catch (err) {
      console.warn('   status poll error:', err.message)
      await sleep(cfg.pollIntervalMs)
      continue
    }

    // Surface the destination payout tx as soon as Layerswap reports it — it can be
    // on-chain well before Layerswap confirms it and flips the swap to 'completed'.
    const pendingOutputTx = (statusResult.transactions ?? []).find((t) => t.type === 'destination')
    if (pendingOutputTx && pendingOutputTx.hash !== lastOutputTxHash) {
      console.log(`   destination tx broadcast: ${pendingOutputTx.hash} (${pendingOutputTx.chain ?? '?'}) — waiting for Layerswap to confirm it`)
      lastOutputTxHash = pendingOutputTx.hash
    }

    // Check the source-chain tx status independently. Layerswap surfaces 'failed' here
    // (e.g. smart-contract revert, dropped mempool tx) before the swap as a whole
    // transitions to a terminal state.
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

    if (statusResult.status !== lastStatus || inputTxStatus !== lastInputTxStatus) {
      console.log(`   [${new Date().toISOString()}] status=${statusResult.status} inputTx=${inputTxStatus ?? '(not indexed yet)'}`)
      lastStatus = statusResult.status
      lastInputTxStatus = inputTxStatus
    }

    // Short-circuit: if Layerswap reports the source-chain tx as failed, the swap
    // cannot complete. Print and exit with an error so the operator can investigate.
    if (inputTxStatus === 'failed') {
      console.error('\nSource-chain transaction failed on-chain.')
      console.error(`  vm                : ${vm}`)
      console.error(`  source address    : ${address}`)
      console.error(`  source tx hash    : ${result.hash}`)
      console.error(`  swap id           : ${result.id}`)
      console.error(`  swidge status     : ${statusResult.status}`)
      process.exit(3)
    }

    if (TERMINAL.has(statusResult.status)) {
      const outputTx = (statusResult.transactions ?? []).find((t) => t.type === 'destination')
      console.log('\nFinal state:')
      console.log(`  status            : ${statusResult.status}`)
      console.log(`  input tx status   : ${inputTxStatus ?? '(unknown)'}`)
      if (statusResult.status === 'completed' && outputTx) {
        console.log(`  destination tx    : ${outputTx.hash}`)
        console.log(`  destination chain : ${outputTx.chain ?? '(unknown)'}`)
      }
      if (statusResult.status !== 'completed') process.exitCode = 1
      return
    }

    await sleep(cfg.pollIntervalMs)
  }

  console.error(`\nTimed out. Last seen status=${lastStatus}, inputTx=${lastInputTxStatus}. Swap id: ${result.id}`)
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
  console.log()
  const mapped = buildStatusResult(response)
  console.log('WDK swidge status:', mapped.status)
  for (const tx of mapped.transactions ?? []) {
    console.log(`  ${String(tx.type).padEnd(12)} ${tx.hash} ${tx.chain ?? ''}`)
  }
}

async function main () {
  const { vm, rest } = parseArgs(process.argv.slice(2))
  const [command, ...args] = rest

  switch (command) {
    case 'networks': await cmdNetworks(); break
    case 'chains': await cmdChains(); break
    case 'quote': await cmdQuote(vm); break
    case 'swidge':
    case 'bridge': await cmdSwidge(vm); break
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
