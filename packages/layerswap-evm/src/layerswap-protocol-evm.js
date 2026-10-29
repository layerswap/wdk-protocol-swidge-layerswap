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

'use strict'

import { ProviderErrorReason } from '@tetherto/wdk-wallet'
import {
  ProviderError,
  ProviderRequiredError,
  SwidgeError,
  SwidgeErrorReason
} from '@tetherto/wdk-wallet/protocols'
import { isError } from 'ethers'

import {
  LayerswapSwidgeProtocol,
  resolveSourceNetwork,
  normalizeWalletError
} from '@layerswap/wdk-protocol-swidge-layerswap-core'

const CALL_DATA_PATTERN = /^0x(?:[0-9a-f]{2})*$/i

/** @typedef {import('ethers').Provider} Provider */

/** @typedef {import('@tetherto/wdk-wallet-evm').WalletAccountEvm} WalletAccountEvm */
/** @typedef {import('@tetherto/wdk-wallet-evm').WalletAccountReadOnlyEvm} WalletAccountReadOnlyEvm */

/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').WalletAccountEvmErc4337} WalletAccountEvmErc4337 */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').WalletAccountReadOnlyEvmErc4337} WalletAccountReadOnlyEvmErc4337 */

/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletPaymasterTokenConfig} EvmErc4337WalletPaymasterTokenConfig */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletSponsorshipPolicyConfig} EvmErc4337WalletSponsorshipPolicyConfig */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletNativeCoinsConfig} EvmErc4337WalletNativeCoinsConfig */

/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapNetwork} LayerswapNetwork */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapToken} LayerswapToken */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapProtocolConfig} LayerswapProtocolConfig */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSwidgeOptions} LayerswapSwidgeOptions */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSwidgeConfig} LayerswapSwidgeConfig */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapBridgeConfig} LayerswapBridgeConfig */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapBridgeOptions} LayerswapBridgeOptions */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSwidgeRoute} LayerswapSwidgeRoute */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapDepositContext} LayerswapDepositContext */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapBroadcastDeposit} LayerswapBroadcastDeposit */

/**
 * Wallet configuration overrides of an erc-4337 account, forwarded to `sendTransaction`.
 *
 * @typedef {Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig>} LayerswapEvmErc4337Overrides
 */

/**
 * Optional execution configuration of the `bridge` method: the 'bridgeMaxFee' option and,
 * with an erc-4337 account, the wallet configuration overrides.
 *
 * @typedef {LayerswapBridgeConfig & LayerswapEvmErc4337Overrides} LayerswapEvmBridgeConfig
 */

/**
 * Optional execution configuration of the `swidge` method: the WDK swidge fee guards, the
 * 'bridgeMaxFee' option and, with an erc-4337 account, the wallet configuration overrides.
 *
 * @typedef {LayerswapSwidgeConfig & LayerswapEvmErc4337Overrides} LayerswapEvmSwidgeConfig
 */

/**
 * @typedef {Object} LayerswapEvmDepositTransaction
 * @property {string} to - The Layerswap deposit address (or the token contract for erc-20 deposits).
 * @property {bigint} value - The amount of native tokens to send (in base unit).
 * @property {string} data - The call data.
 */

/**
 * @typedef {Object} LayerswapEvmPreparedDeposit
 * @property {LayerswapEvmDepositTransaction} tx - The deposit transaction to broadcast.
 * @property {bigint} fee - The estimated gas cost of the deposit (in wei).
 */

/**
 * WDK swidge protocol that drives a Layerswap swap from an EVM wallet account (standard
 * or erc-4337). The chain-agnostic swidge logic lives in `LayerswapSwidgeProtocol`
 * (`@layerswap/wdk-protocol-swidge-layerswap-core`); this class only implements the EVM
 * specifics: source chain detection and the deposit transaction.
 *
 * The source chain is detected through the provider the wallet account was built with
 * (`account._provider`), so every provider shape supported by the wallet — rpc url,
 * eip-1193 provider, ethers provider or a fail-over list of them — works as-is.
 *
 * @extends {LayerswapSwidgeProtocol<LayerswapSwidgeOptions, LayerswapEvmSwidgeConfig, LayerswapBridgeOptions, LayerswapEvmBridgeConfig>}
 */
export default class LayerswapProtocolEvm extends LayerswapSwidgeProtocol {
  /**
   * Creates a new swidge protocol for chain/token discovery only, without a wallet account.
   *
   * @overload
   * @param {undefined} [account] - No account; only discovery and `fromChain`-scoped quotes work.
   * @param {LayerswapProtocolConfig} [config] - The layerswap protocol configuration.
   */

  /**
   * Creates a new read-only interface to the layerswap protocol for evm blockchains.
   *
   * @overload
   * @param {WalletAccountReadOnlyEvm | WalletAccountReadOnlyEvmErc4337} account - The wallet account to use to interact with the protocol.
   * @param {LayerswapProtocolConfig} [config] - The layerswap protocol configuration.
   */

  /**
   * Creates a new interface to the layerswap protocol for evm blockchains.
   *
   * @overload
   * @param {WalletAccountEvm | WalletAccountEvmErc4337} account - The wallet account to use to interact with the protocol.
   * @param {LayerswapProtocolConfig} [config] - The layerswap protocol configuration.
   */
  constructor (account, config = {}) {
    super(account, config)

    /**
     * The ethers provider the wallet account was built with. Reused as-is instead of
     * rebuilding one from `account._config.provider`, so that every provider shape the
     * wallet supports (rpc url, eip-1193 provider, ethers provider, or a list of them
     * wrapped in the wdk fail-over provider) is honoured.
     *
     * @private
     * @type {Provider | undefined}
     */
    this._provider = account?._provider

    /**
     * @private
     * @type {bigint | undefined}
     */
    this._chainId = undefined
  }

  /** @protected */
  get _nativeTokenSymbol () {
    return 'ETH'
  }

  /**
   * Detects the source network from the chain id of the account's provider.
   *
   * @protected
   * @returns {Promise<LayerswapNetwork>} The source network.
   * @throws {ValueError} If Layerswap does not support the connected chain.
   * @throws {ProviderRequiredError} If the account is not connected to a provider.
   * @throws {ProviderError} If the provider fails to report the chain id.
   */
  async _detectSourceNetwork () {
    const chainId = await this._getChainId()
    return resolveSourceNetwork(this._client, chainId)
  }

  /**
   * Estimates the source-chain gas of the deposit without creating a swap. Uses
   * `quoteTransfer` for erc-20 tokens and `quoteSendTransaction` for native sends; both
   * yield gas figures representative of the actual deposit transaction.
   *
   * @protected
   * @param {LayerswapSwidgeRoute} route - The resolved swidge route.
   * @param {bigint} amount - The input amount in source-token base units.
   * @param {string} sourceAddress - The address of the bound account.
   * @returns {Promise<bigint | undefined>} The estimated gas, in wei.
   */
  async _quoteSourceGas (route, amount, sourceAddress) {
    const { sourceToken } = route

    if (this._isErc20(sourceToken)) {
      if (typeof this._account.quoteTransfer !== 'function') return undefined
      const { fee } = await this._account.quoteTransfer({ token: sourceToken.contract, recipient: sourceAddress, amount })
      return fee
    }

    if (typeof this._account.quoteSendTransaction !== 'function') return undefined
    const { fee } = await this._account.quoteSendTransaction({ to: sourceAddress, value: amount })
    return fee
  }

  /**
   * Builds the deposit transaction from the Layerswap deposit action, and quotes its gas.
   *
   * @protected
   * @param {LayerswapDepositContext} context - The deposit context.
   * @returns {Promise<LayerswapEvmPreparedDeposit>} The prepared deposit.
   * @throws {ProviderError} If the deposit action is malformed, or the provider fails.
   * @throws {SwidgeError} If the account has insufficient funds.
   */
  async _prepareDeposit ({ action, route, fromTokenAmount, config }) {
    if (!action.to_address) {
      throw new ProviderError('Layerswap deposit action is missing a destination address.', {
        reason: ProviderErrorReason.INTERNAL_SERVER_ERROR
      })
    }

    const isErc20 = this._isErc20(route.sourceToken)
    const callData = this._parseCallData(action.call_data, isErc20)

    /** @type {LayerswapEvmDepositTransaction} */
    const tx = {
      to: action.to_address,
      value: isErc20 ? 0n : this._parseDepositAmount(action.amount_in_base_units, fromTokenAmount),
      data: callData
    }

    const { fee } = await this._callWallet(() => this._isErc4337Account(this._account)
      ? this._account.quoteSendTransaction([tx], config)
      : this._account.quoteSendTransaction(tx))

    return { tx, fee }
  }

  /**
   * Broadcasts the deposit transaction. With an erc-4337 account, the wallet configuration
   * overrides are forwarded to `sendTransaction`.
   *
   * @protected
   * @param {LayerswapEvmPreparedDeposit} deposit - The prepared deposit.
   * @param {LayerswapEvmSwidgeConfig} [config] - The swidge execution configuration.
   * @returns {Promise<LayerswapBroadcastDeposit>} The broadcast deposit.
   * @throws {ProviderError} If the provider fails to broadcast the deposit.
   * @throws {SwidgeError} If the account has insufficient funds.
   * @throws {MaximumFeeExceededError} If the wallet rejects the transaction fee.
   */
  async _sendDeposit ({ tx }, config) {
    const { hash } = await this._callWallet(() => this._isErc4337Account(this._account)
      ? this._account.sendTransaction([tx], config)
      : this._account.sendTransaction(tx))

    return { hash }
  }

  /**
   * Runs a wallet account (or provider) call, normalizing its errors. Insufficient-funds
   * rejections of the node become a `SwidgeError` with reason `INSUFFICIENT_BALANCE`.
   *
   * @protected
   * @template T
   * @param {() => Promise<T>} call - The wallet call.
   * @returns {Promise<T>} The call's result.
   * @throws {SwidgeError} If the account has insufficient funds.
   * @throws {ProviderError} If the call fails with an error outside of the swidge contract.
   */
  async _callWallet (call) {
    try {
      return await call()
    } catch (error) {
      if (isError(error, 'INSUFFICIENT_FUNDS')) {
        throw new SwidgeError('The account has insufficient funds to perform the swidge.', {
          reason: SwidgeErrorReason.INSUFFICIENT_BALANCE,
          cause: error
        })
      }

      throw normalizeWalletError(error)
    }
  }

  /**
   * Reads the source chain id via the account's provider. Cached for the lifetime of the
   * protocol instance.
   *
   * @private
   * @returns {Promise<bigint>} The chain id.
   * @throws {ProviderRequiredError} If the account is not connected to a provider.
   * @throws {ProviderError} If the provider fails to report the chain id.
   */
  async _getChainId () {
    if (this._chainId !== undefined) {
      return this._chainId
    }

    if (!this._provider) {
      throw new ProviderRequiredError("The 'fromChain' option is required when the protocol has no connected provider to detect the source chain from.")
    }

    const network = await this._callWallet(() => this._provider.getNetwork())
    this._chainId = network.chainId
    return this._chainId
  }

  /**
   * Parses the call data of a Layerswap deposit action. An erc-20 deposit is a call to the
   * token contract, so it cannot be sent without call data; a native deposit may have none.
   *
   * @private
   * @param {unknown} callData - The call data of the deposit action.
   * @param {boolean} isErc20 - True if the source token is an erc-20 token.
   * @returns {string} The call data (`'0x'` when a native deposit has none).
   * @throws {ProviderError} If the call data is malformed, or missing for an erc-20 deposit.
   */
  _parseCallData (callData, isErc20) {
    const isEmpty = callData === undefined || callData === null || callData === '' || callData === '0x'

    if (isEmpty && !isErc20) {
      return '0x'
    }

    if (isEmpty || typeof callData !== 'string' || !CALL_DATA_PATTERN.test(callData)) {
      throw new ProviderError(`Layerswap returned invalid call data '${callData}' for an ${isErc20 ? 'erc-20' : 'native'} deposit.`, {
        reason: ProviderErrorReason.INTERNAL_SERVER_ERROR
      })
    }

    return callData
  }

  /**
   * @private
   * @param {LayerswapToken} token - The token.
   * @returns {boolean} True if the token is an erc-20 token (has a contract address).
   */
  _isErc20 (token) {
    return typeof token.contract === 'string' && token.contract.length > 0
  }

  /**
   * Tests whether the bound account is an ERC-4337 wallet account. ERC-4337 uses the
   * array-form `sendTransaction([tx], config)`, standard EVM the single-form
   * `sendTransaction(tx)`. Matched by class name (preserved across duplicate copies of the
   * wallet package) to dodge the same duplicate-copy `instanceof` failure as
   * `_isWritableAccount`.
   *
   * @private
   * @param {unknown} account - The bound account.
   * @returns {boolean} True if the account is an erc-4337 account.
   */
  _isErc4337Account (account) {
    const proto = account != null ? Object.getPrototypeOf(account) : null
    const ctor = proto && proto.constructor
    return Boolean(ctor && ctor.name === 'WalletAccountEvmErc4337')
  }
}
