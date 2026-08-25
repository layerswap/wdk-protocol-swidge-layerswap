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

import { SwidgeProtocol } from '@tetherto/wdk-wallet/protocols'
// Import TON primitives from `@ton/ton` (which re-exports `@ton/core`) — *not* from
// `@ton/core` directly. `@tetherto/wdk-wallet-ton` brings its own copy of `@ton/core`
// transitively via `@ton/ton`; depending on `@ton/core` directly causes pnpm to resolve
// two copies, which makes the wallet reject our Cell objects with "Invalid argument"
// when the internal `storeRef(body)` does an `instanceof Cell` check against the wrong
// class.
import { Address, beginCell, toNano } from '@ton/ton'

import LayerswapApiClient, {
  resolveNetworkByName,
  resolveToken,
  formatBaseUnits,
  buildStatusResult,
  buildSupportedChains,
  buildSupportedTokens,
  buildSwidgeQuote,
  formatSlippage,
  assertFeeGuards
} from '@layerswap/wdk-protocol-swidge-layerswap-core'

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

/** @typedef {import('@tetherto/wdk-wallet-ton').WalletAccountTon} WalletAccountTon */
/** @typedef {import('@tetherto/wdk-wallet-ton').WalletAccountReadOnlyTon} WalletAccountReadOnlyTon */

/** @typedef {import('@ton/core').Cell} Cell */

/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapNetwork} LayerswapNetwork */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapToken} LayerswapToken */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapDepositAction} LayerswapDepositAction */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSwap} LayerswapSwap */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapQuote} LayerswapQuote */

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
 * @property {string | number} [fromChain]    - Layerswap source network name. Defaults to
 *                                              `'TON_MAINNET'` (Layerswap only lists TON mainnet at the
 *                                              time of writing, and TON has no stable network id to
 *                                              auto-detect from).
 * @property {boolean} [refuel]               - Request a native-gas drop on the destination chain.
 * @property {string} [referenceId]           - External reference id for the created swap.
 */

/**
 * @typedef {Object} BridgeOptions
 * @property {string} targetChain             - Layerswap destination network name (e.g. `'ARBITRUM_MAINNET'`).
 * @property {string} recipient               - Destination-chain recipient address, in its native format.
 * @property {string} token                   - Source token: jetton master address OR Layerswap symbol
 *                                              (e.g. `'TON'`, `'USDT'`).
 * @property {number | bigint} amount         - Source amount in base units (nanotons for TON, smallest
 *                                              unit for jetton tokens).
 * @property {string} [destinationToken]      - Destination token (address or symbol). Defaults to the
 *                                              source token's symbol.
 * @property {string} [sourceChain]           - Override the default source network name. Defaults to
 *                                              `'TON_MAINNET'` (Layerswap only lists mainnet at the time
 *                                              of writing, and TON has no stable network id we can read).
 * @property {boolean} [refuel]               - Request a native-gas drop on the destination chain.
 * @property {string} [slippage]              - Slippage tolerance percentage, e.g. `'0.5'`.
 * @property {string} [referenceId]           - External reference id for the created swap.
 * @property {string} [refundAddress]         - Refund address used if the swap fails after deposit.
 */

/**
 * @typedef {BridgeResult & { swapId: string }} LayerswapBridgeResult
 */

const DEFAULT_SOURCE_NETWORK_NAME = 'TON_MAINNET'

// Gas / forward-amount constants for the jetton transfer message. Mirrors the
// Layerswap web app's `TonWalletWithdraw` exactly.
const TON_JETTON_MESSAGE_VALUE = toNano('0.045') // 45_000_000n — total message value (gas)
const TON_JETTON_FORWARD_VALUE = toNano('0.00002') // 20_000n     — value forwarded to recipient wallet

// Quote-time fee approximations (in nanotons). Swidge-time fees come from the
// wallet's `sendTransaction` return value.
const TON_NATIVE_FEE_APPROX_NANOTONS = 10_000_000n // 0.01 TON
const TON_JETTON_FEE_APPROX_NANOTONS = 50_000_000n // 0.05 TON (includes 0.045 message value)

// Jetton transfer opcode (CRC32 of 'transfer'). TIP-3 standard.
const JETTON_TRANSFER_OP = 0x0f8a7ea5

/**
 * WDK swidge protocol that drives a Layerswap swap from a TON wallet account.
 *
 * Implements the `SwidgeProtocol` interface from `@tetherto/wdk-wallet/protocols`:
 * `quoteSwidge` / `swidge` / `getSwidgeStatus` / `getSupportedChains` / `getSupportedTokens`,
 * which also provides the WDK `swap`/`bridge` module surfaces via the base class.
 *
 * Unlike on-chain bridges this protocol is HTTP-orchestrated:
 *   1. POST /api/v2/swaps to create a swap and receive the deposit address + a JSON `call_data`
 *      containing the Layerswap reference comment (and, for jettons, the amount).
 *   2. Build the deposit message body client-side via `@ton/core`:
 *      - Native TON: a comment cell with op `0` and the Layerswap comment as `storeStringTail`.
 *      - Jetton: a TIP-3 jetton-transfer body (op `0x0f8a7ea5`) with the comment in the
 *        forward payload, sent to the sender's jetton wallet with a ~0.045 TON gas budget.
 *   3. Hand `{ to, value, body }` to `account.sendTransaction(...)`, which sets up the v5r1
 *      wallet contract, signs with the secret key, and broadcasts via `_contract.send`.
 *   4. Layerswap performs the destination-chain payout off-chain.
 *
 * `swidge()` resolves once the source-chain deposit message has been broadcast; the
 * destination payout completes asynchronously and can be tracked with
 * `getSwidgeStatus(result.id)`.
 *
 * Fee semantics: Layerswap deducts its fees from the source-token amount, so 'protocol'
 * and Layerswap's destination 'network' fee entries are denominated in the **source
 * token** and flagged `included: true`. Source-chain gas is a separate non-included
 * 'network' fee in **native nanotons**. Do not sum amounts across fee entries with
 * different `token` values.
 */
export default class LayerswapProtocolTon extends SwidgeProtocol {
  /**
   * Creates a new swidge protocol for chain/token discovery only, without a wallet account.
   *
   * @overload
   * @param {undefined} [account] - No account; only discovery and quotes work.
   * @param {LayerswapProtocolConfig} [config] - The layerswap protocol configuration.
   */

  /**
   * Creates a new read-only interface to the layerswap protocol for the TON blockchain.
   *
   * @overload
   * @param {WalletAccountReadOnlyTon} account - The wallet account to use to interact with the protocol.
   * @param {LayerswapProtocolConfig} [config] - The layerswap protocol configuration.
   */

  /**
   * Creates a new interface to the layerswap protocol for the TON blockchain.
   *
   * @overload
   * @param {WalletAccountTon} account - The wallet account to use to interact with the protocol.
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
  }

  /**
   * Quotes the estimated costs and output of a Layerswap swidge operation without
   * creating a swap. Layerswap only supports exact-in operations; passing
   * `toTokenAmount` throws.
   *
   * When the protocol has an account bound, the quote includes a non-included
   * 'network' fee entry with the approximated source-chain gas (in nanotons):
   *   - Native TON: ~0.01 TON.
   *   - Jetton: ~0.05 TON (includes the 0.045 TON message value budgeted for
   *     jetton-wallet gas + forward amount).
   * The actual gas is only known after broadcasting and is reported by `swidge()`.
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

    if (this._account) {
      const gas = route.sourceToken.contract
        ? TON_JETTON_FEE_APPROX_NANOTONS
        : TON_NATIVE_FEE_APPROX_NANOTONS
      swidgeQuote.fees.push(this._buildGasFee(gas, route.sourceNetwork))
    }

    return swidgeQuote
  }

  /**
   * Executes a Layerswap swidge operation: creates the swap, checks the fee guards,
   * builds the TON deposit message, and broadcasts it from the wallet account.
   *
   * Resolves once the deposit has been broadcast. Layerswap finishes the
   * destination-chain payout asynchronously; track it with `getSwidgeStatus(result.id)`.
   *
   * Guard ordering note: the TON wallet only reports the actual source-chain gas from
   * `sendTransaction`'s return value (there is no pre-broadcast estimation in the old
   * flow), so the WDK bps fee guards are enforced *before* broadcasting against the
   * included Layerswap fees; the actual gas entry is appended to the result's fees
   * after the broadcast.
   *
   * @param {LayerswapSwidgeOptions} options - The swidge options.
   * @param {SwidgeProtocolConfig & Pick<LayerswapProtocolConfig, 'bridgeMaxFee'>} [config] - Optional
   *   execution configuration overrides.
   * @returns {Promise<SwidgeResult>} The swidge execution result. `id` is the Layerswap swap
   *   id (use it with `getSwidgeStatus`); `hash` is the TON external-message hash of the deposit.
   */
  async swidge (options, config) {
    if (!this._isWritableAccount(this._account)) {
      throw new Error("The 'swidge(options)' method requires the protocol to be initialized with a non read-only account.")
    }

    const route = await this._resolveSwidgeRoute(options)
    const fromTokenAmount = this._requireExactIn(options)
    const merged = { ...this._config, ...config }

    const { swap, action, parsedCallData, quote } = await this._createDepositSwap(options, route, fromTokenAmount)

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

    assertFeeGuards(fees, fromTokenAmount, route.sourceToken.symbol, merged)

    const message = await this._buildDepositMessage({
      sourceToken: route.sourceToken,
      action,
      parsedCallData,
      amount: fromTokenAmount
    })

    const { hash, fee } = await this._account.sendTransaction(message)

    fees.push(this._buildGasFee(BigInt(fee), route.sourceNetwork))

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
   *   network name (e.g. `'TON_MAINNET'`) — use it as `fromChain`/`toChain`.
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
   * pre-swidge interface of this package: `hash` is the TON external-message hash of
   * the deposit (not the swap id), and the Layerswap swap id is returned in the extra
   * `swapId` field.
   *
   * Semantic note: `bridgeFee` is in **source-token base units**, not native nanotons —
   * it is the total fee Layerswap deducts from the source amount. `fee` is the
   * source-chain gas cost in nanotons. Do not sum them.
   *
   * @param {BridgeOptions} options - The bridge's options.
   * @param {Pick<LayerswapProtocolConfig, 'bridgeMaxFee'>} [config] - Per-call overrides.
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
   * approximated source-chain gas in nanotons (~0.01 TON native, ~0.05 TON jetton);
   * `bridgeFee` is Layerswap's total fee in source-token base units. See `bridge()`
   * for the semantics.
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
   * follow-up after `swidge()` returns — even if the wallet's `sendTransaction` resolved,
   * the message can still be discarded by the validator or fail at the jetton wallet.
   * Returns `'completed' | 'failed' | 'pending'`.
   *
   * The source network defaults to `TON_MAINNET` (TON has no stable network id and
   * Layerswap currently lists only mainnet); pass `options.sourceChain` to override.
   *
   * @param {string} hash - The TON external-message hash returned by `swidge()`.
   * @param {{ sourceChain?: string }} [options]
   * @returns {Promise<import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapTransactionStatus>}
   */
  async getTransactionStatus (hash, options = {}) {
    const networkName = options.sourceChain ?? DEFAULT_SOURCE_NETWORK_NAME
    return this._client.getTransactionStatus(networkName, hash)
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
   * `fee` = non-included fees (source-chain gas, nanotons), `bridgeFee` = included
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
   * Builds the non-included source-chain gas fee entry (in nanotons).
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
      token: sourceNetwork.token?.symbol ?? 'TON',
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
   * The source network defaults to `TON_MAINNET` — TON has no stable network id to
   * auto-detect from; pass `fromChain` to override.
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
    const sourceName = options.fromChain !== undefined
      ? String(options.fromChain)
      : DEFAULT_SOURCE_NETWORK_NAME

    const sourceNetwork = await resolveNetworkByName(this._client, sourceName)
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
   * Calls `POST /api/v2/swaps` for the resolved route and extracts the wallet-driven
   * deposit action, the parsed `call_data` JSON, and the create-swap quote.
   *
   * @private
   * @param {LayerswapSwidgeOptions} options
   * @param {{ sourceNetwork: LayerswapNetwork, sourceToken: LayerswapToken, destinationNetwork: LayerswapNetwork, destinationToken: LayerswapToken }} route
   * @param {bigint} fromTokenAmount
   * @returns {Promise<{
   *   swap: LayerswapSwap,
   *   action: LayerswapDepositAction,
   *   parsedCallData: { comment?: string, amount?: string | number } | null,
   *   quote: LayerswapQuote | undefined
   * }>}
   */
  async _createDepositSwap (options, route, fromTokenAmount) {
    const { sourceNetwork, sourceToken, destinationNetwork, destinationToken } = route

    const sourceAddress = await this._account.getAddress()
    const recipient = await this._resolveRecipient(options, sourceNetwork, destinationNetwork)

    /** @type {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSwapResponse} */
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

    if (typeof action.to_address !== 'string' || action.to_address.length === 0) {
      throw new Error('Layerswap deposit action for TON is missing to_address; the deposit message cannot be built.')
    }

    const parsedCallData = this._parseCallData(action.call_data)

    return { swap, action, parsedCallData, quote: response.quote?.quote }
  }

  /**
   * Picks the wallet-flow deposit action (`type: 'transfer'`). Layerswap may return
   * additional `manual_transfer` actions; those are ignored here. Throws if no
   * wallet-driven action is present so the caller gets a clear error.
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

    throw new Error("Layerswap returned only non-wallet deposit actions (e.g. 'manual_transfer'); cannot drive the deposit from this wallet.")
  }

  /**
   * Parses Layerswap's `call_data` for TON, which the Layerswap web app expects as a JSON
   * string with optional `comment` and `amount` fields. Tolerates missing / empty / non-JSON
   * payloads by returning `null` — the deposit message will then carry an empty comment.
   *
   * @private
   * @param {string | null | undefined} callData
   * @returns {{ comment?: string, amount?: string | number } | null}
   */
  _parseCallData (callData) {
    if (callData === null || callData === undefined || callData === '') {
      return null
    }
    try {
      const parsed = JSON.parse(callData)
      if (parsed && typeof parsed === 'object') return parsed
      return null
    } catch (_) {
      return null
    }
  }

  /**
   * Builds the `{ to, value, body }` argument for `account.sendTransaction(...)`. Branches
   * on `sourceToken.contract`: jetton master address present → jetton path, otherwise
   * native TON path.
   *
   * @private
   * @param {Object} params
   * @param {LayerswapToken} params.sourceToken
   * @param {LayerswapDepositAction} params.action
   * @param {{ comment?: string, amount?: string | number } | null} params.parsedCallData
   * @param {bigint} params.amount
   * @returns {Promise<{ to: string, value: bigint, body: Cell }>}
   */
  async _buildDepositMessage ({ sourceToken, action, parsedCallData, amount }) {
    const comment = (parsedCallData && typeof parsedCallData.comment === 'string')
      ? parsedCallData.comment
      : ''

    if (!sourceToken.contract) {
      // Native TON deposit — body is just a comment cell, value is the swap amount.
      const body = beginCell()
        .storeUint(0, 32)
        .storeStringTail(comment)
        .endCell()

      return { to: action.to_address, value: amount, body }
    }

    // Jetton deposit — body is a TIP-3 jetton-transfer; value is gas budget; target
    // is the sender's per-jetton wallet, not the deposit address directly.
    const depositAddress = Address.parse(action.to_address)

    const forwardPayload = beginCell()
      .storeUint(0, 32)
      .storeStringTail(comment)
      .endCell()

    // Prefer Layerswap-supplied amount over the caller's amount (matches the
    // Layerswap web app's behaviour — Layerswap may re-quote the deposit amount slightly).
    const jettonAmount = this._resolveJettonAmount(parsedCallData, amount)

    const body = beginCell()
      .storeUint(JETTON_TRANSFER_OP, 32)
      .storeUint(0, 64) // query id
      .storeCoins(jettonAmount)
      .storeAddress(depositAddress) // jetton transfer destination
      .storeAddress(depositAddress) // response_destination (excess + notification target)
      .storeBit(0) // no custom payload
      .storeCoins(TON_JETTON_FORWARD_VALUE)
      .storeBit(1) // forward payload is a ref
      .storeRef(forwardPayload)
      .endCell()

    const jettonWalletAddress = await this._account._getJettonWalletAddress(sourceToken.contract)

    return {
      to: jettonWalletAddress.toString(),
      value: TON_JETTON_MESSAGE_VALUE,
      body
    }
  }

  /**
   * Resolves the jetton amount to encode in the jetton-transfer body. Prefers Layerswap's
   * `parsedCallData.amount` (matches the UI), falls back to the caller's amount.
   *
   * @private
   * @param {{ amount?: string | number } | null} parsedCallData
   * @param {bigint} fallbackAmount
   * @returns {bigint}
   */
  _resolveJettonAmount (parsedCallData, fallbackAmount) {
    if (!parsedCallData || parsedCallData.amount === undefined || parsedCallData.amount === null) {
      return fallbackAmount
    }
    try {
      return BigInt(parsedCallData.amount)
    } catch (_) {
      return fallbackAmount
    }
  }

  /**
   * Tests whether the bound account is a writable TON wallet account
   * (i.e. exposes `sendTransaction`). This is a duck-type check rather than an
   * `instanceof WalletAccountTon` check because pnpm-workspace setups can resolve
   * the wallet package to a different copy than this package's own copy when the
   * dep tree's peer-dep contexts diverge — `instanceof` would then fail on a
   * structurally-correct account. Read-only accounts do not expose `sendTransaction`.
   *
   * @private
   * @param {unknown} account
   * @returns {boolean}
   */
  _isWritableAccount (account) {
    return !!(account && typeof account === 'object' && typeof account.sendTransaction === 'function')
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
