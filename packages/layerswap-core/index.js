// Copyright 2026 Aren <aren@bransfer.io>
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/** @typedef {import('./src/layerswap-api-client.js').LayerswapApiClientConfig} LayerswapApiClientConfig */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapApiError} LayerswapApiError */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapApiErrorDetails} LayerswapApiErrorDetails */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapToken} LayerswapToken */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapNetwork} LayerswapNetwork */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapQuote} LayerswapQuote */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapQuoteResponse} LayerswapQuoteResponse */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapDepositAction} LayerswapDepositAction */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapSwap} LayerswapSwap */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapSwapResponse} LayerswapSwapResponse */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapCreateSwapParams} LayerswapCreateSwapParams */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapGetQuoteParams} LayerswapGetQuoteParams */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapTransactionStatus} LayerswapTransactionStatus */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapTransactionStatusValue} LayerswapTransactionStatusValue */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapSwapStatusValue} LayerswapSwapStatusValue */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapSwapTransaction} LayerswapSwapTransaction */

/** @typedef {import('./src/swidge.js').LayerswapSwidgeStatus} LayerswapSwidgeStatus */
/** @typedef {import('./src/swidge.js').LayerswapSwidgeFee} LayerswapSwidgeFee */
/** @typedef {import('./src/swidge.js').LayerswapSwidgeTransaction} LayerswapSwidgeTransaction */
/** @typedef {import('./src/swidge.js').LayerswapSwidgeQuote} LayerswapSwidgeQuote */
/** @typedef {import('./src/swidge.js').LayerswapSwidgeStatusResult} LayerswapSwidgeStatusResult */
/** @typedef {import('./src/swidge.js').LayerswapSwidgeStatusOptions} LayerswapSwidgeStatusOptions */
/** @typedef {import('./src/swidge.js').LayerswapSwidgeSupportedChain} LayerswapSwidgeSupportedChain */
/** @typedef {import('./src/swidge.js').LayerswapSwidgeSupportedToken} LayerswapSwidgeSupportedToken */
/** @typedef {import('./src/swidge.js').LayerswapSwidgeSupportedTokensOptions} LayerswapSwidgeSupportedTokensOptions */
/** @typedef {import('./src/swidge.js').LayerswapFeeGuardsConfig} LayerswapFeeGuardsConfig */

/** @typedef {import('./src/layerswap-swidge-protocol.js').LayerswapProtocolConfig} LayerswapProtocolConfig */
/** @typedef {import('./src/layerswap-swidge-protocol.js').LayerswapSwidgeOptions} LayerswapSwidgeOptions */
/** @typedef {import('./src/layerswap-swidge-protocol.js').LayerswapSpecificSwidgeOptions} LayerswapSpecificSwidgeOptions */
/** @typedef {import('./src/layerswap-swidge-protocol.js').LayerswapSwidgeConfig} LayerswapSwidgeConfig */
/** @typedef {import('./src/layerswap-swidge-protocol.js').LayerswapBridgeConfig} LayerswapBridgeConfig */
/** @typedef {import('./src/layerswap-swidge-protocol.js').LayerswapBridgeOptions} LayerswapBridgeOptions */
/** @typedef {import('./src/layerswap-swidge-protocol.js').LayerswapBridgeResult} LayerswapBridgeResult */
/** @typedef {import('./src/layerswap-swidge-protocol.js').LayerswapSpecificBridgeResult} LayerswapSpecificBridgeResult */
/** @typedef {import('./src/layerswap-swidge-protocol.js').GetTransactionStatusOptions} GetTransactionStatusOptions */
/** @typedef {import('./src/layerswap-swidge-protocol.js').LayerswapSwidgeRoute} LayerswapSwidgeRoute */
/** @typedef {import('./src/layerswap-swidge-protocol.js').LayerswapDepositSwap} LayerswapDepositSwap */
/** @typedef {import('./src/layerswap-swidge-protocol.js').LayerswapDepositContext} LayerswapDepositContext */
/** @typedef {import('./src/layerswap-swidge-protocol.js').LayerswapPreparedDeposit} LayerswapPreparedDeposit */
/** @typedef {import('./src/layerswap-swidge-protocol.js').LayerswapBroadcastDeposit} LayerswapBroadcastDeposit */
/** @typedef {import('./src/layerswap-swidge-protocol.js').LayerswapLegacyBridgeFees} LayerswapLegacyBridgeFees */

export { default } from './src/layerswap-api-client.js'

export { default as LayerswapSwidgeProtocol } from './src/layerswap-swidge-protocol.js'

export { default as LayerswapApiClient } from './src/layerswap-api-client.js'

export {
  resolveSourceNetwork,
  resolveNetworkByName,
  resolveToken,
  formatBaseUnits,
  parseDecimal
} from './src/networks.js'

export {
  mapSwapStatus,
  mapSwapTransactions,
  deriveSwidgeStatus,
  buildStatusResult,
  buildSupportedChains,
  buildSupportedTokens,
  buildQuoteFees,
  buildSwidgeQuote,
  parseCompletionTime,
  formatSlippage,
  assertFeeGuards,
  normalizeWalletError,
  toBigIntOption
} from './src/swidge.js'
