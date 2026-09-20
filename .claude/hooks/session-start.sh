#!/usr/bin/env bash
# SessionStart — lo primero que ve cualquier sesión de Claude Code en este repo.
#
# Hace dos cosas, en este orden:
#   1. Anuncia la LÍNEA ACTIVA y comprueba si estás en ella.
#   2. Instala dependencias para que las pruebas y el typecheck corran.
#
# El anuncio va primero a propósito: la regla de una sola rama es documental en
# CLAUDE.md/AGENTS.md/README, y un documento se puede leer por encima. Esto no.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

echo "════════════════════════════════════════════════════════════════════"
echo " CAMACHO POS — GOBERNANZA DE RAMA"
echo "════════════════════════════════════════════════════════════════════"
if [ -x "$ROOT/tools/governance/check-active-line.sh" ]; then
  "$ROOT/tools/governance/check-active-line.sh" || true
else
  echo "AVISO: falta tools/governance/check-active-line.sh" >&2
fi
echo "════════════════════════════════════════════════════════════════════"

# Dependencias. `install` y no `ci`: el contenedor se cachea tras el hook y
# `install` aprovecha ese caché. Es idempotente.
if [ -f "$ROOT/package.json" ]; then
  if command -v pnpm >/dev/null 2>&1; then
    ( cd "$ROOT" && pnpm install --no-frozen-lockfile ) || {
      echo "AVISO: pnpm install fallo; typecheck y pruebas pueden no correr." >&2
    }
  else
    echo "AVISO: pnpm no esta disponible; no se instalaron dependencias." >&2
  fi
fi
