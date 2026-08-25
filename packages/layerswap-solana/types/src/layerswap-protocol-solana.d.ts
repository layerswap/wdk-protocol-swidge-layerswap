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
    constructor(account?: undefined, config?: LayerswapProtocolConfig);
    /**
     * Creates a new read-only interface to the layerswap protocol for solana blockchains.
     *
     * @overload
     * @param {WalletAccountReadOnlySolana} account - The wallet account to use to interact with the protocol.
     * @param {LayerswapProtocolConfig} [config] - The layerswap protocol configuration.
     */
    constructor(account: WalletAccountReadOnlySolana, config?: LayerswapProtocolConfig);
    /**
     * Creates a new interface to the layerswap protocol for solana blockchains.
     *
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
    quoteSwidge(options: LayerswapSwidgeOptions): Promise<SwidgeQuote>;
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
    swidge(options: LayerswapSwidgeOptions, config?: SwidgeProtocolConfig & Pick<LayerswapProtocolConfig, "bridgeMaxFee">): Promise<SwidgeResult>;
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
    bridge(options: BridgeOptions, config?: Pick<LayerswapProtocolConfig, "bridgeMaxFee">): Promise<LayerswapBridgeResult>;
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
    quoteBridge(options: BridgeOptions): Promise<Omit<BridgeResult, "hash">>;
    /**
     * Returns the underlying API client, for raw access to the Layerswap v2 API.
     *
     * @returns {LayerswapApiClient}
     */
    getApiClient(): LayerswapApiClient;
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
     * @returns {Promise<import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapTransactionStatus>}
     */
    getTransactionStatus(signature: string, options?: {
        sourceChain?: string;
    }): Promise<import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapTransactionStatus>;
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
     * `fee` = non-included fees (source-chain gas, lamports), `bridgeFee` = included
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
     * @param {bigint} gas
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
     * @returns {bigint} The input amount in source-token base units.
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
     * Creates the Layerswap swap and deserialises the deposit transaction from the returned
     * wallet-flow deposit action's `call_data`.
     *
     * @private
     * @param {LayerswapSwidgeOptions} options
     * @param {{ sourceNetwork: LayerswapNetwork, sourceToken: LayerswapToken, destinationNetwork: LayerswapNetwork, destinationToken: LayerswapToken }} route
     * @param {bigint} fromTokenAmount
     * @returns {Promise<{ swap: LayerswapSwap, transaction: Transaction, quote: LayerswapQuote | undefined }>}
     */
    private _createSwap;
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
export type SwidgeProtocolConfig = import("@tetherto/wdk-wallet/protocols").SwidgeProtocolConfig;
export type SwidgeOptions = import("@tetherto/wdk-wallet/protocols").SwidgeOptions;
export type SwidgeQuote = import("@tetherto/wdk-wallet/protocols").SwidgeQuote;
export type SwidgeResult = import("@tetherto/wdk-wallet/protocols").SwidgeResult;
export type SwidgeFee = import("@tetherto/wdk-wallet/protocols").SwidgeFee;
export type SwidgeStatusResult = import("@tetherto/wdk-wallet/protocols").SwidgeStatusResult;
export type SwidgeSupportedChain = import("@tetherto/wdk-wallet/protocols").SwidgeSupportedChain;
export type SwidgeSupportedToken = import("@tetherto/wdk-wallet/protocols").SwidgeSupportedToken;
export type SwidgeSupportedTokensOptions = import("@tetherto/wdk-wallet/protocols").SwidgeSupportedTokensOptions;
export type BridgeResult = import("@tetherto/wdk-wallet/protocols").BridgeResult;
export type WalletAccountSolana = import("@tetherto/wdk-wallet-solana").WalletAccountSolana;
export type WalletAccountReadOnlySolana = import("@tetherto/wdk-wallet-solana").WalletAccountReadOnlySolana;
export type LayerswapNetwork = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapNetwork;
export type LayerswapToken = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapToken;
export type LayerswapDepositAction = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapDepositAction;
export type LayerswapSwap = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapSwap;
export type LayerswapQuote = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapQuote;
export type LayerswapProtocolConfig = SwidgeProtocolConfig & any;
/**
 * Layerswap-specific extensions to the WDK swidge options.
 */
export type LayerswapSwidgeOptions = SwidgeOptions & any;
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
import { SwidgeProtocol } from '@tetherto/wdk-wallet/protocols';
import LayerswapApiClient from '@layerswap/wdk-protocol-swidge-layerswap-core';
