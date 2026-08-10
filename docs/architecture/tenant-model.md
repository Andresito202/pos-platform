# Modelo multiempresa

## Jerarquía

Platform
└── Tenant
    └── Company
        └── Branch
            ├── Cash Register
            ├── Inventory
            ├── Devices
            ├── Users assigned
            ├── Sales
            └── Purchases

## Tenant

Representa al cliente contractual de la plataforma.

Puede contener una o varias empresas cuando el plan lo permita.

## Empresa

Contiene:

- identidad legal;
- nombre comercial;
- NIT;
- configuración;
- branding;
- licencias;
- usuarios globales;
- catálogo compartido;
- políticas;
- métodos de pago.

## Sucursal

Contiene:

- dirección;
- ubicación;
- horarios;
- cajas;
- inventario;
- turnos;
- ventas;
- compras;
- dispositivos;
- domiciliarios asignados.

## Datos compartidos y datos locales

### Compartidos por empresa

- productos;
- categorías;
- códigos de barras;
- proveedores;
- clientes, según política;
- listas de precios;
- roles;
- branding.

### Separados por sucursal

- stock;
- lotes;
- cajas;
- turnos;
- movimientos;
- ventas;
- recepciones;
- dispositivos.

## Identidad, pertenencia y autorización

La identidad autenticable del usuario es global y se mantiene separada del alcance multi-tenant.

La relación normativa es:

`User` → `TenantMembership` → `UserRoleAssignment`

### User

Representa la identidad autenticable global.

No utiliza `tenant_id` como autoridad de pertenencia.

La autenticación no concede acceso automático a ningún tenant.

### TenantMembership

Relaciona explícitamente un `User` con un `Tenant`.

Es la autoridad de pertenencia entre usuario y tenant.

Puede clasificar la relación mediante tipos conceptuales como:

- `OWNER`;
- `ADMIN`;
- `MEMBER`;
- `SERVICE`.

Una pertenencia no concede por sí sola todos los permisos.

### UserRoleAssignment

Asigna roles y alcance operativo dentro de una `TenantMembership`.

El alcance puede limitarse a:

- tenant;
- empresa;
- sucursal.

`UserRoleAssignment` no sustituye la pertenencia y no puede ampliar el acceso fuera del tenant asociado.

### Propietario

El propietario administrativo se representa mediante una `TenantMembership` de tipo `OWNER`.

La condición de propietario no constituye bypass de autorización.

Los cambios de propietario requieren controles reforzados, auditoría y MFA o reautenticación cuando corresponda.

### Resolución de contexto

El tenant efectivo debe resolverse a partir de identidad autenticada, pertenencia válida, sesión y contexto autorizado.

Un `tenant_id` enviado libremente por el cliente no constituye evidencia suficiente de pertenencia.

Los alcances de empresa y sucursal deben pertenecer al mismo tenant de la membresía autorizada.
## Contexto obligatorio

Las operaciones deberán incluir o derivar de forma segura:

- tenant_id;
- company_id;
- branch_id;
- user_id;
- device_id, cuando aplique;
- cash_register_id, cuando aplique.

## Seguridad

El tenant_id no se confiará desde un parámetro libre enviado por el cliente.

Debe derivarse de la sesión, licencia o contexto autorizado y validarse en cada acceso.

## Identificadores

Las entidades sincronizables utilizarán identificadores globales compatibles con operación offline.

## Restricción

No se permitirán consultas globales sin filtros de tenant salvo procesos internos explícitos, auditados y autorizados.
