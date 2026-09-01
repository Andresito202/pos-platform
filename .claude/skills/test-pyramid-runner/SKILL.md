---
name: test-pyramid-runner
description: Usar para decidir y ejecutar qué nivel de test corre en pos-platform (Vitest, Playwright, Testcontainers, k6) según lo que cambió.
---
# Pirámide de pruebas

Este proyecto usa Vitest, Playwright, Testcontainers y k6 en distintos niveles. Antes de decir
"probado":
1. Cambio en lógica de dominio/casos de uso → Vitest (unit/integration ligera).
2. Cambio que toca PostgreSQL/SQLite real → Testcontainers, no mocks.
3. Cambio en flujo end-to-end de UI (Electron/React) → Playwright.
4. Cambio que afecta carga/latencia (Sync, Outbox, Payments) → k6.
5. Corre el comando real y pega el resultado real. Si no lo corriste en esta sesión, no digas `TESTED`
   (ver skill claims-level-audit) — di qué falta ejecutar.
