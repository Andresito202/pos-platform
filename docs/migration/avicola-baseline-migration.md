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

## Restricciones

- No copiar código sin comprender sus invariantes.
- No mantener lógica de negocio dentro de rutas HTTP.
- No introducir microservicios prematuros.
- No duplicar reglas entre frontend y backend.
- No conservar credenciales demo.
- No usar datos del portafolio como datos productivos.

## Criterio de finalización

La migración termina cuando:

- el nuevo núcleo cubra los casos de uso aprobados;
- las pruebas críticas pasen;
- la demo antigua no sea necesaria;
- el modelo multiempresa esté probado;
- las dos modalidades de despliegue estén soportadas;
- exista rollback documentado.
