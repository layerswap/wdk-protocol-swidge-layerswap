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
  SwidgeProtocol,
  AccountRequiredError,
  BridgeError,
  DisposalError,
  MaximumFeeExceededError,
  NotImplementedError,
  ProviderError,
  ProviderRequiredError,
  SwidgeError,
  SwidgeErrorReason,
  ValueError
} from '@tetherto/wdk-wallet/protocols'

import LayerswapApiClient from './layerswap-api-client.js'
import { resolveNetworkByName, resolveToken, formatBaseUnits, parseDecimal } from './networks.js'
import {
  buildStatusResult,
  buildSupportedChains,
  buildSupportedTokens,
  buildSwidgeQuote,
  formatSlippage,
  assertFeeGuards,
  normalizeWalletError,
  toBigIntOption
} from './swidge.js'

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

/** @typedef {import('./layerswap-api-client.js').LayerswapNetwork} LayerswapNetwork */
/** @typedef {import('./layerswap-api-client.js').LayerswapToken} LayerswapToken */
/** @typedef {import('./layerswap-api-client.js').LayerswapQuote} LayerswapQuote */
/** @typedef {import('./layerswap-api-client.js').LayerswapSwap} LayerswapSwap */
/** @typedef {import('./layerswap-api-client.js').LayerswapSwapResponse} LayerswapSwapResponse */
/** @typedef {import('./layerswap-api-client.js').LayerswapDepositAction} LayerswapDepositAction */
/** @typedef {import('./layerswap-api-client.js').LayerswapTransactionStatus} LayerswapTransactionStatus */

/**
 * @typedef {Object} LayerswapProtocolConfig
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
 * @typedef {SwidgeOptions & LayerswapSpecificSwidgeOptions} LayerswapSwidgeOptions
 */

/**
 * @typedef {Object} LayerswapSpecificSwidgeOptions
 * @property {string | number} [fromChain]    - Layerswap source network name (e.g. `'ETHEREUM_MAINNET'`).
 *                                              Defaults to the network detected from the wallet account.
 * @property {boolean} [refuel]               - Request a native-gas drop on the destination chain.
 * @property {string} [referenceId]           - External reference id for the created swap.
 */

/**
 * Optional execution configuration of the `bridge` method.
 *
 * @typedef {Pick<LayerswapProtocolConfig, 'bridgeMaxFee'>} LayerswapBridgeConfig
 */

/**
 * Optional execution configuration of the `swidge` method: the WDK swidge fee guards
 * plus the `bridge` configuration options.
 *
 * @typedef {SwidgeProtocolConfig & LayerswapBridgeConfig} LayerswapSwidgeConfig
 */

/**
 * @typedef {Object} LayerswapBridgeOptions
 * @property {string} targetChain             - Layerswap destination network name. Uses the
 *                                              `<CHAIN>_<ENV>` uppercase convention, e.g.
 *                                              `'ETHEREUM_MAINNET'`, `'ARBITRUM_MAINNET'`,
 *                                              `'ARBITRUM_SEPOLIA'`. Matching is case-insensitive
 *                                              but the canonical form is uppercase.
 * @property {string} recipient               - Destination-chain recipient address, in the
 *                                              destination chain's native format (Layerswap is
 *                                              HTTP-orchestrated and accepts the native string).
 * @property {string} token                   - Source token: contract address OR Layerswap symbol.
 * @property {number | bigint} amount         - Source amount in base units.
 * @property {string} [destinationToken]      - Destination token (address or symbol). Defaults to the
 *                                              source token's symbol.
 * @property {string} [sourceChain]           - Override auto-detected source network name.
 * @property {boolean} [refuel]               - Request a native-gas drop on the destination chain.
 * @property {string} [slippage]              - Slippage tolerance percentage, e.g. '0.5'.
 * @property {string} [referenceId]           - External reference id for the created swap.
 * @property {string} [refundAddress]         - Refund address used if the swap fails after deposit.
 *                                              Defaults to the account's address.
 */

/**
 * The result of a Layerswap bridge operation: the WDK bridge result, augmented with the
 * Layerswap swap id.
 *
 * @typedef {BridgeResult & LayerswapSpecificBridgeResult} LayerswapBridgeResult
 */

/**
 * @typedef {Object} LayerswapSpecificBridgeResult
 * @property {string} swapId                  - The Layerswap swap id. Use it with `getSwidgeStatus`.
 */

/**
 * @typedef {Object} GetTransactionStatusOptions
 * @property {string} [sourceChain]           - Layerswap source network name of the transaction.
 *                                              Defaults to the network detected from the wallet account.
 */

/**
 * The resolved Layerswap networks and tokens on both sides of a swidge operation.
 *
 * @typedef {Object} LayerswapSwidgeRoute
 * @property {LayerswapNetwork} sourceNetwork - The source network.
 * @property {LayerswapToken} sourceToken - The source token.
 * @property {LayerswapNetwork} destinationNetwork - The destination network.
 * @property {LayerswapToken} destinationToken - The destination token.
 */

/**
 * A created Layerswap swap, along with its wallet deposit action and locked-in quote.
 *
 * @typedef {Object} LayerswapDepositSwap
 * @property {LayerswapSwap} swap - The created Layerswap swap.
 * @property {LayerswapDepositAction} action - The wallet-flow (`'transfer'`) deposit action.
 * @property {LayerswapQuote} [quote] - The quote Layerswap locked in for the swap.
 */

/**
 * The inputs a VM implementation needs to build the source-chain deposit.
 *
 * @typedef {Object} LayerswapDepositContext
 * @property {LayerswapDepositAction} action - The wallet-flow deposit action returned by Layerswap.
 * @property {LayerswapSwidgeRoute} route - The resolved swidge route.
 * @property {bigint} fromTokenAmount - The input amount in source-token base units.
 * @property {LayerswapSwidgeOptions} options - The swidge options.
 * @property {LayerswapSwidgeConfig} [config] - The swidge execution configuration.
 */

/**
 * A deposit built by a VM implementation, ready to be broadcast. VM implementations extend
 * it with the data their `_sendDeposit` needs.
 *
 * @typedef {Object} LayerswapPreparedDeposit
 * @property {bigint} [fee] - The source-chain gas cost of the deposit (in native base units),
 *   when known before broadcasting.
 */

/**
 * @typedef {Object} LayerswapBroadcastDeposit
 * @property {string} hash - The hash of the broadcast deposit transaction.
 * @property {bigint} [fee] - The source-chain gas cost (in native base units), when only known
 *   after broadcasting.
 */

/**
 * @typedef {Object} LayerswapLegacyBridgeFees
 * @property {bigint} fee - The non-included fees (source-chain gas), in native units.
 * @property {bigint} bridgeFee - The included fees (Layerswap's cut), in source-token base units.
 */

/**
 * Chain-agnostic WDK swidge protocol over the Layerswap public API. Every VM package
 * (`layerswap-evm`, `layerswap-solana`, …) extends it and only implements what is
 * specific to its chain family:
 *
 * - `_detectSourceNetwork()` — the Layerswap network the wallet account is connected to;
 * - optionally `_isWritableAccount(account)` / `_isDisposedAccount(account)` — stricter
 *   account checks than the default `sendTransaction` / `disposed` duck-typing;
 * - `_prepareDeposit(context)` / `_sendDeposit(deposit, config)` — build and broadcast the
 *   source-chain deposit described by the Layerswap deposit action;
 * - optionally `_quoteSourceGas(route, amount, sourceAddress)` — the estimated source-chain
 *   gas included in quotes, and `_assertSwidgeRoute(route)` — VM-specific route checks.
 *
 * Unlike on-chain bridges this protocol is HTTP-orchestrated:
 *   1. POST /api/v2/swaps to create a swap and receive deposit instructions.
 *   2. Submit the deposit transaction from the user's wallet to Layerswap's deposit address.
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
 *
 * Errors honour the `ISwidgeProtocol` throw contract of `@tetherto/wdk-wallet/protocols`.
 *
 * @abstract
 * @template {LayerswapSwidgeOptions} [O=LayerswapSwidgeOptions] - The swidge options.
 * @template {LayerswapSwidgeConfig} [C=LayerswapSwidgeConfig] - The swidge execution configuration.
 * @template {LayerswapBridgeOptions} [B=LayerswapBridgeOptions] - The bridge options.
 * @template {LayerswapBridgeConfig} [BC=LayerswapBridgeConfig] - The bridge execution configuration.
 */
export default class LayerswapSwidgeProtocol extends SwidgeProtocol {
  /**
   * Creates a new layerswap swidge protocol.
   *
   * @param {any} [account] - The wallet account to use to interact with the protocol.
   * @param {LayerswapProtocolConfig} [config] - The layerswap protocol configuration.
   */
  constructor (account, config = {}) {
    super(account, config)

    /**
     * The layerswap protocol configuration.
     *
     * @protected
     * @type {LayerswapProtocolConfig}
     */
    this._config = config

    /**
     * @protected
     * @type {LayerswapApiClient}
     */
    this._client = new LayerswapApiClient({
      apiKey: config.apiKey,
      apiUrl: config.apiUrl,
      requestTimeoutMs: config.requestTimeoutMs
    })
  }

  /**
   * Quotes the estimated costs and output of a Layerswap swidge operation without
   * creating a swap. Layerswap only supports exact-in operations; passing
   * `toTokenAmount` throws.
   *
   * When the protocol has an account bound, the quote includes a non-included
   * 'network' fee entry with the estimated source-chain gas (in native units).
   *
   * @param {O} options - The swidge options.
   * @returns {Promise<SwidgeQuote>} The quoted swidge details.
   * @throws {ValueError} If the swidge options are not valid, or Layerswap does not support the route.
   * @throws {InvalidTokenError} If the from or to tokens are not supported by Layerswap.
   * @throws {ProviderRequiredError} If 'fromChain' is omitted and the source chain cannot be detected without a provider.
   * @throws {ProviderError} If the Layerswap API or the provider fails to quote the swidge.
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
      // A non-binding quote must not require funds: gas estimates that simulate the
      // deposit fail for unfunded accounts, so the gas entry is omitted in that case.
      // swidge() still runs a real pre-broadcast estimate.
      const gas = await this._quoteSourceGas(route, fromTokenAmount, sourceAddress)
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
   * @param {O} options - The swidge options.
   * @param {C} [config] - Optional execution configuration.
   * @returns {Promise<SwidgeResult>} The swidge execution result. `id` is the Layerswap swap
   *   id (use it with `getSwidgeStatus`); `hash` is the source-chain deposit transaction hash.
   * @throws {AccountRequiredError} If the protocol has not been initialized with a non read-only account.
   * @throws {DisposalError} If the account has been disposed.
   * @throws {ValueError} If the swidge options are not valid, or Layerswap does not support the route.
   * @throws {InvalidTokenError} If the from or to tokens are not supported by Layerswap.
   * @throws {ProviderRequiredError} If the account is not connected to a provider.
   * @throws {ProviderError} If the Layerswap API or the provider fails to perform the swidge.
   * @throws {SwidgeError} If the quoted output is below 'minAmountOut', or the account has insufficient funds.
   * @throws {MaximumFeeExceededError} If the costs exceed the 'bridgeMaxFee', 'maxNetworkFeeBps' or 'maxProtocolFeeBps' options.
   */
  async swidge (options, config) {
    if (!this._isWritableAccount(this._account)) {
      throw new AccountRequiredError("The 'swidge(options)' method requires the protocol to be initialized with a non read-only account.")
    }

    if (this._isDisposedAccount(this._account)) {
      throw new DisposalError("The 'swidge(options)' method requires the protocol to be initialized with a non disposed account.")
    }

    const route = await this._resolveSwidgeRoute(options)
    const fromTokenAmount = this._requireExactIn(options)
    const merged = { ...this._config, ...config }

    // Validated before the swap is created, so invalid values fail without side effects.
    const minAmountOut = toBigIntOption(options.minAmountOut, 'minAmountOut')
    const bridgeMaxFee = toBigIntOption(merged.bridgeMaxFee, 'bridgeMaxFee')
    const feeGuards = {
      maxNetworkFeeBps: toBigIntOption(merged.maxNetworkFeeBps, 'maxNetworkFeeBps'),
      maxProtocolFeeBps: toBigIntOption(merged.maxProtocolFeeBps, 'maxProtocolFeeBps')
    }

    this._assertSwidgeRoute(route)

    const { swap, action, quote } = await this._createSwap(options, route, fromTokenAmount)

    const { fees, toTokenAmount, toTokenAmountMin } = quote
      ? buildSwidgeQuote(quote, route.sourceToken, route.destinationToken, route.sourceNetwork.name)
      : { fees: [], toTokenAmount: 0n, toTokenAmountMin: 0n }

    if (minAmountOut !== undefined && toTokenAmountMin < minAmountOut) {
      throw new SwidgeError('The quoted minimum output is below the requested minAmountOut.', {
        reason: SwidgeErrorReason.COULD_NOT_MET_THRESHOLD
      })
    }

    const includedFee = fees.reduce((acc, f) => acc + (f.included ? f.amount : 0n), 0n)
    if (bridgeMaxFee !== undefined && includedFee >= bridgeMaxFee) {
      throw new MaximumFeeExceededError('Exceeded maximum fee cost for bridge operation.')
    }

    const deposit = await this._prepareDeposit({ action, route, fromTokenAmount, options, config })

    if (deposit.fee !== undefined) {
      fees.push(this._buildGasFee(deposit.fee, route.sourceNetwork))
    }

    assertFeeGuards(fees, fromTokenAmount, route.sourceToken.symbol, feeGuards)

    const { hash, fee } = await this._sendDeposit(deposit, config)

    if (deposit.fee === undefined && fee !== undefined) {
      fees.push(this._buildGasFee(fee, route.sourceNetwork))
    }

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
   * The Layerswap swap id is globally unique, so the chain hints are not needed to find
   * the swap; when given, they constrain the lookup: a swap whose source (destination)
   * network does not match `fromChain` (`toChain`) is reported as not found. Hints are
   * matched case-insensitively against the Layerswap network name or chain id.
   *
   * @param {string} id - The Layerswap swap id returned by `swidge()`.
   * @param {SwidgeStatusOptions} [options] - Optional source/destination chain filters.
   * @returns {Promise<SwidgeStatusResult>} The current swidge status.
   * @throws {ValueError} If the id is not valid.
   * @throws {NoSuchElementError} If no swap exists with the given id on the given chains.
   * @throws {ProviderError} If the Layerswap API fails to fetch the swap's status.
   */
  async getSwidgeStatus (id, options) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new ValueError("The 'id' must be a non-empty string.")
    }

    const response = await this._client.getSwap(id)
    return buildStatusResult(response, options)
  }

  /**
   * Retrieves the chains supported by Layerswap.
   *
   * @returns {Promise<SwidgeSupportedChain[]>} The supported chains. `id` is the Layerswap
   *   network name (e.g. `'ETHEREUM_MAINNET'`) — use it as `fromChain`/`toChain`.
   * @throws {ProviderError} If the Layerswap API fails to fetch the available chains.
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
   * @throws {ProviderError} If the Layerswap API fails to fetch the available tokens.
   */
  async getSupportedTokens (options) {
    const networks = await this._client.getNetworks()
    return buildSupportedTokens(networks, options)
  }

  /**
   * Bridges a token to a different blockchain via Layerswap.
   *
   * Legacy WDK bridge-module surface, kept for backwards compatibility with the
   * pre-swidge interface: `hash` is the source-chain deposit transaction hash (not the
   * swap id), and the Layerswap swap id is returned in the extra `swapId` field.
   *
   * Semantic note: `bridgeFee` is in **source-token base units**, not native units —
   * it is the total fee Layerswap deducts from the source amount. `fee` is the
   * source-chain gas cost in native units. Do not sum them.
   *
   * @param {B} options - The bridge's options.
   * @param {BC} [config] - Optional execution configuration, including the 'bridgeMaxFee' option.
   * @returns {Promise<LayerswapBridgeResult>} The bridge's result, augmented with the Layerswap swap id.
   * @throws {AccountRequiredError} If the protocol has not been initialized with a non read-only account.
   * @throws {DisposalError} If the account has been disposed.
   * @throws {ValueError} If the bridge options are not valid, or Layerswap does not support the route.
   * @throws {InvalidTokenError} If the token is not supported by Layerswap.
   * @throws {ProviderRequiredError} If the account is not connected to a provider.
   * @throws {ProviderError} If the Layerswap API or the provider fails to perform the bridge.
   * @throws {BridgeError} If the bridge fails with an error (e.g., insufficient funds).
   * @throws {MaximumFeeExceededError} If the costs exceed the 'bridgeMaxFee', 'maxNetworkFeeBps' or 'maxProtocolFeeBps' options.
   */
  async bridge (options, config) {
    try {
      const result = await this.swidge(this._toSwidgeOptions(options), /** @type {C} */ (config))

      return {
        hash: result.hash,
        ...this._splitLegacyFees(result.fees),
        swapId: result.id
      }
    } catch (error) {
      if (error instanceof SwidgeError) {
        throw new BridgeError(error.message, { reason: error.reason, cause: error })
      }

      throw error
    }
  }

  /**
   * Quotes the costs of a Layerswap bridge operation without creating a swap.
   *
   * Legacy WDK bridge-module surface, kept for backwards compatibility. `fee` is the
   * estimated source-chain gas in native units; `bridgeFee` is Layerswap's total fee
   * in source-token base units. See `bridge()` for the semantics.
   *
   * @param {B} options - The bridge's options.
   * @returns {Promise<Omit<LayerswapBridgeResult, 'hash' | 'swapId'>>} The bridge's quotes.
   * @throws {ValueError} If the bridge options are not valid, or Layerswap does not support the route.
   * @throws {InvalidTokenError} If the token is not supported by Layerswap.
   * @throws {ProviderRequiredError} If 'sourceChain' is omitted and the source chain cannot be detected without a provider.
   * @throws {ProviderError} If the Layerswap API or the provider fails to quote the bridge.
   * @throws {BridgeError} If the bridge fails with an error.
   */
  async quoteBridge (options) {
    try {
      const quote = await this.quoteSwidge(this._toSwidgeOptions(options))
      return this._splitLegacyFees(quote.fees)
    } catch (error) {
      if (error instanceof SwidgeError) {
        throw new BridgeError(error.message, { reason: error.reason, cause: error })
      }

      throw error
    }
  }

  /**
   * Returns the underlying API client, for raw access to the Layerswap v2 API.
   *
   * @returns {LayerswapApiClient} The Layerswap API client.
   */
  getApiClient () {
    return this._client
  }

  /**
   * Asks Layerswap for its on-chain assessment of a deposit transaction. Useful as a
   * follow-up after `swidge()` returns — even if the broadcast resolved, the transaction
   * can still fail or be dropped. Returns `'completed' | 'failed' | 'pending'`.
   *
   * The source network defaults to the one detected from the wallet account; pass
   * `options.sourceChain` to override.
   *
   * @param {string} hash - The on-chain transaction hash returned by `swidge()`.
   * @param {GetTransactionStatusOptions} [options] - Optional filters to apply on the transaction.
   * @returns {Promise<LayerswapTransactionStatus>} Layerswap's assessment of the transaction.
   * @throws {ValueError} If the source chain is not supported by Layerswap.
   * @throws {NoSuchElementError} If Layerswap has not indexed the transaction (yet).
   * @throws {ProviderRequiredError} If 'sourceChain' is omitted and the source chain cannot be detected without a provider.
   * @throws {ProviderError} If the Layerswap API or the provider fails to fetch the transaction status.
   */
  async getTransactionStatus (hash, options = {}) {
    const networkName = options.sourceChain ?? (await this._detectSourceNetwork()).name
    const transactionId = await this._resolveTransactionId(hash)
    return this._client.getTransactionStatus(networkName, transactionId)
  }

  /**
   * Resolves a transaction hash returned by `swidge()` to the id Layerswap tracks the
   * deposit by. They are the same on most chains; VM implementations override it when not.
   *
   * @protected
   * @param {string} hash - The transaction hash returned by `swidge()`.
   * @returns {Promise<string>} The Layerswap transaction id.
   * @throws {NoSuchElementError} If the deposit has not been indexed (yet).
   * @throws {ProviderRequiredError} If the hash cannot be resolved without a provider.
   * @throws {ProviderError} If the provider fails to resolve the hash.
   */
  async _resolveTransactionId (hash) {
    return hash
  }

  /**
   * Detects the Layerswap source network the wallet account is connected to.
   *
   * @abstract
   * @protected
   * @returns {Promise<LayerswapNetwork>} The source network.
   * @throws {ValueError} If Layerswap does not support the detected network.
   * @throws {ProviderRequiredError} If the network cannot be detected without a provider.
   * @throws {ProviderError} If the provider fails to report the network.
   */
  async _detectSourceNetwork () {
    throw new NotImplementedError('_detectSourceNetwork()')
  }

  /**
   * Asserts that the bound wallet account is connected to the source network named by
   * 'fromChain', so a deposit is never broadcast on a different chain than the one the
   * Layerswap swap is created for. Skipped when no account is bound, or when the account has
   * no provider to detect its network from. VM implementations override it when their
   * network detection cannot identify every network they support.
   *
   * @protected
   * @param {LayerswapNetwork} network - The source network named by 'fromChain'.
   * @returns {Promise<void>}
   * @throws {ValueError} If the account is connected to a different network.
   * @throws {ProviderError} If the provider fails to report its network.
   */
  async _assertAccountNetwork (network) {
    if (!this._account) return

    let detected
    try {
      detected = await this._detectSourceNetwork()
    } catch (error) {
      if (error instanceof ProviderRequiredError) return
      throw error
    }

    if (detected.name !== network.name) {
      throw new ValueError(`The 'fromChain' option is '${network.name}', but the wallet account is connected to '${detected.name}'.`)
    }
  }

  /**
   * Parses the amount a Layerswap deposit action asks the wallet to send, and checks it is
   * positive and does not exceed the requested input amount.
   *
   * @protected
   * @param {unknown} value - The amount, in base units, or a decimal amount when 'decimals' is given.
   * @param {bigint} fromTokenAmount - The requested input amount, in source-token base units.
   * @param {number} [decimals] - The decimals of a decimal amount.
   * @returns {bigint} The deposit amount, in source-token base units.
   * @throws {ProviderError} If the amount is missing, malformed, or out of range.
   */
  _parseDepositAmount (value, fromTokenAmount, decimals) {
    let amount
    try {
      amount = decimals === undefined
        ? BigInt(/** @type {any} */ (value))
        : parseDecimal(/** @type {any} */ (value), decimals)
    } catch (_) {
      amount = undefined
    }

    if (amount === undefined || amount <= 0n || amount > fromTokenAmount) {
      throw new ProviderError(`Layerswap returned an invalid deposit amount '${value}' for a requested amount of ${fromTokenAmount} base units.`, {
        reason: ProviderErrorReason.INTERNAL_SERVER_ERROR
      })
    }

    return amount
  }

  /**
   * Tests whether the bound account is a writable (non read-only) wallet account, i.e.
   * exposes `sendTransaction`. This is a duck-type check rather than an `instanceof` check
   * because wallet packages may resolve to a different copy than the VM package's own, and
   * `instanceof` would then fail on a structurally-correct account. VM implementations
   * override it when their accounts need a stricter check.
   *
   * @protected
   * @param {unknown} account - The bound account.
   * @returns {boolean} True if the account can sign and send transactions.
   */
  _isWritableAccount (account) {
    return Boolean(account && typeof account === 'object' && typeof account.sendTransaction === 'function')
  }

  /**
   * Tests whether the bound (writable) account has been disposed: either it reports so
   * through the WDK `IDisposable.disposed` getter, or its private key has been erased.
   * WDK wallet accounts do not implement `disposed` yet, but their `dispose()` wipes the
   * private key, which `keyPair.privateKey` then reports as `null`. VM implementations
   * override it when their accounts need a stricter check.
   *
   * @protected
   * @param {any} account - The bound account.
   * @returns {boolean} True if the account has been disposed.
   */
  _isDisposedAccount (account) {
    return account.disposed === true || account.keyPair?.privateKey === null
  }

  /**
   * Runs VM-specific checks on the resolved route before a swap is created.
   *
   * @protected
   * @param {LayerswapSwidgeRoute} route - The resolved swidge route.
   * @throws {InvalidTokenError} If the source token cannot be deposited from this VM.
   * @throws {ProviderRequiredError} If the account is not connected to a provider.
   */
  _assertSwidgeRoute (route) { }

  /**
   * Estimates the source-chain gas of the deposit, for quotes. Implementations return
   * undefined when no estimate is available.
   *
   * @protected
   * @param {LayerswapSwidgeRoute} route - The resolved swidge route.
   * @param {bigint} amount - The input amount in source-token base units.
   * @param {string} sourceAddress - The address of the bound account.
   * @returns {Promise<bigint | undefined>} The estimated gas, in native base units.
   */
  async _quoteSourceGas (route, amount, sourceAddress) {
    return undefined
  }

  /**
   * Builds the source-chain deposit described by the Layerswap deposit action.
   *
   * @abstract
   * @protected
   * @param {LayerswapDepositContext} context - The deposit context.
   * @returns {Promise<LayerswapPreparedDeposit>} The prepared deposit.
   * @throws {ProviderError} If the deposit action is malformed, or the provider fails.
   * @throws {SwidgeError} If the account has insufficient funds.
   */
  async _prepareDeposit (context) {
    throw new NotImplementedError('_prepareDeposit(context)')
  }

  /**
   * Broadcasts a prepared deposit.
   *
   * @abstract
   * @protected
   * @param {LayerswapPreparedDeposit} deposit - The prepared deposit.
   * @param {C} [config] - The swidge execution configuration.
   * @returns {Promise<LayerswapBroadcastDeposit>} The broadcast deposit.
   * @throws {ProviderError} If the provider fails to broadcast the deposit.
   * @throws {SwidgeError} If the account has insufficient funds.
   * @throws {MaximumFeeExceededError} If the wallet rejects the transaction fee.
   */
  async _sendDeposit (deposit, config) {
    throw new NotImplementedError('_sendDeposit(deposit, config)')
  }

  /**
   * The symbol of the source chain's native token, used for gas fee entries when the
   * Layerswap network catalog does not report it.
   *
   * @protected
   * @type {string}
   */
  get _nativeTokenSymbol () {
    return ''
  }

  /**
   * Maps the legacy bridge options onto the swidge options vocabulary. The legacy
   * `slippage` is a percent string ('0.5' = 0.5%); swidge takes a decimal (0.005).
   *
   * @protected
   * @param {B} options - The bridge options.
   * @returns {O} The swidge options.
   */
  _toSwidgeOptions (options) {
    return /** @type {O} */ ({
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
    })
  }

  /**
   * Splits a swidge fee breakdown back into the legacy `{ fee, bridgeFee }` pair:
   * `fee` = non-included fees (source-chain gas, native units), `bridgeFee` = included
   * fees (Layerswap's cut, source-token base units).
   *
   * @protected
   * @param {SwidgeFee[]} fees - The swidge fees.
   * @returns {LayerswapLegacyBridgeFees} The legacy fees.
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
   * @protected
   * @param {bigint | number} gas - The gas cost, in native base units.
   * @param {LayerswapNetwork} sourceNetwork - The source network.
   * @returns {SwidgeFee} The gas fee entry.
   */
  _buildGasFee (gas, sourceNetwork) {
    return {
      type: 'network',
      amount: BigInt(gas),
      token: sourceNetwork.token?.symbol ?? this._nativeTokenSymbol,
      chain: sourceNetwork.name,
      included: false,
      description: 'Source-chain gas'
    }
  }

  /**
   * Validates the exact-in/exact-out split. Layerswap quotes are driven by the source
   * amount, so exact-out operations are rejected.
   *
   * @protected
   * @param {LayerswapSwidgeOptions} options - The swidge options.
   * @returns {bigint} The input amount in source-token base units.
   * @throws {ValueError} If the options are exact-out, or omit 'fromTokenAmount', or it is not an integer.
   */
  _requireExactIn (options) {
    if (options.toTokenAmount !== undefined) {
      throw new ValueError('Layerswap only supports exact-in operations. Use fromTokenAmount instead of toTokenAmount.')
    }
    if (options.fromTokenAmount === undefined) {
      throw new ValueError("The 'fromTokenAmount' option is required.")
    }
    return toBigIntOption(options.fromTokenAmount, 'fromTokenAmount')
  }

  /**
   * Resolves the swidge route (networks and tokens on both sides) from the options.
   *
   * @protected
   * @param {LayerswapSwidgeOptions} options - The swidge options.
   * @returns {Promise<LayerswapSwidgeRoute>} The resolved route.
   * @throws {ValueError} If the route is not valid or not supported by Layerswap.
   * @throws {InvalidTokenError} If the from or to tokens are not supported by Layerswap.
   * @throws {ProviderRequiredError} If 'fromChain' is omitted and the source chain cannot be detected without a provider.
   * @throws {ProviderError} If the Layerswap API or the provider fails.
   */
  async _resolveSwidgeRoute (options) {
    let sourceNetwork

    if (options.fromChain !== undefined) {
      sourceNetwork = await resolveNetworkByName(this._client, String(options.fromChain))
      await this._assertAccountNetwork(sourceNetwork)
    } else {
      sourceNetwork = await this._detectSourceNetwork()
    }

    const sourceToken = resolveToken(sourceNetwork, options.fromToken)

    if (options.toChain === undefined) {
      throw new ValueError("Layerswap does not support same-chain swaps. The 'toChain' option is required and must differ from the source chain.")
    }

    const destinationNetwork = await resolveNetworkByName(this._client, String(options.toChain))
    const destinationToken = resolveToken(destinationNetwork, options.toToken ?? sourceToken.symbol)

    if (sourceNetwork.name === destinationNetwork.name) {
      throw new ValueError('The target chain cannot be equal to the source chain.')
    }

    return { sourceNetwork, sourceToken, destinationNetwork, destinationToken }
  }

  /**
   * Resolves the destination recipient. Defaults to the account's own address, but only
   * when source and destination networks share the same address format (same VM type).
   *
   * @protected
   * @param {LayerswapSwidgeOptions} options - The swidge options.
   * @param {LayerswapNetwork} sourceNetwork - The source network.
   * @param {LayerswapNetwork} destinationNetwork - The destination network.
   * @returns {Promise<string>} The recipient address.
   * @throws {ValueError} If the recipient is required but missing.
   */
  async _resolveRecipient (options, sourceNetwork, destinationNetwork) {
    if (options.recipient !== undefined) return options.recipient

    if (this._account && sourceNetwork.type === destinationNetwork.type) {
      return this._callWallet(() => this._account.getAddress())
    }

    throw new ValueError("The 'recipient' option is required when the destination chain uses a different address format than the source chain.")
  }

  /**
   * Creates the Layerswap swap and picks its wallet-flow deposit action.
   *
   * @protected
   * @param {LayerswapSwidgeOptions} options - The swidge options.
   * @param {LayerswapSwidgeRoute} route - The resolved route.
   * @param {bigint} fromTokenAmount - The input amount in source-token base units.
   * @returns {Promise<LayerswapDepositSwap>} The created swap.
   * @throws {ValueError} If Layerswap rejects the swap parameters.
   * @throws {ProviderError} If the Layerswap API fails, or returns malformed deposit instructions.
   */
  async _createSwap (options, route, fromTokenAmount) {
    const { sourceNetwork, sourceToken, destinationNetwork, destinationToken } = route

    const sourceAddress = await this._callWallet(() => this._account.getAddress())
    const recipient = await this._resolveRecipient(options, sourceNetwork, destinationNetwork)

    /** @type {LayerswapSwapResponse} */
    const response = await this._client.createSwap({
      source_network: sourceNetwork.name,
      source_token: sourceToken.symbol,
      destination_network: destinationNetwork.name,
      destination_token: destinationToken.symbol,
      destination_address: recipient,
      amount: formatBaseUnits(fromTokenAmount, sourceToken.decimals),
      use_deposit_address: false,
      source_address: sourceAddress,
      // Layerswap requires a refund address on routes with a swap leg; the source account
      // is where a failed deposit is returned to anyway.
      refund_address: options.refundAddress ?? sourceAddress,
      refuel: options.refuel,
      slippage: formatSlippage(options.slippage),
      reference_id: options.referenceId
    })

    const swap = response?.swap

    if (!swap || !swap.id) {
      throw new ProviderError('Layerswap response is missing swap details.', {
        reason: ProviderErrorReason.INTERNAL_SERVER_ERROR
      })
    }

    const action = this._pickWalletDepositAction(response.deposit_actions)

    return { swap, action, quote: response.quote?.quote }
  }

  /**
   * Picks the wallet-flow deposit action (`type: 'transfer'`). `manual_transfer` actions
   * cannot be driven from a wallet account.
   *
   * @protected
   * @param {LayerswapDepositAction[]} [depositActions] - The deposit actions returned by Layerswap.
   * @returns {LayerswapDepositAction} The wallet-flow deposit action.
   * @throws {ProviderError} If Layerswap did not return a wallet-flow deposit action.
   */
  _pickWalletDepositAction (depositActions) {
    if (!Array.isArray(depositActions) || depositActions.length === 0) {
      throw new ProviderError('Layerswap did not return any deposit actions for this swap.', {
        reason: ProviderErrorReason.INTERNAL_SERVER_ERROR
      })
    }

    const transfer = depositActions.find((a) => a.type === 'transfer')
    if (transfer) return transfer

    throw new ProviderError("Layerswap returned only non-wallet deposit actions (e.g. 'manual_transfer'); cannot drive the deposit from this wallet.", {
      reason: ProviderErrorReason.INTERNAL_SERVER_ERROR
    })
  }

  /**
   * Runs a wallet account (or chain client) call, normalizing the errors it may raise so
   * that they comply with the `ISwidgeProtocol` throw contract. VM implementations may
   * override it to map chain-specific errors first.
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
      throw normalizeWalletError(error)
    }
  }

  /**
   * Informs Layerswap that the deposit has been broadcast. Best-effort — failures are
   * swallowed because Layerswap's watcher will still detect the on-chain deposit on its
   * own. Awaited (rather than fire-and-forget) so the API call's lifetime is bounded by
   * `swidge()`'s return.
   *
   * @protected
   * @param {string} swapId - The Layerswap swap id.
   * @param {string} hash - The deposit transaction hash.
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
