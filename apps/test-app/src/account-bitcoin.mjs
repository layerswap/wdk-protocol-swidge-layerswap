// Resolves a WDK Bitcoin wallet account from env-supplied seed + transport config.

import { required } from './config.mjs'

// Derives the bitcoinjs-lib network name from the Layerswap source-chain name. The
// wallet must know the network up front because the address derivation differs per
// network (mainnet `bc1q…`, testnet `tb1q…`, regtest `bcrt1…` for BIP-84).
const LAYERSWAP_TO_BTC_NETWORK = {
  BITCOIN_MAINNET: 'bitcoin',
  BITCOIN_TESTNET: 'testnet',
  BITCOIN_REGTEST: 'regtest'
}

export async function buildAccount (cfg) {
  required('LAYERSWAP_SEED')
  required('LAYERSWAP_SOURCE_RPC')

  let WalletAccountBtc
  try {
    ({ WalletAccountBtc } = await import('@tetherto/wdk-wallet-btc'))
  } catch (err) {
    console.error('Run `pnpm install` first — @tetherto/wdk-wallet-btc not found.')
    process.exit(1)
  }

  const sourceChain = (cfg.sourceChainOverride ?? 'BITCOIN_MAINNET').toUpperCase()
  const network = LAYERSWAP_TO_BTC_NETWORK[sourceChain]
  if (!network) {
    console.error(`Unsupported LAYERSWAP_SOURCE_CHAIN '${sourceChain}' for Bitcoin. Expected one of: ${Object.keys(LAYERSWAP_TO_BTC_NETWORK).join(', ')}.`)
    process.exit(1)
  }

  const bip = Number(process.env.LAYERSWAP_BTC_BIP ?? 84)

  // The wallet's `client` config accepts blockbook-http or electrum descriptors. The
  // simplest CLI path is blockbook-http: point LAYERSWAP_SOURCE_RPC at a Blockbook URL
  // (e.g. https://btc.example.com/api).
  return new WalletAccountBtc(cfg.seed, cfg.derivationPath, {
    network,
    bip,
    client: { type: 'blockbook-http', clientConfig: { url: cfg.sourceRpc } }
  })
}
