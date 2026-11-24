# Carga comercial autenticada

El perfil inicial cubre 10 empresas, 30 cajas, 3.000 eventos SALE_CREATED y 2.000 eventos adicionales de outbox. Cada caja envía sus lotes ordenados mientras las otras 29 operan en paralelo. El umbral de escritura verifica el acuse durable de todos los IDs y la cantidad de aceptaciones.

El archivo de entrada de Sync es un array de 30 objetos `{deviceId, companyId, batches: [{headers, body}]}`, uno por caja. `body` es el envelope Sync v1 serializado exactamente como fue firmado con DeviceProof por el dispositivo de staging. Preparar lotes inéditos, con igual número de lotes por caja, generados por los flujos normales de POS. Emitir las pruebas de dispositivo con vigencia suficiente para la ventana de medición. Cada repetición requiere operaciones frescas y un entorno aislado. Mantener corpus, cabeceras y credenciales fuera de Git.

Operación de portal: `GET /v1/admin/catalog/plans` con credencial GLOBAL real del puente Central de portal #1. La prueba ejerce autorización y catálogo. El inicio de sesión humano/MFA y la creación de ventas en el POS se miden por separado.

```bash
K6_ENVIRONMENT=authorized-staging k6 run --summary-export=sync-summary.json infra/k6/central-commercial.js
K6_ENVIRONMENT=authorized-staging k6 run --summary-export=portal-summary.json infra/k6/portal-commercial.js
```

Antes de ejecutar, exportar `SYNC_BASE_URL`, `SYNC_FIXTURE_FILE`, `PORTAL_BASE_URL` y `PORTAL_GLOBAL_BEARER` según la prueba. Mantener TLS verificado. La capacidad queda pendiente hasta ejecutar ambos y reconciliar los acuses con la base de staging.

El ensayo del limitador usa `infra/k6/central-authority-rate-limit.js`, dos endpoints TLS que llegan a réplicas distintas (`AUTHORITY_REPLICA_A` y `AUTHORITY_REPLICA_B`), una IP vista igual por ambas y un bearer de confianza de sesión en `TRANSPORT_TOKEN`. Usar una ventana aislada que empiece vacía en un PostgreSQL exclusivo de staging. La prueba consume 30 permisos alternando réplicas y exige 429 contractuales de ambas después del agotamiento.

## Aprovisionamiento repetible del corpus

1. Aprovisionar Central, Sync y PostgreSQL de staging con la cadena de migraciones existente. Para gestión de cajas y licencias aplicar los targets correspondientes de `postgres:commercial:apply` y conservar sus recibos. Usar las superficies GLOBAL y BUSINESS existentes para las empresas, sucursales, tres cajas por empresa, licencias y operadores. Registrar los 30 dispositivos con el flujo Device Trust y anotar los IDs emitidos. Provisionar portal y la confianza de sesión en ambas réplicas para los otros dos ensayos.
2. En los POS de staging, cargar los catálogos y turnos de ensayo. Generar 100 ventas por caja mediante sus flujos normales. Capturar outbox de cajas aisladas y sin un despachador que consuma simultáneamente esas mismas operaciones. Exportar JSON con los objetos de `operation_json` ordenados por `local_sequence`, por caja. Para repartir los otros 2.000 eventos, exportar 67 adicionales de 20 cajas y 66 de 10 cajas. Los rangos por caja deben ser contiguos y usar una sola identidad.
3. Preparar un manifiesto privado `{"environment":"staging","registers":[...]}`. Cada entrada contiene `registerId`, `tenantId`, `companyId`, `branchId`, `deviceId`, `installationId`, `credentialId`, `outboxFile` y `signingKeyFile`. Los últimos dos son rutas absolutas fuera del checkout. La clave Ed25519 debe ser la del dispositivo dedicado al ensayo y tener permisos 0600 en el host de carga. Si una clave administrada es inexportable, usar únicamente dispositivos de ensayo con custodia compatible. Conservar los IDs, nunca las claves, en un inventario de provisioning.
4. Generar el corpus y arrancar k6 de inmediato. El compilador utiliza DeviceProof y los esquemas Sync reales. Valida alcance, secuencia, duplicados y hash canónico. No reescribe operaciones ni exporta claves. Entrega un archivo nuevo modo 0600 que contiene 60 lotes firmados. Las pruebas de dispositivo tienen una ventana de dos minutos. Ejecutar el ensayo de 90 s con relojes sincronizados.

```bash
export K6_ENVIRONMENT=authorized-staging
pnpm --filter @pos-platform/target-migrations exec node --import tsx \
  src/prepare-commercial-k6-staging.ts --manifest /abs/staging.json --output /abs/signed-batches.json
SYNC_FIXTURE_FILE=/abs/signed-batches.json k6 run --summary-export=/abs/sync-summary.json infra/k6/central-commercial.js
```

Si el compilador devuelve `STAGING_OUTBOX_CHECKSUM_MISMATCH`, resolver el contrato en el productor antes de efectuar la medición. El productor actual de `SALE_CREATED` persiste el checksum de la solicitud, mientras Central Sync exige SHA-256 del payload canónico. El compilador conserva y verifica el registro original para no ocultar ese fallo. El corpus firmado y cualquier token de staging son temporales y se retiran de la máquina de carga al terminar.
