# Agent Guide

This repository is a monorepo of WDK Swidge (swap + bridge) modules for the Layerswap protocol. It follows the conventions established by the Tether WDK (Wallet Development Kit) ecosystem — each package extends `SwidgeProtocol` from `@tetherto/wdk-wallet/protocols` (>= 1.0.0-beta.17) for a specific source-VM family, implementing `quoteSwidge` / `swidge` / `getSwidgeStatus` / `getSupportedChains` / `getSupportedTokens`. The legacy bridge-module surface (`bridge`/`quoteBridge`) is kept as thin adapters over `swidge` for backwards compatibility, and the base class derives `swap`/`quoteSwap` automatically.

## Repository shape

- **pnpm workspaces** under `packages/*` and `apps/*` (see `pnpm-workspace.yaml`). The pinned package manager is recorded in root `package.json#packageManager`.
- `packages/` — publishable protocol packages. One per source-VM family. Today: `packages/layerswap-evm`. Sibling packages (`layerswap-solana`, `layerswap-tron`, `layerswap-ton`) follow the same shape when added.
- `apps/` — private workspace tools. Today: `apps/test-app` (CLI for end-to-end smoke tests). These are `private: true`, never published, and consume `packages/*` via `workspace:*`.
- Each protocol package is independently versioned and published; no lockstep releases.

## Why one package per VM family (not master, not per chain)

`SwidgeProtocol` is parameterised by the wallet account class (`WalletAccountEvm`, `WalletAccountSolana`, …). Different VM families have different signing semantics, providers, and transaction shapes, so they cannot share a single class. Within a VM family chains DO share semantics, so a single package covers all of them via the live Layerswap network catalog (`GET /api/v2/networks`). Chain-agnostic swidge mapping (status vocabulary, fee itemisation, chain/token discovery, slippage conversion, fee-bps guards) lives in `packages/layerswap-core/src/swidge.js` and is shared by every VM package.

## Tech stack (shared across packages)

- **Language:** JavaScript (ES2015+).
- **Module system:** ES Modules (`"type": "module"`).
- **Type checking:** TypeScript only for `.d.ts` generation from JSDoc (`npm run build:types`).
- **Linting:** `standard`.
- **Testing:** `jest` with `--experimental-vm-modules`.
- **Runtime:** Node.js and Bare (`bare.js` entry point per package).

## Per-package conventions

- File naming: kebab-case (`layerswap-protocol-evm.js`).
- Class naming: PascalCase (`LayerswapProtocolEvm`).
- Private members: `_` prefix, `@private` JSDoc.
- Imports: explicit `.js` extensions.
- Copyright: Apache 2.0 header on every source file.
- JSDoc: `@typedef`, `@param`, `@returns`, `@throws` on every public method. Stick to JSDoc forms so `tsc --declaration` emits clean types.

## Workspace commands (run from repo root)

```bash
pnpm install             # installs + symlinks workspaces
pnpm run lint            # standard, all packages
pnpm test                # jest, all packages
pnpm run build:types     # tsc, all packages
```

Per-package: `pnpm --filter @layerswap/wdk-protocol-swidge-layerswap-evm run <script>` (or the short form `pnpm -F layerswap-evm run <script>`).

## Semantic notes (Layerswap-specific)

- Swidge fee entries are itemised per `SwidgeFee`: Layerswap's service fee ('protocol') and its destination network fee ('network') are deducted from the source amount, denominated in the **source token**, and flagged `included: true`; source-chain gas is a separate non-included 'network' fee in the **native token**. Never sum amounts across fee entries with different `token` values.
- Layerswap supports **exact-in only** (`fromTokenAmount`); passing `toTokenAmount` (exact-out) throws. Same-chain swaps are not supported: `toChain` is required and must differ from the source network, so the inherited `swap()` (same-chain by definition) always throws.
- WDK swidge `slippage` is a decimal (0.01 = 1%); the Layerswap API takes a percent string ('1'). `formatSlippage` in core converts. The legacy `BridgeOptions.slippage` remains a percent string and is divided by 100 in the `_toSwidgeOptions` adapters.
- Swidge status derivation (core `deriveSwidgeStatus`) is **transaction-first**: a completed output (payout) transaction → 'completed', a refund transaction → 'refunded'/'refund-pending', an in-flight output → 'pending' — the swap-level status is only the fallback, because Layerswap's swap status can lag the on-chain payout. Fallback mapping (`mapSwapStatus`): `user_transfer_pending` → 'action-required', `ls_transfer_pending` → 'pending', `pending_refund` → 'refund-pending', terminal states map 1:1, unknown → 'pending'.
- Legacy surface: `BridgeResult.bridgeFee` is in **source-token base units**, not native wei (= the sum of `included` swidge fees). `LayerswapProtocolConfig.bridgeMaxFee` is compared against that sum only. Do not naively sum `fee + bridgeFee` — they are in different units.
