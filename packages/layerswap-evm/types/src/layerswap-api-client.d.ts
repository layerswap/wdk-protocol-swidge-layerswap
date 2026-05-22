/**
 * @typedef {Object} LayerswapToken
 * @property {string} symbol
 * @property {string | null} contract
 * @property {number} decimals
 * @property {number} [price_in_usd]
 */
/**
 * @typedef {Object} LayerswapNetwork
 * @property {string} name
 * @property {string | null} chain_id
 * @property {string} type
 * @property {LayerswapToken[]} tokens
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
 * @typedef {Object} LayerswapSwap
 * @property {string} id
 * @property {string} created_date
 * @property {string} status
 * @property {LayerswapNetwork} source_network
 * @property {LayerswapToken} source_token
 * @property {LayerswapNetwork} destination_network
 * @property {LayerswapToken} destination_token
 * @property {string} destination_address
 * @property {number} requested_amount
 */
/**
 * @typedef {Object} LayerswapSwapResponse
 * @property {LayerswapSwap} swap
 * @property {LayerswapDepositAction[]} [deposit_actions]
 * @property {{ quote: LayerswapQuote }} [quote]
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
 */
export default class LayerswapApiClient {
    /**
     * @param {LayerswapApiClientConfig} [config]
     */
    constructor(config?: LayerswapApiClientConfig);
    /**
     * @private
     * @type {string | undefined}
     */
    private _apiKey;
    /** @private */
    private _baseUrl;
    /** @private */
    private _timeoutMs;
    /**
     * Cached `/networks` response.
     *
     * @private
     * @type {Promise<LayerswapNetwork[]> | null}
     */
    private _networksPromise;
    /**
     * Returns the Layerswap network/token catalog. Cached for the lifetime of this client.
     *
     * @returns {Promise<LayerswapNetwork[]>}
     */
    getNetworks(): Promise<LayerswapNetwork[]>;
    /**
     * Fetches a fee/receive quote for a prospective swap.
     *
     * @param {LayerswapGetQuoteParams} params
     * @returns {Promise<{ quote: LayerswapQuote }>}
     */
    getQuote(params: LayerswapGetQuoteParams): Promise<{
        quote: LayerswapQuote;
    }>;
    /**
     * Creates a new swap. Returns the swap id, the deposit actions, and the locked-in quote.
     *
     * @param {LayerswapCreateSwapParams} params
     * @returns {Promise<LayerswapSwapResponse>}
     */
    createSwap(params: LayerswapCreateSwapParams): Promise<LayerswapSwapResponse>;
    /**
     * Fetches the current state of a swap, including deposit actions and any input/output transactions.
     *
     * @param {string} swapId
     * @returns {Promise<LayerswapSwapResponse>}
     */
    getSwap(swapId: string): Promise<LayerswapSwapResponse>;
    /**
     * Informs Layerswap of a freshly broadcast deposit transaction. Best-effort; safe to ignore failures.
     *
     * @param {string} swapId
     * @param {string} transactionId
     * @returns {Promise<void>}
     */
    speedUpDeposit(swapId: string, transactionId: string): Promise<void>;
    /**
     * @private
     * @param {string} method
     * @param {string} path
     * @param {Object} [body]
     * @param {Object} [extraHeaders]
     * @returns {Promise<any>}
     */
    private _request;
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
export type LayerswapToken = {
    symbol: string;
    contract: string | null;
    decimals: number;
    price_in_usd?: number;
};
export type LayerswapNetwork = {
    name: string;
    chain_id: string | null;
    type: string;
    tokens: LayerswapToken[];
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
    type: "transfer" | "manual_transfer";
};
export type LayerswapSwap = {
    id: string;
    created_date: string;
    status: string;
    source_network: LayerswapNetwork;
    source_token: LayerswapToken;
    destination_network: LayerswapNetwork;
    destination_token: LayerswapToken;
    destination_address: string;
    requested_amount: number;
};
export type LayerswapSwapResponse = {
    swap: LayerswapSwap;
    deposit_actions?: LayerswapDepositAction[];
    quote?: {
        quote: LayerswapQuote;
    };
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
export type LayerswapApiClientConfig = {
    apiKey?: string;
    apiUrl?: string;
    requestTimeoutMs?: number;
};
