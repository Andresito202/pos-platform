# QR-001 — Configuración gratuita de Nequi Negocios / Llave Bre-B (fase 1)

Estado: ESPECIFICACIÓN MATERIALIZADA, NO INTEGRACIÓN PRODUCTIVA. Rama `feat/nequi-breb-static-qr-phase1`. No habilitar UI de cobro hasta contar con contratos y pruebas.

## Fuentes oficiales verificadas (2026-11-07)
- https://ayuda.nequi.com.co/hc/es/articles/35723857144205--C%C3%B3mo-generar-el-QR-Negocios-en-Nequi
- https://ayuda.nequi.com.co/hc/es/articles/38968836243597--C%C3%B3mo-usar-el-QR-Negocios-en-la-app-Nequi-Negocios
- https://ayuda.nequi.com.co/hc/es/articles/47915840624525-Comparte-las-notificaciones-de-pagos-de-tu-Negocio-con-Nequi
- https://banrep.gov.co/es/bre-b/preguntas-frecuentes/c%C3%B3mo-se-usa-bre-b

Nequi genera el QR de negocio en su aplicación, vinculado a una llave registrada, opcionalmente con importe. El QR digital de negocio es gratuito. La llave bloqueada o eliminada invalida su QR. No se ha identificado una API gratuita pública de confirmación por transferencia directa a llave/QR. El propietario puede asignar hasta tres números que reciban SMS adicionales para pagos a Llave Nequi Negocios o QR Negocios; **no** se incluyen todas las transferencias ordinarias al número celular.

## Integración requerida y límites
1. Fase 1: configuración administrada (sin cobrar) de número Nequi, llave Bre-B registrada y archivo QR oficial, por `tenant_id` y `company_id`. **Nunca** crear QR bancario sintético ni afirmar que el QR contiene el importe actual. Un mismo QR estático puede compartirse en cuatro cajas de la misma empresa; se requieren referencias o revisión manual para distinguir pagos simultáneos del mismo monto.
2. Configuración global por empresa como valor por defecto y posibilidad futura de override explícito de sucursal, siempre versionada. No se aceptan IDs de tenant/empresa aportados por renderer: derivar de sesión comercial en backend.
3. Solo roles administrativos *con permiso atómico de backend aprobado* pueden crear, activar, rotar o revocar configuración. `PAYMENTS_TRANSFER_REPORT` y `PAYMENTS_TRANSFER_CONFIRM` NO habilitan configuración; cajero solo lectura de configuración publicada. Usar reautenticación para cambio de destino. No inventar permiso ni asignarlo a roles existentes sin modificar matriz/contratos y certificar.
4. Almacenamiento central con restricciones compuestas de tenant/empresa y RLS; escritura auditada; objeto de QR en storage privado con MIME y firma del archivo validados, límite de tamaño, hash SHA-256, sin URL pública manipulable. La lectura requiere pertenencia al tenant, empresa y sucursal autorizada.
5. Sincronización central->local: snapshot versionado, firmado o autenticado sobre el canal vigente, aplicado atómicamente a SQLite; las 4 cajas usan la **misma versión publicada** según empresa; revocaciones/rotaciones invalidan caché sin asumir disponibilidad instantánea offline. Si no se conoce estado vigente, mostrar aviso de QR potencialmente obsoleto.
6. UI admin: ver destino enmascarado; cargar/reemplazar QR, publicar/revocar con confirmación de identidad; vista previa. UI cajero: mostrar número/llave/QR y monto de venta, nunca permitir cambios ni subir imágenes. Estado `PENDING` hasta validación autorizada de recibo bancario.
7. Mantener fuera del alcance los adaptadores FACTUS Pay y Wompi, sin modificar su configuración, pagos, webhooks, rutas ni contratos.
8. No activar el flujo de venta mientras exista una conexión backend no certificada; preservar UC-PAY-003 y su autorización de reporte/confirmación separadas.

## Modelo mínimo propuesto
`merchant_payment_destinations`: id UUID, tenant_id, company_id, kind (NEQUI_NUMBER | BREB_KEY | NEQUI_BUSINESS_QR), display_label, value (si aplica), qr_object_id nullable, qr_sha256 nullable, version int, status (DRAFT | PUBLISHED | REVOKED), created_at, created_by, published_at, revoked_at, row_version. Validar unicidad parcial del destino publicado por tipo/empresa, y FK compuestas (tenant, company); snapshots referencian version. Nunca se permite UPDATE destructivo de una versión publicada; se crea nueva versión.

## Pruebas requeridas antes de habilitar la UI
- A crea QR; cuatro cajas A ven mismo objeto y versión; caja B de la misma empresa no puede alterar configuración.
- Cajero sin permiso de configuración recibe DENIED aunque invoque IPC manualmente; admin con permiso revocado también.
- Tenant B no puede leer objeto, hash, llave ni configuración de tenant A; IDs ajenos, tokens expirados, tenant faltante: DENIED.
- Dos admins actualizan concurrentemente: conflicto de versión y no sobrescritura silenciosa.
- Revocación/rotación llega a cuatro cajas; caja desconectada no anuncia QR obsoleto como vigente.
- QR manipulado, SVG con código, tamaño excesivo, contenido no imagen: rechazo. Conservar solo artefactos admitidos; reencodificar PNG mediante servicio si se requiere.
- Venta con QR sigue `PENDING`, no hace ruido de éxito ni genera recibo pagado hasta confirmación autorizada.
- Factus/Wompi no presentan cambios ni regresiones.

## Fase 2: notificación (NO IMPLEMENTADA)
Nequi permite SMS de negocios a hasta tres números adicionales. No existe API documentada que entregue esos SMS al POS. Investigar receptor Android dedicado con consentimiento, permisos y compatibilidad con políticas de distribución; si entrega alerta, registrar evento **no verificado** y deduplicar, sin cerrar venta. El diseño nunca recoge credenciales Nequi, OTP ni tokens bancarios. Necesita pruebas físicas con SMS reales, la política de autorización del dispositivo y contrastación del abono en la cuenta.

## Estado verificado de la rama base
- `apps/pos-desktop/renderer/src/App.tsx`: pantalla de Empresa y Configuración son superficies planificadas/deshabilitadas.
- `SalePanel.tsx`: transferencia manual reportable y confirmable con permisos distintos; botón 'QR integrado' aparece pendiente.
- `UC-PAY-003`: exige QR versionado y declara dependencia QR-001 todavía no modelada.
- El servicio local ya tiene registro de transferencias, separado de su confirmación. Reutilizarlo, sin alterar cobertura ni reportar pagos falsamente.


## Avance adicional: proyección de lectura QR-001 (2026-11-07)
- `packages/domain/src/merchant-destination.ts`: validación estricta de identificadores y metadatos para QR oficial de Nequi.
- `packages/domain/src/merchant-destination-policy.ts`: transiciones puras de publicación/revocación y lectura por empresa.
- `packages/domain/src/merchant-destination-snapshot.ts`: proyección de destino, secuencia monotónica, binding tenant/empresa, caducidad e invalidación cuando Central publica una revocación vacía.
- Pruebas escritas en `packages/domain/tests/merchant-destination*.test.ts`; **no se han ejecutado, no se declara TESTED**.

### Bloqueos de arquitectura y gobernanza observados
`AGENTS.md`, `README.md` y `docs/governance/repository-governance.md` exigen trabajo en la línea activa `feat/android-commercial-runtime` y prohibición de líneas paralelas. PR #103 existe como rama derivada por la intervención previa, pero no se integra ni se considera nueva fuente canónica. Su revisión e incorporación deben respetar el flujo de la rama activa y los gates.

`docs/architecture/data-ownership.md` asigna configuración de pagos a Payments, no a un módulo Configuration independiente. `tools/target-migrations/README.md` exige descriptors, checksum, ledger y pruebas reales para migraciones. Por tanto:
- No se añade DDL ejecutable ni se alteran migraciones existentes sin protocolo canónico.
- La sincronización propuesta **no funciona aún**: no hay emisor Central firmado/verificado para QR-001, ni verificador del servicio local, ni persistencia SQLite.
- `applyVerifiedDestinationSnapshot()` **solo** puede invocarse después de verificar origen y firma con el mecanismo de confianza existente. No aceptar snapshots desde renderer ni usarlo como un bypass; tampoco conectar el método directamente a IPC.
- No hay provisión de permiso nuevo ni formulario activado; `canConfigure` debe venir de una decisión backend central existente o de un permiso atómico ratificado, nunca del string de rol del usuario.
- En QR estático compartido por cuatro cajas, dos transacciones idénticas no se distinguen por el QR; deben permanecer PENDING hasta conciliación inequívoca.
- La entrega automática de notificación SMS no acredita pago y no cambia el estado de Payment.

### Condición para desbloquear interfaz
Adoptar el contrato en el módulo Payments y en el migrador canónico, habilitar permiso administrativo verificable, guardar revisiones y auditoría de manera atómica, generar/validar snapshots con el canal confiable y probar lectura de cuatro cajas. Después, y solo después, activar editor administrativo y visualizador de caja.


## Incremento de confianza criptográfica — 2026-11-07

- `apps/pos-local-service/src/security/merchant-destination-snapshot-verifier.ts` verifica un sobre firmado Ed25519 según el `canonicalJson` existente (no introduce cifrado ni algoritmos nuevos).
- Las claves deben estar explícitamente destinadas a `MERCHANT_DESTINATION_SNAPSHOT`, con estado válido, ambiente, vigencia y scope de empresa. Una clave de licencia o `MASTER_SNAPSHOT` no sirve.
- `apps/pos-local-service/src/payments/merchant-destination-activation.ts` compone **verify → activate SQLite**. El store de activación de proyección continúa sin ruta IPC; no se autoriza escribir desde frontend.
- Pruebas de firma, manipulación, empresa equivocada, ambiente equivocado, claves revocadas, expiración, replay y revocación: **escritas, no ejecutadas por Vitest**.
- Smoke SQL aislado (Python sqlite3 3.46.1, esquema de MIGRATION_019): rechazo a UPDATE de secuencia igual, DELETE y aceptación de incremento: PASS. No demuestra ejecución de pruebas del repositorio ni build.

### Gaps para certificación
1. El emisor Central legítimo debe firmar con claves aprovisionadas, con su propia custodia y registro de eventos. Este incremento únicamente implementa el verificador local; no existe emisor habilitado.
2. Exigir piso de secuencia reconocido por Central para evitar rollback a snapshot auténtico antiguo tras restauración de backup. Actualmente solo se compara la cota local.
3. Materializar persistencia Central y autorización real, distribución autenticada a cuatro instalaciones, selección desde Administración y lectura segura desde Caja; tests CI y físicos.
4. No afirmar recepción bancaria gratuita en tiempo real ni confirmación automática de fondos por SMS. La validación financiera permanece fuera de QR-001.

## Avance de piso Central contra rollback — 2026-11-07

- `MerchantDestinationActivationService.acceptSigned` es ahora asíncrono y requiere `MerchantDestinationAcknowledgedFloor` autenticado, con vínculo exacto `installationId / tenantId / companyId`.
- Una caída/denegación de Central produce `CENTRAL_FLOOR_UNAVAILABLE`, sin activar snapshots nuevos. `null` como resultado autorizado solo significa que Central **no tiene acuse previo** para esa instalación/empresa.
- Una cota central inválida, secuencia obsoleta o igual a la mayor cota local/central se rechaza; la verificación Ed25519 del artefacto continúa siendo obligatoria.
- Se añadieron pruebas escritas para pérdida de conectividad, cota central antirrestauración, scope de instalación inválido y ciclo de vida corrupto de clave.
- **Pendiente necesario**: implementar el origen Central de la cota durable y el protocolo de acuse tras activación. Hasta hacerlo no está permitido habilitar esta ruta en el arranque ni en IPC.
- No se han ejecutado Vitest, TypeScript typecheck, CI del HEAD, ni operaciones físicas. Nivel de evidencia: `IMPLEMENTED` para componentes aislados, no `TESTED` ni `END_TO_END`.

## Incremento Central y carga de QR — 2026-11-07

Materialización nueva:
- `apps/central-authority/src/merchant-destination-qr-asset.ts`: validador estricto de PNG oficial (RGB/RGBA 8-bit, máximo 1024x1024, máximo 1 MiB, CRC íntegro, zlib acotado, sin chunks adicionales ni contenido después de IEND), hash SHA-256. Esto **no** comprueba que el QR escanee correctamente ni prueba titularidad bancaria. Otros formatos exigen conversión segura previa, no cambio de extensión.
- `tools/target-migrations/sql/postgres/024_merchant_payment_destinations.up.sql` y `.down.sql`: migración Central aditiva bajo `payments` con objetos de QR, destinos, eventos de auditoría, outbox, secuencias y acuses por instalación. Protecciones RLS forzadas por tenant y empresa, FK compuestas, prohibición de DELETE/TRUNCATE y versiones/estados controlados.
- `tools/target-migrations/src/postgres-commercial-runner.ts` y `postgres-commercial-cli.ts`: descriptor/target explícito `MERCHANT_DESTINATIONS`, sucesor de 023, con checksum en ledger y smoke para RLS/ownership/gates. **No aplicada a base de datos.**
- `apps/central-authority/src/merchant-destination-postgres-store.ts`: adaptador central transaccional de comandos QR-001, `SERIALIZABLE`, `SET LOCAL` de ámbito, compare-and-swap, auditoría y outbox en una misma transacción. NO es endpoint HTTP, NO recibe una sesión del navegador, NO concede permisos por sí mismo.
- `.github/workflows/qr001-validation.yml`: CI focalizado del PR con typecheck y tests de dominio, Central, SQLite y migración 024. GitHub aún no reportó ejecución sobre el último HEAD consultado.

Antes de habilitar interfaz o pruebas con QR propio:
1. Ejecutar en CI y PostgreSQL 16.14 el schema 024 y revisar tests, grants y RLS físicos.
2. Montar un handler Central que derive `tenantId/companyId/userId` y permiso atómico de la **sesión autenticada**; no aceptar `canConfigure` ni IDs del renderer. Auditar toda acción.
3. Subida de QR oficial: validar PNG, almacenar en tabla `payments.merchant_qr_assets` dentro de la empresa. La comprobación de propiedad del QR es operativa; el hash solo detecta manipulación de bytes.
4. Emisor Central Ed25519 con aprovisionamiento de claves, secuencia de emisión y acuses por instalación; publicar snapshots firmados y entregar por transporte seguro a las cuatro cajas, con invalidación y caducidad.
5. Habilitar editor de Administración (solo escritura admin) y lector en Caja después de pruebas de frontera real; no dejar que cajeros cambien destino.
6. Mantener cada venta por transferencia QR en PENDING hasta una verificación autorizada. Los SMS de Nequi de la fase 2 serán eventos de aviso y no evidencia financiera concluyente.

**Precisión económica:** integrar la visualización de un QR oficial y una llave de negocio no requiere comisiones de Camacho POS. No hay API bancaria gratuita universal certificada para confirmar automáticamente cada abono Nequi/Bre-B en las cajas. Ni la migración ni el adaptador ofrecen esta capacidad aún.
