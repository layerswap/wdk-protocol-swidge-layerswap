export type WalletAccountTon = import('@tetherto/wdk-wallet-ton').WalletAccountTon;
export type WalletAccountReadOnlyTon = import('@tetherto/wdk-wallet-ton').WalletAccountReadOnlyTon;
export type Cell = import('@ton/ton').Cell;
export type LayerswapTonDepositMessage = import('./src/layerswap-protocol-ton.js').LayerswapTonDepositMessage;
export type LayerswapTonPreparedDeposit = import('./src/layerswap-protocol-ton.js').LayerswapTonPreparedDeposit;
/** @typedef {import('@tetherto/wdk-wallet-ton').WalletAccountTon} WalletAccountTon */
/** @typedef {import('@tetherto/wdk-wallet-ton').WalletAccountReadOnlyTon} WalletAccountReadOnlyTon */
/** @typedef {import('@ton/ton').Cell} Cell */
/** @typedef {import('./src/layerswap-protocol-ton.js').LayerswapTonDepositMessage} LayerswapTonDepositMessage */
/** @typedef {import('./src/layerswap-protocol-ton.js').LayerswapTonPreparedDeposit} LayerswapTonPreparedDeposit */
export { default } from './src/layerswap-protocol-ton.js';
export * from '@layerswap/wdk-protocol-swidge-layerswap-core/protocol';
