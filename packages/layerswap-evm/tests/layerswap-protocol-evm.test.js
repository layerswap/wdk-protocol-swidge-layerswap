// Tests of the EVM specifics only: source chain detection, account detection, gas quotes,
// the deposit transaction and wallet error mapping. The chain-agnostic swidge behaviour
// (quotes, guards, status, bridge adapters, discovery, …) is covered once by the
// `LayerswapSwidgeProtocol` tests in `@layerswap/wdk-protocol-swidge-layerswap-core`.

import { describe, expect, jest, test } from '@jest/globals'

import { WalletAccountEvm, WalletAccountReadOnlyEvm } from '@tetherto/wdk-wallet-evm'
import { WalletAccountEvmErc4337 } from '@tetherto/wdk-wallet-evm-erc-4337'

import { JsonRpcProvider, makeError } from 'ethers'

import {
  http,
  HttpResponse,
  layerswapApi,
  recordRequests,
  setupLayerswapServer
} from '@layerswap/wdk-protocol-swidge-layerswap-test-utils'

import LayerswapProtocolEvm, {
  AccountRequiredError,
  BridgeError,
  DisposalError,
  ProviderError,
  ProviderRequiredError,
  SwidgeError,
  SwidgeErrorReason,
  ValueError
} from '../index.js'

const RPC_URL = 'https://rpc.example/eth'

const SEED_PHRASE = 'test test test test test test test test test test test junk'

const USER_ADDRESS = '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd'
const DEPOSIT_ADDRESS = '0x1111111111111111111111111111111111111111'
const USDC_CONTRACT = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const ERC20_CALLDATA = '0xa9059cbb000000000000000000000000111111111111111111111111111111111111111100000000000000000000000000000000000000000000000000000000000186a0'

const ETHEREUM_NETWORK = {
  name: 'ethereum',
  chain_id: '1',
  type: 'evm',
  tokens: [
    { symbol: 'USDC', contract: USDC_CONTRACT, decimals: 6 },
    { symbol: 'ETH', contract: null, decimals: 18 }
  ]
}

const ARBITRUM_NETWORK = {
  name: 'arbitrum',
  chain_id: '42161',
  type: 'evm',
  tokens: [
    { symbol: 'USDC', contract: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', decimals: 6 },
    { symbol: 'ETH', contract: null, decimals: 18 }
  ]
}

const NETWORKS = [ETHEREUM_NETWORK, ARBITRUM_NETWORK]

const depositAction = ({ isErc20 = true } = {}) => ({
  type: 'transfer',
  order: 1,
  to_address: DEPOSIT_ADDRESS,
  amount: 100,
  amount_in_base_units: isErc20 ? '100000000' : '100000000000000000',
  call_data: isErc20 ? ERC20_CALLDATA : '0x'
})

const server = setupLayerswapServer()

const useSwapHandlers = (action = depositAction()) =>
  server.use(...layerswapApi.swidgeFlow({ networks: NETWORKS, depositActions: [action] }))

/** Mocks the JSON-RPC endpoint of an rpc-url provider. */
const rpcHandler = (chainIdHex = '0x1') => http.post(RPC_URL, async ({ request }) => {
  const payload = await request.json()
  const reply = ({ id, method }) => ({ jsonrpc: '2.0', id, result: method === 'eth_chainId' ? chainIdHex : '0x1' })
  return HttpResponse.json(Array.isArray(payload) ? payload.map(reply) : reply(payload))
})

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

/**
 * Builds a duck-typed wallet account. The provider is built exactly like the real
 * wdk evm wallet does (`account._provider`), so every provider shape is exercised.
 */
function makeAccount ({ provider = makeEip1193Provider(), kind = 'standard' } = {}) {
  const config = provider ? { provider } : {}

  const account = {
    _config: config,
    _provider: WalletAccountReadOnlyEvm._buildProvider(config),
    keyPair: { publicKey: new Uint8Array(33), privateKey: new Uint8Array(32) },
    getAddress: jest.fn().mockResolvedValue(USER_ADDRESS),
    quoteSendTransaction: jest.fn().mockResolvedValue({ fee: 12_345n }),
    quoteTransfer: jest.fn().mockResolvedValue({ fee: 67_890n }),
    sendTransaction: jest.fn().mockResolvedValue({ hash: 'dummy-hash', fee: 12_345n })
  }

  Object.setPrototypeOf(account, kind === 'erc4337' ? WalletAccountEvmErc4337.prototype : WalletAccountEvm.prototype)
  return account
}

const SWIDGE_OPTIONS = {
  fromToken: USDC_CONTRACT,
  toChain: 'arbitrum',
  recipient: USER_ADDRESS,
  fromTokenAmount: 100_000_000n
}

describe('LayerswapProtocolEvm', () => {
  describe('source chain detection', () => {
    test.each([
      ['an eip-1193 provider', () => makeEip1193Provider({ chainIdHex: '0xa4b1' })],
      ['an rpc url', () => RPC_URL],
      ['an ethers provider', () => new JsonRpcProvider(RPC_URL)],
      ['a fail-over list of providers', () => [RPC_URL, makeEip1193Provider({ chainIdHex: '0xa4b1' })]]
    ])('detects the source chain through the account provider built from %s', async (_, buildProvider) => {
      server.use(layerswapApi.networks(NETWORKS), layerswapApi.quote(), rpcHandler('0xa4b1'))

      const protocol = new LayerswapProtocolEvm(makeAccount({ provider: buildProvider() }))

      const quote = await protocol.quoteSwidge({ fromToken: 'USDC', toChain: 'ethereum', fromTokenAmount: 100_000_000n })

      expect(quote.fees[0].chain).toBe('arbitrum')
    })

    test('throws a ProviderRequiredError when the account has no provider and fromChain is omitted', async () => {
      server.use(layerswapApi.networks(NETWORKS))

      await expect(new LayerswapProtocolEvm(makeAccount({ provider: null })).quoteSwidge(SWIDGE_OPTIONS))
        .rejects.toThrow(ProviderRequiredError)
    })

    test('throws a ValueError, without sending, when fromChain is not the provider chain', async () => {
      useSwapHandlers()

      const account = makeAccount()

      await expect(new LayerswapProtocolEvm(account).swidge({ ...SWIDGE_OPTIONS, fromToken: 'USDC', fromChain: 'arbitrum', toChain: 'ethereum' }))
        .rejects.toThrow("The 'fromChain' option is 'arbitrum', but the wallet account is connected to 'ethereum'.")
      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test('throws a ValueError when the chain id is not in the Layerswap networks', async () => {
      server.use(layerswapApi.networks(NETWORKS))

      const account = makeAccount({ provider: makeEip1193Provider({ chainIdHex: '0xdeadbeef' }) })

      const error = await new LayerswapProtocolEvm(account).quoteSwidge(SWIDGE_OPTIONS).catch((err) => err)

      expect(error).toBeInstanceOf(ValueError)
      expect(error.message).toMatch(/does not support source chain/)
    })
  })

  describe('gas quote', () => {
    test('quotes an erc-20 transfer for erc-20 sources', async () => {
      server.use(layerswapApi.networks(NETWORKS), layerswapApi.quote())

      const account = makeAccount()
      const quote = await new LayerswapProtocolEvm(account).quoteSwidge(SWIDGE_OPTIONS)

      expect(account.quoteTransfer).toHaveBeenCalledWith({ token: USDC_CONTRACT, recipient: USER_ADDRESS, amount: 100_000_000n })
      expect(account.quoteSendTransaction).not.toHaveBeenCalled()
      expect(quote.fees.at(-1)).toEqual({ type: 'network', amount: 67_890n, token: 'ETH', chain: 'ethereum', included: false, description: 'Source-chain gas' })
    })

    test('quotes a native send for native sources', async () => {
      server.use(layerswapApi.networks(NETWORKS), layerswapApi.quote())

      const account = makeAccount()
      const quote = await new LayerswapProtocolEvm(account).quoteSwidge({ ...SWIDGE_OPTIONS, fromToken: 'ETH', fromTokenAmount: 10n ** 18n })

      expect(account.quoteSendTransaction).toHaveBeenCalledWith({ to: USER_ADDRESS, value: 10n ** 18n })
      expect(account.quoteTransfer).not.toHaveBeenCalled()
      expect(quote.fees.at(-1).amount).toBe(12_345n)
    })
  })

  describe('deposit transaction', () => {
    test('erc-20: sends the Layerswap calldata with value=0, and quotes its gas', async () => {
      useSwapHandlers(depositAction({ isErc20: true }))

      const account = makeAccount()
      const result = await new LayerswapProtocolEvm(account).swidge(SWIDGE_OPTIONS)

      const expectedTx = { to: DEPOSIT_ADDRESS, value: 0n, data: ERC20_CALLDATA }
      expect(account.quoteSendTransaction).toHaveBeenCalledWith(expectedTx)
      expect(account.sendTransaction).toHaveBeenCalledWith(expectedTx)
      expect(result).toMatchObject({ id: 'swap-id-1', hash: 'dummy-hash' })
      expect(result.fees.at(-1)).toMatchObject({ type: 'network', amount: 12_345n, token: 'ETH', included: false })
    })

    test('native: sends amount_in_base_units as value, with empty calldata', async () => {
      useSwapHandlers(depositAction({ isErc20: false }))

      const account = makeAccount()
      await new LayerswapProtocolEvm(account).swidge({ ...SWIDGE_OPTIONS, fromToken: 'ETH', fromTokenAmount: 10n ** 17n })

      expect(account.sendTransaction).toHaveBeenCalledWith({ to: DEPOSIT_ADDRESS, value: 10n ** 17n, data: '0x' })
    })

    test.each([
      ['missing', undefined],
      ['above the requested amount', '100000000000000001']
    ])('native: throws a ProviderError, without sending, when amount_in_base_units is %s', async (_, amount) => {
      useSwapHandlers({ ...depositAction({ isErc20: false }), amount_in_base_units: amount })

      const account = makeAccount()
      await expect(new LayerswapProtocolEvm(account).swidge({ ...SWIDGE_OPTIONS, fromToken: 'ETH', fromTokenAmount: 10n ** 17n }))
        .rejects.toThrow(ProviderError)
      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test('erc-4337: routes through the array form, forwarding the wallet configuration overrides', async () => {
      useSwapHandlers()

      const account = makeAccount({ kind: 'erc4337' })
      const overrides = { paymasterToken: { address: '0xfeeee' } }

      await new LayerswapProtocolEvm(account).bridge({ targetChain: 'arbitrum', recipient: USER_ADDRESS, token: USDC_CONTRACT, amount: 100_000_000n }, overrides)

      const expectedTx = { to: DEPOSIT_ADDRESS, value: 0n, data: ERC20_CALLDATA }
      expect(account.quoteSendTransaction).toHaveBeenCalledWith([expectedTx], overrides)
      expect(account.sendTransaction).toHaveBeenCalledWith([expectedTx], overrides)
    })

    test('throws a ProviderError when the deposit action has no destination address', async () => {
      useSwapHandlers({ ...depositAction(), to_address: undefined })

      await expect(new LayerswapProtocolEvm(makeAccount()).swidge(SWIDGE_OPTIONS)).rejects.toThrow(ProviderError)
    })
  })

  describe('accounts', () => {
    test('throws an AccountRequiredError for read-only evm accounts', async () => {
      const account = new WalletAccountReadOnlyEvm(USER_ADDRESS, { provider: makeEip1193Provider() })

      await expect(new LayerswapProtocolEvm(account).swidge(SWIDGE_OPTIONS)).rejects.toThrow(AccountRequiredError)
    })

    test('throws a DisposalError, without creating a swap, once the account has been disposed', async () => {
      useSwapHandlers()
      const requests = recordRequests(server)

      const account = new WalletAccountEvm(SEED_PHRASE, "0'/0/0", { provider: makeEip1193Provider() })
      account.dispose()

      await expect(new LayerswapProtocolEvm(account).swidge(SWIDGE_OPTIONS)).rejects.toThrow(DisposalError)
      expect(requests).toHaveLength(0)
    })
  })

  describe('wallet errors', () => {
    test('maps insufficient-funds rejections of the node to a SwidgeError (INSUFFICIENT_BALANCE)', async () => {
      useSwapHandlers()

      const account = makeAccount()
      account.sendTransaction.mockRejectedValue(makeError('insufficient funds for gas * price + value', 'INSUFFICIENT_FUNDS'))

      const error = await new LayerswapProtocolEvm(account).swidge(SWIDGE_OPTIONS).catch((err) => err)

      expect(error).toBeInstanceOf(SwidgeError)
      expect(error.reason).toBe(SwidgeErrorReason.INSUFFICIENT_BALANCE)
    })

    test('surfaces them as a BridgeError through the legacy bridge surface', async () => {
      useSwapHandlers()

      const account = makeAccount()
      account.sendTransaction.mockRejectedValue(makeError('insufficient funds for gas * price + value', 'INSUFFICIENT_FUNDS'))

      const error = await new LayerswapProtocolEvm(account).bridge({ targetChain: 'arbitrum', recipient: USER_ADDRESS, token: USDC_CONTRACT, amount: 100_000_000n }).catch((err) => err)

      expect(error).toBeInstanceOf(BridgeError)
      expect(error.reason).toBe(SwidgeErrorReason.INSUFFICIENT_BALANCE)
    })

    test('wraps other wallet failures in a ProviderError', async () => {
      useSwapHandlers()

      const account = makeAccount()
      account.quoteSendTransaction.mockRejectedValue(new Error('bundler unavailable'))

      await expect(new LayerswapProtocolEvm(account).swidge(SWIDGE_OPTIONS)).rejects.toThrow(ProviderError)
    })
  })
})
