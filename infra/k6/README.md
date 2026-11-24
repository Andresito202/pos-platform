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
