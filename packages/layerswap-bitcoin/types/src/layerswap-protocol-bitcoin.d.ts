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
    constructor(account: WalletAccountReadOnlyBtc, config?: LayerswapProtocolConfig);
    /**
     * @overload
     * @param {WalletAccountBtc} account - The wallet account to use to interact with the protocol.
     * @param {LayerswapProtocolConfig} [config] - The layerswap protocol configuration.
     */
    constructor(account: WalletAccountBtc, config?: LayerswapProtocolConfig);
    /**
     * @private
     * @type {LayerswapApiClient}
     */
    private _client;
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
    bridge(options: BridgeOptions, config?: Pick<LayerswapProtocolConfig, "bridgeMaxFee">): Promise<LayerswapBridgeResult>;
    /**
     * Quotes the costs of a Layerswap bridge operation without creating a swap.
     *
     * The reported `fee` is an approximation (`BTC_FEE_APPROX_SATS` = 1500 sats).
     * The bridge-time `fee` is the actual PSBT fee from coinselect.
     *
     * @param {BridgeOptions} options - The bridge's options.
     * @returns {Promise<Omit<BridgeResult, 'hash'>>} The bridge's quotes.
     */
    quoteBridge(options: BridgeOptions): Promise<Omit<BridgeResult, "hash">>;
    /**
     * Returns the underlying API client. Useful for polling swap status after `bridge()`.
     *
     * @returns {LayerswapApiClient}
     */
    getApiClient(): LayerswapApiClient;
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
    getTransactionStatus(txid: string, options?: {
        sourceChain?: string;
    }): Promise<import("@layerswap/wdk-protocol-bridge-layerswap-core").LayerswapTransactionStatus>;
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
    private _createDepositSwap;
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
    private _resolveRoute;
    /**
     * Picks the wallet-flow deposit action (`type: 'transfer'`). Layerswap may return
     * additional `manual_transfer` actions; those are ignored here. Throws if no
     * wallet-driven action is present so the caller gets a clear error.
     *
     * @private
     * @param {LayerswapDepositAction[]} depositActions
     * @returns {LayerswapDepositAction}
     */
    private _pickWalletDepositAction;
    /**
     * Maps the wallet account's `config.network` (`bitcoin`/`testnet`/`regtest`) to the
     * Layerswap network name. Defaults to `BITCOIN_MAINNET` if the wallet config is
     * unset or unfamiliar.
     *
     * @private
     * @returns {string}
     */
    private _detectSourceNetworkName;
    /**
     * Encodes Layerswap's numeric `call_data` reference into the UTF-8-of-hex form the
     * Layerswap web app uses for OP_RETURN. Throws if the payload would exceed the
     * standard 80-byte OP_RETURN limit.
     *
     * @private
     * @param {string | null | undefined} callData
     * @returns {Buffer}
     */
    private _encodeCallDataMemo;
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
    private _buildSignedPsbt;
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
    private _isWritableAccount;
    /**
     * Returns the output script for the given address, lazily importing `bitcoinjs-lib`
     * `address.toOutputScript`.
     *
     * @private
     * @param {string} addressStr
     * @param {*} network
     * @returns {Promise<Buffer>}
     */
    private _getOutputScriptHex;
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
    private _notifyDepositBroadcast;
}
export type BridgeProtocolConfig = import("@tetherto/wdk-wallet/protocols").BridgeProtocolConfig;
export type BridgeResult = import("@tetherto/wdk-wallet/protocols").BridgeResult;
export type WalletAccountBtc = import("@tetherto/wdk-wallet-btc").WalletAccountBtc;
export type WalletAccountReadOnlyBtc = import("@tetherto/wdk-wallet-btc").WalletAccountReadOnlyBtc;
export type LayerswapNetwork = import("@layerswap/wdk-protocol-bridge-layerswap-core").LayerswapNetwork;
export type LayerswapToken = import("@layerswap/wdk-protocol-bridge-layerswap-core").LayerswapToken;
export type LayerswapDepositAction = import("@layerswap/wdk-protocol-bridge-layerswap-core").LayerswapDepositAction;
export type LayerswapProtocolConfig = {
    /**
     * - Optional Layerswap API key. When set, sent as the
     *                   `X-LS-APIKEY` header for rate-limit / partner attribution.
     */
    apiKey?: string;
    /**
     * - Layerswap API base URL. Default: `https://api.layerswap.io`.
     */
    apiUrl?: string;
    /**
     * - Maximum acceptable Layerswap swap fee, expressed in
     *    *source-token base units* (satoshis). Compared against
     *    `bridgeFee` before broadcasting the deposit transaction.
     */
    bridgeMaxFee?: number | bigint;
    /**
     * - HTTP timeout for Layerswap API calls. Default: 30000.
     */
    requestTimeoutMs?: number;
    /**
     * - Target confirmation block count for fee estimation.
     *       Default: 1.
     */
    confirmationTarget?: number;
};
export type BridgeOptions = {
    /**
     * - Layerswap destination network name (e.g. `'ARBITRUM_MAINNET'`).
     */
    targetChain: string;
    /**
     * - Destination-chain recipient address, in its native format.
     */
    recipient: string;
    /**
     * - Source token. Only native BTC is supported; pass `'BTC'`
     *   or omit and let it default to the native symbol.
     */
    token: string;
    /**
     * - Source amount in satoshis.
     */
    amount: number | bigint;
    /**
     * - Destination token (address or symbol). Defaults to BTC's
     *         symbol.
     */
    destinationToken?: string;
    /**
     * - Override the auto-detected source network name. Auto-detection
     *              maps `account._config.network` (`bitcoin`/`testnet`/`regtest`)
     *              to `BITCOIN_MAINNET`/`BITCOIN_TESTNET`/`BITCOIN_REGTEST`.
     */
    sourceChain?: string;
    /**
     * - Request a native-gas drop on the destination chain.
     */
    refuel?: boolean;
    /**
     * - Slippage tolerance percentage, e.g. `'0.5'`.
     */
    slippage?: string;
    /**
     * - External reference id for the created swap.
     */
    referenceId?: string;
    /**
     * - Refund address used if the swap fails after deposit.
     */
    refundAddress?: string;
    /**
     * - Override the fee rate (sat/vB) used for PSBT construction.
     */
    feeRate?: number | bigint;
};
export type LayerswapBridgeResult = BridgeResult & {
    swapId: string;
};
import { BridgeProtocol } from '@tetherto/wdk-wallet/protocols';
import LayerswapApiClient from '@layerswap/wdk-protocol-bridge-layerswap-core';
