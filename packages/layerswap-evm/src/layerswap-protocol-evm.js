// Copyright 2026 Layerswap Labs, Inc.
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

import { BridgeProtocol } from '@tetherto/wdk-wallet/protocols'
import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'
import { WalletAccountEvmErc4337 } from '@tetherto/wdk-wallet-evm-erc-4337'
import { JsonRpcProvider, BrowserProvider } from 'ethers'

import LayerswapApiClient from './layerswap-api-client.js'
import {
  resolveSourceNetwork,
  resolveNetworkByName,
  resolveToken,
  formatBaseUnits,
  parseDecimal
} from './networks.js'

/** @typedef {import('@tetherto/wdk-wallet/protocols').BridgeProtocolConfig} BridgeProtocolConfig */
/** @typedef {import('@tetherto/wdk-wallet/protocols').BridgeResult} BridgeResult */

/** @typedef {import('@tetherto/wdk-wallet-evm').WalletAccountReadOnlyEvm} WalletAccountReadOnlyEvm */

/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').WalletAccountReadOnlyEvmErc4337} WalletAccountReadOnlyEvmErc4337 */

/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletPaymasterTokenConfig} EvmErc4337WalletPaymasterTokenConfig */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletSponsorshipPolicyConfig} EvmErc4337WalletSponsorshipPolicyConfig */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletNativeCoinsConfig} EvmErc4337WalletNativeCoinsConfig */

/** @typedef {import('./layerswap-api-client.js').LayerswapNetwork} LayerswapNetwork */
/** @typedef {import('./layerswap-api-client.js').LayerswapToken} LayerswapToken */
/** @typedef {import('./layerswap-api-client.js').LayerswapDepositAction} LayerswapDepositAction */
/** @typedef {import('./layerswap-api-client.js').LayerswapSwap} LayerswapSwap */
/** @typedef {import('./layerswap-api-client.js').LayerswapQuote} LayerswapQuote */

/**
 * @typedef {Object} LayerswapProtocolConfig
 * @property {string} [apiKey]                - Optional Layerswap API key. When set, sent as the
 *                                              `X-LS-APIKEY` header for rate-limit / partner attribution.
 * @property {string} [apiUrl]                - Layerswap API base URL. Default: `https://api.layerswap.io`.
 * @property {number | bigint} [bridgeMaxFee] - Maximum acceptable Layerswap swap fee, expressed in
 *                                              *source-token base units*. Compared against `bridgeFee`
 *                                              before broadcasting the deposit transaction.
 * @property {number} [requestTimeoutMs]      - HTTP timeout for Layerswap API calls. Default: 30000.
 */

/**
 * @typedef {Object} BridgeOptions
 * @property {string} targetChain             - Layerswap destination network name. Uses the
 *                                              `<CHAIN>_<ENV>` uppercase convention, e.g.
 *                                              `'ETHEREUM_MAINNET'`, `'ARBITRUM_MAINNET'`,
 *                                              `'ARBITRUM_SEPOLIA'`. Matching is case-insensitive
 *                                              but the canonical form is uppercase.
 * @property {string} recipient               - Destination-chain recipient address, in the
 *                                              destination chain's native format (Layerswap is
 *                                              HTTP-orchestrated and accepts the native string).
 * @property {string} token                   - Source token: contract address (0x…) OR Layerswap symbol.
 * @property {number | bigint} amount         - Source amount in base units (e.g., wei for ETH).
 * @property {string} [destinationToken]      - Destination token (address or symbol). Defaults to the
 *                                              source token's symbol.
 * @property {string} [sourceChain]           - Override auto-detected source network name.
 * @property {boolean} [refuel]               - Request a native-gas drop on the destination chain.
 * @property {string} [slippage]              - Slippage tolerance percentage, e.g. '0.5'.
 * @property {string} [referenceId]           - External reference id for the created swap.
 * @property {string} [refundAddress]         - Refund address used if the swap fails after deposit.
 */

/**
 * @typedef {BridgeResult & { swapId: string }} LayerswapBridgeResult
 */

/**
 * Bridge protocol that drives a Layerswap swap from an EVM wallet account.
 *
 * Unlike on-chain bridges (e.g., LayerZero OFTs) this protocol is HTTP-orchestrated:
 *   1. POST /api/v2/swaps to create a swap and receive deposit instructions.
 *   2. Submit the deposit transaction from the user's wallet to Layerswap's deposit address
 *      using the API-provided calldata.
 *   3. Layerswap performs the destination-chain payout off-chain.
 *
 * Semantic note: `BridgeResult.bridgeFee` is documented in `@tetherto/wdk-wallet` as
 * "native tokens paid to the bridge protocol". Layerswap deducts its fee from the
 * source-token amount instead, so we return `bridgeFee` in **source-token base units**.
 * Do not naively add `fee` (native gas) and `bridgeFee` together — they are in different
 * units. The `bridgeMaxFee` config compares against `bridgeFee` only.
 */
export default class LayerswapProtocolEvm extends BridgeProtocol {
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
     * @private
     * @type {LayerswapApiClient}
     */
    this._client = new LayerswapApiClient({
      apiKey: config.apiKey,
      apiUrl: config.apiUrl,
      requestTimeoutMs: config.requestTimeoutMs
    })

    if (account._config && account._config.provider) {
      const { provider } = account._config

      /** @private */
      this._provider = typeof provider === 'string'
        ? new JsonRpcProvider(provider)
        : new BrowserProvider(provider)
    }

    /**
     * @private
     * @type {bigint | undefined}
     */
    this._chainId = undefined
  }

  /**
   * Bridges a token to a different blockchain via Layerswap.
   *
   * Resolves once the source-chain deposit transaction has been broadcast. Layerswap
   * finishes the destination-chain payout asynchronously; callers can use
   * `getApiClient().getSwap(swapId)` to track destination delivery, using the `swapId`
   * field on the returned result.
   *
   * Semantic note: `bridgeFee` is in **source-token base units**, not native wei.
   * See class JSDoc for the rationale.
   *
   * @param {BridgeOptions} options - The bridge's options.
   * @param {Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig> & Pick<LayerswapProtocolConfig, 'bridgeMaxFee'>} [config] - If
   *   the protocol has been initialized with an erc-4337 wallet account, it can be used to
   *   override its configuration options along with the 'bridgeMaxFee' option.
   * @returns {Promise<LayerswapBridgeResult>} The bridge's result, augmented with the Layerswap swap id.
   */
  async bridge (options, config) {
    if (!(this._account instanceof WalletAccountEvm) && !(this._account instanceof WalletAccountEvmErc4337)) {
      throw new Error("The 'bridge(options)' method requires the protocol to be initialized with a non read-only account.")
    }

    if (!this._provider) {
      throw new Error('The wallet must be connected to a provider in order to perform bridge operations.')
    }

    const { depositTx, bridgeFee, swapId } = await this._buildDepositTransaction(options)

    if (this._account instanceof WalletAccountEvmErc4337) {
      const { bridgeMaxFee } = { ...this._config, ...config }

      if (bridgeMaxFee !== undefined && bridgeFee >= BigInt(bridgeMaxFee)) {
        throw new Error('Exceeded maximum fee cost for bridge operation.')
      }

      const { fee } = await this._account.quoteSendTransaction([depositTx], config)

      const { hash } = await this._account.sendTransaction([depositTx], config)

      await this._notifyDepositBroadcast(swapId, hash)

      return { hash, fee, bridgeFee, swapId }
    }

    if (this._config.bridgeMaxFee !== undefined && bridgeFee >= BigInt(this._config.bridgeMaxFee)) {
      throw new Error('Exceeded maximum fee cost for bridge operation.')
    }

    const { fee } = await this._account.quoteSendTransaction(depositTx)

    const { hash } = await this._account.sendTransaction(depositTx)

    await this._notifyDepositBroadcast(swapId, hash)

    return { hash, fee, bridgeFee, swapId }
  }

  /**
   * Quotes the costs of a Layerswap bridge operation without creating a swap.
   *
   * The reported `fee` is an approximation of the source-chain gas cost (estimated via
   * `quoteTransfer` for ERC-20 tokens or `quoteSendTransaction` for native sends).
   *
   * Semantic note: `bridgeFee` is in **source-token base units**, not native wei.
   * See class JSDoc for the rationale.
   *
   * @param {BridgeOptions} options - The bridge's options.
   * @returns {Promise<Omit<BridgeResult, 'hash'>>} The bridge's quotes.
   */
  async quoteBridge (options) {
    const { sourceNetwork, sourceToken, destinationNetwork, destinationToken } =
      await this._resolveRoute(options)

    const amount = BigInt(options.amount)
    const amountDecimal = formatBaseUnits(amount, sourceToken.decimals)

    const sourceAddress = await this._account.getAddress()

    const { quote } = await this._client.getQuote({
      source_network: sourceNetwork.name,
      source_token: sourceToken.symbol,
      destination_network: destinationNetwork.name,
      destination_token: destinationToken.symbol,
      amount: amountDecimal,
      use_deposit_address: true,
      source_address: sourceAddress,
      refuel: options.refuel,
      slippage: options.slippage
    })

    const bridgeFee = parseDecimal(quote.total_fee, sourceToken.decimals)

    const fee = await this._estimateSourceGas(sourceToken, amount, sourceAddress)

    return { fee, bridgeFee }
  }

  /**
   * Returns the underlying API client. Useful for polling swap status after `bridge()`.
   *
   * @returns {LayerswapApiClient}
   */
  getApiClient () {
    return this._client
  }

  /**
   * @private
   * @param {BridgeOptions} options
   * @returns {Promise<{ depositTx: { to: string, value: bigint, data: string }, bridgeFee: bigint, swapId: string }>}
   */
  async _buildDepositTransaction (options) {
    const { sourceNetwork, sourceToken, destinationNetwork, destinationToken } =
      await this._resolveRoute(options)

    const amount = BigInt(options.amount)
    const amountDecimal = formatBaseUnits(amount, sourceToken.decimals)

    const sourceAddress = await this._account.getAddress()

    /** @type {import('./layerswap-api-client.js').LayerswapSwapResponse} */
    const response = await this._client.createSwap({
      source_network: sourceNetwork.name,
      source_token: sourceToken.symbol,
      destination_network: destinationNetwork.name,
      destination_token: destinationToken.symbol,
      destination_address: options.recipient,
      amount: amountDecimal,
      use_deposit_address: false,
      source_address: sourceAddress,
      refund_address: options.refundAddress,
      refuel: options.refuel,
      slippage: options.slippage,
      reference_id: options.referenceId
    })

    const swap = response?.swap
    const depositActions = response?.deposit_actions ?? []
    const action = this._pickWalletDepositAction(depositActions)

    if (!swap || !swap.id) {
      throw new Error('Layerswap response is missing swap details.')
    }

    if (!action.to_address) {
      throw new Error('Layerswap deposit action is missing a destination address.')
    }

    const isErc20 = typeof sourceToken.contract === 'string' && sourceToken.contract.length > 0
    const callData = typeof action.call_data === 'string' && action.call_data.length > 0
      ? action.call_data
      : '0x'

    const depositTx = {
      to: action.to_address,
      value: isErc20 ? 0n : BigInt(action.amount_in_base_units),
      data: callData
    }

    const totalFeeDecimal = response.quote?.quote?.total_fee
    const bridgeFee = totalFeeDecimal !== undefined && totalFeeDecimal !== null
      ? parseDecimal(totalFeeDecimal, sourceToken.decimals)
      : 0n

    return { depositTx, bridgeFee, swapId: swap.id }
  }

  /**
   * @private
   * @param {BridgeOptions} options
   * @returns {Promise<{
   *   sourceNetwork: LayerswapNetwork,
   *   sourceToken: LayerswapToken,
   *   destinationNetwork: LayerswapNetwork,
   *   destinationToken: LayerswapToken
   * }>}
   */
  async _resolveRoute (options) {
    let sourceNetwork
    if (options.sourceChain) {
      sourceNetwork = await resolveNetworkByName(this._client, options.sourceChain)
    } else {
      const chainId = await this._getChainId()
      sourceNetwork = await resolveSourceNetwork(this._client, chainId)
    }

    const sourceToken = resolveToken(sourceNetwork, options.token)
    const destinationNetwork = await resolveNetworkByName(this._client, options.targetChain)
    const destinationIdentifier = options.destinationToken ?? sourceToken.symbol
    const destinationToken = resolveToken(destinationNetwork, destinationIdentifier)

    if (sourceNetwork.name === destinationNetwork.name) {
      throw new Error('The target chain cannot be equal to the source chain.')
    }

    return { sourceNetwork, sourceToken, destinationNetwork, destinationToken }
  }

  /**
   * Picks the wallet-flow deposit action (`type: 'transfer'`). Layerswap may return
   * additional `manual_transfer` actions for non-EOA flows; those are ignored here.
   *
   * @private
   * @param {LayerswapDepositAction[]} depositActions
   * @returns {LayerswapDepositAction}
   */
  _pickWalletDepositAction (depositActions) {
    if (!Array.isArray(depositActions) || depositActions.length === 0) {
      throw new Error('Layerswap did not return any deposit actions for this swap.')
    }

    const transfer = depositActions.find((a) => a.type === 'transfer')
    if (transfer) return transfer

    return depositActions[0]
  }

  /**
   * Estimates source-chain gas cost without creating a swap. Uses `quoteTransfer` for ERC-20
   * tokens and `quoteSendTransaction` for native sends; both yield gas figures representative
   * of the actual deposit transaction (an ERC-20 transfer or a plain native send to Layerswap).
   *
   * @private
   * @param {LayerswapToken} sourceToken
   * @param {bigint} amount
   * @param {string} sourceAddress
   * @returns {Promise<bigint>}
   */
  async _estimateSourceGas (sourceToken, amount, sourceAddress) {
    const isErc20 = typeof sourceToken.contract === 'string' && sourceToken.contract.length > 0

    if (isErc20) {
      if (typeof this._account.quoteTransfer !== 'function') return 0n
      const { fee } = await this._account.quoteTransfer({
        token: sourceToken.contract,
        recipient: sourceAddress,
        amount
      })
      return fee
    }

    if (typeof this._account.quoteSendTransaction !== 'function') return 0n
    const { fee } = await this._account.quoteSendTransaction({
      to: sourceAddress,
      value: amount
    })
    return fee
  }

  /**
   * Reads the source chain id via the ethers provider. Cached for the lifetime of the
   * protocol instance.
   *
   * @private
   * @returns {Promise<bigint>}
   */
  async _getChainId () {
    if (this._chainId !== undefined) {
      return this._chainId
    }

    if (!this._provider) {
      throw new Error('The wallet must be connected to a provider in order to detect the source chain.')
    }

    const network = await this._provider.getNetwork()
    this._chainId = network.chainId
    return this._chainId
  }

  /**
   * Informs Layerswap that the deposit has been broadcast. Best-effort — failures are
   * swallowed because Layerswap's watcher will still detect the on-chain deposit on its
   * own. Awaited (rather than fire-and-forget) so the API call's lifetime is bounded by
   * `bridge()`'s return.
   *
   * @private
   * @param {string} swapId
   * @param {string} hash
   * @returns {Promise<void>}
   */
  async _notifyDepositBroadcast (swapId, hash) {
    try {
      await this._client.speedUpDeposit(swapId, hash)
    } catch (_) {
      /* swallow — best-effort */
    }
  }
}
