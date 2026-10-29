import { describe, expect, jest, test } from '@jest/globals'

import { ProviderErrorReason } from '@tetherto/wdk-wallet'
import {
  AccountRequiredError,
  BridgeError,
  DisposalError,
  InvalidTokenError,
  MaximumFeeExceededError,
  NoSuchElementError,
  NotImplementedError,
  ProviderError,
  ProviderRequiredError,
  SwidgeError,
  SwidgeErrorReason,
  ValueError
} from '@tetherto/wdk-wallet/protocols'

import {
  API_URL,
  http,
  HttpResponse,
  layerswapApi,
  recordRequests,
  setupLayerswapServer
} from '@layerswap/wdk-protocol-swidge-layerswap-test-utils'

import { LayerswapSwidgeProtocol, resolveNetworkByName } from '../index.js'

const USER_ADDRESS = 'user-address'
const DEPOSIT_ADDRESS = 'deposit-address'

const SOURCE_NETWORK = {
  name: 'SOURCE_MAINNET',
  chain_id: '1',
  type: 'test',
  token: { symbol: 'NATIVE', contract: null, decimals: 18 },
  tokens: [
    { symbol: 'USDC', contract: 'usdc-source', decimals: 6 },
    { symbol: 'NATIVE', contract: null, decimals: 18 }
  ]
}

const DESTINATION_NETWORK = {
  name: 'DESTINATION_MAINNET',
  chain_id: '2',
  type: 'test',
  tokens: [{ symbol: 'USDC', contract: 'usdc-destination', decimals: 6 }]
}

const OTHER_VM_NETWORK = {
  name: 'OTHER_MAINNET',
  chain_id: 'other',
  type: 'other',
  tokens: [{ symbol: 'USDC', contract: 'usdc-other', decimals: 6 }]
}

const NETWORKS = [SOURCE_NETWORK, DESTINATION_NETWORK, OTHER_VM_NETWORK]

const DEPOSIT_ACTION = {
  type: 'transfer',
  order: 1,
  to_address: DEPOSIT_ADDRESS,
  amount: 100,
  amount_in_base_units: '100000000',
  call_data: 'deposit-call-data'
}

/**
 * A minimal VM implementation: the account quotes and sends the deposit action as-is.
 */
class TestProtocol extends LayerswapSwidgeProtocol {
  get _nativeTokenSymbol () {
    return 'NATIVE'
  }

  async _detectSourceNetwork () {
    return resolveNetworkByName(this._client, 'SOURCE_MAINNET')
  }

  _isWritableAccount (account) {
    return typeof account?.sendTransaction === 'function'
  }

  async _quoteSourceGas () {
    return this._account.quoteGas()
  }

  async _prepareDeposit ({ action }) {
    const fee = await this._callWallet(() => this._account.quoteDeposit(action))
    return { action, fee }
  }

  async _sendDeposit ({ action }) {
    return this._callWallet(() => this._account.sendTransaction(action))
  }
}

function makeAccount () {
  return {
    getAddress: jest.fn().mockResolvedValue(USER_ADDRESS),
    quoteGas: jest.fn().mockResolvedValue(1_000n),
    quoteDeposit: jest.fn().mockResolvedValue(12_345n),
    sendTransaction: jest.fn().mockResolvedValue({ hash: 'deposit-hash' })
  }
}

function makeReadOnlyAccount () {
  return { getAddress: jest.fn().mockResolvedValue(USER_ADDRESS) }
}

const SWIDGE_OPTIONS = {
  fromToken: 'USDC',
  toChain: 'DESTINATION_MAINNET',
  recipient: 'recipient-address',
  fromTokenAmount: 100_000_000n
}

const BRIDGE_OPTIONS = {
  targetChain: 'DESTINATION_MAINNET',
  recipient: 'recipient-address',
  token: 'USDC',
  amount: 100_000_000n
}

const server = setupLayerswapServer()

const useSwapHandlers = ({ depositActions = [DEPOSIT_ACTION], speedupStatus } = {}) =>
  server.use(...layerswapApi.swidgeFlow({ networks: NETWORKS, depositActions, speedupStatus }))

describe('LayerswapSwidgeProtocol', () => {
  describe('api client', () => {
    test('sends X-LS-APIKEY only when an api key is configured', async () => {
      server.use(layerswapApi.networks(NETWORKS))
      const requests = recordRequests(server)

      await new TestProtocol(undefined).getSupportedChains()
      await new TestProtocol(undefined, { apiKey: 'my-key' }).getSupportedChains()

      expect(requests.map((request) => request.headers.get('X-LS-APIKEY'))).toEqual([null, 'my-key'])
    })

    test('honours a custom apiUrl', async () => {
      server.use(http.get('https://staging.layerswap.test/api/v2/networks', () => HttpResponse.json({ data: NETWORKS })))

      const protocol = new TestProtocol(undefined, { apiUrl: 'https://staging.layerswap.test' })

      await expect(protocol.getSupportedChains()).resolves.toHaveLength(3)
      expect(protocol.getApiClient()).toBeDefined()
    })
  })

  describe('quoteSwidge', () => {
    test('maps the Layerswap quote to a WDK swidge quote with itemised fees and source-chain gas', async () => {
      server.use(layerswapApi.networks(NETWORKS), layerswapApi.quote({ avg_completion_time: '00:02:30' }))

      const quote = await new TestProtocol(makeAccount()).quoteSwidge(SWIDGE_OPTIONS)

      expect(quote).toEqual({
        fromTokenAmount: 100_000_000n,
        toTokenAmount: 99_500_000n,
        toTokenAmountMin: 99_000_000n,
        estimatedDuration: 150,
        fees: [
          expect.objectContaining({ type: 'protocol', amount: 400_000n, token: 'USDC', included: true }),
          expect.objectContaining({ type: 'network', amount: 100_000n, token: 'USDC', included: true }),
          { type: 'network', amount: 1_000n, token: 'NATIVE', chain: 'SOURCE_MAINNET', included: false, description: 'Source-chain gas' }
        ]
      })
    })

    test('sends the route, amount, source address and slippage (as a percent string) to Layerswap', async () => {
      server.use(layerswapApi.networks(NETWORKS), layerswapApi.quote())
      const requests = recordRequests(server)

      await new TestProtocol(makeAccount()).quoteSwidge({ ...SWIDGE_OPTIONS, slippage: 0.005, refuel: true })

      const { searchParams } = new URL(requests.find((request) => request.url.includes('/api/v2/quote')).url)
      expect(Object.fromEntries(searchParams)).toEqual({
        source_network: 'SOURCE_MAINNET',
        source_token: 'USDC',
        destination_network: 'DESTINATION_MAINNET',
        destination_token: 'USDC',
        amount: '100',
        use_deposit_address: 'false',
        source_address: USER_ADDRESS,
        refuel: 'true',
        slippage: '0.5'
      })
    })

    test('works without an account when fromChain is given, without a gas entry', async () => {
      server.use(layerswapApi.networks(NETWORKS), layerswapApi.quote())

      const quote = await new TestProtocol(undefined).quoteSwidge({ ...SWIDGE_OPTIONS, fromChain: 'source_mainnet' })

      expect(quote.fees.every((fee) => fee.included)).toBe(true)
    })

    test('omits the gas entry when the estimate fails (e.g. unfunded account)', async () => {
      server.use(layerswapApi.networks(NETWORKS), layerswapApi.quote())

      const account = makeAccount()
      account.quoteGas.mockRejectedValue(new Error('missing revert data'))

      const quote = await new TestProtocol(account).quoteSwidge(SWIDGE_OPTIONS)

      expect(quote.fees.every((fee) => fee.included)).toBe(true)
    })

    test.each([
      ['exact-out options', { toTokenAmount: 1n, fromTokenAmount: undefined }, 'exact-in'],
      ['a missing fromTokenAmount', { fromTokenAmount: undefined }, 'fromTokenAmount'],
      ['a non-integer fromTokenAmount', { fromTokenAmount: '1.5' }, "'fromTokenAmount' option must be an integer"],
      ['a missing toChain (same-chain swap)', { toChain: undefined }, 'same-chain'],
      ['a toChain equal to the source chain', { toChain: 'SOURCE_MAINNET' }, 'cannot be equal'],
      ['an unsupported network', { toChain: 'UNKNOWN_MAINNET' }, "does not support network 'UNKNOWN_MAINNET'"],
      ['an invalid slippage', { slippage: -1 }, 'Invalid slippage']
    ])('throws a ValueError for %s', async (_, overrides, message) => {
      server.use(layerswapApi.networks(NETWORKS), layerswapApi.quote())

      const error = await new TestProtocol(makeAccount()).quoteSwidge({ ...SWIDGE_OPTIONS, ...overrides }).catch((err) => err)

      expect(error).toBeInstanceOf(ValueError)
      expect(error.message).toMatch(message)
    })

    test('throws an InvalidTokenError for tokens Layerswap does not support', async () => {
      server.use(layerswapApi.networks(NETWORKS))

      await expect(new TestProtocol(makeAccount()).quoteSwidge({ ...SWIDGE_OPTIONS, fromToken: 'DOGE' }))
        .rejects.toThrow(InvalidTokenError)
    })

    test('surfaces Layerswap validation errors as ValueError', async () => {
      server.use(layerswapApi.networks(NETWORKS), layerswapApi.error('get', '/api/v2/quote', 400, 'ROUTE_NOT_FOUND_ERROR', 'no route'))

      const error = await new TestProtocol(makeAccount()).quoteSwidge(SWIDGE_OPTIONS).catch((err) => err)

      expect(error).toBeInstanceOf(ValueError)
      expect(error.code).toBe('ROUTE_NOT_FOUND_ERROR')
    })

    test('surfaces Layerswap server failures as ProviderError', async () => {
      server.use(layerswapApi.error('get', '/api/v2/networks', 503))

      const error = await new TestProtocol(makeAccount()).quoteSwidge(SWIDGE_OPTIONS).catch((err) => err)

      expect(error).toBeInstanceOf(ProviderError)
      expect(error.reason).toBe(ProviderErrorReason.INTERNAL_SERVER_ERROR)
    })
  })

  describe('swidge', () => {
    test('creates the swap, sends the deposit, and returns a WDK swidge result', async () => {
      useSwapHandlers()

      const account = makeAccount()
      const result = await new TestProtocol(account).swidge(SWIDGE_OPTIONS)

      expect(account.quoteDeposit).toHaveBeenCalledWith(DEPOSIT_ACTION)
      expect(account.sendTransaction).toHaveBeenCalledWith(DEPOSIT_ACTION)
      expect(result).toEqual({
        id: 'swap-id-1',
        hash: 'deposit-hash',
        fees: [
          expect.objectContaining({ type: 'protocol', amount: 500_000n, token: 'USDC', included: true }),
          expect.objectContaining({ type: 'network', amount: 12_345n, token: 'NATIVE', included: false })
        ],
        transactions: [{ hash: 'deposit-hash', chain: 'SOURCE_MAINNET', type: 'source' }],
        fromTokenAmount: 100_000_000n,
        toTokenAmount: 0n,
        toTokenAmountMin: 0n
      })
    })

    test('sends the swap parameters to Layerswap and notifies it of the broadcast deposit', async () => {
      useSwapHandlers()
      const requests = recordRequests(server)

      await new TestProtocol(makeAccount()).swidge({
        ...SWIDGE_OPTIONS,
        refundAddress: 'refund-address',
        referenceId: 'reference-id',
        slippage: 0.01
      })

      const createSwap = requests.find((request) => request.method === 'POST' && request.url.endsWith('/api/v2/swaps'))
      expect(await createSwap.json()).toEqual({
        source_network: 'SOURCE_MAINNET',
        source_token: 'USDC',
        destination_network: 'DESTINATION_MAINNET',
        destination_token: 'USDC',
        destination_address: 'recipient-address',
        amount: '100',
        use_deposit_address: false,
        source_address: USER_ADDRESS,
        refund_address: 'refund-address',
        slippage: '1',
        reference_id: 'reference-id'
      })

      const speedup = requests.find((request) => request.url.endsWith('/swaps/swap-id-1/deposit_speedup'))
      expect(await speedup.json()).toEqual({ transaction_id: 'deposit-hash' })
    })

    test('swallows deposit speedup failures', async () => {
      useSwapHandlers({ speedupStatus: 500 })

      await expect(new TestProtocol(makeAccount()).swidge(SWIDGE_OPTIONS)).resolves.toMatchObject({ hash: 'deposit-hash' })
    })

    test('defaults the recipient to the account address for same-VM destinations', async () => {
      useSwapHandlers()
      const requests = recordRequests(server)

      await new TestProtocol(makeAccount()).swidge({ ...SWIDGE_OPTIONS, recipient: undefined })

      const createSwap = requests.find((request) => request.method === 'POST' && request.url.endsWith('/api/v2/swaps'))
      expect((await createSwap.json()).destination_address).toBe(USER_ADDRESS)
    })

    test('defaults the refund address to the account address', async () => {
      useSwapHandlers()
      const requests = recordRequests(server)

      await new TestProtocol(makeAccount()).swidge(SWIDGE_OPTIONS)

      const createSwap = requests.find((request) => request.method === 'POST' && request.url.endsWith('/api/v2/swaps'))
      expect((await createSwap.json()).refund_address).toBe(USER_ADDRESS)
    })

    test('throws a ValueError when the recipient is omitted for a cross-VM destination', async () => {
      useSwapHandlers()

      await expect(new TestProtocol(makeAccount()).swidge({ ...SWIDGE_OPTIONS, toChain: 'OTHER_MAINNET', recipient: undefined }))
        .rejects.toThrow(ValueError)
    })

    test('adds the gas fee reported by the broadcast when it was not known beforehand', async () => {
      useSwapHandlers()

      class PostBroadcastFeeProtocol extends TestProtocol {
        async _prepareDeposit ({ action }) { return { action } }
        async _sendDeposit () { return { hash: 'deposit-hash', fee: 777n } }
      }

      const result = await new PostBroadcastFeeProtocol(makeAccount()).swidge(SWIDGE_OPTIONS)

      expect(result.fees.at(-1)).toMatchObject({ type: 'network', amount: 777n, token: 'NATIVE', included: false })
    })

    test('throws an AccountRequiredError for read-only accounts, or without an account', async () => {
      await expect(new TestProtocol(makeReadOnlyAccount()).swidge(SWIDGE_OPTIONS)).rejects.toThrow(AccountRequiredError)
      await expect(new TestProtocol(undefined).swidge(SWIDGE_OPTIONS)).rejects.toThrow(AccountRequiredError)
    })

    test('throws a DisposalError for disposed accounts', async () => {
      const account = makeAccount()
      account.disposed = true

      await expect(new TestProtocol(account).swidge(SWIDGE_OPTIONS)).rejects.toThrow(DisposalError)
      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test('throws a DisposalError for accounts whose private key has been erased', async () => {
      const account = makeAccount()
      account.keyPair = { publicKey: new Uint8Array(32), privateKey: null }

      await expect(new TestProtocol(account).swidge(SWIDGE_OPTIONS)).rejects.toThrow(DisposalError)
      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test('throws a SwidgeError (COULD_NOT_MET_THRESHOLD) when the quoted minimum output is below minAmountOut', async () => {
      server.use(
        layerswapApi.networks(NETWORKS),
        layerswapApi.createSwap({ depositActions: [DEPOSIT_ACTION], quote: { total_fee: 0.5, receive_amount: 99.5, min_receive_amount: 99 } })
      )

      const account = makeAccount()
      const error = await new TestProtocol(account).swidge({ ...SWIDGE_OPTIONS, minAmountOut: 99_000_001n }).catch((err) => err)

      expect(error).toBeInstanceOf(SwidgeError)
      expect(error.reason).toBe(SwidgeErrorReason.COULD_NOT_MET_THRESHOLD)
      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test.each([
      ['minAmountOut', { minAmountOut: 'x' }, undefined],
      ['bridgeMaxFee', {}, { bridgeMaxFee: 1.5 }],
      ['maxNetworkFeeBps', {}, { maxNetworkFeeBps: 'abc' }]
    ])('throws a ValueError for a non-integer %s before creating the swap', async (name, overrides, config) => {
      useSwapHandlers()
      const requests = recordRequests(server)

      const account = makeAccount()
      const error = await new TestProtocol(account).swidge({ ...SWIDGE_OPTIONS, ...overrides }, config).catch((err) => err)

      expect(error).toBeInstanceOf(ValueError)
      expect(error.message).toMatch(`'${name}' option must be an integer`)
      expect(requests.some((request) => request.method === 'POST')).toBe(false)
      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test('throws a MaximumFeeExceededError when the Layerswap fee exceeds bridgeMaxFee', async () => {
      useSwapHandlers()

      const account = makeAccount()
      const error = await new TestProtocol(account, { bridgeMaxFee: 100_000n }).swidge(SWIDGE_OPTIONS).catch((err) => err)

      expect(error).toBeInstanceOf(MaximumFeeExceededError)
      expect(error.message).toBe('Exceeded maximum fee cost for bridge operation.')
      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test('lets the per-call bridgeMaxFee override the protocol configuration', async () => {
      useSwapHandlers()

      const protocol = new TestProtocol(makeAccount(), { bridgeMaxFee: 100_000n })

      await expect(protocol.swidge(SWIDGE_OPTIONS, { bridgeMaxFee: 1_000_000n })).resolves.toMatchObject({ id: 'swap-id-1' })
    })

    test('throws a MaximumFeeExceededError when maxProtocolFeeBps is exceeded', async () => {
      useSwapHandlers()

      const account = makeAccount()

      // total_fee 0.5 on 100 USDC = 50 bps
      await expect(new TestProtocol(account).swidge(SWIDGE_OPTIONS, { maxProtocolFeeBps: 49 })).rejects.toThrow(MaximumFeeExceededError)
      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test.each([
      ['no deposit action', { data: { swap: { id: 'swap-id-1' }, deposit_actions: [] } }],
      ['only manual deposit actions', { data: { swap: { id: 'swap-id-1' }, deposit_actions: [{ ...DEPOSIT_ACTION, type: 'manual_transfer' }] } }],
      ['no swap details', { data: { deposit_actions: [DEPOSIT_ACTION] } }]
    ])('throws a ProviderError when Layerswap returns %s', async (_, body) => {
      server.use(layerswapApi.networks(NETWORKS), http.post(`${API_URL}/api/v2/swaps`, () => HttpResponse.json(body)))

      const error = await new TestProtocol(makeAccount()).swidge(SWIDGE_OPTIONS).catch((err) => err)

      expect(error).toBeInstanceOf(ProviderError)
      expect(error.reason).toBe(ProviderErrorReason.INTERNAL_SERVER_ERROR)
    })

    test('wraps unexpected wallet failures in a ProviderError', async () => {
      useSwapHandlers()

      const account = makeAccount()
      account.sendTransaction.mockRejectedValue(new Error('rpc exploded'))

      const error = await new TestProtocol(account).swidge(SWIDGE_OPTIONS).catch((err) => err)

      expect(error).toBeInstanceOf(ProviderError)
      expect(error.message).toMatch('rpc exploded')
    })
  })

  describe('bridge', () => {
    test('maps the swidge result onto the legacy bridge result', async () => {
      useSwapHandlers()

      const result = await new TestProtocol(makeAccount()).bridge(BRIDGE_OPTIONS)

      expect(result).toEqual({ hash: 'deposit-hash', fee: 12_345n, bridgeFee: 500_000n, swapId: 'swap-id-1' })
    })

    test('maps the legacy options (percent slippage, source chain, destination token) onto the swidge options', async () => {
      useSwapHandlers()
      const requests = recordRequests(server)

      await new TestProtocol(makeAccount()).bridge({
        ...BRIDGE_OPTIONS,
        sourceChain: 'SOURCE_MAINNET',
        destinationToken: 'USDC',
        slippage: '0.5',
        referenceId: 'reference-id'
      })

      const createSwap = requests.find((request) => request.method === 'POST' && request.url.endsWith('/api/v2/swaps'))
      expect(await createSwap.json()).toMatchObject({ slippage: '0.5', reference_id: 'reference-id', destination_token: 'USDC' })
    })

    test('masks swidge errors as bridge errors, preserving reason and cause', async () => {
      server.use(
        layerswapApi.networks(NETWORKS),
        layerswapApi.createSwap({ depositActions: [DEPOSIT_ACTION] })
      )

      const account = makeAccount()
      account.sendTransaction.mockRejectedValue(Object.assign(new Error('no funds'), { name: 'TransactionError', reason: 'INSUFFICIENT_BALANCE' }))

      const error = await new TestProtocol(account).bridge(BRIDGE_OPTIONS).catch((err) => err)

      expect(error).toBeInstanceOf(BridgeError)
      expect(error.reason).toBe(SwidgeErrorReason.INSUFFICIENT_BALANCE)
      expect(error.cause).toBeInstanceOf(SwidgeError)
    })

    test('rethrows non-swidge errors as-is', async () => {
      useSwapHandlers()

      await expect(new TestProtocol(makeAccount(), { bridgeMaxFee: 1n }).bridge(BRIDGE_OPTIONS)).rejects.toThrow(MaximumFeeExceededError)
      await expect(new TestProtocol(makeReadOnlyAccount()).bridge(BRIDGE_OPTIONS)).rejects.toThrow(AccountRequiredError)
    })
  })

  describe('quoteBridge', () => {
    test('maps the swidge quote onto the legacy bridge fees', async () => {
      server.use(layerswapApi.networks(NETWORKS), layerswapApi.quote())

      await expect(new TestProtocol(makeAccount()).quoteBridge(BRIDGE_OPTIONS)).resolves.toEqual({ fee: 1_000n, bridgeFee: 500_000n })
    })

    test('masks swidge errors as bridge errors', async () => {
      server.use(layerswapApi.networks(NETWORKS), layerswapApi.quote())

      class FailingQuoteProtocol extends TestProtocol {
        async quoteSwidge () { throw new SwidgeError('slippage', { reason: SwidgeErrorReason.SLIPPAGE_TOO_HIGH }) }
      }

      const error = await new FailingQuoteProtocol(makeAccount()).quoteBridge(BRIDGE_OPTIONS).catch((err) => err)

      expect(error).toBeInstanceOf(BridgeError)
      expect(error.reason).toBe(SwidgeErrorReason.SLIPPAGE_TOO_HIGH)
    })
  })

  describe('swap', () => {
    test('always throws: Layerswap does not support same-chain swaps', async () => {
      server.use(layerswapApi.networks(NETWORKS))

      await expect(new TestProtocol(makeAccount()).swap({ tokenIn: 'USDC', tokenOut: 'NATIVE', tokenInAmount: 1n }))
        .rejects.toThrow(ValueError)
    })
  })

  describe('getSwidgeStatus', () => {
    const SWAP = {
      id: 'swap-id-1',
      status: 'ls_transfer_pending',
      source_network: SOURCE_NETWORK,
      destination_network: DESTINATION_NETWORK,
      transactions: [
        { transaction_hash: '0xinput', type: 'input', status: 'completed', network: SOURCE_NETWORK },
        { transaction_hash: '0xoutput', type: 'output', status: 'initiated', network: DESTINATION_NETWORK }
      ]
    }

    test('maps the Layerswap swap status and transactions to the WDK vocabulary', async () => {
      server.use(layerswapApi.swap(SWAP))

      await expect(new TestProtocol(undefined).getSwidgeStatus('swap-id-1')).resolves.toEqual({
        status: 'pending',
        transactions: [
          { hash: '0xinput', chain: 'SOURCE_MAINNET', type: 'source' },
          { hash: '0xoutput', chain: 'DESTINATION_MAINNET', type: 'destination' }
        ]
      })
    })

    test('accepts chain hints matching the swap (by name or chain id)', async () => {
      server.use(layerswapApi.swap(SWAP))

      await expect(new TestProtocol(undefined).getSwidgeStatus('swap-id-1', { fromChain: 'source_mainnet', toChain: 2 }))
        .resolves.toMatchObject({ status: 'pending' })
    })

    test('throws a NoSuchElementError when the chain hints do not match the swap', async () => {
      server.use(layerswapApi.swap(SWAP))

      const protocol = new TestProtocol(undefined)

      await expect(protocol.getSwidgeStatus('swap-id-1', { fromChain: 'DESTINATION_MAINNET' })).rejects.toThrow(NoSuchElementError)
      await expect(protocol.getSwidgeStatus('swap-id-1', { toChain: 'SOURCE_MAINNET' })).rejects.toThrow(NoSuchElementError)
    })

    test('throws a NoSuchElementError when the swap does not exist', async () => {
      server.use(layerswapApi.error('get', '/api/v2/swaps/:id', 400, 'UNEXPECTED_ERROR', 'Swap missing is not found'))

      await expect(new TestProtocol(undefined).getSwidgeStatus('missing')).rejects.toThrow(NoSuchElementError)
    })

    test('throws a ValueError for an empty id', async () => {
      await expect(new TestProtocol(undefined).getSwidgeStatus('')).rejects.toThrow(ValueError)
    })
  })

  describe('getTransactionStatus', () => {
    test('defaults the network to the detected source network', async () => {
      server.use(layerswapApi.networks(NETWORKS), layerswapApi.transactionStatus('completed'))
      const requests = recordRequests(server)

      await expect(new TestProtocol(makeAccount()).getTransactionStatus('0xaa')).resolves.toEqual({ status: 'completed' })

      const { searchParams } = new URL(requests.at(-1).url)
      expect(searchParams.get('network')).toBe('SOURCE_MAINNET')
      expect(searchParams.get('transaction_id')).toBe('0xaa')
    })

    test('honours the sourceChain override', async () => {
      server.use(layerswapApi.transactionStatus('pending'))
      const requests = recordRequests(server)

      await expect(new TestProtocol(undefined).getTransactionStatus('0xbb', { sourceChain: 'OTHER_MAINNET' }))
        .resolves.toEqual({ status: 'pending' })

      expect(new URL(requests[0].url).searchParams.get('network')).toBe('OTHER_MAINNET')
    })

    test('throws a NoSuchElementError when Layerswap has not indexed the transaction', async () => {
      server.use(layerswapApi.error('get', '/api/v2/transaction_status', 404, 'NOT_FOUND'))

      await expect(new TestProtocol(undefined).getTransactionStatus('0xcc', { sourceChain: 'SOURCE_MAINNET' }))
        .rejects.toThrow(NoSuchElementError)
    })
  })

  describe('discovery', () => {
    test('getSupportedChains maps the network catalog', async () => {
      server.use(layerswapApi.networks(NETWORKS))

      await expect(new TestProtocol(undefined).getSupportedChains()).resolves.toEqual([
        { id: 'SOURCE_MAINNET', name: 'SOURCE_MAINNET', type: 'test', nativeToken: 'NATIVE' },
        { id: 'DESTINATION_MAINNET', name: 'DESTINATION_MAINNET', type: 'test', nativeToken: '' },
        { id: 'OTHER_MAINNET', name: 'OTHER_MAINNET', type: 'other', nativeToken: '' }
      ])
    })

    test('getSupportedTokens flattens and scopes by chain', async () => {
      server.use(layerswapApi.networks(NETWORKS))

      const tokens = await new TestProtocol(undefined).getSupportedTokens({ toChain: 'SOURCE_MAINNET' })

      expect(tokens.map((token) => token.symbol)).toEqual(['USDC', 'NATIVE'])
    })

    test('getSupportedChains surfaces Layerswap failures as ProviderError', async () => {
      server.use(layerswapApi.error('get', '/api/v2/networks', 500))

      await expect(new TestProtocol(undefined).getSupportedChains()).rejects.toThrow(ProviderError)
    })
  })

  describe('source network check', () => {
    test('throws a ValueError, before creating a swap, when fromChain is not the account network', async () => {
      useSwapHandlers()
      const requests = recordRequests(server)
      const account = makeAccount()

      const error = await new TestProtocol(account).swidge({ ...SWIDGE_OPTIONS, fromChain: 'OTHER_MAINNET' }).catch((err) => err)

      expect(error).toBeInstanceOf(ValueError)
      expect(error.message).toBe("The 'fromChain' option is 'OTHER_MAINNET', but the wallet account is connected to 'SOURCE_MAINNET'.")
      expect(requests.some((request) => request.method === 'POST')).toBe(false)
      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test('also guards quotes made with a bound account', async () => {
      server.use(layerswapApi.networks(NETWORKS), layerswapApi.quote())

      await expect(new TestProtocol(makeAccount()).quoteSwidge({ ...SWIDGE_OPTIONS, fromChain: 'OTHER_MAINNET' }))
        .rejects.toThrow(ValueError)
    })

    test('accepts a fromChain that matches the account network', async () => {
      useSwapHandlers()

      await expect(new TestProtocol(makeAccount()).swidge({ ...SWIDGE_OPTIONS, fromChain: 'source_mainnet' }))
        .resolves.toMatchObject({ id: 'swap-id-1' })
    })

    test('is skipped when the account network cannot be detected without a provider', async () => {
      server.use(layerswapApi.networks(NETWORKS), layerswapApi.quote())

      class NoProviderProtocol extends TestProtocol {
        async _detectSourceNetwork () {
          throw new ProviderRequiredError('No provider.')
        }
      }

      await expect(new NoProviderProtocol(makeAccount()).quoteSwidge({ ...SWIDGE_OPTIONS, fromChain: 'OTHER_MAINNET' }))
        .resolves.toMatchObject({ fromTokenAmount: 100_000_000n })
    })
  })

  describe('deposit amount', () => {
    const protocol = new TestProtocol(undefined)

    test.each([
      ['base units', '100000000', undefined, 100_000_000n],
      ['a smaller amount', 99_999_999n, undefined, 99_999_999n],
      ['a decimal number', 100, 6, 100_000_000n],
      ['a tiny decimal number', 1e-7, 8, 10n]
    ])('parses %s', (_, value, decimals, expected) => {
      expect(protocol._parseDepositAmount(value, 100_000_000n, decimals)).toBe(expected)
    })

    test.each([
      ['missing', undefined, undefined],
      ['malformed', 'abc', undefined],
      ['zero', '0', undefined],
      ['zero decimal', 0, 6],
      ['above the requested amount', '100000001', undefined]
    ])('throws a ProviderError when %s', (_, value, decimals) => {
      expect(() => protocol._parseDepositAmount(value, 100_000_000n, decimals)).toThrow(ProviderError)
    })
  })

  describe('abstract hooks', () => {
    test('throw a NotImplementedError when a VM implementation omits them', async () => {
      const protocol = new LayerswapSwidgeProtocol(makeAccount())

      await expect(protocol.getTransactionStatus('0xaa')).rejects.toThrow(NotImplementedError)
      await expect(protocol.swidge(SWIDGE_OPTIONS)).rejects.toThrow(NotImplementedError)
    })
  })
})
