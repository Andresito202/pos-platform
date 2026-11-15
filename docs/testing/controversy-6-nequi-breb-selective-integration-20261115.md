# Controversia 6 — Integración selectiva Nequi / Bre-B (2026-11-15)

**Rama única:** `cursor/commercial-design-review-0d11` · **PR #106:** Draft; no merge.
**HEAD de partida:** `6ea46700753afd095abe6f79d79e04528ccc7024`.
**Procedencia examinada:** `feat/nequi-breb-static-qr-phase1`, divergida respecto de esta rama (363 commits propios / 524 commits ausentes en origen al comparar desde la línea activa). **No hacer merge ni cherry-pick integral.**

## Fuentes normativas inspeccionadas
- `docs/architecture/qr-payment-real-time.md`
- `docs/use-cases/payments/UC-PAY-003-confirm-manual-transfer.md`
- `apps/pos-desktop/e2e/ROLE-UX-CONSOLIDATION.md`
- `AGENTS.md`, `docs/product/roles.md` y gobernanza del repositorio.

## Comparación por archivos / decisión

| Origen histórico | Decisión en la rama activa | Motivo |
| --- | --- | --- |
| `packages/domain/src/merchant-destination.ts` | **Integrado selectivamente** en `packages/contracts/src/merchant-destination.ts` | Validación estricta de número, llave y referencia a QR oficial. Sin nuevo Zod ni reestructuración de dominio. |
| `packages/domain/src/merchant-destination-policy.ts` | **Integrado selectivamente** en `packages/contracts/src/merchant-destination-policy.ts` | Versiones, publicación/revocación y alcance; `canConfigure` solo es una interfaz, NO autenticación. |
| `packages/domain/src/merchant-destination-snapshot.ts` | **Integrado selectivamente** en `packages/contracts/src/merchant-destination-snapshot.ts` | Proyección de una empresa a cuatro cajas, caducidad, secuencia y revocación; la aplicación exige verificación criptográfica externa todavía NO conectada. |
| `packages/domain/src/merchant-payment-notification.ts` | **Integrado selectivamente** en `packages/contracts/src/merchant-payment-notification.ts` | Observación SMS estrictamente `UNVERIFIED`, pagador/importe opcionales, aislamiento y deduplicación por digest; sin venta ni pago asociados. |
| `packages/domain/src/merchant-destination-commands.ts` y su suite | **Integrados selectivamente** en `packages/contracts/src/merchant-destination-commands.ts` y test correspondiente | Contrato transaccional/CAS, outbox y auditoría; no concede permisos ni conecta todavía un endpoint. |
| Cuatro suites `packages/domain/tests/merchant-*.test.ts` | **Trasladadas** a `packages/contracts/tests/` con caso adicional de dos ventas del mismo importe | Protección de modelos e invariantes sin requerir backend bancario. |
| Migraciones `024_merchant_payment_destinations` a `027_merchant_notice_revocation_guard` | **Agregadas como sucesoras opt-in** en el runner actual; scripts históricos preservados | Mantiene 001–023 intactas; flags explícitas `--merchant-destinations` y `--merchant-notifications`. No se aplican automáticamente al servidor comercial. |
| Tests `postgres-024-merchant-destinations*.test.ts`, `postgres-025-merchant-notifications.test.ts` | **Trasladados**; fixture físico ahora exige PostgreSQL loopback local y DB descartable | Reglas de RLS, scope, consentimientos, integridad, revocación e invariantes `UNVERIFIED`. |
| `apps/central-authority/src/merchant-destination-business-operations.ts` y `merchant-destination-admin-authorization.ts` | **NO integrado** | La comprobación de `OWNER/GENERAL_ADMIN` por código de rol/MFA no acredita un grant atómico de configuración; contradice la política de permisos firmados de la rama actual. |
| `apps/central-authority/src/merchant-destination-postgres-store.ts`, asset store y publisher | **NO conectado** | Dependen del gate administrativo y de un enrolamiento de dispositivo verificados. Copiar clases sin su composición no es capacidad productiva. |
| `apps/central-authority/src/merchant-notification-ingest-routes.ts`, inbox, consentimientos y rutas device | **NO expuesto en HTTPS** | Falta reconciliar el DeviceProof y la provisión/revocación operativa con el Central actual; no existe receptor Android real acreditado. |
| `apps/pos-local-service/src/payments/merchant-destination-sync.ts`, verifier, SQLite store, notice feed | **NO integrado al runtime** | Dependen de issuer/lease firmado, schema SQLite y rutas Central no conectadas; no aceptar datos de renderer ni bypass de firma. |
| `apps/pos-desktop/renderer/src/components/MerchantPaymentMethods.tsx`, `MerchantPaymentNoticePanel.tsx` | **NO montados en Caja** | Históricamente dependen de IPC que aún no existe en esta línea. Montarlos hoy produciría pantalla no funcional. |
| `apps/pos-desktop/renderer/src/components/SalePanel.tsx`, `App.tsx`, contratos IPC y preload históricos | **RECHAZADA copia/reemplazo** | La rama activa contiene flujos de ventas, autorizaciones y UX posteriores. Se requiere adaptación selectiva de futuros canales, no sobrescritura. |
| `packages/database-sqlite/src/local-database.ts` y `pnpm-lock.yaml` históricos | **No sobrescritos** | Conservar migraciones, entornos, SQLite/WAL y dependencias actuales. |

## Separación financiera obligatoria

1. **Solicitado:** total de venta emitido por Payments/Sales local, no por un SMS.
2. **Informado:** valor que el SMS alega, si lo incluye; pagador también opcional y NO autenticado como titular del abono.
3. **Realmente confirmado:** solo resultado del caso de uso autorizado y de una fuente humana o financiera comprobada. Un SMS, QR, importe igual o dispositivo enrolado no tiene esta autoridad.
4. `UNVERIFIED` jamás cambia `Payment`, `PaymentAttempt`, `Sale`, cobertura ni outbox de cobro. Dos ventas por el mismo importe no se vinculan a un aviso. Los datos financieros reales y la referencia única se obtienen de otra fuente.

## Pruebas incorporadas y alcance

- Unitarias de contratos: versiones, caducidad offline, cuatro cajas, tenant/company distintos, importes SMS menores/iguales/mayores, datos ausentes, rechazo de móviles completos, duplicados exactos, mismo importe/dos ventas, sin autoridad bancaria.
- Migraciones: DDL 024–027, RLS por tenant/empresa, consentimiento y revocación, evidencias append-only, restricciones forzadas `bank_confirmed=false` y `sale_confirmed=false`; aplicación física **solo en DB temporal**.
- Regresión SQLite: ejecutar el `tests/payment.test.ts` actual sin modificaciones de Payments.
- Las pruebas CI de esta intervención deben consultarse en el HEAD final correspondiente; no declarar `PASS` antes de ver el resultado del job.

## Pendientes de ejecución y certificación

1. Diseñar y autorizar un permiso atómico de configuración del receptor de transferencias, con emisión real por Central (no inventar grants ni basarse únicamente en etiqueta de rol).
2. Enlazar alta/publicación/revocación auditadas, fuente oficial del QR y firma separada de snapshots a Central; verificar licencias, dispositivos y consentimientos.
3. Incluir proyección firmada a SQLite de cuatro cajas con invalidación de lease y recuperación offline, sin autorización desde IPC.
4. Incorporar visualización de QR/llave y avisos informativos solo cuando la cadena backend esté conectada y probada; no producir una segunda Caja.
5. Integrar receptor Android con consentimiento opt-in real, restricciones de SMS, retención y revocación; probar físicamente. No hay webhook gratuito bancario probado.
6. Probar cuatro cajas de empresa A y empresa B simultáneamente, monto inferior/superior, duplicados, desconexión, reintentos, rotación, permisos revocados y registro de pagos/confirmación **real SQLite** sin alteraciones automáticas.
7. Confirmación financiera automática: **fuera de alcance** hasta disponer de fuente financiera autenticada, evento correlacionable y decisión idempotente inequívoca.

**Estado:** contratos y migraciones opt-in integrados; funcionalidad QR y notificaciones **NO caller-reachable / NO END_TO_END / NO certificadas en producción**. `UC-PAY-003` manual permanece vigente.
