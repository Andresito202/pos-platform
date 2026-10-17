# Factus Pay collection webhook ingress

## Contract

The transport adapter is `apps/central-authority/src/factus-pay-webhook-handler.ts`. It accepts only `POST /v1/webhooks/factus-pay/collections?key=...`, JSON content, and a bounded request body. The provider's documented `key` query parameter is checked by the pure verifier; duplicate or missing `key` parameters are rejected.

The adapter requires an injected `FactusPayWebhookInbox`. It emits HTTP 204 only after `persistVerifiedObservation` resolves. A persistence exception produces HTTP 503 so Factus Pay can retry. The idempotency key is provider-scoped and based on the provider's `reference_code`. The adapter does not confirm a POS payment.

## Deliberate integration gate

This adapter is not mounted on the production HTTPS listener yet. There is no approved durable payment-inbox table or repository contract materialized in the current PostgreSQL migrations, and the payment physical model remains documented rather than implemented. The existing `integrations.external_webhook_receipts` table is not a drop-in store: it requires tenant/company/integration scope to be resolved before insertion, stores payload evidence references/checksums rather than the normalized payment observation, and has fiscal correlation guards.

Before wiring a production inbox, the integration must resolve the callback secret to exactly one active tenant/company/integration without exposing secrets, store a sanitized normalized observation and deduplication identity durably, and enqueue it for payment correlation. It must not store the raw provider payload or mark a payment confirmed in the HTTP handler. Correlation must use the existing QR matching contract and the actual pending-payment authority; ambiguity, amount mismatch, duplicate external reference, or missing pending payment must never confirm a sale.

## Operational status

**Not operational / do not register in Factus Pay yet.** The HTTP handler currently exists as an injectable transport adapter with tests, but is not wired to a production persistence adapter, route, or deployment. Unit tests have been authored but not executed in this environment.
