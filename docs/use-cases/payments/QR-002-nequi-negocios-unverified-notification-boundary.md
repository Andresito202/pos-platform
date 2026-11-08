# QR-002 — Nequi Negocios: aviso de transferencia, NO confirmación bancaria

**Estado:** contrato de dominio y pruebas automatizadas, en PR #103 Draft. Sin receptor SMS conectado, sin aplicación Android instalada, sin entrega realtime a Caja, sin pagos reales, sin modificación al libro de pagos.

## Alcance financiero autorizado
- El **negocio**, no Camacho POS, mantiene la titularidad del QR, la llave y el dinero.
- La fuente documentada para compartir SMS es **Nequi Negocios**: pagos por Llave Nequi Negocios o QR Negocios asociado a Bre-B; hasta **tres números adicionales** inscritos por el titular. El SMS no abarca automáticamente pagos recibidos en un QR personal P2P ni todos los movimientos Nequi.
- Documentación oficial: https://ayuda.nequi.com.co/hc/es/articles/47915840624525-Comparte-las-notificaciones-de-pagos-de-tu-Negocio-con-Nequi
- La app Nequi exige registro y autenticación del número destinatario por el titular; un POS no puede agregar teléfonos en nombre del negocio.
- El SMS es una **observación de una fuente externa no autenticada como comprobante bancario**, no una garantía de abono; puede duplicarse, demorarse o falsificarse. **Prohibido** crear, confirmar o cerrar pagos automáticamente a partir de texto, monto, código QR o nombre del remitente.

## Frontera creada en el código
`packages/domain/src/merchant-payment-notification.ts` valida un aviso de origen `NEQUI_NEGOCIOS_SHARED_SMS` y produce solo:
- `tenant_id / company_id / source_installation_id`, derivados de una futura autenticación de instalación segura, nunca del contenido SMS;
- digest SHA-256 de la evidencia, marca temporal, etiqueta del remitente y opcionalmente una vista previa limitada; los cuerpos originales no son necesarios para este contrato;
- estados fijos `status=UNVERIFIED`, `bank_confirmed=false`, `sale_confirmed=false`, `requires_independent_reconciliation=true`.

El registro es idempotente por `(tenant, company, installation, message_sha256)` y rechaza versiones distintas de un mismo digest. Jamás agrupa pagos de igual importe ni genera IDs de venta, pago o transacción bancaria.

## Requisitos pendientes para el receptor Android / Central
1. El administrador opta expresamente por notificaciones y designa un Android del **propio comercio**; el dispositivo debe estar enrolado y con permisos específicos. La captura de SMS/notifications depende de restricciones Android y de políticas de distribución, no de una API gratuita de confirmación de pagos.
2. No transmitir cuerpos SMS, teléfonos completos o contactos si no se necesitan; proteger cifrado en tránsito/almacenamiento, confidencialidad por empresa, borrado/retención y revocación administrativa.
3. Crear endpoints autenticados de ingestión y suscripción de solo lectura (requerir pruebas antirreplay, RBAC, rate limits, idempotencia durable y aislamiento multiempresa). **No están implementados**.
4. No enlazar una observación a una venta por importe u hora solamente. Presentar `Aviso de transferencia — no verificado` para conciliación independiente contra movimientos del banco.
5. Probar con SMS reales y consentimiento, duplicados, suplantación, varios comercios, cuatro cajas, caídas offline, restauración, reintentos, logout y revocación. Las pruebas automáticas actuales solo certifican el **contrato puro**.

## Compatibilidad QR-001
El QR propio Nequi P2P o Bre-B estático sigue siendo una opción de cobro **sin comisión de software**, pero no presupone que Nequi Negocios emita SMS de negocio por ese QR. La detección automatizada no debe activarse en Caja por el simple hecho de que Administración haya cargado una imagen.
