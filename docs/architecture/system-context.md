# Contexto del sistema

## Actores

- cajero o tendero;
- supervisor;
- propietario o administrador;
- responsable fiscal;
- operador de soporte autorizado;
- comprador y domiciliario en capacidades posteriores;
- proveedores externos de pagos, fiscalidad y comunicaciones.

## Componentes productivos

### Nodo POS

- POS Desktop Electron;
- renderer React aislado;
- POS Local Service como servicio de Windows;
- SQLite/WAL local;
- adaptadores de lector, impresora, cajón y balanza;
- cola persistente de impresión;
- outbox/inbox y sincronización;
- backup, restauración y actualización local;
- identidad de dispositivo y licencia offline.

El POS Local Service es el único escritor de SQLite. Renderer y Electron main no contienen autoridad de dominio ni acceso directo a hardware o secretos.

### Plataforma central

- API central NestJS como monolito modular;
- workers asíncronos;
- PostgreSQL 16 central;
- almacenamiento compatible con S3;
- panel web del propietario;
- backoffice del proveedor;
- servicio de actualizaciones;
- auditoría y observabilidad;
- adaptadores de proveedores externos.

Piloto y producción usan infraestructura pagada conforme a `DEC-009`.

### Capacidades posteriores

- aplicación del comprador;
- aplicación del domiciliario;
- órdenes y delivery;
- integraciones fiscales productivas;
- integraciones de pagos certificadas;
- otras especializaciones aprobadas.

Estas capacidades comparten contratos y backend, pero no se presentan como implementadas por estar previstas.

### Laboratorio

- PWA de laboratorio del POS;
- simuladores de hardware;
- Factus u otros sandboxes;
- datos sintéticos;
- entornos de desarrollo y CI.

El laboratorio no procesa datos reales, no certifica operación física y no sustituye el runtime Electron/servicio local.

## Relaciones

```text
Cajero
  │
  ▼
POS Desktop ── canal local ── POS Local Service ── hardware
                                  │
                                  ├── SQLite/WAL
                                  ├── impresión
                                  ├── backup
                                  └── sync opcional
                                          │
                                          ▼
                                  API central modular
                                  ├── PostgreSQL
                                  ├── workers
                                  ├── object storage
                                  ├── panel/backoffice
                                  └── proveedores externos
```

## Modalidad `HYBRID`

El POS confirma operaciones autorizadas localmente y sincroniza cuando existe conectividad. La caída central no bloquea una venta ordinaria, aunque las capacidades cuya autoridad es externa pueden quedar pendientes o restringidas.

## Modalidad `LOCAL_PERPETUAL`

POS Desktop, POS Local Service y SQLite operan sin dependencia permanente de Internet. La licencia se valida offline, los backups son locales y las actualizaciones pueden distribuirse mediante paquetes firmados.

No requiere proveedor fiscal para operar el núcleo comercial; tampoco declara validez fiscal inexistente.

## Fronteras normativas

- `ADR-005`: stack tecnológico;
- `DEC-007`: autoridad local-first;
- `DEC-008`: dispositivo y licencia;
- `DEC-009`: producción, recuperación e infraestructura;
- `DEC-010`: runtime productivo;
- `ARCH-004`: contratos de integración;
- `SEC-004`: secretos y soporte.

## Principio

La pérdida de conectividad, el cierre del renderer o la caída de una dependencia externa no deben perder una venta local confirmada. Ningún componente puede simular éxito cuando desconoce el resultado real.
