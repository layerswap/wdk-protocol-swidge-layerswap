import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'

import { networks, payments, Psbt, Transaction } from 'bitcoinjs-lib'
import { BIP32Factory } from 'bip32'
import { ecc } from '@bitcoinerlab/descriptors'

import LayerswapProtocolBitcoin from '../index.js'

// ---------------------------------------------------------------------------
// Fixtures (a slice of what Layerswap returns for BITCOIN_MAINNET routes).
// ---------------------------------------------------------------------------

const BITCOIN_MAINNET = {
  name: 'BITCOIN_MAINNET',
  chain_id: null,
  type: 'bitcoin',
  tokens: [
    { symbol: 'BTC', contract: null, decimals: 8, price_in_usd: 70000 }
  ]
}

const ARBITRUM_MAINNET = {
  name: 'ARBITRUM_MAINNET',
  chain_id: '42161',
  type: 'evm',
  tokens: [
    { symbol: 'WBTC', contract: '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f', decimals: 8, price_in_usd: 70000 }
  ]
}

const NETWORKS = [BITCOIN_MAINNET, ARBITRUM_MAINNET]

const bip32 = BIP32Factory(ecc)

const TEST_SEED = Buffer.alloc(64).fill(0xab) // deterministic seed for tests

const TEST_NETWORK = networks.bitcoin
const TEST_PATH = "m/84'/0'/0'/0/0"

// bip32 v5 returns Uint8Arrays for keys/fingerprints/signatures, while bitcoinjs-lib
// expects Buffers for `node.publicKey.equals` and partialSig serialisation.
// Wrap the node in a Buffer-returning HDSigner adapter, matching the Buffer-based master
// node the wallet package hands to `psbt.signInputHD`.
function toHdSigner (node) {
  return {
    get publicKey () { return Buffer.from(node.publicKey) },
    get fingerprint () { return Buffer.from(node.fingerprint) },
    derivePath (path) { return toHdSigner(node.derivePath(path)) },
    sign (hash, lowR) { return Buffer.from(node.sign(hash, lowR)) }
  }
}

function buildTestKeys () {
  // The raw bip32 v5 node returns Uint8Arrays — exactly what the real wallet's
  // `_masterNode` hands the protocol. The protocol's `_toBufferHdSigner` is
  // responsible for the Buffer coercion, so the account fixture must NOT pre-wrap.
  const rawMasterNode = bip32.fromSeed(TEST_SEED, TEST_NETWORK)
  const rawChildNode = rawMasterNode.derivePath(TEST_PATH)
  const masterNode = toHdSigner(rawMasterNode)
  const childNode = masterNode.derivePath(TEST_PATH)
  const { address } = payments.p2wpkh({ pubkey: childNode.publicKey, network: TEST_NETWORK })
  return { rawMasterNode, rawChildNode, masterNode, childNode, address }
}

const {
  rawMasterNode: TEST_RAW_MASTER_NODE,
  rawChildNode: TEST_RAW_CHILD_NODE,
  childNode: TEST_CHILD_NODE,
  address: SENDER_ADDRESS
} = buildTestKeys()

// Layerswap's deposit address (valid mainnet P2WPKH, not the sender's).
const DEPOSIT_ADDRESS = payments.p2wpkh({
  pubkey: Buffer.from(bip32.fromSeed(TEST_SEED.fill(0xcd), TEST_NETWORK).derivePath("m/84'/0'/0'/0/0").publicKey),
  network: TEST_NETWORK
}).address

// Fund the wallet with a single 1 BTC UTXO (100,000,000 sats).
function makeUtxo ({ value = 100_000_000, txHash = 'a'.repeat(64), txPos = 0 } = {}) {
  // For BIP-84 the protocol uses `utxo.vout.scriptPubKey.hex` when present. Provide it.
  const script = payments.p2wpkh({
    pubkey: TEST_CHILD_NODE.publicKey,
    network: TEST_NETWORK
  }).output
  return {
    tx_hash: txHash,
    tx_pos: txPos,
    value,
    vout: { value, scriptPubKey: { hex: Buffer.from(script).toString('hex') } }
  }
}

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
 * Mock Bitcoin wallet account. Provides the protected wallet members the protocol
 * reads (`_client`, `_masterNode`, `_account`, `_network`, `_dustLimit`, `_path`,
 * `_bip`, `_ensureConnected`, `_toBigInt`). `_masterNode` is a real BIP-32 node so
 * `psbt.signInputHD` actually signs.
 */
function makeAccount ({
  writable = true,
  utxos = [makeUtxo()],
  broadcastResult = 'broadcast-ok',
  estimateFee = 0.0001, // BTC per kvB → 10 sat/vB after × 100_000
  networkName = 'bitcoin'
} = {}) {
  const broadcast = jest.fn().mockResolvedValue(broadcastResult)
  const listUnspent = jest.fn().mockResolvedValue(utxos)
  const estimateFeeFn = jest.fn().mockResolvedValue(estimateFee)
  const getTransaction = jest.fn().mockResolvedValue('00')

  const client = { broadcast, listUnspent, estimateFee: estimateFeeFn, getTransaction, connect: jest.fn().mockResolvedValue(undefined) }

  const account = {
    _config: { network: networkName },
    _client: client,
    _network: TEST_NETWORK,
    _dustLimit: 294n,
    _path: TEST_PATH,
    _bip: 84,
    _ensureConnected: jest.fn().mockResolvedValue(undefined),
    _toBigInt: (v) => (typeof v === 'bigint' ? v : BigInt(Math.round(Number(v)))),
    getAddress: jest.fn().mockResolvedValue(SENDER_ADDRESS)
  }

  if (writable) {
    // Raw v5 node + Uint8Array pubkey — the protocol must coerce these itself.
    account._masterNode = TEST_RAW_MASTER_NODE
    account._account = { publicKey: TEST_RAW_CHILD_NODE.publicKey }
  }

  return { account, client, broadcast, listUnspent, estimateFeeFn }
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

const makeQuoteHandler = (overrides = {}) => ({
  method: 'GET',
  match: /^\/api\/v2\/quote\?/,
  status: 200,
  body: () => ({
    data: {
      quote: {
        requested_amount: 0.001,
        receive_amount: 0.0009,
        min_receive_amount: 0.00089,
        total_fee: 0.0001,
        total_fee_in_usd: 7,
        blockchain_fee: 0.00009,
        service_fee: 0.00001,
        ...overrides
      }
    }
  })
})

const QUOTE_HANDLER = makeQuoteHandler()

function makeCreateSwapHandler ({
  totalFee = 0.0001,
  callData = '7745',
  depositAddress = DEPOSIT_ADDRESS
} = {}) {
  return {
    method: 'POST',
    match: /^\/api\/v2\/swaps$/,
    status: 200,
    body: (_url, _init) => ({
      data: {
        swap: {
          id: 'swap-btc-123',
          created_date: '2026-05-22T00:00:00Z',
          status: 'created',
          source_network: BITCOIN_MAINNET,
          source_token: BITCOIN_MAINNET.tokens[0],
          destination_network: ARBITRUM_MAINNET,
          destination_token: ARBITRUM_MAINNET.tokens[0],
          destination_address: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
          requested_amount: 0.001
        },
        deposit_actions: [{
          amount: 0.001,
          amount_in_base_units: '100000',
          call_data: callData,
          to_address: depositAddress,
          token: BITCOIN_MAINNET.tokens[0],
          fee_token: BITCOIN_MAINNET.tokens[0],
          network: BITCOIN_MAINNET,
          order: 0,
          type: 'transfer'
        }],
        quote: {
          quote: {
            requested_amount: 0.001,
            receive_amount: 0.001 - totalFee,
            min_receive_amount: 0.001 - totalFee - 0.00001,
            total_fee: totalFee,
            total_fee_in_usd: totalFee * 70_000,
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

describe('LayerswapProtocolBitcoin', () => {
  let originalFetch
  beforeEach(() => { originalFetch = global.fetch })
  afterEach(() => { global.fetch = originalFetch })

  describe('constructor', () => {
    test('accepts a config-less init', () => {
      const { account } = makeAccount()
      const p = new LayerswapProtocolBitcoin(account)
      expect(p.getApiClient()).toBeDefined()
    })

    test('honours apiKey + apiUrl + bridgeMaxFee config', () => {
      const { account } = makeAccount()
      const p = new LayerswapProtocolBitcoin(account, {
        apiKey: 'ls-test-key',
        apiUrl: 'https://example.com/api',
        bridgeMaxFee: 100_000n
      })
      expect(p._config.bridgeMaxFee).toBe(100_000n)
    })
  })

  describe('source network detection', () => {
    test('maps wallet config.network=bitcoin to BITCOIN_MAINNET', () => {
      const { account } = makeAccount({ networkName: 'bitcoin' })
      const p = new LayerswapProtocolBitcoin(account)
      expect(p._detectSourceNetworkName()).toBe('BITCOIN_MAINNET')
    })

    test('maps wallet config.network=testnet to BITCOIN_TESTNET', () => {
      const { account } = makeAccount({ networkName: 'testnet' })
      const p = new LayerswapProtocolBitcoin(account)
      expect(p._detectSourceNetworkName()).toBe('BITCOIN_TESTNET')
    })

    test('maps wallet config.network=regtest to BITCOIN_REGTEST', () => {
      const { account } = makeAccount({ networkName: 'regtest' })
      const p = new LayerswapProtocolBitcoin(account)
      expect(p._detectSourceNetworkName()).toBe('BITCOIN_REGTEST')
    })

    test('defaults to BITCOIN_MAINNET when config.network is unset', () => {
      const { account } = makeAccount({ networkName: undefined })
      const p = new LayerswapProtocolBitcoin(account)
      expect(p._detectSourceNetworkName()).toBe('BITCOIN_MAINNET')
    })
  })

  describe('_encodeCallDataMemo', () => {
    test('encodes the numeric sequence via BigInt(seq).toString(16) stored as UTF-8 bytes', () => {
      const { account } = makeAccount()
      const p = new LayerswapProtocolBitcoin(account)
      const memo = p._encodeCallDataMemo('7745')
      // BigInt('7745').toString(16) === '1e41'
      expect(memo.toString('utf8')).toBe('1e41')
    })

    test('hex-encodes only the part before ";" and appends the tail verbatim', () => {
      const { account } = makeAccount()
      const p = new LayerswapProtocolBitcoin(account)
      // BigInt('13646').toString(16) === '354e'
      expect(p._encodeCallDataMemo('13646;').toString('utf8')).toBe('354e;')
      expect(p._encodeCallDataMemo('13646;extra').toString('utf8')).toBe('354e;extra')
    })

    test('returns empty buffer for null/undefined/empty', () => {
      const { account } = makeAccount()
      const p = new LayerswapProtocolBitcoin(account)
      expect(p._encodeCallDataMemo(null).length).toBe(0)
      expect(p._encodeCallDataMemo(undefined).length).toBe(0)
      expect(p._encodeCallDataMemo('').length).toBe(0)
    })

    test('throws when the sequence part is not numeric', () => {
      const { account } = makeAccount()
      const p = new LayerswapProtocolBitcoin(account)
      expect(() => p._encodeCallDataMemo('not-a-number')).toThrow(/numeric sequence/)
      expect(() => p._encodeCallDataMemo('nan;tail')).toThrow(/numeric sequence/)
    })

    test('throws when encoded payload exceeds 80 bytes', () => {
      const { account } = makeAccount()
      const p = new LayerswapProtocolBitcoin(account)
      expect(() => p._encodeCallDataMemo(`1;${'x'.repeat(90)}`)).toThrow(/80-byte/)
    })
  })

  describe('quoteBridge', () => {
    test('returns bridgeFee in satoshis and the BTC fee approximation', async () => {
      global.fetch = buildFetchRouter([NETWORKS_HANDLER, QUOTE_HANDLER])

      const { account } = makeAccount()
      const p = new LayerswapProtocolBitcoin(account)

      const result = await p.quoteBridge({
        targetChain: 'ARBITRUM_MAINNET',
        destinationToken: 'WBTC',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'BTC',
        amount: 100_000n
      })

      // total_fee 0.0001 with 8 decimals → 10000 sats.
      expect(result.bridgeFee).toBe(10_000n)
      expect(result.fee).toBe(1_500n)
    })

    test('surfaces Layerswap API errors', async () => {
      global.fetch = buildFetchRouter([NETWORKS_HANDLER, {
        method: 'GET',
        match: /^\/api\/v2\/quote\?/,
        status: 400,
        body: () => ({ error: { code: 'BAD_REQUEST', message: 'invalid route' } })
      }])

      const { account } = makeAccount()
      const p = new LayerswapProtocolBitcoin(account)

      await expect(p.quoteBridge({
        targetChain: 'ARBITRUM_MAINNET',
        destinationToken: 'WBTC',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'BTC',
        amount: 100_000n
      })).rejects.toThrow(/BAD_REQUEST/)
    })
  })

  describe('bridge', () => {
    test('happy path: builds PSBT with OP_RETURN, signs, broadcasts', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        makeCreateSwapHandler({ callData: '7745' }),
        SPEEDUP_HANDLER
      ])

      const { account, broadcast } = makeAccount()
      const p = new LayerswapProtocolBitcoin(account)

      const result = await p.bridge({
        targetChain: 'ARBITRUM_MAINNET',
        destinationToken: 'WBTC',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'BTC',
        amount: 100_000n
      })

      expect(result.hash).toBeDefined()
      expect(result.swapId).toBe('swap-btc-123')
      expect(result.bridgeFee).toBe(10_000n)
      expect(typeof result.fee).toBe('bigint')
      expect(result.fee).toBeGreaterThan(0n)

      expect(broadcast).toHaveBeenCalledTimes(1)
      const broadcastedHex = broadcast.mock.calls[0][0]
      expect(typeof broadcastedHex).toBe('string')

      // Decode and assert outputs.
      const tx = Transaction.fromHex(broadcastedHex)
      expect(tx.outs.length).toBeGreaterThanOrEqual(2) // deposit + OP_RETURN, change optional

      // Output #0 = deposit.
      expect(tx.outs[0].value).toBe(100_000n)

      // Output #1 = OP_RETURN with hex-of-BigInt(seq).toString(16) (+ verbatim tail).
      const opReturnScript = tx.outs[1].script
      expect(opReturnScript[0]).toBe(0x6a) // OP_RETURN opcode
      // Skip the push opcode + length byte; remaining bytes are the memo (UTF-8 of '1e41').
      const memoBytes = opReturnScript.subarray(2)
      expect(Buffer.from(memoBytes).toString('utf8')).toBe('1e41')

      // tx hash matches what we returned.
      expect(result.hash).toBe(tx.getId())
    })

    test('produces a final signed tx that finalizes (signature verifiable)', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        makeCreateSwapHandler(),
        SPEEDUP_HANDLER
      ])

      const { account, broadcast } = makeAccount()
      const p = new LayerswapProtocolBitcoin(account)

      await p.bridge({
        targetChain: 'ARBITRUM_MAINNET',
        destinationToken: 'WBTC',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'BTC',
        amount: 100_000n
      })

      // Round-trip the hex through Psbt → Transaction; should not throw.
      const hex = broadcast.mock.calls[0][0]
      const tx = Transaction.fromHex(hex)
      expect(tx.ins.length).toBeGreaterThan(0)
      // Each input has a witness (P2WPKH).
      for (const input of tx.ins) {
        expect(input.witness.length).toBe(2) // [signature, pubkey]
      }
    })

    test('throws when bridgeFee exceeds bridgeMaxFee, and does not broadcast', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        makeCreateSwapHandler({ totalFee: 0.001 }), // 0.001 BTC → 100_000 sats
        SPEEDUP_HANDLER
      ])

      const { account, broadcast } = makeAccount()
      const p = new LayerswapProtocolBitcoin(account, { bridgeMaxFee: 50_000n })

      await expect(p.bridge({
        targetChain: 'ARBITRUM_MAINNET',
        destinationToken: 'WBTC',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'BTC',
        amount: 100_000n
      })).rejects.toThrow(/Exceeded maximum fee/)

      expect(broadcast).not.toHaveBeenCalled()
    })

    test('per-call config override of bridgeMaxFee takes precedence', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        makeCreateSwapHandler({ totalFee: 0.0001 }),
        SPEEDUP_HANDLER
      ])

      const { account } = makeAccount()
      const p = new LayerswapProtocolBitcoin(account, { bridgeMaxFee: 1_000_000n })

      await expect(p.bridge({
        targetChain: 'ARBITRUM_MAINNET',
        destinationToken: 'WBTC',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'BTC',
        amount: 100_000n
      }, { bridgeMaxFee: 1n })).rejects.toThrow(/Exceeded maximum fee/)
    })

    test('throws when account is read-only (no masterNode)', async () => {
      const { account } = makeAccount({ writable: false })
      const p = new LayerswapProtocolBitcoin(account)

      await expect(p.bridge({
        targetChain: 'ARBITRUM_MAINNET',
        destinationToken: 'WBTC',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'BTC',
        amount: 100_000n
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
              swap: { id: 'swap-y', created_date: '', status: 'created', source_network: BITCOIN_MAINNET, source_token: BITCOIN_MAINNET.tokens[0], destination_network: ARBITRUM_MAINNET, destination_token: ARBITRUM_MAINNET.tokens[0], destination_address: 'r', requested_amount: 0.001 },
              deposit_actions: [{
                amount: 0.001,
                amount_in_base_units: '100000',
                call_data: '7745',
                to_address: DEPOSIT_ADDRESS,
                token: BITCOIN_MAINNET.tokens[0],
                fee_token: BITCOIN_MAINNET.tokens[0],
                network: BITCOIN_MAINNET,
                order: 0,
                type: 'manual_transfer'
              }]
            }
          })
        }
      ])

      const { account } = makeAccount()
      const p = new LayerswapProtocolBitcoin(account)

      await expect(p.bridge({
        targetChain: 'ARBITRUM_MAINNET',
        destinationToken: 'WBTC',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'BTC',
        amount: 100_000n
      })).rejects.toThrow(/manual_transfer.*cannot drive the deposit/)
    })

    test('throws when source chain equals target chain', async () => {
      global.fetch = buildFetchRouter([NETWORKS_HANDLER])

      const { account } = makeAccount()
      const p = new LayerswapProtocolBitcoin(account)

      await expect(p.bridge({
        targetChain: 'BITCOIN_MAINNET',
        recipient: SENDER_ADDRESS,
        token: 'BTC',
        amount: 100_000n
      })).rejects.toThrow(/cannot be equal/)
    })

    test('throws when there are no unspent outputs', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        makeCreateSwapHandler(),
        SPEEDUP_HANDLER
      ])

      const { account } = makeAccount({ utxos: [] })
      const p = new LayerswapProtocolBitcoin(account)

      await expect(p.bridge({
        targetChain: 'ARBITRUM_MAINNET',
        destinationToken: 'WBTC',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'BTC',
        amount: 100_000n
      })).rejects.toThrow(/No unspent outputs/)
    })

    test('throws when amount is at or below the dust limit', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        makeCreateSwapHandler(),
        SPEEDUP_HANDLER
      ])

      const { account } = makeAccount()
      const p = new LayerswapProtocolBitcoin(account)

      await expect(p.bridge({
        targetChain: 'ARBITRUM_MAINNET',
        destinationToken: 'WBTC',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'BTC',
        amount: 100n // dust limit for BIP-84 is 294
      })).rejects.toThrow(/dust limit/)
    })

    test('feeRate override is used and the broadcast tx fee reflects it', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        makeCreateSwapHandler(),
        SPEEDUP_HANDLER
      ])

      const { account, broadcast } = makeAccount()
      const p = new LayerswapProtocolBitcoin(account)

      const lowFeeResult = await p.bridge({
        targetChain: 'ARBITRUM_MAINNET',
        destinationToken: 'WBTC',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'BTC',
        amount: 100_000n,
        feeRate: 1n
      })

      // With feeRate=1 sat/vB, a 1-in 3-out tx is small — fee should be in low double digits.
      expect(lowFeeResult.fee).toBeLessThan(500n)

      const broadcastedHex = broadcast.mock.calls.at(-1)[0]
      const tx = Transaction.fromHex(broadcastedHex)
      expect(tx.outs.length).toBe(3) // deposit + OP_RETURN + change
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
      const p = new LayerswapProtocolBitcoin(account)

      const result = await p.bridge({
        targetChain: 'ARBITRUM_MAINNET',
        destinationToken: 'WBTC',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        token: 'BTC',
        amount: 100_000n
      })

      expect(result.hash).toBeDefined()
    })
  })

  describe('getTransactionStatus', () => {
    test('resolves the network from account._config.network', async () => {
      global.fetch = buildFetchRouter([{
        method: 'GET',
        match: /^\/api\/v2\/transaction_status\?network=BITCOIN_MAINNET&transaction_id=txid-aa$/,
        status: 200,
        body: () => ({ data: { status: 'completed' } })
      }])

      const { account } = makeAccount({ networkName: 'bitcoin' })
      const p = new LayerswapProtocolBitcoin(account)
      await expect(p.getTransactionStatus('txid-aa')).resolves.toEqual({ status: 'completed' })
    })

    test('honours sourceChain override', async () => {
      global.fetch = buildFetchRouter([{
        method: 'GET',
        match: /^\/api\/v2\/transaction_status\?network=BITCOIN_TESTNET&transaction_id=txid-bb$/,
        status: 200,
        body: () => ({ data: { status: 'pending' } })
      }])

      const { account } = makeAccount({ networkName: 'bitcoin' })
      const p = new LayerswapProtocolBitcoin(account)
      await expect(p.getTransactionStatus('txid-bb', { sourceChain: 'BITCOIN_TESTNET' }))
        .resolves.toEqual({ status: 'pending' })
    })
  })

  describe('quoteSwidge', () => {
    test('maps the Layerswap quote to a WDK swidge quote with itemised fees and the BTC fee approximation', async () => {
      global.fetch = buildFetchRouter([NETWORKS_HANDLER, makeQuoteHandler({ avg_completion_time: '00:02:30' })])

      const { account } = makeAccount()
      const p = new LayerswapProtocolBitcoin(account)

      const quote = await p.quoteSwidge({
        fromToken: 'BTC',
        toToken: 'WBTC',
        toChain: 'ARBITRUM_MAINNET',
        fromTokenAmount: 100_000n,
        slippage: 0.01
      })

      expect(quote.fromTokenAmount).toBe(100_000n)
      expect(quote.toTokenAmount).toBe(90_000n)
      expect(quote.toTokenAmountMin).toBe(89_000n)
      expect(quote.estimatedDuration).toBe(150)
      expect(quote.fees).toEqual([
        expect.objectContaining({ type: 'protocol', amount: 1_000n, token: 'BTC', included: true }),
        expect.objectContaining({ type: 'network', amount: 9_000n, token: 'BTC', included: true }),
        expect.objectContaining({ type: 'network', amount: 1_500n, token: 'BTC', included: false })
      ])
    })

    test('converts the WDK decimal slippage to a Layerswap percent string', async () => {
      const fetchMock = buildFetchRouter([NETWORKS_HANDLER, QUOTE_HANDLER])
      global.fetch = fetchMock

      const { account } = makeAccount()
      const p = new LayerswapProtocolBitcoin(account)

      await p.quoteSwidge({
        fromToken: 'BTC',
        toToken: 'WBTC',
        toChain: 'ARBITRUM_MAINNET',
        fromTokenAmount: 100_000n,
        slippage: 0.005
      })

      const quoteCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/v2/quote'))
      expect(String(quoteCall[0])).toContain('slippage=0.5')
    })

    test('rejects exact-out operations', async () => {
      global.fetch = buildFetchRouter([NETWORKS_HANDLER])

      const { account } = makeAccount()
      const p = new LayerswapProtocolBitcoin(account)

      await expect(p.quoteSwidge({
        fromToken: 'BTC',
        toToken: 'WBTC',
        toChain: 'ARBITRUM_MAINNET',
        toTokenAmount: 100_000n
      })).rejects.toThrow('exact-in')
    })

    test('rejects same-chain swaps (toChain missing)', async () => {
      global.fetch = buildFetchRouter([NETWORKS_HANDLER])

      const { account } = makeAccount()
      const p = new LayerswapProtocolBitcoin(account)

      await expect(p.quoteSwidge({
        fromToken: 'BTC',
        toToken: 'WBTC',
        fromTokenAmount: 100_000n
      })).rejects.toThrow('same-chain')
    })

    test('omits the source-chain gas fee entry when no account is bound', async () => {
      global.fetch = buildFetchRouter([NETWORKS_HANDLER, QUOTE_HANDLER])

      const p = new LayerswapProtocolBitcoin(undefined)

      const quote = await p.quoteSwidge({
        fromChain: 'BITCOIN_MAINNET',
        fromToken: 'BTC',
        toToken: 'WBTC',
        toChain: 'ARBITRUM_MAINNET',
        fromTokenAmount: 100_000n
      })

      expect(quote.fees).toHaveLength(2)
      expect(quote.fees.every((f) => f.included)).toBe(true)
    })
  })

  describe('swidge', () => {
    test('creates the swap, broadcasts the PSBT deposit, and returns a WDK swidge result', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        makeCreateSwapHandler({ callData: '7745' }),
        SPEEDUP_HANDLER
      ])

      const { account, broadcast } = makeAccount()
      const p = new LayerswapProtocolBitcoin(account)

      const result = await p.swidge({
        fromToken: 'BTC',
        toToken: 'WBTC',
        toChain: 'ARBITRUM_MAINNET',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        fromTokenAmount: 100_000n
      })

      expect(result.id).toBe('swap-btc-123')
      expect(result.fromTokenAmount).toBe(100_000n)
      expect(result.toTokenAmount).toBe(90_000n)
      expect(result.toTokenAmountMin).toBe(89_000n)

      // Included Layerswap fees (source-token sats) + the non-included PSBT fee.
      expect(result.fees).toEqual([
        expect.objectContaining({ type: 'protocol', amount: 1_000n, token: 'BTC', included: true }),
        expect.objectContaining({ type: 'network', amount: 9_000n, token: 'BTC', included: true }),
        expect.objectContaining({ type: 'network', token: 'BTC', chain: 'BITCOIN_MAINNET', included: false })
      ])
      const gasFee = result.fees.find((f) => !f.included)
      expect(gasFee.amount).toBeGreaterThan(0n)

      expect(broadcast).toHaveBeenCalledTimes(1)
      const tx = Transaction.fromHex(broadcast.mock.calls[0][0])
      expect(result.hash).toBe(tx.getId())
      expect(result.transactions).toEqual([{ hash: tx.getId(), chain: 'BITCOIN_MAINNET', type: 'source' }])

      // Output #0 = deposit, output #1 = OP_RETURN with hex-of-Number(call_data).
      expect(tx.outs[0].value).toBe(100_000n)
      expect(tx.outs[1].script[0]).toBe(0x6a)
      expect(Buffer.from(tx.outs[1].script.subarray(2)).toString('utf8')).toBe('1e41')
    })

    test('requires an explicit recipient for cross-VM destinations', async () => {
      global.fetch = buildFetchRouter([NETWORKS_HANDLER])

      const { account, broadcast } = makeAccount()
      const p = new LayerswapProtocolBitcoin(account)

      await expect(p.swidge({
        fromToken: 'BTC',
        toToken: 'WBTC',
        toChain: 'ARBITRUM_MAINNET',
        fromTokenAmount: 100_000n
      })).rejects.toThrow(/recipient/)

      expect(broadcast).not.toHaveBeenCalled()
    })

    test('enforces maxProtocolFeeBps and does not broadcast', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        makeCreateSwapHandler(),
        SPEEDUP_HANDLER
      ])

      const { account, broadcast } = makeAccount()
      const p = new LayerswapProtocolBitcoin(account)

      // service_fee 0.00001 BTC = 1000 sats on 100_000 sats input = 100 bps.
      await expect(p.swidge({
        fromToken: 'BTC',
        toToken: 'WBTC',
        toChain: 'ARBITRUM_MAINNET',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        fromTokenAmount: 100_000n
      }, { maxProtocolFeeBps: 99 })).rejects.toThrow('maximum protocol fee')

      expect(broadcast).not.toHaveBeenCalled()
    })

    test('throws when the quoted minimum output is below minAmountOut, and does not broadcast', async () => {
      global.fetch = buildFetchRouter([
        NETWORKS_HANDLER,
        makeCreateSwapHandler(),
        SPEEDUP_HANDLER
      ])

      const { account, broadcast } = makeAccount()
      const p = new LayerswapProtocolBitcoin(account)

      // toTokenAmountMin is 89_000 sats of WBTC.
      await expect(p.swidge({
        fromToken: 'BTC',
        toToken: 'WBTC',
        toChain: 'ARBITRUM_MAINNET',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        fromTokenAmount: 100_000n,
        minAmountOut: 90_000n
      })).rejects.toThrow('minAmountOut')

      expect(broadcast).not.toHaveBeenCalled()
    })

    test('throws for read-only accounts', async () => {
      const { account } = makeAccount({ writable: false })
      const p = new LayerswapProtocolBitcoin(account)

      await expect(p.swidge({
        fromToken: 'BTC',
        toToken: 'WBTC',
        toChain: 'ARBITRUM_MAINNET',
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        fromTokenAmount: 100_000n
      })).rejects.toThrow('non read-only account')
    })
  })

  describe('getSwidgeStatus', () => {
    test('maps the Layerswap swap status and transactions to the WDK vocabulary', async () => {
      global.fetch = buildFetchRouter([{
        method: 'GET',
        match: /^\/api\/v2\/swaps\/swap-btc-123$/,
        status: 200,
        body: () => ({
          data: {
            swap: {
              id: 'swap-btc-123',
              status: 'ls_transfer_pending',
              transactions: [
                { transaction_hash: 'btc-txid-1', type: 'input', status: 'completed', network: BITCOIN_MAINNET },
                { transaction_hash: '0xoutput', type: 'output', status: 'initiated', network: ARBITRUM_MAINNET }
              ]
            }
          }
        })
      }])

      const { account } = makeAccount()
      const p = new LayerswapProtocolBitcoin(account)

      await expect(p.getSwidgeStatus('swap-btc-123')).resolves.toEqual({
        status: 'pending',
        transactions: [
          { hash: 'btc-txid-1', chain: 'BITCOIN_MAINNET', type: 'source' },
          { hash: '0xoutput', chain: 'ARBITRUM_MAINNET', type: 'destination' }
        ]
      })
    })
  })

  describe('discovery', () => {
    test('getSupportedChains maps the network catalog without an account', async () => {
      global.fetch = buildFetchRouter([NETWORKS_HANDLER])

      const p = new LayerswapProtocolBitcoin(undefined)

      await expect(p.getSupportedChains()).resolves.toEqual([
        { id: 'BITCOIN_MAINNET', name: 'BITCOIN_MAINNET', type: 'bitcoin', nativeToken: '' },
        { id: 'ARBITRUM_MAINNET', name: 'ARBITRUM_MAINNET', type: 'evm', nativeToken: '' }
      ])
    })

    test('getSupportedTokens flattens and scopes by chain', async () => {
      global.fetch = buildFetchRouter([NETWORKS_HANDLER])

      const p = new LayerswapProtocolBitcoin(undefined)

      const tokens = await p.getSupportedTokens({ toChain: 'ARBITRUM_MAINNET' })
      expect(tokens).toEqual([
        expect.objectContaining({ token: 'WBTC', chain: 'ARBITRUM_MAINNET', symbol: 'WBTC', decimals: 8 })
      ])
    })
  })
})
