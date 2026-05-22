// Resolves a WDK EVM wallet account from env-supplied seed + RPC.

import { required } from './config.mjs'

export async function buildAccount (cfg) {
  required('LAYERSWAP_SEED')
  required('LAYERSWAP_SOURCE_RPC')

  let WalletManagerEvm
  try {
    ({ default: WalletManagerEvm } = await import('@tetherto/wdk-wallet-evm'))
  } catch (err) {
    console.error('Run `npm install` first — @tetherto/wdk-wallet-evm not found.')
    process.exit(1)
  }

  const wallet = new WalletManagerEvm(cfg.seed, { provider: cfg.sourceRpc })
  const account = await wallet.getAccount(cfg.derivationPath)
  return account
}
