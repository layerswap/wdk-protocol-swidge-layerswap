/**
 * WDK swidge protocol that drives a Layerswap swap from a Solana wallet account. The
 * chain-agnostic swidge logic lives in `LayerswapSwidgeProtocol`
 * (`@layerswap/wdk-protocol-swidge-layerswap-core`); this class only implements the Solana
 * specifics: source cluster detection and the deposit transaction.
 *
 * Layerswap returns the deposit as `call_data`: a base64-encoded, unsigned Solana
 * transaction. It is decoded into a transaction message with a fresh blockhash, then
 * quoted, signed and broadcast through the wallet account
 * (`account.quoteSendTransaction(message)` / `account.sendTransaction(message)`). The
 * source cluster is detected through the rpc client the wallet account was built with
 * (`account._rpc`), so every provider shape supported by the wallet — rpc url, rpc client
 * or a fail-over list of them — works as-is.
 *
 * @extends {LayerswapSwidgeProtocol}
 */
export default class LayerswapProtocolSolana extends LayerswapSwidgeProtocol<import("@layerswap/wdk-protocol-swidge-layerswap-core/types/src/layerswap-swidge-protocol.js").LayerswapSwidgeOptions, import("@layerswap/wdk-protocol-swidge-layerswap-core/types/src/layerswap-swidge-protocol.js").LayerswapSwidgeConfig, import("@layerswap/wdk-protocol-swidge-layerswap-core/types/src/layerswap-swidge-protocol.js").LayerswapBridgeOptions, import("@layerswap/wdk-protocol-swidge-layerswap-core/types/src/layerswap-swidge-protocol.js").LayerswapBridgeConfig> {
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
     * The Solana rpc client the wallet account was built with. Reused as-is instead of
     * rebuilding one from `account._config.provider`, so that every provider shape the
     * wallet supports (rpc url, rpc client, or a list of them wrapped in the wdk fail-over
     * provider) is honoured.
     *
     * @private
     * @type {SolanaRpc | undefined}
     */
    private _rpc;
    /**
     * @private
     * @type {LayerswapNetwork | undefined}
     */
    private _sourceNetwork;
    /**
     * @private
     * @type {string | undefined}
     */
    private _genesisHash;
    /**
     * Reads the genesis hash of the cluster the account's rpc client is connected to. Cached
     * for the lifetime of the protocol instance.
     *
     * @private
     * @returns {Promise<string>} The genesis hash.
     * @throws {ProviderError} If the rpc fails to report the genesis hash.
     */
    private _getGenesisHash;
    /**
     * Checks that the wallet account is connected to an rpc, which the deposit needs.
     *
     * @protected
     * @param {LayerswapSwidgeRoute} route - The resolved swidge route.
     * @throws {ProviderRequiredError} If the account is not connected to a provider.
     */
    protected _assertSwidgeRoute(route: LayerswapSwidgeRoute): void;
    /**
     * Validates the deposit transaction returned by Layerswap, and quotes its fee through the
     * wallet account.
     *
     * @protected
     * @param {LayerswapDepositContext} context - The deposit context.
     * @returns {Promise<LayerswapSolanaPreparedDeposit>} The prepared deposit.
     * @throws {ValueError} If the deposit transaction is malformed.
     * @throws {ProviderError} If the rpc fails.
     */
    protected _prepareDeposit({ action }: LayerswapDepositContext): Promise<LayerswapSolanaPreparedDeposit>;
    /**
     * Turns Layerswap's `call_data` into a transaction message the wallet account signs.
     * Like the Layerswap app, the `call_data` is treated as an unsigned template: its
     * signatures (Layerswap sends none) are dropped, and its blockhash is replaced by a
     * fresh one, since the one Layerswap set may expire before the deposit is signed.
     * The wallet account rejects the message if its fee payer is not the account.
     *
     * @private
     * @param {string} callData - The base64-encoded deposit transaction.
     * @returns {Promise<SolanaTransactionMessage>} The deposit transaction message.
     * @throws {ValueError} If the deposit transaction is malformed.
     * @throws {ProviderError} If the rpc fails.
     */
    private _buildDepositMessage;
    /**
     * Signs and broadcasts the deposit transaction through the wallet account.
     *
     * @protected
     * @param {LayerswapSolanaPreparedDeposit} deposit - The prepared deposit.
     * @returns {Promise<LayerswapBroadcastDeposit>} The broadcast deposit.
     * @throws {ProviderError} If the rpc fails to broadcast the deposit.
     * @throws {MaximumFeeExceededError} If the wallet rejects the transaction fee.
     */
    protected _sendDeposit({ message }: LayerswapSolanaPreparedDeposit): Promise<LayerswapBroadcastDeposit>;
}
export type IWalletAccountReadOnly = import("@tetherto/wdk-wallet").IWalletAccountReadOnly;
export type WalletAccountSolana = import("@tetherto/wdk-wallet-solana").WalletAccountSolana;
export type WalletAccountReadOnlySolana = import("@tetherto/wdk-wallet-solana").WalletAccountReadOnlySolana;
export type SolanaRpc = WalletAccountReadOnlySolana["_rpc"];
export type LayerswapNetwork = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapNetwork;
export type LayerswapProtocolConfig = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapProtocolConfig;
export type LayerswapSwidgeRoute = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapSwidgeRoute;
export type LayerswapDepositContext = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapDepositContext;
export type LayerswapBroadcastDeposit = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapBroadcastDeposit;
export type SolanaTransactionMessage = import("@solana/kit").BaseTransactionMessage;
export type LayerswapSolanaPreparedDeposit = {
    /**
     * - The unsigned deposit transaction message, with a fresh blockhash.
     */
    message: SolanaTransactionMessage;
    /**
     * - The estimated fee of the deposit transaction (in lamports).
     */
    fee: bigint;
};
import { LayerswapSwidgeProtocol } from '@layerswap/wdk-protocol-swidge-layerswap-core';
