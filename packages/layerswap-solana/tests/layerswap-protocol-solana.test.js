// Tests of the Solana specifics only: source cluster detection, account detection, gas
// quotes, the deposit transaction and rpc error mapping. The chain-agnostic swidge behaviour
// (quotes, guards, status, bridge adapters, discovery, …) is covered once by the
// `LayerswapSwidgeProtocol` tests in `@layerswap/wdk-protocol-swidge-layerswap-core`.

import { describe, expect, test } from '@jest/globals'

import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js'

import { WalletAccountReadOnlySolana, WalletAccountSolana } from '@tetherto/wdk-wallet-solana'

import {
  http,
  HttpResponse,
  layerswapApi,
  setupLayerswapServer
} from '@layerswap/wdk-protocol-swidge-layerswap-test-utils'

import LayerswapProtocolSolana, {
  AccountRequiredError,
  DisposalError,
  ProviderError,
  ProviderRequiredError,
  ValueError
} from '../index.js'

const RPC_URL = 'https://rpc.fake.solana.local/'
const FALLBACK_RPC_URL = 'https://rpc-fallback.fake.solana.local/'

const SEED_PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

const EVM_RECIPIENT = '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd'

const SOLANA_MAINNET = {
  name: 'SOLANA_MAINNET',
  chain_id: '',
  type: 'solana',
  tokens: [
    { symbol: 'SOL', contract: null, decimals: 9 },
    { symbol: 'USDC', contract: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 }
  ]
}

const SOLANA_DEVNET = { ...SOLANA_MAINNET, name: 'SOLANA_DEVNET', chain_id: '103' }

const ARBITRUM_MAINNET = {
  name: 'ARBITRUM_MAINNET',
  chain_id: '42161',
  type: 'evm',
  tokens: [{ symbol: 'USDC', contract: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', decimals: 6 }]
}

const NETWORKS = [SOLANA_MAINNET, SOLANA_DEVNET, ARBITRUM_MAINNET]

const SOLANA_MAINNET_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'

// Layerswap's deposit account on Solana (placeholder).
const DEPOSIT_PUBKEY = new PublicKey('11111111111111111111111111111112')

const BLOCKHASH = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N'

// The blockhash returned by the mocked rpc's getLatestBlockhash; replaces Layerswap's.
const FRESH_BLOCKHASH = '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY'

// A valid base58 64-byte signature, returned by the mocked rpc's sendTransaction.
const TX_SIGNATURE = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW'

const server = setupLayerswapServer()

/**
 * Mocks the Solana JSON-RPC endpoint the wallet account talks to. Every received rpc call
 * is pushed to `calls` as `{ method, params }`.
 */
function rpcHandler ({ url = RPC_URL, genesisHash = SOLANA_MAINNET_GENESIS_HASH, fee = 5000, sendError, calls = [] } = {}) {
  return http.post(url, async ({ request }) => {
    const { id, method, params } = await request.json()
    calls.push({ method, params })

    switch (method) {
      case 'getGenesisHash':
        return HttpResponse.json({ jsonrpc: '2.0', id, result: genesisHash })
      case 'getLatestBlockhash':
        return HttpResponse.json({ jsonrpc: '2.0', id, result: { context: { slot: 1 }, value: { blockhash: FRESH_BLOCKHASH, lastValidBlockHeight: 1000 } } })
      case 'getFeeForMessage':
        return HttpResponse.json({ jsonrpc: '2.0', id, result: { context: { slot: 1 }, value: fee } })
      case 'sendTransaction':
        return sendError
          ? HttpResponse.json({ jsonrpc: '2.0', id, error: sendError })
          : HttpResponse.json({ jsonrpc: '2.0', id, result: TX_SIGNATURE })
      default:
        return HttpResponse.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unmocked rpc method: ${method}` } })
    }
  })
}

/**
 * Builds a real serialised legacy Solana Transaction (a System Program transfer), then
 * base64-encodes it the way Layerswap delivers it in `deposit_actions[].call_data`.
 */
function makeLayerswapCallData (from, { withSignatureSlots = false } = {}) {
  const tx = new Transaction()
  tx.feePayer = new PublicKey(from)
  tx.recentBlockhash = BLOCKHASH
  tx.add(SystemProgram.transfer({ fromPubkey: tx.feePayer, toPubkey: DEPOSIT_PUBKEY, lamports: 10_000 }))

  if (withSignatureSlots) {
    const wire = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
    return Buffer.from(wire).toString('base64')
  }

  // Layerswap's shape: a zero signature count followed by the message (the caller signs).
  return Buffer.concat([Buffer.from([0]), tx.serializeMessage()]).toString('base64')
}

const depositAction = (callData) => ({
  type: 'transfer',
  order: 0,
  to_address: DEPOSIT_PUBKEY.toBase58(),
  amount: 10,
  amount_in_base_units: '10000000',
  call_data: callData
})

const useSwapHandlers = (callData, rpcOptions = {}) => server.use(
  ...layerswapApi.swidgeFlow({ networks: NETWORKS, depositActions: [depositAction(callData)] }),
  rpcHandler(rpcOptions)
)

async function makeAccount (config = { provider: RPC_URL }) {
  const account = new WalletAccountSolana(SEED_PHRASE, "0'/0'", config)
  const address = await account.getAddress()
  return { account, address }
}

const SWIDGE_OPTIONS = {
  fromToken: 'USDC',
  toChain: 'ARBITRUM_MAINNET',
  recipient: EVM_RECIPIENT,
  fromTokenAmount: 10_000_000n
}

describe('LayerswapProtocolSolana', () => {
  describe('source cluster detection', () => {
    test.each([
      ['mainnet', SOLANA_MAINNET_GENESIS_HASH, 'SOLANA_MAINNET'],
      ['devnet', DEVNET_GENESIS_HASH, 'SOLANA_DEVNET']
    ])('maps the %s genesis hash reported by the account rpc to %s', async (_, genesisHash, name) => {
      server.use(layerswapApi.networks(NETWORKS), rpcHandler({ genesisHash }))

      const { account } = await makeAccount()

      await expect(new LayerswapProtocolSolana(account)._detectSourceNetwork()).resolves.toMatchObject({ name })
    })

    test('reuses the fail-over rpc the account built from a list of rpc urls', async () => {
      server.use(layerswapApi.networks(NETWORKS), rpcHandler({ genesisHash: DEVNET_GENESIS_HASH }))

      const { account } = await makeAccount({ provider: [RPC_URL, FALLBACK_RPC_URL] })
      const protocol = new LayerswapProtocolSolana(account)

      expect(protocol._rpc).toBe(account._rpc)
      await expect(protocol._detectSourceNetwork()).resolves.toMatchObject({ name: 'SOLANA_DEVNET' })
    })

    test('caches the detected network across calls', async () => {
      const calls = []
      server.use(layerswapApi.networks(NETWORKS), rpcHandler({ calls }))

      const { account } = await makeAccount()
      const protocol = new LayerswapProtocolSolana(account)
      await protocol._detectSourceNetwork()
      await protocol._detectSourceNetwork()

      expect(calls.filter((c) => c.method === 'getGenesisHash')).toHaveLength(1)
    })

    test('defaults getTransactionStatus to the detected cluster', async () => {
      server.use(layerswapApi.networks(NETWORKS), rpcHandler({ genesisHash: DEVNET_GENESIS_HASH }), layerswapApi.transactionStatus('completed'))

      const { account } = await makeAccount()

      await expect(new LayerswapProtocolSolana(account).getTransactionStatus(TX_SIGNATURE)).resolves.toEqual({ status: 'completed' })
    })

    test('throws a ValueError on an unknown genesis hash, with an actionable message', async () => {
      server.use(layerswapApi.networks(NETWORKS), rpcHandler({ genesisHash: 'totally-unknown-hash' }))

      const { account } = await makeAccount()
      const error = await new LayerswapProtocolSolana(account).quoteSwidge(SWIDGE_OPTIONS).catch((err) => err)

      expect(error).toBeInstanceOf(ValueError)
      expect(error.message).toMatch(/Unknown Solana genesis hash.*fromChain/)
    })

    test.each([
      ['a different known cluster', SOLANA_MAINNET_GENESIS_HASH, 'SOLANA_DEVNET', "connected to 'SOLANA_MAINNET'"],
      ['an unknown svm cluster', 'totally-unknown-hash', 'SOLANA_MAINNET', 'connected to \'an unknown svm cluster\'']
    ])('throws a ValueError, without sending, when fromChain is not the rpc cluster (%s)', async (_, genesisHash, fromChain, message) => {
      const calls = []
      const { account, address } = await makeAccount()
      useSwapHandlers(makeLayerswapCallData(address), { genesisHash, calls })

      const error = await new LayerswapProtocolSolana(account).swidge({ ...SWIDGE_OPTIONS, fromChain }).catch((err) => err)

      expect(error).toBeInstanceOf(ValueError)
      expect(error.message).toContain(message)
      expect(calls.some((c) => c.method === 'sendTransaction')).toBe(false)
    })

    test('lets fromChain name another svm chain when the rpc cluster is not a known Solana cluster', async () => {
      const ECLIPSE_MAINNET = { ...SOLANA_MAINNET, name: 'ECLIPSE_MAINNET' }
      server.use(layerswapApi.networks([...NETWORKS, ECLIPSE_MAINNET]), layerswapApi.quote(), rpcHandler({ genesisHash: 'eclipse-genesis-hash' }))

      const { account } = await makeAccount()

      await expect(new LayerswapProtocolSolana(account).quoteSwidge({ ...SWIDGE_OPTIONS, fromChain: 'ECLIPSE_MAINNET' }))
        .resolves.toMatchObject({ fromTokenAmount: 10_000_000n })
    })

    test('throws a ProviderError when the rpc fails', async () => {
      server.use(layerswapApi.networks(NETWORKS), http.post(RPC_URL, () => HttpResponse.json({}, { status: 500 })))

      const { account } = await makeAccount()

      await expect(new LayerswapProtocolSolana(account).quoteSwidge(SWIDGE_OPTIONS)).rejects.toThrow(ProviderError)
    })

    test('throws a ProviderRequiredError without rpc and without fromChain', async () => {
      server.use(layerswapApi.networks(NETWORKS))

      const { account } = await makeAccount({})

      await expect(new LayerswapProtocolSolana(account).quoteSwidge(SWIDGE_OPTIONS)).rejects.toThrow(ProviderRequiredError)
    })
  })

  describe('gas quote', () => {
    test('approximates the source-chain fee with the per-signature fee', async () => {
      server.use(layerswapApi.networks(NETWORKS), layerswapApi.quote(), rpcHandler())

      const { account } = await makeAccount()
      const quote = await new LayerswapProtocolSolana(account).quoteSwidge(SWIDGE_OPTIONS)

      expect(quote.fees.at(-1)).toEqual({ type: 'network', amount: 5000n, token: 'SOL', chain: 'SOLANA_MAINNET', included: false, description: 'Source-chain gas' })
    })
  })

  describe('deposit transaction', () => {
    test('signs the call_data through the wallet account, broadcasts it, and reports the quoted fee', async () => {
      const calls = []
      const { account, address } = await makeAccount()
      useSwapHandlers(makeLayerswapCallData(address), { fee: 7000, calls })

      const result = await new LayerswapProtocolSolana(account).swidge(SWIDGE_OPTIONS)

      expect(result).toMatchObject({ id: 'swap-id-1', hash: TX_SIGNATURE })
      expect(result.transactions).toEqual([{ hash: TX_SIGNATURE, chain: 'SOLANA_MAINNET', type: 'source' }])
      expect(result.fees.at(-1)).toMatchObject({ type: 'network', amount: 7000n, token: 'SOL', included: false })

      const send = calls.find((c) => c.method === 'sendTransaction')
      expect(send.params[1]).toMatchObject({ encoding: 'base64' })

      const broadcast = Transaction.from(Buffer.from(send.params[0], 'base64'))
      expect(broadcast.feePayer.toBase58()).toBe(address)
      expect(broadcast.recentBlockhash).toBe(FRESH_BLOCKHASH)
      expect(broadcast.verifySignatures()).toBe(true)
    })

    test('rejects call_data whose fee payer is not the account', async () => {
      const calls = []
      const { account } = await makeAccount()
      useSwapHandlers(makeLayerswapCallData(DEPOSIT_PUBKEY.toBase58()), { calls })

      await expect(new LayerswapProtocolSolana(account).swidge(SWIDGE_OPTIONS)).rejects.toThrow()
      expect(calls.some((c) => c.method === 'sendTransaction')).toBe(false)
    })

    test('also accepts call_data that already carries empty signature slots', async () => {
      const calls = []
      const { account, address } = await makeAccount()
      useSwapHandlers(makeLayerswapCallData(address, { withSignatureSlots: true }), { calls })

      await new LayerswapProtocolSolana(account).swidge(SWIDGE_OPTIONS)

      const send = calls.find((c) => c.method === 'sendTransaction')
      expect(Transaction.from(Buffer.from(send.params[0], 'base64')).verifySignatures()).toBe(true)
    })

    test('bridge: maps the broadcast deposit onto the legacy bridge result', async () => {
      const { account, address } = await makeAccount()
      useSwapHandlers(makeLayerswapCallData(address))

      const result = await new LayerswapProtocolSolana(account).bridge({
        targetChain: 'ARBITRUM_MAINNET',
        recipient: EVM_RECIPIENT,
        token: 'USDC',
        amount: 10_000_000n
      })

      expect(result).toEqual({ hash: TX_SIGNATURE, fee: 5000n, bridgeFee: 500_000n, swapId: 'swap-id-1' })
    })

    test.each([
      ['missing', ''],
      ['not base64', 'not base64!'],
      ['not a decodable transaction', 'AAAA']
    ])('throws a ProviderError when call_data is %s', async (_, callData) => {
      const calls = []
      const { account } = await makeAccount()
      useSwapHandlers(callData, { calls })

      await expect(new LayerswapProtocolSolana(account).swidge(SWIDGE_OPTIONS)).rejects.toThrow(ProviderError)
      expect(calls.some((c) => c.method === 'sendTransaction')).toBe(false)
    })

    test('wraps rpc broadcast failures in a ProviderError', async () => {
      const { account, address } = await makeAccount()
      useSwapHandlers(makeLayerswapCallData(address), {
        sendError: { code: -32002, message: 'Transaction simulation failed: Blockhash not found' }
      })

      await expect(new LayerswapProtocolSolana(account).swidge(SWIDGE_OPTIONS)).rejects.toThrow(ProviderError)
    })

    test('throws a ProviderRequiredError when the account has no rpc, even with fromChain', async () => {
      server.use(layerswapApi.networks(NETWORKS))

      const { account } = await makeAccount({})

      await expect(new LayerswapProtocolSolana(account).swidge({ ...SWIDGE_OPTIONS, fromChain: 'SOLANA_MAINNET' }))
        .rejects.toThrow(ProviderRequiredError)
    })
  })

  describe('accounts', () => {
    test('throws an AccountRequiredError for read-only solana accounts', async () => {
      const { address } = await makeAccount()
      const account = new WalletAccountReadOnlySolana(address, { provider: RPC_URL })

      await expect(new LayerswapProtocolSolana(account).swidge(SWIDGE_OPTIONS)).rejects.toThrow(AccountRequiredError)
    })

    test('throws a DisposalError once the account has been disposed (private key erased)', async () => {
      const { account } = await makeAccount()
      account.dispose()

      expect(account.keyPair.privateKey).toBeNull()
      await expect(new LayerswapProtocolSolana(account).swidge(SWIDGE_OPTIONS)).rejects.toThrow(DisposalError)
    })
  })
})
