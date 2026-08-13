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
import { Connection, Keypair, Transaction } from '@solana/web3.js'

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
} from '@layerswap/wdk-protocol-bridge-layerswap-core'

/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeProtocolConfig} SwidgeProtocolConfig */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeOptions} SwidgeOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeQuote} SwidgeQuote */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeResult} SwidgeResult */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeFee} SwidgeFee */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeStatusResult} SwidgeStatusResult */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedChain} SwidgeSupportedChain */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedToken} SwidgeSupportedToken */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedTokensOptions} SwidgeSupportedTokensOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').BridgeResult} BridgeResult */

/** @typedef {import('@tetherto/wdk-wallet-solana').WalletAccountSolana} WalletAccountSolana */
/** @typedef {import('@tetherto/wdk-wallet-solana').WalletAccountReadOnlySolana} WalletAccountReadOnlySolana */

/** @typedef {import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapNetwork} LayerswapNetwork */
/** @typedef {import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapToken} LayerswapToken */
/** @typedef {import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapDepositAction} LayerswapDepositAction */
/** @typedef {import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapSwap} LayerswapSwap */
/** @typedef {import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapQuote} LayerswapQuote */

/**
 * Known Solana cluster genesis hashes → Layerswap network names.
 *
 * Layerswap's `network.chain_id` is unreliable for Solana (empty string on mainnet,
 * a numeric string on devnet), so we identify the source network by genesis hash
 * instead. See `tests/fixtures/RESEARCH-NOTES.md`.
 */
/* eslint-disable quote-props */
const GENESIS_HASH_TO_NETWORK_NAME = Object.freeze({
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d': 'SOLANA_MAINNET',
  'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG': 'SOLANA_DEVNET',
  '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY': 'SOLANA_TESTNET'
})
/* eslint-enable quote-props */

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
 * @property {string | number} [fromChain]    - Layerswap source network name (e.g. `'SOLANA_MAINNET'`).
 *                                              Defaults to the network detected from the connected RPC's
 *                                              genesis hash.
 * @property {boolean} [refuel]               - Request a native-gas drop on the destination chain.
 * @property {string} [referenceId]           - External reference id for the created swap.
 */

/**
 * @typedef {Object} BridgeOptions
 * @property {string} targetChain             - Layerswap destination network name (e.g. `'ARBITRUM_MAINNET'`).
 * @property {string} recipient               - Destination-chain recipient address, in its native format.
 * @property {string} token                   - Source token: SPL mint base58 address OR Layerswap symbol
 *                                              (e.g. `'SOL'`, `'USDC'`).
 * @property {number | bigint} amount         - Source amount in base units (lamports for SOL, smallest unit
 *                                              for SPL tokens).
 * @property {string} [destinationToken]      - Destination token (address or symbol). Defaults to the
 *                                              source token's symbol.
 * @property {string} [sourceChain]           - Override auto-detected source network name. Auto-detection
 *                                              uses `Connection.getGenesisHash()` against a table of
 *                                              known Solana cluster hashes.
 * @property {boolean} [refuel]               - Request a native-gas drop on the destination chain.
 * @property {string} [slippage]              - Slippage tolerance percentage, e.g. `'0.5'`.
 * @property {string} [referenceId]           - External reference id for the created swap.
 * @property {string} [refundAddress]         - Refund address used if the swap fails after deposit.
 */

/**
 * @typedef {BridgeResult & { swapId: string }} LayerswapBridgeResult
 */

// Standard per-signature fee floor for Solana. Used as a quote-time approximation only;
// the real fee is read from the deserialised deposit transaction at swidge() time.
const SOLANA_PER_SIGNATURE_FEE_LAMPORTS = 5000n

/**
 * WDK swidge protocol that drives a Layerswap swap from a Solana wallet account.
 *
 * Implements the `SwidgeProtocol` interface from `@tetherto/wdk-wallet/protocols`:
 * `quoteSwidge` / `swidge` / `getSwidgeStatus` / `getSupportedChains` / `getSupportedTokens`,
 * which also provides the WDK `swap`/`bridge` module surfaces via the base class.
 *
 * Unlike on-chain bridges this protocol is HTTP-orchestrated:
 *   1. POST /api/v2/swaps to create a swap and receive a deposit transaction blob.
 *   2. Deserialise the `call_data` (base64-encoded legacy Solana `Transaction`) and broadcast
 *      it from the user's wallet.
 *   3. Layerswap performs the destination-chain payout off-chain.
 *
 * `swidge()` resolves once the source-chain deposit transaction has been broadcast; the
 * destination payout completes asynchronously and can be tracked with
 * `getSwidgeStatus(result.id)`.
 *
 * Fee semantics: Layerswap deducts its fees from the source-token amount, so 'protocol'
 * and Layerswap's destination 'network' fee entries are denominated in the **source
 * token** and flagged `included: true`. Source-chain gas is a separate non-included
 * 'network' fee in the **native token** (lamports). Do not sum amounts across fee
 * entries with different `token` values.
 *
 * Implementation note: the deposit transaction is broadcast through `@solana/web3.js`
 * (legacy SDK) rather than `account.sendTransaction(...)`. Layerswap's `call_data` is a
 * base64-encoded legacy `Transaction` wire format, and the modular v3 SDK that powers
 * `@tetherto/wdk-wallet-solana` does not natively consume that shape. The wallet account
 * is still the source of identity (`getAddress`, `keyPair`).
 */
export default class LayerswapProtocolSolana extends SwidgeProtocol {
  /**
   * Creates a new swidge protocol for chain/token discovery only, without a wallet account.
   *
   * @overload
   * @param {undefined} [account] - No account; only discovery and `fromChain`-scoped quotes work.
   * @param {LayerswapProtocolConfig} [config] - The layerswap protocol configuration.
   */

  /**
   * Creates a new read-only interface to the layerswap protocol for solana blockchains.
   *
   * @overload
   * @param {WalletAccountReadOnlySolana} account - The wallet account to use to interact with the protocol.
   * @param {LayerswapProtocolConfig} [config] - The layerswap protocol configuration.
   */

  /**
   * Creates a new interface to the layerswap protocol for solana blockchains.
   *
   * @overload
   * @param {WalletAccountSolana} account - The wallet account to use to interact with the protocol.
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

    const providerOption = account?._config?.provider ?? account?._config?.rpcUrl
    const endpoint = Array.isArray(providerOption) ? providerOption[0] : providerOption

    /**
     * @private
     * @type {Connection | undefined}
     */
    this._connection = typeof endpoint === 'string' && endpoint.length > 0
      ? new Connection(endpoint, 'confirmed')
      : undefined

    /**
     * @private
     * @type {string | undefined}
     */
    this._sourceNetworkName = undefined
  }

  /**
   * Quotes the estimated costs and output of a Layerswap swidge operation without
   * creating a swap. Layerswap only supports exact-in operations; passing
   * `toTokenAmount` throws.
   *
   * When the protocol has an account bound, the quote includes a non-included
   * 'network' fee entry with the estimated source-chain gas (in lamports). Solana
   * fees are per-signature and bounded; a single-signature transfer is essentially
   * always 5000 lamports. The actual deposit transaction may contain additional
   * instructions (e.g. memo, ATA creation) and the gas fee reported by `swidge()`
   * reflects that — quote-time it is only an approximation.
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
      swidgeQuote.fees.push(this._buildGasFee(SOLANA_PER_SIGNATURE_FEE_LAMPORTS, route.sourceNetwork))
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
   * @param {SwidgeProtocolConfig & Pick<LayerswapProtocolConfig, 'bridgeMaxFee'>} [config] - Optional
   *   execution configuration; per-call overrides of the protocol's fee guards.
   * @returns {Promise<SwidgeResult>} The swidge execution result. `id` is the Layerswap swap
   *   id (use it with `getSwidgeStatus`); `hash` is the source-chain deposit transaction signature.
   */
  async swidge (options, config) {
    if (!this._isWritableAccount(this._account)) {
      throw new Error("The 'swidge(options)' method requires the protocol to be initialized with a non read-only account.")
    }

    if (!this._connection) {
      throw new Error('The wallet must be connected to a provider in order to perform swidge operations.')
    }

    const route = await this._resolveSwidgeRoute(options)
    const fromTokenAmount = this._requireExactIn(options)
    const merged = { ...this._config, ...config }

    const { swap, transaction, quote } = await this._createSwap(options, route, fromTokenAmount)

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

    const gas = await this._estimateSignedTransactionFee(transaction)
    fees.push(this._buildGasFee(gas, route.sourceNetwork))

    assertFeeGuards(fees, fromTokenAmount, route.sourceToken.symbol, merged)

    const keypair = this._buildKeypair()
    transaction.sign(keypair)

    const hash = await this._connection.sendRawTransaction(transaction.serialize())

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
   *   network name (e.g. `'SOLANA_MAINNET'`) — use it as `fromChain`/`toChain`.
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
   * transaction signature (not the swap id), and the Layerswap swap id is returned
   * in the extra `swapId` field.
   *
   * Semantic note: `bridgeFee` is in **source-token base units**, not native lamports —
   * it is the total fee Layerswap deducts from the source amount. `fee` is the
   * source-chain gas cost in lamports. Do not sum them.
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
   * estimated source-chain gas in lamports (quote-time: the per-signature floor);
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
   * follow-up after `swidge()` returns — even if `sendRawTransaction` resolved, the tx
   * can still revert or be dropped. Returns `'completed' | 'failed' | 'pending'`.
   *
   * The source network defaults to the Solana cluster detected via `getGenesisHash()`;
   * pass `options.sourceChain` to override.
   *
   * @param {string} signature - The Solana signature returned by `swidge()`.
   * @param {{ sourceChain?: string }} [options]
   * @returns {Promise<import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapTransactionStatus>}
   */
  async getTransactionStatus (signature, options = {}) {
    const networkName = options.sourceChain ?? await this._detectSourceNetworkName()
    return this._client.getTransactionStatus(networkName, signature)
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
   * `fee` = non-included fees (source-chain gas, lamports), `bridgeFee` = included
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
      token: sourceNetwork.token?.symbol ?? 'SOL',
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
    if (options.fromChain === undefined && !this._connection) {
      throw new Error("The 'fromChain' option is required when the protocol has no connected provider to detect the source chain from.")
    }

    const sourceName = options.fromChain !== undefined
      ? String(options.fromChain)
      : await this._detectSourceNetworkName()
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
   * Creates the Layerswap swap and deserialises the deposit transaction from the returned
   * wallet-flow deposit action's `call_data`.
   *
   * @private
   * @param {LayerswapSwidgeOptions} options
   * @param {{ sourceNetwork: LayerswapNetwork, sourceToken: LayerswapToken, destinationNetwork: LayerswapNetwork, destinationToken: LayerswapToken }} route
   * @param {bigint} fromTokenAmount
   * @returns {Promise<{ swap: LayerswapSwap, transaction: Transaction, quote: LayerswapQuote | undefined }>}
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

    if (typeof action.call_data !== 'string' || action.call_data.length === 0) {
      throw new Error('Layerswap deposit action for Solana is missing call_data; the wire-format transaction cannot be reconstructed.')
    }

    const transaction = this._decodeDepositTransaction(action.call_data)

    return { swap, transaction, quote: response.quote?.quote }
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
   * Decodes Layerswap's `call_data` (base64 of a legacy Solana `Transaction` wire format)
   * into a `Transaction` instance ready for signing + broadcast. Mirrors the Layerswap web
   * app's `SVMWalletWithdraw` code path.
   *
   * @private
   * @param {string} callData
   * @returns {Transaction}
   */
  _decodeDepositTransaction (callData) {
    let bytes
    try {
      bytes = Buffer.from(callData, 'base64')
    } catch (err) {
      throw new Error(`Layerswap call_data is not valid base64: ${err.message}`)
    }

    try {
      return Transaction.from(bytes)
    } catch (err) {
      const preview = callData.length > 64 ? `${callData.slice(0, 64)}…` : callData
      throw new Error(`Failed to deserialise Layerswap call_data as a legacy Solana Transaction (length=${callData.length}, preview='${preview}'): ${err.message}`)
    }
  }

  /**
   * Builds a `Keypair` from the wallet account's raw 32-byte private + public key bytes.
   * `@solana/web3.js` expects a 64-byte secret key (32 private || 32 public, nacl convention).
   *
   * @private
   * @returns {Keypair}
   */
  _buildKeypair () {
    const { privateKey, publicKey } = this._account.keyPair
    if (!(privateKey instanceof Uint8Array) || privateKey.length !== 32 ||
        !(publicKey instanceof Uint8Array) || publicKey.length !== 32) {
      throw new Error('Wallet account exposed an unexpected key pair shape; expected 32-byte private + 32-byte public Uint8Arrays.')
    }

    const secret = new Uint8Array(64)
    secret.set(privateKey, 0)
    secret.set(publicKey, 32)
    return Keypair.fromSecretKey(secret)
  }

  /**
   * Estimates the on-chain fee for a deserialised Layerswap deposit transaction by asking
   * the connected RPC. Mirrors the Layerswap web app's `transaction.getEstimatedFee(connection)`
   * call.
   *
   * @private
   * @param {Transaction} transaction
   * @returns {Promise<bigint>} The fee in lamports.
   */
  async _estimateSignedTransactionFee (transaction) {
    if (typeof transaction.getEstimatedFee !== 'function') {
      return SOLANA_PER_SIGNATURE_FEE_LAMPORTS
    }

    try {
      const fee = await transaction.getEstimatedFee(this._connection)
      if (fee === null || fee === undefined) return SOLANA_PER_SIGNATURE_FEE_LAMPORTS
      return BigInt(fee)
    } catch (_) {
      return SOLANA_PER_SIGNATURE_FEE_LAMPORTS
    }
  }

  /**
   * Tests whether the bound account is a writable Solana wallet account
   * (i.e. exposes a `keyPair` with both a 32-byte `privateKey` and 32-byte
   * `publicKey`). This is a duck-type check rather than an `instanceof
   * WalletAccountSolana` check because pnpm-workspace setups can resolve the
   * wallet package to a different copy than this package's own copy when the
   * dep tree's peer-dep contexts diverge — `instanceof` would then fail on a
   * structurally-correct account. Read-only accounts do not expose `keyPair`.
   *
   * @private
   * @param {unknown} account
   * @returns {boolean}
   */
  _isWritableAccount (account) {
    if (!account || typeof account !== 'object') return false
    const keyPair = account.keyPair
    if (!keyPair || typeof keyPair !== 'object') return false
    const { privateKey, publicKey } = keyPair
    return privateKey instanceof Uint8Array && privateKey.length === 32 &&
      publicKey instanceof Uint8Array && publicKey.length === 32
  }

  /**
   * Detects the source Solana network by genesis hash. Cached for the lifetime of the
   * protocol instance.
   *
   * @private
   * @returns {Promise<string>} The Layerswap network name (e.g. 'SOLANA_MAINNET').
   */
  async _detectSourceNetworkName () {
    if (this._sourceNetworkName !== undefined) {
      return this._sourceNetworkName
    }

    if (!this._connection) {
      throw new Error('The wallet must be connected to a provider in order to detect the source chain.')
    }

    const genesisHash = await this._connection.getGenesisHash()
    const name = GENESIS_HASH_TO_NETWORK_NAME[genesisHash]
    if (!name) {
      throw new Error(`Unknown Solana genesis hash '${genesisHash}'. Pass the Layerswap network name explicitly via the 'fromChain' option (legacy: 'sourceChain').`)
    }

    this._sourceNetworkName = name
    return name
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
