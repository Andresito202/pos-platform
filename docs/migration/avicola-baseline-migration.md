# Migración desde la base avícola

## Objetivo

Usar el proyecto supermercado-avicola como línea base auditada, sin convertirlo directamente en la arquitectura final.

## Estado de la base

El proyecto actual contiene:

- FastAPI;
- SQLAlchemy;
- Alembic;
- PostgreSQL;
- autenticación JWT;
- roles simples;
- productos;
- categorías;
- compras;
- inventario;
- lotes;
- ventas;
- caja;
- reportes;
- pruebas iniciales;
- frontend HTML y JavaScript.

## Clasificación

### Reutilizar conceptualmente

- FastAPI.
- SQLAlchemy.
- Alembic.
- PostgreSQL.
- Decimal y Numeric para dinero.
- modelos básicos de ventas;
- inventario por movimientos;
- lotes;
- caja;
- autenticación;
- pruebas iniciales.

### Refactorizar

- autenticación;
- roles;
- ventas;
- compras;
- inventario;
- caja;
- reportes;
- configuración;
- auditoría;
- manejo de lotes.

### Reemplazar

- frontend HTML estático;
- navegación actual;
- estructura de interfaz;
- configuración específica de avícola;
- semillas de demo;
- creación automática de tablas en producción;
- administración global simple;
- numeración de venta basada en conteo.

### Crear

- tenants;
- empresas;
- sucursales;
- dispositivos;
- licencias;
- feature flags;
- precios versionados;
- pagos separados;
- caja por terminal y turno;
- snapshots;
- idempotencia;
- outbox;
- sincronización;
- operación local-first;
- panel del propietario;
- backoffice;
- apps de comprador y domiciliario;
- servicio de hardware.

## Estrategia

1. Conservar el tag `baseline-avicola-audit`.
2. No modificar el repositorio público original.
3. Trabajar únicamente en `pos-platform`.
4. Definir arquitectura antes de modificar modelos.
5. Crear nuevas migraciones; no reescribir silenciosamente la migración original.
6. Introducir multiempresa antes de agregar módulos nuevos.
7. Migrar caso de uso por caso de uso.
8. Mantener pruebas de regresión.
9. Eliminar código demo solo cuando exista reemplazo probado.
10. No desplegar cambios incompletos en producción.

## Orden de migración

### Etapa 1 — Fundación

- configuración;
- tenant;
- empresa;
- sucursal;
- usuarios;
- roles;
- permisos;
- dispositivos;
- licencias;
- auditoría.

### Etapa 2 — Catálogo

- productos;
- categorías;
- códigos;
- variantes;
- unidades;
- precios.

### Etapa 3 — Inventario y compras

- stock por sucursal;
- lotes;
- movimientos;
- compras;
- recepciones;
- proveedores.

### Etapa 4 — Caja y ventas

- cajas físicas;
- turnos;
- pagos;
- ventas;
- devoluciones;
- anulaciones;
- recibos.

### Etapa 5 — Local-first

- base local;
- UUID;
- outbox;
- idempotencia;
- sincronización;
- recuperación.

### Etapa 6 — Aplicaciones

- nuevo POS;
- panel del propietario;
- backoffice;
- comprador;
- domiciliario.

## Contrato de identificadores

1. Las entidades objetivo sincronizables usan UUID v7.
2. Los enteros heredados se conservan en una tabla o referencia de correspondencia `(source_table, legacy_id, target_id)`.
3. `legacy_id` nunca sustituye la PK objetivo ni se expone como autoridad de sincronización.
4. Los consecutivos humanos se migran como datos de negocio y no como PK.

## Mapeo obligatorio de datos heredados

### Tenancy

Antes de migrar datos operacionales debe existir una regla aprobada que asigne cada fila heredada a un Tenant, Company y Branch de transición. No se permiten valores nulos ni un tenant global compartido como bypass de aislamiento.

### Usuarios y roles

| Legado | Objetivo |
|---|---|
| `usuarios` | `User` global |
| `usuarios.rol` | `TenantMembership` activa + `UserRoleAssignment` al rol aprobado equivalente |
| `usuarios.activo = false` | User desactivado y assignments no vigentes |

El correo se normaliza antes de validar unicidad global. Una colisión no se fusiona automáticamente: se lleva a cuarentena con evidencia.

### Catálogo

Cada producto heredado genera:

1. un `Product`;
2. una `ProductPresentation` predeterminada con la unidad heredada;
3. el SKU o código heredado como identificador de la presentación;
4. una referencia de correspondencia entre IDs.

No se crea `ProductVariant` si el legado no contiene evidencia de variantes.

### Inventario y lotes

Los lotes, movimientos, mermas y detalles de recepción heredados se enlazan a la presentación predeterminada creada para su producto. `InventoryMovement` se migra como hecho; `StockBalance` se reconstruye desde movimientos y se compara contra cantidades heredadas.

Una diferencia no se corrige sobrescribiendo el movimiento: se registra en un informe de reconciliación y requiere ajuste explícito aprobado.

### Ventas

Las ventas cerradas se migran como históricas e inmutables. Cada línea conserva:

- referencia a la presentación migrada;
- nombre, código, unidad, cantidad y precio heredados;
- impuesto, descuento o costo solo cuando exista evidencia;
- `legacy_id` y fecha original.

No se inventan snapshots fiscales, promociones, descuentos o versiones inexistentes. Los campos desconocidos se marcan como datos heredados no disponibles.

### Pagos

`ventas.metodo_pago` se transforma en un `PaymentGroup` y un `Payment` cuando el medio y el importe son inequívocos.

Un valor heredado `mixto` sin desglose suficiente se migra como evidencia histórica no descompuesta y queda fuera de nuevas operaciones de refund automático hasta revisión. No se inventan importes, proveedores, referencias ni intentos.

### Caja

Las cajas y movimientos heredados conservan importes y timestamps originales. Los turnos incompletos o imposibles de reconciliar se migran con estado de revisión y no se presentan como cierres válidos.

### Auditoría

La auditoría heredada se encapsula en `AuditEvent` conservando el texto original. Tenant, actor y recurso se asignan solo cuando exista correspondencia verificable; la ausencia se representa mediante actor/tipo de migración, nunca mediante datos inventados.

## Cuarentena

Se llevan a cuarentena, sin inserción silenciosa en el modelo operacional:

- correos globales duplicados no resolubles;
- SKU duplicados dentro de empresa;
- productos sin unidad interpretable;
- lotes sin producto/presentación;
- movimientos huérfanos;
- ventas con totales incoherentes;
- pagos mixtos sin desglose;
- auditoría sin correspondencia verificable;
- referencias cruzadas entre scopes incompatibles.

## Reconciliación obligatoria

Cada etapa produce y valida:

1. conteo origen, migrado, omitido y en cuarentena;
2. suma monetaria por moneda y fecha comercial;
3. saldo de inventario por presentación, ubicación y lote;
4. total de ventas y pagos migrados;
5. correspondencia completa de IDs;
6. huérfanos y violaciones de FK;
7. duplicados de claves naturales;
8. checksum o evidencia reproducible del lote migrado.

La migración no se considera aceptada mientras existan diferencias sin clasificación y aprobación explícita.

## Rollback

Las migraciones objetivo se crean como revisiones nuevas y no reescriben `001_initial_schema.py`. El rollback debe retirar exclusivamente estructuras o datos creados por la revisión objetivo, conservar los datos heredados y documentar cualquier operación no reversible antes de ejecutarla.

## Restricciones

- No copiar código sin comprender sus invariantes.
- No mantener lógica de negocio dentro de rutas HTTP.
- No introducir microservicios prematuros.
- No duplicar reglas entre frontend y backend.
- No conservar credenciales demo.
- No usar datos del portafolio como datos productivos.
- No ejecutar semillas de demostración automáticamente en despliegues compartidos o productivos; `SEED_DEMO_DATA` debe permanecer desactivado salvo ejecución local, explícita y aislada.

## Criterio de finalización

La migración termina cuando:

- el nuevo núcleo cubra los casos de uso aprobados;
- las pruebas críticas pasen;
- la demo antigua no sea necesaria;
- el modelo multiempresa esté probado;
- las dos modalidades de despliegue estén soportadas;
- exista rollback documentado.
