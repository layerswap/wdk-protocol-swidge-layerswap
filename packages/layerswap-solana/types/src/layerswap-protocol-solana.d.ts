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
    constructor(account: WalletAccountReadOnlySolana, config?: LayerswapProtocolConfig);
    /**
     * @overload
     * @param {WalletAccountSolana} account - The wallet account to use to interact with the protocol.
     * @param {LayerswapProtocolConfig} [config] - The layerswap protocol configuration.
     */
    constructor(account: WalletAccountSolana, config?: LayerswapProtocolConfig);
    /**
     * @private
     * @type {LayerswapApiClient}
     */
    private _client;
    /**
     * @private
     * @type {Connection | undefined}
     */
    private _connection;
    /**
     * @private
     * @type {string | undefined}
     */
    private _sourceNetworkName;
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
    bridge(options: BridgeOptions, config?: Pick<LayerswapProtocolConfig, "bridgeMaxFee">): Promise<LayerswapBridgeResult>;
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
    quoteBridge(options: BridgeOptions): Promise<Omit<BridgeResult, "hash">>;
    /**
     * Returns the underlying API client. Useful for polling swap status after `bridge()`.
     *
     * @returns {LayerswapApiClient}
     */
    getApiClient(): LayerswapApiClient;
    /**
     * @private
     * @param {BridgeOptions} options
     * @returns {Promise<{ transaction: Transaction, bridgeFee: bigint, swapId: string }>}
     */
    private _buildDepositTransaction;
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
     * Decodes Layerswap's `call_data` (base64 of a legacy Solana `Transaction` wire format)
     * into a `Transaction` instance ready for signing + broadcast. Mirrors the Layerswap web
     * app's `SVMWalletWithdraw` code path.
     *
     * @private
     * @param {string} callData
     * @returns {Transaction}
     */
    private _decodeDepositTransaction;
    /**
     * Builds a `Keypair` from the wallet account's raw 32-byte private + public key bytes.
     * `@solana/web3.js` expects a 64-byte secret key (32 private || 32 public, nacl convention).
     *
     * @private
     * @returns {Keypair}
     */
    private _buildKeypair;
    /**
     * Estimates the on-chain fee for a deserialised Layerswap deposit transaction by asking
     * the connected RPC. Mirrors the Layerswap web app's `transaction.getEstimatedFee(connection)`
     * call.
     *
     * @private
     * @param {Transaction} transaction
     * @returns {Promise<bigint>} The fee in lamports.
     */
    private _estimateSignedTransactionFee;
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
    private _isWritableAccount;
    /**
     * Detects the source Solana network by genesis hash. Cached for the lifetime of the
     * protocol instance.
     *
     * @private
     * @returns {Promise<string>} The Layerswap network name (e.g. 'SOLANA_MAINNET').
     */
    private _detectSourceNetworkName;
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
export type WalletAccountSolana = import("@tetherto/wdk-wallet-solana").WalletAccountSolana;
export type WalletAccountReadOnlySolana = import("@tetherto/wdk-wallet-solana").WalletAccountReadOnlySolana;
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
     *    *source-token base units*. Compared against `bridgeFee`
     *    before broadcasting the deposit transaction.
     */
    bridgeMaxFee?: number | bigint;
    /**
     * - HTTP timeout for Layerswap API calls. Default: 30000.
     */
    requestTimeoutMs?: number;
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
     * - Source token: SPL mint base58 address OR Layerswap symbol
     *   (e.g. `'SOL'`, `'USDC'`).
     */
    token: string;
    /**
     * - Source amount in base units (lamports for SOL, smallest unit
     *   for SPL tokens).
     */
    amount: number | bigint;
    /**
     * - Destination token (address or symbol). Defaults to the
     *         source token's symbol.
     */
    destinationToken?: string;
    /**
     * - Override auto-detected source network name. Auto-detection
     *              uses `Connection.getGenesisHash()` against a table of
     *              known Solana cluster hashes.
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
};
export type LayerswapBridgeResult = BridgeResult & {
    swapId: string;
};
import { BridgeProtocol } from '@tetherto/wdk-wallet/protocols';
import LayerswapApiClient from '@layerswap/wdk-protocol-bridge-layerswap-core';
