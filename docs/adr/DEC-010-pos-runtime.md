# DEC-010: Runtime productivo del POS y evolución del frontend

## Estado

Cerrada.

## Prioridad

`P0`.

## Contexto

El POS debe operar en comercios físicos con Windows, conectividad intermitente, SQLite local, lector, impresora térmica, cajón y balanza. También debe soportar licencias `HYBRID` y `LOCAL_PERPETUAL` desde una sola base de código.

Una aplicación web instalada como PWA no constituye por sí sola una frontera suficiente para controlar la base local autoritativa, el ciclo de vida de un servicio de Windows, los secretos del dispositivo, la impresión persistente, los puertos de hardware y las actualizaciones firmadas.

La interfaz heredada HTML/JavaScript tampoco implementa los límites requeridos. Es necesario fijar la topología productiva antes de crear el nuevo frontend y el servicio local.

## Decisión

El POS productivo será una aplicación de escritorio Electron con renderer React. Toda autoridad local residirá en un servicio de Windows independiente implementado con Node.js y TypeScript.

La PWA se utilizará únicamente como laboratorio del POS o como capacidad web central que no controle hardware ni persistencia local autoritativa.

## Topología de procesos

```text
Renderer React
    │
    │ API allowlisted expuesta por preload
    ▼
Electron main process
    │
    │ canal local autenticado y versionado
    ▼
POS Local Service — Windows Service
    ├── casos de uso locales
    ├── SQLite/WAL
    ├── outbox/inbox
    ├── impresión
    ├── hardware
    ├── sincronización
    ├── backups
    ├── licencias/dispositivo
    └── actualización y diagnóstico
```

## Responsabilidades

### Renderer React

El renderer:

- presenta la interfaz;
- captura intención del usuario;
- muestra estados confirmados por el servicio local;
- conserva únicamente estado visual recuperable;
- no decide reglas financieras, fiscales, de inventario, licencias ni permisos;
- no abre SQLite;
- no usa drivers de hardware;
- no lee secretos;
- no invoca procesos del sistema operativo;
- no escucha puertos locales.

La configuración obligatoria de Electron será:

- `contextIsolation: true`;
- `nodeIntegration: false`;
- sandbox del renderer habilitado;
- Content Security Policy restrictiva;
- navegación externa denegada por defecto;
- apertura de ventanas controlada;
- API de preload mínima y allowlisted.

### Preload

El preload:

- expone operaciones explícitas y tipadas;
- no expone `ipcRenderer`, filesystem, shell ni módulos Node genéricos;
- valida contratos de entrada y salida;
- no contiene credenciales;
- no transforma errores de dominio en éxito;
- conserva `correlation_id`, `request_id` e identidad de operación.

### Electron main process

El proceso principal:

- administra ventanas y ciclo de vida visual;
- aplica navegación segura;
- actúa como broker restringido entre preload y servicio local;
- verifica compatibilidad de protocolo antes de habilitar operación;
- coordina instalación o actualización autorizada;
- no es propietario de SQLite;
- no ejecuta reglas de negocio;
- no controla directamente hardware salvo funciones estrictamente propias de Electron.

### POS Local Service

El servicio local:

- se instala como servicio de Windows con inicio automático;
- es el único proceso escritor de SQLite;
- ejecuta dominio y casos de uso locales;
- confirma venta, pago, inventario, caja, auditoría y outbox en fronteras transaccionales definidas;
- controla colas persistentes de impresión;
- carga adaptadores certificados de hardware;
- administra sincronización, reintentos y recuperación;
- valida licencia, dispositivo y disponibilidad offline;
- ejecuta backup y restauración mediante flujos autorizados;
- registra diagnóstico estructurado sin secretos;
- puede operar aunque Electron esté cerrado;
- no depende del backend central para confirmar una venta ordinaria autorizada.

## Propiedad de SQLite

1. Existe un único proceso escritor: `POS Local Service`.
2. Renderer y proceso principal no reciben una ruta de base de datos utilizable.
3. Ningún plugin de hardware abre la base directamente.
4. Toda escritura ocurre mediante un caso de uso y una transacción explícita.
5. La respuesta se devuelve después de persistir el resultado autoritativo.
6. WAL, foreign keys, busy timeout, integridad y checkpoint se configuran al abrir la base.
7. El cierre de Electron no cierra ni interrumpe transacciones del servicio.
8. Una segunda instancia incompatible del servicio no puede abrir la misma base como escritor.

## Canal local

La comunicación entre Electron main y el servicio utilizará un canal local no expuesto a la red, preferentemente named pipes de Windows con ACL limitada a la instalación y usuarios autorizados.

El contrato incluirá:

- `protocol_version`;
- `request_id`;
- `correlation_id`;
- `operation_id` o `idempotency_key` cuando corresponda;
- tipo de mensaje allowlisted;
- payload validado;
- código de resultado estable;
- versión del servicio;
- versión mínima y máxima compatibles.

Reglas:

1. No se abrirá una API HTTP en `0.0.0.0` para comunicación local.
2. Si se requiere loopback como contingencia técnica, deberá autenticarse, usar puerto no público, validar origen y documentarse mediante una revisión de esta decisión.
3. El renderer no accede directamente al canal del servicio.
4. Mensajes desconocidos o versiones incompatibles se rechazan de forma segura.
5. El canal no transporta claves privadas, secretos fiscales ni tokens centrales hacia el renderer.
6. Reconectar no repite automáticamente una operación no idempotente.

## Arranque y recuperación

1. Windows inicia el servicio independientemente de Electron.
2. Electron verifica salud, versión y estado de migración antes de habilitar venta.
3. Si el servicio no responde, la UI muestra un estado operativo explícito y no simula éxito.
4. El servicio recupera outbox, trabajos de impresión y operaciones interrumpidas al reiniciar.
5. Una venta confirmada permanece confirmada después de un cierre inesperado.
6. Una intención no confirmada no se presenta como venta completada.
7. El reinicio del renderer reconstruye estado desde el servicio, no desde caché visual.

## Impresión y hardware

1. La impresión se solicita después del commit de la venta.
2. Los trabajos de impresión se persisten y tienen identidad propia.
3. Reimprimir no repite venta, pago, caja ni inventario.
4. Lector, impresora, cajón, balanza y pantalla de cliente se integran mediante puertos y adaptadores.
5. Un fallo de dispositivo produce estado y diagnóstico; no habilita acceso directo desde la UI.
6. Solo equipos validados en la matriz de hardware pueden declararse compatibles.

## PWA de laboratorio

La PWA del POS:

- reutiliza componentes React y contratos visuales;
- usa adaptadores simulados;
- usa tenants y datos sintéticos;
- puede usar `IndexedDB`, `sql.js` o SQLite/WASM únicamente como almacenamiento descartable de laboratorio;
- puede probar UX, accesibilidad, resoluciones y escenarios de error;
- muestra de forma visible que no es el runtime certificado;
- no contiene datos reales de clientes;
- no presenta almacenamiento del navegador como SQLite productivo ni como evidencia de recuperación local;
- no se conecta a hardware productivo;
- no implementa un outbox que se presente como equivalente al servicio local;
- no constituye evidencia de operación offline productiva.

El panel del propietario puede adoptar capacidades PWA porque su autoridad es central y no controla hardware de caja. Esta autorización no se extiende al POS físico.

## Actualizaciones

1. Aplicación de escritorio, servicio local, esquema y contratos tienen versiones explícitas.
2. Toda actualización productiva está firmada.
3. El instalador verifica firma, compatibilidad y espacio disponible.
4. Antes de una migración local se crea backup verificable.
5. La actualización no elimina ni reinterpreta silenciosamente operaciones confirmadas.
6. Una actualización fallida conserva evidencia y permite recuperación o rollback autorizado.
7. El rollback de binarios solo procede si es compatible con la versión del esquema.
8. `LOCAL_PERPETUAL` admite paquetes offline firmados según derechos contratados.
9. `HYBRID` puede recibir actualización administrada, sin volver Internet requisito para vender.
10. Una actualización no amplía licencias ni módulos.

## Seguridad local

- El servicio se ejecuta con el mínimo privilegio requerido.
- Los permisos del filesystem restringen base, backups, logs y configuración.
- Las claves privadas no se guardan en el renderer ni en archivos de texto plano.
- Los secretos locales utilizan el mecanismo de protección definido por `SEC-004`.
- Los logs redactan tokens, credenciales, datos sensibles y payloads fiscales.
- Los diagnósticos para soporte requieren autorización, alcance y auditoría.
- El renderer se trata como una frontera menos confiable que el servicio.
- Un plugin o adaptador no puede ejecutar código arbitrario descargado sin firma.

## Empaquetado

Los artefactos productivos serán:

- instalador Windows firmado;
- aplicación Electron firmada;
- ejecutable o servicio local firmado;
- manifiesto de versión y compatibilidad;
- paquete de migraciones versionado;
- política de rollback;
- checksums verificables.

El empaquetador específico se fijará en el esqueleto técnico y deberá demostrar instalación, actualización, desinstalación controlada y firma en Windows 10/11 de 64 bits. Esta elección no altera la topología decidida.

## Alternativas descartadas

### Renderer con acceso directo a SQLite

Se descarta porque mezcla UI y autoridad transaccional, multiplica escritores, expone datos y complica recuperación.

### Backend central obligatorio para cada venta

Se descarta porque contradice local-first y paraliza tiendas durante fallos de conectividad.

### PWA productiva como runtime físico

Se descarta por límites de hardware, servicio de Windows, almacenamiento autoritativo, actualizaciones y recuperación.

### Servir una API local pública

Se descarta porque amplía innecesariamente la superficie de ataque y permite acceso desde otros equipos de la red.

## Consecuencias

- `ARCH-004` define el contrato detallado entre las fronteras aquí aprobadas.
- `UX-003` diseñará componentes React compartidos sin convertirlos en autoridad de dominio.
- `DEV-003` implementará adaptadores únicamente dentro del servicio local.
- `TECH-002` ubicará SQLite y migraciones locales bajo propiedad del servicio.
- El frontend heredado se conserva solo como referencia de migración.
- La PWA deja de ser candidata a runtime físico definitivo.

## Criterios de aceptación

La decisión se considera implementada cuando:

1. Electron opera con aislamiento, sandbox y preload allowlisted;
2. el servicio local es el único escritor de SQLite;
3. el POS confirma una venta ordinaria con la red desconectada;
4. cerrar o reiniciar el renderer no pierde una venta confirmada;
5. impresión y hardware pasan por adaptadores del servicio;
6. el canal local está autenticado, versionado y no expuesto a la LAN;
7. existen pruebas de incompatibilidad de protocolo;
8. instalador y actualizaciones se verifican mediante firma;
9. una actualización fallida conserva datos y ofrece recuperación segura;
10. la PWA utiliza exclusivamente adaptadores de laboratorio para capacidades POS.
