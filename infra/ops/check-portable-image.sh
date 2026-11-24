#!/usr/bin/env bash
# Disposable GitHub-runner smoke. Binds only to loopback and uses generated keys.
set -euo pipefail
: "${REVIEWED_SHA:?reviewed commit required}"
[[ "$REVIEWED_SHA" =~ ^[0-9a-f]{40}$ ]]
image="${1:?local image tag required}"
work="$(mktemp -d)"
prefix="pos-image-check-$$"
cleanup() {
  local result=$?
  if (( result != 0 )); then
    for service in db central sync; do docker logs "$prefix-$service" >&2 || true; done
  fi
  docker rm -f "$prefix-db" "$prefix-central" "$prefix-sync" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker run -d --name "$prefix-db" -p 127.0.0.1:55436:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16.14 >/dev/null
for attempt in {1..40}; do
  if docker exec "$prefix-db" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$prefix-db" pg_isready -h 127.0.0.1 -U postgres
docker run --rm --network host -w /app/tools/target-migrations \
  -e POSTGRES_ADMIN_URL=postgres://postgres@127.0.0.1:55436/postgres \
  -e CAMACHO_ISOLATED_SYNC_LAB=YES -e REPOSITORY_COMMIT="$REVIEWED_SHA" "$image" \
  node --import tsx src/central-sync-lab-migrate.ts
docker run --rm --network host -w /app/tools/target-migrations \
  -e POSTGRES_MIGRATOR_URL=postgres://pos_migrator@127.0.0.1:55436/postgres \
  -e POSTGRES_EXPECTED_DATABASE=postgres -e REPOSITORY_COMMIT="$REVIEWED_SHA" \
  -e POSTGRES_MIGRATION_LOCK_TIMEOUT_MS=5000 -e POSTGRES_MIGRATION_STATEMENT_TIMEOUT_MS=30000 \
  "$image" node --import tsx src/postgres-commercial-cli.ts --central-rate-limit

openssl req -x509 -newkey rsa:2048 -nodes -keyout "$work/server.key" -out "$work/server.crt" \
  -subj /CN=localhost -addext subjectAltName=DNS:localhost -days 1
openssl genpkey -algorithm ED25519 -out "$work/issuer.key"
openssl rand -hex 32 > "$work/transport"
# The host directory stays private. Container UID 10001 reads only the ephemeral mounts.
chmod 0644 "$work/server.key" "$work/issuer.key" "$work/transport"
runtime_db=postgres://pos_platform_app@127.0.0.1:55436/postgres
docker run -d --name "$prefix-central" --network host -v "$work/server.key:/run/pos-smoke/server.key:ro" -v "$work/server.crt:/run/pos-smoke/server.crt:ro" \
  -v "$work/issuer.key:/run/pos-smoke/issuer.key:ro" -v "$work/transport:/run/pos-smoke/transport:ro" \
  -e CENTRAL_DATABASE_URL="$runtime_db" \
  -e CENTRAL_TLS_KEY_FILE=/run/pos-smoke/server.key -e CENTRAL_TLS_CERT_FILE=/run/pos-smoke/server.crt \
  -e D3_ISSUER_PRIVATE_KEY_FILE=/run/pos-smoke/issuer.key -e D3_ENROLLMENT_TRANSPORT_TOKEN_FILE=/run/pos-smoke/transport \
  "$image" >/dev/null
docker run -d --name "$prefix-sync" --network host -w /app/tools/target-migrations \
  -e DATABASE_URL="$runtime_db" -e CENTRAL_SYNC_BIND_HOST=127.0.0.1 \
  "$image" node --import tsx src/central-sync-server.ts >/dev/null

for attempt in {1..30}; do
  if curl -fsS --max-time 2 --cacert "$work/server.crt" https://localhost:8443/health > "$work/central-health.json" &&
     curl -fsS --max-time 2 http://127.0.0.1:8787/health > "$work/sync-health.json"; then
    break
  fi
  sleep 1
done
jq -e '.status == "OK" and .service == "central-authority"' "$work/central-health.json"
jq -e '.status == "ok"' "$work/sync-health.json"
printf 'PORTABLE_CENTRAL_TLS_AND_SYNC_START_OK\n'
