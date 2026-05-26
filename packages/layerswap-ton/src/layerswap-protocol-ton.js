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

import { BridgeProtocol } from '@tetherto/wdk-wallet/protocols'
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
  parseDecimal
} from '@layerswap/wdk-protocol-bridge-layerswap-core'

/** @typedef {import('@tetherto/wdk-wallet/protocols').BridgeProtocolConfig} BridgeProtocolConfig */
/** @typedef {import('@tetherto/wdk-wallet/protocols').BridgeResult} BridgeResult */

/** @typedef {import('@tetherto/wdk-wallet-ton').WalletAccountTon} WalletAccountTon */
/** @typedef {import('@tetherto/wdk-wallet-ton').WalletAccountReadOnlyTon} WalletAccountReadOnlyTon */

/** @typedef {import('@ton/core').Cell} Cell */

/** @typedef {import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapNetwork} LayerswapNetwork */
/** @typedef {import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapToken} LayerswapToken */
/** @typedef {import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapDepositAction} LayerswapDepositAction */

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

// Quote-time fee approximations (in nanotons). Bridge-time fees come from the
// wallet's `sendTransaction` return value.
const TON_NATIVE_FEE_APPROX_NANOTONS = 10_000_000n // 0.01 TON
const TON_JETTON_FEE_APPROX_NANOTONS = 50_000_000n // 0.05 TON (includes 0.045 message value)

// Jetton transfer opcode (CRC32 of 'transfer'). TIP-3 standard.
const JETTON_TRANSFER_OP = 0x0f8a7ea5

/**
 * Bridge protocol that drives a Layerswap swap from a TON wallet account.
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
 * Semantic note: `BridgeResult.bridgeFee` is documented in `@tetherto/wdk-wallet` as
 * "native tokens paid to the bridge protocol". Layerswap deducts its fee from the
 * source-token amount instead, so we return `bridgeFee` in **source-token base units**.
 * Do not naively add `fee` (native nanotons) and `bridgeFee` together — they are in
 * different units. The `bridgeMaxFee` config compares against `bridgeFee` only.
 *
 * Implementation note: this package depends on `@ton/core` (for cell building / `Address`
 * parsing) in addition to the wallet's `@ton/ton` peer. The wallet handles wallet-contract
 * setup, signing, and broadcasting; this package only owns the deposit message body and
 * the Layerswap HTTP plumbing.
 */
export default class LayerswapProtocolTon extends BridgeProtocol {
  /**
   * @overload
   * @param {WalletAccountReadOnlyTon} account - The wallet account to use to interact with the protocol.
   * @param {LayerswapProtocolConfig} [config] - The layerswap protocol configuration.
   */

  /**
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
   * Bridges a token to a different blockchain via Layerswap.
   *
   * Resolves once the source-chain deposit transaction has been broadcast. Layerswap finishes
   * the destination-chain payout asynchronously; callers can use `getApiClient().getSwap(swapId)`
   * to track destination delivery.
   *
   * Semantic note: `bridgeFee` is in **source-token base units**, not native nanotons.
   * See class JSDoc for the rationale.
   *
   * @param {BridgeOptions} options - The bridge's options.
   * @param {Pick<LayerswapProtocolConfig, 'bridgeMaxFee'>} [config] - Per-call overrides.
   * @returns {Promise<LayerswapBridgeResult>} The bridge's result, augmented with the Layerswap swap id.
   */
  async bridge (options, config) {
    if (!this._isWritableAccount(this._account)) {
      throw new Error("The 'bridge(options)' method requires the protocol to be initialized with a non read-only account.")
    }

    const { action, sourceToken, parsedCallData, bridgeFee, swapId } =
      await this._createDepositSwap(options)

    const bridgeMaxFee = config?.bridgeMaxFee ?? this._config.bridgeMaxFee
    if (bridgeMaxFee !== undefined && bridgeFee >= BigInt(bridgeMaxFee)) {
      throw new Error('Exceeded maximum fee cost for bridge operation.')
    }

    const message = await this._buildDepositMessage({
      sourceToken,
      action,
      parsedCallData,
      amount: BigInt(options.amount)
    })

    const { hash, fee } = await this._account.sendTransaction(message)

    await this._notifyDepositBroadcast(swapId, hash)

    return { hash, fee: BigInt(fee), bridgeFee, swapId }
  }

  /**
   * Quotes the costs of a Layerswap bridge operation without creating a swap.
   *
   * The reported `fee` is an approximation:
   *   - Native TON: `TON_NATIVE_FEE_APPROX_NANOTONS` (~0.01 TON).
   *   - Jetton: `TON_JETTON_FEE_APPROX_NANOTONS` (~0.05 TON, includes the 0.045 message value
   *     budgeted for jetton-wallet gas + forward amount).
   *
   * Semantic note: `bridgeFee` is in **source-token base units**, not native nanotons.
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
      use_deposit_address: false,
      source_address: sourceAddress,
      refuel: options.refuel,
      slippage: options.slippage
    })

    const bridgeFee = parseDecimal(quote.total_fee, sourceToken.decimals)
    const fee = sourceToken.contract
      ? TON_JETTON_FEE_APPROX_NANOTONS
      : TON_NATIVE_FEE_APPROX_NANOTONS

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
   * Asks Layerswap for its on-chain assessment of a deposit transaction. Useful as a
   * follow-up after `bridge()` returns — even if the wallet's `sendTransaction` resolved,
   * the message can still be discarded by the validator or fail at the jetton wallet.
   * Returns `'completed' | 'failed' | 'pending'`.
   *
   * The source network defaults to `TON_MAINNET` (TON has no stable network id and
   * Layerswap currently lists only mainnet); pass `options.sourceChain` to override.
   *
   * @param {string} hash - The TON external-message hash returned by `bridge()`.
   * @param {{ sourceChain?: string }} [options]
   * @returns {Promise<import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapTransactionStatus>}
   */
  async getTransactionStatus (hash, options = {}) {
    const networkName = options.sourceChain ?? DEFAULT_SOURCE_NETWORK_NAME
    return this._client.getTransactionStatus(networkName, hash)
  }

  /**
   * Calls `POST /api/v2/swaps` for the resolved route and extracts the wallet-driven
   * deposit action + the parsed `call_data` JSON.
   *
   * @private
   * @param {BridgeOptions} options
   * @returns {Promise<{
   *   action: LayerswapDepositAction,
   *   sourceToken: LayerswapToken,
   *   parsedCallData: { comment?: string, amount?: string | number } | null,
   *   bridgeFee: bigint,
   *   swapId: string
   * }>}
   */
  async _createDepositSwap (options) {
    const { sourceNetwork, sourceToken, destinationNetwork, destinationToken } =
      await this._resolveRoute(options)

    const amount = BigInt(options.amount)
    const amountDecimal = formatBaseUnits(amount, sourceToken.decimals)

    const sourceAddress = await this._account.getAddress()

    /** @type {import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapSwapResponse} */
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

    if (typeof action.to_address !== 'string' || action.to_address.length === 0) {
      throw new Error('Layerswap deposit action for TON is missing to_address; the deposit message cannot be built.')
    }

    const parsedCallData = this._parseCallData(action.call_data)

    const totalFeeDecimal = response.quote?.quote?.total_fee
    const bridgeFee = totalFeeDecimal !== undefined && totalFeeDecimal !== null
      ? parseDecimal(totalFeeDecimal, sourceToken.decimals)
      : 0n

    return { action, sourceToken, parsedCallData, bridgeFee, swapId: swap.id }
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
    const sourceName = options.sourceChain ?? DEFAULT_SOURCE_NETWORK_NAME
    const sourceNetwork = await resolveNetworkByName(this._client, sourceName)

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

    // Prefer Layerswap-supplied amount over the caller's options.amount (matches the
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
   * `parsedCallData.amount` (matches the UI), falls back to `options.amount`.
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
   * own.
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
