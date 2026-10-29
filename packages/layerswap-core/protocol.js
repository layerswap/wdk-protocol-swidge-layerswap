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

// The public API shared by every `@layerswap/wdk-protocol-swidge-layerswap-<vm>` package:
// the types their methods take or return (incl. the inherited `swap`/`quoteSwap` and the
// base class hooks), the API client returned by `getApiClient()` and the types of its
// methods, the base protocol class, and the WDK errors their methods throw. Each VM package
// re-exports this module from its own entry point (`export * from '…-core/protocol'`).

/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeProtocolConfig} SwidgeProtocolConfig */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeOptions} SwidgeOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeQuote} SwidgeQuote */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeResult} SwidgeResult */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeFee} SwidgeFee */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeTransaction} SwidgeTransaction */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeStatus} SwidgeStatus */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeStatusOptions} SwidgeStatusOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeStatusResult} SwidgeStatusResult */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedChain} SwidgeSupportedChain */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedToken} SwidgeSupportedToken */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedTokensOptions} SwidgeSupportedTokensOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').BridgeResult} BridgeResult */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwapOptions} SwapOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwapResult} SwapResult */

/** @typedef {import('./src/layerswap-api-client.js').LayerswapApiClientConfig} LayerswapApiClientConfig */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapApiError} LayerswapApiError */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapApiErrorDetails} LayerswapApiErrorDetails */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapNetwork} LayerswapNetwork */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapToken} LayerswapToken */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapQuote} LayerswapQuote */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapQuoteResponse} LayerswapQuoteResponse */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapGetQuoteParams} LayerswapGetQuoteParams */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapCreateSwapParams} LayerswapCreateSwapParams */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapSwap} LayerswapSwap */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapSwapResponse} LayerswapSwapResponse */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapSwapTransaction} LayerswapSwapTransaction */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapSwapStatusValue} LayerswapSwapStatusValue */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapDepositAction} LayerswapDepositAction */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapTransactionStatus} LayerswapTransactionStatus */
/** @typedef {import('./src/layerswap-api-client.js').LayerswapTransactionStatusValue} LayerswapTransactionStatusValue */

/** @typedef {import('./src/layerswap-swidge-protocol.js').LayerswapProtocolConfig} LayerswapProtocolConfig */
/** @typedef {import('./src/layerswap-swidge-protocol.js').LayerswapSwidgeOptions} LayerswapSwidgeOptions */
/** @typedef {import('./src/layerswap-swidge-protocol.js').LayerswapSpecificSwidgeOptions} LayerswapSpecificSwidgeOptions */
/** @typedef {import('./src/layerswap-swidge-protocol.js').LayerswapSwidgeConfig} LayerswapSwidgeConfig */
/** @typedef {import('./src/layerswap-swidge-protocol.js').LayerswapBridgeConfig} LayerswapBridgeConfig */
/** @typedef {import('./src/layerswap-swidge-protocol.js').LayerswapBridgeOptions} LayerswapBridgeOptions */
/** @typedef {import('./src/layerswap-swidge-protocol.js').LayerswapBridgeResult} LayerswapBridgeResult */
/** @typedef {import('./src/layerswap-swidge-protocol.js').LayerswapSpecificBridgeResult} LayerswapSpecificBridgeResult */
/** @typedef {import('./src/layerswap-swidge-protocol.js').LayerswapLegacyBridgeFees} LayerswapLegacyBridgeFees */
/** @typedef {import('./src/layerswap-swidge-protocol.js').GetTransactionStatusOptions} GetTransactionStatusOptions */
/** @typedef {import('./src/layerswap-swidge-protocol.js').LayerswapSwidgeRoute} LayerswapSwidgeRoute */
/** @typedef {import('./src/layerswap-swidge-protocol.js').LayerswapDepositSwap} LayerswapDepositSwap */
/** @typedef {import('./src/layerswap-swidge-protocol.js').LayerswapDepositContext} LayerswapDepositContext */
/** @typedef {import('./src/layerswap-swidge-protocol.js').LayerswapPreparedDeposit} LayerswapPreparedDeposit */
/** @typedef {import('./src/layerswap-swidge-protocol.js').LayerswapBroadcastDeposit} LayerswapBroadcastDeposit */

export { default as LayerswapApiClient } from './src/layerswap-api-client.js'

export { default as LayerswapSwidgeProtocol } from './src/layerswap-swidge-protocol.js'

export {
  AccountRequiredError,
  BridgeError,
  BridgeErrorReason,
  DisposalError,
  InvalidTokenError,
  MaximumFeeExceededError,
  NoSuchElementError,
  ProviderError,
  ProviderRequiredError,
  SwapError,
  SwapErrorReason,
  SwidgeError,
  SwidgeErrorReason,
  ValueError
} from '@tetherto/wdk-wallet/protocols'

export { ProviderErrorReason } from '@tetherto/wdk-wallet'
