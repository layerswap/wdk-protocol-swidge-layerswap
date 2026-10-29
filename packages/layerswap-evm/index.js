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

/** @typedef {import('@tetherto/wdk-wallet-evm').WalletAccountEvm} WalletAccountEvm */
/** @typedef {import('@tetherto/wdk-wallet-evm').WalletAccountReadOnlyEvm} WalletAccountReadOnlyEvm */

/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').WalletAccountEvmErc4337} WalletAccountEvmErc4337 */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').WalletAccountReadOnlyEvmErc4337} WalletAccountReadOnlyEvmErc4337 */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletPaymasterTokenConfig} EvmErc4337WalletPaymasterTokenConfig */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletSponsorshipPolicyConfig} EvmErc4337WalletSponsorshipPolicyConfig */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletNativeCoinsConfig} EvmErc4337WalletNativeCoinsConfig */

/** @typedef {import('./src/layerswap-protocol-evm.js').LayerswapEvmErc4337Overrides} LayerswapEvmErc4337Overrides */
/** @typedef {import('./src/layerswap-protocol-evm.js').LayerswapEvmSwidgeConfig} LayerswapEvmSwidgeConfig */
/** @typedef {import('./src/layerswap-protocol-evm.js').LayerswapEvmBridgeConfig} LayerswapEvmBridgeConfig */
/** @typedef {import('./src/layerswap-protocol-evm.js').LayerswapEvmDepositTransaction} LayerswapEvmDepositTransaction */
/** @typedef {import('./src/layerswap-protocol-evm.js').LayerswapEvmPreparedDeposit} LayerswapEvmPreparedDeposit */

export { default } from './src/layerswap-protocol-evm.js'

export * from '@layerswap/wdk-protocol-swidge-layerswap-core/protocol'
