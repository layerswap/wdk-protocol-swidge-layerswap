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
  InvalidTokenError,
  ProviderError,
  SwidgeError,
  SwidgeErrorReason,
  ValueError
} from '@tetherto/wdk-wallet/protocols'
import { Psbt, opcodes, script as bscript } from 'bitcoinjs-lib'
import { coinselect } from '@bitcoinerlab/coinselect'
import { DescriptorsFactory } from '@bitcoinerlab/descriptors'

import {
  LayerswapSwidgeProtocol,
  resolveNetworkByName
} from '@layerswap/wdk-protocol-swidge-layerswap-core'

/** @typedef {import('@tetherto/wdk-wallet-btc').WalletAccountBtc} WalletAccountBtc */
/** @typedef {import('@tetherto/wdk-wallet-btc').WalletAccountReadOnlyBtc} WalletAccountReadOnlyBtc */

/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapNetwork} LayerswapNetwork */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapProtocolConfig} LayerswapProtocolConfig */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSwidgeOptions} LayerswapSwidgeOptions */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSwidgeConfig} LayerswapSwidgeConfig */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapBridgeOptions} LayerswapBridgeOptions */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSwidgeRoute} LayerswapSwidgeRoute */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapDepositContext} LayerswapDepositContext */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapBroadcastDeposit} LayerswapBroadcastDeposit */

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

const { Output } = DescriptorsFactory()

/**
 * The layerswap protocol configuration, plus the Bitcoin-specific options.
 *
 * @typedef {LayerswapProtocolConfig & LayerswapSpecificBitcoinProtocolConfig} LayerswapBitcoinProtocolConfig
 */

/**
 * @typedef {Object} LayerswapSpecificBitcoinProtocolConfig
 * @property {number} [confirmationTarget]    - Target confirmation block count for fee estimation. Default: 1.
 */

/**
 * @typedef {Object} LayerswapSpecificBitcoinOptions
 * @property {number | bigint} [feeRate]      - Override the fee rate (sat/vB) used for PSBT construction.
 */

/**
 * The layerswap swidge options, plus the Bitcoin-specific options.
 *
 * @typedef {LayerswapSwidgeOptions & LayerswapSpecificBitcoinOptions} LayerswapBitcoinSwidgeOptions
 */

/**
 * The layerswap bridge options, plus the Bitcoin-specific options.
 *
 * @typedef {LayerswapBridgeOptions & LayerswapSpecificBitcoinOptions} LayerswapBitcoinBridgeOptions
 */

/**
 * @typedef {Object} LayerswapBitcoinPsbtParams
 * @property {string} depositAddress - The Layerswap deposit address.
 * @property {bigint} amount - The amount to deposit (in satoshis).
 * @property {Buffer} memo - The OP_RETURN payload carrying the swap reference.
 * @property {number | bigint} [feeRateOverride] - The fee rate (sat/vB) to use instead of the estimate.
 */

/**
 * @typedef {Object} LayerswapBitcoinSignedPsbt
 * @property {string} txHex - The signed, finalized transaction (hex).
 * @property {string} txid - The transaction id.
 * @property {bigint} fee - The transaction fee (in satoshis).
 */

/**
 * WDK swidge protocol that drives a Layerswap swap from a Bitcoin wallet account.
 *
 * The chain-agnostic swidge logic lives in `LayerswapSwidgeProtocol`
 * (`@layerswap/wdk-protocol-swidge-layerswap-core`); this class only implements the
 * Bitcoin specifics: source network detection and the deposit transaction.
 *
 * Layerswap returns the deposit address + a numeric `call_data` reference id, and the
 * deposit is built as a PSBT client-side via `bitcoinjs-lib`:
 *      - Inputs: UTXOs selected with `@bitcoinerlab/coinselect`, factoring the OP_RETURN overhead.
 *      - Output #0: deposit address + value (satoshis).
 *      - Output #1: `OP_RETURN` carrying the swap reference (the numeric sequence hex-encoded via
 *        `BigInt(seq).toString(16)`, any `;` tail appended verbatim, stored as UTF-8 bytes —
 *        matches the Layerswap web app exactly).
 *      - Output #2: change to sender if above the dust limit.
 * It is then signed with `psbt.signInputHD(idx, account._masterNode)`, finalized and
 * broadcast via `account._client.broadcast(hex)`.
 *
 * Implementation note: the wallet's high-level `sendTransaction` does not expose an
 * `OP_RETURN` seam, so we replicate the wallet's PSBT build with one extra output. The
 * protocol reaches into a handful of protected wallet members (`_client`, `_masterNode`,
 * `_account`, `_network`, `_dustLimit`, `_path`, `_bip`, `_ensureConnected`, `_toBigInt`),
 * verified against `@tetherto/wdk-wallet-btc@1.0.0-beta.17`. If the wallet version changes
 * the layout of these members, this package will need a matching update.
 *
 * @extends {LayerswapSwidgeProtocol<LayerswapBitcoinSwidgeOptions, LayerswapSwidgeConfig, LayerswapBitcoinBridgeOptions>}
 */
export default class LayerswapProtocolBitcoin extends LayerswapSwidgeProtocol {
  /**
   * Creates a new swidge protocol for chain/token discovery only, without a wallet account.
   *
   * @overload
   * @param {undefined} [account] - No account; only discovery and `fromChain`-scoped quotes work.
   * @param {LayerswapBitcoinProtocolConfig} [config] - The layerswap protocol configuration.
   */

  /**
   * Creates a new read-only interface to the layerswap protocol for bitcoin.
   *
   * @overload
   * @param {WalletAccountReadOnlyBtc} account - The wallet account to use to interact with the protocol.
   * @param {LayerswapBitcoinProtocolConfig} [config] - The layerswap protocol configuration.
   */

  /**
   * Creates a new interface to the layerswap protocol for bitcoin.
   *
   * @overload
   * @param {WalletAccountBtc} account - The wallet account to use to interact with the protocol.
   * @param {LayerswapBitcoinProtocolConfig} [config] - The layerswap protocol configuration.
   */
  constructor (account, config = {}) {
    super(account, config)

    /**
     * Target confirmation block count for fee estimation.
     *
     * @private
     * @type {number}
     */
    this._confirmationTarget = config.confirmationTarget ?? 1
  }

  /** @protected */
  get _nativeTokenSymbol () {
    return 'BTC'
  }

  /**
   * Maps the account's `config.network` (`bitcoin`/`testnet`/`regtest`) to the Layerswap
   * network.
   *
   * @protected
   * @returns {Promise<LayerswapNetwork>} The source network.
   * @throws {ValueError} If Layerswap does not support the network.
   * @throws {ProviderError} If the Layerswap API fails to return the network catalog.
   */
  async _detectSourceNetwork () {
    const network = this._account?._config?.network ?? 'bitcoin'
    return resolveNetworkByName(this._client, NETWORK_TO_LAYERSWAP_NAME[network] ?? 'BITCOIN_MAINNET')
  }

  /**
   * Tests whether the bound account is a writable Bitcoin wallet account (i.e. has a
   * derived `_account` key pair). Read-only accounts have none. Duck-typed because the
   * wallet package may resolve to a different copy than this package's own.
   *
   * @protected
   * @param {unknown} account - The bound account.
   * @returns {boolean} True if the account can sign transactions.
   */
  _isWritableAccount (account) {
    if (!account || typeof account !== 'object') return false
    return !!(account._account && account._account.publicKey)
  }

  /**
   * Tests whether the bound account has been disposed. Besides the generic `disposed`
   * flag, `WalletAccountBtc.dispose()` wipes the master node (`_masterNode`).
   *
   * @protected
   * @param {WalletAccountBtc} account - The bound account.
   * @returns {boolean} True if the account has been disposed.
   */
  _isDisposedAccount (account) {
    if (super._isDisposedAccount(account)) return true
    const masterNode = account._masterNode
    return !(masterNode && masterNode.fingerprint)
  }

  /**
   * Only native BTC can be deposited from a Bitcoin wallet.
   *
   * @protected
   * @param {LayerswapSwidgeRoute} route - The resolved swidge route.
   * @throws {InvalidTokenError} If the source token is not native BTC.
   */
  _assertSwidgeRoute (route) {
    const { sourceToken } = route
    if (sourceToken.contract) {
      throw new InvalidTokenError(`Layerswap Bitcoin source token must be native BTC, got '${sourceToken.symbol}' with contract '${sourceToken.contract}'. Tokens (BRC-20, Runes, etc.) are not supported.`)
    }
  }

  /**
   * Approximates the source-chain fee of the deposit transaction.
   *
   * @protected
   * @param {LayerswapSwidgeRoute} route - The resolved swidge route.
   * @param {bigint} amount - The input amount in satoshis.
   * @param {string} sourceAddress - The address of the bound account.
   * @returns {Promise<bigint>} The estimated fee, in satoshis.
   */
  async _quoteSourceGas (route, amount, sourceAddress) {
    return BTC_FEE_APPROX_SATS
  }

  /**
   * Builds and signs the deposit transaction (deposit output + `OP_RETURN` memo).
   *
   * @protected
   * @param {LayerswapDepositContext} context - The deposit context.
   * @returns {Promise<LayerswapBitcoinSignedPsbt>} The prepared deposit.
   * @throws {ValueError} If the amount is below the dust limit.
   * @throws {SwidgeError} If the account has insufficient funds.
   * @throws {ProviderError} If the deposit action is malformed, or the bitcoin client fails.
   */
  async _prepareDeposit ({ action, route, fromTokenAmount, options }) {
    if (typeof action.to_address !== 'string' || action.to_address.length === 0) {
      throw new ProviderError('Layerswap deposit action for Bitcoin is missing to_address; the deposit transaction cannot be built.', {
        reason: ProviderErrorReason.INTERNAL_SERVER_ERROR
      })
    }

    await this._assertDepositAddress(action.to_address)

    // Like the Layerswap web app, the deposit amount comes from the decimal `amount` of the
    // action: Layerswap reports `amount_in_base_units` as 0 for Bitcoin.
    return this._buildSignedPsbt({
      depositAddress: action.to_address,
      amount: this._parseDepositAmount(action.amount, fromTokenAmount, route.sourceToken.decimals),
      memo: this._encodeCallDataMemo(action.call_data),
      feeRateOverride: /** @type {LayerswapBitcoinSwidgeOptions} */ (options).feeRate
    })
  }

  /**
   * Broadcasts the signed deposit transaction through the account's bitcoin client.
   *
   * @protected
   * @param {LayerswapBitcoinSignedPsbt} deposit - The prepared deposit.
   * @returns {Promise<LayerswapBroadcastDeposit>} The broadcast deposit.
   * @throws {ProviderError} If the bitcoin client fails to broadcast the deposit.
   */
  async _sendDeposit ({ txHex, txid }) {
    await this._callWallet(() => this._account._client.broadcast(txHex))
    return { hash: txid }
  }

  /**
   * Maps the legacy bridge options onto the swidge options, forwarding the fee rate.
   *
   * @protected
   * @param {LayerswapBitcoinBridgeOptions} options - The bridge options.
   * @returns {LayerswapBitcoinSwidgeOptions} The swidge options.
   */
  _toSwidgeOptions (options) {
    return {
      ...super._toSwidgeOptions(options),
      ...(options.feeRate !== undefined && { feeRate: options.feeRate })
    }
  }

  /**
   * Checks that the Layerswap deposit address is a valid address on the account's network.
   *
   * @private
   * @param {string} depositAddress - The Layerswap deposit address.
   * @returns {Promise<void>}
   * @throws {ProviderError} If Layerswap returned a malformed address, or one of another network.
   */
  async _assertDepositAddress (depositAddress) {
    try {
      await this._getOutputScriptHex(depositAddress, this._account._network)
    } catch (error) {
      throw new ProviderError(`Layerswap returned a malformed Bitcoin deposit address '${depositAddress}'.`, {
        reason: ProviderErrorReason.INTERNAL_SERVER_ERROR,
        cause: error
      })
    }
  }

  /**
   * Encodes Layerswap's numeric `call_data` reference into the UTF-8-of-hex form the
   * Layerswap web app uses for OP_RETURN. Throws if the payload would exceed the
   * standard 80-byte OP_RETURN limit.
   *
   * @private
   * @param {string | null | undefined} callData
   * @returns {Buffer}
   * @throws {ProviderError} If Layerswap's call_data is missing, malformed, or too large for an OP_RETURN output.
   */
  _encodeCallDataMemo (callData) {
    if (callData === null || callData === undefined || callData === '') {
      throw new ProviderError('Layerswap deposit action for Bitcoin is missing call_data; the deposit cannot be matched to the swap without its OP_RETURN reference.', {
        reason: ProviderErrorReason.INTERNAL_SERVER_ERROR
      })
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
      throw new ProviderError(`Layerswap call_data for Bitcoin must start with a numeric sequence (got '${callData}'); the web app encodes it via BigInt(seq).toString(16).`, {
        reason: ProviderErrorReason.INTERNAL_SERVER_ERROR
      })
    }

    const bytes = Buffer.from(seqHex + tail, 'utf8')

    if (bytes.length > OP_RETURN_MAX_BYTES) {
      throw new ProviderError(`Encoded OP_RETURN memo is ${bytes.length} bytes; exceeds the ${OP_RETURN_MAX_BYTES}-byte standardness limit.`, {
        reason: ProviderErrorReason.INTERNAL_SERVER_ERROR
      })
    }

    return bytes
  }

  /**
   * Builds, signs, and finalises a PSBT that spends UTXOs from the account address to the
   * Layerswap deposit address, with an OP_RETURN memo carrying the swap reference.
   *
   * @private
   * @param {LayerswapBitcoinPsbtParams} params
   * @returns {Promise<LayerswapBitcoinSignedPsbt>}
   * @throws {ValueError} If the amount is not above the dust limit.
   * @throws {SwidgeError} If the account has insufficient funds.
   * @throws {ProviderError} If the bitcoin client fails.
   */
  async _buildSignedPsbt ({ depositAddress, amount, memo, feeRateOverride }) {
    const account = this._account

    await this._callWallet(() => account._ensureConnected())

    const fromAddress = await this._callWallet(() => account.getAddress())
    const network = account._network

    let feeRate
    if (feeRateOverride !== undefined && feeRateOverride !== null) {
      feeRate = account._toBigInt(feeRateOverride)
    } else {
      const confirmationTarget = this._confirmationTarget
      const feeEstimate = await this._callWallet(() => account._client.estimateFee(confirmationTarget))
      feeRate = account._toBigInt(Math.max(feeEstimate * 100_000, 1))
    }
    if (feeRate < 1n) feeRate = 1n

    const dustLimit = account._dustLimit
    if (amount <= dustLimit) {
      throw new ValueError(`The amount must be bigger than the dust limit (= ${dustLimit}).`)
    }

    const unspent = await this._callWallet(() => account._client.listUnspent(fromAddress))
    if (!unspent || unspent.length === 0) {
      throw new SwidgeError('No unspent outputs available.', { reason: SwidgeErrorReason.INSUFFICIENT_BALANCE })
    }

    const fromOutput = new Output({ descriptor: `addr(${fromAddress})`, network })
    const toOutput = new Output({ descriptor: `addr(${depositAddress})`, network })

    const opReturnScript = bscript.compile([opcodes.OP_RETURN, memo])

    const utxosForCoinSelect = unspent.map((u) => ({
      output: fromOutput,
      value: account._toBigInt(u.value),
      __ref: u
    }))

    // `@bitcoinerlab/coinselect` validates each target against the dust threshold, which
    // rejects OP_RETURN (`value: 0`). We therefore coin-select against just the deposit
    // target, then manually surface OP_RETURN's contribution to the fee.
    const result = coinselect({
      utxos: utxosForCoinSelect,
      remainder: fromOutput,
      targets: [
        { output: toOutput, value: amount }
      ],
      feeRate: Number(feeRate)
    })

    if (!result) {
      throw new SwidgeError('Insufficient balance to send the transaction.', { reason: SwidgeErrorReason.INSUFFICIENT_BALANCE })
    }

    // OP_RETURN output bytes: 8 (value, little-endian) + 1 (script-length varint, scripts
    // ≤ 252 bytes use one byte) + scriptLen. OP_RETURN sits outside the witness, so each
    // byte costs `feeRate` sats directly.
    const opReturnExtraBytes = BigInt(8 + 1 + opReturnScript.length)
    const opReturnExtraFee = opReturnExtraBytes * feeRate

    const selectedUtxos = result.utxos.map(({ __ref }) => __ref)
    const total = selectedUtxos.reduce((s, u) => s + account._toBigInt(u.value), 0n)
    const baseFee = result.fee ?? 0n
    let fee = baseFee + opReturnExtraFee
    let changeValue = total - fee - amount

    if (changeValue < 0n) {
      throw new SwidgeError('Insufficient balance after fees (OP_RETURN overhead).', { reason: SwidgeErrorReason.INSUFFICIENT_BALANCE })
    }
    if (changeValue <= dustLimit) {
      fee = fee + changeValue
      changeValue = 0n
    }
    const actualFee = fee

    const psbt = new Psbt({ network })

    const fromAddressScriptHex = Buffer.from(
      await this._getOutputScriptHex(fromAddress, network)
    ).toString('hex')

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
            value: account._toBigInt(utxo.value)
          }
        })
      } else {
        const prevHex = await this._callWallet(() => account._client.getTransaction(utxo.tx_hash))
        psbt.addInput({
          ...baseInput,
          nonWitnessUtxo: Buffer.from(prevHex, 'hex')
        })
      }
    }

    psbt.addOutput({ address: depositAddress, value: amount })
    psbt.addOutput({ script: opReturnScript, value: 0n })
    if (changeValue > 0n) {
      psbt.addOutput({ address: fromAddress, value: changeValue })
    }

    selectedUtxos.forEach((_, index) => psbt.signInputHD(index, masterNode))
    psbt.finalizeAllInputs()

    const tx = psbt.extractTransaction()

    return { txHex: tx.toHex(), txid: tx.getId(), fee: actualFee }
  }

  /**
   * Wraps the wallet's BIP-32 master node so every byte field crossing into
   * bitcoinjs-lib is a Buffer. bip32 v5 returns Uint8Arrays for keys,
   * fingerprints, and signatures, which bitcoinjs-lib expects as Buffers for
   * `publicKey.equals` and partialSig serialisation.
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
}
