import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'

import { Address, Cell, toNano } from '@ton/ton'

import LayerswapProtocolTon from '../index.js'

// ---------------------------------------------------------------------------
// Fixtures (a slice of what Layerswap returns for TON_MAINNET routes).
// ---------------------------------------------------------------------------

// Build deterministic, checksum-valid TON addresses from raw hashes so the tests
// don't depend on real on-chain addresses.
function tonAddr (byte) {
  return new Address(0, Buffer.alloc(32, byte)).toString({ bounceable: true, urlSafe: true })
}

const TON_JETTON_USDT_MASTER = tonAddr(0x11)
const TON_DEPOSIT_FRIENDLY = tonAddr(0x22)

const TON_MAINNET = {
  name: 'TON_MAINNET',
  chain_id: null,
  type: 'ton',
  tokens: [
    { symbol: 'TON', contract: null, decimals: 9, price_in_usd: 5 },
    { symbol: 'USDT', contract: TON_JETTON_USDT_MASTER, decimals: 6, price_in_usd: 1 }
  ]
}

const ARBITRUM_MAINNET = {
  name: 'ARBITRUM_MAINNET',
  chain_id: '42161',
  type: 'evm',
  tokens: [
    { symbol: 'USDT', contract: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', decimals: 6, price_in_usd: 1 },
    { symbol: 'ETH', contract: null, decimals: 18, price_in_usd: 2128 }
  ]
}

const NETWORKS = [TON_MAINNET, ARBITRUM_MAINNET]

const SENDER_FRIENDLY = tonAddr(0x33)
// Resolved jetton wallet for the sender — deterministic, checksum-valid address.
const SENDER_JETTON_WALLET = tonAddr(0x44)

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

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

/**
 * Builds a mock TON account. The protocol only consumes:
 *   - getAddress()
 *   - sendTransaction({ to, value, body })
 *   - _getJettonWalletAddress(token)
 *
 * `writable: false` removes sendTransaction so the read-only guard fires.
 */
function makeAccount ({
  writable = true,
  address = SENDER_FRIENDLY,
  sendResult = { hash: 'tonhash-deadbeef', fee: 12_345_000n },
  jettonWallet = SENDER_JETTON_WALLET
} = {}) {
  const sendTransaction = jest.fn().mockResolvedValue(sendResult)
  const getJettonWalletAddress = jest.fn().mockResolvedValue(Address.parse(jettonWallet))

  const account = {
    getAddress: jest.fn().mockResolvedValue(address),
    _getJettonWalletAddress: getJettonWalletAddress
  }
  if (writable) account.sendTransaction = sendTransaction

  return { account, sendTransaction, getJettonWalletAddress, address }
}

// ---------------------------------------------------------------------------
// Layerswap API handlers.
// ---------------------------------------------------------------------------

const NETWORKS_HANDLER = {
  method: 'GET',
  match: /^\/api\/v2\/networks$/,
  status: 200,
  body: () => ({ data: NETWORKS })
}

const QUOTE_HANDLER = {
  method: 'GET',
  match: /^\/api\/v2\/quote\?/,
  status: 200,
  body: () => ({
    data: {
      quote: {
        requested_amount: 10,
        receive_amount: 9.5,
        min_receive_amount: 9.4,
        total_fee: 0.5,
        total_fee_in_usd: 0.5,
        blockchain_fee: 0.45,
        service_fee: 0.05
      }
    }
  })
}

function makeCreateSwapHandler ({
  totalFee = 0.5,
  callData = JSON.stringify({ comment: 'swap-ref-abc', amount: '10000000' }),
  tokenSymbol = 'USDT'
} = {}) {
  return {
    method: 'POST',
    match: /^\/api\/v2\/swaps$/,
    status: 200,
    body: (_url, _init) => {
      const sourceToken = TON_MAINNET.tokens.find((t) => t.symbol === tokenSymbol)
      return ({
        data: {
          swap: {
            id: 'swap-ton-123',
            created_date: '2026-05-22T00:00:00Z',
            status: 'created',
            source_network: TON_MAINNET,
            source_token: sourceToken,
            destination_network: ARBITRUM_MAINNET,
            destination_token: ARBITRUM_MAINNET.tokens.find((t) => t.symbol === 'USDT'),
            destination_address: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
            requested_amount: 10
          },
          deposit_actions: [{
            amount: 10,
            amount_in_base_units: '10000000',
            call_data: callData,
            to_address: TON_DEPOSIT_FRIENDLY,
            token: sourceToken,
            fee_token: TON_MAINNET.tokens.find((t) => t.symbol === 'TON'),
            network: TON_MAINNET,
            order: 0,
            type: 'transfer'
          }],
          quote: {
            quote: {
              requested_amount: 10,
              receive_amount: 10 - totalFee,
              min_receive_amount: 10 - totalFee - 0.05,
              total_fee: totalFee,
              total_fee_in_usd: totalFee,
              blockchain_fee: totalFee * 0.9,
              service_fee: totalFee * 0.1
            }
          }
        }
      })
    }
  }
}

const SPEEDUP_HANDLER = {
  method: 'POST',
  match: /^\/api\/v2\/swaps\/[^/]+\/deposit_speedup$/,
  status: 200,
  body: () => ({ data: null })
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe('LayerswapProtocolTon', () => {
  let originalFetch
  beforeEach(() => { originalFetch = global.fetch })
  afterEach(() => { global.fetch = originalFetch })

  describe('constructor', () => {
    test('accepts a config-less init', () => {
      const { account } = makeAccount()
      const p = new LayerswapProtocolTon(account)
      expect(p.getApiClient()).toBeDefined()
    })

    test('honours apiKey + apiUrl + bridgeMaxFee config', () => {
      const { account } = makeAccount()
      const p = new LayerswapProtocolTon(account, {
        apiKey: 'ls-test-key',
        apiUrl: 'https://example.com/api',
        bridgeMaxFee: 1_000_000n
      })
      expect(p._config.bridgeMaxFee).toBe(1_000_000n)
    })
  })

  describe('quoteBridge', () => {
    test('returns bridgeFee in source-token base units and jetton fee approximation', async () => {
      global.fetch = buildFetchRouter([NETWORKS_HANDLER, QUOTE_HANDLER])

      const { account } = makeAccount()
      const p = new LayerswapProtocolTon(account)

      const result = await p.quoteBridge({
        targetChain: 'ARBITRUM_MAINNET',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'USDT',
        amount: 10_000_000n
      })

      // USDT-jetton has 6 decimals; total_fee 0.5 → 500000 base units.
      expect(result.bridgeFee).toBe(500_000n)
      // Jetton approximation = 0.05 TON = 50_000_000n nanotons.
      expect(result.fee).toBe(50_000_000n)
    })

    test('uses native-fee approximation for TON quotes', async () => {
      global.fetch = buildFetchRouter([NETWORKS_HANDLER, QUOTE_HANDLER])

      const { account } = makeAccount()
      const p = new LayerswapProtocolTon(account)

      const result = await p.quoteBridge({
        targetChain: 'ARBITRUM_MAINNET',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'TON',
        destinationToken: 'ETH',
        amount: 1_000_000_000n
      })

      // Native TON approximation = 0.01 TON = 10_000_000n nanotons.
      expect(result.fee).toBe(10_000_000n)
    })

    test('surfaces Layerswap API errors', async () => {
      global.fetch = buildFetchRouter([NETWORKS_HANDLER, {
        method: 'GET',
        match: /^\/api\/v2\/quote\?/,
        status: 400,
        body: () => ({ error: { code: 'BAD_REQUEST', message: 'invalid route' } })
      }])

      const { account } = makeAccount()
      const p = new LayerswapProtocolTon(account)

      await expect(p.quoteBridge({
        targetChain: 'ARBITRUM_MAINNET',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'USDT',
        amount: 10_000_000n
      })).rejects.toThrow(/BAD_REQUEST/)
    })

    test('respects sourceChain override (no validation against a fixed default)', async () => {
      // Should send TON_MAINNET in the route resolution regardless of the override
      // succeeding — the network simply needs to exist in the catalog. We verify
      // that an unknown sourceChain leads to a clear error from the core helper.
      global.fetch = buildFetchRouter([NETWORKS_HANDLER])

      const { account } = makeAccount()
      const p = new LayerswapProtocolTon(account)

      await expect(p.quoteBridge({
        targetChain: 'ARBITRUM_MAINNET',
        sourceChain: 'TON_UNKNOWN',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'USDT',
        amount: 10_000_000n
      })).rejects.toThrow(/TON_UNKNOWN/)
    })
  })

  describe('bridge — jetton (USDT)', () => {
    test('happy path: resolves jetton wallet, builds jetton-transfer body, sends with 0.045 TON gas', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        makeCreateSwapHandler({ callData: JSON.stringify({ comment: 'ref-jetton', amount: '10000000' }) }),
        SPEEDUP_HANDLER
      ])

      const { account, sendTransaction, getJettonWalletAddress } = makeAccount()
      const p = new LayerswapProtocolTon(account)

      const result = await p.bridge({
        targetChain: 'ARBITRUM_MAINNET',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'USDT',
        amount: 10_000_000n
      })

      expect(result.hash).toBe('tonhash-deadbeef')
      expect(result.swapId).toBe('swap-ton-123')
      expect(result.bridgeFee).toBe(500_000n)
      expect(result.fee).toBe(12_345_000n) // pass-through from account.sendTransaction

      expect(getJettonWalletAddress).toHaveBeenCalledWith(TON_JETTON_USDT_MASTER)
      expect(sendTransaction).toHaveBeenCalledTimes(1)

      const sent = sendTransaction.mock.calls[0][0]
      expect(sent.to).toBe(Address.parse(SENDER_JETTON_WALLET).toString())
      expect(sent.value).toBe(toNano('0.045'))
      expect(sent.body).toBeInstanceOf(Cell)

      // Decode the body and assert TIP-3 op + jetton amount + destinations.
      const slice = sent.body.beginParse()
      expect(slice.loadUint(32)).toBe(0x0f8a7ea5) // op
      expect(slice.loadUintBig(64)).toBe(0n)      // query id
      expect(slice.loadCoins()).toBe(10_000_000n) // jetton amount from call_data
      expect(slice.loadAddress().toString()).toBe(Address.parse(TON_DEPOSIT_FRIENDLY).toString())
      expect(slice.loadAddress().toString()).toBe(Address.parse(TON_DEPOSIT_FRIENDLY).toString())
      expect(slice.loadBit()).toBe(false) // no custom payload
      expect(slice.loadCoins()).toBe(toNano('0.00002')) // forward amount
      expect(slice.loadBit()).toBe(true) // forward payload as ref

      const forward = slice.loadRef().beginParse()
      expect(forward.loadUint(32)).toBe(0)
      expect(forward.loadStringTail()).toBe('ref-jetton')
    })

    test('falls back to options.amount when call_data is unparseable', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        makeCreateSwapHandler({ callData: 'not-json' }),
        SPEEDUP_HANDLER
      ])

      const { account, sendTransaction } = makeAccount()
      const p = new LayerswapProtocolTon(account)

      await p.bridge({
        targetChain: 'ARBITRUM_MAINNET',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'USDT',
        amount: 7_000_000n
      })

      const sent = sendTransaction.mock.calls[0][0]
      const slice = sent.body.beginParse()
      slice.loadUint(32)                            // op
      slice.loadUintBig(64)                         // query id
      expect(slice.loadCoins()).toBe(7_000_000n)    // fallback to options.amount
    })
  })

  describe('bridge — native (TON)', () => {
    test('happy path: builds comment body, sends full amount to deposit address', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        makeCreateSwapHandler({
          callData: JSON.stringify({ comment: 'ref-native' }),
          tokenSymbol: 'TON'
        }),
        SPEEDUP_HANDLER
      ])

      const { account, sendTransaction, getJettonWalletAddress } = makeAccount()
      const p = new LayerswapProtocolTon(account)

      const result = await p.bridge({
        targetChain: 'ARBITRUM_MAINNET',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'TON',
        destinationToken: 'ETH',
        amount: 1_000_000_000n
      })

      expect(result.hash).toBe('tonhash-deadbeef')
      expect(getJettonWalletAddress).not.toHaveBeenCalled()

      const sent = sendTransaction.mock.calls[0][0]
      expect(sent.to).toBe(TON_DEPOSIT_FRIENDLY)
      expect(sent.value).toBe(1_000_000_000n)

      const slice = sent.body.beginParse()
      expect(slice.loadUint(32)).toBe(0)
      expect(slice.loadStringTail()).toBe('ref-native')
    })

    test('tolerates empty / missing call_data with an empty comment', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        makeCreateSwapHandler({ callData: '', tokenSymbol: 'TON' }),
        SPEEDUP_HANDLER
      ])

      const { account, sendTransaction } = makeAccount()
      const p = new LayerswapProtocolTon(account)

      await p.bridge({
        targetChain: 'ARBITRUM_MAINNET',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'TON',
        destinationToken: 'ETH',
        amount: 1_000_000_000n
      })

      const sent = sendTransaction.mock.calls[0][0]
      const slice = sent.body.beginParse()
      slice.loadUint(32)
      expect(slice.loadStringTail()).toBe('')
    })
  })

  describe('bridge — guards', () => {
    test('throws when bridgeFee exceeds bridgeMaxFee, and does not send', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        makeCreateSwapHandler({ totalFee: 1 }), // 1 USDT → 1_000_000 base units
        SPEEDUP_HANDLER
      ])

      const { account, sendTransaction } = makeAccount()
      const p = new LayerswapProtocolTon(account, { bridgeMaxFee: 500_000n })

      await expect(p.bridge({
        targetChain: 'ARBITRUM_MAINNET',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'USDT',
        amount: 10_000_000n
      })).rejects.toThrow(/Exceeded maximum fee/)

      expect(sendTransaction).not.toHaveBeenCalled()
    })

    test('per-call config override of bridgeMaxFee takes precedence', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        makeCreateSwapHandler({ totalFee: 0.5 }),
        SPEEDUP_HANDLER
      ])

      const { account } = makeAccount()
      const p = new LayerswapProtocolTon(account, { bridgeMaxFee: 10_000_000n })

      await expect(p.bridge({
        targetChain: 'ARBITRUM_MAINNET',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'USDT',
        amount: 10_000_000n
      }, { bridgeMaxFee: 1n })).rejects.toThrow(/Exceeded maximum fee/)
    })

    test('throws when account is read-only (no sendTransaction)', async () => {
      const { account } = makeAccount({ writable: false })
      const p = new LayerswapProtocolTon(account)

      await expect(p.bridge({
        targetChain: 'ARBITRUM_MAINNET',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'USDT',
        amount: 10_000_000n
      })).rejects.toThrow(/non read-only account/)
    })

    test('throws when only non-wallet deposit actions are returned', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        {
          method: 'POST',
          match: /^\/api\/v2\/swaps$/,
          status: 200,
          body: () => ({
            data: {
              swap: { id: 'swap-y', created_date: '', status: 'created', source_network: TON_MAINNET, source_token: TON_MAINNET.tokens[1], destination_network: ARBITRUM_MAINNET, destination_token: ARBITRUM_MAINNET.tokens[0], destination_address: 'r', requested_amount: 10 },
              deposit_actions: [{
                amount: 10,
                amount_in_base_units: '10000000',
                call_data: '{}',
                to_address: TON_DEPOSIT_FRIENDLY,
                token: TON_MAINNET.tokens[1],
                fee_token: TON_MAINNET.tokens[0],
                network: TON_MAINNET,
                order: 0,
                type: 'manual_transfer'
              }]
            }
          })
        }
      ])

      const { account } = makeAccount()
      const p = new LayerswapProtocolTon(account)

      await expect(p.bridge({
        targetChain: 'ARBITRUM_MAINNET',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'USDT',
        amount: 10_000_000n
      })).rejects.toThrow(/manual_transfer.*cannot drive the deposit/)
    })

    test('throws when source chain equals target chain', async () => {
      global.fetch = buildFetchRouter([NETWORKS_HANDLER])

      const { account } = makeAccount()
      const p = new LayerswapProtocolTon(account)

      await expect(p.bridge({
        targetChain: 'TON_MAINNET',
        recipient: SENDER_FRIENDLY,
        token: 'USDT',
        amount: 10_000_000n
      })).rejects.toThrow(/cannot be equal/)
    })

    test('swallows speedup endpoint failures without affecting the result', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        makeCreateSwapHandler(),
        {
          method: 'POST',
          match: /^\/api\/v2\/swaps\/[^/]+\/deposit_speedup$/,
          status: 500,
          body: () => ({ error: { code: 'INTERNAL', message: 'speedup unavailable' } })
        }
      ])

      const { account } = makeAccount()
      const p = new LayerswapProtocolTon(account)

      const result = await p.bridge({
        targetChain: 'ARBITRUM_MAINNET',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'USDT',
        amount: 10_000_000n
      })

      expect(result.hash).toBe('tonhash-deadbeef')
    })
  })

  describe('_parseCallData', () => {
    test('parses valid JSON', () => {
      const { account } = makeAccount()
      const p = new LayerswapProtocolTon(account)
      expect(p._parseCallData('{"comment":"hello","amount":"100"}')).toEqual({ comment: 'hello', amount: '100' })
    })

    test('returns null for null/undefined/empty', () => {
      const { account } = makeAccount()
      const p = new LayerswapProtocolTon(account)
      expect(p._parseCallData(null)).toBe(null)
      expect(p._parseCallData(undefined)).toBe(null)
      expect(p._parseCallData('')).toBe(null)
    })

    test('returns null for non-JSON', () => {
      const { account } = makeAccount()
      const p = new LayerswapProtocolTon(account)
      expect(p._parseCallData('not-json-{}')).toBe(null)
    })
  })

  describe('getTransactionStatus', () => {
    test('defaults the network to TON_MAINNET', async () => {
      global.fetch = buildFetchRouter([{
        method: 'GET',
        match: /^\/api\/v2\/transaction_status\?network=TON_MAINNET&transaction_id=hash-aa$/,
        status: 200,
        body: () => ({ data: { status: 'completed' } })
      }])

      const { account } = makeAccount()
      const p = new LayerswapProtocolTon(account)
      await expect(p.getTransactionStatus('hash-aa')).resolves.toEqual({ status: 'completed' })
    })

    test('honours sourceChain override', async () => {
      global.fetch = buildFetchRouter([{
        method: 'GET',
        match: /^\/api\/v2\/transaction_status\?network=TON_TESTNET&transaction_id=hash-bb$/,
        status: 200,
        body: () => ({ data: { status: 'pending' } })
      }])

      const { account } = makeAccount()
      const p = new LayerswapProtocolTon(account)
      await expect(p.getTransactionStatus('hash-bb', { sourceChain: 'TON_TESTNET' }))
        .resolves.toEqual({ status: 'pending' })
    })
  })
})
