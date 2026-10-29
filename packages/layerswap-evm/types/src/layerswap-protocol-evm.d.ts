import { LayerswapSwidgeProtocol } from '@layerswap/wdk-protocol-swidge-layerswap-core';
export type Provider = import('ethers').Provider;
export type WalletAccountEvm = import('@tetherto/wdk-wallet-evm').WalletAccountEvm;
export type WalletAccountReadOnlyEvm = import('@tetherto/wdk-wallet-evm').WalletAccountReadOnlyEvm;
export type WalletAccountEvmErc4337 = import('@tetherto/wdk-wallet-evm-erc-4337').WalletAccountEvmErc4337;
export type WalletAccountReadOnlyEvmErc4337 = import('@tetherto/wdk-wallet-evm-erc-4337').WalletAccountReadOnlyEvmErc4337;
export type EvmErc4337WalletPaymasterTokenConfig = import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletPaymasterTokenConfig;
export type EvmErc4337WalletSponsorshipPolicyConfig = import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletSponsorshipPolicyConfig;
export type EvmErc4337WalletNativeCoinsConfig = import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletNativeCoinsConfig;
export type LayerswapNetwork = import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapNetwork;
export type LayerswapToken = import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapToken;
export type LayerswapProtocolConfig = import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapProtocolConfig;
export type LayerswapSwidgeOptions = import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSwidgeOptions;
export type LayerswapSwidgeConfig = import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSwidgeConfig;
export type LayerswapBridgeConfig = import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapBridgeConfig;
export type LayerswapBridgeOptions = import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapBridgeOptions;
export type LayerswapSwidgeRoute = import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSwidgeRoute;
export type LayerswapDepositContext = import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapDepositContext;
export type LayerswapBroadcastDeposit = import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapBroadcastDeposit;
export type LayerswapEvmErc4337Overrides = Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig>;
export type LayerswapEvmBridgeConfig = LayerswapBridgeConfig & LayerswapEvmErc4337Overrides;
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
/** @typedef {import('ethers').Provider} Provider */
/** @typedef {import('@tetherto/wdk-wallet-evm').WalletAccountEvm} WalletAccountEvm */
/** @typedef {import('@tetherto/wdk-wallet-evm').WalletAccountReadOnlyEvm} WalletAccountReadOnlyEvm */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').WalletAccountEvmErc4337} WalletAccountEvmErc4337 */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').WalletAccountReadOnlyEvmErc4337} WalletAccountReadOnlyEvmErc4337 */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletPaymasterTokenConfig} EvmErc4337WalletPaymasterTokenConfig */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletSponsorshipPolicyConfig} EvmErc4337WalletSponsorshipPolicyConfig */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletNativeCoinsConfig} EvmErc4337WalletNativeCoinsConfig */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapNetwork} LayerswapNetwork */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapToken} LayerswapToken */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapProtocolConfig} LayerswapProtocolConfig */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSwidgeOptions} LayerswapSwidgeOptions */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSwidgeConfig} LayerswapSwidgeConfig */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapBridgeConfig} LayerswapBridgeConfig */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapBridgeOptions} LayerswapBridgeOptions */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSwidgeRoute} LayerswapSwidgeRoute */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapDepositContext} LayerswapDepositContext */
/** @typedef {import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapBroadcastDeposit} LayerswapBroadcastDeposit */
/**
 * Wallet configuration overrides of an erc-4337 account, forwarded to `sendTransaction`.
 *
 * @typedef {Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig>} LayerswapEvmErc4337Overrides
 */
/**
 * Optional execution configuration of the `bridge` method: the 'bridgeMaxFee' option and,
 * with an erc-4337 account, the wallet configuration overrides.
 *
 * @typedef {LayerswapBridgeConfig & LayerswapEvmErc4337Overrides} LayerswapEvmBridgeConfig
 */
/**
 * Optional execution configuration of the `swidge` method: the WDK swidge fee guards, the
 * 'bridgeMaxFee' option and, with an erc-4337 account, the wallet configuration overrides.
 *
 * @typedef {LayerswapSwidgeConfig & LayerswapEvmErc4337Overrides} LayerswapEvmSwidgeConfig
 */
/**
 * @typedef {Object} LayerswapEvmDepositTransaction
 * @property {string} to - The Layerswap deposit address (or the token contract for erc-20 deposits).
 * @property {bigint} value - The amount of native tokens to send (in base unit).
 * @property {string} data - The call data.
 */
/**
 * @typedef {Object} LayerswapEvmPreparedDeposit
 * @property {LayerswapEvmDepositTransaction} tx - The deposit transaction to broadcast.
 * @property {bigint} fee - The estimated gas cost of the deposit (in wei).
 */
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
export default class LayerswapProtocolEvm extends LayerswapSwidgeProtocol<LayerswapSwidgeOptions, LayerswapEvmSwidgeConfig, LayerswapBridgeOptions, LayerswapEvmBridgeConfig> {
    /**
     * The ethers provider the wallet account was built with. Reused as-is instead of
     * rebuilding one from `account._config.provider`, so that every provider shape the
     * wallet supports (rpc url, eip-1193 provider, ethers provider, or a list of them
     * wrapped in the wdk fail-over provider) is honoured.
     *
     * @private
     * @type {Provider | undefined}
     */
    _provider;
    /**
     * @private
     * @type {bigint | undefined}
     */
    _chainId;
    constructor(account?: undefined, config?: LayerswapProtocolConfig);
    constructor(account: WalletAccountReadOnlyEvm | WalletAccountReadOnlyEvmErc4337, config?: LayerswapProtocolConfig);
    constructor(account: WalletAccountEvm | WalletAccountEvmErc4337, config?: LayerswapProtocolConfig);
    /** @protected */
    protected get _nativeTokenSymbol(): string;
    /**
     * Detects the source network from the chain id of the account's provider.
     *
     * @protected
     * @returns {Promise<LayerswapNetwork>} The source network.
     * @throws {ValueError} If Layerswap does not support the connected chain.
     * @throws {ProviderRequiredError} If the account is not connected to a provider.
     * @throws {ProviderError} If the provider fails to report the chain id.
     */
    protected _detectSourceNetwork(): Promise<LayerswapNetwork>;
    /**
     * Estimates the source-chain gas of the deposit without creating a swap. Uses
     * `quoteTransfer` for erc-20 tokens and `quoteSendTransaction` for native sends; both
     * yield gas figures representative of the actual deposit transaction.
     *
     * @protected
     * @param {LayerswapSwidgeRoute} route - The resolved swidge route.
     * @param {bigint} amount - The input amount in source-token base units.
     * @param {string} sourceAddress - The address of the bound account.
     * @returns {Promise<bigint | undefined>} The estimated gas, in wei.
     */
    protected _quoteSourceGas(route: LayerswapSwidgeRoute, amount: bigint, sourceAddress: string): Promise<bigint | undefined>;
    /**
     * Builds the deposit transaction from the Layerswap deposit action, and quotes its gas.
     *
     * @protected
     * @param {LayerswapDepositContext} context - The deposit context.
     * @returns {Promise<LayerswapEvmPreparedDeposit>} The prepared deposit.
     * @throws {ProviderError} If the deposit action is malformed, or the provider fails.
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
     * Runs a wallet account (or provider) call, normalizing its errors. Insufficient-funds
     * rejections of the node become a `SwidgeError` with reason `INSUFFICIENT_BALANCE`.
     *
     * @protected
     * @template T
     * @param {() => Promise<T>} call - The wallet call.
     * @returns {Promise<T>} The call's result.
     * @throws {SwidgeError} If the account has insufficient funds.
     * @throws {ProviderError} If the call fails with an error outside of the swidge contract.
     */
    protected _callWallet<T>(call: () => Promise<T>): Promise<T>;
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
     * @param {unknown} account - The bound account.
     * @returns {boolean} True if the account is an erc-4337 account.
     */
    private _isErc4337Account;
}
