export type LayerswapToken = {
    symbol: string;
    contract: string | null;
    decimals: number;
    price_in_usd?: number;
    display_asset?: string;
};
export type LayerswapNetwork = {
    name: string;
    chain_id: string | null;
    type: string;
    tokens: LayerswapToken[];
    display_name?: string;
    /**
     * - The network's native gas token.
     */
    token?: LayerswapToken;
};
export type LayerswapQuote = {
    requested_amount: number;
    receive_amount: number;
    min_receive_amount: number;
    total_fee: number;
    total_fee_in_usd: number;
    blockchain_fee: number;
    service_fee: number;
    avg_completion_time?: string;
    slippage?: number;
};
export type LayerswapDepositAction = {
    amount: number;
    amount_in_base_units: string;
    call_data: string;
    to_address?: string;
    token: LayerswapToken;
    fee_token: LayerswapToken;
    network: LayerswapNetwork;
    order: number;
    type: 'transfer' | 'manual_transfer';
};
export type LayerswapSwapStatusValue = 'user_transfer_pending' | 'ls_transfer_pending' | 'completed' | 'failed' | 'expired' | 'cancelled' | 'pending_refund' | 'refunded';
export type LayerswapSwapTransaction = {
    transaction_hash: string;
    type: 'input' | 'output' | 'refuel' | 'refund';
    status: 'completed' | 'initiated' | 'pending';
    amount?: number;
    from?: string;
    to?: string;
    timestamp?: string;
    confirmations?: number;
    max_confirmations?: number;
    token?: LayerswapToken;
    network?: LayerswapNetwork | string;
};
export type LayerswapSwap = {
    id: string;
    created_date: string;
    status: LayerswapSwapStatusValue | string;
    source_network: LayerswapNetwork;
    source_token: LayerswapToken;
    destination_network: LayerswapNetwork;
    destination_token: LayerswapToken;
    destination_address: string;
    requested_amount: number;
    source_address?: string;
    fail_reason?: string | null;
    transactions?: LayerswapSwapTransaction[];
};
export type LayerswapQuoteResponse = {
    quote: LayerswapQuote;
};
export type LayerswapSwapResponse = {
    swap: LayerswapSwap;
    deposit_actions?: LayerswapDepositAction[];
    quote?: LayerswapQuoteResponse;
};
export type LayerswapCreateSwapParams = {
    source_network: string;
    source_token: string;
    destination_network: string;
    destination_token: string;
    destination_address: string;
    amount: string | number;
    use_deposit_address: boolean;
    source_address?: string;
    refund_address?: string;
    refuel?: boolean;
    slippage?: string;
    reference_id?: string;
};
export type LayerswapGetQuoteParams = {
    source_network: string;
    source_token: string;
    destination_network: string;
    destination_token: string;
    amount: string | number;
    use_deposit_address: boolean;
    source_address?: string;
    refuel?: boolean;
    slippage?: string;
};
export type LayerswapTransactionStatusValue = 'completed' | 'failed' | 'pending';
export type LayerswapTransactionStatus = {
    status: LayerswapTransactionStatusValue;
};
export type LayerswapApiErrorBody = {
    /**
     * - Layerswap's error code (e.g. `'NOT_FOUND'`).
     */
    code?: string;
    /**
     * - Layerswap's error message.
     */
    message?: string;
};
export type LayerswapApiEnvelope = {
    /**
     * - The response payload.
     */
    data?: any;
    /**
     * - The error details of a failed request.
     */
    error?: LayerswapApiErrorBody;
};
export type LayerswapApiError = Error & LayerswapApiErrorDetails;
export type LayerswapApiErrorDetails = {
    /**
     * - Layerswap's error code, or `HTTP_<status>` when absent.
     */
    code: string;
    /**
     * - The HTTP status of the response.
     */
    status: number;
};
export type LayerswapRequestOptions = {
    /**
     * - The JSON request body.
     */
    body?: Object;
    /**
     * - Extra request headers.
     */
    headers?: Record<string, string>;
    /**
     * - If true, a "not found" response (a 404, or a
     * 400 whose message reports the resource as not found) is thrown as a `NoSuchElementError`
     * instead of a `ValueError`.
     */
    notFoundAsNoSuchElement?: boolean;
};
export type LayerswapApiClientConfig = {
    apiKey?: string;
    apiUrl?: string;
    requestTimeoutMs?: number;
};
/**
 * @typedef {Object} LayerswapToken
 * @property {string} symbol
 * @property {string | null} contract
 * @property {number} decimals
 * @property {number} [price_in_usd]
 * @property {string} [display_asset]
 */
/**
 * @typedef {Object} LayerswapNetwork
 * @property {string} name
 * @property {string | null} chain_id
 * @property {string} type
 * @property {LayerswapToken[]} tokens
 * @property {string} [display_name]
 * @property {LayerswapToken} [token] - The network's native gas token.
 */
/**
 * @typedef {Object} LayerswapQuote
 * @property {number} requested_amount
 * @property {number} receive_amount
 * @property {number} min_receive_amount
 * @property {number} total_fee
 * @property {number} total_fee_in_usd
 * @property {number} blockchain_fee
 * @property {number} service_fee
 * @property {string} [avg_completion_time]
 * @property {number} [slippage]
 */
/**
 * @typedef {Object} LayerswapDepositAction
 * @property {number} amount
 * @property {string} amount_in_base_units
 * @property {string} call_data
 * @property {string} [to_address]
 * @property {LayerswapToken} token
 * @property {LayerswapToken} fee_token
 * @property {LayerswapNetwork} network
 * @property {number} order
 * @property {'transfer' | 'manual_transfer'} type
 */
/**
 * @typedef {'user_transfer_pending' | 'ls_transfer_pending' | 'completed' | 'failed'
 *          | 'expired' | 'cancelled' | 'pending_refund' | 'refunded'} LayerswapSwapStatusValue
 *
 * Layerswap's swap lifecycle statuses, as serialized on the wire by the v2 API:
 * - `user_transfer_pending`: waiting for the user's deposit on the source network.
 * - `ls_transfer_pending`: deposit detected; Layerswap is executing the destination payout.
 * - `completed`: funds delivered to the destination address.
 * - `pending_refund` / `refunded`: the swap could not complete and funds are being / have been returned.
 */
/**
 * A source/destination/refuel/refund transaction attached to a swap by Layerswap.
 *
 * @typedef {Object} LayerswapSwapTransaction
 * @property {string} transaction_hash
 * @property {'input' | 'output' | 'refuel' | 'refund'} type
 * @property {'completed' | 'initiated' | 'pending'} status
 * @property {number} [amount]
 * @property {string} [from]
 * @property {string} [to]
 * @property {string} [timestamp]
 * @property {number} [confirmations]
 * @property {number} [max_confirmations]
 * @property {LayerswapToken} [token]
 * @property {LayerswapNetwork | string} [network]
 */
/**
 * @typedef {Object} LayerswapSwap
 * @property {string} id
 * @property {string} created_date
 * @property {LayerswapSwapStatusValue | string} status
 * @property {LayerswapNetwork} source_network
 * @property {LayerswapToken} source_token
 * @property {LayerswapNetwork} destination_network
 * @property {LayerswapToken} destination_token
 * @property {string} destination_address
 * @property {number} requested_amount
 * @property {string} [source_address]
 * @property {string | null} [fail_reason]
 * @property {LayerswapSwapTransaction[]} [transactions]
 */
/**
 * @typedef {Object} LayerswapQuoteResponse
 * @property {LayerswapQuote} quote
 */
/**
 * @typedef {Object} LayerswapSwapResponse
 * @property {LayerswapSwap} swap
 * @property {LayerswapDepositAction[]} [deposit_actions]
 * @property {LayerswapQuoteResponse} [quote]
 */
/**
 * @typedef {Object} LayerswapCreateSwapParams
 * @property {string} source_network
 * @property {string} source_token
 * @property {string} destination_network
 * @property {string} destination_token
 * @property {string} destination_address
 * @property {string | number} amount
 * @property {boolean} use_deposit_address
 * @property {string} [source_address]
 * @property {string} [refund_address]
 * @property {boolean} [refuel]
 * @property {string} [slippage]
 * @property {string} [reference_id]
 */
/**
 * @typedef {Object} LayerswapGetQuoteParams
 * @property {string} source_network
 * @property {string} source_token
 * @property {string} destination_network
 * @property {string} destination_token
 * @property {string | number} amount
 * @property {boolean} use_deposit_address
 * @property {string} [source_address]
 * @property {boolean} [refuel]
 * @property {string} [slippage]
 */
/**
 * @typedef {'completed' | 'failed' | 'pending'} LayerswapTransactionStatusValue
 *
 * Layerswap's on-chain assessment of a deposit transaction. Lowercase values match the
 * web app's enum exactly (`completed` once the source-chain tx is confirmed and
 * Layerswap has indexed it, `failed` if the chain rejected it, `pending` while in the
 * mempool or awaiting confirmations).
 */
/**
 * @typedef {Object} LayerswapTransactionStatus
 * @property {LayerswapTransactionStatusValue} status
 */
/**
 * @typedef {Object} LayerswapApiErrorBody
 * @property {string} [code] - Layerswap's error code (e.g. `'NOT_FOUND'`).
 * @property {string} [message] - Layerswap's error message.
 */
/**
 * The JSON envelope wrapping every Layerswap v2 API response.
 *
 * @typedef {Object} LayerswapApiEnvelope
 * @property {any} [data] - The response payload.
 * @property {LayerswapApiErrorBody} [error] - The error details of a failed request.
 */
/**
 * A WDK error raised for a failed Layerswap request, decorated with Layerswap's error
 * code and the HTTP status.
 *
 * @typedef {Error & LayerswapApiErrorDetails} LayerswapApiError
 */
/**
 * @typedef {Object} LayerswapApiErrorDetails
 * @property {string} code - Layerswap's error code, or `HTTP_<status>` when absent.
 * @property {number} status - The HTTP status of the response.
 */
/**
 * @typedef {Object} LayerswapRequestOptions
 * @property {Object} [body] - The JSON request body.
 * @property {Record<string, string>} [headers] - Extra request headers.
 * @property {boolean} [notFoundAsNoSuchElement] - If true, a "not found" response (a 404, or a
 *   400 whose message reports the resource as not found) is thrown as a `NoSuchElementError`
 *   instead of a `ValueError`.
 */
/**
 * @typedef {Object} LayerswapApiClientConfig
 * @property {string} [apiKey]
 * @property {string} [apiUrl]
 * @property {number} [requestTimeoutMs]
 */
/**
 * Minimal HTTP client for the Layerswap public v2 API.
 *
 * Wraps the endpoints required to drive a swap to broadcast:
 * - `GET  /api/v2/networks` (cached per instance)
 * - `GET  /api/v2/quote`
 * - `POST /api/v2/swaps`
 * - `GET  /api/v2/swaps/{id}`
 * - `POST /api/v2/swaps/{id}/deposit_speedup`
 * - `GET  /api/v2/transaction_status`
 *
 * Failed requests are thrown as WDK errors, carrying Layerswap's error `code` and the
 * HTTP `status` as extra properties:
 * - `ProviderError` when the API is unreachable, times out, rejects the credentials,
 *   fails server-side, or returns a malformed body;
 * - `NoSuchElementError` when a looked-up swap or transaction does not exist;
 * - `ValueError` when Layerswap rejects the request parameters (other 4xx responses).
 */
export default class LayerswapApiClient {
    /**
     * @private
     * @type {string | undefined}
     */
    _apiKey;
    /** @private */
    _baseUrl;
    /** @private */
    _timeoutMs;
    /**
     * Cached `/networks` response.
     *
     * @private
     * @type {Promise<LayerswapNetwork[]> | null}
     */
    _networksPromise;
    /**
     * @param {LayerswapApiClientConfig} [config]
     */
    constructor(config?: LayerswapApiClientConfig);
    /**
     * Returns the Layerswap network/token catalog. Cached for the lifetime of this client.
     *
     * @returns {Promise<LayerswapNetwork[]>}
     * @throws {ProviderError} If the request fails.
     */
    getNetworks(): Promise<LayerswapNetwork[]>;
    /**
     * Fetches a fee/receive quote for a prospective swap.
     *
     * @param {LayerswapGetQuoteParams} params
     * @returns {Promise<LayerswapQuoteResponse>}
     * @throws {ValueError} If Layerswap rejects the quote parameters.
     * @throws {ProviderError} If the request fails.
     */
    getQuote(params: LayerswapGetQuoteParams): Promise<LayerswapQuoteResponse>;
    /**
     * Creates a new swap. Returns the swap id, the deposit actions, and the locked-in quote.
     *
     * @param {LayerswapCreateSwapParams} params
     * @returns {Promise<LayerswapSwapResponse>}
     * @throws {ValueError} If Layerswap rejects the swap parameters.
     * @throws {ProviderError} If the request fails.
     */
    createSwap(params: LayerswapCreateSwapParams): Promise<LayerswapSwapResponse>;
    /**
     * Fetches the current state of a swap, including deposit actions and any input/output transactions.
     *
     * @param {string} swapId
     * @returns {Promise<LayerswapSwapResponse>}
     * @throws {NoSuchElementError} If no swap exists with the given id.
     * @throws {ValueError} If Layerswap rejects the swap id.
     * @throws {ProviderError} If the request fails.
     */
    getSwap(swapId: string): Promise<LayerswapSwapResponse>;
    /**
     * Returns Layerswap's on-chain assessment of a deposit transaction (completed / failed /
     * pending). Useful as a follow-up to `swidge()` when the source-chain broadcast succeeded
     * but the tx might still revert or be dropped from the mempool — Layerswap will surface
     * `'failed'` here even before the swap as a whole reaches a terminal status.
     *
     * Throws a `NoSuchElementError` if Layerswap cannot find the transaction (e.g. before
     * it's been indexed, or if the network/transaction_id pair is wrong). The protocol-level
     * wrapper calls this once per poll; callers should treat `NoSuchElementError` as
     * "not yet indexed, retry later".
     *
     * @param {string} networkName  Layerswap network name (e.g. `'ETHEREUM_MAINNET'`,
     *                              `'TRON_MAINNET'`, `'BITCOIN_MAINNET'`).
     * @param {string} transactionId The on-chain transaction hash / id, in the source chain's
     *                              native format.
     * @returns {Promise<LayerswapTransactionStatus>}
     * @throws {NoSuchElementError} If Layerswap cannot find the transaction.
     * @throws {ValueError} If Layerswap rejects the network/transaction id pair.
     * @throws {ProviderError} If the request fails.
     */
    getTransactionStatus(networkName: string, transactionId: string): Promise<LayerswapTransactionStatus>;
    /**
     * Informs Layerswap of a freshly broadcast deposit transaction. Best-effort; safe to ignore failures.
     *
     * @param {string} swapId
     * @param {string} transactionId
     * @returns {Promise<void>}
     * @throws {NoSuchElementError} If no swap exists with the given id.
     * @throws {ValueError} If Layerswap rejects the transaction id.
     * @throws {ProviderError} If the request fails.
     */
    speedUpDeposit(swapId: string, transactionId: string): Promise<void>;
    /**
     * @private
     * @param {string} method
     * @param {string} path
     * @param {LayerswapRequestOptions} [options]
     * @returns {Promise<any>}
     * @throws {NoSuchElementError} If `options.notFoundAsNoSuchElement` is set and Layerswap responds 404.
     * @throws {ValueError} If Layerswap rejects the request (4xx).
     * @throws {ProviderError} If the request fails, times out or returns a malformed body.
     */
    private _request;
    /**
     * Maps a failed Layerswap response to the matching WDK error, decorated with
     * Layerswap's error `code` and the HTTP `status`.
     *
     * @private
     * @param {string} message
     * @param {string} code
     * @param {number} status
     * @param {boolean} notFoundAsNoSuchElement
     * @returns {LayerswapApiError}
     */
    private _buildResponseError;
    /**
     * @private
     * @param {Record<string, unknown>} params
     * @returns {string}
     */
    private _buildQueryString;
    /**
     * @private
     * @returns {string}
     */
    private _randomCorrelationId;
}
