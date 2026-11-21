# Consolidación BUSINESS y cajas 2026-11-21

El propietario autorizó continuar la rama existente `codex/business-cash-consolidation-20261120`, preservar el trabajo local sobre `3471d39f`, confirmar/publicar el bloque validado e integrar mediante PR y CI del commit exacto. No se afirma una revisión humana del diff que no haya sido observada.

## Bloque conservado

Central monta `/v1/business/` en el listener HTTPS original y sirve el mismo renderer `index.html` en `/business/`. Login BEGIN/COMPLETE reutiliza password/WebAuthn, recibos internos de un solo uso y sesiones existentes. Cookie BUSINESS y GLOBAL, permisos y contextos permanecen separados. Sesión, contextos, logout y listar/crear/editar/retirar cajas pasan por la autoridad existente. No se instala provisión ni se activa una sesión por este commit.

La creación conserva intención/correlación en el panel y confirma reintentos desde auditoría inmutable en la transacción de la mutación. La retención del panel es en memoria; recargar requiere reconciliar la lista. El registro empresarial reutiliza InitializeTenant y muestra organización/membresía confirmadas; READY_FOR_LICENSE no significa credenciales, MFA o licencia provisionados.

## Evidencia observada antes de publicar

| Comprobación | Resultado y límite |
|---|---|
| business-router.test.ts | 19 PASS; HTTPS loopback con certificado efímero, router/handlers/emisor/autoridad reales; MFA y PostgreSQL son dobles |
| business-browser-session.test.ts | 17 PASS; unitarias, sin PostgreSQL |
| BusinessCashRegisterPanel.test.tsx y PlatformTenantRegistration.test.tsx | 3 PASS; jsdom con cliente/transporte doblados |
| initialize-tenant.test.ts | 6 PASS; repositorio doblado |
| TypeScript | PASS Central, desktop, contracts, application, database-postgres y pos-local-service |
| Renderer | Compilación PASS a carpeta temporal nueva; dist existente preservado; dos advertencias de anotaciones PURE en Zod |
| git diff --check | PASS |

Los 45 casos son únicos; ejecuciones repetidas no se suman. Este nivel es TESTED local, no RUNTIME_VERIFIED, CALLER_REACHABLE, END_TO_END ni PRODUCTION.

## Pendientes de cierre

- PostgreSQL 16 escucha en 5432, pero no hubo conexión autorizada en la sesión. Ledger/checksums 029–032, grants, RLS/FORCE RLS, SQL real, auditoría, sesiones y concurrencia no fueron comprobados. No se usó 55433 ni se ejecutaron migraciones.
- La migración 029 no atribuye las cajas aún no asignadas a una licencia. Crear con varias licencias vigentes se rechaza explícitamente con CASH_REGISTER_LICENSE_BINDING_REQUIRED; listar, editar y retirar son independientes. No se presenta este bloqueo como solución comercial final.
- El conteo previo combina identidades activas de empresa y asignaciones históricas, sin liberar artefactos offline. La vinculación por licencia requiere cerrar el modelo existente antes de habilitar múltiples licencias.
- Falta verificar provisión HTTPS, claves reales, WebAuthn humano, distribución firmada al dispositivo y arranque comercial. No se generan sustitutos en producción.
- La integración a main sigue sujeta a los gates del HEAD exacto y a la verificación post-merge, aunque la publicación esté autorizada.

El respaldo `C:\Respaldos\CamachoPOS\codex-20261120-190306` tenía 37 copias legibles e iguales por SHA-256 antes de continuar. Su parche sufrió recodificación; no se restauró. No contiene un respaldo integral de datos o secretos. Los archivos de datos, DPAPI, cachés y `.claude-desactivado/` permanecen excluidos.
