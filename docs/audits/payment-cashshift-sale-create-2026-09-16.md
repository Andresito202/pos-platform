# Audit: Payment + Cash Shift + Sale.create — 2026-09-16

## Scope

Read-only audit of the current desktop → IPC contract → local service → application → persistence path for:

- `payment.register.cash`
- `payment.register.transfer`
- `payment.transfer.confirm`
- `payment.cancel`
- `payment.get`
- Cash Shift open/current/close semantics
- `sale.create`

Only mechanical contradictions are candidates for immediate correction. Business-state or architectural changes remain blocked until their invariant is explicit.

## Findings

### Payment

- Payment operations are exposed consistently through preload, Electron allowlist, contracts, local-channel routing and commercial request handling.
- Renderer commercial calls use the common envelope helper.
- `payment.cancel` is routed but is not currently represented as a complete cashier-facing workflow in the renderer. This is a product-surface gap, not a safe mechanical fix.
- Cash payment UI currently supplies the payable amount as the tendered amount. This prevents real change-making. The backend must remain authoritative for insufficiency/change; adding a renderer input is a product/UX change and is deferred.

### Cash Shift

- The invariant is `tenant_id + branch_id + cash_register_id`, with at most one OPEN/CLOSING shift independent of `origin_device_id`.
- `origin_device_id` is provenance/idempotency/audit data, not a selector for shift ownership.
- Renderer calls open shift using `cash_register_id`; no evidence supports introducing `cash_shift_id` as the sale selector.
- Any change that changes ownership/selector semantics is blocked because DEC-012 is the governing rule.

### Sale.create

- Sale creation is routed through the commercial envelope path.
- The sale/payment lifecycle is distinct: `sale.create` establishes the payable sale state and payment operations advance/complete it.
- `identifier_snapshot` is still nullable on created sale items even when a barcode/identifier was used. This is an auditability defect but not a safe contract-only fix; the exact snapshot source and immutability semantics must be preserved end-to-end.
- There is no stock reservation during the payment window. This creates an optimistic-concurrency window between sale creation and payment completion. Closing it requires an explicit V1 policy or reservation/atomic-completion design; do not silently add a new state/table.
- No complete sale reversal/devolution workflow was found. Existing reversal concepts do not by themselves prove a complete compensating transaction.

## Immediate action

No business-state, schema, migration, or payment semantics were changed by this audit. The safe conclusion is that the current contract/routing layer is substantially aligned, while the remaining issues require product/architecture decisions rather than mechanical patching.

## Next gated work

1. Verify exact payment handler/use-case persistence invariants and idempotency behavior.
2. Verify cash-shift DB invariant and concurrent open behavior against DEC-012 tests.
3. Verify `sale.create` transaction boundary, inventory mutation, operation state and idempotency.
4. Only after those checks, implement narrowly scoped defects with tests.
