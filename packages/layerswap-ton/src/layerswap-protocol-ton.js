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
  MaximumFeeExceededError,
  NoSuchElementError,
  ProviderError,
  ProviderRequiredError,
  ValueError
} from '@tetherto/wdk-wallet/protocols'
// Import TON primitives from `@ton/ton` (which re-exports `@ton/core`) — *not* from
// `@ton/core` directly. `@tetherto/wdk-wallet-ton` brings its own copy of `@ton/core`
// transitively via `@ton/ton`; depending on `@ton/core` directly causes pnpm to resolve
// two copies, which makes the wallet reject our Cell objects with "Invalid argument"
// when the internal `storeRef(body)` does an `instanceof Cell` check against the wrong
// class.
import { Address, beginCell, toNano } from '@ton/ton'

import {
  LayerswapSwidgeProtocol,
  resolveNetworkByName,
  normalizeWalletError
} from '@layerswap/wdk-protocol-swidge-layerswap-core'

/** @typedef {import('@tetherto/wdk-wallet-ton').WalletAccountTon} WalletAccountTon */
/** @typedef {import('@tetherto/wdk-wallet-ton').WalletAccountReadOnlyTon} WalletAccountReadOnlyTon */

/** @typedef {import('@ton/ton').Cell} Cell */

/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapProtocolConfig} LayerswapProtocolConfig */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapNetwork} LayerswapNetwork */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapToken} LayerswapToken */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapDepositAction} LayerswapDepositAction */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSwidgeRoute} LayerswapSwidgeRoute */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapDepositContext} LayerswapDepositContext */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapBroadcastDeposit} LayerswapBroadcastDeposit */

/**
 * @typedef {Object} LayerswapTonCallData
 * @property {string} comment - The Layerswap reference comment to attach to the deposit.
 * @property {string | number} amount - The amount to deposit (in base unit).
 */

/**
 * @typedef {Object} LayerswapTonDepositMessageParams
 * @property {LayerswapToken} sourceToken - The source token.
 * @property {LayerswapDepositAction} action - The wallet-driven deposit action.
 * @property {string} comment - The Layerswap reference comment.
 * @property {bigint} amount - The amount to deposit (in base unit).
 */

/**
 * The `{ to, value, body }` transaction handed to `account.sendTransaction(...)`.
 *
 * @typedef {Object} LayerswapTonDepositMessage
 * @property {string} to - The deposit address (native TON) or the sender's jetton wallet (jettons).
 * @property {bigint} value - The amount of nanotons to attach to the message.
 * @property {Cell} body - The message body.
 */

/**
 * @typedef {Object} LayerswapTonPreparedDeposit
 * @property {LayerswapTonDepositMessage} message - The deposit message to broadcast.
 */

const DEFAULT_SOURCE_NETWORK_NAME = 'TON_MAINNET'

/**
 * Root hashes of the TON zero-state (genesis) blocks → Layerswap network names. TON wallet
 * accounts carry no network information, so the network is identified by the zero state
 * of the ton center the account is connected to.
 */
const ZERO_STATE_ROOT_HASH_TO_NETWORK_NAME = Object.freeze({
  'F6OpKZKqvqeFp6CQmFomXNMfMj2EnaUSOXN+Mh+wVWk=': 'TON_MAINNET',
  'gj+B8wb/AmlPk1z1AhVI484rhrUpgSr2oSFIh56VoSg=': 'TON_TESTNET'
})

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

// Jetton transfer notification opcode, of the message a jetton deposit delivers to the
// deposit address. TIP-3 standard.
const JETTON_TRANSFER_NOTIFICATION_OP = 0x7362d09c

const HEX_HASH_PATTERN = /^[0-9a-f]{64}$/i

/**
 * WDK swidge protocol that drives a Layerswap swap from a TON wallet account. The
 * chain-agnostic swidge logic lives in `LayerswapSwidgeProtocol`
 * (`@layerswap/wdk-protocol-swidge-layerswap-core`); this class only implements the TON
 * specifics: the deposit message.
 *
 * Layerswap returns the deposit address and a JSON `call_data` carrying the Layerswap
 * reference comment (and, for jettons, the amount). The deposit message body is built
 * client-side:
 * - Native TON: a comment cell with op `0` and the Layerswap comment as `storeStringTail`.
 * - Jetton: a TIP-3 jetton-transfer body (op `0x0f8a7ea5`) with the comment in the
 *   forward payload, sent to the sender's jetton wallet with a ~0.045 TON gas budget.
 *
 * `{ to, value, body }` is then handed to `account.sendTransaction(...)`. The source network
 * is detected from the ton center the account is connected to (`account._tonClient`).
 *
 * @extends {LayerswapSwidgeProtocol}
 */
export default class LayerswapProtocolTon extends LayerswapSwidgeProtocol {
  /**
   * Creates a new swidge protocol for chain/token discovery only, without a wallet account.
   *
   * @overload
   * @param {undefined} [account] - No account; only discovery and `fromChain`-scoped quotes work.
   * @param {LayerswapProtocolConfig} [config] - The layerswap protocol configuration.
   */

  /**
   * Creates a new read-only interface to the layerswap protocol for the ton blockchain.
   *
   * @overload
   * @param {WalletAccountReadOnlyTon} account - The wallet account to use to interact with the protocol.
   * @param {LayerswapProtocolConfig} [config] - The layerswap protocol configuration.
   */

  /**
   * Creates a new interface to the layerswap protocol for the ton blockchain.
   *
   * @overload
   * @param {WalletAccountTon} account - The wallet account to use to interact with the protocol.
   * @param {LayerswapProtocolConfig} [config] - The layerswap protocol configuration.
   */
  constructor (account, config = {}) {
    super(account, config)

    /**
     * @private
     * @type {LayerswapNetwork | undefined}
     */
    this._sourceNetwork = undefined
  }

  /** @protected */
  get _nativeTokenSymbol () {
    return 'TON'
  }

  /**
   * Detects the source network from the zero-state block of the ton center the account's
   * client is connected to (`account._tonClient`). Without an account, the source network
   * defaults to `TON_MAINNET`. Cached for the lifetime of the protocol instance.
   *
   * @protected
   * @returns {Promise<LayerswapNetwork>} The source network.
   * @throws {ValueError} If the zero state is not a known TON network, or Layerswap does not support it.
   * @throws {ProviderRequiredError} If the account is not connected to ton center.
   * @throws {ProviderError} If ton center fails to report the zero state.
   */
  async _detectSourceNetwork () {
    if (this._sourceNetwork !== undefined) {
      return this._sourceNetwork
    }

    if (!this._account) {
      return resolveNetworkByName(this._client, DEFAULT_SOURCE_NETWORK_NAME)
    }

    const tonClient = this._account._tonClient

    if (!tonClient) {
      throw new ProviderRequiredError("The 'fromChain' option is required when the wallet account is not connected to ton center.")
    }

    const { init } = await this._callWallet(() => tonClient.api.getMasterchainInfo())
    const name = ZERO_STATE_ROOT_HASH_TO_NETWORK_NAME[init?.root_hash]

    if (!name) {
      throw new ValueError(`Unknown TON zero state '${init?.root_hash}'. Layerswap supports the TON mainnet and testnet only.`)
    }

    this._sourceNetwork = await resolveNetworkByName(this._client, name)
    return this._sourceNetwork
  }

  /**
   * Approximates the source-chain fee of the deposit message.
   *
   * @protected
   * @param {LayerswapSwidgeRoute} route - The resolved swidge route.
   * @param {bigint} amount - The input amount in source-token base units.
   * @param {string} sourceAddress - The address of the bound account.
   * @returns {Promise<bigint>} The estimated fee, in nanotons.
   */
  async _quoteSourceGas (route, amount, sourceAddress) {
    return route.sourceToken.contract
      ? TON_JETTON_FEE_APPROX_NANOTONS
      : TON_NATIVE_FEE_APPROX_NANOTONS
  }

  /**
   * Builds the deposit message from the Layerswap deposit action. Its fee is only known
   * once broadcast.
   *
   * @protected
   * @param {LayerswapDepositContext} context - The deposit context.
   * @returns {Promise<LayerswapTonPreparedDeposit>} The prepared deposit.
   * @throws {ProviderError} If the deposit action is malformed, or ton center fails.
   * @throws {ProviderRequiredError} If the account is not connected to ton center.
   */
  async _prepareDeposit ({ action, route, fromTokenAmount }) {
    if (typeof action.to_address !== 'string' || action.to_address.length === 0) {
      throw new ProviderError('Layerswap deposit action for TON is missing to_address; the deposit message cannot be built.', {
        reason: ProviderErrorReason.INTERNAL_SERVER_ERROR
      })
    }

    const { comment, amount } = this._parseCallData(action.call_data)

    const message = await this._buildDepositMessage({
      sourceToken: route.sourceToken,
      action,
      comment,
      amount: this._parseDepositAmount(amount, fromTokenAmount)
    })

    return { message }
  }

  /**
   * Signs and broadcasts the deposit message through the wallet account.
   *
   * @protected
   * @param {LayerswapTonPreparedDeposit} deposit - The prepared deposit.
   * @returns {Promise<LayerswapBroadcastDeposit>} The broadcast deposit, with its fee when the wallet reports it.
   * @throws {ProviderRequiredError} If the account is not connected to ton center.
   * @throws {ProviderError} If ton center fails to broadcast the deposit.
   * @throws {MaximumFeeExceededError} If the wallet rejects the transaction fee.
   */
  async _sendDeposit ({ message }) {
    const { hash, fee } = await this._callWallet(() => this._account.sendTransaction(message))
    return { hash, fee: fee === undefined ? undefined : BigInt(fee) }
  }

  /**
   * Resolves the hash returned by `swidge()` — the body hash of the deposit's external
   * message — to the id Layerswap tracks TON deposits by: the hash of the message that
   * reaches the deposit address. That is the jetton `transfer_notification` for jetton
   * deposits, and the wallet's own outgoing message for native TON. The deposit is traced
   * through the ton center the account is connected to. Ids that are not hex hashes are
   * taken to be Layerswap ids already, and returned as-is.
   *
   * @protected
   * @param {string} hash - The hash returned by `swidge()`, or a Layerswap transaction id.
   * @returns {Promise<string>} The Layerswap transaction id.
   * @throws {NoSuchElementError} If ton center has not indexed the deposit (yet).
   * @throws {ProviderRequiredError} If the account is not connected to ton center.
   * @throws {ProviderError} If ton center fails to trace the deposit.
   */
  async _resolveTransactionId (hash) {
    if (!HEX_HASH_PATTERN.test(hash)) {
      return hash
    }

    const { transactions } = await this._fetchTonCenter('transactionsByMessage', { body_hash: hash, limit: '1' })
    const walletTransaction = transactions?.[0]

    if (walletTransaction) {
      const { traces } = await this._fetchTonCenter('traces', { tx_hash: walletTransaction.hash })
      const trace = traces?.[0]
      const outMessage = trace?.transactions?.[walletTransaction.hash]?.out_msgs?.[0]

      if (Number(outMessage?.opcode) === JETTON_TRANSFER_OP) {
        const notification = Object.values(trace.transactions)
          .find((transaction) => Number(transaction.in_msg?.opcode) === JETTON_TRANSFER_NOTIFICATION_OP)

        if (notification) return notification.in_msg.hash
      } else if (outMessage?.hash) {
        return outMessage.hash
      }
    }

    throw new NoSuchElementError(`No TON deposit with hash '${hash}' has reached its destination yet.`)
  }

  /**
   * Calls the ton center v3 api the account is connected to, with the account's api key.
   *
   * @private
   * @param {string} path - The api path.
   * @param {Record<string, string>} params - The query parameters.
   * @returns {Promise<any>} The response payload.
   * @throws {ProviderRequiredError} If the account is not connected to ton center.
   * @throws {ProviderError} If the request fails.
   */
  async _fetchTonCenter (path, params) {
    if (!this._account?._tonClient) {
      throw new ProviderRequiredError('TON deposit hashes can only be resolved through the ton center the wallet account is connected to.')
    }

    // `TonClient` keeps its api key in the http api rather than in `parameters`, where the
    // wallet's own resolver looks for it.
    const endpoint = this._account._resolveTonCenterEndpoint()
    const { baseUrl } = endpoint
    const apiKey = endpoint.apiKey ?? this._account._tonClient.api?.parameters?.apiKey
    const url = `${baseUrl}/${path}?${new URLSearchParams(params)}`

    let response
    try {
      response = await fetch(url, apiKey ? { headers: { 'X-Api-Key': apiKey } } : undefined)
    } catch (error) {
      throw new ProviderError(`TON Center request to ${path} failed: ${error.message}`, {
        reason: ProviderErrorReason.NETWORK_ERROR,
        cause: error
      })
    }

    if (!response.ok) {
      throw new ProviderError(`TON Center request to ${path} failed with status ${response.status}.`, {
        reason: ProviderErrorReason.INTERNAL_SERVER_ERROR
      })
    }

    return response.json()
  }

  /**
   * Runs a wallet account call, normalizing its errors. `@tetherto/wdk-wallet-ton` throws
   * plain errors, so its "not connected to ton center" and "maximum fee" failures are
   * mapped to `ProviderRequiredError` and `MaximumFeeExceededError` by message.
   *
   * @protected
   * @template T
   * @param {() => Promise<T>} call - The wallet call.
   * @returns {Promise<T>} The call's result.
   * @throws {ProviderRequiredError} If the account is not connected to ton center.
   * @throws {MaximumFeeExceededError} If the transaction's cost exceeds the account's max. fee option.
   * @throws {ProviderError} If the call fails with an error outside of the swidge contract.
   */
  async _callWallet (call) {
    try {
      return await call()
    } catch (error) {
      const message = error?.message ?? ''

      if (/must be connected to ton center/i.test(message)) {
        throw new ProviderRequiredError(message)
      }

      if (/exceeded maximum fee cost/i.test(message)) {
        throw new MaximumFeeExceededError(message, { cause: error })
      }

      throw normalizeWalletError(error)
    }
  }

  /**
   * Parses Layerswap's `call_data` for TON: a JSON string with the reference `comment` that
   * lets Layerswap match the deposit to the swap, and the `amount` to deposit. Like the
   * Layerswap web app, nothing is sent without them.
   *
   * @private
   * @param {string | null | undefined} callData
   * @returns {LayerswapTonCallData}
   * @throws {ProviderError} If the call_data is missing, or has no reference comment.
   */
  _parseCallData (callData) {
    let parsed
    try {
      parsed = JSON.parse(/** @type {string} */ (callData))
    } catch (_) {
      parsed = undefined
    }

    if (!parsed || typeof parsed !== 'object' || typeof parsed.comment !== 'string' || parsed.comment.length === 0) {
      throw new ProviderError(`Layerswap call_data for TON must be a JSON object with a reference comment (got '${callData}').`, {
        reason: ProviderErrorReason.INTERNAL_SERVER_ERROR
      })
    }

    return parsed
  }

  /**
   * Builds the `{ to, value, body }` argument for `account.sendTransaction(...)`. Branches
   * on `sourceToken.contract`: jetton master address present → jetton path, otherwise
   * native TON path.
   *
   * @private
   * @param {LayerswapTonDepositMessageParams} params
   * @returns {Promise<LayerswapTonDepositMessage>}
   * @throws {ProviderError} If the Layerswap deposit address is malformed, or ton center fails to
   *   resolve the jetton wallet address.
   * @throws {ProviderRequiredError} If the account is not connected to ton center.
   */
  async _buildDepositMessage ({ sourceToken, action, comment, amount }) {
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
    const depositAddress = this._parseDepositAddress(action.to_address)

    const forwardPayload = beginCell()
      .storeUint(0, 32)
      .storeStringTail(comment)
      .endCell()

    const body = beginCell()
      .storeUint(JETTON_TRANSFER_OP, 32)
      .storeUint(0, 64) // query id
      .storeCoins(amount)
      .storeAddress(depositAddress) // jetton transfer destination
      .storeAddress(depositAddress) // response_destination (excess + notification target)
      .storeBit(0) // no custom payload
      .storeCoins(TON_JETTON_FORWARD_VALUE)
      .storeBit(1) // forward payload is a ref
      .storeRef(forwardPayload)
      .endCell()

    const jettonWalletAddress = await this._callWallet(() => this._account._getJettonWalletAddress(sourceToken.contract))

    return {
      to: jettonWalletAddress.toString(),
      value: TON_JETTON_MESSAGE_VALUE,
      body
    }
  }

  /**
   * Parses the Layerswap deposit address.
   *
   * @private
   * @param {string} address
   * @returns {Address}
   * @throws {ProviderError} If Layerswap returned a malformed TON address.
   */
  _parseDepositAddress (address) {
    try {
      return Address.parse(address)
    } catch (error) {
      throw new ProviderError(`Layerswap returned a malformed TON deposit address '${address}'.`, {
        reason: ProviderErrorReason.INTERNAL_SERVER_ERROR,
        cause: error
      })
    }
  }
}
