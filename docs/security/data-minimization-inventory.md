# Inventario de minimización y conservación de datos — Camacho POS Colombia

**Versión:** 1.0  
**Fecha:** 2026-10-07  
**Fuente:** código y esquema local actualmente materializados.

## 1. Regla

Cada campo personal debe tener una finalidad concreta. Si el campo es opcional y la finalidad no existe para la operación actual, debe permanecer ausente (`NULL`) en vez de rellenarse con un valor ficticio.

No se define un plazo numérico de conservación sin una fuente contractual, fiscal, contable o jurídica que lo justifique. La regla vigente es conservar durante la finalidad y los períodos legales aplicables, y suprimir, anonimizar o bloquear cuando proceda.

## 2. Adquiriente (`customers_customers`)

| Campo | Necesidad | Finalidad | Regla de minimización | Conservación |
|---|---|---|---|---|
| `identification_document_code` | necesaria para identificación fiscal cuando la operación lo requiere | identificar tipo de documento | no capturar otro identificador alternativo si éste basta | mientras exista finalidad comercial/fiscal y obligación de conservación |
| `identification` | necesaria para identificación fiscal cuando la operación lo requiere | identificar al adquiriente | validación estricta; no duplicar en auditoría | igual a la finalidad y obligación aplicable |
| `verification_digit` | sólo cuando corresponda al documento | validación/documentación fiscal | `NULL` cuando no aplique | igual a la finalidad fiscal |
| `legal_organization_code` | necesaria para la forma fiscal | determinar reglas de adquiriente | no inferir ni almacenar una categoría adicional | igual a la finalidad fiscal |
| `company` | condicional | razón social de persona jurídica | obligatorio sólo cuando la validación fiscal lo exige | igual a la finalidad fiscal |
| `names` | condicional | nombre de persona natural | obligatorio sólo cuando la validación fiscal lo exige | igual a la finalidad fiscal |
| `tribute_code` | necesaria para el modelo fiscal actual | clasificación tributaria | sólo códigos verificados | igual a la finalidad fiscal |
| `fiscal_responsibility_codes` | necesaria para el modelo fiscal actual | responsabilidades fiscales | array mínimo de códigos verificados | igual a la finalidad fiscal |
| `email` | opcional | contacto/facturación cuando la finalidad lo requiere | `NULL` si no existe finalidad que lo necesite; no usar como consentimiento comercial | según finalidad; revisar si deja de ser necesario |
| `phone` | opcional | contacto operativo cuando la finalidad lo requiere | `NULL` si no es necesario | según finalidad |
| `address` | opcional | domicilio/dirección cuando la operación o documento lo requiere | no pedir una dirección adicional si la finalidad ya está cubierta | según finalidad y obligaciones aplicables |
| `country_code` | opcional | información geográfica/fiscal cuando se requiere | `NULL` si no se necesita | según finalidad |
| `municipality_code` | opcional | información geográfica/fiscal cuando se requiere | `NULL` si no se necesita | según finalidad |

### Controles ya materializados

- El contrato fiscal limita la forma del adquiriente.
- `CustomerPanel` mantiene como opcionales los campos de contacto y ubicación.
- La auditoría `CUSTOMER_REGISTER` no guarda identificación, correo, teléfono ni dirección.
- El outbox sí transporta la identidad completa porque el central necesita el adquiriente para sincronización/emisión; no se trata de una segunda copia de auditoría.
- La separación por tenant/company evita exponer datos de otra compañía.

## 3. Auditoría

`local_operation_audit.details_json` debe conservar evidencia mínima de la acción, no el contenido personal de la operación. Para `CUSTOMER_REGISTER` se registran códigos estructurales necesarios para explicar qué se hizo, pero no identificación, correo, teléfono ni dirección.

## 4. Operaciones de sincronización

`local_sync_outbox` contiene el payload necesario para transportar la operación al central. Su presencia no autoriza a copiar el mismo payload a logs, métricas, trazas o mensajes de error.

Los componentes de observabilidad deben continuar aplicando redacción de secretos y límites de payload existentes.

## 5. Datos de seguridad

Claves privadas, tokens, contraseñas y secretos no pertenecen al payload comercial ni al log de aplicación. Los controles existentes de redacción, almacenes de secretos, límites de payload y auditoría se mantienen como controles obligatorios.

## 6. Conservación y eliminación

Este inventario no autoriza borrado físico automático. La conservación debe evaluarse por entidad y finalidad antes de implementar anonimización o desidentificación.

Las solicitudes de titular se tramitan mediante `docs/legal/data-subject-rights-procedure.md`, que distingue entre datos eliminables y evidencia que debe conservarse por obligaciones fiscales, contables, de seguridad o auditoría.

## 7. Regla para cambios futuros

Agregar un campo personal requiere actualizar este inventario con finalidad, necesidad, opcionalidad y conservación antes de incorporarlo al modelo persistente. Un campo sin finalidad documentada no debe entrar al esquema por conveniencia.

**Fuente única:** este documento + `docs/legal/privacy-policy.md` + esquema `customers_customers` + `sqlite-customer-store.ts`.