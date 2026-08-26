# Visión de Camacho POS Colombia

Camacho POS Colombia será una plataforma comercial modular, multiempresa y multisucursal para negocios minoristas.

El producto no será una demostración ni un CRUD básico. Desde su primera versión comercial deberá cumplir con:

- integridad transaccional;
- seguridad por roles y contexto;
- auditoría;
- operación local-first;
- funcionamiento temporal sin Internet;
- soporte para hardware POS;
- configuración por tipo de comercio;
- interfaz adaptada por rol;
- mantenibilidad;
- escalabilidad;
- pruebas automatizadas;
- despliegues híbridos y locales perpetuos.

La marca comercial visible es `Camacho POS Colombia`. Los identificadores técnicos internos `POS Platform`, `pos-platform` y `@pos-platform/*` se preservan para no romper contratos, paquetes ni trazabilidad. El estado registral de la marca se controla en `brand.md`.

## Aplicaciones previstas

1. POS del cajero o tendero.
2. Panel del propietario.
3. Backoffice del proveedor de la plataforma.
4. Aplicación del domiciliario.
5. Aplicación del comprador.

Todas compartirán un backend central modular, contratos comunes y reglas de negocio consistentes.
