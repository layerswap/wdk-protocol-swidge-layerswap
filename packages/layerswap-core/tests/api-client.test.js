import { describe, expect, test } from '@jest/globals'

import { ProviderErrorReason } from '@tetherto/wdk-wallet'
import { NoSuchElementError, ProviderError, ValueError } from '@tetherto/wdk-wallet/protocols'

import { API_URL, http, HttpResponse, setupLayerswapServer } from '@layerswap/wdk-protocol-swidge-layerswap-test-utils'

import LayerswapApiClient from '../src/layerswap-api-client.js'

const server = setupLayerswapServer()

describe('LayerswapApiClient', () => {
  describe('headers', () => {
    test('sends X-LS-APIKEY only when an api key is configured', async () => {
      const apiKeys = []
      server.use(http.get(`${API_URL}/api/v2/networks`, ({ request }) => {
        apiKeys.push(request.headers.get('X-LS-APIKEY'))
        return HttpResponse.json({ data: [] })
      }))

      await new LayerswapApiClient().getNetworks()
      await new LayerswapApiClient({ apiKey: 'my-key' }).getNetworks()

      expect(apiKeys).toEqual([null, 'my-key'])
    })

    test('honours a custom apiUrl', async () => {
      server.use(http.get('https://staging.layerswap.test/api/v2/networks', () =>
        HttpResponse.json({ data: [{ name: 'STAGING' }] })))

      const client = new LayerswapApiClient({ apiUrl: 'https://staging.layerswap.test/' })

      await expect(client.getNetworks()).resolves.toEqual([{ name: 'STAGING' }])
    })
  })

  describe('getNetworks', () => {
    test('caches the network catalog for the lifetime of the client', async () => {
      let calls = 0
      server.use(http.get(`${API_URL}/api/v2/networks`, () => {
        calls++
        return HttpResponse.json({ data: [] })
      }))

      const client = new LayerswapApiClient()
      await client.getNetworks()
      await client.getNetworks()

      expect(calls).toBe(1)
    })

    test('does not cache a failed request', async () => {
      server.use(
        http.get(`${API_URL}/api/v2/networks`, () => HttpResponse.json({}, { status: 500 }), { once: true }),
        http.get(`${API_URL}/api/v2/networks`, () => HttpResponse.json({ data: [] }))
      )

      const client = new LayerswapApiClient()

      await expect(client.getNetworks()).rejects.toThrow(ProviderError)
      await expect(client.getNetworks()).resolves.toEqual([])
    })
  })

  describe('getTransactionStatus', () => {
    test('GETs /api/v2/transaction_status with network + transaction_id query params and returns the data envelope', async () => {
      let observed
      server.use(http.get(`${API_URL}/api/v2/transaction_status`, ({ request }) => {
        observed = new URL(request.url).searchParams
        return HttpResponse.json({ data: { status: 'completed' } })
      }))

      const client = new LayerswapApiClient()
      const result = await client.getTransactionStatus('ETHEREUM_MAINNET', '0xabc')

      expect(result).toEqual({ status: 'completed' })
      expect(observed.get('network')).toBe('ETHEREUM_MAINNET')
      expect(observed.get('transaction_id')).toBe('0xabc')
    })

    test('URL-encodes network + transaction_id (slashes, plus signs)', async () => {
      let observedSearch = ''
      server.use(http.get(`${API_URL}/api/v2/transaction_status`, ({ request }) => {
        observedSearch = new URL(request.url).search
        return HttpResponse.json({ data: { status: 'pending' } })
      }))

      const client = new LayerswapApiClient()
      await client.getTransactionStatus('SOLANA_MAINNET', '5xy/+abc')

      expect(observedSearch).toContain('network=SOLANA_MAINNET')
      expect(observedSearch).toContain('transaction_id=5xy%2F%2Babc')
    })

    test('throws a NoSuchElementError carrying the Layerswap error code on NOT_FOUND', async () => {
      server.use(http.get(`${API_URL}/api/v2/transaction_status`, () =>
        HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Failed to retrieve transaction' } }, { status: 404 })))

      const client = new LayerswapApiClient()
      const error = await client.getTransactionStatus('TRON_MAINNET', 'badtxid').catch((err) => err)

      expect(error).toBeInstanceOf(NoSuchElementError)
      expect(error.message).toMatch(/NOT_FOUND.*Failed to retrieve transaction/)
      expect(error.code).toBe('NOT_FOUND')
      expect(error.status).toBe(404)
    })
  })

  describe('createSwap', () => {
    test('POSTs the JSON body with a correlation id header', async () => {
      let body
      let correlationId
      server.use(http.post(`${API_URL}/api/v2/swaps`, async ({ request }) => {
        body = await request.json()
        correlationId = request.headers.get('X-LS-CORRELATION-ID')
        return HttpResponse.json({ data: { swap: { id: 'swap-1' } } })
      }))

      const client = new LayerswapApiClient()
      const response = await client.createSwap({ source_network: 'ETHEREUM_MAINNET', amount: '1' })

      expect(response).toEqual({ swap: { id: 'swap-1' } })
      expect(body).toEqual({ source_network: 'ETHEREUM_MAINNET', amount: '1' })
      expect(correlationId).toEqual(expect.any(String))
    })

    test('throws a ValueError when Layerswap rejects the request parameters', async () => {
      server.use(http.post(`${API_URL}/api/v2/swaps`, () =>
        HttpResponse.json({ error: { code: 'INVALID_AMOUNT', message: 'Amount too low' } }, { status: 400 })))

      const error = await new LayerswapApiClient().createSwap({}).catch((err) => err)

      expect(error).toBeInstanceOf(ValueError)
      expect(error.code).toBe('INVALID_AMOUNT')
    })

    test('treats a 404 as a ValueError (the referenced route does not exist)', async () => {
      server.use(http.post(`${API_URL}/api/v2/swaps`, () =>
        HttpResponse.json({ error: { code: 'ROUTE_NOT_FOUND', message: 'No route' } }, { status: 404 })))

      await expect(new LayerswapApiClient().createSwap({})).rejects.toThrow(ValueError)
    })
  })

  describe('getSwap', () => {
    test('throws a NoSuchElementError when the swap does not exist', async () => {
      server.use(http.get(`${API_URL}/api/v2/swaps/:id`, () =>
        HttpResponse.json({ error: { code: 'SWAP_NOT_FOUND', message: 'Swap not found' } }, { status: 404 })))

      await expect(new LayerswapApiClient().getSwap('missing')).rejects.toThrow(NoSuchElementError)
    })

    test('throws a NoSuchElementError for the 400 "is not found" response Layerswap returns for unknown swaps', async () => {
      server.use(http.get(`${API_URL}/api/v2/swaps/:id`, ({ params }) =>
        HttpResponse.json({ error: { code: 'UNEXPECTED_ERROR', message: `Swap ${params.id} is not found` } }, { status: 400 })))

      const error = await new LayerswapApiClient().getSwap('missing').catch((err) => err)

      expect(error).toBeInstanceOf(NoSuchElementError)
      expect(error.code).toBe('UNEXPECTED_ERROR')
    })
  })

  describe('provider errors', () => {
    test.each([
      [401, ProviderErrorReason.UNAUTHORIZED],
      [403, ProviderErrorReason.FORBIDDEN],
      [429, ProviderErrorReason.NETWORK_ERROR],
      [504, ProviderErrorReason.REQUEST_TIMEOUT],
      [500, ProviderErrorReason.INTERNAL_SERVER_ERROR],
      [503, ProviderErrorReason.INTERNAL_SERVER_ERROR]
    ])('maps HTTP %i to a ProviderError with reason %s', async (status, reason) => {
      server.use(http.get(`${API_URL}/api/v2/networks`, () =>
        HttpResponse.json({ error: { code: 'ERR', message: 'boom' } }, { status })))

      const error = await new LayerswapApiClient().getNetworks().catch((err) => err)

      expect(error).toBeInstanceOf(ProviderError)
      expect(error.reason).toBe(reason)
      expect(error.status).toBe(status)
    })

    test('maps a 4xx response to the parameterless network catalog to a ProviderError', async () => {
      server.use(http.get(`${API_URL}/api/v2/networks`, () =>
        HttpResponse.json({ error: { code: 'BAD_REQUEST', message: 'boom' } }, { status: 400 })))

      const error = await new LayerswapApiClient().getNetworks().catch((err) => err)

      expect(error).toBeInstanceOf(ProviderError)
      expect(error.reason).toBe(ProviderErrorReason.INTERNAL_SERVER_ERROR)
      expect(error.status).toBe(400)
    })

    test('maps a rate-limited request to a ProviderError even when it carries caller input', async () => {
      server.use(http.post(`${API_URL}/api/v2/swaps`, () =>
        HttpResponse.json({ error: { code: 'TOO_MANY_REQUESTS', message: 'slow down' } }, { status: 429 })))

      const error = await new LayerswapApiClient().createSwap({}).catch((err) => err)

      expect(error).toBeInstanceOf(ProviderError)
      expect(error.reason).toBe(ProviderErrorReason.NETWORK_ERROR)
    })

    test('maps a network failure to a ProviderError with reason NETWORK_ERROR', async () => {
      server.use(http.get(`${API_URL}/api/v2/networks`, () => HttpResponse.error()))

      const error = await new LayerswapApiClient().getNetworks().catch((err) => err)

      expect(error).toBeInstanceOf(ProviderError)
      expect(error.reason).toBe(ProviderErrorReason.NETWORK_ERROR)
    })

    test('maps a timeout to a ProviderError with reason REQUEST_TIMEOUT', async () => {
      server.use(http.get(`${API_URL}/api/v2/networks`, () => new Promise(() => {})))

      const error = await new LayerswapApiClient({ requestTimeoutMs: 20 }).getNetworks().catch((err) => err)

      expect(error).toBeInstanceOf(ProviderError)
      expect(error.reason).toBe(ProviderErrorReason.REQUEST_TIMEOUT)
    })

    test('maps a non-JSON body to a ProviderError', async () => {
      server.use(http.get(`${API_URL}/api/v2/networks`, () => HttpResponse.text('<html>oops</html>')))

      const error = await new LayerswapApiClient().getNetworks().catch((err) => err)

      expect(error).toBeInstanceOf(ProviderError)
      expect(error.message).toMatch(/non-JSON body/)
    })
  })
})
