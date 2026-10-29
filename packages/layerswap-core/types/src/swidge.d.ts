export type LayerswapNetwork = import('./layerswap-api-client.js').LayerswapNetwork;
export type LayerswapToken = import('./layerswap-api-client.js').LayerswapToken;
export type LayerswapQuote = import('./layerswap-api-client.js').LayerswapQuote;
export type LayerswapSwapResponse = import('./layerswap-api-client.js').LayerswapSwapResponse;
export type LayerswapSwapTransaction = import('./layerswap-api-client.js').LayerswapSwapTransaction;
export type LayerswapSwap = import('./layerswap-api-client.js').LayerswapSwap;
export type LayerswapSwidgeStatus = 'pending' | 'action-required' | 'completed' | 'failed' | 'refund-pending' | 'refunded' | 'cancelled' | 'expired' | 'partial';
export type LayerswapSwidgeFee = {
    type: 'network' | 'protocol' | 'affiliate' | 'other';
    amount: bigint;
    token: string;
    chain?: string | number;
    included?: boolean;
    description?: string;
};
export type LayerswapSwidgeTransaction = {
    hash: string;
    chain?: string | number;
    type?: 'source' | 'destination' | 'approval' | 'refund' | 'other';
};
export type LayerswapSwidgeQuote = {
    fromTokenAmount: bigint;
    toTokenAmount: bigint;
    toTokenAmountMin: bigint;
    fees: LayerswapSwidgeFee[];
    estimatedDuration?: number;
};
export type LayerswapSwidgeStatusResult = {
    status: LayerswapSwidgeStatus;
    transactions?: LayerswapSwidgeTransaction[];
};
export type LayerswapSwidgeStatusOptions = {
    /**
     * - The source chain: Layerswap network name or chain id.
     */
    fromChain?: string | number;
    /**
     * - The destination chain: Layerswap network name or chain id.
     */
    toChain?: string | number;
};
export type LayerswapSwidgeSupportedChain = {
    id: string;
    name: string;
    type: string;
    nativeToken: string;
};
export type LayerswapSwidgeSupportedToken = {
    token: string;
    chain: string;
    symbol: string;
    decimals: number;
    address?: string;
    name?: string;
};
export type LayerswapSwidgeSupportedTokensOptions = {
    fromChain?: string | number;
    fromToken?: string;
    toChain?: string | number;
};
/**
 * Maps a Layerswap swap status to the WDK swidge status vocabulary.
 *
 * @param {string} status - The Layerswap swap status (e.g. 'ls_transfer_pending').
 * @returns {LayerswapSwidgeStatus}
 */
export declare function mapSwapStatus(status: string): LayerswapSwidgeStatus;
/**
 * Maps the transactions attached to a Layerswap swap to WDK swidge transactions.
 * Entries without a hash (created but not yet broadcast) are skipped.
 *
 * @param {LayerswapSwapTransaction[]} [transactions]
 * @returns {LayerswapSwidgeTransaction[]}
 */
export declare function mapSwapTransactions(transactions?: LayerswapSwapTransaction[]): LayerswapSwidgeTransaction[];
/**
 * Derives the WDK swidge status for a swap, tracking the attached transactions
 * first and falling back to the swap-level status only when no transaction is
 * decisive. The output (payout) transaction is the authoritative delivery signal —
 * Layerswap's swap-level status can lag behind it (e.g. a swap can sit in
 * `ls_transfer_pending` after the payout has already confirmed on-chain).
 *
 * @param {LayerswapSwap} swap
 * @returns {LayerswapSwidgeStatus}
 */
export declare function deriveSwidgeStatus(swap: LayerswapSwap): LayerswapSwidgeStatus;
/**
 * Builds a WDK swidge status result from a `GET /api/v2/swaps/{id}` response.
 * The status is transaction-first (see {@link deriveSwidgeStatus}).
 *
 * The optional chain hints constrain the lookup: if the swap's source (destination)
 * network does not match `fromChain` (`toChain`) — compared case-insensitively against
 * the Layerswap network name and its chain id — no swidge exists for the given id on
 * those chains, and a `NoSuchElementError` is thrown.
 *
 * @param {LayerswapSwapResponse} response
 * @param {LayerswapSwidgeStatusOptions} [options] - Optional chain hints.
 * @returns {LayerswapSwidgeStatusResult}
 * @throws {ProviderError} If the response is missing the swap details.
 * @throws {NoSuchElementError} If the swap does not match the given chain hints.
 */
export declare function buildStatusResult(response: LayerswapSwapResponse, options?: LayerswapSwidgeStatusOptions): LayerswapSwidgeStatusResult;
/**
 * Maps the Layerswap network catalog to WDK swidge supported chains.
 *
 * @param {LayerswapNetwork[]} networks
 * @returns {LayerswapSwidgeSupportedChain[]}
 */
export declare function buildSupportedChains(networks: LayerswapNetwork[]): LayerswapSwidgeSupportedChain[];
/**
 * Flattens the Layerswap network catalog to WDK swidge supported tokens.
 *
 * Filtering is chain-scoped: `toChain` (or, failing that, `fromChain`) restricts the
 * result to that network's tokens. Route-level filtering (`fromToken`) would require
 * Layerswap's sources/destinations endpoints and is not applied here.
 *
 * @param {LayerswapNetwork[]} networks
 * @param {LayerswapSwidgeSupportedTokensOptions} [options]
 * @returns {LayerswapSwidgeSupportedToken[]}
 */
export declare function buildSupportedTokens(networks: LayerswapNetwork[], options?: LayerswapSwidgeSupportedTokensOptions): LayerswapSwidgeSupportedToken[];
/**
 * Builds the itemised WDK fee breakdown for a Layerswap quote. Both components are
 * deducted from the source amount by Layerswap, so they are denominated in the
 * source token and flagged `included: true`. Source-chain gas is not known here;
 * chain-specific packages append it as a non-included 'network' fee in the native token.
 *
 * @param {LayerswapQuote} quote
 * @param {LayerswapToken} sourceToken
 * @param {string} [sourceChain] - Layerswap source network name.
 * @returns {LayerswapSwidgeFee[]}
 */
export declare function buildQuoteFees(quote: LayerswapQuote, sourceToken: LayerswapToken, sourceChain?: string): LayerswapSwidgeFee[];
/**
 * Builds a WDK swidge quote from a Layerswap quote.
 *
 * @param {LayerswapQuote} quote
 * @param {LayerswapToken} sourceToken
 * @param {LayerswapToken} destinationToken
 * @param {string} [sourceChain] - Layerswap source network name.
 * @returns {LayerswapSwidgeQuote}
 */
export declare function buildSwidgeQuote(quote: LayerswapQuote, sourceToken: LayerswapToken, destinationToken: LayerswapToken, sourceChain?: string): LayerswapSwidgeQuote;
/**
 * Parses Layerswap's `avg_completion_time` ("HH:MM:SS" or "HH:MM:SS.fffffff") to
 * whole seconds. Returns undefined on missing or unparseable input.
 *
 * @param {string} [value]
 * @returns {number | undefined}
 */
export declare function parseCompletionTime(value?: string): number | undefined;
/**
 * Converts a WDK swidge slippage (decimal, e.g. 0.01 for 1%) to the percentage
 * string the Layerswap API expects (e.g. '1').
 *
 * @param {number} [slippage]
 * @returns {string | undefined}
 * @throws {ValueError} If the slippage is not a non-negative number.
 */
export declare function formatSlippage(slippage?: number): string | undefined;
/**
 * Converts an integer option (an amount in base units, or basis points) to a bigint.
 *
 * @param {number | bigint | string | undefined} value - The option value.
 * @param {string} name - The option name, used in the error message.
 * @returns {bigint | undefined} The value as a bigint, or undefined if the option is not set.
 * @throws {ValueError} If the value is not an integer.
 */
export declare function toBigIntOption(value: number | bigint | string | undefined, name: string): bigint | undefined;
export type LayerswapFeeGuardsConfig = {
    /**
     * - Maximum network fee, in basis points of the input amount.
     */
    maxNetworkFeeBps?: number | bigint;
    /**
     * - Maximum protocol fee, in basis points of the input amount.
     */
    maxProtocolFeeBps?: number | bigint;
};
/**
 * @typedef {Object} LayerswapFeeGuardsConfig
 * @property {number | bigint} [maxNetworkFeeBps] - Maximum network fee, in basis points of the input amount.
 * @property {number | bigint} [maxProtocolFeeBps] - Maximum protocol fee, in basis points of the input amount.
 */
/**
 * Enforces the WDK `maxNetworkFeeBps` / `maxProtocolFeeBps` guards against a fee
 * breakdown, in basis points of the input amount.
 *
 * Only fees denominated in the source token — plus, for the network guard, fees in
 * `nativeToken` when the source token IS the native token — share the input amount's
 * unit and can be compared soundly; fees in other units are excluded from the check.
 *
 * @param {LayerswapSwidgeFee[]} fees
 * @param {bigint} fromTokenAmount - The input amount in source-token base units.
 * @param {string} sourceTokenSymbol
 * @param {LayerswapFeeGuardsConfig} [config]
 * @throws {ValueError} If a guard is not an integer.
 * @throws {MaximumFeeExceededError} If a fee exceeds its basis-points guard.
 */
export declare function assertFeeGuards(fees: LayerswapSwidgeFee[], fromTokenAmount: bigint, sourceTokenSymbol: string, config?: LayerswapFeeGuardsConfig): void;
/**
 * Normalizes an error raised by a wallet account (or by the chain SDK it relies on) so that
 * it complies with the `ISwidgeProtocol` throw contract:
 * - errors already in the contract are returned as-is;
 * - `TransactionError` / `TransferError` with an insufficient-balance reason become a
 *   `SwidgeError` with the same reason;
 * - anything else is wrapped in a `ProviderError`, keeping the original error as `cause`.
 *
 * @param {unknown} error - The error raised by the wallet account.
 * @returns {Error} The normalized error.
 */
export declare function normalizeWalletError(error: unknown): Error;
