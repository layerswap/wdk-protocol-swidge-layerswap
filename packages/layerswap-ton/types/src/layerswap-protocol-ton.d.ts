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
export type WalletAccountTon = import('@tetherto/wdk-wallet-ton').WalletAccountTon;
export type WalletAccountReadOnlyTon = import('@tetherto/wdk-wallet-ton').WalletAccountReadOnlyTon;
export type Cell = import('@ton/core').Cell;
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
     * - Source token: jetton master address OR Layerswap symbol
     *   (e.g. `'TON'`, `'USDT'`).
     */
    token: string;
    /**
     * - Source amount in base units (nanotons for TON, smallest
     *   unit for jetton tokens).
     */
    amount: number | bigint;
    /**
     * - Destination token (address or symbol). Defaults to the
     *         source token's symbol.
     */
    destinationToken?: string;
    /**
     * - Override the default source network name. Defaults to
     *              `'TON_MAINNET'` (Layerswap only lists mainnet at the time
     *              of writing, and TON has no stable network id we can read).
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
/**
 * WDK swidge protocol that drives a Layerswap swap from a TON wallet account.
 *
 * Implements the `SwidgeProtocol` interface from `@tetherto/wdk-wallet/protocols`:
 * `quoteSwidge` / `swidge` / `getSwidgeStatus` / `getSupportedChains` / `getSupportedTokens`,
 * which also provides the WDK `swap`/`bridge` module surfaces via the base class.
 *
 * Unlike on-chain bridges this protocol is HTTP-orchestrated:
 *   1. POST /api/v2/swaps to create a swap and receive the deposit address + a JSON `call_data`
 *      containing the Layerswap reference comment (and, for jettons, the amount).
 *   2. Build the deposit message body client-side via `@ton/core`:
 *      - Native TON: a comment cell with op `0` and the Layerswap comment as `storeStringTail`.
 *      - Jetton: a TIP-3 jetton-transfer body (op `0x0f8a7ea5`) with the comment in the
 *        forward payload, sent to the sender's jetton wallet with a ~0.045 TON gas budget.
 *   3. Hand `{ to, value, body }` to `account.sendTransaction(...)`, which sets up the v5r1
 *      wallet contract, signs with the secret key, and broadcasts via `_contract.send`.
 *   4. Layerswap performs the destination-chain payout off-chain.
 *
 * `swidge()` resolves once the source-chain deposit message has been broadcast; the
 * destination payout completes asynchronously and can be tracked with
 * `getSwidgeStatus(result.id)`.
 *
 * Fee semantics: Layerswap deducts its fees from the source-token amount, so 'protocol'
 * and Layerswap's destination 'network' fee entries are denominated in the **source
 * token** and flagged `included: true`. Source-chain gas is a separate non-included
 * 'network' fee in **native nanotons**. Do not sum amounts across fee entries with
 * different `token` values.
 */
export default class LayerswapProtocolTon extends SwidgeProtocol {
    /**
     * @private
     * @type {LayerswapApiClient}
     */
    _client;
    constructor(account?: undefined, config?: LayerswapProtocolConfig);
    constructor(account: WalletAccountReadOnlyTon, config?: LayerswapProtocolConfig);
    constructor(account: WalletAccountTon, config?: LayerswapProtocolConfig);
    /**
     * Quotes the estimated costs and output of a Layerswap swidge operation without
     * creating a swap. Layerswap only supports exact-in operations; passing
     * `toTokenAmount` throws.
     *
     * When the protocol has an account bound, the quote includes a non-included
     * 'network' fee entry with the approximated source-chain gas (in nanotons):
     *   - Native TON: ~0.01 TON.
     *   - Jetton: ~0.05 TON (includes the 0.045 TON message value budgeted for
     *     jetton-wallet gas + forward amount).
     * The actual gas is only known after broadcasting and is reported by `swidge()`.
     *
     * @param {LayerswapSwidgeOptions} options - The swidge options.
     * @returns {Promise<SwidgeQuote>} The quoted swidge details.
     */
    quoteSwidge(options: LayerswapSwidgeOptions): Promise<SwidgeQuote>;
    /**
     * Executes a Layerswap swidge operation: creates the swap, checks the fee guards,
     * builds the TON deposit message, and broadcasts it from the wallet account.
     *
     * Resolves once the deposit has been broadcast. Layerswap finishes the
     * destination-chain payout asynchronously; track it with `getSwidgeStatus(result.id)`.
     *
     * Guard ordering note: the TON wallet only reports the actual source-chain gas from
     * `sendTransaction`'s return value (there is no pre-broadcast estimation in the old
     * flow), so the WDK bps fee guards are enforced *before* broadcasting against the
     * included Layerswap fees; the actual gas entry is appended to the result's fees
     * after the broadcast.
     *
     * @param {LayerswapSwidgeOptions} options - The swidge options.
     * @param {SwidgeProtocolConfig & Pick<LayerswapProtocolConfig, 'bridgeMaxFee'>} [config] - Optional
     *   execution configuration overrides.
     * @returns {Promise<SwidgeResult>} The swidge execution result. `id` is the Layerswap swap
     *   id (use it with `getSwidgeStatus`); `hash` is the TON external-message hash of the deposit.
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
     *   network name (e.g. `'TON_MAINNET'`) — use it as `fromChain`/`toChain`.
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
     * Bridges a token to a different blockchain via Layerswap.
     *
     * Legacy WDK bridge-module surface, kept for backwards compatibility with the
     * pre-swidge interface of this package: `hash` is the TON external-message hash of
     * the deposit (not the swap id), and the Layerswap swap id is returned in the extra
     * `swapId` field.
     *
     * Semantic note: `bridgeFee` is in **source-token base units**, not native nanotons —
     * it is the total fee Layerswap deducts from the source amount. `fee` is the
     * source-chain gas cost in nanotons. Do not sum them.
     *
     * @param {BridgeOptions} options - The bridge's options.
     * @param {Pick<LayerswapProtocolConfig, 'bridgeMaxFee'>} [config] - Per-call overrides.
     * @returns {Promise<LayerswapBridgeResult>} The bridge's result, augmented with the Layerswap swap id.
     */
    bridge(options: BridgeOptions, config?: Pick<LayerswapProtocolConfig, 'bridgeMaxFee'>): Promise<LayerswapBridgeResult>;
    /**
     * Quotes the costs of a Layerswap bridge operation without creating a swap.
     *
     * Legacy WDK bridge-module surface, kept for backwards compatibility. `fee` is the
     * approximated source-chain gas in nanotons (~0.01 TON native, ~0.05 TON jetton);
     * `bridgeFee` is Layerswap's total fee in source-token base units. See `bridge()`
     * for the semantics.
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
     * follow-up after `swidge()` returns — even if the wallet's `sendTransaction` resolved,
     * the message can still be discarded by the validator or fail at the jetton wallet.
     * Returns `'completed' | 'failed' | 'pending'`.
     *
     * The source network defaults to `TON_MAINNET` (TON has no stable network id and
     * Layerswap currently lists only mainnet); pass `options.sourceChain` to override.
     *
     * @param {string} hash - The TON external-message hash returned by `swidge()`.
     * @param {{ sourceChain?: string }} [options]
     * @returns {Promise<import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapTransactionStatus>}
     */
    getTransactionStatus(hash: string, options?: {
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
     * `fee` = non-included fees (source-chain gas, nanotons), `bridgeFee` = included
     * fees (Layerswap's cut, source-token base units).
     *
     * @private
     * @param {SwidgeFee[]} fees
     * @returns {{ fee: bigint, bridgeFee: bigint }}
     */
    private _splitLegacyFees;
    /**
     * Builds the non-included source-chain gas fee entry (in nanotons).
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
     * The source network defaults to `TON_MAINNET` — TON has no stable network id to
     * auto-detect from; pass `fromChain` to override.
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
     * deposit action, the parsed `call_data` JSON, and the create-swap quote.
     *
     * @private
     * @param {LayerswapSwidgeOptions} options
     * @param {{ sourceNetwork: LayerswapNetwork, sourceToken: LayerswapToken, destinationNetwork: LayerswapNetwork, destinationToken: LayerswapToken }} route
     * @param {bigint} fromTokenAmount
     * @returns {Promise<{
     *   swap: LayerswapSwap,
     *   action: LayerswapDepositAction,
     *   parsedCallData: { comment?: string, amount?: string | number } | null,
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
     * Parses Layerswap's `call_data` for TON, which the Layerswap web app expects as a JSON
     * string with optional `comment` and `amount` fields. Tolerates missing / empty / non-JSON
     * payloads by returning `null` — the deposit message will then carry an empty comment.
     *
     * @private
     * @param {string | null | undefined} callData
     * @returns {{ comment?: string, amount?: string | number } | null}
     */
    private _parseCallData;
    /**
     * Builds the `{ to, value, body }` argument for `account.sendTransaction(...)`. Branches
     * on `sourceToken.contract`: jetton master address present → jetton path, otherwise
     * native TON path.
     *
     * @private
     * @param {Object} params
     * @param {LayerswapToken} params.sourceToken
     * @param {LayerswapDepositAction} params.action
     * @param {{ comment?: string, amount?: string | number } | null} params.parsedCallData
     * @param {bigint} params.amount
     * @returns {Promise<{ to: string, value: bigint, body: Cell }>}
     */
    private _buildDepositMessage;
    /**
     * Resolves the jetton amount to encode in the jetton-transfer body. Prefers Layerswap's
     * `parsedCallData.amount` (matches the UI), falls back to the caller's amount.
     *
     * @private
     * @param {{ amount?: string | number } | null} parsedCallData
     * @param {bigint} fallbackAmount
     * @returns {bigint}
     */
    private _resolveJettonAmount;
    /**
     * Tests whether the bound account is a writable TON wallet account
     * (i.e. exposes `sendTransaction`). This is a duck-type check rather than an
     * `instanceof WalletAccountTon` check because pnpm-workspace setups can resolve
     * the wallet package to a different copy than this package's own copy when the
     * dep tree's peer-dep contexts diverge — `instanceof` would then fail on a
     * structurally-correct account. Read-only accounts do not expose `sendTransaction`.
     *
     * @private
     * @param {unknown} account
     * @returns {boolean}
     */
    private _isWritableAccount;
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
