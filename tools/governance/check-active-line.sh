#!/usr/bin/env bash
# Comprueba que se está trabajando sobre la línea activa declarada.
#
# La fuente única de verdad es `tools/governance/active-line.txt`. `CLAUDE.md`,
# `AGENTS.md` y `README.md` la citan, pero citar es documentar y esto es
# comprobar: aquí falla el comando, que es lo que un agente no puede pasar por
# alto leyendo por encima.
#
# Salidas: 0 = estás en la línea activa. 1 = no lo estás. 2 = no se pudo saber.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FILE="$ROOT/tools/governance/active-line.txt"

if [ ! -f "$FILE" ]; then
  echo "GOBERNANZA: falta $FILE; no se puede determinar la línea activa." >&2
  exit 2
fi

EXPECTED="$(tr -d '[:space:]' < "$FILE")"
CURRENT="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"

if [ -z "$CURRENT" ]; then
  echo "GOBERNANZA: no se pudo leer la rama actual." >&2
  exit 2
fi

if [ "$CURRENT" = "$EXPECTED" ]; then
  echo "GOBERNANZA OK — línea activa: $EXPECTED"
  exit 0
fi

cat >&2 <<MSG
╔══════════════════════════════════════════════════════════════════════╗
║  ALTO — NO ESTÁS EN LA LÍNEA ACTIVA                                  ║
╚══════════════════════════════════════════════════════════════════════╝

  Línea activa declarada : $EXPECTED
  Rama actual            : $CURRENT

Este repositorio admite UNA sola línea de desarrollo. Cinco ramas paralelas
sobre el mismo trabajo costaron semanas de integración (ver CLAUDE.md).

Si eres un agente y tu arnés te asignó "$CURRENT", ese nombre NO es
autoridad: lo genera la plataforma antes de que tú decidas nada.

  git checkout $EXPECTED

Si crees que la línea activa debe cambiar, NO abras otra rama: dilo y que lo
decida el propietario del repositorio.
MSG
exit 1
