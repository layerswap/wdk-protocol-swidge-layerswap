// Copyright 2026 Aren <aren@bransfer.io>
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict'

import { afterAll, afterEach, beforeAll } from '@jest/globals'

import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

export { http, HttpResponse }

/** The default Layerswap API base url. */
export const API_URL = 'https://api.layerswap.io'

/** A Layerswap quote: 100 source tokens in, 0.4 service fee + 0.1 network fee. */
export const DEFAULT_QUOTE = Object.freeze({
  total_fee: 0.5,
  receive_amount: 99.5,
  min_receive_amount: 99,
  total_fee_in_usd: 0.5,
  blockchain_fee: 0.1,
  service_fee: 0.4
})

/**
 * Creates an msw server for the calling test file and wires its lifecycle into jest:
 * unhandled requests fail the test, and handlers / listeners are reset after each test.
 *
 * @returns {import('msw/node').SetupServerApi} The msw server.
 */
export function setupLayerswapServer () {
  const server = setupServer()

  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

  afterEach(() => {
    server.resetHandlers()
    server.events.removeAllListeners()
  })

  afterAll(() => server.close())

  return server
}

/**
 * Records every request that reaches the server (cloned, so bodies can be read).
 *
 * @param {import('msw/node').SetupServerApi} server - The msw server.
 * @returns {Request[]} The live list of recorded requests.
 */
export function recordRequests (server) {
  const requests = []
  server.events.on('request:start', ({ request }) => { requests.push(request.clone()) })
  return requests
}

/**
 * Request handlers mocking the Layerswap v2 API.
 */
export const layerswapApi = {
  /**
   * `GET /api/v2/networks`.
   *
   * @param {Object[]} networks - The network catalog.
   */
  networks: (networks) => http.get(`${API_URL}/api/v2/networks`, () =>
    HttpResponse.json({ data: networks })),

  /**
   * `GET /api/v2/quote`.
   *
   * @param {Object} [overrides] - Fields overriding the `DEFAULT_QUOTE`.
   */
  quote: (overrides = {}) => http.get(`${API_URL}/api/v2/quote`, () =>
    HttpResponse.json({ data: { quote: { ...DEFAULT_QUOTE, ...overrides } } })),

  /**
   * `POST /api/v2/swaps`.
   *
   * @param {Object} options
   * @param {Object[]} options.depositActions - The deposit actions of the created swap.
   * @param {string} [options.swapId] - The created swap's id.
   * @param {Object} [options.quote] - The locked-in quote. Default: a 0.5 total fee.
   */
  createSwap: ({ depositActions, swapId = 'swap-id-1', quote = { total_fee: 0.5 } }) => http.post(`${API_URL}/api/v2/swaps`, () =>
    HttpResponse.json({
      data: {
        swap: { id: swapId, status: 'user_transfer_pending' },
        quote: { quote },
        deposit_actions: depositActions
      }
    })),

  /**
   * `POST /api/v2/swaps/{id}/deposit_speedup`.
   *
   * @param {number} [status] - The response status. Default: 200.
   */
  speedup: (status = 200) => http.post(`${API_URL}/api/v2/swaps/:id/deposit_speedup`, () =>
    status >= 200 && status < 300
      ? HttpResponse.json({ data: null })
      : HttpResponse.json({ error: { code: 'SPEEDUP_FAILED', message: 'boom' } }, { status })),

  /**
   * `GET /api/v2/swaps/{id}`.
   *
   * @param {Object} swap - The swap (its `id` is matched against the path).
   */
  swap: (swap) => http.get(`${API_URL}/api/v2/swaps/${swap.id}`, () =>
    HttpResponse.json({ data: { swap } })),

  /**
   * `GET /api/v2/transaction_status`.
   *
   * @param {string} [status] - The transaction status. Default: 'completed'.
   */
  transactionStatus: (status = 'completed') => http.get(`${API_URL}/api/v2/transaction_status`, () =>
    HttpResponse.json({ data: { status } })),

  /**
   * The Layerswap requests of a swidge: the network catalog, the swap creation and the
   * deposit speedup notification.
   *
   * @param {Object} options
   * @param {Object[]} options.networks - The network catalog.
   * @param {Object[]} options.depositActions - The deposit actions of the created swap.
   * @param {string} [options.swapId] - The created swap's id.
   * @param {Object} [options.quote] - The locked-in quote.
   * @param {number} [options.speedupStatus] - The speedup response status. Default: 200.
   * @returns {import('msw').HttpHandler[]} The request handlers.
   */
  swidgeFlow: ({ networks, depositActions, swapId, quote, speedupStatus }) => [
    layerswapApi.networks(networks),
    layerswapApi.createSwap({ depositActions, swapId, quote }),
    layerswapApi.speedup(speedupStatus)
  ],

  /**
   * A Layerswap error envelope.
   *
   * @param {'get' | 'post'} method - The request method.
   * @param {string} path - The request path (e.g. `/api/v2/quote`).
   * @param {number} status - The response status.
   * @param {string} [code] - The Layerswap error code.
   * @param {string} [message] - The Layerswap error message.
   */
  error: (method, path, status, code = 'ERROR', message = 'boom') => http[method](`${API_URL}${path}`, () =>
    HttpResponse.json({ error: { code, message } }, { status }))
}
