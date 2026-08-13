/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeProtocolConfig} SwidgeProtocolConfig */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeOptions} SwidgeOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeQuote} SwidgeQuote */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeResult} SwidgeResult */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeFee} SwidgeFee */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeStatusOptions} SwidgeStatusOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeStatusResult} SwidgeStatusResult */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedChain} SwidgeSupportedChain */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedToken} SwidgeSupportedToken */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedTokensOptions} SwidgeSupportedTokensOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').BridgeResult} BridgeResult */
/** @typedef {import('@tetherto/wdk-wallet-evm').WalletAccountEvm} WalletAccountEvm */
/** @typedef {import('@tetherto/wdk-wallet-evm').WalletAccountReadOnlyEvm} WalletAccountReadOnlyEvm */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').WalletAccountEvmErc4337} WalletAccountEvmErc4337 */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').WalletAccountReadOnlyEvmErc4337} WalletAccountReadOnlyEvmErc4337 */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletPaymasterTokenConfig} EvmErc4337WalletPaymasterTokenConfig */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletSponsorshipPolicyConfig} EvmErc4337WalletSponsorshipPolicyConfig */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletNativeCoinsConfig} EvmErc4337WalletNativeCoinsConfig */
/** @typedef {import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapNetwork} LayerswapNetwork */
/** @typedef {import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapToken} LayerswapToken */
/** @typedef {import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapDepositAction} LayerswapDepositAction */
/** @typedef {import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapSwap} LayerswapSwap */
/** @typedef {import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapQuote} LayerswapQuote */
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
 *                                              *source-token base units*. Compared against the total
 *                                              Layerswap fee before broadcasting the deposit transaction.
 * @property {number} [requestTimeoutMs]      - HTTP timeout for Layerswap API calls. Default: 30000.
 */
/**
 * Layerswap-specific extensions to the WDK swidge options.
 *
 * @typedef {SwidgeOptions & Object} LayerswapSwidgeOptions
 * @property {string | number} [fromChain]    - Layerswap source network name (e.g. `'ETHEREUM_MAINNET'`).
 *                                              Defaults to the network of the account's connected provider.
 * @property {boolean} [refuel]               - Request a native-gas drop on the destination chain.
 * @property {string} [referenceId]           - External reference id for the created swap.
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
 * WDK swidge protocol that drives a Layerswap swap from an EVM wallet account.
 *
 * Implements the `SwidgeProtocol` interface from `@tetherto/wdk-wallet/protocols`:
 * `quoteSwidge` / `swidge` / `getSwidgeStatus` / `getSupportedChains` / `getSupportedTokens`,
 * which also provides the WDK `swap`/`bridge` module surfaces via the base class.
 *
 * Unlike on-chain bridges (e.g., LayerZero OFTs) this protocol is HTTP-orchestrated:
 *   1. POST /api/v2/swaps to create a swap and receive deposit instructions.
 *   2. Submit the deposit transaction from the user's wallet to Layerswap's deposit address
 *      using the API-provided calldata.
 *   3. Layerswap performs the destination-chain payout off-chain.
 *
 * `swidge()` resolves once the source-chain deposit transaction has been broadcast; the
 * destination payout completes asynchronously and can be tracked with
 * `getSwidgeStatus(result.id)`.
 *
 * Fee semantics: Layerswap deducts its fees from the source-token amount, so 'protocol'
 * and Layerswap's destination 'network' fee entries are denominated in the **source
 * token** and flagged `included: true`. Source-chain gas is a separate non-included
 * 'network' fee in the **native token**. Do not sum amounts across fee entries with
 * different `token` values.
 */
export default class LayerswapProtocolEvm extends SwidgeProtocol {
    /**
     * Creates a new swidge protocol for chain/token discovery only, without a wallet account.
     *
     * @overload
     * @param {undefined} [account] - No account; only discovery and `fromChain`-scoped quotes work.
     * @param {LayerswapProtocolConfig} [config] - The layerswap protocol configuration.
     */
    constructor(account?: undefined, config?: LayerswapProtocolConfig);
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
     * Quotes the estimated costs and output of a Layerswap swidge operation without
     * creating a swap. Layerswap only supports exact-in operations; passing
     * `toTokenAmount` throws.
     *
     * When the protocol has an account bound, the quote includes a non-included
     * 'network' fee entry with the estimated source-chain gas (in native units).
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
     * @param {SwidgeProtocolConfig & Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig> & Pick<LayerswapProtocolConfig, 'bridgeMaxFee'>} [config] - Optional
     *   execution configuration. With an erc-4337 account, wallet configuration overrides are
     *   forwarded to `sendTransaction`.
     * @returns {Promise<SwidgeResult>} The swidge execution result. `id` is the Layerswap swap
     *   id (use it with `getSwidgeStatus`); `hash` is the source-chain deposit transaction hash.
     */
    swidge(options: LayerswapSwidgeOptions, config?: SwidgeProtocolConfig & Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig> & Pick<LayerswapProtocolConfig, "bridgeMaxFee">): Promise<SwidgeResult>;
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
     * transaction hash (not the swap id), and the Layerswap swap id is returned in the
     * extra `swapId` field.
     *
     * Semantic note: `bridgeFee` is in **source-token base units**, not native wei —
     * it is the total fee Layerswap deducts from the source amount. `fee` is the
     * source-chain gas cost in native units. Do not sum them.
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
     * Legacy WDK bridge-module surface, kept for backwards compatibility. `fee` is the
     * estimated source-chain gas in native units; `bridgeFee` is Layerswap's total fee
     * in source-token base units. See `bridge()` for the semantics.
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
     * follow-up after `swidge()` returns — even if the broadcast resolved, the tx
     * can still revert or be dropped from the mempool. Returns `'completed' | 'failed' |
     * 'pending'`.
     *
     * The source network defaults to the wallet's connected provider (resolved via
     * `provider.getNetwork().chainId`); pass `options.sourceChain` to override.
     *
     * @param {string} txHash - The on-chain transaction hash returned by `swidge()`.
     * @param {{ sourceChain?: string }} [options]
     * @returns {Promise<import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapTransactionStatus>}
     */
    getTransactionStatus(txHash: string, options?: {
        sourceChain?: string;
    }): Promise<import("@layerswap/wdk-protocol-bridge-layerswap-core").LayerswapTransactionStatus>;
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
     * `fee` = non-included fees (source-chain gas, native units), `bridgeFee` = included
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
     * Creates the Layerswap swap and derives the deposit transaction from the returned
     * wallet-flow deposit action.
     *
     * @private
     * @param {LayerswapSwidgeOptions} options
     * @param {{ sourceNetwork: LayerswapNetwork, sourceToken: LayerswapToken, destinationNetwork: LayerswapNetwork, destinationToken: LayerswapToken }} route
     * @param {bigint} fromTokenAmount
     * @returns {Promise<{ swap: LayerswapSwap, depositTx: { to: string, value: bigint, data: string }, quote: LayerswapQuote | undefined }>}
     */
    private _createSwap;
    /**
     * @private
     * @returns {Promise<LayerswapNetwork>}
     */
    private _detectSourceNetwork;
    /**
     * @private
     * @returns {Promise<string>}
     */
    private _detectSourceNetworkName;
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
     * Tests whether the bound account is a writable EVM wallet account
     * (i.e. exposes `sendTransaction` as a callable). This is a duck-type check
     * rather than an `instanceof WalletAccountEvm | WalletAccountEvmErc4337`
     * check because pnpm-workspace setups can resolve `@tetherto/wdk-wallet-evm`
     * (and -erc-4337) to a different copy than this package's own when the dep
     * tree's peer-dep contexts diverge — `instanceof` would then fail on a
     * structurally-correct account.
     *
     * @private
     * @param {unknown} account
     * @returns {boolean}
     */
    private _isWritableAccount;
    /**
     * Tests whether the bound account is an ERC-4337 wallet account. Distinguishes
     * the routing in `swidge()` — ERC-4337 uses the array-form `sendTransaction([tx], config)`,
     * standard EVM uses single-form `sendTransaction(tx)`. Matched by class name (preserved
     * across duplicate copies of the wallet package) to dodge the same duplicate-copy
     * `instanceof` failure as `_isWritableAccount`.
     *
     * @private
     * @param {unknown} account
     * @returns {boolean}
     */
    private _isErc4337Account;
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
export type SwidgeStatusOptions = import("@tetherto/wdk-wallet/protocols").SwidgeStatusOptions;
export type SwidgeStatusResult = import("@tetherto/wdk-wallet/protocols").SwidgeStatusResult;
export type SwidgeSupportedChain = import("@tetherto/wdk-wallet/protocols").SwidgeSupportedChain;
export type SwidgeSupportedToken = import("@tetherto/wdk-wallet/protocols").SwidgeSupportedToken;
export type SwidgeSupportedTokensOptions = import("@tetherto/wdk-wallet/protocols").SwidgeSupportedTokensOptions;
export type BridgeResult = import("@tetherto/wdk-wallet/protocols").BridgeResult;
export type WalletAccountEvm = import("@tetherto/wdk-wallet-evm").WalletAccountEvm;
export type WalletAccountReadOnlyEvm = import("@tetherto/wdk-wallet-evm").WalletAccountReadOnlyEvm;
export type WalletAccountEvmErc4337 = import("@tetherto/wdk-wallet-evm-erc-4337").WalletAccountEvmErc4337;
export type WalletAccountReadOnlyEvmErc4337 = import("@tetherto/wdk-wallet-evm-erc-4337").WalletAccountReadOnlyEvmErc4337;
export type EvmErc4337WalletPaymasterTokenConfig = import("@tetherto/wdk-wallet-evm-erc-4337").EvmErc4337WalletPaymasterTokenConfig;
export type EvmErc4337WalletSponsorshipPolicyConfig = import("@tetherto/wdk-wallet-evm-erc-4337").EvmErc4337WalletSponsorshipPolicyConfig;
export type EvmErc4337WalletNativeCoinsConfig = import("@tetherto/wdk-wallet-evm-erc-4337").EvmErc4337WalletNativeCoinsConfig;
export type LayerswapNetwork = import("@layerswap/wdk-protocol-bridge-layerswap-core").LayerswapNetwork;
export type LayerswapToken = import("@layerswap/wdk-protocol-bridge-layerswap-core").LayerswapToken;
export type LayerswapDepositAction = import("@layerswap/wdk-protocol-bridge-layerswap-core").LayerswapDepositAction;
export type LayerswapSwap = import("@layerswap/wdk-protocol-bridge-layerswap-core").LayerswapSwap;
export type LayerswapQuote = import("@layerswap/wdk-protocol-bridge-layerswap-core").LayerswapQuote;
export type LayerswapProtocolConfig = SwidgeProtocolConfig & any;
/**
 * Layerswap-specific extensions to the WDK swidge options.
 */
export type LayerswapSwidgeOptions = SwidgeOptions & any;
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
import { SwidgeProtocol } from '@tetherto/wdk-wallet/protocols';
import LayerswapApiClient from '@layerswap/wdk-protocol-bridge-layerswap-core';
