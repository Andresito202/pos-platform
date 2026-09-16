# Audit: Payment + Cash Shift + Sale.create — 2026-09-16

## Scope

Deep implementation audit of the desktop → IPC contract → local service → use case → SQLite path for:

- `payment.register.cash`
- `payment.register.transfer`
- `payment.transfer.confirm`
- `payment.cancel`
- `payment.get`
- Cash Shift open/current/close semantics
- `sale.create`
- transaction/idempotency/outbox coupling

## Architectural verdict

The payment/cash/sale core is structurally coherent around one important invariant: the payment that completes a sale, its allocation, cash movement, inventory decrement and durable outbox effects are designed to commit or roll back together inside the local SQLite transaction. Cash remains behind `CashPort`; Payment does not write cash tables directly. The cash-shift selector remains `cash_register_id` at sale creation and the trusted layer resolves the shift.

No new business state, migration or schema was introduced.

## Findings and decisions

### 1. Cash payment path — corrected

Backend already accepts `tendered_amount`, computes change in the trusted use case, rejects insufficient tender and returns the authoritative `change_amount`. The renderer was the remaining operational defect: it always sent `tendered_amount = payable_amount`, making change impossible in the actual POS surface.

Implemented:

- `useCommercialSale.chargeCash(tenderedAmount?)` canonicalizes the received cash before sending it.
- `SalePanel` now exposes `Efectivo recibido`.
- Empty input preserves the exact-cash behavior for compatibility.
- The renderer never computes change; it only supplies what the customer physically handed over.
- Added a focused renderer test for 20,000 received against 3,500 payable, asserting the contractual request and service-returned 16,500 change.

### 2. Payment transaction/idempotency

`SqlitePaymentStore` checks operation idempotency before writes and uses the runtime operation record rather than the payment row as the idempotency authority. Post-write rejection paths use transaction rollback rather than returning a rejection after persistence. This protects the critical cases where a closed/missing cash shift or insufficient stock is discovered after earlier writes in the same transaction.

The local outbox is enqueued through the same SQLite transaction, preserving the local fact and its synchronization intent as one commit boundary.

### 3. Cash Shift

The governing selector remains `tenant + branch + cash_register`, with at most one `OPEN`/`CLOSING` shift independent of `origin_device_id`. A sale can bind to an existing active shift; a `CLOSING` shift is deliberately retained so payment can return `CASH_SHIFT_NOT_OPEN` rather than falsely reporting `CASH_SHIFT_MISSING`.

No change was made to ownership semantics.

### 4. Sale.create

`sale.create` remains the authority for pricing, totals, stock pre-check and sale creation. It passes only `cash_register_id` from the renderer; the renderer does not select `cash_shift_id`.

The known `identifier_snapshot = NULL` defect remains. The catalog has identifiers/barcodes, but correcting this requires preserving the exact identifier model through the sale snapshot and receipt projection; it is not a safe one-line persistence patch and is therefore left as a separate gated implementation.

The payment window remains optimistic regarding stock. Final completion rechecks/decrements inventory transactionally and rolls back the payment when stock is insufficient. A reservation state/table was intentionally not introduced.

There is still no complete sale reversal/devolution workflow. The existing reversal concepts are not treated as implementation evidence.

### 5. Transfer/cancel

Transfer registration and confirmation preserve the intended separation: registration is not confirmation, `payment.get` supplies the persisted version required by confirmation, and confirmation is the completion point. `payment.cancel` is routed and persisted at the backend level but lacks a complete cashier-facing workflow; implementing UI cancellation without a defined operator workflow would be architectural guesswork.

## Changes made in this gate

- Cashier can enter actual cash received.
- Trusted payment layer remains the authority for insufficiency and change.
- Focused test covers request normalization, contract validity, returned change and confirmation sound.
- No schema/state/migration changes.

## Verification status

The repository changes have been committed to the existing PR branch. Tests have **not yet been executed in this environment**, so this gate is not a test PASS. CI must verify typecheck, renderer tests, local-service payment tests and the existing Electron/runtime suites before the PR can be considered green.

## Next gate

1. Run the repository's targeted payment/cash/sale tests and typecheck.
2. Inspect CI for the branch and resolve any synchronization/regression caused by the renderer API change.
3. Then tackle `identifier_snapshot` end-to-end with its catalog source and receipt projection test.
4. Keep reversal/devolution and stock reservation as separate architectural gates; do not mix them into the payment patch.
