import { describe, expect, jest, test } from '@jest/globals'

import {
  resolveSourceNetwork,
  resolveNetworkByName,
  resolveToken,
  formatBaseUnits,
  parseDecimal
} from '../index.js'

const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const USDC_ARB = '0xaf88d065e77c8cc2239327c5edb3a432268e5831'

const ETHEREUM_NETWORK = {
  name: 'ETHEREUM_MAINNET',
  chain_id: '1',
  type: 'evm',
  tokens: [
    { symbol: 'USDC', contract: USDC_ETH, decimals: 6 },
    { symbol: 'ETH', contract: null, decimals: 18 }
  ]
}

const ARBITRUM_NETWORK = {
  name: 'ARBITRUM_MAINNET',
  chain_id: '42161',
  type: 'evm',
  tokens: [
    { symbol: 'USDC', contract: USDC_ARB, decimals: 6 },
    { symbol: 'ETH', contract: null, decimals: 18 }
  ]
}

const SOLANA_MAINNET = {
  name: 'SOLANA_MAINNET',
  chain_id: 'mainnet-beta',
  type: 'solana',
  tokens: [
    { symbol: 'SOL', contract: null, decimals: 9 },
    { symbol: 'USDC', contract: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 }
  ]
}

function makeStubClient (networks) {
  return { getNetworks: jest.fn().mockResolvedValue(networks) }
}

describe('resolveSourceNetwork', () => {
  test('matches EVM numeric chain id', async () => {
    const client = makeStubClient([ETHEREUM_NETWORK, ARBITRUM_NETWORK])
    await expect(resolveSourceNetwork(client, 1)).resolves.toBe(ETHEREUM_NETWORK)
    await expect(resolveSourceNetwork(client, 42161n)).resolves.toBe(ARBITRUM_NETWORK)
  })

  test('matches Solana cluster name (string equality, VM-agnostic)', async () => {
    const client = makeStubClient([ETHEREUM_NETWORK, SOLANA_MAINNET])
    await expect(resolveSourceNetwork(client, 'mainnet-beta')).resolves.toBe(SOLANA_MAINNET)
  })

  test('throws on unknown chain id', async () => {
    const client = makeStubClient([ETHEREUM_NETWORK])
    await expect(resolveSourceNetwork(client, 999)).rejects.toThrow(/source chain with id '999'/)
  })
})

describe('resolveNetworkByName', () => {
  test('matches case-insensitively', async () => {
    const client = makeStubClient([ETHEREUM_NETWORK, ARBITRUM_NETWORK])
    await expect(resolveNetworkByName(client, 'arbitrum_mainnet')).resolves.toBe(ARBITRUM_NETWORK)
    await expect(resolveNetworkByName(client, 'ARBITRUM_MAINNET')).resolves.toBe(ARBITRUM_NETWORK)
  })

  test('throws on unknown network', async () => {
    const client = makeStubClient([ETHEREUM_NETWORK])
    await expect(resolveNetworkByName(client, 'OPTIMISM_MAINNET')).rejects.toThrow(/destination network/)
  })
})

describe('resolveToken', () => {
  test('matches by 0x-prefixed contract address (body case-insensitive)', () => {
    // '0x' prefix must be lowercase; the 40-hex body can be any case.
    expect(resolveToken(ETHEREUM_NETWORK, USDC_ETH.toLowerCase()).symbol).toBe('USDC')
    expect(resolveToken(ETHEREUM_NETWORK, '0x' + USDC_ETH.slice(2).toUpperCase()).symbol).toBe('USDC')
  })

  test('matches by symbol', () => {
    expect(resolveToken(SOLANA_MAINNET, 'usdc').symbol).toBe('USDC')
    expect(resolveToken(SOLANA_MAINNET, 'SOL').contract).toBeNull()
  })

  test('symbol fallback works for non-0x identifiers (Solana mint base58)', () => {
    // SPL mints don't start with 0x; the helper must fall back to symbol matching
    // and not blow up trying to lowercase-compare a non-existent address.
    expect(resolveToken(SOLANA_MAINNET, 'USDC').symbol).toBe('USDC')
  })

  test('throws on unknown token', () => {
    expect(() => resolveToken(ETHEREUM_NETWORK, 'DOGE')).toThrow(/not supported/)
  })

  test('throws on network with no tokens', () => {
    expect(() => resolveToken({ name: 'EMPTY', tokens: [] }, 'USDC')).toThrow(/no tokens listed/)
  })
})

describe('formatBaseUnits / parseDecimal round-trip', () => {
  test('formats 18-decimal native amounts', () => {
    expect(formatBaseUnits(1_000_000_000_000_000_000n, 18)).toBe('1')
    expect(formatBaseUnits(1_500_000_000_000_000_000n, 18)).toBe('1.5')
    expect(formatBaseUnits(0n, 18)).toBe('0')
  })

  test('formats 6-decimal token amounts', () => {
    expect(formatBaseUnits(1_000_000n, 6)).toBe('1')
    expect(formatBaseUnits(1_234_567n, 6)).toBe('1.234567')
  })

  test('formats 8-decimal (BTC) amounts — doc gotcha #8 boundary', () => {
    expect(formatBaseUnits(100_000_000n, 8)).toBe('1')
    expect(formatBaseUnits(1n, 8)).toBe('0.00000001')
  })

  test('parseDecimal truncates beyond decimals (does not round)', () => {
    expect(parseDecimal('1.2345678901', 6)).toBe(1_234_567n)
    expect(parseDecimal('0.999999999', 6)).toBe(999_999n)
  })

  test('parseDecimal handles negatives', () => {
    expect(parseDecimal('-1.5', 18)).toBe(-1_500_000_000_000_000_000n)
  })

  test('parseDecimal accepts number input', () => {
    expect(parseDecimal(1.5, 6)).toBe(1_500_000n)
  })

  test('round-trip for representative amounts', () => {
    for (const [decimals, value] of [[18, '1.5'], [6, '0.000001'], [8, '0.00000001']]) {
      expect(formatBaseUnits(parseDecimal(value, decimals), decimals)).toBe(value)
    }
  })

  test('zero decimals', () => {
    expect(formatBaseUnits(42n, 0)).toBe('42')
    expect(parseDecimal('42', 0)).toBe(42n)
  })
})
