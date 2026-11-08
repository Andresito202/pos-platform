#!/usr/bin/env bash
# VPS-only release gate. Do not execute on GitHub Actions or before DNS/TLS,
# protected PostgreSQL roles/ledger and commercial issuer provision exist.
set -Eeuo pipefail
umask 077
if [[ "${EUID}" -ne 0 ]]; then echo 'CENTRAL_DEPLOY_ROOT_REQUIRED' >&2; exit 1; fi
for bin in docker openssl curl; do
  if ! command -v "$bin" >/dev/null; then echo "MISSING_COMMAND:$bin" >&2; exit 1; fi
done
ROOT=/etc/camacho-pos
CONFIG="$ROOT/central-runtime.env"
COMPOSE=infra/central-authority/compose.preproduction.yaml
test -f "$COMPOSE" || { echo 'RUN_FROM_REPOSITORY_ROOT' >&2; exit 1; }
test -f "$CONFIG" || { echo 'CENTRAL_RUNTIME_ENV_MISSING' >&2; exit 1; }
test -d "$ROOT/secrets" || { echo 'CENTRAL_PROTECTED_SECRETS_MISSING' >&2; exit 1; }
if [[ "$(stat -c %a "$ROOT/secrets")" != "750" || "$(stat -c %u:%g "$ROOT/secrets")" != "0:1000" ]]; then
  echo 'PROTECTED_SECRETS_DIRECTORY_PERMISSIONS_REJECTED' >&2; exit 1
fi
for name in tls.key tls.crt issuer.key enrollment.token commercial.json global-admin.json session-trust.json session-trust.token authorization-trust.token authorization-trust.json; do
  test -f "$ROOT/secrets/$name" || { echo "PROTECTED_FILE_MISSING:$name" >&2; exit 1; }
  test ! -L "$ROOT/secrets/$name" || { echo "PROTECTED_SYMLINK_REJECTED:$name" >&2; exit 1; }
done
for file in "$ROOT/central-runtime.env" "$ROOT/deployment.env"; do
  test -f "$file" || { echo "PROTECTED_ENV_MISSING" >&2; exit 1; }
  if [[ "$(stat -c %a "$file")" != "600" || "$(stat -c %u "$file")" != "0" ]]; then
    echo 'ENV_FILE_PERMISSIONS_REJECTED' >&2; exit 1
  fi
done
for name in tls.key tls.crt issuer.key enrollment.token commercial.json session-trust.token authorization-trust.token authorization-trust.json; do
  file="$ROOT/secrets/$name"
  # Docker runtime uid 1000 must be able to read, but nobody else.
  if [[ "$(stat -c %a "$file")" != "640" || "$(stat -c %u:%g "$file")" != "0:1000" ]]; then
    echo "PROTECTED_FILE_PERMISSIONS_REJECTED:$name" >&2; exit 1
  fi
done
origin="$(sed -n 's/^CENTRAL_AUTHORITY_ORIGIN=//p' "$CONFIG")"
if [[ ! "$origin" =~ ^https://[a-zA-Z0-9.-]+$ || "$origin" == *..* ]]; then
  echo 'CENTRAL_HTTPS_ORIGIN_MISSING_OR_INVALID' >&2; exit 1
fi
hostname="${origin#https://}"
openssl x509 -in "$ROOT/secrets/tls.crt" -noout -checkend 86400 >/dev/null ||
  { echo 'CENTRAL_TLS_EXPIRING_OR_INVALID' >&2; exit 1; }
openssl x509 -in "$ROOT/secrets/tls.crt" -noout -checkhost "$hostname" | grep -q 'does match' ||
  { echo 'CENTRAL_TLS_HOSTNAME_REJECTED' >&2; exit 1; }
for envkey in CENTRAL_DATABASE_URL CENTRAL_COMMERCIAL_PROVISION_FILE CENTRAL_GLOBAL_ADMINISTRATION_PROVISION_FILE SESSION_TRUST_ARTIFACT_FILE SESSION_TRUST_TRANSPORT_TOKEN_FILE AUTHORIZATION_TRUST_ARTIFACT_FILE AUTHORIZATION_TRUST_TRANSPORT_TOKEN_FILE; do
  if ! grep -q "^${envkey}=" "$CONFIG"; then echo "CENTRAL_REQUIRED_ENV_MISSING:$envkey" >&2; exit 1; fi
done
# The runtime validates the actual DB identity, schema, trust, issuer and
# commercial document. Failure must not be bypassed by Docker healthy alone.
docker compose --env-file "$ROOT/deployment.env" -f "$COMPOSE" config --quiet
docker compose --env-file "$ROOT/deployment.env" -f "$COMPOSE" up -d --build
echo 'CENTRAL_CONTAINER_STARTED_WITH_RELEASE_GUARDS'
echo 'REQUIRE_EXTERNAL_READY_CONFIGURED_AND_HUMAN_WEBAUTHN_EVIDENCE'
# No CERTIFIED output here: startup does not prove DEV-003, MFA or roles.
