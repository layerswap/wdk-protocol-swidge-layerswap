/**
 * WDK swidge protocol that drives a Layerswap swap from an EVM wallet account (standard
 * or erc-4337). The chain-agnostic swidge logic lives in `LayerswapSwidgeProtocol`
 * (`@layerswap/wdk-protocol-swidge-layerswap-core`); this class only implements the EVM
 * specifics: source chain detection and the deposit transaction.
 *
 * The source chain is detected through the provider the wallet account was built with
 * (`account._provider`), so every provider shape supported by the wallet — rpc url,
 * eip-1193 provider, ethers provider or a fail-over list of them — works as-is.
 *
 * @extends {LayerswapSwidgeProtocol<LayerswapSwidgeOptions, LayerswapEvmSwidgeConfig, LayerswapBridgeOptions, LayerswapEvmBridgeConfig>}
 */
export default class LayerswapProtocolEvm extends LayerswapSwidgeProtocol<import("@layerswap/wdk-protocol-swidge-layerswap-core/types/src/layerswap-swidge-protocol.js").LayerswapSwidgeOptions, LayerswapEvmSwidgeConfig, import("@layerswap/wdk-protocol-swidge-layerswap-core/types/src/layerswap-swidge-protocol.js").LayerswapBridgeOptions, LayerswapEvmBridgeConfig> {
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
     * The ethers provider the wallet account was built with. Reused as-is instead of
     * rebuilding one from `account._config.provider`, so that every provider shape the
     * wallet supports (rpc url, eip-1193 provider, ethers provider, or a list of them
     * wrapped in the wdk fail-over provider) is honoured.
     *
     * @private
     * @type {Provider | undefined}
     */
    private _provider;
    /**
     * @private
     * @type {bigint | undefined}
     */
    private _chainId;
    /**
     * Builds the deposit transaction from the Layerswap deposit action, and quotes its gas.
     *
     * @protected
     * @param {LayerswapDepositContext} context - The deposit context.
     * @returns {Promise<LayerswapEvmPreparedDeposit>} The prepared deposit.
     * @throws {ValueError} If the deposit action is malformed.
     * @throws {ProviderError} If the provider fails.
     * @throws {SwidgeError} If the account has insufficient funds.
     */
    protected _prepareDeposit({ action, route, fromTokenAmount, config }: LayerswapDepositContext): Promise<LayerswapEvmPreparedDeposit>;
    /**
     * Broadcasts the deposit transaction. With an erc-4337 account, the wallet configuration
     * overrides are forwarded to `sendTransaction`.
     *
     * @protected
     * @param {LayerswapEvmPreparedDeposit} deposit - The prepared deposit.
     * @param {LayerswapEvmSwidgeConfig} [config] - The swidge execution configuration.
     * @returns {Promise<LayerswapBroadcastDeposit>} The broadcast deposit.
     * @throws {ProviderError} If the provider fails to broadcast the deposit.
     * @throws {SwidgeError} If the account has insufficient funds.
     * @throws {MaximumFeeExceededError} If the wallet rejects the transaction fee.
     */
    protected _sendDeposit({ tx }: LayerswapEvmPreparedDeposit, config?: LayerswapEvmSwidgeConfig): Promise<LayerswapBroadcastDeposit>;
    /**
     * Reads the source chain id via the account's provider. Cached for the lifetime of the
     * protocol instance.
     *
     * @private
     * @returns {Promise<bigint>} The chain id.
     * @throws {ProviderRequiredError} If the account is not connected to a provider.
     * @throws {ProviderError} If the provider fails to report the chain id.
     */
    private _getChainId;
    /**
     * Parses the call data of a Layerswap deposit action. An erc-20 deposit is a call to the
     * token contract, so it cannot be sent without call data; a native deposit may have none.
     *
     * @private
     * @param {string | null | undefined} callData - The call data of the deposit action.
     * @param {boolean} isErc20 - True if the source token is an erc-20 token.
     * @returns {string} The call data (`'0x'` when a native deposit has none).
     * @throws {ValueError} If the call data is malformed, or missing for an erc-20 deposit.
     */
    private _parseCallData;
    /**
     * @private
     * @param {LayerswapToken} token - The token.
     * @returns {boolean} True if the token is an erc-20 token (has a contract address).
     */
    private _isErc20;
    /**
     * Tests whether the bound account is an ERC-4337 wallet account. ERC-4337 uses the
     * array-form `sendTransaction([tx], config)`, standard EVM the single-form
     * `sendTransaction(tx)`. Matched by class name (preserved across duplicate copies of the
     * wallet package) to dodge the same duplicate-copy `instanceof` failure as
     * `_isWritableAccount`.
     *
     * @private
     * @param {IWalletAccount} account - The bound account.
     * @returns {boolean} True if the account is an erc-4337 account.
     */
    private _isErc4337Account;
}
export type Provider = import("ethers").Provider;
export type IWalletAccount = import("@tetherto/wdk-wallet").IWalletAccount;
export type WalletAccountEvm = import("@tetherto/wdk-wallet-evm").WalletAccountEvm;
export type WalletAccountReadOnlyEvm = import("@tetherto/wdk-wallet-evm").WalletAccountReadOnlyEvm;
export type WalletAccountEvmErc4337 = import("@tetherto/wdk-wallet-evm-erc-4337").WalletAccountEvmErc4337;
export type WalletAccountReadOnlyEvmErc4337 = import("@tetherto/wdk-wallet-evm-erc-4337").WalletAccountReadOnlyEvmErc4337;
export type EvmErc4337WalletPaymasterTokenConfig = import("@tetherto/wdk-wallet-evm-erc-4337").EvmErc4337WalletPaymasterTokenConfig;
export type EvmErc4337WalletSponsorshipPolicyConfig = import("@tetherto/wdk-wallet-evm-erc-4337").EvmErc4337WalletSponsorshipPolicyConfig;
export type EvmErc4337WalletNativeCoinsConfig = import("@tetherto/wdk-wallet-evm-erc-4337").EvmErc4337WalletNativeCoinsConfig;
export type LayerswapNetwork = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapNetwork;
export type LayerswapToken = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapToken;
export type LayerswapProtocolConfig = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapProtocolConfig;
export type LayerswapSwidgeOptions = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapSwidgeOptions;
export type LayerswapSwidgeConfig = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapSwidgeConfig;
export type LayerswapBridgeConfig = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapBridgeConfig;
export type LayerswapBridgeOptions = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapBridgeOptions;
export type LayerswapSwidgeRoute = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapSwidgeRoute;
export type LayerswapDepositContext = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapDepositContext;
export type LayerswapBroadcastDeposit = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapBroadcastDeposit;
/**
 * Wallet configuration overrides of an erc-4337 account, forwarded to `sendTransaction`.
 */
export type LayerswapEvmErc4337Overrides = Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig>;
/**
 * Optional execution configuration of the `bridge` method: the 'bridgeMaxFee' option and,
 * with an erc-4337 account, the wallet configuration overrides.
 */
export type LayerswapEvmBridgeConfig = LayerswapBridgeConfig & LayerswapEvmErc4337Overrides;
/**
 * Optional execution configuration of the `swidge` method: the WDK swidge fee guards, the
 * 'bridgeMaxFee' option and, with an erc-4337 account, the wallet configuration overrides.
 */
export type LayerswapEvmSwidgeConfig = LayerswapSwidgeConfig & LayerswapEvmErc4337Overrides;
export type LayerswapEvmDepositTransaction = {
    /**
     * - The Layerswap deposit address (or the token contract for erc-20 deposits).
     */
    to: string;
    /**
     * - The amount of native tokens to send (in base unit).
     */
    value: bigint;
    /**
     * - The call data.
     */
    data: string;
};
export type LayerswapEvmPreparedDeposit = {
    /**
     * - The deposit transaction to broadcast.
     */
    tx: LayerswapEvmDepositTransaction;
    /**
     * - The estimated gas cost of the deposit (in wei).
     */
    fee: bigint;
};
import { LayerswapSwidgeProtocol } from '@layerswap/wdk-protocol-swidge-layerswap-core';
