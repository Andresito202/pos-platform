# UC-CAT-003: Asignar identificador comercial

## Objetivo

Asociar uno o varios códigos a un producto, variante o presentación.

## Actor principal

Usuario autorizado de catálogo o inventario.

## Precondiciones

- Producto válido.
- Empresa activa.
- Permiso `catalog.identifier.manage`.
- Tipo de identificador soportado.

## Entrada

- product_id;
- variant_id opcional;
- presentation_id opcional;
- identifier_type;
- value;
- is_primary;
- supplier_id opcional;
- valid_from opcional;
- idempotency_key.

## Tipos iniciales

- INTERNAL;
- EAN_8;
- EAN_13;
- UPC;
- PLU;
- SUPPLIER_CODE;
- SCALE_BARCODE;
- INTERNAL_QR;
- MANUAL_CODE.

## Flujo principal

1. El usuario escanea o escribe el código.
2. El sistema normaliza el valor según el tipo.
3. Valida longitud, dígito de control o formato cuando aplique.
4. Busca conflictos dentro de la empresa.
5. Confirma el producto, variante o presentación de destino.
6. Registra el identificador.
7. Si se marca como principal, actualiza la prioridad sin borrar los anteriores.
8. Registra auditoría.
9. Emite `ProductIdentifierAssigned`.

## Reglas

1. Un identificador activo no puede resolver a dos artículos vendibles dentro de la misma empresa.
2. El mismo código puede existir en tenants diferentes.
3. El código del proveedor puede coexistir con un EAN.
4. Un producto puede tener múltiples códigos activos.
5. El código debe apuntar al nivel correcto:
   - producto;
   - variante;
   - presentación.
6. Un código de balanza requiere perfil de interpretación.
7. El código comercial ordinario no contiene automáticamente lote ni vencimiento.
8. Desactivar un código no elimina su historial.
9. No se permite reutilización inmediata de códigos sin control.

## Conflictos

### Código ya asignado

Se rechaza y se informa el artículo actual.

### Código inválido

Se rechaza antes de persistir.

### Código ambiguo

Se debe resolver administrativamente; el cajero no decide.

### Código de balanza

Se valida contra el formato configurado para la sucursal o dispositivo.

## Postcondiciones

- El código identifica de forma determinista un artículo vendible.
- La asignación queda auditada.

## Eventos

- `ProductIdentifierAssigned`;
- `ProductIdentifierDeactivated`.

## Pruebas mínimas

- EAN válido;
- EAN inválido;
- código duplicado;
- varios códigos para un producto;
- código por presentación;
- código de proveedor;
- código de balanza;
- aislamiento entre empresas.
