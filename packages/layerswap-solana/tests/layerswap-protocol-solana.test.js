import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'

import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'

import { WalletAccountSolana } from '@tetherto/wdk-wallet-solana'

import LayerswapProtocolSolana from '../index.js'

// ---------------------------------------------------------------------------
// Fixtures (a slice of what Layerswap returns for SOLANA_MAINNET routes).
// ---------------------------------------------------------------------------

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

const SOLANA_MAINNET = {
  name: 'SOLANA_MAINNET',
  chain_id: '',
  type: 'solana',
  tokens: [
    { symbol: 'SOL', contract: null, decimals: 9, price_in_usd: 87 },
    { symbol: 'USDC', contract: USDC_MINT, decimals: 6, price_in_usd: 1 }
  ]
}

const ARBITRUM_MAINNET = {
  name: 'ARBITRUM_MAINNET',
  chain_id: '42161',
  type: 'evm',
  tokens: [
    { symbol: 'USDC', contract: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', decimals: 6, price_in_usd: 1 },
    { symbol: 'ETH', contract: null, decimals: 18, price_in_usd: 2128 }
  ]
}

const NETWORKS = [SOLANA_MAINNET, ARBITRUM_MAINNET]

const SOLANA_MAINNET_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'

// Layerswap's deposit account on Solana (placeholder).
const DEPOSIT_PUBKEY = new PublicKey('11111111111111111111111111111112') // System program — valid base58.

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/**
 * Builds a real serialised legacy Solana Transaction (a System Program transfer),
 * then base64-encodes it the way Layerswap would deliver it in `deposit_actions[].call_data`.
 */
function makeLayerswapCallData ({ from, to = DEPOSIT_PUBKEY, lamports = 10_000n, blockhash = '11111111111111111111111111111112' } = {}) {
  const tx = new Transaction()
  tx.feePayer = from
  tx.recentBlockhash = blockhash
  tx.add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: Number(lamports) }))

  // serialize WITHOUT signatures (matches Layerswap's pattern: caller signs).
  const wire = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
  return Buffer.from(wire).toString('base64')
}

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
 * Builds a mock account that passes `instanceof WalletAccountSolana` via prototype.
 * The protocol reads `getAddress()`, `keyPair`, and `_config.provider`.
 */
function makeAccount ({ writable = true, keypair = Keypair.generate(), provider = 'https://api.fake.solana.local' } = {}) {
  const address = keypair.publicKey.toBase58()

  const base = {
    _config: { provider },
    getAddress: jest.fn().mockResolvedValue(address),
    keyPair: {
      privateKey: keypair.secretKey.slice(0, 32),
      publicKey: keypair.secretKey.slice(32, 64)
    }
  }

  if (!writable) {
    // Read-only accounts shouldn't have keyPair / pass instanceof WalletAccountSolana.
    delete base.keyPair
  }

  Object.setPrototypeOf(base, writable ? WalletAccountSolana.prototype : Object.prototype)
  return { account: base, keypair, address }
}

/**
 * Installs a stub Connection with the methods our protocol calls, replacing the
 * one the protocol built internally. The stub has Connection.prototype so any
 * defensive instanceof checks pass.
 */
function stubConnection (protocol, { genesisHash = SOLANA_MAINNET_GENESIS_HASH, sendSignature = 'mock-tx-signature' } = {}) {
  const stub = {
    getGenesisHash: jest.fn().mockResolvedValue(genesisHash),
    sendRawTransaction: jest.fn().mockResolvedValue(sendSignature),
    // getEstimatedFee on Transaction may call this internally; provide a safe stub.
    getFeeForMessage: jest.fn().mockResolvedValue({ value: 5000 })
  }
  Object.setPrototypeOf(stub, Connection.prototype)
  protocol._connection = stub
  return stub
}

// ---------------------------------------------------------------------------
// Layerswap API handlers (one per endpoint our protocol hits).
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

function makeCreateSwapHandler ({ sourceAddress, totalFee = 0.5 }) {
  return {
    method: 'POST',
    match: /^\/api\/v2\/swaps$/,
    status: 200,
    body: (_url, _init) => ({
      data: {
        swap: {
          id: 'swap-abc-123',
          created_date: '2026-05-22T00:00:00Z',
          status: 'created',
          source_network: SOLANA_MAINNET,
          source_token: SOLANA_MAINNET.tokens.find((t) => t.symbol === 'USDC'),
          destination_network: ARBITRUM_MAINNET,
          destination_token: ARBITRUM_MAINNET.tokens.find((t) => t.symbol === 'USDC'),
          destination_address: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
          requested_amount: 10
        },
        deposit_actions: [{
          amount: 10,
          amount_in_base_units: '10000000',
          call_data: makeLayerswapCallData({ from: new PublicKey(sourceAddress) }),
          to_address: DEPOSIT_PUBKEY.toBase58(),
          token: SOLANA_MAINNET.tokens.find((t) => t.symbol === 'USDC'),
          fee_token: SOLANA_MAINNET.tokens.find((t) => t.symbol === 'SOL'),
          network: SOLANA_MAINNET,
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

const SPEEDUP_HANDLER = {
  method: 'POST',
  match: /^\/api\/v2\/swaps\/[^/]+\/deposit_speedup$/,
  status: 200,
  body: () => ({ data: null })
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe('LayerswapProtocolSolana', () => {
  let originalFetch
  beforeEach(() => { originalFetch = global.fetch })
  afterEach(() => { global.fetch = originalFetch })

  describe('constructor', () => {
    test('accepts a config-less init', () => {
      const { account } = makeAccount()
      const p = new LayerswapProtocolSolana(account)
      expect(p.getApiClient()).toBeDefined()
    })

    test('honours apiKey + apiUrl + bridgeMaxFee config', () => {
      const { account } = makeAccount()
      const p = new LayerswapProtocolSolana(account, {
        apiKey: 'ls-test-key',
        apiUrl: 'https://example.com/api',
        bridgeMaxFee: 1_000_000n
      })
      expect(p._config.bridgeMaxFee).toBe(1_000_000n)
    })
  })

  describe('source network detection', () => {
    test('maps mainnet genesis hash to SOLANA_MAINNET', async () => {
      const { account } = makeAccount()
      const p = new LayerswapProtocolSolana(account)
      stubConnection(p, { genesisHash: SOLANA_MAINNET_GENESIS_HASH })
      await expect(p._detectSourceNetworkName()).resolves.toBe('SOLANA_MAINNET')
    })

    test('maps devnet genesis hash to SOLANA_DEVNET', async () => {
      const { account } = makeAccount()
      const p = new LayerswapProtocolSolana(account)
      stubConnection(p, { genesisHash: DEVNET_GENESIS_HASH })
      await expect(p._detectSourceNetworkName()).resolves.toBe('SOLANA_DEVNET')
    })

    test('throws on unknown genesis hash with actionable error', async () => {
      const { account } = makeAccount()
      const p = new LayerswapProtocolSolana(account)
      stubConnection(p, { genesisHash: 'totally-unknown-hash' })
      await expect(p._detectSourceNetworkName()).rejects.toThrow(/Unknown Solana genesis hash.*sourceChain/)
    })

    test('caches the detected name across calls', async () => {
      const { account } = makeAccount()
      const p = new LayerswapProtocolSolana(account)
      const conn = stubConnection(p, { genesisHash: SOLANA_MAINNET_GENESIS_HASH })
      await p._detectSourceNetworkName()
      await p._detectSourceNetworkName()
      expect(conn.getGenesisHash).toHaveBeenCalledTimes(1)
    })
  })

  describe('quoteBridge', () => {
    test('returns bridgeFee in source-token base units and per-signature fee', async () => {
      global.fetch = buildFetchRouter([NETWORKS_HANDLER, QUOTE_HANDLER])

      const { account } = makeAccount()
      const p = new LayerswapProtocolSolana(account)
      stubConnection(p)

      const result = await p.quoteBridge({
        targetChain: 'ARBITRUM_MAINNET',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'USDC',
        amount: 10_000_000n
      })

      // USDC has 6 decimals; total_fee 0.5 → 500000 base units.
      expect(result.bridgeFee).toBe(500_000n)
      expect(result.fee).toBe(5000n)
    })

    test('surfaces Layerswap API errors', async () => {
      global.fetch = buildFetchRouter([NETWORKS_HANDLER, {
        method: 'GET',
        match: /^\/api\/v2\/quote\?/,
        status: 400,
        body: () => ({ error: { code: 'BAD_REQUEST', message: 'invalid route' } })
      }])

      const { account } = makeAccount()
      const p = new LayerswapProtocolSolana(account)
      stubConnection(p)

      await expect(p.quoteBridge({
        targetChain: 'ARBITRUM_MAINNET',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'USDC',
        amount: 10_000_000n
      })).rejects.toThrow(/BAD_REQUEST/)
    })

    test('respects sourceChain override (skips genesis-hash detection)', async () => {
      global.fetch = buildFetchRouter([NETWORKS_HANDLER, QUOTE_HANDLER])

      const { account } = makeAccount()
      const p = new LayerswapProtocolSolana(account)
      const conn = stubConnection(p)

      await p.quoteBridge({
        targetChain: 'ARBITRUM_MAINNET',
        sourceChain: 'SOLANA_MAINNET',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'USDC',
        amount: 10_000_000n
      })

      expect(conn.getGenesisHash).not.toHaveBeenCalled()
    })
  })

  describe('bridge', () => {
    test('happy path: decodes call_data, signs, and broadcasts', async () => {
      const { account, address } = makeAccount()
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        makeCreateSwapHandler({ sourceAddress: address }),
        SPEEDUP_HANDLER
      ])

      const p = new LayerswapProtocolSolana(account)
      const conn = stubConnection(p, { sendSignature: 'sig-deadbeef' })

      const result = await p.bridge({
        targetChain: 'ARBITRUM_MAINNET',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'USDC',
        amount: 10_000_000n
      })

      expect(result.hash).toBe('sig-deadbeef')
      expect(result.swapId).toBe('swap-abc-123')
      expect(result.bridgeFee).toBe(500_000n) // USDC 6-decimals, total_fee 0.5
      expect(conn.sendRawTransaction).toHaveBeenCalledTimes(1)
      const sent = conn.sendRawTransaction.mock.calls[0][0]
      expect(sent).toBeInstanceOf(Uint8Array)
      expect(sent.length).toBeGreaterThan(0)
    })

    test('throws when bridgeFee exceeds bridgeMaxFee, and does not broadcast', async () => {
      const { account, address } = makeAccount()
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        makeCreateSwapHandler({ sourceAddress: address, totalFee: 1 }), // 1 USDC fee
        SPEEDUP_HANDLER
      ])

      const p = new LayerswapProtocolSolana(account, { bridgeMaxFee: 500_000n })
      const conn = stubConnection(p)

      await expect(p.bridge({
        targetChain: 'ARBITRUM_MAINNET',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'USDC',
        amount: 10_000_000n
      })).rejects.toThrow(/Exceeded maximum fee/)

      expect(conn.sendRawTransaction).not.toHaveBeenCalled()
    })

    test('per-call config override of bridgeMaxFee takes precedence', async () => {
      const { account, address } = makeAccount()
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        makeCreateSwapHandler({ sourceAddress: address, totalFee: 0.5 }),
        SPEEDUP_HANDLER
      ])

      const p = new LayerswapProtocolSolana(account, { bridgeMaxFee: 10_000_000n })
      stubConnection(p)

      await expect(p.bridge({
        targetChain: 'ARBITRUM_MAINNET',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'USDC',
        amount: 10_000_000n
      }, { bridgeMaxFee: 1n })).rejects.toThrow(/Exceeded maximum fee/)
    })

    test('throws when account is read-only (instanceof check fails)', async () => {
      const { account } = makeAccount({ writable: false })
      const p = new LayerswapProtocolSolana(account)
      stubConnection(p)

      await expect(p.bridge({
        targetChain: 'ARBITRUM_MAINNET',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'USDC',
        amount: 10_000_000n
      })).rejects.toThrow(/non read-only account/)
    })

    test('throws when call_data is missing or empty', async () => {
      const { account, address } = makeAccount()
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        {
          method: 'POST',
          match: /^\/api\/v2\/swaps$/,
          status: 200,
          body: () => ({
            data: {
              swap: { id: 'swap-x', created_date: '', status: 'created', source_network: SOLANA_MAINNET, source_token: SOLANA_MAINNET.tokens[1], destination_network: ARBITRUM_MAINNET, destination_token: ARBITRUM_MAINNET.tokens[0], destination_address: 'r', requested_amount: 10 },
              deposit_actions: [{
                amount: 10,
                amount_in_base_units: '10000000',
                call_data: '',
                to_address: DEPOSIT_PUBKEY.toBase58(),
                token: SOLANA_MAINNET.tokens[1],
                fee_token: SOLANA_MAINNET.tokens[0],
                network: SOLANA_MAINNET,
                order: 0,
                type: 'transfer'
              }]
            }
          })
        }
      ])

      const p = new LayerswapProtocolSolana(account, { sourceChain: 'SOLANA_MAINNET' })
      stubConnection(p)

      await expect(p.bridge({
        targetChain: 'ARBITRUM_MAINNET',
        sourceChain: 'SOLANA_MAINNET',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'USDC',
        amount: 10_000_000n
      })).rejects.toThrow(/missing call_data/)
    })

    test('throws when only non-wallet deposit actions are returned', async () => {
      const { account, address } = makeAccount()
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        {
          method: 'POST',
          match: /^\/api\/v2\/swaps$/,
          status: 200,
          body: () => ({
            data: {
              swap: { id: 'swap-y', created_date: '', status: 'created', source_network: SOLANA_MAINNET, source_token: SOLANA_MAINNET.tokens[1], destination_network: ARBITRUM_MAINNET, destination_token: ARBITRUM_MAINNET.tokens[0], destination_address: 'r', requested_amount: 10 },
              deposit_actions: [{
                amount: 10,
                amount_in_base_units: '10000000',
                call_data: 'placeholder',
                to_address: DEPOSIT_PUBKEY.toBase58(),
                token: SOLANA_MAINNET.tokens[1],
                fee_token: SOLANA_MAINNET.tokens[0],
                network: SOLANA_MAINNET,
                order: 0,
                type: 'manual_transfer'
              }]
            }
          })
        }
      ])

      const p = new LayerswapProtocolSolana(account)
      stubConnection(p)

      await expect(p.bridge({
        targetChain: 'ARBITRUM_MAINNET',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'USDC',
        amount: 10_000_000n
      })).rejects.toThrow(/manual_transfer.*cannot drive the deposit/)
    })

    test('throws when source chain equals target chain', async () => {
      const { account } = makeAccount()
      global.fetch = buildFetchRouter([NETWORKS_HANDLER])

      const p = new LayerswapProtocolSolana(account)
      stubConnection(p)

      await expect(p.bridge({
        targetChain: 'SOLANA_MAINNET',
        recipient: 'somewhere',
        token: 'USDC',
        amount: 10_000_000n
      })).rejects.toThrow(/cannot be equal/)
    })

    test('swallows speedup endpoint failures without affecting the result', async () => {
      const { account, address } = makeAccount()
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        makeCreateSwapHandler({ sourceAddress: address }),
        {
          method: 'POST',
          match: /^\/api\/v2\/swaps\/[^/]+\/deposit_speedup$/,
          status: 500,
          body: () => ({ error: { code: 'INTERNAL', message: 'speedup unavailable' } })
        }
      ])

      const p = new LayerswapProtocolSolana(account)
      stubConnection(p, { sendSignature: 'sig-ok' })

      const result = await p.bridge({
        targetChain: 'ARBITRUM_MAINNET',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'USDC',
        amount: 10_000_000n
      })

      expect(result.hash).toBe('sig-ok')
    })
  })

  describe('_decodeDepositTransaction', () => {
    test('decodes a real base64 wire-format Transaction', () => {
      const { account } = makeAccount()
      const p = new LayerswapProtocolSolana(account)
      const callData = makeLayerswapCallData({ from: Keypair.generate().publicKey })
      const tx = p._decodeDepositTransaction(callData)
      expect(tx).toBeInstanceOf(Transaction)
    })

    test('throws a descriptive error on undecodable input', () => {
      const { account } = makeAccount()
      const p = new LayerswapProtocolSolana(account)
      expect(() => p._decodeDepositTransaction('not-base64-actual-garbage===')).toThrow(/Failed to deserialise|legacy Solana Transaction/)
    })
  })
})
