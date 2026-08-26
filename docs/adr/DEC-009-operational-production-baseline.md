# DEC-009: Línea base operacional y productiva

## Estado

Cerrada para diseño e implementación de la fundación técnica.

Los SLA contractuales, límites comerciales de carga y hardware certificado requieren evidencia de benchmark y piloto. No se publicarán valores no medidos.

## Prioridad

`P0` para la fundación operacional.

## Contexto

POS Platform se ofrecerá a clientes que pagan por una instalación local perpetua, por servicios híbridos o por capacidades adicionales. La infraestructura gratuita puede facilitar pruebas y sandbox, pero no proporciona la disponibilidad, persistencia, recuperación, soporte ni responsabilidad necesarias para operar datos reales.

La arquitectura local-first reduce la dependencia de la nube, pero no elimina la obligación de operar profesionalmente el backend central, las bases, los backups, las actualizaciones y el soporte.

## Decisión principal

Ningún entorno que procese datos reales de clientes se ejecutará sobre planes gratuitos, bases efímeras, servicios que entren en suspensión por inactividad o infraestructura sin backup y recuperación verificables.

La primera plataforma central puede desplegarse en Render pagado mientras cumpla todos los controles de esta decisión. El producto conservará portabilidad para migrar a otro proveedor sin reescribir dominio, persistencia ni contratos.

## Clasificación de entornos

| Entorno | Datos permitidos | Infraestructura | Proveedores externos | Uso |
|---|---|---|---|---|
| `DEVELOPMENT` | Sintéticos | Local o efímera | Mocks | Desarrollo individual |
| `CI` | Sintéticos y deterministas | Efímera/Testcontainers | Mocks o fixtures | Validación automatizada |
| `SANDBOX` | Sintéticos | Gratuita o pagada, aislada | Sandbox oficial | Pruebas de integración |
| `STAGING` | Sintéticos o sanitizados | Pagada | Sandbox oficial | Ensayo previo a release |
| `PILOT` | Reales de clientes autorizados | Productiva pagada | Producción contratada | Piloto controlado |
| `PRODUCTION` | Reales | Productiva pagada | Producción contratada | Operación comercial |

Reglas:

1. No se copian datos productivos sin sanitización a desarrollo, CI, sandbox o staging.
2. Credenciales, rangos fiscales, buckets, bases, claves y dominios se separan por entorno.
3. `SANDBOX` no demuestra por sí solo disponibilidad ni equivalencia con producción.
4. `PILOT` aplica los mismos controles de protección de datos que producción.
5. Una variable `ENVIRONMENT=production` no convierte un recurso gratuito en producción válida.

## Perfil central productivo

El perfil mínimo para piloto o producción incluye:

```text
entrada TLS administrada
    │
    ├── API stateless — dos o más instancias cuando se declare alta disponibilidad
    ├── worker asíncrono independiente
    ├── PostgreSQL administrado y pagado
    ├── almacenamiento de objetos pagado
    ├── observabilidad y alertas
    └── backups y recuperación fuera del proceso de aplicación
```

### API

- instancias stateless;
- health y readiness checks diferenciados;
- despliegue gradual o con rollback;
- shutdown ordenado;
- límites de memoria, CPU, request y concurrencia;
- secretos desde un mecanismo administrado;
- sin archivos persistentes en el filesystem del contenedor;
- rate limiting y protección de abuso;
- logs estructurados y correlacionados;
- compatibilidad con ejecución en más de un proveedor.

Una sola instancia puede utilizarse únicamente en staging o en un piloto que no prometa alta disponibilidad y cuya operación local continúe durante la caída central. No puede promocionarse como arquitectura redundante.

### Workers

Los procesos asíncronos se despliegan separados de la API para:

- sincronización;
- notificaciones;
- procesamiento fiscal;
- exports;
- reconciliaciones;
- mantenimiento controlado.

Un worker:

- es idempotente;
- soporta shutdown ordenado;
- conserva lease o checkpoint;
- no confirma mensajes antes de persistir resultado;
- expone métricas de edad, reintentos y dead letter;
- no convierte un retry en nueva operación lógica.

### PostgreSQL

PostgreSQL productivo será:

- administrado;
- pagado;
- accesible por red privada cuando la plataforma lo permita;
- cifrado en tránsito;
- protegido mediante credenciales rotables;
- configurado con pooling;
- monitorizado por conexiones, locks, latencia, almacenamiento y errores;
- respaldado mediante PITR;
- complementado con exports lógicos para retención y portabilidad;
- restaurado periódicamente en un entorno aislado;
- actualizado mediante migraciones controladas.

Cuando se declare alta disponibilidad, la base deberá tener failover administrado y el cliente deberá reconectar con retry acotado. La replicación asíncrona no se presentará como garantía absoluta de cero pérdida ante fallo de infraestructura.

### Almacenamiento de objetos

XML, PDF, exports, respaldos lógicos y artefactos extensos se almacenan en un servicio compatible con S3 que proporcione:

- cifrado;
- control de acceso;
- versionado o protección equivalente cuando aplique;
- lifecycle explícito;
- checksum;
- auditoría de acceso;
- separación por entorno;
- procedimiento de exportación.

El bucket no es público por defecto. La aplicación entrega acceso temporal y autorizado cuando corresponda.

## Render

Render es admisible para staging, piloto y producción únicamente bajo estas condiciones:

- servicios y bases pagados;
- ninguna dependencia productiva en instancias `free`;
- API stateless;
- worker separado;
- PostgreSQL pagado con PITR;
- alta disponibilidad cuando sea requisito comercial;
- backups lógicos exportados;
- health checks;
- monitoreo externo desde fuera de Render;
- región seleccionada mediante benchmark desde Colombia;
- plan de salida probado documentalmente;
- SLA contractual de Render cuando POS Platform prometa un SLA dependiente de la nube.

No se fijará Oregon por herencia. Se medirán las regiones disponibles candidatas y se seleccionará la que cumpla latencia, soporte y residencia aplicables.

Referencias verificadas al cerrar esta decisión:

- https://render.com/docs/free
- https://render.com/docs/regions
- https://render.com/docs/postgresql-high-availability
- https://render.com/docs/postgresql-backups
- https://render.com/docs/uptime-best-practices

Las capacidades comerciales del proveedor pueden cambiar; deberán verificarse nuevamente antes de contratar o renovar producción.

## RPO y RTO

Se separan cuatro eventos distintos:

1. crash del proceso local;
2. pérdida o daño del equipo local;
3. caída de servicios centrales;
4. pérdida o corrupción de datos centrales.

### Invariantes decididos

- Una venta local confirmada no se pierde por crash del renderer o servicio.
- La recuperación del proceso local no duplica operaciones.
- Una caída central no bloquea una venta ordinaria autorizada.
- Una restauración no adelanta checkpoint ni descarta outbox pendiente.
- Todo backup debe poder restaurarse; crear archivos sin ensayar restauración no cumple el requisito.
- Una migración local crea una salvaguarda previa verificable.
- La pérdida física del equipo solo puede recuperarse hasta el último backup válido disponible; la interfaz debe comunicar esa realidad.

### Valores contractuales

Los valores numéricos de RPO y RTO se fijarán por modalidad después de ejecutar y conservar evidencia de:

- crash recovery;
- restauración de SQLite;
- restauración de PostgreSQL mediante PITR;
- restauración desde export lógico;
- reemplazo de dispositivo;
- volumen de datos representativo;
- degradación de red;
- fallo regional o simulación equivalente.

Hasta entonces, ningún documento comercial puede prometer minutos u horas específicos.

## Backup local

`LOCAL_PERPETUAL` y cada nodo `HYBRID` requieren:

- política configurable administrativamente;
- destino local diferente del archivo activo;
- opción de destino externo o administrado;
- cifrado cuando el backup abandona el equipo o contiene datos sensibles;
- manifiesto con versión, checksum, fecha y alcance;
- retención por generaciones;
- verificación posterior a creación;
- restauración ensayada;
- alerta por antigüedad o fallo;
- backup previo a migraciones destructivas o incompatibles.

No se copiará directamente una base SQLite activa ignorando WAL y estado transaccional. El mecanismo utilizará una operación consistente soportada por SQLite.

Las claves privadas de dispositivo y secretos no se incluyen en backups ordinarios sin una política criptográfica específica.

## Retención

Hasta definir obligaciones contractuales y regulatorias por país y capacidad:

- ventas confirmadas no se eliminan automáticamente;
- pagos, refunds, reversals y caja no se eliminan automáticamente;
- movimientos de inventario no se eliminan automáticamente;
- auditoría crítica no se elimina automáticamente;
- inbox confirmado, outbox y checkpoints conservan la evidencia mínima necesaria para deduplicación y recuperación;
- documentos fiscales siguen su política legal específica;
- logs operativos tienen retención separada de auditoría;
- secretos y tokens no se conservan como histórico.

La política definitiva establecerá periodos medidos y procedimiento de legal hold, exportación y terminación del servicio sin convertir logs en archivo fiscal o contable.

## Hardware de referencia

El soporte inicial se limita a Windows 10 y 11 de 64 bits, conforme a los RNF vigentes.

Antes de publicar un mínimo contractual se probarán al menos:

- un equipo de referencia de capacidad baja admitida;
- un equipo recomendado;
- almacenamiento SSD;
- catálogo de hasta 100.000 variantes según `RNF-PER-003`;
- SQLite/WAL con historial representativo;
- lector HID;
- impresora ESC/POS;
- cajón;
- balanza serial o USB/serial;
- reinicio y corte durante operaciones;
- backup, restauración y actualización.

La matriz de hardware registrará CPU, memoria, almacenamiento, sistema operativo, resolución, drivers y resultados. Hasta completar esa evidencia se hablará de hardware candidato, no certificado.

## Capacidad y escalabilidad

El diseño físico no inventará particionado ni microservicios para volúmenes no medidos. Sí debe:

- indexar FKs, aislamiento y consultas críticas;
- incluir claves temporales y de tenant en tablas de alto crecimiento;
- separar trabajos pesados del camino de venta;
- paginar APIs y paneles;
- limitar lotes de sincronización;
- evitar consultas N+1;
- medir planes de consulta;
- probar concurrencia de cajas;
- permitir escalar horizontalmente API y workers;
- documentar saturación y backpressure.

Los límites comerciales se fijan después de k6, pruebas de base, sincronización y piloto. Un resultado de laboratorio no se extrapola sin margen y evidencia.

## Observabilidad

Producción requiere:

- métricas, logs y trazas estructuradas;
- monitoreo externo de disponibilidad;
- alertas de API, base, workers, colas y almacenamiento;
- alertas locales de backup, disco, impresión, sincronización y actualización;
- paneles por entorno;
- correlación sin exponer secretos;
- runbooks de diagnóstico y recuperación;
- registro de versión desplegada;
- evidencia de incidentes y acciones.

OpenTelemetry es la instrumentación portable. El proveedor final de almacenamiento o visualización puede cambiar sin modificar el dominio.

## Despliegue y rollback

1. Todo artefacto se construye en CI.
2. No se compila directamente en producción.
3. Las migraciones se ejecutan como paso controlado y observable.
4. El despliegue comprueba readiness antes de recibir tráfico.
5. Un binario anterior solo se restaura si comprende el esquema activo.
6. Cambios incompatibles usan expansión, migración y contracción cuando sea necesario.
7. Los secretos no se hornean en imágenes.
8. Producción conserva identidad exacta del commit y artefacto.
9. El rollback se ensaya en staging.
10. Una configuración de demo no se promueve a producción.

## Portabilidad y salida

La salida de Render u otro proveedor debe ser posible mediante:

- imágenes OCI/Docker;
- PostgreSQL estándar;
- exports lógicos;
- objetos compatibles con S3;
- OpenTelemetry;
- configuración por entorno;
- DNS y certificados controlados;
- inventario de secretos;
- runbook de migración;
- prueba periódica de restauración fuera del servicio primario.

No se introducirá una dependencia propietaria sin documentar costo de salida y alternativa.

## Prohibiciones

- datos reales en bases gratuitas;
- producción en servicios que se duermen;
- SQLite productivo dentro de un filesystem efímero de nube;
- una sola copia de backup en la misma frontera de fallo;
- backup no restaurado nunca;
- credenciales compartidas entre entornos;
- sandbox fiscal con datos reales;
- declarar HA con una sola instancia;
- prometer SLA sin contrato y medición;
- usar el backend central como requisito para venta local ordinaria;
- presentar configuración de laboratorio o demo como producción de POS Platform.

## Criterios de cierre

La decisión queda cerrada para iniciar la fundación porque define:

1. separación de entornos;
2. prohibición inequívoca de recursos gratuitos con datos reales;
3. perfil central productivo;
4. requisitos de API, workers, PostgreSQL y object storage;
5. condiciones de uso de Render;
6. tratamiento honesto de RPO, RTO y SLA;
7. backup local y central;
8. retención transitoria segura;
9. benchmark y certificación de hardware;
10. observabilidad, despliegue, rollback y portabilidad.

Los valores contractuales quedan deliberadamente sujetos a evidencia. Esa condición no bloquea `TECH-002`, pero sí bloquea publicar SLA, certificar hardware o lanzar producción sin completar benchmarks, restauraciones y piloto.
