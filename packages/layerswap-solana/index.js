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

/** @typedef {import('@tetherto/wdk-wallet-solana').WalletAccountSolana} WalletAccountSolana */
/** @typedef {import('@tetherto/wdk-wallet-solana').WalletAccountReadOnlySolana} WalletAccountReadOnlySolana */

/** @typedef {import('@solana/kit').BaseTransactionMessage} SolanaTransactionMessage */

/** @typedef {import('./src/layerswap-protocol-solana.js').LayerswapSolanaPreparedDeposit} LayerswapSolanaPreparedDeposit */

export { default } from './src/layerswap-protocol-solana.js'

export * from '@layerswap/wdk-protocol-swidge-layerswap-core/protocol'
