// Resolves a WDK EVM wallet account from env-supplied seed + RPC.

import { required } from './config.mjs'

export async function buildAccount (cfg) {
  required('LAYERSWAP_SEED')
  required('LAYERSWAP_SOURCE_RPC')

  let WalletManagerEvm
  try {
    ({ default: WalletManagerEvm } = await import('@tetherto/wdk-wallet-evm'))
  } catch (err) {
    console.error('Run `pnpm install` first — @tetherto/wdk-wallet-evm not found.')
    process.exit(1)
  }

  const wallet = new WalletManagerEvm(cfg.seed, { provider: cfg.sourceRpc })
  // wdk-wallet >= 1.0.0-beta.16: getAccount(indexOrSignerName) no longer takes a
  // derivation path — path-based derivation moved to getAccountByPath(path).
  const account = typeof wallet.getAccountByPath === 'function'
    ? await wallet.getAccountByPath(cfg.derivationPath)
    : await wallet.getAccount(cfg.derivationPath)
  return account
}
