#!/usr/bin/env bash
set -euo pipefail

POC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export RLS_POC_POSTGRES_PASSWORD="${RLS_POC_POSTGRES_PASSWORD:-unused-cleanup-value}"
docker compose -f "${POC_ROOT}/compose.yaml" down --volumes --remove-orphans
