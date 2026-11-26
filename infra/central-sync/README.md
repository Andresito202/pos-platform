# Central sync TLS topology

This directory materializes the transport boundary required by `DEC-007` and the client contract.

```text
POS Local Service
      |
      | HTTPS :443
      v
   Caddy TLS
      |
      | HTTP :8787 (private Docker network)
      v
central-sync-server
      |
      v
 PostgreSQL
```

## Boundary

- The POS client continues to require `https://`.
- Caddy terminates public TLS and proxies only to the private central-sync service.
- The central sync service is not published directly to the host.
- Certificate material is managed by Caddy; no private key is committed to the repository.
- `CENTRAL_SYNC_DOMAIN` is supplied at deployment time. There is no hard-coded production hostname.
- `DATABASE_URL` remains a deployment secret and is not stored here.
- Sync requests authenticate with a centrally issued active device credential and a fresh Ed25519 proof bound to the HTTP method, route, request IDs and exact body. Static bearer tokens are not accepted as device authentication.

## Current status

This is deployment infrastructure materialization, not production certification. A real deployment still requires:

1. a DNS name resolving to the Caddy host;
2. reachable TCP 80/443 for ACME HTTP/TLS challenges as applicable;
3. deployment-time secrets;
4. PostgreSQL availability;
5. an end-to-end HTTPS test against the deployed hostname.

Do not use `tls internal` for production clients. Do not disable certificate verification in the POS client.

## Readiness and rollout

Use the runtime database role and apply the Central migrations for the selected
revision before starting Compose. Keep the connection string in deployment
secret storage. Point the approved environment DNS record at the HTTPS
ingress, and publish an AAAA record only when the host has working IPv6 ingress.

Run `docker compose -f infra/central-sync/compose.yaml config --quiet` with the
deployment environment supplied, then
`docker compose -f infra/central-sync/compose.yaml up -d --build --wait`.
Probe `GET /health` for process liveness and `GET /ready` for runtime database
connectivity and the migration permissions required by Sync. A readiness
response of 503 calls for checking the database connection, applied migrations,
and role permissions against the selected revision. Compare it to the internal
readiness probe before changing DNS or ingress. Validate both endpoints with
certificate verification enabled on the deployed hostname.

After readiness succeeds, exercise a signed Sync request and confirm durable
Inbox evidence and ACK before routing commercial clients. Use the repository
backup and restoration procedure in
[`docs/ops/backup-rpo-rto-dr-20261124.md`](../../docs/ops/backup-rpo-rto-dr-20261124.md)
before promoting staging.
