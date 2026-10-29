export type WalletAccountSolana = import('@tetherto/wdk-wallet-solana').WalletAccountSolana;
export type WalletAccountReadOnlySolana = import('@tetherto/wdk-wallet-solana').WalletAccountReadOnlySolana;
export type SolanaTransactionMessage = import('@solana/kit').BaseTransactionMessage;
export type LayerswapSolanaPreparedDeposit = import('./src/layerswap-protocol-solana.js').LayerswapSolanaPreparedDeposit;
/** @typedef {import('@tetherto/wdk-wallet-solana').WalletAccountSolana} WalletAccountSolana */
/** @typedef {import('@tetherto/wdk-wallet-solana').WalletAccountReadOnlySolana} WalletAccountReadOnlySolana */
/** @typedef {import('@solana/kit').BaseTransactionMessage} SolanaTransactionMessage */
/** @typedef {import('./src/layerswap-protocol-solana.js').LayerswapSolanaPreparedDeposit} LayerswapSolanaPreparedDeposit */
export { default } from './src/layerswap-protocol-solana.js';
export * from '@layerswap/wdk-protocol-swidge-layerswap-core/protocol';
