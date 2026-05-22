// Copyright 2026 Aren <aren@bransfer.io>
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict'

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
export async function resolveSourceNetwork (client, chainId) {
  const networks = await client.getNetworks()
  const target = String(chainId)

  for (const network of networks) {
    if (network.chain_id != null && String(network.chain_id) === target) {
      return network
    }
  }

  throw new Error(`Layerswap does not support source chain with id '${target}'.`)
}

/**
 * Finds the Layerswap network by its identifier (network name).
 *
 * @param {LayerswapApiClient} client
 * @param {string} name
 * @returns {Promise<LayerswapNetwork>}
 */
export async function resolveNetworkByName (client, name) {
  const networks = await client.getNetworks()
  const target = name.toLowerCase()

  for (const network of networks) {
    if (network.name.toLowerCase() === target) {
      return network
    }
  }

  throw new Error(`Layerswap does not support destination network '${name}'.`)
}

/**
 * Resolves a token within a network by either contract address (case-insensitive)
 * or Layerswap symbol. Returns the canonical token record.
 *
 * @param {LayerswapNetwork} network
 * @param {string} identifier - Contract address (0x…) or Layerswap symbol (e.g. 'USDC').
 * @returns {LayerswapToken}
 */
export function resolveToken (network, identifier) {
  if (!network.tokens || network.tokens.length === 0) {
    throw new Error(`Layerswap network '${network.name}' has no tokens listed.`)
  }

  const looksLikeAddress = typeof identifier === 'string' && identifier.startsWith('0x') && identifier.length === 42

  if (looksLikeAddress) {
    const target = identifier.toLowerCase()
    for (const token of network.tokens) {
      if (token.contract != null && token.contract.toLowerCase() === target) {
        return token
      }
    }
  }

  const symbolTarget = identifier.toLowerCase()
  for (const token of network.tokens) {
    if (token.symbol.toLowerCase() === symbolTarget) {
      return token
    }
  }

  throw new Error(`Token '${identifier}' not supported on Layerswap network '${network.name}'.`)
}

/**
 * Converts a base-unit bigint amount to a decimal string with the given number of decimals.
 * Used to build Layerswap API request bodies, which expect decimal strings.
 *
 * @param {bigint} baseUnits
 * @param {number} decimals
 * @returns {string}
 */
export function formatBaseUnits (baseUnits, decimals) {
  if (decimals === 0) return baseUnits.toString()

  const negative = baseUnits < 0n
  const value = negative ? -baseUnits : baseUnits
  const str = value.toString().padStart(decimals + 1, '0')
  const head = str.slice(0, str.length - decimals)
  const tail = str.slice(str.length - decimals).replace(/0+$/, '')
  const formatted = tail.length > 0 ? `${head}.${tail}` : head
  return negative ? `-${formatted}` : formatted
}

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
export function parseDecimal (value, decimals) {
  const str = typeof value === 'number' ? value.toFixed(decimals) : String(value).trim()
  if (str.length === 0) return 0n

  const negative = str.startsWith('-')
  const body = negative ? str.slice(1) : str

  const [intPart, fracPartRaw = ''] = body.split('.')
  const fracPart = fracPartRaw.slice(0, decimals).padEnd(decimals, '0')

  const combined = `${intPart}${fracPart}`.replace(/^0+(?=\d)/, '')
  if (combined.length === 0) return 0n

  const result = BigInt(combined)
  return negative ? -result : result
}
