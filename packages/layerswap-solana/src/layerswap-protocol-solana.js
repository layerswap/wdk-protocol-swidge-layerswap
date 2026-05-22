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
import { Connection, Keypair, Transaction } from '@solana/web3.js'

import LayerswapApiClient, {
  resolveNetworkByName,
  resolveToken,
  formatBaseUnits,
  parseDecimal
} from '@layerswap/wdk-protocol-bridge-layerswap-core'

/** @typedef {import('@tetherto/wdk-wallet/protocols').BridgeProtocolConfig} BridgeProtocolConfig */
/** @typedef {import('@tetherto/wdk-wallet/protocols').BridgeResult} BridgeResult */

/** @typedef {import('@tetherto/wdk-wallet-solana').WalletAccountSolana} WalletAccountSolana */
/** @typedef {import('@tetherto/wdk-wallet-solana').WalletAccountReadOnlySolana} WalletAccountReadOnlySolana */

/** @typedef {import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapNetwork} LayerswapNetwork */
/** @typedef {import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapToken} LayerswapToken */
/** @typedef {import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapDepositAction} LayerswapDepositAction */

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
// the real fee is read from the deserialised deposit transaction at bridge() time.
const SOLANA_PER_SIGNATURE_FEE_LAMPORTS = 5000n

/**
 * Bridge protocol that drives a Layerswap swap from a Solana wallet account.
 *
 * Unlike on-chain bridges this protocol is HTTP-orchestrated:
 *   1. POST /api/v2/swaps to create a swap and receive a deposit transaction blob.
 *   2. Deserialise the `call_data` (base64-encoded legacy Solana `Transaction`) and broadcast
 *      it from the user's wallet.
 *   3. Layerswap performs the destination-chain payout off-chain.
 *
 * Semantic note: `BridgeResult.bridgeFee` is documented in `@tetherto/wdk-wallet` as
 * "native tokens paid to the bridge protocol". Layerswap deducts its fee from the
 * source-token amount instead, so we return `bridgeFee` in **source-token base units**.
 * Do not naively add `fee` (native lamports) and `bridgeFee` together — they are in
 * different units. The `bridgeMaxFee` config compares against `bridgeFee` only.
 *
 * Implementation note: the deposit transaction is broadcast through `@solana/web3.js`
 * (legacy SDK) rather than `account.sendTransaction(...)`. Layerswap's `call_data` is a
 * base64-encoded legacy `Transaction` wire format, and the modular v3 SDK that powers
 * `@tetherto/wdk-wallet-solana` does not natively consume that shape. The wallet account
 * is still the source of identity (`getAddress`, `keyPair`).
 */
export default class LayerswapProtocolSolana extends BridgeProtocol {
  /**
   * @overload
   * @param {WalletAccountReadOnlySolana} account - The wallet account to use to interact with the protocol.
   * @param {LayerswapProtocolConfig} [config] - The layerswap protocol configuration.
   */

  /**
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
   * Bridges a token to a different blockchain via Layerswap.
   *
   * Resolves once the source-chain deposit transaction has been broadcast. Layerswap finishes
   * the destination-chain payout asynchronously; callers can use `getApiClient().getSwap(swapId)`
   * to track destination delivery.
   *
   * Semantic note: `bridgeFee` is in **source-token base units**, not native lamports.
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

    if (!this._connection) {
      throw new Error('The wallet must be connected to a provider in order to perform bridge operations.')
    }

    const { transaction, bridgeFee, swapId } = await this._buildDepositTransaction(options)

    const bridgeMaxFee = config?.bridgeMaxFee ?? this._config.bridgeMaxFee
    if (bridgeMaxFee !== undefined && bridgeFee >= BigInt(bridgeMaxFee)) {
      throw new Error('Exceeded maximum fee cost for bridge operation.')
    }

    const fee = await this._estimateSignedTransactionFee(transaction)

    const keypair = this._buildKeypair()
    transaction.sign(keypair)

    const hash = await this._connection.sendRawTransaction(transaction.serialize())

    await this._notifyDepositBroadcast(swapId, hash)

    return { hash, fee, bridgeFee, swapId }
  }

  /**
   * Quotes the costs of a Layerswap bridge operation without creating a swap.
   *
   * The reported `fee` is an approximation of the source-chain fee — Solana fees are
   * per-signature and bounded; a single-signature transfer is essentially always
   * `SOLANA_PER_SIGNATURE_FEE_LAMPORTS` (5000 lamports). The actual deposit transaction
   * may contain additional instructions (e.g. memo, ATA creation) and the `fee` reported
   * by `bridge()` reflects that — quote-time it is only an approximation.
   *
   * Semantic note: `bridgeFee` is in **source-token base units**, not native lamports.
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
    const fee = SOLANA_PER_SIGNATURE_FEE_LAMPORTS

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
   * @returns {Promise<{ transaction: Transaction, bridgeFee: bigint, swapId: string }>}
   */
  async _buildDepositTransaction (options) {
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

    if (typeof action.call_data !== 'string' || action.call_data.length === 0) {
      throw new Error('Layerswap deposit action for Solana is missing call_data; the wire-format transaction cannot be reconstructed.')
    }

    const transaction = this._decodeDepositTransaction(action.call_data)

    const totalFeeDecimal = response.quote?.quote?.total_fee
    const bridgeFee = totalFeeDecimal !== undefined && totalFeeDecimal !== null
      ? parseDecimal(totalFeeDecimal, sourceToken.decimals)
      : 0n

    return { transaction, bridgeFee, swapId: swap.id }
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
    const sourceName = options.sourceChain ?? await this._detectSourceNetworkName()
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
      throw new Error(`Unknown Solana genesis hash '${genesisHash}'. Pass the Layerswap network name explicitly via the 'sourceChain' option.`)
    }

    this._sourceNetworkName = name
    return name
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
