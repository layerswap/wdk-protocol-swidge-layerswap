import { LayerswapSwidgeProtocol } from '@layerswap/wdk-protocol-swidge-layerswap-core';
export type WalletAccountSolana = import('@tetherto/wdk-wallet-solana').WalletAccountSolana;
export type WalletAccountReadOnlySolana = import('@tetherto/wdk-wallet-solana').WalletAccountReadOnlySolana;
export type SolanaRpc = WalletAccountReadOnlySolana['_rpc'];
export type LayerswapNetwork = import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapNetwork;
export type LayerswapProtocolConfig = import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapProtocolConfig;
export type LayerswapSwidgeRoute = import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSwidgeRoute;
export type LayerswapDepositContext = import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapDepositContext;
export type LayerswapBroadcastDeposit = import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapBroadcastDeposit;
export type SolanaTransactionMessage = import('@solana/kit').BaseTransactionMessage;
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
/** @typedef {import('@solana/kit').BaseTransactionMessage} SolanaTransactionMessage */
/**
 * @typedef {Object} LayerswapSolanaPreparedDeposit
 * @property {SolanaTransactionMessage} message - The unsigned deposit transaction message, with a fresh blockhash.
 * @property {bigint} fee - The estimated fee of the deposit transaction (in lamports).
 */
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
export default class LayerswapProtocolSolana extends LayerswapSwidgeProtocol {
    /**
     * The Solana rpc client the wallet account was built with. Reused as-is instead of
     * rebuilding one from `account._config.provider`, so that every provider shape the
     * wallet supports (rpc url, rpc client, or a list of them wrapped in the wdk fail-over
     * provider) is honoured.
     *
     * @private
     * @type {SolanaRpc | undefined}
     */
    _rpc;
    /**
     * @private
     * @type {LayerswapNetwork | undefined}
     */
    _sourceNetwork;
    /**
     * @private
     * @type {string | undefined}
     */
    _genesisHash;
    constructor(account?: undefined, config?: LayerswapProtocolConfig);
    constructor(account: WalletAccountReadOnlySolana, config?: LayerswapProtocolConfig);
    constructor(account: WalletAccountSolana, config?: LayerswapProtocolConfig);
    /** @protected */
    protected get _nativeTokenSymbol(): string;
    /**
     * Detects the source network from the genesis hash reported by the account's rpc
     * client. Cached for the lifetime of the protocol instance.
     *
     * @protected
     * @returns {Promise<LayerswapNetwork>} The source network.
     * @throws {ValueError} If the genesis hash is not a known Solana cluster, or Layerswap does not support it.
     * @throws {ProviderRequiredError} If the account is not connected to a provider.
     * @throws {ProviderError} If the rpc fails to report the genesis hash.
     */
    protected _detectSourceNetwork(): Promise<LayerswapNetwork>;
    /**
     * Asserts that the account's rpc client is connected to the source network named by
     * 'fromChain'. Layerswap also lists other svm chains (e.g. Eclipse) as solana networks,
     * whose genesis hashes are not known here: the check is skipped when neither the rpc
     * cluster nor 'fromChain' is a known Solana cluster.
     *
     * @protected
     * @param {LayerswapNetwork} network - The source network named by 'fromChain'.
     * @returns {Promise<void>}
     * @throws {ValueError} If the rpc client is connected to a different network.
     * @throws {ProviderError} If the rpc fails to report the genesis hash.
     */
    protected _assertAccountNetwork(network: LayerswapNetwork): Promise<void>;
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
     * Tests whether the bound account is a writable Solana wallet account, i.e. exposes
     * `sendTransaction` and a `keyPair` with a 32-byte `publicKey`. Read-only accounts do not
     * expose `keyPair`. This is a duck-type check rather than an `instanceof
     * WalletAccountSolana` check because the wallet package may resolve to a different copy
     * than this package's own, and `instanceof` would then fail on a structurally-correct
     * account.
     *
     * @protected
     * @param {unknown} account - The bound account.
     * @returns {boolean} True if the account can sign and send transactions.
     */
    protected _isWritableAccount(account: unknown): boolean;
    /**
     * Tests whether the bound (writable) account has been disposed. Besides the generic
     * `disposed` flag, a disposed `WalletAccountSolana` erases its private key, so its
     * `keyPair.privateKey` reads as `null`.
     *
     * @protected
     * @param {WalletAccountSolana} account - The bound account.
     * @returns {boolean} True if the account has been disposed.
     */
    protected _isDisposedAccount(account: WalletAccountSolana): boolean;
    /**
     * @protected
     * @param {LayerswapSwidgeRoute} route - The resolved swidge route.
     * @throws {ProviderRequiredError} If the account is not connected to a provider.
     */
    protected _assertSwidgeRoute(route: LayerswapSwidgeRoute): void;
    /**
     * Approximates the source-chain fee of the deposit with Solana's per-signature fee floor.
     *
     * @protected
     * @param {LayerswapSwidgeRoute} route - The resolved swidge route.
     * @param {bigint} amount - The input amount in source-token base units.
     * @param {string} sourceAddress - The address of the bound account.
     * @returns {Promise<bigint>} The estimated fee, in lamports.
     */
    protected _quoteSourceGas(route: LayerswapSwidgeRoute, amount: bigint, sourceAddress: string): Promise<bigint>;
    /**
     * Validates the deposit transaction returned by Layerswap, and quotes its fee through the
     * wallet account.
     *
     * @protected
     * @param {LayerswapDepositContext} context - The deposit context.
     * @returns {Promise<LayerswapSolanaPreparedDeposit>} The prepared deposit.
     * @throws {ProviderError} If the deposit transaction is malformed, or the rpc fails.
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
     * @throws {ProviderError} If the deposit transaction is malformed, or the rpc fails.
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
