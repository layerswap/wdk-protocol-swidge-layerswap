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
import { MaximumFeeExceededError, NoSuchElementError, ProviderError, SwidgeError, SwidgeErrorReason, ValueError } from '@tetherto/wdk-wallet/protocols'

import { parseDecimal } from './networks.js'

/** @typedef {import('./layerswap-api-client.js').LayerswapNetwork} LayerswapNetwork */
/** @typedef {import('./layerswap-api-client.js').LayerswapToken} LayerswapToken */
/** @typedef {import('./layerswap-api-client.js').LayerswapQuote} LayerswapQuote */
/** @typedef {import('./layerswap-api-client.js').LayerswapSwapResponse} LayerswapSwapResponse */
/** @typedef {import('./layerswap-api-client.js').LayerswapSwapTransaction} LayerswapSwapTransaction */
/** @typedef {import('./layerswap-api-client.js').LayerswapSwap} LayerswapSwap */

// The shapes returned by these helpers structurally match the swidge typedefs in
// `@tetherto/wdk-wallet/protocols` (SwidgeStatus, SwidgeFee, SwidgeTransaction,
// SwidgeQuote, SwidgeStatusResult, SwidgeSupportedChain, SwidgeSupportedToken).
// Errors are the WDK error classes, so every VM package honours the throw contract
// of the `ISwidgeProtocol` interface.

/**
 * @typedef {'pending' | 'action-required' | 'completed' | 'failed'
 *          | 'refund-pending' | 'refunded' | 'cancelled' | 'expired' | 'partial'} LayerswapSwidgeStatus
 */

/**
 * @typedef {Object} LayerswapSwidgeFee
 * @property {'network' | 'protocol' | 'affiliate' | 'other'} type
 * @property {bigint} amount
 * @property {string} token
 * @property {string | number} [chain]
 * @property {boolean} [included]
 * @property {string} [description]
 */

/**
 * @typedef {Object} LayerswapSwidgeTransaction
 * @property {string} hash
 * @property {string | number} [chain]
 * @property {'source' | 'destination' | 'approval' | 'refund' | 'other'} [type]
 */

/**
 * @typedef {Object} LayerswapSwidgeQuote
 * @property {bigint} fromTokenAmount
 * @property {bigint} toTokenAmount
 * @property {bigint} toTokenAmountMin
 * @property {LayerswapSwidgeFee[]} fees
 * @property {number} [estimatedDuration]
 */

/**
 * @typedef {Object} LayerswapSwidgeStatusResult
 * @property {LayerswapSwidgeStatus} status
 * @property {LayerswapSwidgeTransaction[]} [transactions]
 */

/**
 * @typedef {Object} LayerswapSwidgeStatusOptions
 * @property {string | number} [fromChain] - The source chain: Layerswap network name or chain id.
 * @property {string | number} [toChain] - The destination chain: Layerswap network name or chain id.
 */

/**
 * @typedef {Object} LayerswapSwidgeSupportedChain
 * @property {string} id
 * @property {string} name
 * @property {string} type
 * @property {string} nativeToken
 */

/**
 * @typedef {Object} LayerswapSwidgeSupportedToken
 * @property {string} token
 * @property {string} chain
 * @property {string} symbol
 * @property {number} decimals
 * @property {string} [address]
 * @property {string} [name]
 */

/**
 * @typedef {Object} LayerswapSwidgeSupportedTokensOptions
 * @property {string | number} [fromChain]
 * @property {string} [fromToken]
 * @property {string | number} [toChain]
 */

/**
 * Layerswap wire statuses → WDK swidge statuses. Unknown (future) statuses map
 * to 'pending' so pollers keep polling instead of misreporting a terminal state.
 *
 * @type {Record<string, LayerswapSwidgeStatus>}
 */
const SWAP_STATUS_TO_SWIDGE_STATUS = {
  user_transfer_pending: 'action-required',
  ls_transfer_pending: 'pending',
  completed: 'completed',
  failed: 'failed',
  expired: 'expired',
  cancelled: 'cancelled',
  pending_refund: 'refund-pending',
  refunded: 'refunded'
}

/** @type {Record<string, 'source' | 'destination' | 'refund' | 'other'>} */
const SWAP_TX_TYPE_TO_SWIDGE_TYPE = {
  input: 'source',
  output: 'destination',
  refund: 'refund',
  refuel: 'other'
}

/**
 * Maps a Layerswap swap status to the WDK swidge status vocabulary.
 *
 * @param {string} status - The Layerswap swap status (e.g. 'ls_transfer_pending').
 * @returns {LayerswapSwidgeStatus}
 */
export function mapSwapStatus (status) {
  return SWAP_STATUS_TO_SWIDGE_STATUS[status] ?? 'pending'
}

/**
 * Maps the transactions attached to a Layerswap swap to WDK swidge transactions.
 * Entries without a hash (created but not yet broadcast) are skipped.
 *
 * @param {LayerswapSwapTransaction[]} [transactions]
 * @returns {LayerswapSwidgeTransaction[]}
 */
export function mapSwapTransactions (transactions) {
  if (!Array.isArray(transactions)) return []

  const mapped = []
  for (const tx of transactions) {
    if (!tx || typeof tx.transaction_hash !== 'string' || tx.transaction_hash.length === 0) continue

    const chain = typeof tx.network === 'string' ? tx.network : tx.network?.name

    mapped.push({
      hash: tx.transaction_hash,
      ...(chain !== undefined && { chain }),
      type: SWAP_TX_TYPE_TO_SWIDGE_TYPE[tx.type] ?? 'other'
    })
  }
  return mapped
}

/**
 * Derives the WDK swidge status for a swap, tracking the attached transactions
 * first and falling back to the swap-level status only when no transaction is
 * decisive. The output (payout) transaction is the authoritative delivery signal —
 * Layerswap's swap-level status can lag behind it (e.g. a swap can sit in
 * `ls_transfer_pending` after the payout has already confirmed on-chain).
 *
 * @param {LayerswapSwap} swap
 * @returns {LayerswapSwidgeStatus}
 */
export function deriveSwidgeStatus (swap) {
  const transactions = Array.isArray(swap.transactions) ? swap.transactions : []

  const output = transactions.find((tx) => tx?.type === 'output')
  if (output?.status === 'completed') return 'completed'

  const refund = transactions.find((tx) => tx?.type === 'refund')
  if (refund) return refund.status === 'completed' ? 'refunded' : 'refund-pending'

  if (output) return 'pending'

  return mapSwapStatus(swap.status)
}

/**
 * Builds a WDK swidge status result from a `GET /api/v2/swaps/{id}` response.
 * The status is transaction-first (see {@link deriveSwidgeStatus}).
 *
 * The optional chain hints constrain the lookup: if the swap's source (destination)
 * network does not match `fromChain` (`toChain`) — compared case-insensitively against
 * the Layerswap network name and its chain id — no swidge exists for the given id on
 * those chains, and a `NoSuchElementError` is thrown.
 *
 * @param {LayerswapSwapResponse} response
 * @param {LayerswapSwidgeStatusOptions} [options] - Optional chain hints.
 * @returns {LayerswapSwidgeStatusResult}
 * @throws {ProviderError} If the response is missing the swap details.
 * @throws {NoSuchElementError} If the swap does not match the given chain hints.
 */
export function buildStatusResult (response, options = {}) {
  const swap = response?.swap
  if (!swap || !swap.id) {
    throw new ProviderError('Layerswap response is missing swap details.', {
      reason: ProviderErrorReason.INTERNAL_SERVER_ERROR
    })
  }

  if (options.fromChain !== undefined && !matchesChain(swap.source_network, options.fromChain)) {
    throw new NoSuchElementError(`No swidge with id '${swap.id}' exists from chain '${options.fromChain}'.`)
  }

  if (options.toChain !== undefined && !matchesChain(swap.destination_network, options.toChain)) {
    throw new NoSuchElementError(`No swidge with id '${swap.id}' exists to chain '${options.toChain}'.`)
  }

  return {
    status: deriveSwidgeStatus(swap),
    transactions: mapSwapTransactions(swap.transactions)
  }
}

/**
 * Tests whether a Layerswap network matches a chain identifier (network name or chain id).
 *
 * @private
 * @param {LayerswapNetwork | string | undefined} network
 * @param {string | number} chain
 * @returns {boolean}
 */
function matchesChain (network, chain) {
  if (network === undefined || network === null) return false

  const target = String(chain).toLowerCase()

  if (typeof network === 'string') return network.toLowerCase() === target

  return network.name?.toLowerCase() === target ||
    (network.chain_id != null && String(network.chain_id).toLowerCase() === target)
}

/**
 * Maps the Layerswap network catalog to WDK swidge supported chains.
 *
 * @param {LayerswapNetwork[]} networks
 * @returns {LayerswapSwidgeSupportedChain[]}
 */
export function buildSupportedChains (networks) {
  return networks.map((network) => ({
    id: network.name,
    name: network.display_name ?? network.name,
    type: network.type,
    nativeToken: network.token?.symbol ?? ''
  }))
}

/**
 * Flattens the Layerswap network catalog to WDK swidge supported tokens.
 *
 * Filtering is chain-scoped: `toChain` (or, failing that, `fromChain`) restricts the
 * result to that network's tokens. Route-level filtering (`fromToken`) would require
 * Layerswap's sources/destinations endpoints and is not applied here.
 *
 * @param {LayerswapNetwork[]} networks
 * @param {LayerswapSwidgeSupportedTokensOptions} [options]
 * @returns {LayerswapSwidgeSupportedToken[]}
 */
export function buildSupportedTokens (networks, options = {}) {
  const scope = options.toChain ?? options.fromChain
  const scopeName = scope !== undefined && scope !== null ? String(scope).toLowerCase() : undefined

  const tokens = []
  for (const network of networks) {
    if (scopeName !== undefined && network.name.toLowerCase() !== scopeName) continue

    for (const token of network.tokens ?? []) {
      tokens.push({
        token: token.symbol,
        chain: network.name,
        symbol: token.symbol,
        decimals: token.decimals,
        ...(token.contract != null && { address: token.contract }),
        ...(token.display_asset !== undefined && { name: token.display_asset })
      })
    }
  }
  return tokens
}

/**
 * Builds the itemised WDK fee breakdown for a Layerswap quote. Both components are
 * deducted from the source amount by Layerswap, so they are denominated in the
 * source token and flagged `included: true`. Source-chain gas is not known here;
 * chain-specific packages append it as a non-included 'network' fee in the native token.
 *
 * @param {LayerswapQuote} quote
 * @param {LayerswapToken} sourceToken
 * @param {string} [sourceChain] - Layerswap source network name.
 * @returns {LayerswapSwidgeFee[]}
 */
export function buildQuoteFees (quote, sourceToken, sourceChain) {
  const fees = []

  if (quote.service_fee !== undefined && quote.service_fee !== null) {
    fees.push({
      type: /** @type {'protocol'} */ ('protocol'),
      amount: parseDecimal(quote.service_fee, sourceToken.decimals),
      token: sourceToken.symbol,
      ...(sourceChain !== undefined && { chain: sourceChain }),
      included: true,
      description: 'Layerswap service fee'
    })
  }

  if (quote.blockchain_fee !== undefined && quote.blockchain_fee !== null) {
    fees.push({
      type: /** @type {'network'} */ ('network'),
      amount: parseDecimal(quote.blockchain_fee, sourceToken.decimals),
      token: sourceToken.symbol,
      ...(sourceChain !== undefined && { chain: sourceChain }),
      included: true,
      description: 'Destination network fee, charged by Layerswap in the source token'
    })
  }

  // Some responses (e.g. the quote embedded in a create-swap response) may omit the
  // per-component breakdown; fall back to the total so the fee is never under-reported.
  if (fees.length === 0 && quote.total_fee !== undefined && quote.total_fee !== null) {
    fees.push({
      type: /** @type {'protocol'} */ ('protocol'),
      amount: parseDecimal(quote.total_fee, sourceToken.decimals),
      token: sourceToken.symbol,
      ...(sourceChain !== undefined && { chain: sourceChain }),
      included: true,
      description: 'Layerswap total fee'
    })
  }

  return fees
}

/**
 * Builds a WDK swidge quote from a Layerswap quote.
 *
 * @param {LayerswapQuote} quote
 * @param {LayerswapToken} sourceToken
 * @param {LayerswapToken} destinationToken
 * @param {string} [sourceChain] - Layerswap source network name.
 * @returns {LayerswapSwidgeQuote}
 */
export function buildSwidgeQuote (quote, sourceToken, destinationToken, sourceChain) {
  const estimatedDuration = parseCompletionTime(quote.avg_completion_time)
  const minReceive = quote.min_receive_amount ?? quote.receive_amount

  const parse = (value, decimals) => value !== undefined && value !== null
    ? parseDecimal(value, decimals)
    : 0n

  return {
    fromTokenAmount: parse(quote.requested_amount, sourceToken.decimals),
    toTokenAmount: parse(quote.receive_amount, destinationToken.decimals),
    toTokenAmountMin: parse(minReceive, destinationToken.decimals),
    fees: buildQuoteFees(quote, sourceToken, sourceChain),
    ...(estimatedDuration !== undefined && { estimatedDuration })
  }
}

/**
 * Parses Layerswap's `avg_completion_time` ("HH:MM:SS" or "HH:MM:SS.fffffff") to
 * whole seconds. Returns undefined on missing or unparseable input.
 *
 * @param {string} [value]
 * @returns {number | undefined}
 */
export function parseCompletionTime (value) {
  if (typeof value !== 'string') return undefined

  const match = value.match(/^(\d+):([0-5]?\d):([0-5]?\d)(?:\.\d+)?$/)
  if (!match) return undefined

  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

/**
 * Converts a WDK swidge slippage (decimal, e.g. 0.01 for 1%) to the percentage
 * string the Layerswap API expects (e.g. '1').
 *
 * @param {number} [slippage]
 * @returns {string | undefined}
 * @throws {ValueError} If the slippage is not a non-negative number.
 */
export function formatSlippage (slippage) {
  if (slippage === undefined || slippage === null) return undefined

  const percent = Number(slippage) * 100
  if (!Number.isFinite(percent) || percent < 0) {
    throw new ValueError(`Invalid slippage value '${slippage}'. Expected a non-negative decimal (e.g. 0.01 for 1%).`)
  }

  // Trim binary float artifacts (e.g. 0.07 * 100 === 7.000000000000001).
  return String(Math.round(percent * 1e6) / 1e6)
}

/**
 * Converts an integer option (an amount in base units, or basis points) to a bigint.
 *
 * @param {number | bigint | string | undefined} value - The option value.
 * @param {string} name - The option name, used in the error message.
 * @returns {bigint | undefined} The value as a bigint, or undefined if the option is not set.
 * @throws {ValueError} If the value is not an integer.
 */
export function toBigIntOption (value, name) {
  if (value === undefined) return undefined

  try {
    return BigInt(value)
  } catch (_) {
    throw new ValueError(`The '${name}' option must be an integer, got '${value}'.`)
  }
}

/**
 * @typedef {Object} LayerswapFeeGuardsConfig
 * @property {number | bigint} [maxNetworkFeeBps] - Maximum network fee, in basis points of the input amount.
 * @property {number | bigint} [maxProtocolFeeBps] - Maximum protocol fee, in basis points of the input amount.
 */

/**
 * Enforces the WDK `maxNetworkFeeBps` / `maxProtocolFeeBps` guards against a fee
 * breakdown, in basis points of the input amount.
 *
 * Only fees denominated in the source token — plus, for the network guard, fees in
 * `nativeToken` when the source token IS the native token — share the input amount's
 * unit and can be compared soundly; fees in other units are excluded from the check.
 *
 * @param {LayerswapSwidgeFee[]} fees
 * @param {bigint} fromTokenAmount - The input amount in source-token base units.
 * @param {string} sourceTokenSymbol
 * @param {LayerswapFeeGuardsConfig} [config]
 * @throws {ValueError} If a guard is not an integer.
 * @throws {MaximumFeeExceededError} If a fee exceeds its basis-points guard.
 */
export function assertFeeGuards (fees, fromTokenAmount, sourceTokenSymbol, config = {}) {
  const maxNetworkFeeBps = toBigIntOption(config.maxNetworkFeeBps, 'maxNetworkFeeBps')
  const maxProtocolFeeBps = toBigIntOption(config.maxProtocolFeeBps, 'maxProtocolFeeBps')
  if (maxNetworkFeeBps === undefined && maxProtocolFeeBps === undefined) return
  if (fromTokenAmount <= 0n) return

  const sumBps = (type) => {
    let total = 0n
    for (const fee of fees) {
      if (fee.type !== type) continue
      if (fee.token !== sourceTokenSymbol) continue
      total += fee.amount
    }
    return (total * 10000n) / fromTokenAmount
  }

  if (maxProtocolFeeBps !== undefined && sumBps('protocol') > maxProtocolFeeBps) {
    throw new MaximumFeeExceededError('Exceeded maximum protocol fee for swidge operation.')
  }

  if (maxNetworkFeeBps !== undefined && sumBps('network') > maxNetworkFeeBps) {
    throw new MaximumFeeExceededError('Exceeded maximum network fee for swidge operation.')
  }
}

/**
 * Names of the WDK errors the `ISwidgeProtocol` interface allows `quoteSwidge` / `swidge`
 * to throw. Matched by name rather than `instanceof` because wallet packages may bundle a
 * different copy of `@tetherto/wdk-wallet` than this package.
 */
const SWIDGE_ERROR_NAMES = new Set([
  'AccountRequiredError',
  'ReadOnlyAccountRequiredError',
  'DisposalError',
  'ValueError',
  'InvalidTokenError',
  'ProviderRequiredError',
  'ProviderError',
  'SwidgeError',
  'MaximumFeeExceededError'
])

/**
 * Normalizes an error raised by a wallet account (or by the chain SDK it relies on) so that
 * it complies with the `ISwidgeProtocol` throw contract:
 * - errors already in the contract are returned as-is;
 * - `TransactionError` / `TransferError` with an insufficient-balance reason become a
 *   `SwidgeError` with the same reason;
 * - anything else is wrapped in a `ProviderError`, keeping the original error as `cause`.
 *
 * @param {unknown} error - The error raised by the wallet account.
 * @returns {Error} The normalized error.
 */
export function normalizeWalletError (error) {
  const name = /** @type {any} */ (error)?.name
  const reason = /** @type {any} */ (error)?.reason

  if (SWIDGE_ERROR_NAMES.has(name)) {
    return /** @type {Error} */ (error)
  }

  const message = /** @type {any} */ (error)?.message ?? String(error)

  if ((name === 'TransactionError' || name === 'TransferError') && Object.values(SwidgeErrorReason).includes(reason)) {
    return new SwidgeError(message, { reason, cause: error })
  }

  return new ProviderError(`The wallet account failed to perform the operation: ${message}`, {
    reason: ProviderErrorReason.INTERNAL_SERVER_ERROR,
    cause: error
  })
}
