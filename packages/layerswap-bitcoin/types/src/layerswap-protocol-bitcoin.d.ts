import { SwidgeProtocol } from '@tetherto/wdk-wallet/protocols';
import LayerswapApiClient from '@layerswap/wdk-protocol-swidge-layerswap-core';
export type SwidgeProtocolConfig = import('@tetherto/wdk-wallet/protocols').SwidgeProtocolConfig;
export type SwidgeOptions = import('@tetherto/wdk-wallet/protocols').SwidgeOptions;
export type SwidgeQuote = import('@tetherto/wdk-wallet/protocols').SwidgeQuote;
export type SwidgeResult = import('@tetherto/wdk-wallet/protocols').SwidgeResult;
export type SwidgeFee = import('@tetherto/wdk-wallet/protocols').SwidgeFee;
export type SwidgeStatusOptions = import('@tetherto/wdk-wallet/protocols').SwidgeStatusOptions;
export type SwidgeStatusResult = import('@tetherto/wdk-wallet/protocols').SwidgeStatusResult;
export type SwidgeSupportedChain = import('@tetherto/wdk-wallet/protocols').SwidgeSupportedChain;
export type SwidgeSupportedToken = import('@tetherto/wdk-wallet/protocols').SwidgeSupportedToken;
export type SwidgeSupportedTokensOptions = import('@tetherto/wdk-wallet/protocols').SwidgeSupportedTokensOptions;
export type BridgeResult = import('@tetherto/wdk-wallet/protocols').BridgeResult;
export type WalletAccountBtc = import('@tetherto/wdk-wallet-btc').WalletAccountBtc;
export type WalletAccountReadOnlyBtc = import('@tetherto/wdk-wallet-btc').WalletAccountReadOnlyBtc;
export type LayerswapNetwork = import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapNetwork;
export type LayerswapToken = import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapToken;
export type LayerswapDepositAction = import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapDepositAction;
export type LayerswapSwap = import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSwap;
export type LayerswapQuote = import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapQuote;
export type LayerswapProtocolConfig = SwidgeProtocolConfig & Object;
export type LayerswapSwidgeOptions = SwidgeOptions & Object;
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
     * - Source token. Only native BTC is supported; pass `'BTC'`.
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
 *                                              *source-token base units* (satoshis). Compared against the
 *                                              total Layerswap fee before broadcasting the deposit transaction.
 * @property {number} [requestTimeoutMs]      - HTTP timeout for Layerswap API calls. Default: 30000.
 * @property {number} [confirmationTarget]    - Target confirmation block count for fee estimation.
 *                                              Default: 1.
 */
/**
 * Layerswap-specific extensions to the WDK swidge options.
 *
 * @typedef {SwidgeOptions & Object} LayerswapSwidgeOptions
 * @property {string | number} [fromChain]    - Layerswap source network name (e.g. `'BITCOIN_MAINNET'`).
 *                                              Defaults to the mapping of the account's `config.network`
 *                                              (`bitcoin`/`testnet`/`regtest`).
 * @property {boolean} [refuel]               - Request a native-gas drop on the destination chain.
 * @property {string} [referenceId]           - External reference id for the created swap.
 * @property {number | bigint} [feeRate]      - Override the fee rate (sat/vB) used for PSBT construction.
 */
/**
 * @typedef {Object} BridgeOptions
 * @property {string} targetChain             - Layerswap destination network name (e.g. `'ARBITRUM_MAINNET'`).
 * @property {string} recipient               - Destination-chain recipient address, in its native format.
 * @property {string} token                   - Source token. Only native BTC is supported; pass `'BTC'`.
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
 * WDK swidge protocol that drives a Layerswap swap from a Bitcoin wallet account.
 *
 * Implements the `SwidgeProtocol` interface from `@tetherto/wdk-wallet/protocols`:
 * `quoteSwidge` / `swidge` / `getSwidgeStatus` / `getSupportedChains` / `getSupportedTokens`,
 * which also provides the WDK `swap`/`bridge` module surfaces via the base class.
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
 * `swidge()` resolves once the source-chain deposit transaction has been broadcast; the
 * destination payout completes asynchronously and can be tracked with
 * `getSwidgeStatus(result.id)`.
 *
 * Fee semantics: Layerswap deducts its fees from the source-token amount, so 'protocol'
 * and Layerswap's destination 'network' fee entries are denominated in the **source
 * token** (satoshis) and flagged `included: true`. The source-chain PSBT fee is a
 * separate non-included 'network' fee in **satoshis** of the native token. Do not sum
 * amounts across fee entries with different `token` values.
 *
 * Implementation note: the wallet's high-level `sendTransaction` does not expose an
 * `OP_RETURN` seam, so we replicate the wallet's PSBT build with one extra output. The
 * protocol reaches into a handful of protected wallet members (`_client`, `_masterNode`,
 * `_account`, `_network`, `_dustLimit`, `_path`, `_bip`, `_ensureConnected`, `_toBigInt`).
 * If the wallet version changes the layout of these members, this package will need a
 * matching update.
 */
export default class LayerswapProtocolBitcoin extends SwidgeProtocol {
    /**
     * @private
     * @type {LayerswapApiClient}
     */
    _client;
    constructor(account?: undefined, config?: LayerswapProtocolConfig);
    constructor(account: WalletAccountReadOnlyBtc, config?: LayerswapProtocolConfig);
    constructor(account: WalletAccountBtc, config?: LayerswapProtocolConfig);
    /**
     * Quotes the estimated costs and output of a Layerswap swidge operation without
     * creating a swap. Layerswap only supports exact-in operations; passing
     * `toTokenAmount` throws.
     *
     * When the protocol has an account bound, the quote includes a non-included
     * 'network' fee entry with an approximation of the source-chain PSBT fee
     * (`BTC_FEE_APPROX_SATS` = 1500 sats). The swidge-time fee is the actual PSBT
     * fee from coinselect.
     *
     * @param {LayerswapSwidgeOptions} options - The swidge options.
     * @returns {Promise<SwidgeQuote>} The quoted swidge details.
     */
    quoteSwidge(options: LayerswapSwidgeOptions): Promise<SwidgeQuote>;
    /**
     * Executes a Layerswap swidge operation: creates the swap, checks the fee guards,
     * and broadcasts the source-chain deposit transaction (a PSBT with an OP_RETURN
     * memo carrying the swap reference).
     *
     * Resolves once the deposit has been broadcast. Layerswap finishes the
     * destination-chain payout asynchronously; track it with `getSwidgeStatus(result.id)`.
     *
     * @param {LayerswapSwidgeOptions} options - The swidge options.
     * @param {SwidgeProtocolConfig & Pick<LayerswapProtocolConfig, 'bridgeMaxFee'>} [config] - Optional
     *   execution configuration overrides.
     * @returns {Promise<SwidgeResult>} The swidge execution result. `id` is the Layerswap swap
     *   id (use it with `getSwidgeStatus`); `hash` is the source-chain deposit transaction id.
     */
    swidge(options: LayerswapSwidgeOptions, config?: SwidgeProtocolConfig & Pick<LayerswapProtocolConfig, 'bridgeMaxFee'>): Promise<SwidgeResult>;
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
    getSwidgeStatus(id: string): Promise<SwidgeStatusResult>;
    /**
     * Retrieves the chains supported by Layerswap.
     *
     * @returns {Promise<SwidgeSupportedChain[]>} The supported chains. `id` is the Layerswap
     *   network name (e.g. `'BITCOIN_MAINNET'`) — use it as `fromChain`/`toChain`.
     */
    getSupportedChains(): Promise<SwidgeSupportedChain[]>;
    /**
     * Retrieves the tokens supported by Layerswap, optionally scoped to a chain.
     *
     * @param {SwidgeSupportedTokensOptions} [options] - Chain-scoped filters (`toChain`,
     *   or `fromChain` when `toChain` is absent). `fromToken` route scoping is not applied.
     * @returns {Promise<SwidgeSupportedToken[]>} The supported tokens.
     */
    getSupportedTokens(options?: SwidgeSupportedTokensOptions): Promise<SwidgeSupportedToken[]>;
    /**
     * Bridges BTC to a different blockchain via Layerswap.
     *
     * Legacy WDK bridge-module surface, kept for backwards compatibility with the
     * pre-swidge interface of this package: `hash` is the source-chain deposit
     * transaction id (not the swap id), and the Layerswap swap id is returned in the
     * extra `swapId` field.
     *
     * Semantic note: `bridgeFee` is in **source-token base units** (satoshis), not
     * native gas — it is the total fee Layerswap deducts from the source amount.
     * `fee` is the source-chain PSBT fee in satoshis. Do not sum them.
     *
     * @param {BridgeOptions} options - The bridge's options.
     * @param {Pick<LayerswapProtocolConfig, 'bridgeMaxFee'>} [config] - Per-call overrides.
     * @returns {Promise<LayerswapBridgeResult>} The bridge's result, augmented with the Layerswap swap id.
     */
    bridge(options: BridgeOptions, config?: Pick<LayerswapProtocolConfig, 'bridgeMaxFee'>): Promise<LayerswapBridgeResult>;
    /**
     * Quotes the costs of a Layerswap bridge operation without creating a swap.
     *
     * Legacy WDK bridge-module surface, kept for backwards compatibility. `fee` is an
     * approximation of the source-chain PSBT fee (`BTC_FEE_APPROX_SATS` = 1500 sats);
     * `bridgeFee` is Layerswap's total fee in source-token base units (satoshis).
     * See `bridge()` for the semantics.
     *
     * @param {BridgeOptions} options - The bridge's options.
     * @returns {Promise<Omit<BridgeResult, 'hash'>>} The bridge's quotes.
     */
    quoteBridge(options: BridgeOptions): Promise<Omit<BridgeResult, 'hash'>>;
    /**
     * Returns the underlying API client, for raw access to the Layerswap v2 API.
     *
     * @returns {LayerswapApiClient}
     */
    getApiClient(): LayerswapApiClient;
    /**
     * Asks Layerswap for its on-chain assessment of a deposit transaction. Useful as a
     * follow-up after `swidge()` returns — `broadcast()` returns once the tx is accepted
     * into the mempool, but a transaction can still drop or be replaced before confirmation.
     * Returns `'completed' | 'failed' | 'pending'`.
     *
     * The source network defaults to whatever `account._config.network` maps to (mainnet
     * by default); pass `options.sourceChain` to override.
     *
     * @param {string} txid - The Bitcoin txid returned by `swidge()`.
     * @param {{ sourceChain?: string }} [options]
     * @returns {Promise<import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapTransactionStatus>}
     */
    getTransactionStatus(txid: string, options?: {
        sourceChain?: string;
    }): Promise<import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapTransactionStatus>;
    /**
     * Maps the legacy bridge options onto the swidge options vocabulary. The legacy
     * `slippage` is a percent string ('0.5' = 0.5%); swidge takes a decimal (0.005).
     *
     * @private
     * @param {BridgeOptions} options
     * @returns {LayerswapSwidgeOptions}
     */
    private _toSwidgeOptions;
    /**
     * Splits a swidge fee breakdown back into the legacy `{ fee, bridgeFee }` pair:
     * `fee` = non-included fees (source-chain PSBT fee, satoshis), `bridgeFee` = included
     * fees (Layerswap's cut, source-token base units).
     *
     * @private
     * @param {SwidgeFee[]} fees
     * @returns {{ fee: bigint, bridgeFee: bigint }}
     */
    private _splitLegacyFees;
    /**
     * Builds the non-included source-chain gas fee entry.
     *
     * @private
     * @param {bigint} fee
     * @param {LayerswapNetwork} sourceNetwork
     * @returns {SwidgeFee}
     */
    private _buildGasFee;
    /**
     * Validates the exact-in/exact-out split. Layerswap quotes are driven by the source
     * amount, so exact-out operations are rejected.
     *
     * @private
     * @param {LayerswapSwidgeOptions} options
     * @returns {bigint} The input amount in source-token base units (satoshis).
     */
    private _requireExactIn;
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
    private _resolveSwidgeRoute;
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
    private _resolveRecipient;
    /**
     * Calls `POST /api/v2/swaps` for the resolved route and extracts the wallet-driven
     * deposit action.
     *
     * @private
     * @param {LayerswapSwidgeOptions} options
     * @param {{ sourceNetwork: LayerswapNetwork, sourceToken: LayerswapToken, destinationNetwork: LayerswapNetwork, destinationToken: LayerswapToken }} route
     * @param {bigint} fromTokenAmount
     * @returns {Promise<{
     *   swap: LayerswapSwap,
     *   action: LayerswapDepositAction,
     *   quote: LayerswapQuote | undefined
     * }>}
     */
    private _createDepositSwap;
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
     * Layerswap network name. Defaults to `BITCOIN_MAINNET` if there is no account or the
     * wallet config is unset or unfamiliar.
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
     * Wraps the wallet's BIP-32 master node so every byte field crossing into
     * bitcoinjs-lib is a Buffer. bip32 v5 returns Uint8Arrays for keys,
     * fingerprints, and signatures, which bitcoinjs-lib expects as Buffers for
     * `publicKey.equals` and partialSig serialisation.
     *
     * @private
     * @param {Object} node - An HDSigner-compatible BIP-32 node.
     * @returns {Object} An HDSigner whose publicKey/fingerprint/sign() return Buffers.
     */
    private _toBufferHdSigner;
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
     * own. Awaited (rather than fire-and-forget) so the API call's lifetime is bounded by
     * `swidge()`'s return.
     *
     * @private
     * @param {string} swapId
     * @param {string} hash
     * @returns {Promise<void>}
     */
    private _notifyDepositBroadcast;
}
