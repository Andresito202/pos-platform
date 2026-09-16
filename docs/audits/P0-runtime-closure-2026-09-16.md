# P0 — Real Runtime Closure — audit handoff

Date: 2026-09-16
Baseline: `main` @ `4b7ed3444ea633bb35f917bef0a7860ecf7069a7`
Working branch: `fix/runtime-status-envelope`

## Scope

This audit separates safe mechanical corrections from architectural decisions that must be resolved before implementation. A contradiction between DEC, contract, implementation or E2E is not resolved by guessing in code.

## Corrections already made on this branch

1. `apps/pos-desktop/renderer/src/hooks/useRuntimeStatus.ts`
   - Uses `callCommercial("runtime.status.get", {})` instead of bypassing the envelope.
   - Requires a `SUCCEEDED` response before reporting `connected`.

2. `apps/pos-desktop/renderer/src/components/InventoryPanel.tsx`
   - Business date now follows the same local-calendar convention as `useCommercialSale.operationTime()` instead of UTC `toISOString().slice(0, 10)`.

## P0 findings

### P0-A — IPC surface

`ChannelBridge` is intentionally a forwarder. It validates the allowlist but does not construct envelopes. Therefore renderer callers must use the envelope helper.

Code search on `main` found the only renderer bypass outside the helper itself in `OperationPanel.tsx`:

- `operation.result.get` sends `{ operation_id }` directly.
- `operation.confirm` sends `{ operation_id }` directly.

The contract requires an envelope. `operation.result.get` requires both `operation_id` and `idempotency_key`; `operation.confirm` requires envelope operation/idempotency identity plus payload `operation_type` and `payload`.

**Architectural hold:** do not blindly replace these calls with `callCommercial()`. For `operation.confirm`, the existing UI's `operationId` is intended as the operation identity, while `callCommercial()` generates a new operation identity. The intended semantics of this diagnostic panel must be decided first.

### P0-B — runtime startup

`apps/pos-desktop/src/main.ts` exports `bootstrap(serviceChannel)` and does not construct the service channel itself. `apps/pos-desktop/src/start.ts` constructs the channel and calls `bootstrap()`.

The desktop package exposes `build:entry` and builds `start.ts` to `dist/start.bundle.mjs`, but its package scripts do not expose a normal production Electron start/packaging entry. Existing smoke/E2E entries invoke the bootstrap path explicitly.

**Architectural hold:** determine the canonical production process model: who starts the Local Service, who resolves the local channel secret, and which Electron entry is used in an installed build. Do not add an ad-hoc auto-start path until DEC-010/related runtime decisions are checked.

### P0-C — trust/session/authorization

The production runtime still requires a real path for the first trusted authorization/session context. E2E provisioning must not be treated as production provisioning.

Open architectural dependency remains the first trust root / trusted signing-key bootstrap and the acquisition of a valid authorization snapshot. `DEC-022` is still described as a proposal in PR #78 and does not itself close G1.

**Architectural hold:** resolve trust bootstrap first, then implement session provisioning/recovery against that authority.

## P1 findings

### Payment cancellation

`payment.cancel` is present in preload, allowlist, contract, response schema and Local Service routing, but no renderer business UI call was found in the current tree.

This is a completeness gap, not evidence that the backend operation is broken.

### Cash tendered amount

The current Sale UI exposes a cash payment button but `useCommercialSale.chargeCash()` sends `tendered_amount` equal to `payableAmount`. The contract supports a distinct tendered amount and backend change calculation.

**Safe product conclusion:** real cashier flow still needs a received-cash input and must keep authoritative change calculation in the service. Implementation can be scheduled after the current P0 architectural holds; it does not require changing the contract if the existing contract already accepts the field.

### Operation result identity

A lookup of an existing operation requires the original idempotency identity according to the current contract. Generating a fresh idempotency key would not be an equivalent fix.

## Deliberately not changed

- trust-root/bootstrap mechanism;
- session provisioning;
- authorization snapshot acquisition;
- production service startup ownership;
- `operation.confirm` semantics;
- payment state machine;
- stock reservation;
- sale reversal;
- central authority/sync;
- fiscal production integration;
- installer/updates;
- hardware.

## Existing open PRs that must not be treated as automatically mergeable

- PR #78: sync transport D-2; its own description says `DEC-022` is pending ratification and D-2 remains `TESTED` only.
- PR #72: handler response type-hardening; its base is stale and must be reapplied/audited against current `main` before merging.

## Required next architectural decisions

1. Define intended semantics and lifecycle of the generic `OperationPanel`.
2. Define canonical production Electron → Local Service startup/ownership path.
3. Ratify or replace the first-trust-root design before implementing production session bootstrap.
4. Define how the production device obtains/validates the authorization snapshot.

Only after those decisions should the corresponding code gates be implemented.
