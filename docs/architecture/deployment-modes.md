# Modos de despliegue

## Propósito

Definir qué capacidades, autoridades y obligaciones operativas corresponden a `HYBRID` y `LOCAL_PERPETUAL`.

Ambas modalidades utilizan la misma base de código, el mismo modelo de dominio y el runtime aprobado en `DEC-010`. Una modalidad no es una bifurcación del producto ni una edición técnicamente degradada.

## Principios comunes

1. El POS se instala localmente.
2. El POS Local Service es el único escritor de SQLite/WAL.
3. Una venta ordinaria autorizada se confirma localmente.
4. Venta, pagos, inventario, caja, auditoría y outbox conservan fronteras transaccionales.
5. Impresión y hardware no dependen del backend central.
6. La falta de Internet no concede permisos, licencias ni configuraciones inexistentes.
7. Una capacidad externa solo se habilita si está contratada, configurada y disponible conforme a su política.
8. Un ticket comercial no se presenta como factura electrónica validada.
9. Backups, restauración, diagnóstico y actualizaciones forman parte del producto operativo.
10. Datos históricos no se eliminan al deshabilitar un módulo o terminar una suscripción.

## `HYBRID`

### Propósito

Permitir operación física local con servicios centrales de administración, sincronización, respaldo y capacidades contratadas.

### Componentes

- POS Desktop instalado;
- POS Local Service;
- SQLite/WAL local;
- API central;
- PostgreSQL central;
- worker central;
- panel del propietario;
- sistema de sincronización;
- servicio de actualizaciones;
- observabilidad local y central;
- backups locales y centrales según política.

### Autoridad

La autoridad se define por dominio conforme a `DEC-007`:

- las operaciones de venta, caja, inventario y pagos localmente confirmables nacen en el nodo local;
- configuración, permisos, licencias, revocaciones y catálogos administrados centralmente se consumen mediante versiones locales verificables;
- un proveedor externo conserva autoridad únicamente sobre su resultado externo;
- PostgreSQL central consolida la operación sincronizada sin reescribir silenciosamente hechos locales confirmados.

### Operación sin Internet

Durante una interrupción:

- se mantienen ventas ordinarias autorizadas;
- se mantienen pagos que no exigen confirmación en línea;
- caja, inventario, impresión y hardware continúan;
- las operaciones quedan en outbox;
- el POS muestra estado offline y antigüedad de configuración;
- no se inventan aprobaciones externas;
- pagos o funciones que requieren proveedor quedan pendientes, restringidos o no disponibles según su contrato;
- cambios administrativos central-authoritative no se realizan localmente salvo caso de uso explícito.

Al recuperar conectividad:

- se autentica dispositivo e instalación;
- se reanudan colas desde checkpoints durables;
- se deduplican operaciones;
- se descargan configuraciones versionadas;
- los conflictos se registran y resuelven explícitamente;
- no se usa last-write-wins genérico;
- no se descarta una operación por usar un reloj local incorrecto.

### Servicios centrales

`HYBRID` puede habilitar:

- panel del propietario;
- multisucursal;
- consolidación central;
- backups administrados;
- actualizaciones administradas;
- soporte remoto temporal;
- facturación electrónica;
- proveedores de pago;
- notificaciones;
- reportes centrales;
- futuras capacidades contratadas.

La indisponibilidad temporal de estas capacidades no elimina datos locales ni desactiva derechos offline ya válidos.

### Licencia

- suscripción mensual, anual u otro contrato autorizado;
- entitlements versionados;
- validación central cuando existe conectividad;
- disponibilidad offline derivada de licencia, dispositivo, permisos, versiones y revocaciones conocidas;
- gracia únicamente conforme a artefacto y política firmados;
- una suspensión comercial no elimina operaciones históricas.

### Backups

- backup central automático sobre infraestructura pagada;
- PITR y export lógico conforme a `DEC-009`;
- backup local para recuperar el nodo y proteger outbox aún no sincronizado;
- restauraciones periódicas ensayadas;
- alertas por fallo, antigüedad o espacio insuficiente.

### Actualizaciones

- manifiestos y artefactos firmados;
- distribución administrada;
- ventana y canal de actualización;
- compatibilidad entre desktop, servicio, contratos y schema;
- backup local previo a migración;
- recuperación o rollback autorizado;
- la falta de Internet pospone la actualización salvo que una versión sea insegura o incompatible según política firmada.

## `LOCAL_PERPETUAL`

### Propósito

Permitir que un cliente adquiera el software para una versión y alcance contratados, sin dependencia permanente del backend de POS Platform.

### Componentes obligatorios

- POS Desktop instalado;
- POS Local Service;
- SQLite/WAL local;
- usuarios, roles y permisos necesarios para operar;
- catálogo, precios e impuestos aplicables;
- inventario;
- caja y arqueos;
- ventas y pagos locales;
- devoluciones autorizadas;
- auditoría;
- impresión y hardware;
- backup y restauración;
- licencia verificable offline;
- diagnóstico local;
- mecanismo de actualización offline firmado.

### Autoridad

El nodo local es autoridad operacional dentro del alcance contratado. No requiere consultar diariamente un servidor para:

- iniciar el POS;
- autenticar usuarios locales autorizados;
- abrir o cerrar caja;
- vender;
- registrar pagos locales;
- mover inventario;
- imprimir;
- consultar historia local;
- crear backups.

La modalidad perpetua no convierte en locales capacidades cuya autoridad pertenece legal o técnicamente a un proveedor externo.

### Licencia

- autoriza uso permanente dentro de la versión y alcance contratados;
- se verifica mediante artefactos firmados;
- no se transforma automáticamente en suscripción;
- no incluye automáticamente actualizaciones mayores;
- puede incluir correcciones o actualizaciones de seguridad según contrato;
- no se invalida por ausencia ordinaria de Internet;
- el reemplazo de dispositivo sigue un procedimiento autorizado;
- copiar archivos a otro equipo no duplica automáticamente una activación válida.

### Sin backend central

El sistema mantiene estabilidad si nunca se configura un backend central:

- outbox central puede permanecer deshabilitado por modalidad;
- no se acumulan reintentos infinitos hacia un servicio inexistente;
- la UI no muestra alarmas falsas de sincronización obligatoria;
- reportes operan sobre datos locales;
- los trabajos asíncronos locales conservan sus propias colas;
- soporte y actualización utilizan paquetes controlados;
- no se ejecutan llamadas de telemetría no autorizadas.

### Facturación electrónica

Facturación electrónica es una capacidad separada:

- puede no estar contratada;
- puede requerir Internet y un proveedor habilitado;
- puede integrarse posteriormente sin migrar ventas a otro modelo;
- una venta y un ticket comercial siguen siendo operables sin proveedor fiscal;
- el sistema no declara validez fiscal inexistente;
- si el cliente está obligado legalmente a facturar electrónicamente, debe configurar un mecanismo autorizado o su contingencia aplicable;
- la modalidad local no constituye excepción normativa.

Las credenciales fiscales no se incluyen en el instalador general ni se almacenan en el renderer.

### Backups

El cliente dispone de:

- programación configurable;
- destino local separado del archivo activo;
- opción de medio externo o ubicación administrada por el cliente;
- backup consistente con WAL;
- cifrado según política de seguridad;
- manifiesto y checksum;
- retención por generaciones;
- verificación y restauración guiada;
- alertas visibles;
- backup obligatorio antes de migraciones.

La responsabilidad operativa del cliente sobre medios locales se documenta contractualmente, pero POS Platform debe proporcionar mecanismos verificables y no limitarse a recomendar copias manuales.

### Actualizaciones

- paquetes offline firmados;
- verificación previa a instalar;
- validación de compatibilidad;
- backup previo;
- migración versionada;
- evidencia de resultado;
- recuperación o rollback permitido;
- ninguna actualización amplía derechos;
- una versión no soportada se informa sin borrar datos ni bloquear exportación autorizada.

### Soporte

El soporte puede operar mediante:

- paquete de diagnóstico sanitizado;
- logs estructurados redactados;
- export de estado y versiones;
- sesión temporal autorizada cuando exista conectividad;
- procedimiento presencial o asistido;
- recuperación mediante backup;
- reemplazo controlado de dispositivo.

No existe acceso maestro permanente ni credencial universal de soporte.

## Matriz de capacidades

| Capacidad | `HYBRID` offline | `HYBRID` conectado | `LOCAL_PERPETUAL` | Servicio externo requerido |
|---|---|---|---|---|
| Venta ordinaria | Sí | Sí | Sí | No |
| Caja y arqueo | Sí | Sí | Sí | No |
| Inventario local | Sí | Sí | Sí | No |
| Impresión local | Sí | Sí | Sí | No |
| Hardware local | Sí | Sí | Sí | No |
| Sincronización central | En cola | Sí | No, salvo contratación | Sí |
| Panel central | No | Sí | No, salvo contratación | Sí |
| Consolidación multisucursal | Diferida | Sí | No, salvo solución contratada | Sí |
| Pago externo en línea | Según proveedor | Sí | Según integración | Sí |
| Facturación electrónica | Contingencia o pendiente según política | Según proveedor | Solo si se configura | Sí, salvo solución legal local autorizada |
| Backup local | Sí | Sí | Sí | No |
| Backup central | No durante la caída | Sí | No, salvo contratación | Sí |
| Actualización administrada | Diferida | Sí | No | Sí |
| Actualización offline firmada | Sí | Sí | Sí | No para instalar el paquete obtenido |

## Cambio de modalidad

Un cambio entre modalidades:

- no crea un nuevo producto ni una base de código distinta;
- requiere decisión contractual y de licencia;
- conserva historia, auditoría e identidades;
- no duplica tenant, empresa, sucursal o dispositivo sin caso explícito;
- verifica compatibilidad de schema;
- reconcilia outbox e inbox cuando se habilita sincronización;
- no elimina datos al deshabilitar servicios centrales;
- registra actor, motivo, fecha y alcance;
- dispone de rollback operacional cuando la migración no se haya consolidado.

## Feature flags y entitlements

Las diferencias funcionales se derivan de:

- deployment mode;
- licencia;
- entitlements;
- configuración;
- versión compatible;
- permisos;
- estado del dispositivo;
- disponibilidad del proveedor.

Un feature flag no sustituye autorización ni licencia. La UI oculta o deshabilita funciones, pero el servicio local y la API vuelven a validar la decisión efectiva.

## Criterios de aceptación

### `HYBRID`

- confirma una venta con backend desconectado;
- sincroniza al reconectar sin duplicar efectos;
- conserva outbox después de reinicio;
- aplica revocaciones y configuración versionadas;
- restaura PostgreSQL y un nodo local mediante procedimientos probados;
- una caída central no corrompe caja ni inventario local.

### `LOCAL_PERPETUAL`

- instala y opera sin configurar backend central;
- reinicia sin Internet;
- valida licencia offline;
- vende, imprime, ajusta inventario y cierra caja;
- crea y restaura backup consistente;
- instala un paquete de actualización offline firmado;
- no realiza llamadas centrales obligatorias ocultas;
- no presenta tickets como facturas electrónicas sin validación.

## Regla final

`HYBRID` y `LOCAL_PERPETUAL` son modalidades productivas reales. Ninguna depende de una PWA como autoridad local, de una base gratuita ni de conectividad permanente para ejecutar el núcleo físico contratado.
