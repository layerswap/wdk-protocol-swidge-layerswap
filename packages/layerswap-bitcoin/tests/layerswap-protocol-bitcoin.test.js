// Tests of the Bitcoin specifics only: source network detection, account detection, the
// quote fee approximation, the PSBT deposit (OP_RETURN memo, fee rate, signing, broadcast)
// and bitcoin error mapping. The chain-agnostic swidge behaviour (quotes, guards, status,
// bridge adapters, discovery, …) is covered once by the `LayerswapSwidgeProtocol` tests in
// `@layerswap/wdk-protocol-swidge-layerswap-core`.

import { describe, expect, jest, test } from '@jest/globals'

import { networks, payments, Transaction } from 'bitcoinjs-lib'
import { BIP32Factory } from 'bip32'
import { ecc } from '@bitcoinerlab/descriptors'

import {
  layerswapApi,
  recordRequests,
  setupLayerswapServer
} from '@layerswap/wdk-protocol-swidge-layerswap-test-utils'

import LayerswapProtocolBitcoin, {
  AccountRequiredError,
  BridgeError,
  DisposalError,
  InvalidTokenError,
  ProviderError,
  SwidgeError,
  SwidgeErrorReason,
  ValueError
} from '../index.js'

const BITCOIN_TOKENS = [{ symbol: 'BTC', contract: null, decimals: 8 }]

const BITCOIN_MAINNET = { name: 'BITCOIN_MAINNET', chain_id: null, type: 'bitcoin', tokens: BITCOIN_TOKENS }
const BITCOIN_TESTNET = { name: 'BITCOIN_TESTNET', chain_id: null, type: 'bitcoin', tokens: BITCOIN_TOKENS }
const BITCOIN_REGTEST = { name: 'BITCOIN_REGTEST', chain_id: null, type: 'bitcoin', tokens: BITCOIN_TOKENS }

const ARBITRUM_MAINNET = {
  name: 'ARBITRUM_MAINNET',
  chain_id: '42161',
  type: 'evm',
  tokens: [{ symbol: 'WBTC', contract: '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f', decimals: 8 }]
}

const NETWORKS = [BITCOIN_MAINNET, BITCOIN_TESTNET, BITCOIN_REGTEST, ARBITRUM_MAINNET]

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

const server = setupLayerswapServer()

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
  networkName = 'bitcoin',
  disposed = false
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

  if (disposed) {
    // Mirrors `WalletAccountBtc.dispose()`, which wipes the keys and unsets `_masterNode`.
    account._masterNode = undefined
  }

  return { account, client, broadcast, listUnspent, estimateFeeFn }
}

// Mirrors Layerswap: the amount is only reported as a decimal, `amount_in_base_units` is 0.
function depositAction ({ callData = '7745', depositAddress = DEPOSIT_ADDRESS, amount = 0.001 } = {}) {
  return {
    type: 'transfer',
    order: 0,
    amount,
    amount_in_base_units: '0',
    call_data: callData,
    to_address: depositAddress
  }
}

// 0.0001 BTC total Layerswap fee = 10_000 sats.
const useSwapHandlers = (action = depositAction()) =>
  server.use(...layerswapApi.swidgeFlow({ networks: NETWORKS, depositActions: [action], quote: { total_fee: 0.0001 } }))

const SWIDGE_OPTIONS = {
  fromToken: 'BTC',
  toToken: 'WBTC',
  toChain: 'ARBITRUM_MAINNET',
  recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
  fromTokenAmount: 100_000n
}

const BRIDGE_OPTIONS = {
  targetChain: 'ARBITRUM_MAINNET',
  destinationToken: 'WBTC',
  recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
  token: 'BTC',
  amount: 100_000n
}

describe('LayerswapProtocolBitcoin', () => {
  describe('source network detection', () => {
    test.each([
      ['bitcoin', 'BITCOIN_MAINNET'],
      ['testnet', 'BITCOIN_TESTNET'],
      ['regtest', 'BITCOIN_REGTEST'],
      [undefined, 'BITCOIN_MAINNET']
    ])('maps the account config.network=%s to %s', async (networkName, expected) => {
      server.use(layerswapApi.networks(NETWORKS), layerswapApi.quote())

      const { account } = makeAccount({ networkName })
      const quote = await new LayerswapProtocolBitcoin(account).quoteSwidge(SWIDGE_OPTIONS)

      expect(quote.fees[0].chain).toBe(expected)
    })

    test('defaults getTransactionStatus to the detected network', async () => {
      server.use(layerswapApi.networks(NETWORKS), layerswapApi.transactionStatus('completed'))
      const requests = recordRequests(server)

      const { account } = makeAccount({ networkName: 'testnet' })

      await expect(new LayerswapProtocolBitcoin(account).getTransactionStatus('txid-aa')).resolves.toEqual({ status: 'completed' })

      const { searchParams } = new URL(requests.at(-1).url)
      expect(searchParams.get('network')).toBe('BITCOIN_TESTNET')
      expect(searchParams.get('transaction_id')).toBe('txid-aa')
    })
  })

  describe('_encodeCallDataMemo', () => {
    const protocol = new LayerswapProtocolBitcoin(undefined)

    test('encodes the numeric sequence via BigInt(seq).toString(16) stored as UTF-8 bytes', () => {
      // BigInt('7745').toString(16) === '1e41'
      expect(protocol._encodeCallDataMemo('7745').toString('utf8')).toBe('1e41')
    })

    test('hex-encodes only the part before ";" and appends the tail verbatim', () => {
      // BigInt('13646').toString(16) === '354e'
      expect(protocol._encodeCallDataMemo('13646;').toString('utf8')).toBe('354e;')
      expect(protocol._encodeCallDataMemo('13646;extra').toString('utf8')).toBe('354e;extra')
    })

    test.each([null, undefined, ''])('throws a ProviderError for a missing call_data (%p)', (callData) => {
      expect(() => protocol._encodeCallDataMemo(callData)).toThrow(ProviderError)
    })

    test('throws a ProviderError when the sequence part is not numeric', () => {
      expect(() => protocol._encodeCallDataMemo('not-a-number')).toThrow(ProviderError)
      expect(() => protocol._encodeCallDataMemo('nan;tail')).toThrow(/numeric sequence/)
    })

    test('throws a ProviderError when encoded payload exceeds 80 bytes', () => {
      expect(() => protocol._encodeCallDataMemo(`1;${'x'.repeat(90)}`)).toThrow(ProviderError)
      expect(() => protocol._encodeCallDataMemo(`1;${'x'.repeat(90)}`)).toThrow(/80-byte/)
    })
  })

  describe('quote fee approximation', () => {
    test('adds the BTC fee approximation (in satoshis) to quotes', async () => {
      server.use(layerswapApi.networks(NETWORKS), layerswapApi.quote({ total_fee: 0.0001, service_fee: 0.00001, blockchain_fee: 0.00009 }))

      const { account } = makeAccount()

      await expect(new LayerswapProtocolBitcoin(account).quoteBridge(BRIDGE_OPTIONS)).resolves.toEqual({ fee: 1_500n, bridgeFee: 10_000n })
    })
  })

  describe('PSBT deposit', () => {
    test('builds the deposit + OP_RETURN memo, signs it and broadcasts it through the account client', async () => {
      useSwapHandlers(depositAction({ callData: '7745' }))

      const { account, broadcast } = makeAccount()
      const result = await new LayerswapProtocolBitcoin(account).swidge(SWIDGE_OPTIONS)

      expect(broadcast).toHaveBeenCalledTimes(1)
      const tx = Transaction.fromHex(broadcast.mock.calls[0][0])

      // Output #0 = deposit, #1 = OP_RETURN memo (UTF-8 of '1e41'), #2 = change.
      expect(tx.outs).toHaveLength(3)
      expect(tx.outs[0].value).toBe(100_000n)
      expect(tx.outs[1].script[0]).toBe(0x6a)
      expect(Buffer.from(tx.outs[1].script.subarray(2)).toString('utf8')).toBe('1e41')

      // Every P2WPKH input is signed: witness = [signature, pubkey].
      for (const input of tx.ins) {
        expect(input.witness).toHaveLength(2)
        expect(Buffer.from(input.witness[1]).equals(Buffer.from(TEST_CHILD_NODE.publicKey))).toBe(true)
      }

      expect(result.id).toBe('swap-id-1')
      expect(result.hash).toBe(tx.getId())
      expect(result.fees.at(-1)).toMatchObject({ type: 'network', token: 'BTC', chain: 'BITCOIN_MAINNET', included: false })
      expect(result.fees.at(-1).amount).toBeGreaterThan(0n)
    })

    test('estimates the fee rate with the configured confirmationTarget', async () => {
      useSwapHandlers()

      const { account, estimateFeeFn } = makeAccount()
      await new LayerswapProtocolBitcoin(account, { confirmationTarget: 6 }).swidge(SWIDGE_OPTIONS)

      expect(estimateFeeFn).toHaveBeenCalledWith(6)
    })

    test('uses the feeRate option instead of the estimate', async () => {
      useSwapHandlers()

      const { account, estimateFeeFn } = makeAccount()
      const result = await new LayerswapProtocolBitcoin(account).swidge({ ...SWIDGE_OPTIONS, feeRate: 1n })

      expect(estimateFeeFn).not.toHaveBeenCalled()
      // With 1 sat/vB, a 1-in 3-out tx costs low hundreds of sats at most.
      expect(result.fees.at(-1).amount).toBeLessThan(500n)
    })

    test('forwards the legacy bridge feeRate option', async () => {
      useSwapHandlers()

      const { account, estimateFeeFn } = makeAccount()
      const result = await new LayerswapProtocolBitcoin(account).bridge({ ...BRIDGE_OPTIONS, feeRate: 1n })

      expect(estimateFeeFn).not.toHaveBeenCalled()
      expect(result.fee).toBeLessThan(500n)
    })

    test('throws a ValueError when the amount is at or below the dust limit', async () => {
      useSwapHandlers(depositAction({ amount: 0.000001 }))

      const error = await new LayerswapProtocolBitcoin(makeAccount().account).swidge({ ...SWIDGE_OPTIONS, fromTokenAmount: 100n }).catch((err) => err)

      expect(error).toBeInstanceOf(ValueError)
      expect(error.message).toMatch(/dust limit/)
    })

    test.each([
      ['missing call_data', depositAction({ callData: null })],
      ['an amount above the requested one', depositAction({ amount: 0.00100001 })],
      ['a missing amount', depositAction({ amount: null })]
    ])('throws a ProviderError, without broadcasting, for %s', async (_, action) => {
      useSwapHandlers(action)

      const { account, broadcast } = makeAccount()

      await expect(new LayerswapProtocolBitcoin(account).swidge(SWIDGE_OPTIONS)).rejects.toThrow(ProviderError)
      expect(broadcast).not.toHaveBeenCalled()
    })

    test('throws a ValueError, without broadcasting, when fromChain is not the account network', async () => {
      useSwapHandlers()

      const { account, broadcast } = makeAccount({ networkName: 'bitcoin' })

      await expect(new LayerswapProtocolBitcoin(account).swidge({ ...SWIDGE_OPTIONS, fromChain: 'BITCOIN_TESTNET' }))
        .rejects.toThrow("The 'fromChain' option is 'BITCOIN_TESTNET', but the wallet account is connected to 'BITCOIN_MAINNET'.")
      expect(broadcast).not.toHaveBeenCalled()
    })

    test('throws a ProviderError when the deposit action has no to_address', async () => {
      useSwapHandlers(depositAction({ depositAddress: '' }))

      await expect(new LayerswapProtocolBitcoin(makeAccount().account).swidge(SWIDGE_OPTIONS)).rejects.toThrow(ProviderError)
    })

    test.each([
      ['malformed', 'not-a-bitcoin-address'],
      ['testnet', payments.p2wpkh({ hash: Buffer.alloc(20, 1), network: networks.testnet }).address]
    ])('throws a ProviderError, without broadcasting, when the deposit address is %s', async (_, depositAddress) => {
      useSwapHandlers(depositAction({ depositAddress }))
      const { account, broadcast } = makeAccount()

      await expect(new LayerswapProtocolBitcoin(account).swidge(SWIDGE_OPTIONS))
        .rejects.toThrow(`Layerswap returned a malformed Bitcoin deposit address '${depositAddress}'.`)
      expect(broadcast).not.toHaveBeenCalled()
    })

    test('throws an InvalidTokenError for a non-native source token, before creating a swap', async () => {
      const networksWithToken = [
        { ...BITCOIN_MAINNET, tokens: [...BITCOIN_TOKENS, { symbol: 'ORDI', contract: 'brc20-ordi', decimals: 18 }] },
        ARBITRUM_MAINNET
      ]
      server.use(layerswapApi.networks(networksWithToken))
      const requests = recordRequests(server)

      const error = await new LayerswapProtocolBitcoin(makeAccount().account).swidge({ ...SWIDGE_OPTIONS, fromToken: 'ORDI', toToken: 'WBTC' }).catch((err) => err)

      expect(error).toBeInstanceOf(InvalidTokenError)
      expect(requests.some((request) => request.method === 'POST')).toBe(false)
    })
  })

  describe('balance', () => {
    test('throws a SwidgeError (INSUFFICIENT_BALANCE) when there are no unspent outputs', async () => {
      useSwapHandlers()

      const { account, broadcast } = makeAccount({ utxos: [] })
      const error = await new LayerswapProtocolBitcoin(account).swidge(SWIDGE_OPTIONS).catch((err) => err)

      expect(error).toBeInstanceOf(SwidgeError)
      expect(error.reason).toBe(SwidgeErrorReason.INSUFFICIENT_BALANCE)
      expect(broadcast).not.toHaveBeenCalled()
    })

    test('throws a SwidgeError (INSUFFICIENT_BALANCE) when the UTXOs cannot cover the deposit', async () => {
      useSwapHandlers()

      const { account } = makeAccount({ utxos: [makeUtxo({ value: 50_000 })] })
      const error = await new LayerswapProtocolBitcoin(account).swidge(SWIDGE_OPTIONS).catch((err) => err)

      expect(error).toBeInstanceOf(SwidgeError)
      expect(error.reason).toBe(SwidgeErrorReason.INSUFFICIENT_BALANCE)
    })

    test('surfaces it as a BridgeError through the legacy bridge surface', async () => {
      useSwapHandlers()

      const { account } = makeAccount({ utxos: [] })
      const error = await new LayerswapProtocolBitcoin(account).bridge(BRIDGE_OPTIONS).catch((err) => err)

      expect(error).toBeInstanceOf(BridgeError)
      expect(error.reason).toBe(SwidgeErrorReason.INSUFFICIENT_BALANCE)
    })
  })

  describe('bitcoin client errors', () => {
    test('wraps bitcoin client failures in a ProviderError', async () => {
      useSwapHandlers()

      const { account, broadcast } = makeAccount()
      broadcast.mockRejectedValue(new Error('electrum: connection reset'))

      const error = await new LayerswapProtocolBitcoin(account).swidge(SWIDGE_OPTIONS).catch((err) => err)

      expect(error).toBeInstanceOf(ProviderError)
      expect(error.message).toMatch(/connection reset/)
    })
  })

  describe('accounts', () => {
    test('throws an AccountRequiredError for read-only accounts', async () => {
      const { account } = makeAccount({ writable: false })

      await expect(new LayerswapProtocolBitcoin(account).swidge(SWIDGE_OPTIONS)).rejects.toThrow(AccountRequiredError)
    })

    test('throws a DisposalError once the master node has been wiped', async () => {
      const { account, broadcast } = makeAccount({ disposed: true })

      await expect(new LayerswapProtocolBitcoin(account).swidge(SWIDGE_OPTIONS)).rejects.toThrow(DisposalError)
      expect(broadcast).not.toHaveBeenCalled()
    })
  })
})
