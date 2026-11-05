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
export default class LayerswapProtocolTon extends LayerswapSwidgeProtocol<import("@layerswap/wdk-protocol-swidge-layerswap-core/types/src/layerswap-swidge-protocol.js").LayerswapSwidgeOptions, import("@layerswap/wdk-protocol-swidge-layerswap-core/types/src/layerswap-swidge-protocol.js").LayerswapSwidgeConfig, import("@layerswap/wdk-protocol-swidge-layerswap-core/types/src/layerswap-swidge-protocol.js").LayerswapBridgeOptions, import("@layerswap/wdk-protocol-swidge-layerswap-core/types/src/layerswap-swidge-protocol.js").LayerswapBridgeConfig> {
    /**
     * Creates a new swidge protocol for chain/token discovery only, without a wallet account.
     *
     * @overload
     * @param {undefined} [account] - No account; only discovery and `fromChain`-scoped quotes work.
     * @param {LayerswapProtocolConfig} [config] - The layerswap protocol configuration.
     */
    constructor(account?: undefined, config?: LayerswapProtocolConfig);
    /**
     * Creates a new read-only interface to the layerswap protocol for the ton blockchain.
     *
     * @overload
     * @param {WalletAccountReadOnlyTon} account - The wallet account to use to interact with the protocol.
     * @param {LayerswapProtocolConfig} [config] - The layerswap protocol configuration.
     */
    constructor(account: WalletAccountReadOnlyTon, config?: LayerswapProtocolConfig);
    /**
     * Creates a new interface to the layerswap protocol for the ton blockchain.
     *
     * @overload
     * @param {WalletAccountTon} account - The wallet account to use to interact with the protocol.
     * @param {LayerswapProtocolConfig} [config] - The layerswap protocol configuration.
     */
    constructor(account: WalletAccountTon, config?: LayerswapProtocolConfig);
    /**
     * @private
     * @type {LayerswapNetwork | undefined}
     */
    private _sourceNetwork;
    /**
     * Builds the deposit message from the Layerswap deposit action. Its fee is only known
     * once broadcast.
     *
     * @protected
     * @param {LayerswapDepositContext} context - The deposit context.
     * @returns {Promise<LayerswapTonPreparedDeposit>} The prepared deposit.
     * @throws {ValueError} If the deposit action is malformed.
     * @throws {ProviderError} If ton center fails.
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
     * Calls the ton center v3 api the account is connected to, with the account's api key.
     *
     * @private
     * @param {string} path - The api path.
     * @param {Record<string, string>} params - The query parameters.
     * @returns {Promise<LayerswapTonCenterResponse>} The response payload.
     * @throws {ProviderRequiredError} If the account is not connected to ton center.
     * @throws {ProviderError} If the request fails.
     */
    private _fetchTonCenter;
    /**
     * Parses Layerswap's `call_data` for TON: a JSON string with the reference `comment` that
     * lets Layerswap match the deposit to the swap, and the `amount` to deposit. Like the
     * Layerswap web app, nothing is sent without them.
     *
     * @private
     * @param {string | null | undefined} callData
     * @returns {LayerswapTonCallData}
     * @throws {ValueError} If the call_data is missing, or has no reference comment.
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
     * @throws {ValueError} If the deposit address is malformed.
     * @throws {ProviderError} If ton center fails to resolve the jetton wallet address.
     * @throws {ProviderRequiredError} If the account is not connected to ton center.
     */
    private _buildDepositMessage;
    /**
     * Parses the Layerswap deposit address.
     *
     * @private
     * @param {string} address
     * @returns {Address}
     * @throws {ValueError} If the address is not a valid TON address.
     */
    private _parseDepositAddress;
}
export type WalletAccountTon = import("@tetherto/wdk-wallet-ton").WalletAccountTon;
export type WalletAccountReadOnlyTon = import("@tetherto/wdk-wallet-ton").WalletAccountReadOnlyTon;
export type Cell = import("@ton/ton").Cell;
export type LayerswapProtocolConfig = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapProtocolConfig;
export type LayerswapNetwork = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapNetwork;
export type LayerswapToken = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapToken;
export type LayerswapDepositAction = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapDepositAction;
export type LayerswapSwidgeRoute = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapSwidgeRoute;
export type LayerswapDepositContext = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapDepositContext;
export type LayerswapBroadcastDeposit = import("@layerswap/wdk-protocol-swidge-layerswap-core").LayerswapBroadcastDeposit;
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
/**
 * The fields of a ton center v3 message used to trace a deposit.
 */
export type LayerswapTonCenterMessage = {
    /**
     * - The message hash.
     */
    hash?: string;
    /**
     * - The body opcode, as a hex string (e.g. `'0x7362d09c'`).
     */
    opcode?: string | null;
};
/**
 * The fields of a ton center v3 transaction used to trace a deposit.
 */
export type LayerswapTonCenterTransaction = {
    /**
     * - The transaction hash.
     */
    hash: string;
    /**
     * - The inbound message.
     */
    in_msg?: LayerswapTonCenterMessage;
    /**
     * - The outbound messages.
     */
    out_msgs?: LayerswapTonCenterMessage[];
};
export type LayerswapTonCenterTrace = {
    /**
     * - The transactions of the trace, by hash.
     */
    transactions: Record<string, LayerswapTonCenterTransaction>;
};
/**
 * A ton center v3 response: `transactions` for `transactionsByMessage`, `traces` for `traces`.
 */
export type LayerswapTonCenterResponse = {
    /**
     * - The matching transactions.
     */
    transactions?: LayerswapTonCenterTransaction[];
    /**
     * - The matching traces.
     */
    traces?: LayerswapTonCenterTrace[];
};
/**
 * The `{ to, value, body }` transaction handed to `account.sendTransaction(...)`.
 */
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
import { LayerswapSwidgeProtocol } from '@layerswap/wdk-protocol-swidge-layerswap-core';
