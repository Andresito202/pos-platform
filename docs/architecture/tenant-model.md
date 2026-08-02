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
