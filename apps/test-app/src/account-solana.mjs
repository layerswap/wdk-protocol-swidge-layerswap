// Resolves a WDK Solana wallet account from env-supplied seed + RPC.

import { required } from './config.mjs'

export async function buildAccount (cfg) {
  required('LAYERSWAP_SEED')
  required('LAYERSWAP_SOURCE_RPC')

  let WalletAccountSolana
  try {
    ({ WalletAccountSolana } = await import('@tetherto/wdk-wallet-solana'))
  } catch (err) {
    console.error('Run `pnpm install` first — @tetherto/wdk-wallet-solana not found.')
    process.exit(1)
  }

  // Solana SLIP-0010 requires every path segment to be hardened. The shared
  // LAYERSWAP_DERIVATION_PATH default ("0'/0/0") is invalid for Solana; if the
  // user hasn't overridden it, swap in a Solana-shaped default.
  const path = cfg.derivationPath.split('/').every((seg) => seg.endsWith("'"))
    ? cfg.derivationPath
    : "0'/0'/0'"

  return await WalletAccountSolana.at(cfg.seed, path, { provider: cfg.sourceRpc })
}
