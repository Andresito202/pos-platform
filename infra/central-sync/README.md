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
