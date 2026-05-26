// Resolves a WDK Tron wallet account from env-supplied seed + RPC.

import { required } from './config.mjs'

export async function buildAccount (cfg) {
  required('LAYERSWAP_SEED')
  required('LAYERSWAP_SOURCE_RPC')

  let WalletAccountTron
  try {
    ({ WalletAccountTron } = await import('@tetherto/wdk-wallet-tron'))
  } catch (err) {
    console.error('Run `pnpm install` first — @tetherto/wdk-wallet-tron not found.')
    process.exit(1)
  }

  // @tetherto/wdk-wallet-tron prepends the BIP-44 prefix `m/44'/195'` internally,
  // so callers pass the post-prefix segment (e.g. "0'/0/0"). The shared default
  // LAYERSWAP_DERIVATION_PATH ("0'/0/0") happens to be valid Tron — but if the
  // user has overridden it to a Solana-style hardened-only path ("0'/0'/0'"),
  // accept it as-is; the wallet only requires segments to be a valid HDKey path.
  return new WalletAccountTron(cfg.seed, cfg.derivationPath, { provider: cfg.sourceRpc })
}
