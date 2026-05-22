# Handoff: Layerswap WDK — multi-VM implementation plan

This document is the entry point for an agent (or engineer) picking up the work to add Layerswap support for non-EVM source chains. Read it end-to-end before touching any code.

## Brief for the next agent

**What exists today:**
- pnpm monorepo at this repo root (`packages/*` for publishable, `apps/*` for private tools).
- One published-shaped package: `packages/layerswap-evm/` implementing `BridgeProtocol` from `@tetherto/wdk-wallet/protocols` for EVM source chains.
- One workspace test app: `apps/test-app/` driving the protocol via `workspace:*` against a real Layerswap endpoint.
- Layerswap's flow is **HTTP-orchestrated, deposit-address pattern**: `POST /api/v2/swaps` → broadcast deposit on source chain → Layerswap delivers off-chain.

**Why one package per source-VM family (not one master, not one per chain):**
- `BridgeProtocol` is parameterised by the wallet account class. EVM, Solana, Tron, TON each have different `WalletAccount*` classes (different signing semantics, providers, tx shapes). One protocol class can't serve all.
- Within a VM family, all chains share semantics → one package + Layerswap's live `GET /api/v2/networks` catalog handles every chain that VM family supports.
- WDK naming convention: `wdk-protocol-bridge-<protocol>-<source-vm-family>`. Don't break it.

**Reference patterns to read before writing anything:**
- `packages/layerswap-evm/src/layerswap-protocol-evm.js` — the canonical shape.
- `packages/layerswap-evm/src/layerswap-api-client.js` — chain-agnostic HTTP wrapper.
- `packages/layerswap-evm/src/networks.js` — chain-agnostic resolution + decimal helpers.
- `/Users/arentant/Documents/wdk-protocol-bridge-usdt0-evm/src/usdt0-protocol-evm.js` — the WDK reference for ERC-4337 branching and tone.
- `AGENTS.md` (root) — conventions: kebab-case files, PascalCase classes, ESM, `.js` extensions, Apache header, JSDoc-only types.

**Pitfalls already paid for (don't re-pay them):**
1. **`instanceof` across npm package boundaries breaks with duplicate copies.** Always consume protocol packages from the test app via `workspace:*`, never `file:` or `link:`. The test app moved into `apps/test-app/` exactly to dodge this.
2. **ESM only, JSDoc for types.** TypeScript is invoked solely for `.d.ts` emission via `tsc --emitDeclarationOnly`. Source stays `.js`. Imports use explicit `.js` extensions.
3. **`bridgeFee` semantics diverge from `@tetherto/wdk-wallet`.** WDK base type says "native tokens paid to the bridge protocol"; Layerswap deducts its fee from the bridged amount instead, so `bridgeFee` is in **source-token base units**. Document this in JSDoc on every new package; do not try to "normalize" it.
4. **`bridgeMaxFee` compares against `bridgeFee` only** (not `fee + bridgeFee`). Keep this consistent.
5. **Layerswap's chain-id field type varies** by VM: EVM gives numeric strings (`'1'`, `'42161'`), Solana gives cluster names (`'mainnet-beta'`), Bitcoin/TON use their own. `resolveSourceNetwork` already does string-equality, so the helper is fine — each VM package just needs to produce the right "chain id" string for its provider.

---

## Phase 0 — Extract `layerswap-core` (do this first, before any new VM)

The `LayerswapApiClient` and most of `networks.js` are 100% chain-agnostic and will be duplicated verbatim across every VM package if left in `layerswap-evm`. Extract them now while there's only one consumer — easier than retro-fitting later.

**Steps:**
1. Create `packages/layerswap-core/` mirroring layerswap-evm's skeleton (`package.json`, `index.js`, `bare.js`, `src/`, `tests/`, `tsconfig.json`, `AGENTS.md`, README).
2. Move into `packages/layerswap-core/src/`:
   - `layerswap-api-client.js` (unchanged)
   - `networks.js` → split: keep chain-agnostic helpers (`resolveNetworkByName`, `resolveToken`, `formatBaseUnits`, `parseDecimal`) in core. `resolveSourceNetwork(client, chainId)` is also chain-agnostic (it's just string-equal on `network.chain_id`) — keep here too.
3. `packages/layerswap-core/index.js` re-exports `LayerswapApiClient` (default + named) and the helpers.
4. Name: `@layerswap/wdk-protocol-bridge-layerswap-core`. **Mark `private: false`** — it WILL be a runtime dep of every sibling.
5. Update `packages/layerswap-evm/package.json` to depend on `"@layerswap/wdk-protocol-bridge-layerswap-core": "workspace:*"`.
6. Update `packages/layerswap-evm/src/layerswap-protocol-evm.js` imports to pull from `@layerswap/wdk-protocol-bridge-layerswap-core` instead of `./layerswap-api-client.js` and `./networks.js`.
7. `pnpm install` → `pnpm test` → `pnpm run build:types` should all stay green.

**Acceptance:** 17/17 EVM tests still pass; `layerswap-evm/src/` shrinks to just `layerswap-protocol-evm.js` (+ any EVM-specific helpers).

---

## Phase 1 — `layerswap-solana` (first non-EVM sibling)

**Why Solana first:** highest Layerswap volume after EVM; mature WDK wallet (`@tetherto/wdk-wallet-solana`); the cleanest contrast to EVM (no contracts, no ERC-20s).

**Scaffold:**
```
packages/layerswap-solana/
├── package.json     # name: @layerswap/wdk-protocol-bridge-layerswap-solana
├── index.js
├── bare.js
├── tsconfig.json
├── src/
│   └── layerswap-protocol-solana.js
└── tests/
    └── layerswap-protocol-solana.test.js
```

**Dependencies:**
- `@layerswap/wdk-protocol-bridge-layerswap-core: workspace:*`
- `@tetherto/wdk-wallet: 1.0.0-beta.8`
- `@tetherto/wdk-wallet-solana: <latest beta>`  ← verify version against the monorepo at runtime
- `@solana/web3.js: <whatever wdk-wallet-solana pins>`
- `bare-node-runtime: ^1.1.4`

**What changes vs EVM (the agent must research/decide for each line):**

| Concern | EVM today | Solana approach |
| --- | --- | --- |
| Wallet account type for `instanceof` | `WalletAccountEvm` / `WalletAccountEvmErc4337` | `WalletAccountSolana` (no ERC-4337 analogue → drop the branch) |
| Provider | `ethers.JsonRpcProvider` / `BrowserProvider` | `@solana/web3.js` `Connection` |
| Chain-id detection | `provider.getNetwork()` → bigint | `connection.getGenesisHash()` → string; map to Layerswap's `chain_id` (often `'mainnet-beta'` / `'devnet'`) |
| Deposit tx shape | `{ to, value, data }` | `Transaction` or `VersionedTransaction` from `@solana/web3.js`. The Layerswap API's `deposit_actions[].call_data` for Solana returns base58 or base64 serialised tx; check the response shape against live `POST /api/v2/swaps` |
| ERC-20 vs native split | `sourceToken.contract` truthy = ERC-20 | SPL mint vs SOL: `sourceToken.contract` is the mint address (or null for SOL). Different account.sendTransaction shape |
| `quoteTransfer` analogue | exists on `WalletAccountEvm` | check `WalletAccountSolana`'s surface — may need `quoteSendTransaction` only |

**Critical research before coding:** call Layerswap's `POST /api/v2/swaps` with a Solana source in a curl one-liner. Inspect `deposit_actions[0]`:
- Is `call_data` base58, base64, hex-prefixed, or null?
- Is `to_address` an account public key?
- For SPL tokens, is the deposit a SPL `transferChecked` instruction or a System Program transfer?

Do not guess. The EVM package's mock test data is incomplete for non-EVM flows.

**Test strategy:** mirror `packages/layerswap-evm/tests/layerswap-protocol-evm.test.js`:
- Mock `global.fetch` for the Layerswap API.
- Mock the Solana `Connection` (don't make real RPC calls).
- Use `Object.setPrototypeOf(mockAccount, WalletAccountSolana.prototype)` for `instanceof` to pass.

**Acceptance:** unit tests pass; `apps/test-app/` can be re-pointed at the Solana package to do a live testnet swap (Sepolia ETH → Solana devnet USDC or similar).

---

## Phase 2 — Tron, TON, Bitcoin

Each follows the Phase-1 template. **Do one at a time**, full test coverage each, never two in flight at once.

**Tron** (`packages/layerswap-tron/`):
- Wallet: `@tetherto/wdk-wallet-tron`
- Provider: `TronWeb` instance
- Chain-id: TronWeb genesis hash or `getChainParameters` → map to Layerswap's `tron-mainnet` / `tron-shasta`
- Deposit tx: TRC-20 `transfer` or native TRX send; Layerswap's `call_data` will be hex-encoded TVM calldata
- Address format: base58 Tron addresses (recipient stays native, do NOT addressToBytes32 it like USDT0 does for on-chain bridges — Layerswap is HTTP)

**TON** (`packages/layerswap-ton/`):
- Wallet: `@tetherto/wdk-wallet-ton`
- Provider: `@ton/ton` `TonClient`
- Chain-id: TON doesn't have a chain id in the EVM sense — Layerswap's `chain_id` is likely `'-239'` (mainnet) / `'-3'` (testnet) (verify against `GET /api/v2/networks`)
- Deposit tx: jetton transfer or native TON message
- Recipient format: friendly base64url, e.g. `EQAbc...`

**Bitcoin** (`packages/layerswap-bitcoin/`):
- Wallet: `@tetherto/wdk-wallet-bitcoin`
- Provider: BIP32 / Electrum-like
- Chain-id: `'mainnet'` / `'testnet'` / `'signet'`
- Deposit tx: P2WPKH / Taproot send to Layerswap's deposit address; no `call_data`
- BRC-20 / Runes likely out of scope for v1

**Optional later:** Starknet, Cosmos, Sui — same template if a WDK wallet package exists.

---

## Phase 3 — CI matrix

The current `.github/workflows/build.yml` runs `pnpm test` over all workspaces — already correct for multi-package. Two additions when packages multiply:

1. Add a `matrix.package` axis if you want per-package failure granularity in the PR view.
2. Add a per-package `publish.yml` keyed on tags (`layerswap-evm-v*`, `layerswap-solana-v*`, etc.) running `pnpm -F <package> publish --access public`. **Do not lockstep-version** — each package ships when ready.

---

## Phase 4 — Publishing

Once a sibling package is tested in the test-app against a real Layerswap endpoint and ships a clean test suite:

1. `pnpm -F @layerswap/wdk-protocol-bridge-layerswap-<vm> publish --access public --no-git-checks` (after npm auth).
2. pnpm rewrites `workspace:*` to a real version range automatically at pack time — verify the published tarball with `npm pack --dry-run` from inside the workspace package before publishing.
3. Apps + sibling workspace packages keep `workspace:*` in their `package.json` source; the rewrite only happens at publish.

---

## Per-VM cheatsheet (start here when picking up a new VM)

| Concern | Where to look |
| --- | --- |
| Wallet account class + instance methods | `node_modules/@tetherto/wdk-wallet-<vm>/index.js` + `src/wallet-account-*.js` |
| What `sendTransaction()` expects | the wallet account's JSDoc — shape varies per VM |
| Layerswap network names & `chain_id` field | `curl https://api.layerswap.io/api/v2/networks \| jq '.data[] \| select(.type=="<vm>")'` |
| Deposit action shape | `curl -X POST https://api-dev.layerswap.cloud/api/v2/swaps -d '{...with that VM as source...}'` and inspect `deposit_actions` |

---

## Verification checklist (every new package must pass)

- [ ] Unit tests with all wallet account types mocked via `Object.setPrototypeOf` to pass `instanceof`.
- [ ] `pnpm run lint` clean (`standard`).
- [ ] `pnpm run build:types` emits `types/` without errors.
- [ ] `bridgeMaxFee` comparison covered by a unit test.
- [ ] `bridgeFee` unit divergence noted in JSDoc on `bridge()` and `quoteBridge()`.
- [ ] `apps/test-app` updated with a CLI flag or env var to choose the VM, then a live testnet swap reaches `completed` status.
- [ ] No dependency on `layerswap-evm` — every sibling depends on `layerswap-core` only.

---

## Gotchas tracking list (carry forward; add to it)

1. **Never use `file:` or `link:` for protocol packages.** Workspace consumers must use `workspace:*`. External consumers will use the published npm version (registry hoisting dedupes). The instanceof + duplicate-copy issue is real and silent.
2. **The `instanceof WalletAccountX` check must use the *same* class that the wallet manager constructs from.** When mocking in tests, set the mock's prototype to that class's prototype.
3. **Don't re-implement HTTP / chain catalog logic per package.** Always go through `@layerswap/wdk-protocol-bridge-layerswap-core`.
4. **`source_address` is meaningful to Layerswap** (allowlist / routing). Never pass `undefined`. Throw if `account.getAddress()` fails rather than silently degrading.
5. **Layerswap's `deposit_actions` may contain multiple actions** for non-EOA flows. The current EVM code picks `type: 'transfer'` first. Each new VM should pick the wallet-driven action explicitly and surface a clear error if it's missing.
6. **TypeScript-only constructs in JSDoc break `tsc --emitDeclarationOnly`.** Stick to `@typedef`, `@param`, `@returns`, `@template`. No `as`, no `satisfies`, no JSX in comments.
7. **Bare runtime compatibility.** `bare.js` is the entry; avoid Node-only APIs in `src/` (no `fs`, no `crypto.randomUUID()` without globalThis fallback). The existing `LayerswapApiClient` already handles this for `randomUUID`.
8. **`bridgeFee` precision.** `parseDecimal` truncates beyond `decimals`. For low-decimal tokens (BTC's 8, some chain natives <18) this is fine but a smoke test per VM is worth it.

---

## Recommended sequencing (concrete)

1. **PR 1**: Extract `layerswap-core` (Phase 0). Small, low risk, unblocks everything.
2. **PR 2**: Add `layerswap-solana`, including `apps/test-app` Solana command. ~1-2 days.
3. **PR 3**: `layerswap-tron`. Faster — pattern is set.
4. **PR 4**: `layerswap-ton`.
5. **PR 5**: `layerswap-bitcoin` (if there's demand).
6. **PR 6**: CI matrix split + first npm publishes.

The new agent should read this doc, then `apps/test-app/src/cli.mjs` + `packages/layerswap-evm/src/layerswap-protocol-evm.js` end-to-end, then start with Phase 0.
