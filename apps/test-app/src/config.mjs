// Shared configuration loader.

export function required (name) {
  const value = process.env[name]
  if (!value || value.length === 0) {
    console.error(`Missing required env var: ${name}`)
    process.exit(1)
  }
  return value
}

export function optional (name, fallback) {
  const value = process.env[name]
  return value && value.length > 0 ? value : fallback
}

export function loadConfig () {
  const apiKeyRaw = process.env.LAYERSWAP_API_KEY

  return {
    apiUrl: optional('LAYERSWAP_API_URL', 'https://api-dev.layerswap.cloud'),
    // Default to the sandbox key only when the variable is absent. An explicitly
    // empty value omits X-LS-APIKEY, which the public production API requires;
    // sending the literal sandbox key to production returns API_KEY_FORBIDDEN.
    apiKey: apiKeyRaw === undefined ? 'sandbox' : (apiKeyRaw || undefined),
    sourceRpc: process.env.LAYERSWAP_SOURCE_RPC,
    seed: process.env.LAYERSWAP_SEED,
    derivationPath: optional('LAYERSWAP_DERIVATION_PATH', "0'/0/0"),
    targetChain: process.env.LAYERSWAP_TARGET_CHAIN,
    sourceToken: process.env.LAYERSWAP_SOURCE_TOKEN,
    destinationToken: process.env.LAYERSWAP_DEST_TOKEN,
    amountStr: process.env.LAYERSWAP_AMOUNT,
    recipient: process.env.LAYERSWAP_RECIPIENT,
    sourceChainOverride: process.env.LAYERSWAP_SOURCE_CHAIN,
    btcFeeRate: process.env.LAYERSWAP_BTC_FEE_RATE,
    pollIntervalMs: Number(optional('LAYERSWAP_POLL_INTERVAL_MS', '10000')),
    pollTimeoutMs: Number(optional('LAYERSWAP_POLL_TIMEOUT_MS', '900000'))
  }
}
