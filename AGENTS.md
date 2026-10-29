# Agent Guide

This repository is a monorepo of WDK Swidge (swap + bridge) modules for the Layerswap protocol. It follows the conventions established by the Tether WDK (Wallet Development Kit) ecosystem — each package extends `SwidgeProtocol` from `@tetherto/wdk-wallet/protocols` (exact-pinned, currently 1.0.0-beta.25) for a specific source-VM family, implementing `quoteSwidge` / `swidge` / `getSwidgeStatus` / `getSupportedChains` / `getSupportedTokens`. The legacy bridge-module surface (`bridge`/`quoteBridge`) is kept as thin adapters over `swidge` for backwards compatibility, and the base class derives `swap`/`quoteSwap` automatically.

## Repository shape

- **pnpm workspaces** under `packages/*` and `apps/*` (see `pnpm-workspace.yaml`). The pinned package manager is recorded in root `package.json#packageManager`.
- `packages/` — publishable protocol packages: `layerswap-core` (chain-agnostic base, shared by all) and one per source-VM family (`layerswap-evm`, `layerswap-solana`, `layerswap-ton`, `layerswap-bitcoin`). Also the private, never-published `layerswap-test-utils` (msw fixtures mocking the Layerswap API, shared by every package's tests).
- `apps/` — private workspace tools. Today: `apps/test-app` (CLI for end-to-end smoke tests). These are `private: true`, never published, and consume `packages/*` via `workspace:*`.
- Each protocol package is independently versioned and published; no lockstep releases.
- Published files are whitelisted via `package.json#files` (`index.js`, `bare.js`, `src/`, `types/`); tests and tooling are never published.

## Why one package per VM family (not master, not per chain)

`SwidgeProtocol` is parameterised by the wallet account class (`WalletAccountEvm`, `WalletAccountSolana`, …). Different VM families have different signing semantics, providers, and transaction shapes, so they cannot share a single class. Within a VM family chains DO share semantics, so a single package covers all of them via the live Layerswap network catalog (`GET /api/v2/networks`). Everything chain-agnostic lives in `packages/layerswap-core`: the `LayerswapSwidgeProtocol` base class (the whole swidge/bridge surface, guards, error contract and shared typedefs), the API client, and the swidge mapping helpers. A VM package is a thin subclass that only implements the base class hooks (source network detection, account detection, deposit build/broadcast, gas quote). **No duplication across packages is accepted** — code, typedefs, exports, docs and tests that can be shared live in core (or `layerswap-test-utils` for test fixtures, `tsconfig.base.json` for build config).

## Tech stack (shared across packages)

- **Language:** JavaScript (ES2015+).
- **Module system:** ES Modules (`"type": "module"`).
- **Type checking:** TypeScript only for `.d.ts` generation from JSDoc (`npm run build:types`).
- **Linting:** `standard`.
- **Testing:** `jest` with `--experimental-vm-modules`.
- **Runtime:** Node.js and Bare (`bare.js` entry point per package).

## Per-package conventions

- Dependencies: `@tetherto/wdk-wallet` and the VM's wallet package(s) are regular `dependencies` pinned to **exact** versions (no ranges, no peer deps) — WDK betas can ship breaking changes.
- Public API: each VM `index.js` exports its default protocol class and VM-specific typedefs, and re-exports the shared public API with `export * from '@layerswap/wdk-protocol-swidge-layerswap-core/protocol'` (WDK and Layerswap types, `LayerswapApiClient`, `LayerswapSwidgeProtocol`, WDK error classes).
- Errors: methods honour the `@throws` contract of `ISwidgeProtocol` (LSP) — only WDK error classes, the exact list documented in each public method's `@throws` tags. Core maps Layerswap API failures (`ProviderError`/`NoSuchElementError`/`ValueError`) and exposes `normalizeWalletError` for wallet-account errors. `bridge`/`quoteBridge` mask `SwidgeError` as `BridgeError`.
- Typedefs: never `@typedef {X & Object}` with `@property` tags (tsc drops the properties). Extend WDK types by intersecting a separate `LayerswapSpecific…` typedef; avoid inline object types.
- Chain clients: reuse the client the wallet account already built (`account._provider`, `account._rpc`, …) instead of rebuilding one from `account._config`, so every provider shape incl. the fail-over provider works.
- Tests mock the Layerswap API with the msw fixtures of `@layerswap/wdk-protocol-swidge-layerswap-test-utils` (`setupLayerswapServer`, `layerswapApi`, `recordRequests`). Shared behaviour is tested once in core; VM tests cover only the VM hooks.

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
- WDK swidge `slippage` is a decimal (0.01 = 1%); the Layerswap API takes a percent string ('1'). `formatSlippage` in core converts. The legacy `LayerswapBridgeOptions.slippage` remains a percent string and is divided by 100 in the `_toSwidgeOptions` adapters.
- Swidge status derivation (core `deriveSwidgeStatus`) is **transaction-first**: a completed output (payout) transaction → 'completed', a refund transaction → 'refunded'/'refund-pending', an in-flight output → 'pending' — the swap-level status is only the fallback, because Layerswap's swap status can lag the on-chain payout. Fallback mapping (`mapSwapStatus`): `user_transfer_pending` → 'action-required', `ls_transfer_pending` → 'pending', `pending_refund` → 'refund-pending', terminal states map 1:1, unknown → 'pending'.
- `fromChain` never overrides the account's chain: when the bound account has a provider, core checks that `fromChain` names the network it is connected to (`_assertAccountNetwork`) and throws `ValueError` otherwise — a Layerswap swap must never be created for one chain while its deposit is broadcast on another. Deposits are only built from validated Layerswap data: a missing or malformed `call_data` reference throws a `ProviderError`, and deposit amounts go through `_parseDepositAmount` (positive, never above `fromTokenAmount`).
- `getSwidgeStatus(id, options)`: the WDK `SwidgeStatusOptions` chain hints (`fromChain`/`toChain`) constrain the lookup — a swap whose source/destination network doesn't match (name or chain id, case-insensitive) throws `NoSuchElementError`.
- Legacy surface: `BridgeResult.bridgeFee` is in **source-token base units**, not native wei (= the sum of `included` swidge fees). `LayerswapProtocolConfig.bridgeMaxFee` is compared against that sum only. Do not naively sum `fee + bridgeFee` — they are in different units.
