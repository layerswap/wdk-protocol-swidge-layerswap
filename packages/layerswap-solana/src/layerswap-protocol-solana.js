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
import { ProviderError, ProviderRequiredError, ValueError } from '@tetherto/wdk-wallet/protocols'
import {
  decompileTransactionMessageFetchingLookupTables,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getShortU16Decoder,
  setTransactionMessageLifetimeUsingBlockhash
} from '@solana/kit'

import {
  LayerswapSwidgeProtocol,
  resolveNetworkByName
} from '@layerswap/wdk-protocol-swidge-layerswap-core'

/** @typedef {import('@tetherto/wdk-wallet-solana').WalletAccountSolana} WalletAccountSolana */
/** @typedef {import('@tetherto/wdk-wallet-solana').WalletAccountReadOnlySolana} WalletAccountReadOnlySolana */

/** @typedef {WalletAccountReadOnlySolana['_rpc']} SolanaRpc */

/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapNetwork} LayerswapNetwork */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapProtocolConfig} LayerswapProtocolConfig */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSwidgeRoute} LayerswapSwidgeRoute */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapDepositContext} LayerswapDepositContext */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapBroadcastDeposit} LayerswapBroadcastDeposit */

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

const KNOWN_CLUSTER_NAMES = new Set(Object.values(GENESIS_HASH_TO_NETWORK_NAME))

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/

// Standard per-signature fee floor for Solana. Used as a quote-time approximation only;
// the real fee is quoted by the wallet account on the deposit transaction at swidge() time.
const SOLANA_PER_SIGNATURE_FEE_LAMPORTS = 5000n

/** @typedef {import('@solana/kit').BaseTransactionMessage} SolanaTransactionMessage */

/**
 * @typedef {Object} LayerswapSolanaPreparedDeposit
 * @property {SolanaTransactionMessage} message - The unsigned deposit transaction message, with a fresh blockhash.
 * @property {bigint} fee - The estimated fee of the deposit transaction (in lamports).
 */

/**
 * WDK swidge protocol that drives a Layerswap swap from a Solana wallet account. The
 * chain-agnostic swidge logic lives in `LayerswapSwidgeProtocol`
 * (`@layerswap/wdk-protocol-swidge-layerswap-core`); this class only implements the Solana
 * specifics: source cluster detection and the deposit transaction.
 *
 * Layerswap returns the deposit as `call_data`: a base64-encoded, unsigned Solana
 * transaction. It is decoded into a transaction message with a fresh blockhash, then
 * quoted, signed and broadcast through the wallet account
 * (`account.quoteSendTransaction(message)` / `account.sendTransaction(message)`). The
 * source cluster is detected through the rpc client the wallet account was built with
 * (`account._rpc`), so every provider shape supported by the wallet — rpc url, rpc client
 * or a fail-over list of them — works as-is.
 *
 * @extends {LayerswapSwidgeProtocol}
 */
export default class LayerswapProtocolSolana extends LayerswapSwidgeProtocol {
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
     * The Solana rpc client the wallet account was built with. Reused as-is instead of
     * rebuilding one from `account._config.provider`, so that every provider shape the
     * wallet supports (rpc url, rpc client, or a list of them wrapped in the wdk fail-over
     * provider) is honoured.
     *
     * @private
     * @type {SolanaRpc | undefined}
     */
    this._rpc = account?._rpc

    /**
     * @private
     * @type {LayerswapNetwork | undefined}
     */
    this._sourceNetwork = undefined

    /**
     * @private
     * @type {string | undefined}
     */
    this._genesisHash = undefined
  }

  /** @protected */
  get _nativeTokenSymbol () {
    return 'SOL'
  }

  /**
   * Detects the source network from the genesis hash reported by the account's rpc
   * client. Cached for the lifetime of the protocol instance.
   *
   * @protected
   * @returns {Promise<LayerswapNetwork>} The source network.
   * @throws {ValueError} If the genesis hash is not a known Solana cluster, or Layerswap does not support it.
   * @throws {ProviderRequiredError} If the account is not connected to a provider.
   * @throws {ProviderError} If the rpc fails to report the genesis hash.
   */
  async _detectSourceNetwork () {
    if (this._sourceNetwork !== undefined) {
      return this._sourceNetwork
    }

    if (!this._rpc) {
      throw new ProviderRequiredError("The 'fromChain' option is required when the protocol has no connected provider to detect the source chain from.")
    }

    const genesisHash = await this._getGenesisHash()
    const name = GENESIS_HASH_TO_NETWORK_NAME[genesisHash]
    if (!name) {
      throw new ValueError(`Unknown Solana genesis hash '${genesisHash}'. Pass the Layerswap network name explicitly via the 'fromChain' option (legacy: 'sourceChain').`)
    }

    this._sourceNetwork = await resolveNetworkByName(this._client, name)
    return this._sourceNetwork
  }

  /**
   * Asserts that the account's rpc client is connected to the source network named by
   * 'fromChain'. Layerswap also lists other svm chains (e.g. Eclipse) as solana networks,
   * whose genesis hashes are not known here: the check is skipped when neither the rpc
   * cluster nor 'fromChain' is a known Solana cluster.
   *
   * @protected
   * @param {LayerswapNetwork} network - The source network named by 'fromChain'.
   * @returns {Promise<void>}
   * @throws {ValueError} If the rpc client is connected to a different network.
   * @throws {ProviderError} If the rpc fails to report the genesis hash.
   */
  async _assertAccountNetwork (network) {
    if (!this._rpc) return

    const connected = GENESIS_HASH_TO_NETWORK_NAME[await this._getGenesisHash()]

    if (connected === network.name) return

    if (connected === undefined && !KNOWN_CLUSTER_NAMES.has(network.name)) return

    throw new ValueError(`The 'fromChain' option is '${network.name}', but the wallet account is connected to '${connected ?? 'an unknown svm cluster'}'.`)
  }

  /**
   * Reads the genesis hash of the cluster the account's rpc client is connected to. Cached
   * for the lifetime of the protocol instance.
   *
   * @private
   * @returns {Promise<string>} The genesis hash.
   * @throws {ProviderError} If the rpc fails to report the genesis hash.
   */
  async _getGenesisHash () {
    if (this._genesisHash === undefined) {
      this._genesisHash = await this._callWallet(() => this._rpc.getGenesisHash().send())
    }

    return this._genesisHash
  }

  /**
   * Tests whether the bound account is a writable Solana wallet account, i.e. exposes
   * `sendTransaction` and a `keyPair` with a 32-byte `publicKey`. Read-only accounts do not
   * expose `keyPair`. This is a duck-type check rather than an `instanceof
   * WalletAccountSolana` check because the wallet package may resolve to a different copy
   * than this package's own, and `instanceof` would then fail on a structurally-correct
   * account.
   *
   * @protected
   * @param {unknown} account - The bound account.
   * @returns {boolean} True if the account can sign and send transactions.
   */
  _isWritableAccount (account) {
    if (!account || typeof account !== 'object') return false
    if (typeof account.sendTransaction !== 'function') return false
    const keyPair = account.keyPair
    if (!keyPair || typeof keyPair !== 'object') return false
    return keyPair.publicKey instanceof Uint8Array && keyPair.publicKey.length === 32
  }

  /**
   * Tests whether the bound (writable) account has been disposed. Besides the generic
   * `disposed` flag, a disposed `WalletAccountSolana` erases its private key, so its
   * `keyPair.privateKey` reads as `null`.
   *
   * @protected
   * @param {WalletAccountSolana} account - The bound account.
   * @returns {boolean} True if the account has been disposed.
   */
  _isDisposedAccount (account) {
    if (super._isDisposedAccount(account)) return true
    const { privateKey } = account.keyPair
    return !(privateKey instanceof Uint8Array) || privateKey.length !== 32
  }

  /**
   * @protected
   * @param {LayerswapSwidgeRoute} route - The resolved swidge route.
   * @throws {ProviderRequiredError} If the account is not connected to a provider.
   */
  _assertSwidgeRoute (route) {
    if (!this._rpc) {
      throw new ProviderRequiredError('The wallet must be connected to a provider in order to perform swidge operations.')
    }
  }

  /**
   * Approximates the source-chain fee of the deposit with Solana's per-signature fee floor.
   *
   * @protected
   * @param {LayerswapSwidgeRoute} route - The resolved swidge route.
   * @param {bigint} amount - The input amount in source-token base units.
   * @param {string} sourceAddress - The address of the bound account.
   * @returns {Promise<bigint>} The estimated fee, in lamports.
   */
  async _quoteSourceGas (route, amount, sourceAddress) {
    return SOLANA_PER_SIGNATURE_FEE_LAMPORTS
  }

  /**
   * Validates the deposit transaction returned by Layerswap, and quotes its fee through the
   * wallet account.
   *
   * @protected
   * @param {LayerswapDepositContext} context - The deposit context.
   * @returns {Promise<LayerswapSolanaPreparedDeposit>} The prepared deposit.
   * @throws {ProviderError} If the deposit transaction is malformed, or the rpc fails.
   */
  async _prepareDeposit ({ action }) {
    const callData = action.call_data

    if (typeof callData !== 'string' || callData.length === 0) {
      throw new ProviderError('Layerswap deposit action for Solana is missing call_data; the wire-format transaction cannot be reconstructed.', {
        reason: ProviderErrorReason.INTERNAL_SERVER_ERROR
      })
    }

    if (!BASE64_PATTERN.test(callData)) {
      throw new ProviderError('Layerswap call_data for Solana is not a valid base64-encoded transaction.', {
        reason: ProviderErrorReason.INTERNAL_SERVER_ERROR
      })
    }

    const message = await this._buildDepositMessage(callData)

    const { fee } = await this._callWallet(() => this._account.quoteSendTransaction(message))

    return { message, fee: BigInt(fee) }
  }

  /**
   * Turns Layerswap's `call_data` into a transaction message the wallet account signs.
   * Like the Layerswap app, the `call_data` is treated as an unsigned template: its
   * signatures (Layerswap sends none) are dropped, and its blockhash is replaced by a
   * fresh one, since the one Layerswap set may expire before the deposit is signed.
   * The wallet account rejects the message if its fee payer is not the account.
   *
   * @private
   * @param {string} callData - The base64-encoded deposit transaction.
   * @returns {Promise<SolanaTransactionMessage>} The deposit transaction message.
   * @throws {ProviderError} If the deposit transaction is malformed, or the rpc fails.
   */
  async _buildDepositMessage (callData) {
    let compiledMessage

    try {
      const bytes = getBase64Encoder().encode(callData)
      const [signatures, offset] = getShortU16Decoder().read(bytes, 0)
      compiledMessage = getCompiledTransactionMessageDecoder().decode(bytes.subarray(offset + 64 * signatures))
    } catch (error) {
      throw new ProviderError('Layerswap call_data for Solana is not a valid transaction.', {
        reason: ProviderErrorReason.INTERNAL_SERVER_ERROR,
        cause: error
      })
    }

    const message = await this._callWallet(() => decompileTransactionMessageFetchingLookupTables(compiledMessage, this._rpc))
    const { value: latestBlockhash } = await this._callWallet(() => this._rpc.getLatestBlockhash().send())

    return setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, message)
  }

  /**
   * Signs and broadcasts the deposit transaction through the wallet account.
   *
   * @protected
   * @param {LayerswapSolanaPreparedDeposit} deposit - The prepared deposit.
   * @returns {Promise<LayerswapBroadcastDeposit>} The broadcast deposit.
   * @throws {ProviderError} If the rpc fails to broadcast the deposit.
   * @throws {MaximumFeeExceededError} If the wallet rejects the transaction fee.
   */
  async _sendDeposit ({ message }) {
    const { hash } = await this._callWallet(() => this._account.sendTransaction(message))
    return { hash }
  }
}
