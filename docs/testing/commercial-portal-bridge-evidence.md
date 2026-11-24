# Evidencia bridge comercial (pos-platform)

## Unit / HTTP

```text
pnpm --filter @pos-platform/central-authority exec vitest run tests/commercial-portal-bridge.test.ts
# 5 passed
```

## Cross-repo (observed from camacho-pos-comercial)

```text
node scripts/integration-commercial-bridge.mjs
# result: PASS — mint/introspect, trial 120h activate callback, provisioning idempotency
```

See also: `camacho-pos-comercial/docs/testing/integration-commercial-bridge-results.md`
