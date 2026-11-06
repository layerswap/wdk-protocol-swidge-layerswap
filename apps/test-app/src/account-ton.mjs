// Resolves a WDK TON wallet account from env-supplied seed + RPC.

import { required } from './config.mjs'

export async function buildAccount (cfg) {
  required('LAYERSWAP_SEED')
  required('LAYERSWAP_SOURCE_RPC')

  let WalletAccountTon
  try {
    ({ WalletAccountTon } = await import('@tetherto/wdk-wallet-ton'))
  } catch (err) {
    console.error('Run `pnpm install` first — @tetherto/wdk-wallet-ton not found.')
    process.exit(1)
  }

  // The wallet's `tonClient.secretKey` is forwarded to `TonClient({ apiKey })` —
  // it's the toncenter `X-API-Key`, not the wallet's signing key. Without it,
  // toncenter throttles to ~1 req/s and the swidge() flow (which makes 5+
  // sequential RPC calls) trips a 429. Grab a free key from @toncenterbot on
  // Telegram and set LAYERSWAP_TON_API_KEY.
  const tonApiKey = process.env.LAYERSWAP_TON_API_KEY

  // @tetherto/wdk-wallet-ton prepends the BIP-44 prefix `m/44'/607'` internally,
  // so callers pass the post-prefix segment (e.g. "0'/0/0").
  const account = new WalletAccountTon(cfg.seed, cfg.derivationPath, {
    tonClient: {
      url: cfg.sourceRpc,
      ...(tonApiKey ? { secretKey: tonApiKey } : {})
    }
  })

  // Without a key, space toncenter calls out to stay under its ~1 req/s limit. Every
  // TonClient request goes through `api.doCall`, and the protocol reuses this client.
  if (!tonApiKey && account._tonClient?.api) throttle(account._tonClient.api, 1100)

  return account
}

function throttle (api, intervalMs) {
  const doCall = api.doCall.bind(api)
  let next = Promise.resolve()
  api.doCall = (...args) => {
    const call = next.then(() => doCall(...args))
    next = call.catch(() => {}).then(() => new Promise((resolve) => setTimeout(resolve, intervalMs)))
    return call
  }
}
