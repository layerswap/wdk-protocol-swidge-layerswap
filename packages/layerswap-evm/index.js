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

/** @typedef {import('@tetherto/wdk-wallet').ProviderErrorOptions} ProviderErrorOptions */

/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeProtocolConfig} SwidgeProtocolConfig */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeOptions} SwidgeOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeCommonOptions} SwidgeCommonOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeExactInOptions} SwidgeExactInOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeExactOutOptions} SwidgeExactOutOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeFeeType} SwidgeFeeType */
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
/** @typedef {import('@tetherto/wdk-wallet/protocols').BridgeOptions} BridgeOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').BridgeResult} BridgeResult */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwapOptions} SwapOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwapResult} SwapResult */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwapErrorOptions} SwapErrorOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').BridgeErrorOptions} BridgeErrorOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeErrorOptions} SwidgeErrorOptions */

/** @typedef {import('@tetherto/wdk-wallet-evm').WalletAccountEvm} WalletAccountEvm */
/** @typedef {import('@tetherto/wdk-wallet-evm').WalletAccountReadOnlyEvm} WalletAccountReadOnlyEvm */

/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').WalletAccountEvmErc4337} WalletAccountEvmErc4337 */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').WalletAccountReadOnlyEvmErc4337} WalletAccountReadOnlyEvmErc4337 */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletPaymasterTokenConfig} EvmErc4337WalletPaymasterTokenConfig */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletSponsorshipPolicyConfig} EvmErc4337WalletSponsorshipPolicyConfig */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletNativeCoinsConfig} EvmErc4337WalletNativeCoinsConfig */

/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapApiClientConfig} LayerswapApiClientConfig */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapApiError} LayerswapApiError */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapApiErrorDetails} LayerswapApiErrorDetails */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapNetwork} LayerswapNetwork */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapToken} LayerswapToken */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapQuote} LayerswapQuote */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapQuoteResponse} LayerswapQuoteResponse */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapGetQuoteParams} LayerswapGetQuoteParams */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapCreateSwapParams} LayerswapCreateSwapParams */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSwap} LayerswapSwap */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSwapResponse} LayerswapSwapResponse */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSwapTransaction} LayerswapSwapTransaction */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSwapStatusValue} LayerswapSwapStatusValue */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapDepositAction} LayerswapDepositAction */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapTransactionStatus} LayerswapTransactionStatus */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapTransactionStatusValue} LayerswapTransactionStatusValue */

/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapProtocolConfig} LayerswapProtocolConfig */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSwidgeOptions} LayerswapSwidgeOptions */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSpecificSwidgeOptions} LayerswapSpecificSwidgeOptions */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSwidgeConfig} LayerswapSwidgeConfig */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapBridgeConfig} LayerswapBridgeConfig */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapBridgeOptions} LayerswapBridgeOptions */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapBridgeResult} LayerswapBridgeResult */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSpecificBridgeResult} LayerswapSpecificBridgeResult */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapLegacyBridgeFees} LayerswapLegacyBridgeFees */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').GetTransactionStatusOptions} GetTransactionStatusOptions */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSwidgeRoute} LayerswapSwidgeRoute */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapDepositSwap} LayerswapDepositSwap */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapDepositContext} LayerswapDepositContext */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapPreparedDeposit} LayerswapPreparedDeposit */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapBroadcastDeposit} LayerswapBroadcastDeposit */

/** @typedef {import('./src/layerswap-protocol-evm.js').LayerswapEvmErc4337Overrides} LayerswapEvmErc4337Overrides */
/** @typedef {import('./src/layerswap-protocol-evm.js').LayerswapEvmSwidgeConfig} LayerswapEvmSwidgeConfig */
/** @typedef {import('./src/layerswap-protocol-evm.js').LayerswapEvmBridgeConfig} LayerswapEvmBridgeConfig */
/** @typedef {import('./src/layerswap-protocol-evm.js').LayerswapEvmDepositTransaction} LayerswapEvmDepositTransaction */
/** @typedef {import('./src/layerswap-protocol-evm.js').LayerswapEvmPreparedDeposit} LayerswapEvmPreparedDeposit */

export { default } from './src/layerswap-protocol-evm.js'

export { LayerswapApiClient, LayerswapSwidgeProtocol } from '@layerswap/wdk-protocol-swidge-layerswap-core'

export { SwidgeProtocol, ISwidgeProtocol, ISwapProtocol, IBridgeProtocol } from '@tetherto/wdk-wallet/protocols'

export { IWalletAccount, IWalletAccountReadOnly } from '@tetherto/wdk-wallet'

export {
  AccountRequiredError,
  BridgeError,
  BridgeErrorReason,
  DisposalError,
  InvalidTokenError,
  MaximumFeeExceededError,
  NoSuchElementError,
  NotImplementedError,
  ProviderError,
  ProviderRequiredError,
  ReadOnlyAccountRequiredError,
  SwapError,
  SwapErrorReason,
  SwidgeError,
  SwidgeErrorReason,
  ValueError
} from '@tetherto/wdk-wallet/protocols'

export { ProviderErrorReason } from '@tetherto/wdk-wallet'
