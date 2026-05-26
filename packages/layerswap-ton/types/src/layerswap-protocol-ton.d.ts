/**
 * Bridge protocol that drives a Layerswap swap from a TON wallet account.
 *
 * Unlike on-chain bridges this protocol is HTTP-orchestrated:
 *   1. POST /api/v2/swaps to create a swap and receive the deposit address + a JSON `call_data`
 *      containing the Layerswap reference comment (and, for jettons, the amount).
 *   2. Build the deposit message body client-side via `@ton/core`:
 *      - Native TON: a comment cell with op `0` and the Layerswap comment as `storeStringTail`.
 *      - Jetton: a TIP-3 jetton-transfer body (op `0x0f8a7ea5`) with the comment in the
 *        forward payload, sent to the sender's jetton wallet with a ~0.045 TON gas budget.
 *   3. Hand `{ to, value, body }` to `account.sendTransaction(...)`, which sets up the v5r1
 *      wallet contract, signs with the secret key, and broadcasts via `_contract.send`.
 *   4. Layerswap performs the destination-chain payout off-chain.
 *
 * Semantic note: `BridgeResult.bridgeFee` is documented in `@tetherto/wdk-wallet` as
 * "native tokens paid to the bridge protocol". Layerswap deducts its fee from the
 * source-token amount instead, so we return `bridgeFee` in **source-token base units**.
 * Do not naively add `fee` (native nanotons) and `bridgeFee` together — they are in
 * different units. The `bridgeMaxFee` config compares against `bridgeFee` only.
 *
 * Implementation note: this package depends on `@ton/core` (for cell building / `Address`
 * parsing) in addition to the wallet's `@ton/ton` peer. The wallet handles wallet-contract
 * setup, signing, and broadcasting; this package only owns the deposit message body and
 * the Layerswap HTTP plumbing.
 */
export default class LayerswapProtocolTon extends BridgeProtocol {
    /**
     * @overload
     * @param {WalletAccountReadOnlyTon} account - The wallet account to use to interact with the protocol.
     * @param {LayerswapProtocolConfig} [config] - The layerswap protocol configuration.
     */
    constructor(account: WalletAccountReadOnlyTon, config?: LayerswapProtocolConfig);
    /**
     * @overload
     * @param {WalletAccountTon} account - The wallet account to use to interact with the protocol.
     * @param {LayerswapProtocolConfig} [config] - The layerswap protocol configuration.
     */
    constructor(account: WalletAccountTon, config?: LayerswapProtocolConfig);
    /**
     * @private
     * @type {LayerswapApiClient}
     */
    private _client;
    /**
     * Bridges a token to a different blockchain via Layerswap.
     *
     * Resolves once the source-chain deposit transaction has been broadcast. Layerswap finishes
     * the destination-chain payout asynchronously; callers can use `getApiClient().getSwap(swapId)`
     * to track destination delivery.
     *
     * Semantic note: `bridgeFee` is in **source-token base units**, not native nanotons.
     * See class JSDoc for the rationale.
     *
     * @param {BridgeOptions} options - The bridge's options.
     * @param {Pick<LayerswapProtocolConfig, 'bridgeMaxFee'>} [config] - Per-call overrides.
     * @returns {Promise<LayerswapBridgeResult>} The bridge's result, augmented with the Layerswap swap id.
     */
    bridge(options: BridgeOptions, config?: Pick<LayerswapProtocolConfig, "bridgeMaxFee">): Promise<LayerswapBridgeResult>;
    /**
     * Quotes the costs of a Layerswap bridge operation without creating a swap.
     *
     * The reported `fee` is an approximation:
     *   - Native TON: `TON_NATIVE_FEE_APPROX_NANOTONS` (~0.01 TON).
     *   - Jetton: `TON_JETTON_FEE_APPROX_NANOTONS` (~0.05 TON, includes the 0.045 message value
     *     budgeted for jetton-wallet gas + forward amount).
     *
     * Semantic note: `bridgeFee` is in **source-token base units**, not native nanotons.
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
     * Asks Layerswap for its on-chain assessment of a deposit transaction. Useful as a
     * follow-up after `bridge()` returns — even if the wallet's `sendTransaction` resolved,
     * the message can still be discarded by the validator or fail at the jetton wallet.
     * Returns `'completed' | 'failed' | 'pending'`.
     *
     * The source network defaults to `TON_MAINNET` (TON has no stable network id and
     * Layerswap currently lists only mainnet); pass `options.sourceChain` to override.
     *
     * @param {string} hash - The TON external-message hash returned by `bridge()`.
     * @param {{ sourceChain?: string }} [options]
     * @returns {Promise<import('@layerswap/wdk-protocol-bridge-layerswap-core').LayerswapTransactionStatus>}
     */
    getTransactionStatus(hash: string, options?: {
        sourceChain?: string;
    }): Promise<import("@layerswap/wdk-protocol-bridge-layerswap-core").LayerswapTransactionStatus>;
    /**
     * Calls `POST /api/v2/swaps` for the resolved route and extracts the wallet-driven
     * deposit action + the parsed `call_data` JSON.
     *
     * @private
     * @param {BridgeOptions} options
     * @returns {Promise<{
     *   action: LayerswapDepositAction,
     *   sourceToken: LayerswapToken,
     *   parsedCallData: { comment?: string, amount?: string | number } | null,
     *   bridgeFee: bigint,
     *   swapId: string
     * }>}
     */
    private _createDepositSwap;
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
     * additional `manual_transfer` actions; those are ignored here. Throws if no
     * wallet-driven action is present so the caller gets a clear error.
     *
     * @private
     * @param {LayerswapDepositAction[]} depositActions
     * @returns {LayerswapDepositAction}
     */
    private _pickWalletDepositAction;
    /**
     * Parses Layerswap's `call_data` for TON, which the Layerswap web app expects as a JSON
     * string with optional `comment` and `amount` fields. Tolerates missing / empty / non-JSON
     * payloads by returning `null` — the deposit message will then carry an empty comment.
     *
     * @private
     * @param {string | null | undefined} callData
     * @returns {{ comment?: string, amount?: string | number } | null}
     */
    private _parseCallData;
    /**
     * Builds the `{ to, value, body }` argument for `account.sendTransaction(...)`. Branches
     * on `sourceToken.contract`: jetton master address present → jetton path, otherwise
     * native TON path.
     *
     * @private
     * @param {Object} params
     * @param {LayerswapToken} params.sourceToken
     * @param {LayerswapDepositAction} params.action
     * @param {{ comment?: string, amount?: string | number } | null} params.parsedCallData
     * @param {bigint} params.amount
     * @returns {Promise<{ to: string, value: bigint, body: Cell }>}
     */
    private _buildDepositMessage;
    /**
     * Resolves the jetton amount to encode in the jetton-transfer body. Prefers Layerswap's
     * `parsedCallData.amount` (matches the UI), falls back to `options.amount`.
     *
     * @private
     * @param {{ amount?: string | number } | null} parsedCallData
     * @param {bigint} fallbackAmount
     * @returns {bigint}
     */
    private _resolveJettonAmount;
    /**
     * Tests whether the bound account is a writable TON wallet account
     * (i.e. exposes `sendTransaction`). This is a duck-type check rather than an
     * `instanceof WalletAccountTon` check because pnpm-workspace setups can resolve
     * the wallet package to a different copy than this package's own copy when the
     * dep tree's peer-dep contexts diverge — `instanceof` would then fail on a
     * structurally-correct account. Read-only accounts do not expose `sendTransaction`.
     *
     * @private
     * @param {unknown} account
     * @returns {boolean}
     */
    private _isWritableAccount;
    /**
     * Informs Layerswap that the deposit has been broadcast. Best-effort — failures are
     * swallowed because Layerswap's watcher will still detect the on-chain deposit on its
     * own.
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
export type WalletAccountTon = import("@tetherto/wdk-wallet-ton").WalletAccountTon;
export type WalletAccountReadOnlyTon = import("@tetherto/wdk-wallet-ton").WalletAccountReadOnlyTon;
export type Cell = any;
export type LayerswapNetwork = import("@layerswap/wdk-protocol-bridge-layerswap-core").LayerswapNetwork;
export type LayerswapToken = import("@layerswap/wdk-protocol-bridge-layerswap-core").LayerswapToken;
export type LayerswapDepositAction = import("@layerswap/wdk-protocol-bridge-layerswap-core").LayerswapDepositAction;
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
     * - Layerswap destination network name (e.g. `'ARBITRUM_MAINNET'`).
     */
    targetChain: string;
    /**
     * - Destination-chain recipient address, in its native format.
     */
    recipient: string;
    /**
     * - Source token: jetton master address OR Layerswap symbol
     *   (e.g. `'TON'`, `'USDT'`).
     */
    token: string;
    /**
     * - Source amount in base units (nanotons for TON, smallest
     *   unit for jetton tokens).
     */
    amount: number | bigint;
    /**
     * - Destination token (address or symbol). Defaults to the
     *         source token's symbol.
     */
    destinationToken?: string;
    /**
     * - Override the default source network name. Defaults to
     *              `'TON_MAINNET'` (Layerswap only lists mainnet at the time
     *              of writing, and TON has no stable network id we can read).
     */
    sourceChain?: string;
    /**
     * - Request a native-gas drop on the destination chain.
     */
    refuel?: boolean;
    /**
     * - Slippage tolerance percentage, e.g. `'0.5'`.
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
import LayerswapApiClient from '@layerswap/wdk-protocol-bridge-layerswap-core';
