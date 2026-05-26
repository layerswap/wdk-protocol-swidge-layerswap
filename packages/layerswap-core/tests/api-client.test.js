import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'

import LayerswapApiClient from '../src/layerswap-api-client.js'

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

describe('LayerswapApiClient.getTransactionStatus', () => {
  let originalFetch
  beforeEach(() => { originalFetch = global.fetch })
  afterEach(() => { global.fetch = originalFetch })

  test('GETs /api/v2/transaction_status with network + transaction_id query params and returns the data envelope', async () => {
    const router = buildFetchRouter([{
      method: 'GET',
      match: /^\/api\/v2\/transaction_status\?/,
      status: 200,
      body: (url) => {
        const u = new URL(url)
        return {
          data: {
            status: 'completed',
            _echo: { network: u.searchParams.get('network'), transaction_id: u.searchParams.get('transaction_id') }
          }
        }
      }
    }])
    global.fetch = router

    const client = new LayerswapApiClient()
    const result = await client.getTransactionStatus('ETHEREUM_MAINNET', '0xabc')

    expect(result.status).toBe('completed')
    expect(result._echo).toEqual({ network: 'ETHEREUM_MAINNET', transaction_id: '0xabc' })
    expect(router).toHaveBeenCalledTimes(1)
  })

  test('URL-encodes network + transaction_id (slashes, plus signs)', async () => {
    let observedSearch = ''
    global.fetch = buildFetchRouter([{
      method: 'GET',
      match: /^\/api\/v2\/transaction_status\?/,
      status: 200,
      body: (url) => {
        observedSearch = new URL(url).search
        return { data: { status: 'pending' } }
      }
    }])

    const client = new LayerswapApiClient()
    await client.getTransactionStatus('SOLANA_MAINNET', '5xy/+abc')

    expect(observedSearch).toContain('network=SOLANA_MAINNET')
    expect(observedSearch).toContain('transaction_id=5xy%2F%2Babc')
  })

  test('surfaces NOT_FOUND with the Layerswap error code attached', async () => {
    global.fetch = buildFetchRouter([{
      method: 'GET',
      match: /^\/api\/v2\/transaction_status\?/,
      status: 404,
      body: () => ({ error: { code: 'NOT_FOUND', message: 'Failed to retrieve transaction' } })
    }])

    const client = new LayerswapApiClient()

    await expect(client.getTransactionStatus('TRON_MAINNET', 'badtxid'))
      .rejects.toThrow(/NOT_FOUND.*Failed to retrieve transaction/)
  })
})
