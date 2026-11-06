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
export default class LayerswapProtocolBitcoin extends LayerswapSwidgeProtocol<LayerswapBitcoinSwidgeOptions, import("@layerswap/wdk-protocol-swidge-layerswap-core/types/src/layerswap-swidge-protocol.js").LayerswapSwidgeConfig, LayerswapBitcoinBridgeOptions, import("@layerswap/wdk-protocol-swidge-layerswap-core/types/src/layerswap-swidge-protocol.js").LayerswapBridgeConfig> {
    /**
     * Creates a new swidge protocol for chain/token discovery only, without a wallet account.
     *
     * @overload
     * @param {undefined} [account] - No account; only discovery and `fromChain`-scoped quotes work.
     * @param {LayerswapBitcoinProtocolConfig} [config] - The layerswap protocol configuration.
     */
    constructor(account?: undefined, config?: LayerswapBitcoinProtocolConfig);
    /**
     * Creates a new read-only interface to the layerswap protocol for bitcoin.
     *
     * @overload
     * @param {WalletAccountReadOnlyBtc} account - The wallet account to use to interact with the protocol.
     * @param {LayerswapBitcoinProtocolConfig} [config] - The layerswap protocol configuration.
     */
    constructor(account: WalletAccountReadOnlyBtc, config?: LayerswapBitcoinProtocolConfig);
    /**
     * Creates a new interface to the layerswap protocol for bitcoin.
     *
     * @overload
     * @param {WalletAccountBtc} account - The wallet account to use to interact with the protocol.
     * @param {LayerswapBitcoinProtocolConfig} [config] - The layerswap protocol configuration.
     */
    constructor(account: WalletAccountBtc, config?: LayerswapBitcoinProtocolConfig);
    /**
     * Target confirmation block count for fee estimation.
     *
     * @private
     * @type {number}
     */
    private _confirmationTarget;
    /**
     * Builds and signs the deposit transaction (deposit output + `OP_RETURN` memo).
     *
     * @protected
     * @param {LayerswapDepositContext} context - The deposit context.
     * @returns {Promise<LayerswapBitcoinSignedPsbt>} The prepared deposit.
     * @throws {ValueError} If the deposit action is malformed, or its amount is not above the dust limit.
     * @throws {SwidgeError} If the account has insufficient funds.
     * @throws {ProviderError} If the bitcoin client fails.
     */
    protected _prepareDeposit({ action, route, fromTokenAmount, options }: LayerswapDepositContext): Promise<LayerswapBitcoinSignedPsbt>;
    /**
     * Broadcasts the signed deposit transaction through the account's bitcoin client.
     *
     * @protected
     * @param {LayerswapBitcoinSignedPsbt} deposit - The prepared deposit.
     * @returns {Promise<LayerswapBroadcastDeposit>} The broadcast deposit.
     * @throws {ProviderError} If the bitcoin client fails to broadcast the deposit.
     */
    protected _sendDeposit({ txHex, txid }: LayerswapBitcoinSignedPsbt): Promise<LayerswapBroadcastDeposit>;
    /**
     * Checks that the Layerswap deposit address is a valid address on the account's network.
     *
     * @private
     * @param {string} depositAddress - The Layerswap deposit address.
     * @returns {Promise<void>}
     * @throws {ValueError} If the address is malformed, or one of another network.
     */
    private _assertDepositAddress;
    /**
     * Encodes Layerswap's numeric `call_data` reference into the UTF-8-of-hex form the
     * Layerswap web app uses for OP_RETURN. Throws if the payload would exceed the
     * standard 80-byte OP_RETURN limit.
     *
     * @private
     * @param {string | null | undefined} callData
     * @returns {Buffer}
     * @throws {ValueError} If the call_data is missing, malformed, or too large for an OP_RETURN output.
     */
    private _encodeCallDataMemo;
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
    private _buildSignedPsbt;
    /**
     * Wraps the wallet's BIP-32 master node so every byte field crossing into
     * bitcoinjs-lib is a Buffer. bip32 v5 returns Uint8Arrays for keys,
     * fingerprints, and signatures, which bitcoinjs-lib expects as Buffers for
     * `publicKey.equals` and partialSig serialisation.
     *
     * @private
     * @param {HDSigner} node - An HDSigner-compatible BIP-32 node.
     * @returns {HDSigner} An HDSigner whose publicKey/fingerprint/sign() return Buffers.
     */
    private _toBufferHdSigner;
    /**
     * Returns the output script for the given address, lazily importing `bitcoinjs-lib`
     * `address.toOutputScript`.
     *
     * @private
     * @param {string} addressStr
     * @param {BitcoinNetwork} network
     * @returns {Promise<Buffer>}
     */
    private _getOutputScriptHex;
}
export type IWalletAccountReadOnly = import("@tetherto/wdk-wallet").IWalletAccountReadOnly;
export type WalletAccountBtc = import("@tetherto/wdk-wallet-btc").WalletAccountBtc;
export type WalletAccountReadOnlyBtc = import("@tetherto/wdk-wallet-btc").WalletAccountReadOnlyBtc;
export type HDSigner = import("bitcoinjs-lib").HDSigner;
export type BitcoinNetwork = import("bitcoinjs-lib").Network;
export type LayerswapNetwork = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapNetwork;
export type LayerswapProtocolConfig = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapProtocolConfig;
export type LayerswapSwidgeOptions = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapSwidgeOptions;
export type LayerswapSwidgeConfig = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapSwidgeConfig;
export type LayerswapBridgeOptions = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapBridgeOptions;
export type LayerswapSwidgeRoute = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapSwidgeRoute;
export type LayerswapDepositContext = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapDepositContext;
export type LayerswapBroadcastDeposit = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapBroadcastDeposit;
/**
 * The layerswap protocol configuration, plus the Bitcoin-specific options.
 */
export type LayerswapBitcoinProtocolConfig = LayerswapProtocolConfig & LayerswapSpecificBitcoinProtocolConfig;
export type LayerswapSpecificBitcoinProtocolConfig = {
    /**
     * - Target confirmation block count for fee estimation. Default: 1.
     */
    confirmationTarget?: number;
};
export type LayerswapSpecificBitcoinOptions = {
    /**
     * - Override the fee rate (sat/vB) used for PSBT construction.
     */
    feeRate?: number | bigint;
};
/**
 * The layerswap swidge options, plus the Bitcoin-specific options.
 */
export type LayerswapBitcoinSwidgeOptions = LayerswapSwidgeOptions & LayerswapSpecificBitcoinOptions;
/**
 * The layerswap bridge options, plus the Bitcoin-specific options.
 */
export type LayerswapBitcoinBridgeOptions = LayerswapBridgeOptions & LayerswapSpecificBitcoinOptions;
export type LayerswapBitcoinPsbtParams = {
    /**
     * - The Layerswap deposit address.
     */
    depositAddress: string;
    /**
     * - The amount to deposit (in satoshis).
     */
    amount: bigint;
    /**
     * - The OP_RETURN payload carrying the swap reference.
     */
    memo: Buffer;
    /**
     * - The fee rate (sat/vB) to use instead of the estimate.
     */
    feeRateOverride?: number | bigint;
};
export type LayerswapBitcoinSignedPsbt = {
    /**
     * - The signed, finalized transaction (hex).
     */
    txHex: string;
    /**
     * - The transaction id.
     */
    txid: string;
    /**
     * - The transaction fee (in satoshis).
     */
    fee: bigint;
};
import { LayerswapSwidgeProtocol } from '@layerswap/wdk-protocol-swidge-layerswap-core';
