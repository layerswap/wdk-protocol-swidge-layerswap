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
import { NoSuchElementError, ProviderError, ValueError } from '@tetherto/wdk-wallet/protocols'

const DEFAULT_API_URL = 'https://api.layerswap.io'

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/**
 * @typedef {Object} LayerswapToken
 * @property {string} symbol
 * @property {string | null} contract
 * @property {number} decimals
 * @property {number} [price_in_usd]
 * @property {string} [display_asset]
 */

/**
 * @typedef {Object} LayerswapNetwork
 * @property {string} name
 * @property {string | null} chain_id
 * @property {string} type
 * @property {LayerswapToken[]} tokens
 * @property {string} [display_name]
 * @property {LayerswapToken} [token] - The network's native gas token.
 */

/**
 * @typedef {Object} LayerswapQuote
 * @property {number} requested_amount
 * @property {number} receive_amount
 * @property {number} min_receive_amount
 * @property {number} total_fee
 * @property {number} total_fee_in_usd
 * @property {number} blockchain_fee
 * @property {number} service_fee
 * @property {string} [avg_completion_time]
 * @property {number} [slippage]
 */

/**
 * @typedef {Object} LayerswapDepositAction
 * @property {number} amount
 * @property {string} amount_in_base_units
 * @property {string} call_data
 * @property {string} [to_address]
 * @property {LayerswapToken} token
 * @property {LayerswapToken} fee_token
 * @property {LayerswapNetwork} network
 * @property {number} order
 * @property {'transfer' | 'manual_transfer'} type
 */

/**
 * @typedef {'user_transfer_pending' | 'ls_transfer_pending' | 'completed' | 'failed'
 *          | 'expired' | 'cancelled' | 'pending_refund' | 'refunded'} LayerswapSwapStatusValue
 *
 * Layerswap's swap lifecycle statuses, as serialized on the wire by the v2 API:
 * - `user_transfer_pending`: waiting for the user's deposit on the source network.
 * - `ls_transfer_pending`: deposit detected; Layerswap is executing the destination payout.
 * - `completed`: funds delivered to the destination address.
 * - `pending_refund` / `refunded`: the swap could not complete and funds are being / have been returned.
 */

/**
 * A source/destination/refuel/refund transaction attached to a swap by Layerswap.
 *
 * @typedef {Object} LayerswapSwapTransaction
 * @property {string} transaction_hash
 * @property {'input' | 'output' | 'refuel' | 'refund'} type
 * @property {'completed' | 'initiated' | 'pending'} status
 * @property {number} [amount]
 * @property {string} [from]
 * @property {string} [to]
 * @property {string} [timestamp]
 * @property {number} [confirmations]
 * @property {number} [max_confirmations]
 * @property {LayerswapToken} [token]
 * @property {LayerswapNetwork | string} [network]
 */

/**
 * @typedef {Object} LayerswapSwap
 * @property {string} id
 * @property {string} created_date
 * @property {LayerswapSwapStatusValue | string} status
 * @property {LayerswapNetwork} source_network
 * @property {LayerswapToken} source_token
 * @property {LayerswapNetwork} destination_network
 * @property {LayerswapToken} destination_token
 * @property {string} destination_address
 * @property {number} requested_amount
 * @property {string} [source_address]
 * @property {string | null} [fail_reason]
 * @property {LayerswapSwapTransaction[]} [transactions]
 */

/**
 * @typedef {Object} LayerswapQuoteResponse
 * @property {LayerswapQuote} quote
 */

/**
 * @typedef {Object} LayerswapSwapResponse
 * @property {LayerswapSwap} swap
 * @property {LayerswapDepositAction[]} [deposit_actions]
 * @property {LayerswapQuoteResponse} [quote]
 */

/**
 * @typedef {Object} LayerswapCreateSwapParams
 * @property {string} source_network
 * @property {string} source_token
 * @property {string} destination_network
 * @property {string} destination_token
 * @property {string} destination_address
 * @property {string | number} amount
 * @property {boolean} use_deposit_address
 * @property {string} [source_address]
 * @property {string} [refund_address]
 * @property {boolean} [refuel]
 * @property {string} [slippage]
 * @property {string} [reference_id]
 */

/**
 * @typedef {Object} LayerswapGetQuoteParams
 * @property {string} source_network
 * @property {string} source_token
 * @property {string} destination_network
 * @property {string} destination_token
 * @property {string | number} amount
 * @property {boolean} use_deposit_address
 * @property {string} [source_address]
 * @property {boolean} [refuel]
 * @property {string} [slippage]
 */

/**
 * @typedef {'completed' | 'failed' | 'pending'} LayerswapTransactionStatusValue
 *
 * Layerswap's on-chain assessment of a deposit transaction. Lowercase values match the
 * web app's enum exactly (`completed` once the source-chain tx is confirmed and
 * Layerswap has indexed it, `failed` if the chain rejected it, `pending` while in the
 * mempool or awaiting confirmations).
 */

/**
 * @typedef {Object} LayerswapTransactionStatus
 * @property {LayerswapTransactionStatusValue} status
 */

/**
 * @typedef {Object} LayerswapApiErrorBody
 * @property {string} [code] - Layerswap's error code (e.g. `'NOT_FOUND'`).
 * @property {string} [message] - Layerswap's error message.
 */

/**
 * The JSON envelope wrapping every Layerswap v2 API response.
 *
 * @typedef {Object} LayerswapApiEnvelope
 * @property {any} [data] - The response payload.
 * @property {LayerswapApiErrorBody} [error] - The error details of a failed request.
 */

/**
 * A WDK error raised for a failed Layerswap request, decorated with Layerswap's error
 * code and the HTTP status.
 *
 * @typedef {Error & LayerswapApiErrorDetails} LayerswapApiError
 */

/**
 * @typedef {Object} LayerswapApiErrorDetails
 * @property {string} code - Layerswap's error code, or `HTTP_<status>` when absent.
 * @property {number} status - The HTTP status of the response.
 */

/**
 * @typedef {Object} LayerswapRequestOptions
 * @property {Object} [body] - The JSON request body.
 * @property {Record<string, string>} [headers] - Extra request headers.
 * @property {boolean} [notFoundAsNoSuchElement] - If true, a "not found" response (a 404, or a
 *   400 whose message reports the resource as not found) is thrown as a `NoSuchElementError`
 *   instead of a `ValueError`.
 */

/**
 * @typedef {Object} LayerswapApiClientConfig
 * @property {string} [apiKey]
 * @property {string} [apiUrl]
 * @property {number} [requestTimeoutMs]
 */

/**
 * Minimal HTTP client for the Layerswap public v2 API.
 *
 * Wraps the endpoints required to drive a swap to broadcast:
 * - `GET  /api/v2/networks` (cached per instance)
 * - `GET  /api/v2/quote`
 * - `POST /api/v2/swaps`
 * - `GET  /api/v2/swaps/{id}`
 * - `POST /api/v2/swaps/{id}/deposit_speedup`
 * - `GET  /api/v2/transaction_status`
 *
 * Failed requests are thrown as WDK errors, carrying Layerswap's error `code` and the
 * HTTP `status` as extra properties:
 * - `ProviderError` when the API is unreachable, times out, rejects the credentials,
 *   fails server-side, or returns a malformed body;
 * - `NoSuchElementError` when a looked-up swap or transaction does not exist;
 * - `ValueError` when Layerswap rejects the request parameters (other 4xx responses).
 */
export default class LayerswapApiClient {
  /**
   * @param {LayerswapApiClientConfig} [config]
   */
  constructor (config = {}) {
    /**
     * @private
     * @type {string | undefined}
     */
    this._apiKey = typeof config.apiKey === 'string' && config.apiKey.length > 0
      ? config.apiKey
      : undefined

    /** @private */
    this._baseUrl = (config.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '')

    /** @private */
    this._timeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS

    /**
     * Cached `/networks` response.
     *
     * @private
     * @type {Promise<LayerswapNetwork[]> | null}
     */
    this._networksPromise = null
  }

  /**
   * Returns the Layerswap network/token catalog. Cached for the lifetime of this client.
   *
   * @returns {Promise<LayerswapNetwork[]>}
   * @throws {ProviderError} If the request fails.
   */
  async getNetworks () {
    if (!this._networksPromise) {
      this._networksPromise = this._request('GET', '/api/v2/networks').catch((err) => {
        this._networksPromise = null
        throw err
      })
    }

    return this._networksPromise
  }

  /**
   * Fetches a fee/receive quote for a prospective swap.
   *
   * @param {LayerswapGetQuoteParams} params
   * @returns {Promise<LayerswapQuoteResponse>}
   * @throws {ValueError} If Layerswap rejects the quote parameters.
   * @throws {ProviderError} If the request fails.
   */
  async getQuote (params) {
    const query = this._buildQueryString({
      source_network: params.source_network,
      source_token: params.source_token,
      destination_network: params.destination_network,
      destination_token: params.destination_token,
      amount: params.amount,
      use_deposit_address: params.use_deposit_address,
      source_address: params.source_address,
      refuel: params.refuel,
      slippage: params.slippage
    })

    return this._request('GET', `/api/v2/quote${query}`)
  }

  /**
   * Creates a new swap. Returns the swap id, the deposit actions, and the locked-in quote.
   *
   * @param {LayerswapCreateSwapParams} params
   * @returns {Promise<LayerswapSwapResponse>}
   * @throws {ValueError} If Layerswap rejects the swap parameters.
   * @throws {ProviderError} If the request fails.
   */
  async createSwap (params) {
    return this._request('POST', '/api/v2/swaps', {
      body: params,
      headers: { 'X-LS-CORRELATION-ID': this._randomCorrelationId() }
    })
  }

  /**
   * Fetches the current state of a swap, including deposit actions and any input/output transactions.
   *
   * @param {string} swapId
   * @returns {Promise<LayerswapSwapResponse>}
   * @throws {NoSuchElementError} If no swap exists with the given id.
   * @throws {ValueError} If Layerswap rejects the swap id.
   * @throws {ProviderError} If the request fails.
   */
  async getSwap (swapId) {
    return this._request('GET', `/api/v2/swaps/${encodeURIComponent(swapId)}`, {
      notFoundAsNoSuchElement: true
    })
  }

  /**
   * Returns Layerswap's on-chain assessment of a deposit transaction (completed / failed /
   * pending). Useful as a follow-up to `swidge()` when the source-chain broadcast succeeded
   * but the tx might still revert or be dropped from the mempool — Layerswap will surface
   * `'failed'` here even before the swap as a whole reaches a terminal status.
   *
   * Throws a `NoSuchElementError` if Layerswap cannot find the transaction (e.g. before
   * it's been indexed, or if the network/transaction_id pair is wrong). The protocol-level
   * wrapper calls this once per poll; callers should treat `NoSuchElementError` as
   * "not yet indexed, retry later".
   *
   * @param {string} networkName  Layerswap network name (e.g. `'ETHEREUM_MAINNET'`,
   *                              `'TRON_MAINNET'`, `'BITCOIN_MAINNET'`).
   * @param {string} transactionId The on-chain transaction hash / id, in the source chain's
   *                              native format.
   * @returns {Promise<LayerswapTransactionStatus>}
   * @throws {NoSuchElementError} If Layerswap cannot find the transaction.
   * @throws {ValueError} If Layerswap rejects the network/transaction id pair.
   * @throws {ProviderError} If the request fails.
   */
  async getTransactionStatus (networkName, transactionId) {
    const query = this._buildQueryString({
      network: networkName,
      transaction_id: transactionId
    })
    return this._request('GET', `/api/v2/transaction_status${query}`, {
      notFoundAsNoSuchElement: true
    })
  }

  /**
   * Informs Layerswap of a freshly broadcast deposit transaction. Best-effort; safe to ignore failures.
   *
   * @param {string} swapId
   * @param {string} transactionId
   * @returns {Promise<void>}
   * @throws {NoSuchElementError} If no swap exists with the given id.
   * @throws {ValueError} If Layerswap rejects the transaction id.
   * @throws {ProviderError} If the request fails.
   */
  async speedUpDeposit (swapId, transactionId) {
    await this._request('POST', `/api/v2/swaps/${encodeURIComponent(swapId)}/deposit_speedup`, {
      body: { transaction_id: transactionId },
      notFoundAsNoSuchElement: true
    })
  }

  /**
   * @private
   * @param {string} method
   * @param {string} path
   * @param {LayerswapRequestOptions} [options]
   * @returns {Promise<any>}
   * @throws {NoSuchElementError} If `options.notFoundAsNoSuchElement` is set and Layerswap responds 404.
   * @throws {ValueError} If Layerswap rejects the request (4xx).
   * @throws {ProviderError} If the request fails, times out or returns a malformed body.
   */
  async _request (method, path, options = {}) {
    const { body, headers: extraHeaders, notFoundAsNoSuchElement = false } = options
    const url = this._baseUrl + path

    const headers = {
      Accept: 'application/json',
      ...(this._apiKey ? { 'X-LS-APIKEY': this._apiKey } : {}),
      ...(extraHeaders ?? {})
    }

    /** @type {RequestInit} */
    const init = { method, headers }

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this._timeoutMs)
    init.signal = controller.signal

    let response
    try {
      response = await fetch(url, init)
    } catch (err) {
      clearTimeout(timer)
      if (err && err.name === 'AbortError') {
        throw new ProviderError(`Layerswap request to ${method} ${path} timed out after ${this._timeoutMs}ms.`, {
          reason: ProviderErrorReason.REQUEST_TIMEOUT,
          cause: err
        })
      }
      throw new ProviderError(`Layerswap request to ${method} ${path} failed: ${err && err.message ? err.message : String(err)}`, {
        reason: ProviderErrorReason.NETWORK_ERROR,
        cause: err
      })
    }
    clearTimeout(timer)

    /** @type {LayerswapApiEnvelope | null} */
    let envelope = null

    const text = await response.text()
    if (text.length > 0) {
      try {
        envelope = JSON.parse(text)
      } catch (_) {
        const message = response.ok
          ? `Layerswap ${method} ${path} returned non-JSON body: ${text.slice(0, 200)}`
          : `Layerswap ${method} ${path} responded ${response.status}: ${text.slice(0, 200)}`
        throw this._buildResponseError(message, `HTTP_${response.status}`, response.ok ? 500 : response.status, notFoundAsNoSuchElement)
      }
    }

    if (!response.ok || (envelope && envelope.error)) {
      const code = envelope?.error?.code ?? `HTTP_${response.status}`
      const message = envelope?.error?.message ?? response.statusText ?? 'Unknown Layerswap error.'
      // An error envelope on a 2xx response is unexpected; treat it as a server-side failure.
      const status = response.ok ? 500 : response.status
      throw this._buildResponseError(`Layerswap ${method} ${path} failed [${code}]: ${message}`, code, status, notFoundAsNoSuchElement)
    }

    return envelope ? envelope.data : null
  }

  /**
   * Maps a failed Layerswap response to the matching WDK error, decorated with
   * Layerswap's error `code` and the HTTP `status`.
   *
   * @private
   * @param {string} message
   * @param {string} code
   * @param {number} status
   * @param {boolean} notFoundAsNoSuchElement
   * @returns {LayerswapApiError}
   */
  _buildResponseError (message, code, status, notFoundAsNoSuchElement) {
    let err
    if (status === 401) {
      err = new ProviderError(message, { reason: ProviderErrorReason.UNAUTHORIZED })
    } else if (status === 403) {
      err = new ProviderError(message, { reason: ProviderErrorReason.FORBIDDEN })
    } else if (status === 408 || status === 504) {
      err = new ProviderError(message, { reason: ProviderErrorReason.REQUEST_TIMEOUT })
    } else if (notFoundAsNoSuchElement && (status === 404 || (status === 400 && /not found/i.test(message)))) {
      // Layerswap answers some lookups of unknown resources with a 400 'UNEXPECTED_ERROR'
      // ("Swap … is not found") instead of a 404.
      err = new NoSuchElementError(message)
    } else if (status >= 400 && status < 500) {
      err = new ValueError(message)
    } else {
      err = new ProviderError(message, { reason: ProviderErrorReason.INTERNAL_SERVER_ERROR })
    }

    return Object.assign(err, { code, status })
  }

  /**
   * @private
   * @param {Record<string, unknown>} params
   * @returns {string}
   */
  _buildQueryString (params) {
    const pairs = []
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    }
    return pairs.length > 0 ? `?${pairs.join('&')}` : ''
  }

  /**
   * @private
   * @returns {string}
   */
  _randomCorrelationId () {
    if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID()
    }
    const rand = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0')
    return `${rand()}-${rand().slice(0, 4)}-${rand().slice(0, 4)}-${rand().slice(0, 4)}-${rand()}${rand().slice(0, 4)}`
  }
}
