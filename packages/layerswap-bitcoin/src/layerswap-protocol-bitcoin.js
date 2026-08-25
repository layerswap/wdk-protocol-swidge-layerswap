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
import { Psbt, opcodes, script as bscript } from 'bitcoinjs-lib'
import { coinselect } from '@bitcoinerlab/coinselect'
import { DescriptorsFactory } from '@bitcoinerlab/descriptors'
import * as ecc from '@bitcoinerlab/secp256k1'

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

/** @typedef {import('@tetherto/wdk-wallet-btc').WalletAccountBtc} WalletAccountBtc */
/** @typedef {import('@tetherto/wdk-wallet-btc').WalletAccountReadOnlyBtc} WalletAccountReadOnlyBtc */

/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapNetwork} LayerswapNetwork */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapToken} LayerswapToken */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapDepositAction} LayerswapDepositAction */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSwap} LayerswapSwap */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapQuote} LayerswapQuote */

/**
 * Maps the wallet account's `config.network` value to the Layerswap network name.
 * Only `bitcoin` (mainnet) is currently listed in Layerswap's catalog; the testnet
 * mappings are reserved for future use.
 */
/* eslint-disable quote-props */
const NETWORK_TO_LAYERSWAP_NAME = Object.freeze({
  'bitcoin': 'BITCOIN_MAINNET',
  'testnet': 'BITCOIN_TESTNET',
  'regtest': 'BITCOIN_REGTEST'
})
/* eslint-enable quote-props */

// OP_RETURN payload limit (Bitcoin standardness rule).
const OP_RETURN_MAX_BYTES = 80

// Quote-time fee approximation. Swidge-time fee is read from the built PSBT.
// 10 sat/vB × ~150 vB (1 input + 2 outputs P2WPKH + OP_RETURN) ≈ 1500 sats.
const BTC_FEE_APPROX_SATS = 1500n

const { Output } = DescriptorsFactory(ecc)

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
 *                                              *source-token base units* (satoshis). Compared against the
 *                                              total Layerswap fee before broadcasting the deposit transaction.
 * @property {number} [requestTimeoutMs]      - HTTP timeout for Layerswap API calls. Default: 30000.
 * @property {number} [confirmationTarget]    - Target confirmation block count for fee estimation.
 *                                              Default: 1.
 */

/**
 * Layerswap-specific extensions to the WDK swidge options.
 *
 * @typedef {SwidgeOptions & Object} LayerswapSwidgeOptions
 * @property {string | number} [fromChain]    - Layerswap source network name (e.g. `'BITCOIN_MAINNET'`).
 *                                              Defaults to the mapping of the account's `config.network`
 *                                              (`bitcoin`/`testnet`/`regtest`).
 * @property {boolean} [refuel]               - Request a native-gas drop on the destination chain.
 * @property {string} [referenceId]           - External reference id for the created swap.
 * @property {number | bigint} [feeRate]      - Override the fee rate (sat/vB) used for PSBT construction.
 */

/**
 * @typedef {Object} BridgeOptions
 * @property {string} targetChain             - Layerswap destination network name (e.g. `'ARBITRUM_MAINNET'`).
 * @property {string} recipient               - Destination-chain recipient address, in its native format.
 * @property {string} token                   - Source token. Only native BTC is supported; pass `'BTC'`.
 * @property {number | bigint} amount         - Source amount in satoshis.
 * @property {string} [destinationToken]      - Destination token (address or symbol). Defaults to BTC's
 *                                              symbol.
 * @property {string} [sourceChain]           - Override the auto-detected source network name. Auto-detection
 *                                              maps `account._config.network` (`bitcoin`/`testnet`/`regtest`)
 *                                              to `BITCOIN_MAINNET`/`BITCOIN_TESTNET`/`BITCOIN_REGTEST`.
 * @property {boolean} [refuel]               - Request a native-gas drop on the destination chain.
 * @property {string} [slippage]              - Slippage tolerance percentage, e.g. `'0.5'`.
 * @property {string} [referenceId]           - External reference id for the created swap.
 * @property {string} [refundAddress]         - Refund address used if the swap fails after deposit.
 * @property {number | bigint} [feeRate]      - Override the fee rate (sat/vB) used for PSBT construction.
 */

/**
 * @typedef {BridgeResult & { swapId: string }} LayerswapBridgeResult
 */

/**
 * WDK swidge protocol that drives a Layerswap swap from a Bitcoin wallet account.
 *
 * Implements the `SwidgeProtocol` interface from `@tetherto/wdk-wallet/protocols`:
 * `quoteSwidge` / `swidge` / `getSwidgeStatus` / `getSupportedChains` / `getSupportedTokens`,
 * which also provides the WDK `swap`/`bridge` module surfaces via the base class.
 *
 * Unlike on-chain bridges this protocol is HTTP-orchestrated:
 *   1. POST /api/v2/swaps to create a swap and receive the deposit address + a numeric
 *      `call_data` reference id.
 *   2. Build a PSBT client-side via `bitcoinjs-lib`:
 *      - Inputs: UTXOs selected with `@bitcoinerlab/coinselect`, factoring the OP_RETURN overhead.
 *      - Output #0: deposit address + value (satoshis).
 *      - Output #1: `OP_RETURN` carrying the swap reference (hex of `Number(callData).toString(16)`,
 *        stored as UTF-8 bytes — matches the Layerswap web app exactly).
 *      - Output #2: change to sender if above the dust limit.
 *   3. Sign with `psbt.signInputHD(idx, account._masterNode)`, finalize, extract, broadcast via
 *      `account._client.broadcast(hex)`.
 *   4. Layerswap performs the destination-chain payout off-chain.
 *
 * `swidge()` resolves once the source-chain deposit transaction has been broadcast; the
 * destination payout completes asynchronously and can be tracked with
 * `getSwidgeStatus(result.id)`.
 *
 * Fee semantics: Layerswap deducts its fees from the source-token amount, so 'protocol'
 * and Layerswap's destination 'network' fee entries are denominated in the **source
 * token** (satoshis) and flagged `included: true`. The source-chain PSBT fee is a
 * separate non-included 'network' fee in **satoshis** of the native token. Do not sum
 * amounts across fee entries with different `token` values.
 *
 * Implementation note: the wallet's high-level `sendTransaction` does not expose an
 * `OP_RETURN` seam, so we replicate the wallet's PSBT build with one extra output. The
 * protocol reaches into a handful of protected wallet members (`_client`, `_masterNode`,
 * `_account`, `_network`, `_dustLimit`, `_path`, `_bip`, `_ensureConnected`, `_toBigInt`).
 * If the wallet version changes the layout of these members, this package will need a
 * matching update.
 */
export default class LayerswapProtocolBitcoin extends SwidgeProtocol {
  /**
   * Creates a new swidge protocol for chain/token discovery only, without a wallet account.
   *
   * @overload
   * @param {undefined} [account] - No account; only discovery and `fromChain`-scoped quotes work.
   * @param {LayerswapProtocolConfig} [config] - The layerswap protocol configuration.
   */

  /**
   * Creates a new read-only interface to the layerswap protocol for bitcoin.
   *
   * @overload
   * @param {WalletAccountReadOnlyBtc} account - The wallet account to use to interact with the protocol.
   * @param {LayerswapProtocolConfig} [config] - The layerswap protocol configuration.
   */

  /**
   * Creates a new interface to the layerswap protocol for bitcoin.
   *
   * @overload
   * @param {WalletAccountBtc} account - The wallet account to use to interact with the protocol.
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
   * 'network' fee entry with an approximation of the source-chain PSBT fee
   * (`BTC_FEE_APPROX_SATS` = 1500 sats). The swidge-time fee is the actual PSBT
   * fee from coinselect.
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
      swidgeQuote.fees.push(this._buildGasFee(BTC_FEE_APPROX_SATS, route.sourceNetwork))
    }

    return swidgeQuote
  }

  /**
   * Executes a Layerswap swidge operation: creates the swap, checks the fee guards,
   * and broadcasts the source-chain deposit transaction (a PSBT with an OP_RETURN
   * memo carrying the swap reference).
   *
   * Resolves once the deposit has been broadcast. Layerswap finishes the
   * destination-chain payout asynchronously; track it with `getSwidgeStatus(result.id)`.
   *
   * @param {LayerswapSwidgeOptions} options - The swidge options.
   * @param {SwidgeProtocolConfig & Pick<LayerswapProtocolConfig, 'bridgeMaxFee'>} [config] - Optional
   *   execution configuration overrides.
   * @returns {Promise<SwidgeResult>} The swidge execution result. `id` is the Layerswap swap
   *   id (use it with `getSwidgeStatus`); `hash` is the source-chain deposit transaction id.
   */
  async swidge (options, config) {
    if (!this._isWritableAccount(this._account)) {
      throw new Error("The 'swidge(options)' method requires the protocol to be initialized with a non read-only account.")
    }

    const route = await this._resolveSwidgeRoute(options)
    const fromTokenAmount = this._requireExactIn(options)
    const merged = { ...this._config, ...config }

    if (route.sourceToken.contract) {
      throw new Error(`Layerswap Bitcoin source token must be native BTC, got '${route.sourceToken.symbol}' with contract '${route.sourceToken.contract}'. Tokens (BRC-20, Runes, etc.) are not supported.`)
    }

    const { swap, action, quote } = await this._createDepositSwap(options, route, fromTokenAmount)

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

    const memo = this._encodeCallDataMemo(action.call_data)

    const { txHex, txid, fee } = await this._buildSignedPsbt({
      depositAddress: action.to_address,
      amount: fromTokenAmount,
      memo,
      feeRateOverride: options.feeRate
    })

    fees.push(this._buildGasFee(fee, route.sourceNetwork))

    assertFeeGuards(fees, fromTokenAmount, route.sourceToken.symbol, merged)

    await this._account._client.broadcast(txHex)

    await this._notifyDepositBroadcast(swap.id, txid)

    return {
      id: swap.id,
      hash: txid,
      fees,
      transactions: [{ hash: txid, chain: route.sourceNetwork.name, type: 'source' }],
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
   *   network name (e.g. `'BITCOIN_MAINNET'`) — use it as `fromChain`/`toChain`.
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
   * Bridges BTC to a different blockchain via Layerswap.
   *
   * Legacy WDK bridge-module surface, kept for backwards compatibility with the
   * pre-swidge interface of this package: `hash` is the source-chain deposit
   * transaction id (not the swap id), and the Layerswap swap id is returned in the
   * extra `swapId` field.
   *
   * Semantic note: `bridgeFee` is in **source-token base units** (satoshis), not
   * native gas — it is the total fee Layerswap deducts from the source amount.
   * `fee` is the source-chain PSBT fee in satoshis. Do not sum them.
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
   * Legacy WDK bridge-module surface, kept for backwards compatibility. `fee` is an
   * approximation of the source-chain PSBT fee (`BTC_FEE_APPROX_SATS` = 1500 sats);
   * `bridgeFee` is Layerswap's total fee in source-token base units (satoshis).
   * See `bridge()` for the semantics.
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
   * follow-up after `swidge()` returns — `broadcast()` returns once the tx is accepted
   * into the mempool, but a transaction can still drop or be replaced before confirmation.
   * Returns `'completed' | 'failed' | 'pending'`.
   *
   * The source network defaults to whatever `account._config.network` maps to (mainnet
   * by default); pass `options.sourceChain` to override.
   *
   * @param {string} txid - The Bitcoin txid returned by `swidge()`.
   * @param {{ sourceChain?: string }} [options]
   * @returns {Promise<import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapTransactionStatus>}
   */
  async getTransactionStatus (txid, options = {}) {
    const networkName = options.sourceChain ?? this._detectSourceNetworkName()
    return this._client.getTransactionStatus(networkName, txid)
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
      ...(options.feeRate !== undefined && { feeRate: options.feeRate }),
      ...(options.slippage !== undefined && { slippage: Number(options.slippage) / 100 })
    }
  }

  /**
   * Splits a swidge fee breakdown back into the legacy `{ fee, bridgeFee }` pair:
   * `fee` = non-included fees (source-chain PSBT fee, satoshis), `bridgeFee` = included
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
   * @param {bigint} fee
   * @param {LayerswapNetwork} sourceNetwork
   * @returns {SwidgeFee}
   */
  _buildGasFee (fee, sourceNetwork) {
    return {
      type: 'network',
      amount: fee,
      token: sourceNetwork.token?.symbol ?? 'BTC',
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
   * @returns {bigint} The input amount in source-token base units (satoshis).
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
    const sourceName = options.fromChain !== undefined
      ? String(options.fromChain)
      : this._detectSourceNetworkName()

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
   * deposit action.
   *
   * @private
   * @param {LayerswapSwidgeOptions} options
   * @param {{ sourceNetwork: LayerswapNetwork, sourceToken: LayerswapToken, destinationNetwork: LayerswapNetwork, destinationToken: LayerswapToken }} route
   * @param {bigint} fromTokenAmount
   * @returns {Promise<{
   *   swap: LayerswapSwap,
   *   action: LayerswapDepositAction,
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
      throw new Error('Layerswap deposit action for Bitcoin is missing to_address; the deposit transaction cannot be built.')
    }

    return { swap, action, quote: response.quote?.quote }
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
   * Maps the wallet account's `config.network` (`bitcoin`/`testnet`/`regtest`) to the
   * Layerswap network name. Defaults to `BITCOIN_MAINNET` if there is no account or the
   * wallet config is unset or unfamiliar.
   *
   * @private
   * @returns {string}
   */
  _detectSourceNetworkName () {
    const network = this._account?._config?.network ?? 'bitcoin'
    return NETWORK_TO_LAYERSWAP_NAME[network] ?? 'BITCOIN_MAINNET'
  }

  /**
   * Encodes Layerswap's numeric `call_data` reference into the UTF-8-of-hex form the
   * Layerswap web app uses for OP_RETURN. Throws if the payload would exceed the
   * standard 80-byte OP_RETURN limit.
   *
   * @private
   * @param {string | null | undefined} callData
   * @returns {Buffer}
   */
  _encodeCallDataMemo (callData) {
    if (callData === null || callData === undefined || callData === '') {
      return Buffer.alloc(0)
    }

    // Mirrors the Layerswap web app (packages/wallets/adapters/bitcoin/src/
    // transferProvider/sendTransaction.ts): the sequence number before the first
    // ';' is hex-encoded via BigInt, any tail (';' included) is appended verbatim,
    // and the resulting string is stored as UTF-8 bytes in the OP_RETURN.
    const raw = String(callData)
    const semi = raw.indexOf(';')
    const seq = semi === -1 ? raw : raw.slice(0, semi)
    const tail = semi === -1 ? '' : raw.slice(semi)

    let seqHex
    try {
      seqHex = BigInt(seq).toString(16)
    } catch (_) {
      throw new Error(`Layerswap call_data for Bitcoin must start with a numeric sequence (got '${callData}'); the web app encodes it via BigInt(seq).toString(16).`)
    }

    const bytes = Buffer.from(seqHex + tail, 'utf8')

    if (bytes.length > OP_RETURN_MAX_BYTES) {
      throw new Error(`Encoded OP_RETURN memo is ${bytes.length} bytes; exceeds the ${OP_RETURN_MAX_BYTES}-byte standardness limit.`)
    }

    return bytes
  }

  /**
   * Builds, signs, and finalises a PSBT that spends UTXOs from the account address to the
   * Layerswap deposit address, with an OP_RETURN memo carrying the swap reference.
   *
   * @private
   * @param {Object} params
   * @param {string}  params.depositAddress
   * @param {bigint}  params.amount
   * @param {Buffer}  params.memo
   * @param {number | bigint} [params.feeRateOverride]
   * @returns {Promise<{ txHex: string, txid: string, fee: bigint }>}
   */
  async _buildSignedPsbt ({ depositAddress, amount, memo, feeRateOverride }) {
    const account = this._account

    await account._ensureConnected()

    const fromAddress = await account.getAddress()
    const network = account._network

    let feeRate
    if (feeRateOverride !== undefined && feeRateOverride !== null) {
      feeRate = account._toBigInt(feeRateOverride)
    } else {
      const confirmationTarget = this._config.confirmationTarget ?? 1
      const feeEstimate = await account._client.estimateFee(confirmationTarget)
      feeRate = account._toBigInt(Math.max(feeEstimate * 100_000, 1))
    }
    if (feeRate < 1n) feeRate = 1n

    const dustLimit = account._dustLimit
    if (amount <= dustLimit) {
      throw new Error(`The amount must be bigger than the dust limit (= ${dustLimit}).`)
    }

    const unspent = await account._client.listUnspent(fromAddress)
    if (!unspent || unspent.length === 0) {
      throw new Error('No unspent outputs available.')
    }

    const fromOutput = new Output({ descriptor: `addr(${fromAddress})`, network })
    const toOutput = new Output({ descriptor: `addr(${depositAddress})`, network })

    const opReturnScript = bscript.compile([opcodes.OP_RETURN, memo])

    const utxosForCoinSelect = unspent.map((u) => ({
      output: fromOutput,
      value: u.value,
      __ref: u
    }))

    // `@bitcoinerlab/coinselect` validates each target against the dust threshold, which
    // rejects OP_RETURN (`value: 0`). We therefore coin-select against just the deposit
    // target, then manually surface OP_RETURN's contribution to the fee.
    const result = coinselect({
      utxos: utxosForCoinSelect,
      remainder: fromOutput,
      targets: [
        { output: toOutput, value: Number(amount) }
      ],
      feeRate: Number(feeRate)
    })

    if (!result) {
      throw new Error('Insufficient balance to send the transaction.')
    }

    // OP_RETURN output bytes: 8 (value, little-endian) + 1 (script-length varint, scripts
    // ≤ 252 bytes use one byte) + scriptLen. OP_RETURN sits outside the witness, so each
    // byte costs `feeRate` sats directly.
    const opReturnExtraBytes = BigInt(8 + 1 + opReturnScript.length)
    const opReturnExtraFee = opReturnExtraBytes * feeRate

    const selectedUtxos = result.utxos.map(({ __ref }) => __ref)
    const total = selectedUtxos.reduce((s, u) => s + account._toBigInt(u.value), 0n)
    const baseFee = account._toBigInt(Math.max(result.fee ?? 0, 0))
    let fee = baseFee + opReturnExtraFee
    let changeValue = total - fee - amount

    if (changeValue < 0n) {
      throw new Error('Insufficient balance after fees (OP_RETURN overhead).')
    }
    if (changeValue <= dustLimit) {
      fee = fee + changeValue
      changeValue = 0n
    }
    const actualFee = fee

    const psbt = new Psbt({ network })

    const fromAddressScriptHex = (await this._getOutputScriptHex(fromAddress, network)).toString('hex')

    const masterNode = this._toBufferHdSigner(account._masterNode)

    for (const utxo of selectedUtxos) {
      const baseInput = {
        hash: utxo.tx_hash,
        index: utxo.tx_pos,
        bip32Derivation: [{
          masterFingerprint: masterNode.fingerprint,
          path: account._path,
          pubkey: Buffer.from(account._account.publicKey)
        }]
      }

      if (account._bip === 84) {
        psbt.addInput({
          ...baseInput,
          witnessUtxo: {
            script: Buffer.from(utxo.vout?.scriptPubKey?.hex ?? fromAddressScriptHex, 'hex'),
            value: Number(utxo.value)
          }
        })
      } else {
        const prevHex = await account._client.getTransaction(utxo.tx_hash)
        psbt.addInput({
          ...baseInput,
          nonWitnessUtxo: Buffer.from(prevHex, 'hex')
        })
      }
    }

    psbt.addOutput({ address: depositAddress, value: Number(amount) })
    psbt.addOutput({ script: opReturnScript, value: 0 })
    if (changeValue > 0n) {
      psbt.addOutput({ address: fromAddress, value: Number(changeValue) })
    }

    selectedUtxos.forEach((_, index) => psbt.signInputHD(index, masterNode))
    psbt.finalizeAllInputs()

    const tx = psbt.extractTransaction()

    return { txHex: tx.toHex(), txid: tx.getId(), fee: actualFee }
  }

  /**
   * Wraps the wallet's BIP-32 master node so every byte field crossing into
   * bitcoinjs-lib is a Buffer. bip32 v5 returns Uint8Arrays for keys,
   * fingerprints, and signatures, which bitcoinjs-lib 6 rejects (typeforce
   * Buffer checks, `publicKey.equals`, partialSig serialisation); bip32 v4
   * already returns Buffers, making this a cheap no-op wrap.
   *
   * @private
   * @param {Object} node - An HDSigner-compatible BIP-32 node.
   * @returns {Object} An HDSigner whose publicKey/fingerprint/sign() return Buffers.
   */
  _toBufferHdSigner (node) {
    const wrap = this._toBufferHdSigner.bind(this)
    return {
      get publicKey () { return Buffer.from(node.publicKey) },
      get fingerprint () { return Buffer.from(node.fingerprint) },
      derivePath (path) { return wrap(node.derivePath(path)) },
      sign (hash, lowR) { return Buffer.from(node.sign(hash, lowR)) }
    }
  }

  /**
   * Tests whether the bound account is a writable Bitcoin wallet account
   * (i.e. exposes `_masterNode` with a `fingerprint`). This is a duck-type check rather
   * than an `instanceof WalletAccountBtc` check, for the same workspace-resolution
   * reasons noted on sibling packages. Read-only accounts do not expose `_masterNode`.
   *
   * @private
   * @param {unknown} account
   * @returns {boolean}
   */
  _isWritableAccount (account) {
    if (!account || typeof account !== 'object') return false
    const masterNode = account._masterNode
    return !!(masterNode && masterNode.fingerprint && account._account &&
      account._account.publicKey)
  }

  /**
   * Returns the output script for the given address, lazily importing `bitcoinjs-lib`
   * `address.toOutputScript`.
   *
   * @private
   * @param {string} addressStr
   * @param {*} network
   * @returns {Promise<Buffer>}
   */
  async _getOutputScriptHex (addressStr, network) {
    const { address } = await import('bitcoinjs-lib')
    return address.toOutputScript(addressStr, network)
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
