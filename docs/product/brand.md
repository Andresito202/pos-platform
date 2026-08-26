# Identidad de marca — Camacho POS Colombia

## Estado

- Nombre comercial del producto: `Camacho POS Colombia`.
- Identificador técnico interno: `POS Platform` / `pos-platform`.
- Scopes técnicos preservados: `@pos-platform/*`.
- Titular legal de la marca: `PENDING_COMPANY_FORMATION`.
- Antecedentes RUES/SIC: `REQUIRES_OFFICIAL_CLEARANCE`.
- Registro marcario SIC: `NOT_REGISTERED`.
- Registro de software DNDA: `PLANNED`.

La adopción del nombre comercial no equivale a afirmar registro de marca, habilitación DIAN, certificación fiscal, condición SaaS ni readiness productivo.

## Regla de uso

`Camacho POS Colombia` se usa en superficies visibles al cliente y activos comerciales:

- nombre de aplicación e instalador;
- pantalla de acceso y shell visual;
- documentación de producto y manuales;
- sitio web, material comercial y soporte;
- contratos/licencias y documentos de onboarding;
- facturas comerciales emitidas por la empresa titular cuando corresponda;
- comunicaciones de lanzamiento y piloto.

Los identificadores técnicos existentes no se renombran solo por branding:

- repositorio `pos-platform`;
- package root `pos-platform-target`;
- scopes `@pos-platform/*`;
- nombres de schemas, migrations, bounded contexts, eventos o contratos;
- SHAs, branches, PRs y evidencia histórica.

Un rename técnico futuro requiere ADR/cambio separado si existe una necesidad real de compatibilidad o distribución.

## Modelo comercial inicial

El producto no requiere convertirse en SaaS para salir al mercado.

Modelo inicial preferido:

- `LOCAL_PERPETUAL` o `HYBRID` según capacidad contratada;
- licencia por empresa/sede/terminal conforme a contrato;
- instalación local-first;
- soporte y mantenimiento opcional o anual;
- actualizaciones controladas;
- backups/exportación/offboarding definidos;
- servicios centrales mínimos solo cuando una capacidad realmente los requiera.

El modelo comercial no modifica la arquitectura canónica ni crea forks del producto.

## Claims prohibidos hasta evidencia

No usar públicamente sin evidencia aplicable:

- `marca registrada` o símbolo ®;
- `Proveedor Tecnológico DIAN`;
- `certificado por DIAN`;
- `SaaS` como modalidad única;
- `100% productivo`, `production-ready` o equivalentes;
- soporte real de SIIGO/FACTUS/ALEGRA mientras permanezcan `NOT_EVALUATED`;
- certificación de hardware no validado.

## Gate de formalización comercial

Antes del lanzamiento comercial se debe completar, como mínimo:

1. consulta de homonimia/razón social en RUES/Cámara de Comercio;
2. búsqueda de antecedentes marcarios en SIC/SIPI;
3. definición de la persona jurídica titular;
4. solicitud de marca en las clases aplicables;
5. registro declarativo del software ante DNDA;
6. contratos/licencia, privacidad, tratamiento de datos y soporte;
7. definición tributaria y facturación de la empresa;
8. claims comerciales alineados con el estado técnico real.
