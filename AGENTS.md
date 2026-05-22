# Agent Guide

This repository is a monorepo of WDK bridge modules for the Layerswap protocol. It follows the conventions established by the Tether WDK (Wallet Development Kit) ecosystem — each package implements `BridgeProtocol` from `@tetherto/wdk-wallet/protocols` for a specific source-VM family.

## Repository shape

- **pnpm workspaces** under `packages/*` and `apps/*` (see `pnpm-workspace.yaml`). The pinned package manager is recorded in root `package.json#packageManager`.
- `packages/` — publishable protocol packages. One per source-VM family. Today: `packages/layerswap-evm`. Sibling packages (`layerswap-solana`, `layerswap-tron`, `layerswap-ton`) follow the same shape when added.
- `apps/` — private workspace tools. Today: `apps/test-app` (CLI for end-to-end smoke tests). These are `private: true`, never published, and consume `packages/*` via `workspace:*`.
- Each protocol package is independently versioned and published; no lockstep releases.

## Why one package per VM family (not master, not per chain)

`BridgeProtocol` is parameterised by the wallet account class (`WalletAccountEvm`, `WalletAccountSolana`, …). Different VM families have different signing semantics, providers, and transaction shapes, so they cannot share a single class. Within a VM family chains DO share semantics, so a single package covers all of them via the live Layerswap network catalog (`GET /api/v2/networks`).

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

Per-package: `pnpm --filter @layerswap/wdk-protocol-bridge-layerswap-evm run <script>` (or the short form `pnpm -F layerswap-evm run <script>`).

## Semantic notes (Layerswap-specific)

- `BridgeResult.bridgeFee` is in **source-token base units**, not native wei. Layerswap deducts its fee from the bridged amount instead of charging native gas. The WDK base type documents it as native — this divergence is intentional and called out in each package's JSDoc and README.
- `LayerswapProtocolConfig.bridgeMaxFee` is compared against `bridgeFee` only.
- Do not naively sum `fee + bridgeFee` — they are in different units.
