import { describe, expect, test } from '@jest/globals'

import {
  mapSwapStatus,
  mapSwapTransactions,
  deriveSwidgeStatus,
  buildStatusResult,
  buildSupportedChains,
  buildSupportedTokens,
  buildQuoteFees,
  buildSwidgeQuote,
  parseCompletionTime,
  formatSlippage,
  assertFeeGuards
} from '../index.js'

const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

const ETHEREUM_NETWORK = {
  name: 'ETHEREUM_MAINNET',
  display_name: 'Ethereum',
  chain_id: '1',
  type: 'evm',
  token: { symbol: 'ETH', contract: null, decimals: 18 },
  tokens: [
    { symbol: 'USDC', contract: USDC_ETH, decimals: 6, display_asset: 'USD Coin' },
    { symbol: 'ETH', contract: null, decimals: 18 }
  ]
}

const SOLANA_NETWORK = {
  name: 'SOLANA_MAINNET',
  chain_id: 'mainnet-beta',
  type: 'solana',
  tokens: [
    { symbol: 'SOL', contract: null, decimals: 9 }
  ]
}

const QUOTE = {
  requested_amount: 100,
  receive_amount: 98.5,
  min_receive_amount: 98,
  total_fee: 1.5,
  total_fee_in_usd: 1.5,
  blockchain_fee: 0.9,
  service_fee: 0.6,
  avg_completion_time: '00:02:30.1234567'
}

const SOURCE_TOKEN = { symbol: 'USDC', contract: USDC_ETH, decimals: 6 }
const DESTINATION_TOKEN = { symbol: 'USDC', contract: null, decimals: 6 }

describe('mapSwapStatus', () => {
  test('maps every known Layerswap status to the WDK vocabulary', () => {
    expect(mapSwapStatus('user_transfer_pending')).toBe('action-required')
    expect(mapSwapStatus('ls_transfer_pending')).toBe('pending')
    expect(mapSwapStatus('completed')).toBe('completed')
    expect(mapSwapStatus('failed')).toBe('failed')
    expect(mapSwapStatus('expired')).toBe('expired')
    expect(mapSwapStatus('cancelled')).toBe('cancelled')
    expect(mapSwapStatus('pending_refund')).toBe('refund-pending')
    expect(mapSwapStatus('refunded')).toBe('refunded')
  })

  test('maps unknown statuses to pending so pollers keep polling', () => {
    expect(mapSwapStatus('some_future_status')).toBe('pending')
    expect(mapSwapStatus(undefined)).toBe('pending')
  })
})

describe('mapSwapTransactions', () => {
  test('maps input/output/refund/refuel types and skips hash-less entries', () => {
    const transactions = [
      { transaction_hash: '0xaaa', type: 'input', status: 'completed', network: ETHEREUM_NETWORK },
      { transaction_hash: '0xbbb', type: 'output', status: 'completed', network: 'ARBITRUM_MAINNET' },
      { transaction_hash: '0xccc', type: 'refund', status: 'completed' },
      { transaction_hash: '0xddd', type: 'refuel', status: 'completed' },
      { transaction_hash: '', type: 'output', status: 'pending' },
      { type: 'output', status: 'pending' }
    ]

    expect(mapSwapTransactions(transactions)).toEqual([
      { hash: '0xaaa', chain: 'ETHEREUM_MAINNET', type: 'source' },
      { hash: '0xbbb', chain: 'ARBITRUM_MAINNET', type: 'destination' },
      { hash: '0xccc', type: 'refund' },
      { hash: '0xddd', type: 'other' }
    ])
  })

  test('returns an empty array for missing input', () => {
    expect(mapSwapTransactions(undefined)).toEqual([])
  })
})

describe('deriveSwidgeStatus', () => {
  test('completed output transaction wins over a lagging swap status', () => {
    expect(deriveSwidgeStatus({
      status: 'ls_transfer_pending',
      transactions: [
        { transaction_hash: '0xin', type: 'input', status: 'completed' },
        { transaction_hash: '0xout', type: 'output', status: 'completed' }
      ]
    })).toBe('completed')
  })

  test('output transaction in flight maps to pending regardless of swap status', () => {
    expect(deriveSwidgeStatus({
      status: 'ls_transfer_pending',
      transactions: [{ transaction_hash: '0xout', type: 'output', status: 'pending' }]
    })).toBe('pending')
    expect(deriveSwidgeStatus({
      status: 'user_transfer_pending',
      transactions: [{ transaction_hash: '0xout', type: 'output', status: 'initiated' }]
    })).toBe('pending')
  })

  test('refund transaction maps to refunded / refund-pending', () => {
    expect(deriveSwidgeStatus({
      status: 'pending_refund',
      transactions: [{ transaction_hash: '0xr', type: 'refund', status: 'completed' }]
    })).toBe('refunded')
    expect(deriveSwidgeStatus({
      status: 'failed',
      transactions: [{ transaction_hash: '0xr', type: 'refund', status: 'initiated' }]
    })).toBe('refund-pending')
  })

  test('falls back to the swap-level status when no transaction is decisive', () => {
    expect(deriveSwidgeStatus({ status: 'user_transfer_pending' })).toBe('action-required')
    expect(deriveSwidgeStatus({
      status: 'failed',
      transactions: [{ transaction_hash: '0xin', type: 'input', status: 'completed' }]
    })).toBe('failed')
  })
})

describe('buildStatusResult', () => {
  test('maps a swap response to a WDK status result', () => {
    const response = {
      swap: {
        id: 'swap-1',
        status: 'ls_transfer_pending',
        transactions: [{ transaction_hash: '0xaaa', type: 'input', status: 'completed' }]
      }
    }

    expect(buildStatusResult(response)).toEqual({
      status: 'pending',
      transactions: [{ hash: '0xaaa', type: 'source' }]
    })
  })

  test('reports completed as soon as the output transaction confirms', () => {
    const response = {
      swap: {
        id: 'swap-1',
        status: 'ls_transfer_pending',
        transactions: [
          { transaction_hash: '0xaaa', type: 'input', status: 'completed' },
          { transaction_hash: '0xbbb', type: 'output', status: 'completed', network: 'BASE_SEPOLIA' }
        ]
      }
    }

    expect(buildStatusResult(response)).toEqual({
      status: 'completed',
      transactions: [
        { hash: '0xaaa', type: 'source' },
        { hash: '0xbbb', chain: 'BASE_SEPOLIA', type: 'destination' }
      ]
    })
  })

  test('throws when the swap is missing', () => {
    expect(() => buildStatusResult({})).toThrow('missing swap details')
  })
})

describe('buildSupportedChains', () => {
  test('maps networks with display name and native token fallbacks', () => {
    expect(buildSupportedChains([ETHEREUM_NETWORK, SOLANA_NETWORK])).toEqual([
      { id: 'ETHEREUM_MAINNET', name: 'Ethereum', type: 'evm', nativeToken: 'ETH' },
      { id: 'SOLANA_MAINNET', name: 'SOLANA_MAINNET', type: 'solana', nativeToken: '' }
    ])
  })
})

describe('buildSupportedTokens', () => {
  test('flattens all networks without options', () => {
    const tokens = buildSupportedTokens([ETHEREUM_NETWORK, SOLANA_NETWORK])
    expect(tokens).toHaveLength(3)
    expect(tokens[0]).toEqual({
      token: 'USDC',
      chain: 'ETHEREUM_MAINNET',
      symbol: 'USDC',
      decimals: 6,
      address: USDC_ETH,
      name: 'USD Coin'
    })
    expect(tokens[1]).toEqual({ token: 'ETH', chain: 'ETHEREUM_MAINNET', symbol: 'ETH', decimals: 18 })
  })

  test('scopes to toChain (case-insensitive), preferring it over fromChain', () => {
    const tokens = buildSupportedTokens(
      [ETHEREUM_NETWORK, SOLANA_NETWORK],
      { fromChain: 'ETHEREUM_MAINNET', toChain: 'solana_mainnet' }
    )
    expect(tokens).toEqual([{ token: 'SOL', chain: 'SOLANA_MAINNET', symbol: 'SOL', decimals: 9 }])
  })

  test('scopes to fromChain when toChain is absent', () => {
    const tokens = buildSupportedTokens([ETHEREUM_NETWORK, SOLANA_NETWORK], { fromChain: 'SOLANA_MAINNET' })
    expect(tokens).toEqual([{ token: 'SOL', chain: 'SOLANA_MAINNET', symbol: 'SOL', decimals: 9 }])
  })
})

describe('buildQuoteFees', () => {
  test('itemises service and blockchain fees in source-token base units', () => {
    const fees = buildQuoteFees(QUOTE, SOURCE_TOKEN, 'ETHEREUM_MAINNET')

    expect(fees).toEqual([
      {
        type: 'protocol',
        amount: 600000n,
        token: 'USDC',
        chain: 'ETHEREUM_MAINNET',
        included: true,
        description: 'Layerswap service fee'
      },
      {
        type: 'network',
        amount: 900000n,
        token: 'USDC',
        chain: 'ETHEREUM_MAINNET',
        included: true,
        description: 'Destination network fee, charged by Layerswap in the source token'
      }
    ])
  })

  test('falls back to total_fee when the breakdown is absent', () => {
    expect(buildQuoteFees({ total_fee: 0.5 }, SOURCE_TOKEN)).toEqual([
      {
        type: 'protocol',
        amount: 500000n,
        token: 'USDC',
        included: true,
        description: 'Layerswap total fee'
      }
    ])
  })

  test('omits absent fee components', () => {
    expect(buildQuoteFees({ requested_amount: 1 }, SOURCE_TOKEN)).toEqual([])
  })
})

describe('buildSwidgeQuote', () => {
  test('converts decimal amounts to base units and parses duration', () => {
    const quote = buildSwidgeQuote(QUOTE, SOURCE_TOKEN, DESTINATION_TOKEN, 'ETHEREUM_MAINNET')

    expect(quote.fromTokenAmount).toBe(100000000n)
    expect(quote.toTokenAmount).toBe(98500000n)
    expect(quote.toTokenAmountMin).toBe(98000000n)
    expect(quote.fees).toHaveLength(2)
    expect(quote.estimatedDuration).toBe(150)
  })

  test('falls back to receive_amount when min_receive_amount is absent', () => {
    const quote = buildSwidgeQuote(
      { ...QUOTE, min_receive_amount: undefined, avg_completion_time: undefined },
      SOURCE_TOKEN,
      DESTINATION_TOKEN
    )
    expect(quote.toTokenAmountMin).toBe(98500000n)
    expect(quote.estimatedDuration).toBeUndefined()
  })
})

describe('parseCompletionTime', () => {
  test('parses HH:MM:SS with and without fractional seconds', () => {
    expect(parseCompletionTime('00:02:30')).toBe(150)
    expect(parseCompletionTime('01:00:04.2062907')).toBe(3604)
  })

  test('returns undefined on unparseable input', () => {
    expect(parseCompletionTime(undefined)).toBeUndefined()
    expect(parseCompletionTime('fast')).toBeUndefined()
  })
})

describe('formatSlippage', () => {
  test('converts WDK decimals to Layerswap percent strings', () => {
    expect(formatSlippage(0.01)).toBe('1')
    expect(formatSlippage(0.005)).toBe('0.5')
    expect(formatSlippage(0.07)).toBe('7')
    expect(formatSlippage(undefined)).toBeUndefined()
  })

  test('rejects negative and non-finite values', () => {
    expect(() => formatSlippage(-0.01)).toThrow('Invalid slippage')
    expect(() => formatSlippage(Number.NaN)).toThrow('Invalid slippage')
  })
})

describe('assertFeeGuards', () => {
  const fees = [
    { type: 'protocol', amount: 600000n, token: 'USDC', included: true },
    { type: 'network', amount: 900000n, token: 'USDC', included: true },
    { type: 'network', amount: 12345n, token: 'ETH', included: false }
  ]

  test('passes when fees are within the configured caps', () => {
    expect(() => assertFeeGuards(fees, 100000000n, 'USDC', {
      maxProtocolFeeBps: 60,
      maxNetworkFeeBps: 90
    })).not.toThrow()
  })

  test('throws when the protocol fee exceeds the cap', () => {
    expect(() => assertFeeGuards(fees, 100000000n, 'USDC', { maxProtocolFeeBps: 59 }))
      .toThrow('Exceeded maximum protocol fee')
  })

  test('throws when the network fee exceeds the cap, ignoring other-unit fees', () => {
    expect(() => assertFeeGuards(fees, 100000000n, 'USDC', { maxNetworkFeeBps: 89n }))
      .toThrow('Exceeded maximum network fee')
  })

  test('is a no-op without configured caps', () => {
    expect(() => assertFeeGuards(fees, 100000000n, 'USDC')).not.toThrow()
    expect(() => assertFeeGuards(fees, 0n, 'USDC', { maxProtocolFeeBps: 1 })).not.toThrow()
  })
})
