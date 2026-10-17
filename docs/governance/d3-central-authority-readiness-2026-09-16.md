# Certificación final POS — criterio de cierre y evidencia

Fecha de actualización: 2026-10-16
Rama canónica: `claude/pos-camacho-bloque-4c-ld43py`
PR de trabajo: #92
Estado: `LOCAL_REGRESSION_EVIDENCE_PRESENT / END_TO_END_CENTRAL_SYNC_NOT_CERTIFIED`

## Regla de trabajo

No repetir suites ya aprobadas salvo que cambie su código, contrato o dependencia. Un resultado previo conserva validez para el commit probado; un commit posterior que cambie archivos relacionados exige ejecutar únicamente las pruebas de regresión afectadas. Ningún resultado local se presenta como ejecución de CI.

## Evidencia local ya reportada por el responsable

La siguiente evidencia se conserva como existente; no se vuelve a solicitar ni a repetir por defecto:

- `pnpm typecheck`: PASS en los workspaces incluidos en esa ejecución.
- `pnpm test:database-postgres`: 5/5 PASS con PostgreSQL local en puerto 55433.
- `pnpm test:contracts`: 277 PASS.
- `pnpm test:domain`: 47 PASS.
- `pnpm test:application`: 16 PASS.
- `pnpm test:fiscal-adapters`: 173 PASS, 2 SKIPPED por requerir sandbox Factus.
- `pnpm test:migrations:sqlite`: 13 PASS.
- `pnpm --filter @pos-platform/pos-local-service exec vitest run --no-file-parallelism --maxWorkers=1`: 652 PASS, 9 SKIPPED; 1 archivo omitido.
- `pnpm architecture:check`: 16/16 PASS.
- `pnpm ci:supply-chain-tests`: 45 PASS.
- `pnpm ci:license-gate`: PASS, 0 findings que requieren revisión y 0 denegaciones.
- `pnpm ci:dependency-inventory`: 306 paquetes, 23 dependencias directas, 16 manifests workspace, 0 hallazgos de licencia.
- `pnpm ci:sbom`: 429 componentes CycloneDX y 429 relaciones.
- `pnpm ci:vulnerability-audit`: comando PASS, pero quedan 2 advisories / 2 hallazgos de triage sin excepción aceptada.
- `git diff --check`: PASS; árbol limpio en la revisión reportada.

Estos resultados no certifican automáticamente commits posteriores ni el comportamiento de una autoridad central desplegada.

## Hallazgo funcional que bloquea la certificación de extremo a extremo

En `apps/pos-local-service/src/main.ts`, el runtime sigue inyectando `UnprovisionedDeviceCredentialProvider` a `SyncDispatcher`. Ese proveedor siempre devuelve `DEVICE_CREDENTIAL_UNPROVISIONED`. Por diseño, `CentralSyncComponent` hace un intento inicial y no activa el temporizador cuando no hay credencial.

Por tanto, las ventas locales y el outbox durable pueden funcionar offline, pero el código actual no demuestra que la cola se entregue automáticamente a una autoridad central autenticada cuando regresa la conexión.

La autoridad de `apps/central-authority/src/main.ts` expone salud, publicación de session trust y enrollment. No registra un receptor productivo `POST /v1/sync/batches`. El receptor existente en `tools/target-migrations/src/central-sync-server.ts` usa `CENTRAL_SYNC_TOKEN` y pertenece al persistence gate; no se reutiliza como autoridad productiva ni se acepta ese token como identidad de dispositivo.

## Bloques obligatorios para el cierre

### A. Credencial y prueba de posesión por petición

- Resolver la credencial firmada desde el almacén local cifrado, sin variables de entorno ni secretos estáticos.
- Añadir al contrato una prueba de posesión Ed25519 ligada al método, ruta, hash del cuerpo, identificador de petición, timestamp y nonce/challenge; evitar replay.
- Verificar la cadena raíz → clave operativa `DEVICE_TRUST`, firma, estado/revocación, vigencia y binding de tenant/company/installation/device en el servidor.
- No reclamar lotes ni consumir intentos si la credencial no está disponible o no supera la validación.

### B. Recepción central y persistencia

- Registrar `POST /v1/sync/batches` en Central Authority con límites de cuerpo, timeout, TLS, validación estricta del envelope y códigos de respuesta contractuales.
- Reutilizar el owner de persistencia central y las tablas/constraints canónicas; no copiar el servidor del gate ni crear una segunda autoridad.
- Derivar el contexto de tenant/dispositivo de la identidad autenticada, no confiar en IDs aportados por el payload.
- Persistir cada operación con checksum e idempotencia dentro de una transacción; rechazar conflictos sin mutación parcial.
- Registrar evidencia durable de autenticación y rechazos sin guardar secretos.

### C. Pruebas nuevas de cierre (no repetir la suite general)

1. Unitarias de canonicalización y firma de petición: cuerpo alterado, ruta/método alterados, timestamp vencido, nonce repetido, firma incorrecta.
2. Integración PostgreSQL del receptor: lote válido, reenvío idéntico idempotente, checksum conflictivo, tenant/device binding cruzado, dispositivo revocado y rollback atómico.
3. E2E con identidad Ed25519 real de prueba y claves operativas efímeras de test: enrollment → credencial cifrada → venta offline → reconexión → entrega → confirmación durable.
4. Prueba de reinicio del servicio después de venta offline: recuperación del outbox y no duplicación.
5. Ejecutar typecheck y las suites específicas de contratos, device-trust, database-postgres, central-authority y sync/local-service afectadas por los cambios.
6. Ejecutar `git diff --check` y confirmar árbol limpio.

## Condiciones de salida

- **CERTIFICADO LOCAL**: todos los gates aplicables anteriores ejecutados en un entorno controlado, con comandos, conteos y commit exacto registrados.
- **CERTIFICADO DE PRODUCCIÓN**: además, claves raíz/operativa reales bajo custodia aprobada, migraciones aplicadas con evidencia, TLS/certificados y configuración de despliegue verificados, Central Authority desplegada y E2E contra esa instancia completado.
- Un componente implementado o una prueba unitaria verde no equivale a E2E ni a producción.
- Las pruebas omitidas de Factus siguen siendo una limitación separada del alcance de sincronización.
- Los dos advisories de vulnerabilidad deben triagearse y resolverse o documentarse con decisión explícita antes de la certificación global de seguridad.
- No hacer merge ni declarar cierre mientras los criterios aplicables permanezcan abiertos.

## Próximo trabajo autorizado

Continuar directamente con A → B → C en esta rama, modificando los contratos y owners existentes. No reauditar ni repetir los resultados listados arriba. Cada bloque debe terminar con cambios concretos, pruebas específicas nuevas y un informe corto con commit, archivos, comandos y resultado real.
