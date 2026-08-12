# Estrategia de pruebas

## Objetivo

Garantizar que las funciones críticas del POS sean correctas, seguras, recuperables y resistentes a fallos.

Esta estrategia aplica al stack objetivo definido en `ADR-005`:

- Vitest para pruebas unitarias, de aplicación e integración TypeScript;
- Playwright para flujos E2E de Electron y web;
- Testcontainers para PostgreSQL y dependencias reproducibles;
- SQLite persistente en WAL para el nodo local;
- k6 para carga de API y sincronización.

Pytest, SQLAlchemy y Alembic pertenecen exclusivamente a la línea base heredada mientras se complete su migración. Sus pruebas conservan valor de regresión, pero no sustituyen las suites del producto objetivo.

## Pirámide de pruebas

### Pruebas unitarias

Validan reglas aisladas:

- cálculo de subtotal;
- impuestos;
- descuentos;
- cambio;
- costo promedio;
- conversión de unidades;
- peso;
- FEFO;
- FIFO;
- límites de crédito;
- efectivo esperado;
- estados de licencia;
- permisos.

### Pruebas de integración

Validan módulos y persistencia:

- venta con inventario;
- venta con caja;
- compra con recepción;
- devolución;
- anulación;
- cierre de caja;
- multiempresa;
- multisucursal;
- sincronización;
- auditoría;
- licencia;
- dispositivo.

Las pruebas de persistencia se ejecutan en dos suites diferenciadas:

- PostgreSQL 16 para esquema central, migraciones, constraints, locks e índices;
- SQLite/WAL para esquema local, transacción negocio+outbox, crash recovery y compatibilidad offline.

SQLite en memoria no sustituye PostgreSQL ni una base SQLite persistente en WAL.

### Pruebas E2E

Validan flujos completos:

- iniciar sesión;
- abrir caja;
- registrar venta;
- cobrar;
- imprimir;
- suspender venta;
- recuperar venta;
- devolver;
- cerrar caja;
- consultar dashboard;
- registrar compra;
- recibir inventario.

Los flujos físicos se ejecutan contra el runtime Electron y POS Local Service, no únicamente contra una página web o un API aislado.

### Pruebas de contrato

Validan compatibilidad entre:

- POS y API;
- panel del propietario y API;
- app del domiciliario y API;
- app del comprador y API;
- hardware agent y POS;
- sincronización local y backend;
- Electron main y POS Local Service;
- schemas de eventos entre versiones compatibles;
- API central y adaptadores de proveedores externos;
- documentos electrónicos y sandbox fiscal cuando su módulo esté habilitado.

Las pruebas de contrato incluyen versión compatible, versión incompatible, campos desconocidos, payload inválido, duplicado, timeout, resultado incierto y rate limiting.

## Seguridad

Se deben probar como mínimo:

- acceso entre tenants;
- acceso entre sucursales;
- manipulación de identificadores;
- escalamiento de privilegios;
- cambio no autorizado de precios;
- modificación no autorizada de QR;
- acceso a costos por cajero;
- reutilización de tokens;
- fuerza bruta;
- expiración de sesión;
- revocación de dispositivo;
- IDOR;
- BOLA;
- inyección;
- payloads inválidos;
- exportación no autorizada.

### Evidencia de los security gates

`docs/security/security-gates.md` es la autoridad para `SEC-G01` a `SEC-G10`. Cada suite aplicable debe mantener la relación:

`amenaza → control → test_id → resultado → evidencia`

La evidencia mínima identifica commit, artefacto, ambiente, plataforma, configuración/policy version, datos sintéticos de entrada, resultado esperado/real, código estable, persistencia y auditoría. No contiene secretos ni datos reales de clientes.

Cobertura futura mínima por gate:

| Gate | Suite/evidencia principal |
|---|---|
| `SEC-G01` | integración cross-tenant, constraints y RLS PostgreSQL; aislamiento SQLite cuando aplique |
| `SEC-G02` | autenticación, rotación/replay de refresh, revocación, MFA, reautenticación, bloqueo y recuperación |
| `SEC-G03` | permisos backend, scopes ABAC, deny by default, límites y segregación de funciones |
| `SEC-G04` | dispositivo, instalación, claves, activación, revocación, reemplazo, tiempo, licencia y gracia |
| `SEC-G05` | SQLite/WAL + PostgreSQL para outbox/inbox, idempotencia, replay, orden, conflicto y recovery |
| `SEC-G06` | auditoría append-only, fallo transaccional, atribución, aislamiento y reglas antifraude |
| `SEC-G07` | secret scanning, redacción, aislamiento, rotación/revocación, criptografía y backup seguro |
| `SEC-G08` | validación, IDOR/BOLA, inyección, XSS, CSRF aplicable, CSP/headers, CORS, SSRF, límites y webhooks |
| `SEC-G09` | TLS/endurecimiento, privilegios, scanning, SBOM, pipeline, backup/restore, DR y updates |
| `SEC-G10` | evaluación agregada, provenance y bloqueo efectivo de promoción |

Una inspección visual, mock aislado o prueba heredada no sustituye la evidencia ejecutable del stack objetivo. Los gates permanecen `NOT_EVALUATED` hasta que existan sus suites reales.

## Integridad transaccional

Casos obligatorios:

1. Venta confirmada con todos sus efectos.
2. Fallo antes del commit.
3. Fallo después de guardar venta, pero antes de imprimir.
4. Doble clic en cobrar.
5. Reintento de red.
6. Operación repetida con misma idempotency key.
7. Falta de stock durante concurrencia.
8. Reinicio del equipo durante una venta.
9. Sincronización duplicada.
10. Conflicto de precio.
11. Dos memberships concurrentes para el mismo User/Tenant.
12. FK cruzada entre tenant, empresa y sucursal.
13. Dos turnos abiertos incompatibles.
14. Dos reservas consumiendo la misma disponibilidad.
15. Dos refunds consumiendo el mismo saldo elegible.
16. Dos activaciones consumiendo el último cupo de licencia.
17. Misma idempotency key con checksum diferente.
18. Checkpoint que no avanza antes del commit.
19. Fallo de auditoría u outbox revierte la operación principal.
20. Tenant parcialmente creado después de rollback o crash.
21. Renderer cerrado después del commit y antes de mostrar respuesta.
22. POS Local Service reiniciado con WAL y outbox pendientes.
23. Dos instancias del servicio intentan abrir la misma base como escritor.
24. Disco lleno antes y durante el commit.
25. Trabajo de impresión reintentado sin repetir la venta.
26. Versión de desktop incompatible con versión del servicio.
27. Migración local fallida con recuperación desde salvaguarda previa.

## Offline y sincronización

Probar:

- venta sin Internet;
- recuperación de conexión;
- cola pendiente;
- eventos fuera de orden;
- reintentos;
- duplicados;
- dispositivo con hora incorrecta;
- sincronización parcial;
- servidor temporalmente caído;
- conflicto entre sucursales;
- restauración de cola.

### Dead letter

La implementación futura de `PHY-G11` requiere suites diferenciadas:

PostgreSQL:

- FK tenant-aware a SyncOperation y referencias opcionales a Outbox/Inbox/Conflict;
- una sola SyncDeadLetter por operation;
- lifecycle, permisos, MFA/segregación y expected version;
- dos revisores concurrentes, dos retries simultáneos y archive vs retry;
- Inbox+efecto atómicos y ausencia de doble efecto.

SQLite/WAL:

- agotamiento, persistencia y recuperación después de reinicio;
- referencia al payload original sin copia o mutación;
- retry con mismo operation/idempotency/checksum/causalidad;
- reingreso reutiliza DeadLetter;
- dependientes causalmente bloqueados y resolución central recibida offline.

Integración:

- servidor aplicó pero ACK se perdió: Inbox devuelve resultado y no se crea dead letter falsa;
- replay, checksum distinto, payload/schema/firma inválidos;
- cross-tenant y dispositivo revocado;
- operación inválida exige operación nueva en lugar de mutación;
- eventos y auditoría sin payload ni secretos.

Cada prueba de seguridad conserva trazabilidad con `SEC-G01`, `SEC-G03`, `SEC-G04`, `SEC-G05`, `SEC-G06`, `SEC-G08` y `SEC-G10`. La documentación de la suite no cambia esos gates de `NOT_EVALUATED`.

## Hardware

Probar con simuladores y dispositivos reales:

- lector USB HID;
- impresora ESC/POS;
- impresora desconectada;
- falta de papel;
- cajón sin respuesta;
- balanza serial;
- balanza inestable;
- puerto COM incorrecto;
- desconexión durante lectura.

Cada resultado se registra en la matriz de hardware con equipo, firmware, driver, sistema operativo, protocolo y evidencia. Un simulador permite validar el contrato; solo una prueba con equipo real puede producir estado `LAB_VALIDATED` o `CERTIFIED`.

## Runtime local y Windows

Probar como mínimo:

- instalación limpia en Windows 10 y 11 de 64 bits;
- inicio automático del servicio;
- ejecución con usuario sin privilegios administrativos;
- ACL del named pipe;
- intento de conexión por usuario no autorizado;
- `contextIsolation`, sandbox y `nodeIntegration` deshabilitado en renderer;
- preload sin APIs genéricas de filesystem, shell o IPC;
- cierre y reapertura del renderer;
- reinicio del servicio;
- reinicio del sistema operativo;
- bloqueo y desbloqueo de sesión;
- dos usuarios de Windows cuando el perfil lo soporte;
- actualización de desktop y servicio;
- incompatibilidad de protocolo;
- desinstalación sin borrado accidental de datos;
- reinstalación y recuperación autorizada.

## Backup, restauración y actualización

Casos obligatorios:

1. backup SQLite consistente con WAL activo;
2. backup previo a migración;
3. checksum inválido;
4. destino sin espacio;
5. destino desconectado;
6. backup cifrado cuando aplique;
7. restauración en instalación aislada;
8. restauración con outbox pendiente;
9. PITR de PostgreSQL en entorno aislado;
10. restauración desde export lógico;
11. actualización firmada válida;
12. firma inválida;
13. paquete truncado;
14. migración incompatible;
15. fallo durante actualización;
16. rollback permitido;
17. rollback prohibido por incompatibilidad de schema;
18. actualización offline de `LOCAL_PERPETUAL`.

Crear un backup sin demostrar restauración no satisface la prueba.

## Proveedores externos y fiscalidad

Cuando una integración esté habilitada se prueban:

- autenticación y renovación de credenciales;
- credenciales inválidas o revocadas;
- separación sandbox/producción;
- timeout antes y después de aceptación externa;
- consulta posterior a resultado incierto;
- respuesta `429` y `Retry-After`;
- respuesta `5xx`;
- payload rechazado;
- estado desconocido del proveedor;
- idempotencia propia o compensación cuando no exista;
- reconciliación;
- redacción de secretos;
- cambio de versión del proveedor;
- aislamiento por tenant, empresa y NIT;
- proveedor alternativo mediante la misma suite canónica;
- contingencia cuando sea legal y funcionalmente aplicable;
- aislamiento entre estado de `ElectronicDocument`, `FiscalSubmissionAttempt`, `FiscalIncident`, `FiscalReconciliation` y estado externo original;
- transiciones válidas e inválidas de las cuatro máquinas internas;
- attempt `COMPLETED` con resultado normalizado aceptado o rechazado;
- attempt y documento `UNKNOWN_OUTCOME` resueltos sin reescribir el attempt histórico;
- webhook duplicado, fuera de orden, anterior a respuesta síncrona y con firma inválida;
- dos workers sobre el mismo documento;
- polling, webhook y retry concurrentes;
- intención fiscal única y misma idempotency key con checksum distinto;
- correctivo causado por SaleReturn sin modificar original ni mezclar Refund/Reversal;
- artefacto con checksum, autorización, tenant y retención;
- persistencia SQLite de intención, snapshots y outbox tras reinicio y reconexión sin doble emisión.

Las suites contra sandbox no usan datos reales ni se presentan como certificación productiva.

## Rendimiento

Objetivos iniciales:

- agregar producto: menos de 1 segundo;
- confirmar venta local: menos de 2 segundos;
- búsqueda de producto: respuesta perceptiblemente inmediata;
- arranque del POS: menos de 10 segundos;
- actualización del dashboard: pocos segundos con conexión;
- reportes pesados: no bloquear el POS.

La medición conserva hardware, sistema operativo, versión, tamaño de base, catálogo, concurrencia y percentiles. Un promedio aislado no se convierte en SLA.

k6 valida al menos:

- autenticación central;
- carga y descarga de sincronización;
- onboarding;
- consultas del panel;
- límites por tenant;
- backpressure de workers;
- comportamiento ante `429`;
- degradación controlada de dependencias.

## Datos de prueba

Se utilizarán:

- fixtures deterministas;
- factories;
- bases aisladas;
- datos sintéticos;
- tenants separados;
- productos unitarios y pesables;
- lotes vencidos y vigentes;
- cajas abiertas y cerradas.

No se usarán datos reales de clientes en pruebas.

Los fixtures incluyen UUID v7, dos tenants con empresas y sucursales distintas, IDs humanos repetidos entre scopes permitidos, SKU duplicado prohibido dentro de empresa, pagos mixtos, lotes por presentación, relojes locales incorrectos y versiones de política por dominio.

## Cobertura

La cobertura no será el único indicador.

Las áreas críticas deben tener:

- pruebas positivas;
- pruebas negativas;
- pruebas de permisos;
- pruebas de concurrencia;
- pruebas de recuperación.

## CI

Cada pull request deberá ejecutar:

- lint;
- type checking;
- unit tests;
- integration tests;
- security checks;
- dependency audit;
- license audit;
- migration validation;
- contract compatibility;
- build reproducible;
- generación de artefactos de prueba.

La validación de migraciones incluye:

1. upgrade desde base vacía;
2. upgrade desde `001_initial_schema.py` con datos heredados representativos;
3. downgrade cuando la revisión sea reversible;
4. ejecución repetida sin efectos duplicados;
5. verificación de FKs, UNIQUE, CHECK y NOT NULL;
6. reconciliación de conteos, dinero e inventario;
7. compilación y validación de migraciones Kysely en el adaptador correspondiente;
8. detección de drift entre modelos y migraciones.

La arquitectura objetivo valida por separado:

- migraciones PostgreSQL;
- migraciones SQLite;
- compatibilidad lógica compartida;
- diferencias físicas intencionales;
- upgrade desde la versión productiva anterior;
- migración desde la línea base heredada.

Las pruebas heredadas de SQLAlchemy/Alembic se ejecutan únicamente mientras sean necesarias para verificar lectura, reconciliación y migración de datos antiguos.

## Matriz por entorno

| Suite | Desarrollo | CI | Sandbox | Staging | Piloto/producción |
|---|---|---|---|---|---|
| Unitarias | Sí | Sí | No requerida | No requerida | No |
| Integración PostgreSQL | Opcional | Sí | Sí | Sí | Smoke no destructivo |
| SQLite/WAL | Sí | Sí | Sí | Sí | Diagnóstico no destructivo |
| E2E web/Electron | Sí | Sí | Sí | Sí | Smoke controlado |
| Proveedor mock | Sí | Sí | Sí | Sí | No |
| Proveedor sandbox | Opcional | Programada | Sí | Sí | No |
| Proveedor producción | No | No | No | No | Smoke autorizado |
| Carga | Local reducida | Programada | No | Sí | Solo ventana autorizada |
| Restauración | Local | Programada | Sí | Sí | Simulacro aislado |

## Gates de release

Un release no puede promoverse cuando:

- falla una suite crítica;
- existe migración no probada;
- cambia un contrato sin matriz de compatibilidad;
- el instalador o actualización no tiene firma válida;
- no existe procedimiento de rollback o recuperación aplicable;
- una dependencia crítica tiene vulnerabilidad no aceptada;
- no puede reproducirse el artefacto desde el commit identificado;
- staging utiliza una topología incompatible con producción sin justificación;
- se pretende usar sandbox o infraestructura gratuita con datos reales.

Además, `SEC-G10` bloquea la promoción cuando un gate de seguridad aplicable está en `FAIL`, `BLOCKED` o `NOT_EVALUATED`, cuando un `NOT_APPLICABLE` carece de justificación aprobada, o cuando existe una vulnerabilidad crítica conocida sin tratamiento válido y trazable.

Compilar, construir y superar pruebas funcionales no basta para declarar una funcionalidad crítica `DONE` o una versión apta para producción.

No se permitirá fusionar cambios críticos con pruebas fallidas.
