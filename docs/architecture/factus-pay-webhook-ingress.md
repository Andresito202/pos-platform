# Factus Pay collection webhook ingress

## HTTP endpoint

The central HTTPS listener mounts `POST /v1/webhooks/factus-pay/collections?key=...` only when `FACTUS_PAY_DATABASE_URL` is configured. The connection must use the dedicated `pos_platform_app` database role. The handler applies an in-process remote-address rate limit, bounds the JSON body, rejects duplicate/missing `key` query parameters, and authenticates the key by SHA-256 digest against the database registry.

A successful response is HTTP 204 only after the normalized observation is committed to the durable inbox. Persistence errors return HTTP 503 so Factus Pay can retry. Invalid payloads do not enter the inbox. The handler never confirms a POS payment.

## Database contract

Migration `009_factus_pay_webhook_inbox` creates two additive tables:

- `integrations.factus_pay_webhook_keys`: stores only a SHA-256 digest, scoped to one tenant/company/integration, with an active/revoked lifecycle.
- `integrations.factus_pay_webhook_inbox`: stores normalized provider reference, COP amount, paid status, optional payer fields, timestamps, processing status, and a unique provider transaction key scoped by tenant/integration.

Both tables have forced RLS. The inbox deduplicates repeated references. If the same reference arrives with a different amount, the adapter fails closed and returns a retryable 503 rather than acknowledging a conflicting event. The raw provider payload and plaintext key are not persisted.

The registration command is `pnpm --filter @pos-platform/central-authority factus-pay:key:register`. It requires `FACTUS_PAY_DATABASE_URL`, `FACTUS_PAY_WEBHOOK_SECRET`, `FACTUS_PAY_TENANT_ID`, `FACTUS_PAY_COMPANY_ID`, and `FACTUS_PAY_INTEGRATION_ID`. The command verifies an ACTIVE `FACTUS_PAY` integration with exactly one active credential binding, inserts only the secret digest, and does not print the secret. Configure that same secret in the Factus Pay dashboard. Keep the secret out of source control, shell history, logs, and chat.

Apply the additive migration using `pnpm --filter @pos-platform/target-migrations postgres:009:apply` after the existing 002 and 007 migration ledger entries are present and their artifact checksums match. The runner validates PostgreSQL 16.14, repository commit format, migration lock, predecessor checksums, table presence, and forced RLS. Run the descriptor test with `pnpm --filter @pos-platform/target-migrations test:descriptor:009`.

## Activation and payment confirmation gate

The route is disabled unless `FACTUS_PAY_DATABASE_URL` is present. This URL must be a dedicated least-privilege connection as `pos_platform_app`; do not reuse an owner or superuser credential. The migration must be applied before enabling the route. Register a key only for the intended tenant/company/integration and use the same key in Factus Pay.

**The payment flow is still not end-to-end.** The inbox persists verified provider evidence but no worker yet correlates it with the authoritative pending payment or propagates a confirmed result through Sync to Local Service. Do not enable this endpoint in production or configure the provider until the migration, typecheck, tests, HTTPS reachability, key provisioning, retry behavior, and payment correlation have been verified in the target environment. No raw payload is stored; only the normalized observation needed for later correlation is persisted.
