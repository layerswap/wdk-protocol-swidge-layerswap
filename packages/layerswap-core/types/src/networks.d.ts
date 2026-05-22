/** @typedef {import('./layerswap-api-client.js').default} LayerswapApiClient */
/** @typedef {import('./layerswap-api-client.js').LayerswapNetwork} LayerswapNetwork */
/** @typedef {import('./layerswap-api-client.js').LayerswapToken} LayerswapToken */
/**
 * Finds the Layerswap network whose on-chain id matches the given numeric chain id.
 *
 * @param {LayerswapApiClient} client
 * @param {number | bigint} chainId
 * @returns {Promise<LayerswapNetwork>}
 */
export function resolveSourceNetwork(client: LayerswapApiClient, chainId: number | bigint): Promise<LayerswapNetwork>;
/**
 * Finds the Layerswap network by its identifier (network name).
 *
 * @param {LayerswapApiClient} client
 * @param {string} name
 * @returns {Promise<LayerswapNetwork>}
 */
export function resolveNetworkByName(client: LayerswapApiClient, name: string): Promise<LayerswapNetwork>;
/**
 * Resolves a token within a network by either contract address (case-insensitive)
 * or Layerswap symbol. Returns the canonical token record.
 *
 * @param {LayerswapNetwork} network
 * @param {string} identifier - Contract address (0x…) or Layerswap symbol (e.g. 'USDC').
 * @returns {LayerswapToken}
 */
export function resolveToken(network: LayerswapNetwork, identifier: string): LayerswapToken;
/**
 * Converts a base-unit bigint amount to a decimal string with the given number of decimals.
 * Used to build Layerswap API request bodies, which expect decimal strings.
 *
 * @param {bigint} baseUnits
 * @param {number} decimals
 * @returns {string}
 */
export function formatBaseUnits(baseUnits: bigint, decimals: number): string;
/**
 * Converts a decimal-string amount (as returned by Layerswap quotes) to a base-unit bigint.
 *
 * Truncates digits beyond `decimals` (does not round) — Layerswap fees are returned with
 * up to ~18 significant digits already so any truncation here is sub-wei.
 *
 * @param {number | string} value
 * @param {number} decimals
 * @returns {bigint}
 */
export function parseDecimal(value: number | string, decimals: number): bigint;
export type LayerswapApiClient = import("./layerswap-api-client.js").default;
export type LayerswapNetwork = import("./layerswap-api-client.js").LayerswapNetwork;
export type LayerswapToken = import("./layerswap-api-client.js").LayerswapToken;
