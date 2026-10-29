import { LayerswapSwidgeProtocol } from '@layerswap/wdk-protocol-swidge-layerswap-core';
export type WalletAccountTon = import('@tetherto/wdk-wallet-ton').WalletAccountTon;
export type WalletAccountReadOnlyTon = import('@tetherto/wdk-wallet-ton').WalletAccountReadOnlyTon;
export type Cell = import('@ton/ton').Cell;
export type LayerswapProtocolConfig = import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapProtocolConfig;
export type LayerswapNetwork = import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapNetwork;
export type LayerswapToken = import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapToken;
export type LayerswapDepositAction = import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapDepositAction;
export type LayerswapSwidgeRoute = import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapSwidgeRoute;
export type LayerswapDepositContext = import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapDepositContext;
export type LayerswapBroadcastDeposit = import('@layerswap/wdk-protocol-swidge-layerswap-core').LayerswapBroadcastDeposit;
export type LayerswapTonCallData = {
    /**
     * - The Layerswap reference comment to attach to the deposit.
     */
    comment: string;
    /**
     * - The amount to deposit (in base unit).
     */
    amount: string | number;
};
export type LayerswapTonDepositMessageParams = {
    /**
     * - The source token.
     */
    sourceToken: LayerswapToken;
    /**
     * - The wallet-driven deposit action.
     */
    action: LayerswapDepositAction;
    /**
     * - The Layerswap reference comment.
     */
    comment: string;
    /**
     * - The amount to deposit (in base unit).
     */
    amount: bigint;
};
export type LayerswapTonDepositMessage = {
    /**
     * - The deposit address (native TON) or the sender's jetton wallet (jettons).
     */
    to: string;
    /**
     * - The amount of nanotons to attach to the message.
     */
    value: bigint;
    /**
     * - The message body.
     */
    body: Cell;
};
export type LayerswapTonPreparedDeposit = {
    /**
     * - The deposit message to broadcast.
     */
    message: LayerswapTonDepositMessage;
};
/**
 * WDK swidge protocol that drives a Layerswap swap from a TON wallet account. The
 * chain-agnostic swidge logic lives in `LayerswapSwidgeProtocol`
 * (`@layerswap/wdk-protocol-swidge-layerswap-core`); this class only implements the TON
 * specifics: the deposit message.
 *
 * Layerswap returns the deposit address and a JSON `call_data` carrying the Layerswap
 * reference comment (and, for jettons, the amount). The deposit message body is built
 * client-side:
 * - Native TON: a comment cell with op `0` and the Layerswap comment as `storeStringTail`.
 * - Jetton: a TIP-3 jetton-transfer body (op `0x0f8a7ea5`) with the comment in the
 *   forward payload, sent to the sender's jetton wallet with a ~0.045 TON gas budget.
 *
 * `{ to, value, body }` is then handed to `account.sendTransaction(...)`. The source network
 * is detected from the ton center the account is connected to (`account._tonClient`).
 *
 * @extends {LayerswapSwidgeProtocol}
 */
export default class LayerswapProtocolTon extends LayerswapSwidgeProtocol {
    /**
     * @private
     * @type {LayerswapNetwork | undefined}
     */
    _sourceNetwork;
    constructor(account?: undefined, config?: LayerswapProtocolConfig);
    constructor(account: WalletAccountReadOnlyTon, config?: LayerswapProtocolConfig);
    constructor(account: WalletAccountTon, config?: LayerswapProtocolConfig);
    /** @protected */
    protected get _nativeTokenSymbol(): string;
    /**
     * Detects the source network from the zero-state block of the ton center the account's
     * client is connected to (`account._tonClient`). Without an account, the source network
     * defaults to `TON_MAINNET`. Cached for the lifetime of the protocol instance.
     *
     * @protected
     * @returns {Promise<LayerswapNetwork>} The source network.
     * @throws {ValueError} If the zero state is not a known TON network, or Layerswap does not support it.
     * @throws {ProviderRequiredError} If the account is not connected to ton center.
     * @throws {ProviderError} If ton center fails to report the zero state.
     */
    protected _detectSourceNetwork(): Promise<LayerswapNetwork>;
    /**
     * Approximates the source-chain fee of the deposit message.
     *
     * @protected
     * @param {LayerswapSwidgeRoute} route - The resolved swidge route.
     * @param {bigint} amount - The input amount in source-token base units.
     * @param {string} sourceAddress - The address of the bound account.
     * @returns {Promise<bigint>} The estimated fee, in nanotons.
     */
    protected _quoteSourceGas(route: LayerswapSwidgeRoute, amount: bigint, sourceAddress: string): Promise<bigint>;
    /**
     * Builds the deposit message from the Layerswap deposit action. Its fee is only known
     * once broadcast.
     *
     * @protected
     * @param {LayerswapDepositContext} context - The deposit context.
     * @returns {Promise<LayerswapTonPreparedDeposit>} The prepared deposit.
     * @throws {ProviderError} If the deposit action is malformed, or ton center fails.
     * @throws {ProviderRequiredError} If the account is not connected to ton center.
     */
    protected _prepareDeposit({ action, route, fromTokenAmount }: LayerswapDepositContext): Promise<LayerswapTonPreparedDeposit>;
    /**
     * Signs and broadcasts the deposit message through the wallet account.
     *
     * @protected
     * @param {LayerswapTonPreparedDeposit} deposit - The prepared deposit.
     * @returns {Promise<LayerswapBroadcastDeposit>} The broadcast deposit, with its fee when the wallet reports it.
     * @throws {ProviderRequiredError} If the account is not connected to ton center.
     * @throws {ProviderError} If ton center fails to broadcast the deposit.
     * @throws {MaximumFeeExceededError} If the wallet rejects the transaction fee.
     */
    protected _sendDeposit({ message }: LayerswapTonPreparedDeposit): Promise<LayerswapBroadcastDeposit>;
    /**
     * Resolves the hash returned by `swidge()` — the body hash of the deposit's external
     * message — to the id Layerswap tracks TON deposits by: the hash of the message that
     * reaches the deposit address. That is the jetton `transfer_notification` for jetton
     * deposits, and the wallet's own outgoing message for native TON. The deposit is traced
     * through the ton center the account is connected to. Ids that are not hex hashes are
     * taken to be Layerswap ids already, and returned as-is.
     *
     * @protected
     * @param {string} hash - The hash returned by `swidge()`, or a Layerswap transaction id.
     * @returns {Promise<string>} The Layerswap transaction id.
     * @throws {NoSuchElementError} If ton center has not indexed the deposit (yet).
     * @throws {ProviderRequiredError} If the account is not connected to ton center.
     * @throws {ProviderError} If ton center fails to trace the deposit.
     */
    protected _resolveTransactionId(hash: string): Promise<string>;
    /**
     * Calls the ton center v3 api the account is connected to, with the account's api key.
     *
     * @private
     * @param {string} path - The api path.
     * @param {Record<string, string>} params - The query parameters.
     * @returns {Promise<any>} The response payload.
     * @throws {ProviderRequiredError} If the account is not connected to ton center.
     * @throws {ProviderError} If the request fails.
     */
    private _fetchTonCenter;
    /**
     * Runs a wallet account call, normalizing its errors. `@tetherto/wdk-wallet-ton` throws
     * plain errors, so its "not connected to ton center" and "maximum fee" failures are
     * mapped to `ProviderRequiredError` and `MaximumFeeExceededError` by message.
     *
     * @protected
     * @template T
     * @param {() => Promise<T>} call - The wallet call.
     * @returns {Promise<T>} The call's result.
     * @throws {ProviderRequiredError} If the account is not connected to ton center.
     * @throws {MaximumFeeExceededError} If the transaction's cost exceeds the account's max. fee option.
     * @throws {ProviderError} If the call fails with an error outside of the swidge contract.
     */
    protected _callWallet<T>(call: () => Promise<T>): Promise<T>;
    /**
     * Parses Layerswap's `call_data` for TON: a JSON string with the reference `comment` that
     * lets Layerswap match the deposit to the swap, and the `amount` to deposit. Like the
     * Layerswap web app, nothing is sent without them.
     *
     * @private
     * @param {string | null | undefined} callData
     * @returns {LayerswapTonCallData}
     * @throws {ProviderError} If the call_data is missing, or has no reference comment.
     */
    private _parseCallData;
    /**
     * Builds the `{ to, value, body }` argument for `account.sendTransaction(...)`. Branches
     * on `sourceToken.contract`: jetton master address present → jetton path, otherwise
     * native TON path.
     *
     * @private
     * @param {LayerswapTonDepositMessageParams} params
     * @returns {Promise<LayerswapTonDepositMessage>}
     * @throws {ProviderError} If the Layerswap deposit address is malformed, or ton center fails to
     *   resolve the jetton wallet address.
     * @throws {ProviderRequiredError} If the account is not connected to ton center.
     */
    private _buildDepositMessage;
    /**
     * Parses the Layerswap deposit address.
     *
     * @private
     * @param {string} address
     * @returns {Address}
     * @throws {ProviderError} If Layerswap returned a malformed TON address.
     */
    private _parseDepositAddress;
}
