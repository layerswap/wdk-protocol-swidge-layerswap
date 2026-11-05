export { default } from "./src/layerswap-protocol-solana.js";
export * from "@layerswap/wdk-protocol-swidge-layerswap-core/protocol";
export type WalletAccountSolana = import("@tetherto/wdk-wallet-solana").WalletAccountSolana;
export type WalletAccountReadOnlySolana = import("@tetherto/wdk-wallet-solana").WalletAccountReadOnlySolana;
export type SolanaTransactionMessage = import("@solana/kit").BaseTransactionMessage;
export type LayerswapSolanaPreparedDeposit = import("./src/layerswap-protocol-solana.js").LayerswapSolanaPreparedDeposit;
