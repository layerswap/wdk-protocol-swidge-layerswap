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

import { SwidgeProtocol } from '@tetherto/wdk-wallet/protocols'
import { JsonRpcProvider, BrowserProvider } from 'ethers'

import LayerswapApiClient, {
  resolveSourceNetwork,
  resolveNetworkByName,
  resolveToken,
  formatBaseUnits,
  buildStatusResult,
  buildSupportedChains,
  buildSupportedTokens,
  buildSwidgeQuote,
  formatSlippage,
  assertFeeGuards
} from '@layerswap/wdk-protocol-bridge-layerswap-core'

/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeProtocolConfig} SwidgeProtocolConfig */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeOptions} SwidgeOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeQuote} SwidgeQuote */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeResult} SwidgeResult */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeFee} SwidgeFee */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeStatusOptions} SwidgeStatusOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeStatusResult} SwidgeStatusResult */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedChain} SwidgeSupportedChain */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedToken} SwidgeSupportedToken */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedTokensOptions} SwidgeSupportedTokensOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').BridgeResult} BridgeResult */

/** @typedef {import('@tetherto/wdk-wallet-evm').WalletAccountEvm} WalletAccountEvm */
/** @typedef {import('@tetherto/wdk-wallet-evm').WalletAccountReadOnlyEvm} WalletAccountReadOnlyEvm */

/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').WalletAccountEvmErc4337} WalletAccountEvmErc4337 */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').WalletAccountReadOnlyEvmErc4337} WalletAccountReadOnlyEvmErc4337 */

/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletPaymasterTokenConfig} EvmErc4337WalletPaymasterTokenConfig */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletSponsorshipPolicyConfig} EvmErc4337WalletSponsorshipPolicyConfig */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletNativeCoinsConfig} EvmErc4337WalletNativeCoinsConfig */

/** @typedef {import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapNetwork} LayerswapNetwork */
/** @typedef {import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapToken} LayerswapToken */
/** @typedef {import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapDepositAction} LayerswapDepositAction */
/** @typedef {import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapSwap} LayerswapSwap */
/** @typedef {import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapQuote} LayerswapQuote */

/**
 * @typedef {SwidgeProtocolConfig & Object} LayerswapProtocolConfig
 * @property {string} [apiKey]                - Optional Layerswap API key. When set, sent as the
 *                                              `X-LS-APIKEY` header for rate-limit / partner attribution.
 * @property {string} [apiUrl]                - Layerswap API base URL. Default: `https://api.layerswap.io`.
 * @property {number | bigint} [maxNetworkFeeBps]  - Maximum acceptable network fee in basis points of the
 *                                              input amount (WDK swidge guard).
 * @property {number | bigint} [maxProtocolFeeBps] - Maximum acceptable protocol fee in basis points of the
 *                                              input amount (WDK swidge guard).
 * @property {number | bigint} [bridgeMaxFee] - Maximum acceptable Layerswap swap fee, expressed in
 *                                              *source-token base units*. Compared against the total
 *                                              Layerswap fee before broadcasting the deposit transaction.
 * @property {number} [requestTimeoutMs]      - HTTP timeout for Layerswap API calls. Default: 30000.
 */

/**
 * Layerswap-specific extensions to the WDK swidge options.
 *
 * @typedef {SwidgeOptions & Object} LayerswapSwidgeOptions
 * @property {string | number} [fromChain]    - Layerswap source network name (e.g. `'ETHEREUM_MAINNET'`).
 *                                              Defaults to the network of the account's connected provider.
 * @property {boolean} [refuel]               - Request a native-gas drop on the destination chain.
 * @property {string} [referenceId]           - External reference id for the created swap.
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
 * WDK swidge protocol that drives a Layerswap swap from an EVM wallet account.
 *
 * Implements the `SwidgeProtocol` interface from `@tetherto/wdk-wallet/protocols`:
 * `quoteSwidge` / `swidge` / `getSwidgeStatus` / `getSupportedChains` / `getSupportedTokens`,
 * which also provides the WDK `swap`/`bridge` module surfaces via the base class.
 *
 * Unlike on-chain bridges (e.g., LayerZero OFTs) this protocol is HTTP-orchestrated:
 *   1. POST /api/v2/swaps to create a swap and receive deposit instructions.
 *   2. Submit the deposit transaction from the user's wallet to Layerswap's deposit address
 *      using the API-provided calldata.
 *   3. Layerswap performs the destination-chain payout off-chain.
 *
 * `swidge()` resolves once the source-chain deposit transaction has been broadcast; the
 * destination payout completes asynchronously and can be tracked with
 * `getSwidgeStatus(result.id)`.
 *
 * Fee semantics: Layerswap deducts its fees from the source-token amount, so 'protocol'
 * and Layerswap's destination 'network' fee entries are denominated in the **source
 * token** and flagged `included: true`. Source-chain gas is a separate non-included
 * 'network' fee in the **native token**. Do not sum amounts across fee entries with
 * different `token` values.
 */
export default class LayerswapProtocolEvm extends SwidgeProtocol {
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
     * @private
     * @type {LayerswapApiClient}
     */
    this._client = new LayerswapApiClient({
      apiKey: config.apiKey,
      apiUrl: config.apiUrl,
      requestTimeoutMs: config.requestTimeoutMs
    })

    if (account && account._config && account._config.provider) {
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
   * Quotes the estimated costs and output of a Layerswap swidge operation without
   * creating a swap. Layerswap only supports exact-in operations; passing
   * `toTokenAmount` throws.
   *
   * When the protocol has an account bound, the quote includes a non-included
   * 'network' fee entry with the estimated source-chain gas (in native units).
   *
   * @param {LayerswapSwidgeOptions} options - The swidge options.
   * @returns {Promise<SwidgeQuote>} The quoted swidge details.
   */
  async quoteSwidge (options) {
    const route = await this._resolveSwidgeRoute(options)
    const fromTokenAmount = this._requireExactIn(options)

    const sourceAddress = this._account
      ? await this._account.getAddress().catch(() => undefined)
      : undefined

    const { quote } = await this._client.getQuote({
      source_network: route.sourceNetwork.name,
      source_token: route.sourceToken.symbol,
      destination_network: route.destinationNetwork.name,
      destination_token: route.destinationToken.symbol,
      amount: formatBaseUnits(fromTokenAmount, route.sourceToken.decimals),
      use_deposit_address: false,
      source_address: sourceAddress,
      refuel: options.refuel,
      slippage: formatSlippage(options.slippage)
    })

    const swidgeQuote = buildSwidgeQuote(quote, route.sourceToken, route.destinationToken, route.sourceNetwork.name)

    // The requested amount is authoritative from the options (exact-in); don't rely on
    // the API echoing it back.
    swidgeQuote.fromTokenAmount = fromTokenAmount

    if (sourceAddress !== undefined) {
      // Gas estimation simulates the send, so it fails for unfunded accounts — but a
      // non-binding quote should not require funds. Omit the gas entry in that case;
      // swidge() still runs a real pre-broadcast estimate.
      const gas = await this._estimateSourceGas(route.sourceToken, fromTokenAmount, sourceAddress)
        .catch(() => undefined)
      if (gas !== undefined) {
        swidgeQuote.fees.push(this._buildGasFee(gas, route.sourceNetwork))
      }
    }

    return swidgeQuote
  }

  /**
   * Executes a Layerswap swidge operation: creates the swap, checks the fee guards,
   * and broadcasts the source-chain deposit transaction.
   *
   * Resolves once the deposit has been broadcast. Layerswap finishes the
   * destination-chain payout asynchronously; track it with `getSwidgeStatus(result.id)`.
   *
   * @param {LayerswapSwidgeOptions} options - The swidge options.
   * @param {SwidgeProtocolConfig & Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig> & Pick<LayerswapProtocolConfig, 'bridgeMaxFee'>} [config] - Optional
   *   execution configuration. With an erc-4337 account, wallet configuration overrides are
   *   forwarded to `sendTransaction`.
   * @returns {Promise<SwidgeResult>} The swidge execution result. `id` is the Layerswap swap
   *   id (use it with `getSwidgeStatus`); `hash` is the source-chain deposit transaction hash.
   */
  async swidge (options, config) {
    if (!this._isWritableAccount(this._account)) {
      throw new Error("The 'swidge(options)' method requires the protocol to be initialized with a non read-only account.")
    }

    const route = await this._resolveSwidgeRoute(options)
    const fromTokenAmount = this._requireExactIn(options)
    const merged = { ...this._config, ...config }

    const { swap, depositTx, quote } = await this._createSwap(options, route, fromTokenAmount)

    const { fees, toTokenAmount, toTokenAmountMin } = quote
      ? buildSwidgeQuote(quote, route.sourceToken, route.destinationToken, route.sourceNetwork.name)
      : { fees: [], toTokenAmount: 0n, toTokenAmountMin: 0n }

    if (options.minAmountOut !== undefined && toTokenAmountMin < BigInt(options.minAmountOut)) {
      throw new Error('The quoted minimum output is below the requested minAmountOut.')
    }

    const includedFee = fees.reduce((acc, f) => acc + (f.included ? f.amount : 0n), 0n)
    if (merged.bridgeMaxFee !== undefined && includedFee >= BigInt(merged.bridgeMaxFee)) {
      throw new Error('Exceeded maximum fee cost for bridge operation.')
    }

    const isErc4337 = this._isErc4337Account(this._account)

    const { fee: gas } = isErc4337
      ? await this._account.quoteSendTransaction([depositTx], config)
      : await this._account.quoteSendTransaction(depositTx)

    fees.push(this._buildGasFee(gas, route.sourceNetwork))

    assertFeeGuards(fees, fromTokenAmount, route.sourceToken.symbol, merged)

    const { hash } = isErc4337
      ? await this._account.sendTransaction([depositTx], config)
      : await this._account.sendTransaction(depositTx)

    await this._notifyDepositBroadcast(swap.id, hash)

    return {
      id: swap.id,
      hash,
      fees,
      transactions: [{ hash, chain: route.sourceNetwork.name, type: 'source' }],
      fromTokenAmount,
      toTokenAmount,
      toTokenAmountMin
    }
  }

  /**
   * Retrieves the current status of a Layerswap swap, mapped to the WDK swidge
   * status vocabulary, along with the source/destination/refund transactions
   * Layerswap has observed so far.
   *
   * The Layerswap swap id is globally unique, so the WDK `SwidgeStatusOptions` chain
   * hints are not needed and are ignored.
   *
   * @param {string} id - The Layerswap swap id returned by `swidge()`.
   * @returns {Promise<SwidgeStatusResult>} The current swidge status.
   * @throws {Error} If no swap exists with the given id.
   */
  async getSwidgeStatus (id) {
    const response = await this._client.getSwap(id)
    return buildStatusResult(response)
  }

  /**
   * Retrieves the chains supported by Layerswap.
   *
   * @returns {Promise<SwidgeSupportedChain[]>} The supported chains. `id` is the Layerswap
   *   network name (e.g. `'ETHEREUM_MAINNET'`) — use it as `fromChain`/`toChain`.
   */
  async getSupportedChains () {
    const networks = await this._client.getNetworks()
    return buildSupportedChains(networks)
  }

  /**
   * Retrieves the tokens supported by Layerswap, optionally scoped to a chain.
   *
   * @param {SwidgeSupportedTokensOptions} [options] - Chain-scoped filters (`toChain`,
   *   or `fromChain` when `toChain` is absent). `fromToken` route scoping is not applied.
   * @returns {Promise<SwidgeSupportedToken[]>} The supported tokens.
   */
  async getSupportedTokens (options) {
    const networks = await this._client.getNetworks()
    return buildSupportedTokens(networks, options)
  }

  /**
   * Bridges a token to a different blockchain via Layerswap.
   *
   * Legacy WDK bridge-module surface, kept for backwards compatibility with the
   * pre-swidge interface of this package: `hash` is the source-chain deposit
   * transaction hash (not the swap id), and the Layerswap swap id is returned in the
   * extra `swapId` field.
   *
   * Semantic note: `bridgeFee` is in **source-token base units**, not native wei —
   * it is the total fee Layerswap deducts from the source amount. `fee` is the
   * source-chain gas cost in native units. Do not sum them.
   *
   * @param {BridgeOptions} options - The bridge's options.
   * @param {Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig> & Pick<LayerswapProtocolConfig, 'bridgeMaxFee'>} [config] - If
   *   the protocol has been initialized with an erc-4337 wallet account, it can be used to
   *   override its configuration options along with the 'bridgeMaxFee' option.
   * @returns {Promise<LayerswapBridgeResult>} The bridge's result, augmented with the Layerswap swap id.
   */
  async bridge (options, config) {
    const result = await this.swidge(this._toSwidgeOptions(options), config)

    return {
      hash: result.hash,
      ...this._splitLegacyFees(result.fees),
      swapId: result.id
    }
  }

  /**
   * Quotes the costs of a Layerswap bridge operation without creating a swap.
   *
   * Legacy WDK bridge-module surface, kept for backwards compatibility. `fee` is the
   * estimated source-chain gas in native units; `bridgeFee` is Layerswap's total fee
   * in source-token base units. See `bridge()` for the semantics.
   *
   * @param {BridgeOptions} options - The bridge's options.
   * @returns {Promise<Omit<BridgeResult, 'hash'>>} The bridge's quotes.
   */
  async quoteBridge (options) {
    const quote = await this.quoteSwidge(this._toSwidgeOptions(options))
    return this._splitLegacyFees(quote.fees)
  }

  /**
   * Returns the underlying API client, for raw access to the Layerswap v2 API.
   *
   * @returns {LayerswapApiClient}
   */
  getApiClient () {
    return this._client
  }

  /**
   * Asks Layerswap for its on-chain assessment of a deposit transaction. Useful as a
   * follow-up after `swidge()` returns — even if the broadcast resolved, the tx
   * can still revert or be dropped from the mempool. Returns `'completed' | 'failed' |
   * 'pending'`.
   *
   * The source network defaults to the wallet's connected provider (resolved via
   * `provider.getNetwork().chainId`); pass `options.sourceChain` to override.
   *
   * @param {string} txHash - The on-chain transaction hash returned by `swidge()`.
   * @param {{ sourceChain?: string }} [options]
   * @returns {Promise<import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapTransactionStatus>}
   */
  async getTransactionStatus (txHash, options = {}) {
    const networkName = options.sourceChain ?? await this._detectSourceNetworkName()
    return this._client.getTransactionStatus(networkName, txHash)
  }

  /**
   * Maps the legacy bridge options onto the swidge options vocabulary. The legacy
   * `slippage` is a percent string ('0.5' = 0.5%); swidge takes a decimal (0.005).
   *
   * @private
   * @param {BridgeOptions} options
   * @returns {LayerswapSwidgeOptions}
   */
  _toSwidgeOptions (options) {
    return {
      fromToken: options.token,
      toToken: options.destinationToken,
      toChain: options.targetChain,
      fromChain: options.sourceChain,
      recipient: options.recipient,
      refundAddress: options.refundAddress,
      fromTokenAmount: options.amount,
      refuel: options.refuel,
      referenceId: options.referenceId,
      ...(options.slippage !== undefined && { slippage: Number(options.slippage) / 100 })
    }
  }

  /**
   * Splits a swidge fee breakdown back into the legacy `{ fee, bridgeFee }` pair:
   * `fee` = non-included fees (source-chain gas, native units), `bridgeFee` = included
   * fees (Layerswap's cut, source-token base units).
   *
   * @private
   * @param {SwidgeFee[]} fees
   * @returns {{ fee: bigint, bridgeFee: bigint }}
   */
  _splitLegacyFees (fees) {
    let fee = 0n
    let bridgeFee = 0n
    for (const f of fees) {
      if (f.included) bridgeFee += f.amount
      else fee += f.amount
    }
    return { fee, bridgeFee }
  }

  /**
   * Builds the non-included source-chain gas fee entry.
   *
   * @private
   * @param {bigint} gas
   * @param {LayerswapNetwork} sourceNetwork
   * @returns {SwidgeFee}
   */
  _buildGasFee (gas, sourceNetwork) {
    return {
      type: 'network',
      amount: gas,
      token: sourceNetwork.token?.symbol ?? 'ETH',
      chain: sourceNetwork.name,
      included: false,
      description: 'Source-chain gas'
    }
  }

  /**
   * Validates the exact-in/exact-out split. Layerswap quotes are driven by the source
   * amount, so exact-out operations are rejected.
   *
   * @private
   * @param {LayerswapSwidgeOptions} options
   * @returns {bigint} The input amount in source-token base units.
   */
  _requireExactIn (options) {
    if (options.toTokenAmount !== undefined) {
      throw new Error('Layerswap only supports exact-in operations. Use fromTokenAmount instead of toTokenAmount.')
    }
    if (options.fromTokenAmount === undefined) {
      throw new Error("The 'fromTokenAmount' option is required.")
    }
    return BigInt(options.fromTokenAmount)
  }

  /**
   * Resolves the swidge route (networks and tokens on both sides) from the options.
   *
   * @private
   * @param {LayerswapSwidgeOptions} options
   * @returns {Promise<{
   *   sourceNetwork: LayerswapNetwork,
   *   sourceToken: LayerswapToken,
   *   destinationNetwork: LayerswapNetwork,
   *   destinationToken: LayerswapToken
   * }>}
   */
  async _resolveSwidgeRoute (options) {
    if (options.fromChain === undefined && !this._provider) {
      throw new Error("The 'fromChain' option is required when the protocol has no connected provider to detect the source chain from.")
    }

    const sourceNetwork = options.fromChain !== undefined
      ? await resolveNetworkByName(this._client, String(options.fromChain))
      : await this._detectSourceNetwork()

    const sourceToken = resolveToken(sourceNetwork, options.fromToken)

    if (options.toChain === undefined) {
      throw new Error("Layerswap does not support same-chain swaps. The 'toChain' option is required and must differ from the source chain.")
    }

    const destinationNetwork = await resolveNetworkByName(this._client, String(options.toChain))
    const destinationToken = resolveToken(destinationNetwork, options.toToken ?? sourceToken.symbol)

    if (sourceNetwork.name === destinationNetwork.name) {
      throw new Error('The target chain cannot be equal to the source chain.')
    }

    return { sourceNetwork, sourceToken, destinationNetwork, destinationToken }
  }

  /**
   * Resolves the destination recipient. Defaults to the account's own address, but only
   * when source and destination networks share the same address format (same VM type).
   *
   * @private
   * @param {LayerswapSwidgeOptions} options
   * @param {LayerswapNetwork} sourceNetwork
   * @param {LayerswapNetwork} destinationNetwork
   * @returns {Promise<string>}
   */
  async _resolveRecipient (options, sourceNetwork, destinationNetwork) {
    if (options.recipient !== undefined) return options.recipient

    if (this._account && sourceNetwork.type === destinationNetwork.type) {
      return this._account.getAddress()
    }

    throw new Error("The 'recipient' option is required when the destination chain uses a different address format than the source chain.")
  }

  /**
   * Creates the Layerswap swap and derives the deposit transaction from the returned
   * wallet-flow deposit action.
   *
   * @private
   * @param {LayerswapSwidgeOptions} options
   * @param {{ sourceNetwork: LayerswapNetwork, sourceToken: LayerswapToken, destinationNetwork: LayerswapNetwork, destinationToken: LayerswapToken }} route
   * @param {bigint} fromTokenAmount
   * @returns {Promise<{ swap: LayerswapSwap, depositTx: { to: string, value: bigint, data: string }, quote: LayerswapQuote | undefined }>}
   */
  async _createSwap (options, route, fromTokenAmount) {
    const { sourceNetwork, sourceToken, destinationNetwork, destinationToken } = route

    const sourceAddress = await this._account.getAddress()
    const recipient = await this._resolveRecipient(options, sourceNetwork, destinationNetwork)

    /** @type {import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapSwapResponse} */
    const response = await this._client.createSwap({
      source_network: sourceNetwork.name,
      source_token: sourceToken.symbol,
      destination_network: destinationNetwork.name,
      destination_token: destinationToken.symbol,
      destination_address: recipient,
      amount: formatBaseUnits(fromTokenAmount, sourceToken.decimals),
      use_deposit_address: false,
      source_address: sourceAddress,
      refund_address: options.refundAddress,
      refuel: options.refuel,
      slippage: formatSlippage(options.slippage),
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

    return { swap, depositTx, quote: response.quote?.quote }
  }

  /**
   * @private
   * @returns {Promise<LayerswapNetwork>}
   */
  async _detectSourceNetwork () {
    const chainId = await this._getChainId()
    return resolveSourceNetwork(this._client, chainId)
  }

  /**
   * @private
   * @returns {Promise<string>}
   */
  async _detectSourceNetworkName () {
    const network = await this._detectSourceNetwork()
    return network.name
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
   * Tests whether the bound account is a writable EVM wallet account
   * (i.e. exposes `sendTransaction` as a callable). This is a duck-type check
   * rather than an `instanceof WalletAccountEvm | WalletAccountEvmErc4337`
   * check because pnpm-workspace setups can resolve `@tetherto/wdk-wallet-evm`
   * (and -erc-4337) to a different copy than this package's own when the dep
   * tree's peer-dep contexts diverge — `instanceof` would then fail on a
   * structurally-correct account.
   *
   * @private
   * @param {unknown} account
   * @returns {boolean}
   */
  _isWritableAccount (account) {
    return Boolean(account && typeof account === 'object' && typeof account.sendTransaction === 'function')
  }

  /**
   * Tests whether the bound account is an ERC-4337 wallet account. Distinguishes
   * the routing in `swidge()` — ERC-4337 uses the array-form `sendTransaction([tx], config)`,
   * standard EVM uses single-form `sendTransaction(tx)`. Matched by class name (preserved
   * across duplicate copies of the wallet package) to dodge the same duplicate-copy
   * `instanceof` failure as `_isWritableAccount`.
   *
   * @private
   * @param {unknown} account
   * @returns {boolean}
   */
  _isErc4337Account (account) {
    const proto = account != null ? Object.getPrototypeOf(account) : null
    const ctor = proto && proto.constructor
    return Boolean(ctor && ctor.name === 'WalletAccountEvmErc4337')
  }

  /**
   * Informs Layerswap that the deposit has been broadcast. Best-effort — failures are
   * swallowed because Layerswap's watcher will still detect the on-chain deposit on its
   * own. Awaited (rather than fire-and-forget) so the API call's lifetime is bounded by
   * `swidge()`'s return.
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
