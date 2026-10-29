// Tests of the TON specifics only: the default source network, gas approximations, the
// deposit message (jetton / native), account detection and wallet error mapping. The
// chain-agnostic swidge behaviour (quotes, guards, status, bridge adapters, discovery, …)
// is covered once by the `LayerswapSwidgeProtocol` tests in
// `@layerswap/wdk-protocol-swidge-layerswap-core`.

import { describe, expect, jest, test } from '@jest/globals'

import { Address, Cell, toNano } from '@ton/ton'

import {
  http,
  HttpResponse,
  layerswapApi,
  recordRequests,
  setupLayerswapServer
} from '@layerswap/wdk-protocol-swidge-layerswap-test-utils'

import LayerswapProtocolTon, {
  AccountRequiredError,
  DisposalError,
  MaximumFeeExceededError,
  NoSuchElementError,
  ProviderError,
  ProviderRequiredError,
  ValueError
} from '../index.js'

// Deterministic, checksum-valid TON addresses built from raw hashes.
function tonAddr (byte) {
  return new Address(0, Buffer.alloc(32, byte)).toString({ bounceable: true, urlSafe: true })
}

const TON_JETTON_USDT_MASTER = tonAddr(0x11)
const TON_DEPOSIT_ADDRESS = tonAddr(0x22)
const SENDER_ADDRESS = tonAddr(0x33)
const SENDER_JETTON_WALLET = tonAddr(0x44)
const EVM_RECIPIENT = '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd'

const TON_MAINNET = {
  name: 'TON_MAINNET',
  chain_id: null,
  type: 'ton',
  tokens: [
    { symbol: 'TON', contract: null, decimals: 9 },
    { symbol: 'USDT', contract: TON_JETTON_USDT_MASTER, decimals: 6 }
  ]
}

const ARBITRUM_MAINNET = {
  name: 'ARBITRUM_MAINNET',
  chain_id: '42161',
  type: 'evm',
  tokens: [
    { symbol: 'USDT', contract: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', decimals: 6 },
    { symbol: 'ETH', contract: null, decimals: 18 }
  ]
}

const TON_TESTNET = { ...TON_MAINNET, name: 'TON_TESTNET' }

const NETWORKS = [TON_MAINNET, TON_TESTNET, ARBITRUM_MAINNET]

// Root hashes of the TON mainnet / testnet zero-state blocks.
const MAINNET_ZERO_STATE = 'F6OpKZKqvqeFp6CQmFomXNMfMj2EnaUSOXN+Mh+wVWk='
const TESTNET_ZERO_STATE = 'gj+B8wb/AmlPk1z1AhVI484rhrUpgSr2oSFIh56VoSg='

const TON_CENTER_V3_URL = 'https://toncenter.test/api/v3'
const TON_CENTER_API_KEY = 'ton-center-key'

const depositAction = ({ callData = JSON.stringify({ comment: 'swap-ref', amount: '10000000' }), toAddress = TON_DEPOSIT_ADDRESS } = {}) => ({
  type: 'transfer',
  order: 0,
  to_address: toAddress,
  amount: 10,
  amount_in_base_units: '10000000',
  call_data: callData
})

const server = setupLayerswapServer()

const useSwapHandlers = (action = depositAction()) =>
  server.use(...layerswapApi.swidgeFlow({ networks: NETWORKS, depositActions: [action], swapId: 'swap-ton-123' }))

/**
 * Builds a mock TON account. The protocol only consumes `getAddress()`,
 * `sendTransaction({ to, value, body })`, `_getJettonWalletAddress(token)`, `keyPair` and
 * the ton center client (`_tonClient`) the account was built with.
 */
function makeAccount ({ writable = true, zeroState = MAINNET_ZERO_STATE } = {}) {
  const account = {
    getAddress: jest.fn().mockResolvedValue(SENDER_ADDRESS),
    _getJettonWalletAddress: jest.fn().mockResolvedValue(Address.parse(SENDER_JETTON_WALLET)),
    _tonClient: {
      api: { getMasterchainInfo: jest.fn().mockResolvedValue({ init: { root_hash: zeroState } }) }
    },
    _resolveTonCenterEndpoint: () => ({ baseUrl: TON_CENTER_V3_URL, apiKey: TON_CENTER_API_KEY })
  }

  if (writable) {
    account.sendTransaction = jest.fn().mockResolvedValue({ hash: 'tonhash-deadbeef', fee: 12_345_000n })
  }

  return account
}

const JETTON_SWIDGE_OPTIONS = {
  fromToken: 'USDT',
  toChain: 'ARBITRUM_MAINNET',
  recipient: EVM_RECIPIENT,
  fromTokenAmount: 10_000_000n
}

const NATIVE_SWIDGE_OPTIONS = {
  fromToken: 'TON',
  toToken: 'ETH',
  toChain: 'ARBITRUM_MAINNET',
  recipient: EVM_RECIPIENT,
  fromTokenAmount: 1_000_000_000n
}

describe('LayerswapProtocolTon', () => {
  describe('source network', () => {
    const quotedSourceNetwork = async (protocol, options = JETTON_SWIDGE_OPTIONS) => {
      server.use(layerswapApi.networks(NETWORKS), layerswapApi.quote())
      const requests = recordRequests(server)

      await protocol.quoteSwidge(options)

      return new URL(requests.find((request) => request.url.includes('/api/v2/quote')).url).searchParams.get('source_network')
    }

    test.each([
      ['TON_MAINNET', MAINNET_ZERO_STATE],
      ['TON_TESTNET', TESTNET_ZERO_STATE]
    ])('detects %s from the zero state of the account ton center', async (expected, zeroState) => {
      await expect(quotedSourceNetwork(new LayerswapProtocolTon(makeAccount({ zeroState })))).resolves.toBe(expected)
    })

    test('asks ton center once per protocol instance', async () => {
      const account = makeAccount()
      const protocol = new LayerswapProtocolTon(account)

      await quotedSourceNetwork(protocol)
      await quotedSourceNetwork(protocol)

      expect(account._tonClient.api.getMasterchainInfo).toHaveBeenCalledTimes(1)
    })

    test('defaults to TON_MAINNET without an account', async () => {
      await expect(quotedSourceNetwork(new LayerswapProtocolTon(undefined))).resolves.toBe('TON_MAINNET')
    })

    test('throws a ValueError on an unknown zero state', async () => {
      server.use(layerswapApi.networks(NETWORKS))

      await expect(new LayerswapProtocolTon(makeAccount({ zeroState: 'unknown' })).quoteSwidge(JETTON_SWIDGE_OPTIONS))
        .rejects.toThrow(ValueError)
    })

    test('throws a ProviderRequiredError when the account is not connected to ton center', async () => {
      server.use(layerswapApi.networks(NETWORKS))

      const account = makeAccount()
      delete account._tonClient

      await expect(new LayerswapProtocolTon(account).quoteSwidge(JETTON_SWIDGE_OPTIONS)).rejects.toThrow(ProviderRequiredError)
    })

    test('throws a ValueError, without sending, when fromChain is not the ton center network', async () => {
      useSwapHandlers()

      const account = makeAccount()

      await expect(new LayerswapProtocolTon(account).swidge({ ...JETTON_SWIDGE_OPTIONS, fromChain: 'TON_TESTNET' }))
        .rejects.toThrow("The 'fromChain' option is 'TON_TESTNET', but the wallet account is connected to 'TON_MAINNET'.")
      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test('getTransactionStatus defaults the network to TON_MAINNET, passing Layerswap ids as-is', async () => {
      server.use(layerswapApi.networks(NETWORKS), layerswapApi.transactionStatus('completed'))
      const requests = recordRequests(server)

      await expect(new LayerswapProtocolTon(makeAccount()).getTransactionStatus('hash-aa')).resolves.toEqual({ status: 'completed' })

      const { searchParams } = new URL(requests.at(-1).url)
      expect(searchParams.get('network')).toBe('TON_MAINNET')
      expect(searchParams.get('transaction_id')).toBe('hash-aa')
    })
  })

  describe('transaction status', () => {
    const BODY_HASH = 'c3aef0d255b9aa66bd84dfd710347cfbe2c9d0c88ebce25958131d06e149058d'
    const WALLET_TX = 'lWFEQBGDeJNGdvXDxMFDqTckfkCTuTOopYs3NXIs5fE='

    // Mirrors ton center v3: the wallet transaction found by the external message body hash,
    // and the trace it starts.
    const useTonCenter = ({ walletTransactions = [{ hash: WALLET_TX }], transactions, headers = [] } = {}) => server.use(
      http.get(`${TON_CENTER_V3_URL}/transactionsByMessage`, ({ request }) => {
        headers.push(request.headers.get('x-api-key'))
        return HttpResponse.json({ transactions: walletTransactions })
      }),
      http.get(`${TON_CENTER_V3_URL}/traces`, () => HttpResponse.json({ traces: [{ transactions }] })),
      layerswapApi.networks(NETWORKS),
      layerswapApi.transactionStatus('completed')
    )

    const requestedId = (requests) => new URL(requests.find((request) => request.url.includes('/transaction_status')).url).searchParams.get('transaction_id')

    test('resolves a jetton deposit to the transfer notification that reached the deposit address', async () => {
      const headers = []
      useTonCenter({
        headers,
        transactions: {
          [WALLET_TX]: { in_msg: { opcode: null }, out_msgs: [{ hash: 'to-jetton-wallet', opcode: '0x0f8a7ea5' }] },
          'deposit-jetton-wallet-tx': { in_msg: { hash: 'internal-transfer', opcode: '0x178d4519' } },
          'deposit-tx': { in_msg: { hash: 'notification-hash', opcode: '0x7362d09c' } }
        }
      })
      const requests = recordRequests(server)

      await expect(new LayerswapProtocolTon(makeAccount()).getTransactionStatus(BODY_HASH)).resolves.toEqual({ status: 'completed' })

      expect(requestedId(requests)).toBe('notification-hash')
      expect(headers).toEqual([TON_CENTER_API_KEY])
    })

    test('resolves a native deposit to the wallet message sent to the deposit address', async () => {
      useTonCenter({
        transactions: {
          [WALLET_TX]: { in_msg: { opcode: null }, out_msgs: [{ hash: 'to-deposit-address', opcode: '0x00000000' }] }
        }
      })
      const requests = recordRequests(server)

      await new LayerswapProtocolTon(makeAccount()).getTransactionStatus(BODY_HASH)

      expect(requestedId(requests)).toBe('to-deposit-address')
    })

    test.each([
      ['ton center has not indexed the deposit', { walletTransactions: [] }],
      ['the jetton notification has not been delivered', { transactions: { [WALLET_TX]: { out_msgs: [{ hash: 'to-jetton-wallet', opcode: '0x0f8a7ea5' }] } } }]
    ])('throws a NoSuchElementError, without asking Layerswap, when %s', async (_, tonCenter) => {
      useTonCenter(tonCenter)
      const requests = recordRequests(server)

      await expect(new LayerswapProtocolTon(makeAccount()).getTransactionStatus(BODY_HASH)).rejects.toThrow(NoSuchElementError)
      expect(requests.some((request) => request.url.includes('/transaction_status'))).toBe(false)
    })

    test('reads the api key from the ton client http api when the wallet does not report it', async () => {
      const headers = []
      useTonCenter({ headers, transactions: { [WALLET_TX]: { out_msgs: [{ hash: 'to-deposit-address', opcode: '0x00000000' }] } } })

      const account = makeAccount()
      account._resolveTonCenterEndpoint = () => ({ baseUrl: TON_CENTER_V3_URL, apiKey: undefined })
      account._tonClient.api.parameters = { apiKey: 'http-api-key' }

      await new LayerswapProtocolTon(account).getTransactionStatus(BODY_HASH)

      expect(headers).toEqual(['http-api-key'])
    })

    test('throws a ProviderError when ton center fails', async () => {
      server.use(layerswapApi.networks(NETWORKS), http.get(`${TON_CENTER_V3_URL}/transactionsByMessage`, () => HttpResponse.json({}, { status: 500 })))

      await expect(new LayerswapProtocolTon(makeAccount()).getTransactionStatus(BODY_HASH)).rejects.toThrow(ProviderError)
    })

    test('throws a ProviderRequiredError for a deposit hash without ton center', async () => {
      server.use(layerswapApi.networks(NETWORKS))

      await expect(new LayerswapProtocolTon(undefined).getTransactionStatus(BODY_HASH, { sourceChain: 'TON_MAINNET' }))
        .rejects.toThrow(ProviderRequiredError)
    })
  })

  describe('gas quote', () => {
    test('approximates the jetton-transfer fee for jetton sources', async () => {
      server.use(layerswapApi.networks(NETWORKS), layerswapApi.quote())

      const quote = await new LayerswapProtocolTon(makeAccount()).quoteSwidge(JETTON_SWIDGE_OPTIONS)

      expect(quote.fees.at(-1)).toEqual({ type: 'network', amount: 50_000_000n, token: 'TON', chain: 'TON_MAINNET', included: false, description: 'Source-chain gas' })
    })

    test('approximates the native-transfer fee for TON sources', async () => {
      server.use(layerswapApi.networks(NETWORKS), layerswapApi.quote())

      const quote = await new LayerswapProtocolTon(makeAccount()).quoteSwidge(NATIVE_SWIDGE_OPTIONS)

      expect(quote.fees.at(-1)).toMatchObject({ type: 'network', amount: 10_000_000n, token: 'TON', included: false })
    })
  })

  describe('deposit message — jetton', () => {
    test('sends a TIP-3 jetton transfer to the sender jetton wallet with a 0.045 TON gas budget', async () => {
      useSwapHandlers(depositAction({ callData: JSON.stringify({ comment: 'ref-jetton', amount: '10000000' }) }))

      const account = makeAccount()
      await new LayerswapProtocolTon(account).swidge(JETTON_SWIDGE_OPTIONS)

      expect(account._getJettonWalletAddress).toHaveBeenCalledWith(TON_JETTON_USDT_MASTER)

      const sent = account.sendTransaction.mock.calls[0][0]
      expect(sent.to).toBe(Address.parse(SENDER_JETTON_WALLET).toString())
      expect(sent.value).toBe(toNano('0.045'))
      expect(sent.body).toBeInstanceOf(Cell)

      const slice = sent.body.beginParse()
      expect(slice.loadUint(32)).toBe(0x0f8a7ea5) // op
      expect(slice.loadUintBig(64)).toBe(0n) // query id
      expect(slice.loadCoins()).toBe(10_000_000n) // jetton amount from call_data
      expect(slice.loadAddress().toString()).toBe(Address.parse(TON_DEPOSIT_ADDRESS).toString())
      expect(slice.loadAddress().toString()).toBe(Address.parse(TON_DEPOSIT_ADDRESS).toString())
      expect(slice.loadBit()).toBe(false) // no custom payload
      expect(slice.loadCoins()).toBe(toNano('0.00002')) // forward amount
      expect(slice.loadBit()).toBe(true) // forward payload as ref

      const forward = slice.loadRef().beginParse()
      expect(forward.loadUint(32)).toBe(0)
      expect(forward.loadStringTail()).toBe('ref-jetton')
    })

    test('prefers the Layerswap call_data amount over the requested amount', async () => {
      useSwapHandlers(depositAction({ callData: JSON.stringify({ comment: 'ref', amount: '9990000' }) }))

      const account = makeAccount()
      await new LayerswapProtocolTon(account).swidge(JETTON_SWIDGE_OPTIONS)

      const slice = account.sendTransaction.mock.calls[0][0].body.beginParse()
      slice.loadUint(32)
      slice.loadUintBig(64)
      expect(slice.loadCoins()).toBe(9_990_000n)
    })

    test.each([
      ['missing', null],
      ['not JSON', 'not-json'],
      ['without a comment', JSON.stringify({ amount: '10000000' })],
      ['with an empty comment', JSON.stringify({ comment: '', amount: '10000000' })],
      ['without an amount', JSON.stringify({ comment: 'ref' })],
      ['with an amount above the requested one', JSON.stringify({ comment: 'ref', amount: '10000001' })]
    ])('throws a ProviderError, without sending, when call_data is %s', async (_, callData) => {
      useSwapHandlers(depositAction({ callData }))

      const account = makeAccount()

      await expect(new LayerswapProtocolTon(account).swidge(JETTON_SWIDGE_OPTIONS)).rejects.toThrow(ProviderError)
      expect(account.sendTransaction).not.toHaveBeenCalled()
    })
  })

  describe('deposit message — native', () => {
    test('sends a comment cell with the call_data amount to the deposit address', async () => {
      useSwapHandlers(depositAction({ callData: JSON.stringify({ comment: 'ref-native', amount: '1000000000' }) }))

      const account = makeAccount()
      await new LayerswapProtocolTon(account).swidge(NATIVE_SWIDGE_OPTIONS)

      expect(account._getJettonWalletAddress).not.toHaveBeenCalled()

      const sent = account.sendTransaction.mock.calls[0][0]
      expect(sent.to).toBe(TON_DEPOSIT_ADDRESS)
      expect(sent.value).toBe(1_000_000_000n)

      const slice = sent.body.beginParse()
      expect(slice.loadUint(32)).toBe(0)
      expect(slice.loadStringTail()).toBe('ref-native')
    })

    test.each([
      ['empty', ''],
      ['missing', null]
    ])('throws a ProviderError, without sending, when call_data is %s', async (_, callData) => {
      useSwapHandlers(depositAction({ callData }))

      const account = makeAccount()

      await expect(new LayerswapProtocolTon(account).swidge(NATIVE_SWIDGE_OPTIONS)).rejects.toThrow(ProviderError)
      expect(account.sendTransaction).not.toHaveBeenCalled()
    })
  })

  describe('deposit action', () => {
    test('throws a ProviderError when the deposit action has no to_address', async () => {
      useSwapHandlers(depositAction({ toAddress: '' }))

      await expect(new LayerswapProtocolTon(makeAccount()).swidge(JETTON_SWIDGE_OPTIONS)).rejects.toThrow(ProviderError)
    })

    test('throws a ProviderError when the deposit address is malformed', async () => {
      useSwapHandlers(depositAction({ toAddress: 'not-a-ton-address' }))

      const error = await new LayerswapProtocolTon(makeAccount()).swidge(JETTON_SWIDGE_OPTIONS).catch((err) => err)

      expect(error).toBeInstanceOf(ProviderError)
      expect(error.message).toMatch(/malformed TON deposit address/)
    })
  })

  describe('broadcast', () => {
    test('reports the fee returned by sendTransaction as the source-chain gas', async () => {
      useSwapHandlers()

      const result = await new LayerswapProtocolTon(makeAccount()).swidge(JETTON_SWIDGE_OPTIONS)

      expect(result).toMatchObject({ id: 'swap-ton-123', hash: 'tonhash-deadbeef' })
      expect(result.transactions).toEqual([{ hash: 'tonhash-deadbeef', chain: 'TON_MAINNET', type: 'source' }])
      expect(result.fees.at(-1)).toEqual({ type: 'network', amount: 12_345_000n, token: 'TON', chain: 'TON_MAINNET', included: false, description: 'Source-chain gas' })
    })

    test('bridge happy path returns the deposit hash, gas fee, Layerswap fee and swap id', async () => {
      useSwapHandlers()

      const result = await new LayerswapProtocolTon(makeAccount()).bridge({
        targetChain: 'ARBITRUM_MAINNET',
        recipient: EVM_RECIPIENT,
        token: 'USDT',
        amount: 10_000_000n
      })

      expect(result).toEqual({ hash: 'tonhash-deadbeef', fee: 12_345_000n, bridgeFee: 500_000n, swapId: 'swap-ton-123' })
    })
  })

  describe('wallet errors', () => {
    test('maps the "not connected to ton center" failure to a ProviderRequiredError', async () => {
      useSwapHandlers()

      const account = makeAccount()
      account.sendTransaction.mockRejectedValue(new Error('The wallet must be connected to ton center to send transactions.'))

      await expect(new LayerswapProtocolTon(account).swidge(JETTON_SWIDGE_OPTIONS)).rejects.toThrow(ProviderRequiredError)
    })

    test('maps the transaction max-fee failure to a MaximumFeeExceededError', async () => {
      useSwapHandlers()

      const account = makeAccount()
      account.sendTransaction.mockRejectedValue(new Error('Exceeded maximum fee cost for transaction operation.'))

      await expect(new LayerswapProtocolTon(account).swidge(JETTON_SWIDGE_OPTIONS)).rejects.toThrow(MaximumFeeExceededError)
    })

    test('wraps other wallet failures in a ProviderError', async () => {
      useSwapHandlers()

      const account = makeAccount()
      account._getJettonWalletAddress.mockRejectedValue(new Error('toncenter exploded'))

      const error = await new LayerswapProtocolTon(account).swidge(JETTON_SWIDGE_OPTIONS).catch((err) => err)

      expect(error).toBeInstanceOf(ProviderError)
      expect(error.message).toMatch('toncenter exploded')
    })
  })

  describe('accounts', () => {
    test('throws an AccountRequiredError for read-only accounts (no sendTransaction)', async () => {
      await expect(new LayerswapProtocolTon(makeAccount({ writable: false })).swidge(JETTON_SWIDGE_OPTIONS))
        .rejects.toThrow(AccountRequiredError)
    })

    test('throws a DisposalError when the account reports it has been disposed', async () => {
      const account = makeAccount()
      account.disposed = true

      await expect(new LayerswapProtocolTon(account).swidge(JETTON_SWIDGE_OPTIONS)).rejects.toThrow(DisposalError)
      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test('throws a DisposalError when the account private key has been erased', async () => {
      const account = makeAccount()
      account.keyPair = { publicKey: new Uint8Array(32), privateKey: null }

      await expect(new LayerswapProtocolTon(account).swidge(JETTON_SWIDGE_OPTIONS)).rejects.toThrow(DisposalError)
    })
  })
})
