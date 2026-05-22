/** @typedef {import('@tetherto/wdk-wallet/protocols').BridgeProtocolConfig} BridgeProtocolConfig */
/** @typedef {import('@tetherto/wdk-wallet/protocols').BridgeResult} BridgeResult */
/** @typedef {import('@tetherto/wdk-wallet-evm').WalletAccountReadOnlyEvm} WalletAccountReadOnlyEvm */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').WalletAccountReadOnlyEvmErc4337} WalletAccountReadOnlyEvmErc4337 */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletPaymasterTokenConfig} EvmErc4337WalletPaymasterTokenConfig */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletSponsorshipPolicyConfig} EvmErc4337WalletSponsorshipPolicyConfig */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletNativeCoinsConfig} EvmErc4337WalletNativeCoinsConfig */
/** @typedef {import('./layerswap-api-client.js').LayerswapNetwork} LayerswapNetwork */
/** @typedef {import('./layerswap-api-client.js').LayerswapToken} LayerswapToken */
/** @typedef {import('./layerswap-api-client.js').LayerswapDepositAction} LayerswapDepositAction */
/** @typedef {import('./layerswap-api-client.js').LayerswapSwap} LayerswapSwap */
/** @typedef {import('./layerswap-api-client.js').LayerswapQuote} LayerswapQuote */
/**
 * @typedef {Object} LayerswapProtocolConfig
 * @property {string} [apiKey]                - Optional Layerswap API key. When set, sent as the
 *                                              `X-LS-APIKEY` header for rate-limit / partner attribution.
 * @property {string} [apiUrl]                - Layerswap API base URL. Default: `https://api.layerswap.io`.
 * @property {number | bigint} [bridgeMaxFee] - Maximum acceptable Layerswap swap fee, expressed in
 *                                              *source-token base units*. Compared against `bridgeFee`
 *                                              before broadcasting the deposit transaction.
 * @property {number} [requestTimeoutMs]      - HTTP timeout for Layerswap API calls. Default: 30000.
 */
/**
 * @typedef {Object} BridgeOptions
 * @property {string} targetChain             - Layerswap destination network name. Uses the
 *                                              `<CHAIN>_<ENV>` uppercase convention, e.g.
 *                                              `'ETHEREUM_MAINNET'`, `'ARBITRUM_MAINNET'`,
 *                                              `'ARBITRUM_SEPOLIA'`. Matching is case-insensitive
 *                                              but the canonical form is uppercase.
 * @property {string} recipient               - Destination-chain recipient address, in the
 *                                              destination chain's native format (Layerswap is
 *                                              HTTP-orchestrated and accepts the native string).
 * @property {string} token                   - Source token: contract address (0x…) OR Layerswap symbol.
 * @property {number | bigint} amount         - Source amount in base units (e.g., wei for ETH).
 * @property {string} [destinationToken]      - Destination token (address or symbol). Defaults to the
 *                                              source token's symbol.
 * @property {string} [sourceChain]           - Override auto-detected source network name.
 * @property {boolean} [refuel]               - Request a native-gas drop on the destination chain.
 * @property {string} [slippage]              - Slippage tolerance percentage, e.g. '0.5'.
 * @property {string} [referenceId]           - External reference id for the created swap.
 * @property {string} [refundAddress]         - Refund address used if the swap fails after deposit.
 */
/**
 * @typedef {BridgeResult & { swapId: string }} LayerswapBridgeResult
 */
/**
 * Bridge protocol that drives a Layerswap swap from an EVM wallet account.
 *
 * Unlike on-chain bridges (e.g., LayerZero OFTs) this protocol is HTTP-orchestrated:
 *   1. POST /api/v2/swaps to create a swap and receive deposit instructions.
 *   2. Submit the deposit transaction from the user's wallet to Layerswap's deposit address
 *      using the API-provided calldata.
 *   3. Layerswap performs the destination-chain payout off-chain.
 *
 * Semantic note: `BridgeResult.bridgeFee` is documented in `@tetherto/wdk-wallet` as
 * "native tokens paid to the bridge protocol". Layerswap deducts its fee from the
 * source-token amount instead, so we return `bridgeFee` in **source-token base units**.
 * Do not naively add `fee` (native gas) and `bridgeFee` together — they are in different
 * units. The `bridgeMaxFee` config compares against `bridgeFee` only.
 */
export default class LayerswapProtocolEvm extends BridgeProtocol {
    /**
     * Creates a new read-only interface to the layerswap protocol for evm blockchains.
     *
     * @overload
     * @param {WalletAccountReadOnlyEvm | WalletAccountReadOnlyEvmErc4337} account - The wallet account to use to interact with the protocol.
     * @param {LayerswapProtocolConfig} [config] - The layerswap protocol configuration.
     */
    constructor(account: WalletAccountReadOnlyEvm | WalletAccountReadOnlyEvmErc4337, config?: LayerswapProtocolConfig);
    /**
     * Creates a new interface to the layerswap protocol for evm blockchains.
     *
     * @overload
     * @param {WalletAccountEvm | WalletAccountEvmErc4337} account - The wallet account to use to interact with the protocol.
     * @param {LayerswapProtocolConfig} [config] - The layerswap protocol configuration.
     */
    constructor(account: WalletAccountEvm | WalletAccountEvmErc4337, config?: LayerswapProtocolConfig);
    /**
     * @private
     * @type {LayerswapApiClient}
     */
    private _client;
    /** @private */
    private _provider;
    /**
     * @private
     * @type {bigint | undefined}
     */
    private _chainId;
    /**
     * Bridges a token to a different blockchain via Layerswap.
     *
     * Resolves once the source-chain deposit transaction has been broadcast. Layerswap
     * finishes the destination-chain payout asynchronously; callers can use
     * `getApiClient().getSwap(swapId)` to track destination delivery, using the `swapId`
     * field on the returned result.
     *
     * Semantic note: `bridgeFee` is in **source-token base units**, not native wei.
     * See class JSDoc for the rationale.
     *
     * @param {BridgeOptions} options - The bridge's options.
     * @param {Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig> & Pick<LayerswapProtocolConfig, 'bridgeMaxFee'>} [config] - If
     *   the protocol has been initialized with an erc-4337 wallet account, it can be used to
     *   override its configuration options along with the 'bridgeMaxFee' option.
     * @returns {Promise<LayerswapBridgeResult>} The bridge's result, augmented with the Layerswap swap id.
     */
    bridge(options: BridgeOptions, config?: Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig> & Pick<LayerswapProtocolConfig, "bridgeMaxFee">): Promise<LayerswapBridgeResult>;
    /**
     * Quotes the costs of a Layerswap bridge operation without creating a swap.
     *
     * The reported `fee` is an approximation of the source-chain gas cost (estimated via
     * `quoteTransfer` for ERC-20 tokens or `quoteSendTransaction` for native sends).
     *
     * Semantic note: `bridgeFee` is in **source-token base units**, not native wei.
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
     * @returns {Promise<{ depositTx: { to: string, value: bigint, data: string }, bridgeFee: bigint, swapId: string }>}
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
     * additional `manual_transfer` actions for non-EOA flows; those are ignored here.
     *
     * @private
     * @param {LayerswapDepositAction[]} depositActions
     * @returns {LayerswapDepositAction}
     */
    private _pickWalletDepositAction;
    /**
     * Estimates source-chain gas cost without creating a swap. Uses `quoteTransfer` for ERC-20
     * tokens and `quoteSendTransaction` for native sends; both yield gas figures representative
     * of the actual deposit transaction (an ERC-20 transfer or a plain native send to Layerswap).
     *
     * @private
     * @param {LayerswapToken} sourceToken
     * @param {bigint} amount
     * @param {string} sourceAddress
     * @returns {Promise<bigint>}
     */
    private _estimateSourceGas;
    /**
     * Reads the source chain id via the ethers provider. Cached for the lifetime of the
     * protocol instance.
     *
     * @private
     * @returns {Promise<bigint>}
     */
    private _getChainId;
    /**
     * Informs Layerswap that the deposit has been broadcast. Best-effort — failures are
     * swallowed because Layerswap's watcher will still detect the on-chain deposit on its
     * own. Awaited (rather than fire-and-forget) so the API call's lifetime is bounded by
     * `bridge()`'s return.
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
export type WalletAccountReadOnlyEvm = import("@tetherto/wdk-wallet-evm").WalletAccountReadOnlyEvm;
export type WalletAccountReadOnlyEvmErc4337 = import("@tetherto/wdk-wallet-evm-erc-4337").WalletAccountReadOnlyEvmErc4337;
export type EvmErc4337WalletPaymasterTokenConfig = import("@tetherto/wdk-wallet-evm-erc-4337").EvmErc4337WalletPaymasterTokenConfig;
export type EvmErc4337WalletSponsorshipPolicyConfig = import("@tetherto/wdk-wallet-evm-erc-4337").EvmErc4337WalletSponsorshipPolicyConfig;
export type EvmErc4337WalletNativeCoinsConfig = import("@tetherto/wdk-wallet-evm-erc-4337").EvmErc4337WalletNativeCoinsConfig;
export type LayerswapNetwork = import("./layerswap-api-client.js").LayerswapNetwork;
export type LayerswapToken = import("./layerswap-api-client.js").LayerswapToken;
export type LayerswapDepositAction = import("./layerswap-api-client.js").LayerswapDepositAction;
export type LayerswapSwap = import("./layerswap-api-client.js").LayerswapSwap;
export type LayerswapQuote = import("./layerswap-api-client.js").LayerswapQuote;
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
     * - Layerswap destination network name. Uses the
     *   `<CHAIN>_<ENV>` uppercase convention, e.g.
     *   `'ETHEREUM_MAINNET'`, `'ARBITRUM_MAINNET'`,
     *   `'ARBITRUM_SEPOLIA'`. Matching is case-insensitive
     *   but the canonical form is uppercase.
     */
    targetChain: string;
    /**
     * - Destination-chain recipient address, in the
     *   destination chain's native format (Layerswap is
     *   HTTP-orchestrated and accepts the native string).
     */
    recipient: string;
    /**
     * - Source token: contract address (0x…) OR Layerswap symbol.
     */
    token: string;
    /**
     * - Source amount in base units (e.g., wei for ETH).
     */
    amount: number | bigint;
    /**
     * - Destination token (address or symbol). Defaults to the
     *         source token's symbol.
     */
    destinationToken?: string;
    /**
     * - Override auto-detected source network name.
     */
    sourceChain?: string;
    /**
     * - Request a native-gas drop on the destination chain.
     */
    refuel?: boolean;
    /**
     * - Slippage tolerance percentage, e.g. '0.5'.
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
import LayerswapApiClient from './layerswap-api-client.js';
import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm';
import { WalletAccountEvmErc4337 } from '@tetherto/wdk-wallet-evm-erc-4337';
