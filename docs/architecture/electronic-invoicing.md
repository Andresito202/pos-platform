# Arquitectura de documentos electrónicos

## Estado

Contrato arquitectónico aprobado. La implementación productiva, habilitación normativa y certificación por proveedor permanecen sujetas a su fase y evidencia.

## Propósito

Permitir que POS Platform emita y gestione documentos electrónicos mediante Factus, Siigo u otros proveedores sin convertir el contrato de un proveedor en el modelo fiscal del producto.

La arquitectura debe soportar:

- múltiples tenants;
- múltiples empresas y NIT;
- configuración por ambiente;
- diferentes proveedores por empresa;
- facturas, notas y documentos habilitados por capacidad;
- resultados asíncronos o inciertos;
- límites de tasa;
- conciliación;
- contingencia aplicable;
- conservación de XML, PDF y referencias fiscales;
- cambio futuro de proveedor sin reescribir ventas.

## Alcance

Este documento define:

- propiedad modular;
- frontera entre venta comercial y documento electrónico;
- configuración por empresa;
- modelo canónico;
- ciclo de vida;
- puertos por capacidad;
- adaptadores;
- idempotencia;
- seguridad;
- persistencia conceptual;
- operación offline y contingencia;
- pruebas mínimas.

No afirma:

- habilitación de POS Platform como proveedor tecnológico;
- certificación ante la DIAN;
- contrato comercial vigente con Factus, Siigo u otro proveedor;
- equivalencia total entre sandbox y producción;
- cumplimiento normativo sin validación legal y técnica vigente.

## Propiedad modular

`Electronic Invoicing` es propietario de:

- conexiones con proveedores fiscales;
- configuración fiscal de emisión;
- rangos y prefijos conocidos;
- documentos electrónicos;
- intentos de transmisión;
- estados normalizados;
- referencias del proveedor;
- artefactos XML/PDF;
- incidencias fiscales;
- conciliación de resultados;
- contingencia fiscal configurada.

No es propietario de:

- venta comercial;
- líneas de venta;
- pricing;
- impuestos calculados por el motor comercial;
- pagos;
- caja;
- inventario;
- clientes maestros;
- identidad o autorización.

Consume snapshots inmutables y referencias de esos módulos mediante contratos explícitos.

## Separación de hechos

```text
Sale COMPLETED
    │
    ├── Receipt / ticket comercial
    │
    └── ElectronicDocument
            ├── configuración de emisión
            ├── FiscalSubmissionAttempt
            ├── resultado proveedor/autoridad
            └── XML/PDF/identificadores
```

Reglas:

1. Completar una venta no significa que el documento electrónico fue aceptado.
2. Aceptar un documento electrónico no cambia silenciosamente total, líneas, impuestos o pagos de la venta.
3. Un rechazo fiscal no elimina la venta comercial.
4. Una corrección posterior crea un documento de ajuste permitido; no sobrescribe el documento aceptado.
5. Un ticket no se etiqueta como factura electrónica si no existe el estado y evidencia requeridos.
6. La caída fiscal no pierde la venta, pero puede restringir la entrega fiscal según política y normativa.

## Configuración por empresa

Cada conexión fiscal pertenece como mínimo a:

```text
tenant_id
company_id
tax_identity_id
provider_code
environment
provider_account_reference
capabilities
credential_reference
certificate_reference
configuration_version
valid_from
valid_until
configuration_version_status
```

Reglas:

- no existe una credencial global compartida implícitamente entre tenants;
- sandbox y producción son configuraciones diferentes;
- sucursales pueden seleccionar un perfil autorizado de la empresa sin convertirse en propietarias del NIT;
- rango, prefijo y resolución se asocian al emisor, proveedor, ambiente y tipo documental aplicables;
- una configuración inactiva no emite documentos nuevos;
- cambiar proveedor no reescribe documentos históricos;
- secretos se referencian, no se almacenan como texto en tablas de negocio.
- la conexión estable no crea otro lifecycle: elegibilidad y estado efectivo se derivan de la versión `DRAFT`/`PUBLISHED`/`SUPERSEDED`/`REVOKED`, su vigencia, capabilities y salud técnica; la salud de transporte no muta el lifecycle de configuración.

## Tipos canónicos de documento

El núcleo reconoce capacidades canónicas, sin asumir que todo proveedor soporta todas:

- factura electrónica de venta;
- nota crédito;
- nota débito;
- documento soporte;
- nota de ajuste a documento soporte;
- documentos adicionales habilitados en fases especializadas.

Un tipo solo se habilita cuando:

- el producto lo soporta;
- el proveedor lo soporta;
- la empresa lo contrató y configuró;
- el ambiente es válido;
- existen rangos, certificados y permisos requeridos;
- la validación normativa vigente fue completada.

## Modelo canónico

Un `ElectronicDocument` conserva conceptualmente:

```text
electronic_document_id
tenant_id
company_id
branch_id
sale_id o source_operation_id
document_type
provider_connection_id
environment
internal_reference
provider_document_id
provider_reference
prefix
number
currency
issue_date
business_date
canonical_payload_version
canonical_payload_checksum
commercial_snapshot_reference
tax_snapshot_reference
status
provider_status
authority_status
provider_api_version
created_at
accepted_at
rejected_at
last_reconciled_at
version
```

Los nombres de campos de Factus, Siigo o DIAN no reemplazan estos conceptos.

## Ciclo de vida normalizado

Estados persistentes:

### `DRAFT`

Existe una preparación fiscal todavía editable y no transmitida.

### `READY`

El documento canónico está congelado, validado internamente y listo para encolarse.

### `QUEUED`

Existe un trabajo persistente pendiente de transmisión.

### `SUBMITTING`

Un worker posee temporalmente el intento. Este estado no prueba recepción externa.

### `ACCEPTED`

Existe evidencia verificable de aceptación conforme al proveedor y autoridad aplicables.

### `REJECTED`

Existe rechazo definitivo o corregible con códigos y evidencia conservados.

### `UNKNOWN_OUTCOME`

La solicitud pudo haber sido procesada, pero no existe respuesta suficiente. Debe consultarse o reconciliarse antes de repetir.

### `CONTINGENCY`

El documento se gestionó mediante un procedimiento de contingencia previamente habilitado y requiere las acciones posteriores aplicables.

### `VOIDED_BEFORE_SUBMISSION`

La preparación fue invalidada antes de producir un documento aceptado. No anula una venta ni un documento electrónico ya aceptado.

Reglas:

- no existe transición directa de `ACCEPTED` a borrado;
- una nota es otro `ElectronicDocument` relacionado;
- `SUBMITTING` vencido pasa a reconciliación, no a retry ciego;
- estados específicos desconocidos del proveedor se mapean a revisión segura;
- `provider_status` conserva el valor original sin convertirlo en enum global.

## Intentos de transmisión

Cada `FiscalSubmissionAttempt` conserva:

```text
attempt_id
electronic_document_id
attempt_number
request_id
idempotency_key
provider_operation_id
request_checksum
started_at
finished_at
transport_status
http_status
provider_code
normalized_result
retry_after
diagnostic_reference
```

Estados técnicos persistentes:

- `CREATED`;
- `IN_PROGRESS`;
- `COMPLETED`;
- `FAILED`;
- `UNKNOWN_OUTCOME`;
- `CANCELLED`.

El estado técnico del attempt no representa el resultado fiscal del documento. `transport_status` y `normalized_result` permanecen separados. Para este contrato, `normalized_result` solo reutiliza `ACCEPTED` o `REJECTED` cuando existe evidencia; fallo técnico o incertidumbre lo dejan ausente. Esos valores no se duplican como estados técnicos ni forman una enum paralela. Un attempt histórico `UNKNOWN_OUTCOME` no se reescribe cuando evidencia posterior resuelve el `ElectronicDocument`.

## Artefactos, incidencias y conciliación

`FiscalArtifact` conserva referencias, tipo, media type, checksum, metadata, inmutabilidad y política de retención para XML, PDF, application response, QR data, payload firmado, respuesta del proveedor u otra evidencia autorizada. No guarda secretos y no asume que todos los proveedores produzcan todos los formatos.

`FiscalIncident` distingue una situación que requiere revisión de un fallo transitorio ordinario. Sus estados persistentes son `OPEN`, `IN_REVIEW`, `RESOLVED` y `ARCHIVED`. Rechazo, timeout, incertidumbre, inconsistencia, problema de numeración, schema/version, contingencia, webhook o reconciliation mismatch se clasifican por tipo; la forma de resolución se conserva separadamente. Archivar no elimina evidencia.

`FiscalReconciliation` compara estado interno y evidencia externa autoritativa. Sus estados persistentes son `CREATED`, `RUNNING`, `REVIEW_REQUIRED`, `PARTIALLY_RECONCILED`, `RECONCILED`, `FAILED`, `CANCELLED`, `CLOSED` y `REOPENED`. El alcance/periodo es snapshot y no tiene otra máquina de estados. Pertenece a Electronic Invoicing y no reutiliza físicamente la enum de Payments.

Documento, attempt, incidente, conciliación y estados originales del proveedor mantienen máquinas separadas.

La solicitud y respuesta completas pueden almacenarse cifradas en object storage cuando sean necesarias, con checksum y política de retención. Logs y trazas no contienen documentos completos ni credenciales.

## Puertos por capacidad

No se implementará una interfaz gigante que obligue a simular capacidades inexistentes. Se definen puertos independientes:

### `DocumentIssuancePort`

- validar payload canónico;
- transmitir documento;
- devolver identidad externa y resultado normalizado.

### `DocumentStatusQueryPort`

- consultar por referencia interna o externa;
- recuperar estado actual;
- distinguir no encontrado de resultado incierto.

### `DocumentArtifactPort`

- descargar XML;
- descargar PDF o representación disponible;
- verificar checksum y tipo.

### `NumberingRangePort`

- consultar capacidades de rango;
- sincronizar rangos y prefijos;
- validar vigencia conocida;
- no asignar localmente un consecutivo si el proveedor conserva esa autoridad.

### `FiscalConfigurationValidationPort`

- validar credenciales;
- validar ambiente;
- consultar capacidades;
- detectar configuración incompleta sin exponer secretos.

Un adaptador declara qué puertos y tipos documentales soporta.

## Matriz de capacidades del proveedor

Cada versión del adaptador registra:

| Capacidad | Estado permitido |
|---|---|
| Emisión de factura | `SUPPORTED`, `UNSUPPORTED`, `UNVERIFIED` |
| Nota crédito | `SUPPORTED`, `UNSUPPORTED`, `UNVERIFIED` |
| Nota débito | `SUPPORTED`, `UNSUPPORTED`, `UNVERIFIED` |
| Documento soporte | `SUPPORTED`, `UNSUPPORTED`, `UNVERIFIED` |
| Consulta de estado | `SUPPORTED`, `UNSUPPORTED`, `UNVERIFIED` |
| Descarga XML | `SUPPORTED`, `UNSUPPORTED`, `UNVERIFIED` |
| Descarga PDF | `SUPPORTED`, `UNSUPPORTED`, `UNVERIFIED` |
| Idempotencia externa | `SUPPORTED`, `UNSUPPORTED`, `UNKNOWN` |
| Webhook | `SUPPORTED`, `UNSUPPORTED`, `UNVERIFIED` |
| Contingencia | `SUPPORTED`, `UNSUPPORTED`, `REQUIRES_MANUAL_PROCESS`, `UNVERIFIED` |

`UNVERIFIED` nunca se presenta comercialmente como soporte.

## Adaptador Factus V2

Factus V2 será el primer adaptador de referencia porque existe acceso sandbox.

El adaptador debe encapsular:

- endpoints sandbox y producción;
- OAuth2 y refresh token;
- expiración indicada por la respuesta real;
- límite documentado de solicitudes por usuario;
- `429` y `Retry-After`;
- payloads y catálogos Factus;
- facturas, notas y artefactos realmente contratados;
- códigos y errores originales;
- consulta después de timeout;
- rangos de numeración cuando la capacidad se habilite.

No se codificará una duración fija del token: la documentación consultada contiene diferencias entre la descripción y ejemplos, por lo que prevalece el valor efectivo recibido y las reglas contractuales vigentes.

Referencias verificadas:

- https://developers.factus.com.co/
- https://developers.factus.com.co/autenticacion/auth
- https://developers.factus.com.co/limite-de-request
- https://developers.factus.com.co/facturas/crear-y-validar

El acceso prolongado al sandbox no se interpreta como plan productivo ilimitado, SLA ni derecho multi-NIT.

## Adaptador Siigo

Siigo se utilizará como segunda validación de neutralidad antes de afirmar que el módulo es multi-proveedor.

El adaptador encapsulará sus dependencias propias, entre ellas las referencias configuradas en Siigo para documentos, clientes, productos, impuestos, bodegas, usuarios o medios de pago cuando correspondan.

Esas referencias se almacenan como mappings del adaptador y no reemplazan las identidades internas de POS Platform.

Referencias verificadas:

- https://developers.siigo.com/docs/siigoapi/
- https://developers.siigo.com/docs/siigoapi/facturacion-electronica/
- https://developers.siigo.com/docs/siigoapi/invoice/1-create-invoice/

## Idempotencia y resultado incierto

1. Cada documento tiene identidad interna anterior al primer envío.
2. El payload congelado tiene checksum.
3. Reintentar conserva documento, operación e idempotency key.
4. Si el proveedor soporta idempotencia, se utiliza su mecanismo sin sustituir la deduplicación interna.
5. Si ocurre timeout después de transmitir, el estado pasa a `UNKNOWN_OUTCOME`.
6. Antes de repetir se consulta por referencia interna, externa, prefijo/número u otro mecanismo seguro disponible.
7. Si el proveedor no permite consulta inequívoca, se crea incidencia y revisión; no se emite automáticamente otro consecutivo.
8. Misma identidad con payload diferente se rechaza.
9. `FiscalSubmissionAttempt.UNKNOWN_OUTCOME` conserva incertidumbre técnica; `ElectronicDocument.UNKNOWN_OUTCOME` conserva incertidumbre fiscal autoritativa.
10. Polling, webhook validado, consulta o reconciliación pueden resolver el documento a `ACCEPTED` o `REJECTED`, pero no reescriben el attempt histórico.

## Rate limiting y backpressure

- el límite se aplica por conexión/credencial según proveedor;
- los workers comparten un presupuesto coordinado;
- `Retry-After` se respeta;
- se usa backoff con jitter;
- la cola persiste durante reinicio;
- una empresa no consume injustamente la capacidad de otra;
- la saturación fiscal no bloquea venta, caja, inventario ni impresión comercial;
- métricas muestran edad de cola, rate limit, reintentos e incidencias.

## Offline y `LOCAL_PERPETUAL`

### Sin integración fiscal contratada

- el módulo permanece deshabilitado;
- no se crean trabajos de transmisión;
- venta y ticket comercial funcionan;
- la UI no promete factura electrónica;
- no se exigen credenciales inexistentes.

### Con integración que requiere Internet

- la venta comercial se conserva;
- el documento se encola únicamente si la política legal y contractual lo permite;
- la UI muestra estado fiscal real;
- no se inventa aceptación;
- al reconectar se transmite o reconcilia conforme a política.

### Contingencia

La contingencia solo se habilita cuando:

- la empresa está configurada y autorizada para el mecanismo aplicable;
- existe numeración o requisito previo vigente;
- se registra causa, inicio y fin;
- se conserva el documento entregado;
- se programa transmisión posterior;
- se audita el responsable;
- se cumplen plazos y reglas vigentes verificados para el país y tipo documental.

Referencia general DIAN:

- https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/inconvenientes-tecnologicos/

El software no activa contingencia automáticamente solo porque una llamada excedió su timeout.

## Notas y correcciones

- una devolución comercial no modifica la factura original;
- el módulo fiscal determina si corresponde nota crédito, nota débito u otro documento permitido;
- la nota referencia el documento original y la operación comercial que la origina;
- importes y cantidades provienen de snapshots y devoluciones autorizadas;
- múltiples notas controlan saldo y cantidades elegibles;
- un refund financiero no constituye por sí solo nota fiscal;
- una nota aceptada conserva su propia identidad y artefactos.

## Seguridad

- credenciales y certificados se almacenan mediante `SEC-004`;
- renderer y PWA nunca reciben secretos fiscales;
- sandbox y producción usan secretos diferentes;
- permisos de configuración y emisión están separados;
- cambios de NIT, proveedor, ambiente, certificados o rangos requieren reautenticación y auditoría;
- tokens se renuevan centralmente y se redactan en logs;
- webhooks, si el proveedor los ofrece, requieren autenticidad, deduplicación y protección contra replay;
- XML/PDF se entregan mediante autorización temporal;
- payloads y respuestas se clasifican como datos sensibles.

## Observabilidad y auditoría

Observabilidad registra:

- latencia;
- proveedor;
- ambiente;
- código normalizado;
- HTTP status;
- reintentos;
- rate limit;
- edad de cola;
- resultado de conciliación.

Auditoría registra:

- actor;
- tenant, empresa y sucursal;
- configuración utilizada;
- documento;
- transición;
- motivo;
- aprobación o permiso;
- correlación;
- referencia de evidencia.

Ninguna registra secretos completos.

## Pruebas de neutralidad

La suite canónica se ejecutará contra:

1. adaptador fake determinista;
2. Factus sandbox;
3. adaptador Siigo o sandbox disponible;
4. fixtures sanitizados de respuestas de error;
5. estados desconocidos;
6. timeouts e idempotencia;
7. dos empresas con proveedores distintos;
8. cambio de proveedor conservando historia.

No se afirmará soporte multi-proveedor hasta completar al menos dos adaptadores sin modificar entidades de venta, impuestos, pagos o inventario.

## Criterios de aceptación

- venta y documento electrónico permanecen separados;
- configuración está aislada por tenant y empresa;
- proveedor y ambiente son explícitos;
- secretos no llegan al POS renderer;
- estados canónicos y originales coexisten;
- timeout produce reconciliación, no duplicación;
- Factus no define el modelo interno;
- un segundo adaptador usa los mismos puertos canónicos;
- notas no sobrescriben documentos aceptados;
- contingencia requiere habilitación explícita;
- `LOCAL_PERPETUAL` funciona sin proveedor fiscal;
- XML/PDF y respuestas tienen integridad, autorización y retención.
