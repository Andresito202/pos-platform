# Formas de payload por proveedor — qué entra y qué devuelve

## Propósito y nivel de evidencia

Este documento responde a una pregunta operativa: **qué datos hay que enviar y
qué datos devuelve cada proveedor**, para que el adapter sea estable antes de
tener credenciales reales de los tres.

**No todo aquí tiene el mismo respaldo.** Cada bloque declara su nivel:

| Nivel | Significa |
|---|---|
| `VERIFICADO_EJECUCIÓN` | se ejecutó contra el proveedor y se observó la respuesta |
| `VERIFICADO_DOC` | leído en documentación oficial del proveedor |
| `UNVERIFIED_SECUNDARIA` | procede de fragmentos de búsqueda, **no** de la documentación oficial leída directamente |
| `NOT_EVALUATED` | no se investigó |

> **Restricción de entorno, verificada el 2026-09-06.** Desde el entorno de
> agente, `developers.siigo.com`, `developer.alegra.com` y
> `e-provider-docs.alegra.com` responden **bloqueo del proxy de salida**. Las
> filas de SIIGO y ALEGRA de este documento no pudieron confirmarse contra la
> fuente oficial y quedan `UNVERIFIED_SECUNDARIA` hasta que el propietario las
> revise. No se elevan de nivel por parecer razonables.

---

## FACTUS — `VERIFICADO_DOC` + autenticación `VERIFICADO_EJECUCIÓN`

### Flujo

```
1. POST /oauth/token                → access_token          [VERIFICADO_EJECUCIÓN]
2. GET  /v2/numbering-ranges        → numbering_range_id     [VERIFICADO_DOC]
3. POST /v2/bills/validate          → crea Y valida en UN paso
4. Leer data.is_validated
```

### Qué entra — `POST /v2/bills/validate`

| Bloque | Campos | De dónde sale en nuestro POS |
|---|---|---|
| Raíz | `reference_code` ✅ único, `document` (`"01"`), `numbering_range_id`, `operation_type` (`"10"`), `observation`, `cash_rounding_amount` (±500) | identidad POS inmutable + rangos del proveedor |
| `payment_details[]` ✅ | `payment_form` (`"1"` contado, `"2"` crédito), `payment_method_code` (`"10"` efectivo, `"42"` consignación), `amount`, `due_date` (obligatorio si crédito) | Payments V1 — **existe** |
| `customer{}` ✅ | `identification_document_code`, `identification` (**sin DV**), `dv`, `legal_organization_code` (`"1"` jurídica → `company` obligatorio; `"2"` natural → `names` obligatorio), `tribute_code`, `responsibilities[]`, `address`, `email`, `phone`, `country_code`, `municipality_code` | **NO EXISTE** — `Customer` está en la ruta crítica |
| `items[]` ✅ | `code_reference`, `name`, `quantity`, `price`, `unit_measure_code`, `standard_code`, `discount_rate` **o** `discount_amount` (nunca ambos), `taxes[]` con `code`+`rate` | Catalog y Tax — **NO EXISTEN** |

**Todos los numéricos van como `string` con máximo dos decimales.**

### Qué devuelve — `201 Created`

```
status, message
data.reference_code, data.number, data.cufe
data.is_validated          ← LA EVIDENCIA FISCAL
data.validated_at
data.errors                ← avisos DIAN (FAJ44b, RUT01): NO implican rechazo
data.links.qr, data.links.public_url
data.totals.{gross_amount, taxable_amount, tax_amount, total}
```

### Reglas que ya están implementadas y probadas

1. `reference_code` repetido → el API rechaza para evitar duplicados. Nuestro
   adapter corta **antes de transmitir** si no coincide con la clave de
   idempotencia.
2. Un campo opcional de tipo objeto o array, **una vez recibe datos, pasa a ser
   obligatorio con todos sus campos internos**.
3. `errors` poblado con `is_validated: true` sigue siendo aceptación.

---

## SIIGO — `UNVERIFIED_SECUNDARIA`

### Qué se cree que entra — `POST /v1/invoices`

`document.id`, `number`, `name`, `date`, `customer{}`, `seller`, `items[]`,
`payments[]`.

`customer{}` incluiría `person_type`, `id_type`, `identification`,
`check_digit`, `name`, `commercial_name`, `branch_office`, `active`,
`vat_responsible`, `fiscal_responsibilities`, y dirección.

`items[]` incluiría `code`, `description`, `quantity`, `price`, `discount`,
**`warehouse`**.

### Diferencias estructurales frente a FACTUS

Aunque la fuente sea secundaria, dos diferencias son lo bastante marcadas para
condicionar el diseño y **ninguna es de nombres**:

1. **Los ítems de SIIGO llevan `warehouse`.** La factura queda acoplada a
   inventario. FACTUS no pide bodega.
2. **Los ítems de SIIGO no traen `unit_measure_code` ni `standard_code` ni un
   array `taxes[]` por ítem** con la forma de FACTUS. El modelo tributario por
   línea es distinto.
3. SIIGO permite **crear el tercero desde la propia factura**; FACTUS espera el
   `customer` embebido pero no gestiona catálogo de clientes.

### Qué falta confirmar

Respuesta completa: si devuelve CUFE, estado DIAN, URL pública o QR, y si la
emisión electrónica es parte de `POST /v1/invoices` o un paso aparte.
`NOT_EVALUATED`.

---

## ALEGRA — `UNVERIFIED_SECUNDARIA`

### El hallazgo que más condiciona el diseño

**ALEGRA separa crear de timbrar. FACTUS hace ambas cosas en una sola llamada.**

```
FACTUS   POST /v2/bills/validate          → crea Y valida
ALEGRA   POST /api/v1/invoices            → crea (borrador / abierta)
         POST /api/v1/invoices/stamp      → timbra hasta 10 facturas
```

Existe además un API distinto, `e-provider-docs.alegra.com`, con un endpoint de
emisión electrónica a la DIAN. **Si son dos productos distintos —el ERP y el
proveedor tecnológico— eso cambia qué contrata el cliente.** Sin verificar.

### Consecuencia real para nuestro contrato

`DocumentIssuancePort.issue()` es **una** operación. Un adapter de ALEGRA puede
encapsular los dos pasos dentro de ella —eso es asunto suyo, y el puerto no
necesita cambiar—. **Pero aparece un estado de incertidumbre nuevo:**

> factura **creada y no timbrada**, porque el proceso murió entre los dos pasos.

No es lo mismo que el `UNKNOWN_OUTCOME` de FACTUS. Allí la duda es «¿llegó?».
Aquí sabemos que llegó y sabemos que no está timbrada. La conciliación tiene que
poder **encontrar esa factura creada y timbrarla**, en vez de crear otra.

Reintentar `issue()` a ciegas contra ALEGRA crearía una segunda factura. Es el
mismo modo de fallo que ya cerramos para FACTUS con `reference_code`, pero por
una causa distinta, y **todavía no está resuelto para ALEGRA**.

Queda registrado como pregunta de diseño abierta, no como algo resuelto.

---

## Lo que este documento deja claro para el POS

Las tres formas de factura son **estructuralmente distintas**, no variaciones de
nombre. Eso confirma la decisión de `DEC-016`/gate: el puerto transporta un
**payload congelado opaco** y es el adapter quien conoce la forma. Si el puerto
hubiera fijado una forma de factura, el primer proveedor habría definido el
modelo interno y el segundo no habría entrado.

Y deja ver qué falta en el POS para emitir de verdad, con independencia del
proveedor:

| Pieza | Estado | Sin ella |
|---|---|---|
| `Customer` / adquiriente | **no existe** | ningún proveedor acepta la factura |
| Tablas de referencia de códigos DIAN | **no existen** | `identification_document_code`, `municipality_code`, `unit_measure_code`, `standard_code`, `tribute_code`, códigos de impuesto |
| `Catalog` | no existe en `main` | no hay `items[]` |
| `Tax` | no existe | no hay `taxes[]` por ítem |

Los tres proveedores pueden esperar; **estas cuatro piezas no**, porque ninguna
factura sale sin ellas.
