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
import { Psbt, opcodes, script as bscript } from 'bitcoinjs-lib'
import { coinselect } from '@bitcoinerlab/coinselect'
import { DescriptorsFactory } from '@bitcoinerlab/descriptors'
import * as ecc from '@bitcoinerlab/secp256k1'

import LayerswapApiClient, {
  resolveNetworkByName,
  resolveToken,
  formatBaseUnits,
  parseDecimal
} from '@layerswap/wdk-protocol-bridge-layerswap-core'

/** @typedef {import('@tetherto/wdk-wallet/protocols').BridgeProtocolConfig} BridgeProtocolConfig */
/** @typedef {import('@tetherto/wdk-wallet/protocols').BridgeResult} BridgeResult */

/** @typedef {import('@tetherto/wdk-wallet-btc').WalletAccountBtc} WalletAccountBtc */
/** @typedef {import('@tetherto/wdk-wallet-btc').WalletAccountReadOnlyBtc} WalletAccountReadOnlyBtc */

/** @typedef {import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapNetwork} LayerswapNetwork */
/** @typedef {import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapToken} LayerswapToken */
/** @typedef {import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapDepositAction} LayerswapDepositAction */

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

// Quote-time fee approximation. Bridge-time fee is read from the built PSBT.
// 10 sat/vB × ~150 vB (1 input + 2 outputs P2WPKH + OP_RETURN) ≈ 1500 sats.
const BTC_FEE_APPROX_SATS = 1500n

const { Output } = DescriptorsFactory(ecc)

/**
 * @typedef {Object} LayerswapProtocolConfig
 * @property {string} [apiKey]                - Optional Layerswap API key. When set, sent as the
 *                                              `X-LS-APIKEY` header for rate-limit / partner attribution.
 * @property {string} [apiUrl]                - Layerswap API base URL. Default: `https://api.layerswap.io`.
 * @property {number | bigint} [bridgeMaxFee] - Maximum acceptable Layerswap swap fee, expressed in
 *                                              *source-token base units* (satoshis). Compared against
 *                                              `bridgeFee` before broadcasting the deposit transaction.
 * @property {number} [requestTimeoutMs]      - HTTP timeout for Layerswap API calls. Default: 30000.
 * @property {number} [confirmationTarget]    - Target confirmation block count for fee estimation.
 *                                              Default: 1.
 */

/**
 * @typedef {Object} BridgeOptions
 * @property {string} targetChain             - Layerswap destination network name (e.g. `'ARBITRUM_MAINNET'`).
 * @property {string} recipient               - Destination-chain recipient address, in its native format.
 * @property {string} token                   - Source token. Only native BTC is supported; pass `'BTC'`
 *                                              or omit and let it default to the native symbol.
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
 * Bridge protocol that drives a Layerswap swap from a Bitcoin wallet account.
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
 * Semantic note: `BridgeResult.bridgeFee` is documented in `@tetherto/wdk-wallet` as
 * "native tokens paid to the bridge protocol". Layerswap deducts its fee from the
 * source-token amount instead, so we return `bridgeFee` in **source-token base units**
 * (satoshis). The `bridgeMaxFee` config compares against `bridgeFee` only.
 *
 * Implementation note: the wallet's high-level `sendTransaction` does not expose an
 * `OP_RETURN` seam, so we replicate the wallet's PSBT build with one extra output. The
 * protocol reaches into a handful of protected wallet members (`_client`, `_masterNode`,
 * `_account`, `_network`, `_dustLimit`, `_path`, `_bip`, `_ensureConnected`, `_toBigInt`).
 * If the wallet version changes the layout of these members, this package will need a
 * matching update.
 */
export default class LayerswapProtocolBitcoin extends BridgeProtocol {
  /**
   * @overload
   * @param {WalletAccountReadOnlyBtc} account - The wallet account to use to interact with the protocol.
   * @param {LayerswapProtocolConfig} [config] - The layerswap protocol configuration.
   */

  /**
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
   * Bridges BTC to a different blockchain via Layerswap.
   *
   * Resolves once the source-chain deposit transaction has been broadcast. Layerswap finishes
   * the destination-chain payout asynchronously; callers can use `getApiClient().getSwap(swapId)`
   * to track destination delivery.
   *
   * Semantic note: `bridgeFee` is in **source-token base units** (satoshis), not native gas.
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

    const { action, sourceToken, bridgeFee, swapId } = await this._createDepositSwap(options)

    if (sourceToken.contract) {
      throw new Error(`Layerswap Bitcoin source token must be native BTC, got '${sourceToken.symbol}' with contract '${sourceToken.contract}'. Tokens (BRC-20, Runes, etc.) are not supported.`)
    }

    const bridgeMaxFee = config?.bridgeMaxFee ?? this._config.bridgeMaxFee
    if (bridgeMaxFee !== undefined && bridgeFee >= BigInt(bridgeMaxFee)) {
      throw new Error('Exceeded maximum fee cost for bridge operation.')
    }

    const memo = this._encodeCallDataMemo(action.call_data)

    const { txHex, txid, fee } = await this._buildSignedPsbt({
      depositAddress: action.to_address,
      amount: BigInt(options.amount),
      memo,
      feeRateOverride: options.feeRate
    })

    await this._account._client.broadcast(txHex)

    await this._notifyDepositBroadcast(swapId, txid)

    return { hash: txid, fee, bridgeFee, swapId }
  }

  /**
   * Quotes the costs of a Layerswap bridge operation without creating a swap.
   *
   * The reported `fee` is an approximation (`BTC_FEE_APPROX_SATS` = 1500 sats).
   * The bridge-time `fee` is the actual PSBT fee from coinselect.
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
    return { fee: BTC_FEE_APPROX_SATS, bridgeFee }
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
   * follow-up after `bridge()` returns — `broadcast()` returns once the tx is accepted
   * into the mempool, but a transaction can still drop or be replaced before confirmation.
   * Returns `'completed' | 'failed' | 'pending'`.
   *
   * The source network defaults to whatever `account._config.network` maps to (mainnet
   * by default); pass `options.sourceChain` to override.
   *
   * @param {string} txid - The Bitcoin txid returned by `bridge()`.
   * @param {{ sourceChain?: string }} [options]
   * @returns {Promise<import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapTransactionStatus>}
   */
  async getTransactionStatus (txid, options = {}) {
    const networkName = options.sourceChain ?? this._detectSourceNetworkName()
    return this._client.getTransactionStatus(networkName, txid)
  }

  /**
   * Calls `POST /api/v2/swaps` for the resolved route and extracts the wallet-driven
   * deposit action.
   *
   * @private
   * @param {BridgeOptions} options
   * @returns {Promise<{
   *   action: LayerswapDepositAction,
   *   sourceToken: LayerswapToken,
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
      throw new Error('Layerswap deposit action for Bitcoin is missing to_address; the deposit transaction cannot be built.')
    }

    const totalFeeDecimal = response.quote?.quote?.total_fee
    const bridgeFee = totalFeeDecimal !== undefined && totalFeeDecimal !== null
      ? parseDecimal(totalFeeDecimal, sourceToken.decimals)
      : 0n

    return { action, sourceToken, bridgeFee, swapId: swap.id }
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
    const sourceName = options.sourceChain ?? this._detectSourceNetworkName()
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
   * Maps the wallet account's `config.network` (`bitcoin`/`testnet`/`regtest`) to the
   * Layerswap network name. Defaults to `BITCOIN_MAINNET` if the wallet config is
   * unset or unfamiliar.
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

    const asNumber = Number(callData)
    if (!Number.isFinite(asNumber)) {
      throw new Error(`Layerswap call_data for Bitcoin must be a finite number (got '${callData}'); the web app encodes it via Number(callData).toString(16).`)
    }

    const hex = asNumber.toString(16)
    const bytes = Buffer.from(hex, 'utf8') // matches the Layerswap web app: hex string stored as UTF-8 bytes

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

    for (const utxo of selectedUtxos) {
      const baseInput = {
        hash: utxo.tx_hash,
        index: utxo.tx_pos,
        bip32Derivation: [{
          masterFingerprint: account._masterNode.fingerprint,
          path: account._path,
          pubkey: account._account.publicKey
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

    selectedUtxos.forEach((_, index) => psbt.signInputHD(index, account._masterNode))
    psbt.finalizeAllInputs()

    const tx = psbt.extractTransaction()

    return { txHex: tx.toHex(), txid: tx.getId(), fee: actualFee }
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
