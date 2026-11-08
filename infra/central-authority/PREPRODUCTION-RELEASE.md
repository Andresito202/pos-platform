# Central preproduction: last-mile deployment package

**Status:** prepared and tested in GitHub Actions, **not publicly deployed**. The
commercial Windows login security block must remain active until all E2E evidence
below is gathered. This package is not an MFA/WebAuthn credential.

## Already prepared (no purchased VPS required)

- `Dockerfile`: persistent Node 22.19.0 HTTPS Central runtime; builder handles
  native dependencies; final image runs as uid/gid 1000, without compilers.
- `compose.preproduction.yaml`: binds public TCP 443 to Central TLS 8443,
  read-only root filesystem, non-root, dropped caps, no DB port, readiness probe
  using publicly trusted TLS and the canonical Host.
- `deploy-preproduction.sh`: stops on missing secrets, invalid key ACLs, TLS
  hostname mismatch, expired certificate, missing commercial manifests, or
  invalid Compose model. Does **not** declare certification.
- `central-postgres17-compatibility.yml`: verified canonical migration chain
  001–016 against isolated PostgreSQL 17.11 with ledger, TLS, role and RLS
  checks. The real Supabase database remains unmodified until the canonical
  migrator is executed under approved identities.

## Before deployment: required authority and custody

1. Assign one public DNS name to Central, e.g. an actual operator-controlled
   `central.<purchased-domain>`, with A/AAAA pointed at the VPS; issue a valid
   public TLS certificate for this exact name. Do not substitute localhost,
   `.test`, an invalid certificate, or disable certificate validation.
2. Supply the **real** Postgres 17.11 target (Supabase preproduction project
   `cmmayjrzmbqckfkguwsi`) through an encrypted operator channel. The
   canonical migrator must authenticate as `pos_migrator` and prove all
   16 APPLIED ledger entries; Central must authenticate as the separate
   `pos_platform_app` role with `sslmode=verify-full`, no owner membership,
   SUPERUSER, or BYPASSRLS. An empty Supabase project is **not** sufficient.
   Do not execute ad-hoc SQL to mark migrations APPLIED or to bypass the roles.
3. Create and sign the commercial provisioning document, SSA and SAS public
   trust artifacts, and register authorized BUSINESS client/device,
   organization/branch, and active human WebAuthn factor with the actual
   Central authority. Operational private keys are generated and retained by
   their custodian outside Git, chat, image, and GitHub Actions artifacts.
4. Supply host configuration only via `/etc/camacho-pos/central-runtime.env`,
   owned by root, mode 0600. Supply secrets under
   `/etc/camacho-pos/secrets` (root:1000, directory mode 0750; regular
   files root:1000 mode 0640). Avoid symlinks.

The required runtime settings include:

```text
CENTRAL_DEPLOYMENT_ENVIRONMENT=PREPRODUCTION
CENTRAL_AUTHORITY_ORIGIN=https://<actual-central-domain>
CENTRAL_AUTHORITY_PORT=8443
CENTRAL_BIND_ADDRESS=0.0.0.0
CENTRAL_REQUEST_TIMEOUT_MS=<approved-positive-integer>
CENTRAL_HEADERS_TIMEOUT_MS=<approved-positive-integer-not-greater-than-request>
CENTRAL_SHUTDOWN_TIMEOUT_MS=<approved-positive-integer>
D3_ENROLLMENT_MAX_BODY_BYTES=<approved-positive-integer>
D3_CREDENTIAL_LIFETIME_MS=<approved-positive-integer>
CENTRAL_DATABASE_URL=<protected-postgresql-url-as-pos_platform_app-with-sslmode=verify-full>
CENTRAL_COMMERCIAL_PROVISION_FILE=/run/camacho-secrets/commercial.json
CENTRAL_GLOBAL_ADMINISTRATION_PROVISION_FILE=/run/camacho-secrets/global-admin.json
SESSION_TRUST_ARTIFACT_FILE=/run/camacho-secrets/session-trust.json
SESSION_TRUST_TRANSPORT_TOKEN_FILE=/run/camacho-secrets/session-trust.token
AUTHORIZATION_TRUST_ARTIFACT_FILE=/run/camacho-secrets/authorization-trust.json
AUTHORIZATION_TRUST_TRANSPORT_TOKEN_FILE=/run/camacho-secrets/authorization-trust.token
```

The container supplies absolute paths for TLS key/certificate, enrollment
issuer key, and D3 enrollment token. The separate file
`/etc/camacho-pos/deployment.env` (root, mode 0600) is used by Compose only;
it can be empty. Do not commit either environment file.

**Note:** the real private issuer and trust keys, device enrollment evidence
and approved credentials cannot be minted or inferred from the CI fixture.
For the database, prefer a protected connector that can execute all canonical
migrators under their individual PostgreSQL principals. Supabase's generic SQL
console running as `postgres` does not meet that identity requirement.

## VPS release (only after the provider and domain are available)

The operator prepares Ubuntu with Docker Engine + Compose plugin and opens only
TCP 443 for Central and the strictly necessary SSH administration policy. Install
the reviewed repository commit on the host, then run from the repository root:

```bash
sudo bash infra/central-authority/deploy-preproduction.sh
```

The script builds the image from that commit. Its output means that a
container start was requested, **not** that BUSINESS is certified. Docker
secrets remain on the host, outside the repository.

Check the service over the Internet, with full TLS verification:

```bash
curl --fail-with-body --show-error https://<actual-central-domain>/health
curl --fail-with-body --show-error https://<actual-central-domain>/ready
```

Inspect `/ready`: the status must be `READY` and `commercial_auth`
must equal `CONFIGURED`, **not** `NOT_ACTIVATED`. Those signals alone
are still insufficient for login certification.

## Required final BUSINESS/MFA certification (not automatable without a person)

- Enroll DEV-003 with legitimate device custody and compare signed registry,
  certificates and manifest/pin hashes between SCM and Electron.
- Execute the actual Windows service under SCM and the actual Electron client,
  with a production-path native channel, not the standalone CI peer.
- Complete interactive WebAuthn/UV with a human and enrolled authenticator.
  Verify credential issuance, audience and device binding, branch/tenant
  isolation, roles and denied actions, token renewal, logout and durable
  revocation. Record redacted signed evidence only (never passwords, tokens,
  raw assertions or private keys).
- Review negative tests (absent/expired factors, wrong device/branch,
  revocation, failed TLS, process identity mismatch); all must fail closed.

Only after those checks pass may the authorized release owner decide whether
to remove `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN` in a
separate, reviewed security change, merge PR #99 and mark the commercial login
certified. No script in this package lifts that block by itself.
