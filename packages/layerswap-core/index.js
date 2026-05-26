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
/** @typedef {import('./src/layerswap-api-client.js').LayerswapToken} LayerswapToken */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapNetwork} LayerswapNetwork */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapQuote} LayerswapQuote */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapDepositAction} LayerswapDepositAction */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapSwap} LayerswapSwap */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapSwapResponse} LayerswapSwapResponse */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapCreateSwapParams} LayerswapCreateSwapParams */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapGetQuoteParams} LayerswapGetQuoteParams */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapTransactionStatus} LayerswapTransactionStatus */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapTransactionStatusValue} LayerswapTransactionStatusValue */

export { default } from './src/layerswap-api-client.js'

export { default as LayerswapApiClient } from './src/layerswap-api-client.js'

export {
  resolveSourceNetwork,
  resolveNetworkByName,
  resolveToken,
  formatBaseUnits,
  parseDecimal
} from './src/networks.js'
