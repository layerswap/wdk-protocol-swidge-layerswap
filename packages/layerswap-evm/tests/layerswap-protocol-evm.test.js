import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'

import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'
import { WalletAccountEvmErc4337 } from '@tetherto/wdk-wallet-evm-erc-4337'

import LayerswapProtocolEvm from '../index.js'

const USER_ADDRESS = '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd'
const DEPOSIT_ADDRESS = '0x1111111111111111111111111111111111111111'
const USDC_CONTRACT = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const ERC20_CALLDATA = '0xa9059cbb000000000000000000000000111111111111111111111111111111111111111100000000000000000000000000000000000000000000000000000000000186a0'

const ETHEREUM_NETWORK = {
  name: 'ethereum',
  chain_id: '1',
  type: 'evm',
  tokens: [
    { symbol: 'USDC', contract: USDC_CONTRACT, decimals: 6, price_in_usd: 1 },
    { symbol: 'ETH', contract: null, decimals: 18, price_in_usd: 3000 }
  ]
}

const ARBITRUM_NETWORK = {
  name: 'arbitrum',
  chain_id: '42161',
  type: 'evm',
  tokens: [
    { symbol: 'USDC', contract: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', decimals: 6, price_in_usd: 1 },
    { symbol: 'ETH', contract: null, decimals: 18, price_in_usd: 3000 }
  ]
}

const NETWORKS = [ETHEREUM_NETWORK, ARBITRUM_NETWORK]

function buildFetchRouter (handlers) {
  return jest.fn((url, init) => {
    const method = (init && init.method) ?? 'GET'
    const u = new URL(url)
    const path = u.pathname
    const search = u.search

    for (const handler of handlers) {
      if (handler.method !== method) continue
      if (!handler.match.test(path + search)) continue
      const body = handler.body(url, init)
      const text = JSON.stringify(body)
      return Promise.resolve({
        ok: handler.status >= 200 && handler.status < 300,
        status: handler.status,
        statusText: handler.status === 200 ? 'OK' : 'Error',
        text: () => Promise.resolve(text),
        json: () => Promise.resolve(body)
      })
    }

    throw new Error(`Unmocked fetch: ${method} ${path}${search}`)
  })
}

function makeEip1193Provider ({ chainIdHex = '0x1' } = {}) {
  return {
    request: jest.fn(async ({ method }) => {
      switch (method) {
        case 'eth_chainId': return chainIdHex
        case 'eth_blockNumber': return '0x1'
        case 'net_version': return String(BigInt(chainIdHex))
        default:
          throw new Error(`Unmocked EIP-1193 method: ${method}`)
      }
    })
  }
}

function makeAccount ({ writable = true, provider = makeEip1193Provider(), kind = 'standard' } = {}) {
  const base = {
    _config: { provider },
    getAddress: jest.fn().mockResolvedValue(USER_ADDRESS),
    quoteSendTransaction: jest.fn().mockResolvedValue({ fee: 12_345n }),
    quoteTransfer: jest.fn().mockResolvedValue({ fee: 67_890n })
  }

  if (writable) {
    base.sendTransaction = jest.fn().mockResolvedValue({ hash: 'dummy-hash', fee: 12_345n })
  }

  const proto = kind === 'erc4337'
    ? WalletAccountEvmErc4337.prototype
    : WalletAccountEvm.prototype

  Object.setPrototypeOf(base, proto)
  return base
}

const NETWORKS_HANDLER = {
  method: 'GET',
  match: /^\/api\/v2\/networks$/,
  status: 200,
  body: () => ({ data: NETWORKS })
}

const QUOTE_HANDLER = (overrides = {}) => ({
  method: 'GET',
  match: /^\/api\/v2\/quote\?/,
  status: 200,
  body: () => ({
    data: {
      quote: {
        total_fee: 0.5,
        receive_amount: 99.5,
        min_receive_amount: 99,
        total_fee_in_usd: 0.5,
        blockchain_fee: 0.1,
        service_fee: 0.4,
        ...overrides
      }
    }
  })
})

const CREATE_SWAP_HANDLER = ({ swapId = 'swap-id-1', isErc20 = true } = {}) => ({
  method: 'POST',
  match: /^\/api\/v2\/swaps$/,
  status: 200,
  body: () => ({
    data: {
      swap: { id: swapId, status: 'created' },
      quote: { quote: { total_fee: 0.5 } },
      deposit_actions: [{
        type: 'transfer',
        order: 1,
        to_address: DEPOSIT_ADDRESS,
        amount: 100,
        amount_in_base_units: isErc20 ? '100000000' : '100000000000000000',
        call_data: isErc20 ? ERC20_CALLDATA : '0x',
        token: isErc20
          ? { symbol: 'USDC', contract: USDC_CONTRACT, decimals: 6 }
          : { symbol: 'ETH', contract: null, decimals: 18 },
        fee_token: { symbol: 'ETH', contract: null, decimals: 18 },
        network: ETHEREUM_NETWORK
      }]
    }
  })
})

const SPEEDUP_HANDLER = (swapId, status = 200) => ({
  method: 'POST',
  match: new RegExp(`^/api/v2/swaps/${swapId}/deposit_speedup$`),
  status,
  body: () => status >= 200 && status < 300
    ? ({ data: null })
    : ({ error: { code: 'SPEEDUP_FAILED', message: 'boom' } })
})

describe('LayerswapProtocolEvm', () => {
  let originalFetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  describe('constructor', () => {
    test('works without any config (apiKey is optional)', () => {
      const account = makeAccount()
      const protocol = new LayerswapProtocolEvm(account)
      expect(protocol.getApiClient()).toBeDefined()
    })

    test('accepts a config with apiKey set', () => {
      const account = makeAccount()
      const protocol = new LayerswapProtocolEvm(account, { apiKey: 'test-key' })
      expect(protocol.getApiClient()).toBeDefined()
    })
  })

  describe('api client', () => {
    test('omits X-LS-APIKEY header when apiKey is not set', async () => {
      const fetchMock = buildFetchRouter([NETWORKS_HANDLER])
      global.fetch = fetchMock

      const account = makeAccount()
      const protocol = new LayerswapProtocolEvm(account)
      await protocol.getApiClient().getNetworks()

      const [, init] = fetchMock.mock.calls[0]
      expect(init.headers['X-LS-APIKEY']).toBeUndefined()
    })

    test('sends X-LS-APIKEY header when apiKey is set', async () => {
      const fetchMock = buildFetchRouter([NETWORKS_HANDLER])
      global.fetch = fetchMock

      const account = makeAccount()
      const protocol = new LayerswapProtocolEvm(account, { apiKey: 'my-key' })
      await protocol.getApiClient().getNetworks()

      const [, init] = fetchMock.mock.calls[0]
      expect(init.headers['X-LS-APIKEY']).toBe('my-key')
    })
  })

  describe('quoteBridge', () => {
    test('returns fee and bridgeFee for an ERC-20 source (resolved by contract)', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        QUOTE_HANDLER()
      ])

      const account = makeAccount()
      const protocol = new LayerswapProtocolEvm(account, { apiKey: 'test-key' })

      const result = await protocol.quoteBridge({
        targetChain: 'arbitrum',
        recipient: USER_ADDRESS,
        token: USDC_CONTRACT,
        amount: 100_000_000n
      })

      expect(account.quoteTransfer).toHaveBeenCalledWith({
        token: USDC_CONTRACT,
        recipient: USER_ADDRESS,
        amount: 100_000_000n
      })
      expect(account.quoteSendTransaction).not.toHaveBeenCalled()
      expect(result).toEqual({ fee: 67_890n, bridgeFee: 500_000n })
    })

    test('returns fee and bridgeFee for an ERC-20 source resolved by symbol', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        QUOTE_HANDLER()
      ])

      const account = makeAccount()
      const protocol = new LayerswapProtocolEvm(account, { apiKey: 'test-key' })

      const result = await protocol.quoteBridge({
        targetChain: 'arbitrum',
        recipient: USER_ADDRESS,
        token: 'USDC',
        amount: 100_000_000n
      })

      expect(result.bridgeFee).toBe(500_000n)
    })

    test('uses quoteSendTransaction for native source token', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        QUOTE_HANDLER({ total_fee: 0.001 })
      ])

      const account = makeAccount()
      const protocol = new LayerswapProtocolEvm(account, { apiKey: 'test-key' })

      const result = await protocol.quoteBridge({
        targetChain: 'arbitrum',
        recipient: USER_ADDRESS,
        token: 'ETH',
        amount: 1_000_000_000_000_000_000n
      })

      expect(account.quoteSendTransaction).toHaveBeenCalledWith({
        to: USER_ADDRESS,
        value: 1_000_000_000_000_000_000n
      })
      expect(account.quoteTransfer).not.toHaveBeenCalled()
      expect(result.fee).toBe(12_345n)
      expect(result.bridgeFee).toBe(1_000_000_000_000_000n)
    })

    test('surfaces Layerswap API errors', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        {
          method: 'GET',
          match: /^\/api\/v2\/quote\?/,
          status: 400,
          body: () => ({ error: { code: 'ROUTE_NOT_FOUND_ERROR', message: 'no route' } })
        }
      ])

      const account = makeAccount()
      const protocol = new LayerswapProtocolEvm(account, { apiKey: 'test-key' })

      await expect(protocol.quoteBridge({
        targetChain: 'arbitrum',
        recipient: USER_ADDRESS,
        token: 'USDC',
        amount: 100_000_000n
      })).rejects.toThrow(/ROUTE_NOT_FOUND_ERROR/)
    })

    test('throws when account has no provider configured', async () => {
      const account = makeAccount()
      account._config = {}
      const protocol = new LayerswapProtocolEvm(account, { apiKey: 'test-key' })

      global.fetch = buildFetchRouter([NETWORKS_HANDLER])

      await expect(protocol.quoteBridge({
        targetChain: 'arbitrum',
        recipient: USER_ADDRESS,
        token: 'USDC',
        amount: 100_000_000n
      })).rejects.toThrow(/provider/)
    })
  })

  describe('bridge', () => {
    test('happy path (ERC-20): builds deposit tx with calldata and value=0', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        CREATE_SWAP_HANDLER({ isErc20: true }),
        SPEEDUP_HANDLER('swap-id-1')
      ])

      const account = makeAccount()
      const protocol = new LayerswapProtocolEvm(account, { apiKey: 'test-key' })

      const result = await protocol.bridge({
        targetChain: 'arbitrum',
        recipient: USER_ADDRESS,
        token: USDC_CONTRACT,
        amount: 100_000_000n
      })

      const expectedTx = { to: DEPOSIT_ADDRESS, value: 0n, data: ERC20_CALLDATA }
      expect(account.quoteSendTransaction).toHaveBeenCalledWith(expectedTx)
      expect(account.sendTransaction).toHaveBeenCalledWith(expectedTx)
      expect(result).toEqual({ hash: 'dummy-hash', fee: 12_345n, bridgeFee: 500_000n, swapId: 'swap-id-1' })
    })

    test('happy path (native): value is amount_in_base_units, data is 0x', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        CREATE_SWAP_HANDLER({ swapId: 'swap-id-2', isErc20: false }),
        SPEEDUP_HANDLER('swap-id-2')
      ])

      const account = makeAccount()
      const protocol = new LayerswapProtocolEvm(account, { apiKey: 'test-key' })

      const result = await protocol.bridge({
        targetChain: 'arbitrum',
        recipient: USER_ADDRESS,
        token: 'ETH',
        amount: 100_000_000_000_000_000n
      })

      const expectedTx = { to: DEPOSIT_ADDRESS, value: 100_000_000_000_000_000n, data: '0x' }
      expect(account.sendTransaction).toHaveBeenCalledWith(expectedTx)
      expect(result.hash).toBe('dummy-hash')
      expect(result.swapId).toBe('swap-id-2')
    })

    test('happy path (ERC-4337): routes through array-form sendTransaction with config', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        CREATE_SWAP_HANDLER({ swapId: 'swap-id-4337', isErc20: true }),
        SPEEDUP_HANDLER('swap-id-4337')
      ])

      const account = makeAccount({ kind: 'erc4337' })
      const protocol = new LayerswapProtocolEvm(account, { apiKey: 'test-key' })

      const overrideConfig = { paymasterToken: { address: '0xfeeee' } }

      const result = await protocol.bridge({
        targetChain: 'arbitrum',
        recipient: USER_ADDRESS,
        token: USDC_CONTRACT,
        amount: 100_000_000n
      }, overrideConfig)

      const expectedTx = { to: DEPOSIT_ADDRESS, value: 0n, data: ERC20_CALLDATA }
      expect(account.quoteSendTransaction).toHaveBeenCalledWith([expectedTx], overrideConfig)
      expect(account.sendTransaction).toHaveBeenCalledWith([expectedTx], overrideConfig)
      expect(result.swapId).toBe('swap-id-4337')
    })

    test('throws when account is read-only (no instanceof match)', async () => {
      // A plain object (no WalletAccountEvm/Erc4337 prototype) represents the read-only
      // case from the protocol's perspective — the instanceof gate rejects it.
      const account = {
        _config: { provider: 'https://rpc.example/eth' },
        getAddress: jest.fn().mockResolvedValue(USER_ADDRESS)
      }
      const protocol = new LayerswapProtocolEvm(account, { apiKey: 'test-key' })

      await expect(protocol.bridge({
        targetChain: 'arbitrum',
        recipient: USER_ADDRESS,
        token: 'USDC',
        amount: 100_000_000n
      })).rejects.toThrow(/non read-only account/)
    })

    test('throws when bridgeFee exceeds bridgeMaxFee, and does not send', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        CREATE_SWAP_HANDLER({ isErc20: true })
      ])

      const account = makeAccount()
      const protocol = new LayerswapProtocolEvm(account, {
        apiKey: 'test-key',
        bridgeMaxFee: 100_000n // 0.1 USDC — quote returns 0.5 USDC = 500_000 base units
      })

      await expect(protocol.bridge({
        targetChain: 'arbitrum',
        recipient: USER_ADDRESS,
        token: USDC_CONTRACT,
        amount: 100_000_000n
      })).rejects.toThrow(/Exceeded maximum fee cost for bridge operation\./)

      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test('swallows speedup endpoint failure without affecting the result', async () => {
      const fetchMock = buildFetchRouter([
        NETWORKS_HANDLER,
        CREATE_SWAP_HANDLER({ swapId: 'swap-id-3', isErc20: true }),
        SPEEDUP_HANDLER('swap-id-3', 500)
      ])
      global.fetch = fetchMock

      const account = makeAccount()
      const protocol = new LayerswapProtocolEvm(account, { apiKey: 'test-key' })

      const result = await protocol.bridge({
        targetChain: 'arbitrum',
        recipient: USER_ADDRESS,
        token: USDC_CONTRACT,
        amount: 100_000_000n
      })

      expect(result.hash).toBe('dummy-hash')

      const calledSpeedup = fetchMock.mock.calls.some(([url]) => String(url).includes('/deposit_speedup'))
      expect(calledSpeedup).toBe(true)
    })

    test('throws when source chain equals target chain', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER
      ])

      const account = makeAccount()
      const protocol = new LayerswapProtocolEvm(account, { apiKey: 'test-key' })

      await expect(protocol.bridge({
        targetChain: 'ethereum',
        recipient: USER_ADDRESS,
        token: USDC_CONTRACT,
        amount: 100_000_000n
      })).rejects.toThrow(/target chain cannot be equal to the source chain/)
    })

    test('throws when chainId is not in Layerswap networks', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER
      ])

      const account = makeAccount({ provider: makeEip1193Provider({ chainIdHex: '0xdeadbeef' }) })
      const protocol = new LayerswapProtocolEvm(account, { apiKey: 'test-key' })

      await expect(protocol.bridge({
        targetChain: 'arbitrum',
        recipient: USER_ADDRESS,
        token: USDC_CONTRACT,
        amount: 100_000_000n
      })).rejects.toThrow(/does not support source chain/)
    })
  })

  describe('getTransactionStatus', () => {
    test('resolves the network via provider chainId and forwards to the API client', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        {
          method: 'GET',
          match: /^\/api\/v2\/transaction_status\?network=ethereum&transaction_id=0xaa$/,
          status: 200,
          body: () => ({ data: { status: 'completed' } })
        }
      ])

      const account = makeAccount()
      const protocol = new LayerswapProtocolEvm(account)
      await expect(protocol.getTransactionStatus('0xaa')).resolves.toEqual({ status: 'completed' })
    })

    test('honours sourceChain override and skips chainId detection', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        {
          method: 'GET',
          match: /^\/api\/v2\/transaction_status\?network=arbitrum&transaction_id=0xbb$/,
          status: 200,
          body: () => ({ data: { status: 'pending' } })
        }
      ])

      const account = makeAccount()
      const protocol = new LayerswapProtocolEvm(account)
      await expect(protocol.getTransactionStatus('0xbb', { sourceChain: 'arbitrum' }))
        .resolves.toEqual({ status: 'pending' })
    })
  })
})
