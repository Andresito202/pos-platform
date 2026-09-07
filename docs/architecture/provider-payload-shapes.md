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
| `customer{}` ✅ | `identification_document_code`, `identification` (**sin DV**), `dv`, `legal_organization_code` (`"1"` jurídica → `company` obligatorio; `"2"` natural → `names` obligatorio), `tribute_code`, `responsibilities[]`, `address`, `email`, `phone`, `country_code`, `municipality_code` | **materializado** — `.../dian/customer.ts`, `MIGRATION_012`, módulo `customers/` y canal `customer.*` |
| `items[]` ✅ | `code_reference`, `name`, `quantity`, `price`, `unit_measure_code`, `standard_code`, `discount_rate` **o** `discount_amount` (nunca ambos), `taxes[]` con `code`+`rate` | **forma canónica materializada** — `.../dian/item.ts`; Catalog y Tax siguen sin persistencia ni motor |

**Todos los numéricos van como `string` con máximo dos decimales.**

### La precisión del proveedor no coincide con la del POS

La línea de arriba —«todos los numéricos van como `string` con máximo dos
decimales»— es la restricción más incómoda del contrato, porque **el POS lleva
el dinero en escala 6**.

Un importe con dígitos significativos más allá del segundo decimal **no se puede
transmitir con fidelidad**. `toProviderDecimal` devuelve el valor exacto o
`NOT_REPRESENTABLE`, y **nunca redondea**: redondear emitiría una factura que no
coincide con lo cobrado, y el descuadre aparecería en la contabilidad del
comerciante, no en un registro nuestro. Sólo la rama `EXACT` lleva el valor, así
que transmitir lo que se perdió al convertir no compila.

No es un caso teórico: **una báscula produce `0.333333` kg**. Queda registrado
como `D-14`, y la decisión de qué hacer con ese caso —redondear la cantidad
antes de vender, cambiar la unidad, o rechazar la venta— es de negocio, no de
programa.

### Qué cubre y qué no la forma canónica de la línea

`FiscalDocumentItem` declara la forma y comprueba lo comprobable contra las
tablas DIAN verificadas: unidad de medida, estándar de producto y código de
impuesto. Las reglas declaran su fuente igual que en el adquiriente.

**El descuento es una unión discriminada.** El contrato admite `discount_rate`
**o** `discount_amount` y nunca los dos; en vez de comprobarlo en ejecución, una
línea con las dos formas **no compila**.

Lo que **no** hace: calcular el impuesto. Eso es del motor de precios, que hoy
tiene `taxUnits: 0n` fijo —comentario literal «SANDBOX Tax EXCLUDED: siempre
0»—. La forma existe; el motor y el catálogo que la alimentan, no.

### Qué cubre y qué no la forma canónica del adquiriente

`FiscalCustomer` declara la forma y comprueba lo que se puede comprobar contra
las tablas DIAN verificadas. **Cada regla dice de dónde sale**:
`FACTUS_OFFICIAL_DOC` es una exigencia escrita aquí; `DERIVED` es una regla
nuestra, anotada con su motivo. Confundirlas dejaría al lector sin saber si un
rechazo viene del proveedor o de nosotros.

Tres decisiones explícitas, y las tres son de omisión:

- **La identificación y el DV son campos distintos.** La documentación es
  taxativa: `identification` viaja **sin DV**. Un NIT escrito «900123456-7» en
  ese campo produce el hallazgo `IDENTIFICATION_CARRIES_VERIFICATION_DIGIT`.
- **El DV no se calcula ni se verifica.** El algoritmo es módulo 11 y es
  público, pero no está en ninguna fuente verificada de este repositorio. Se
  comprueba su **forma** —un solo dígito— y su presencia cuando el documento es
  NIT; su **valor** no. Registrado como `D-12`, con una prueba que fija esa
  ausencia para que nadie la dé por cubierta.
- **País y municipio pasan sin validar.** No hay tabla verificada para ninguno
  de los dos, y validar contra una inventada rechazaría adquirientes correctos.

Y una que condiciona la caja: **el adquiriente ausente no se rellena con el
tercero genérico de la DIAN.** Una venta de mostrador anónima es el caso
mayoritario de un POS y la DIAN tiene un tercero para eso, pero sus valores no
están verificados aquí. `prepareCustomerForIssuance` **bloquea** con el motivo
`GENERIC_ACQUIRER_NOT_VERIFIED`, que nombra la fuente que falta en lugar de
suponerla.

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

---

## Qué entrega el proveedor al cliente, y qué integra el POS

Investigación comercial del propietario, 2026-09-06. Nivel:
`UNVERIFIED_SECUNDARIA` para los detalles de plan; la forma de credencial
**coincide** con `provider-integration-matrix.md`, que sí es `VERIFICADO_DOC`.

Cada proveedor entrega **tres cosas distintas**, y sólo una es integrable.

### 1. Usuario y contraseña del portal web — **NO se integra. Nunca.**

Es el acceso humano al portal del proveedor. El POS **no automatiza un portal
web**, y no es una limitación: es una decisión.

- Automatizarlo sería *screen scraping*: se rompe con cada cambio de interfaz
  del proveedor y no hay contrato que lo sostenga.
- Ambos proveedores documentan expresamente que **la credencial de API nunca es
  la contraseña de la cuenta**. Usar la contraseña del portal violaría su propio
  contrato de uso.
- Esa contraseña abre además contabilidad, nómina y configuración fiscal. Un POS
  no necesita ese alcance y no debe tenerlo.

**Regla:** si un cliente sólo tiene usuario y contraseña de portal, **no hay
integración posible**. Lo que hay es un proveedor al que factura a mano. Decirlo
es más honesto que prometer una automatización frágil.

### 2. Credenciales de API — **el único camino real**

Confirma exactamente lo que ya declara cada adapter:

| Proveedor | Lo que entrega | Nuestra declaración |
|---|---|---|
| ALEGRA | correo de la cuenta + **token de acceso**, desde el menú de configuración | `api_email` + `api_token`, HTTP Basic ✅ |
| SIIGO | **Id de Cliente** (username) + **Access Key** | `username` + `access_key` + `partner_id` de plataforma ✅ |
| FACTUS | cuatro valores del portal | OAuth2 password grant ✅ |

**Precondición comercial que hay que decir en la venta:** el acceso a la API de
SIIGO **no viene en todos los planes** — suele exigir un plan específico o un
módulo de integración adicional. Un cliente con plan básico de SIIGO puede no
tener API en absoluto.

Por tanto «nuestro POS es compatible con SIIGO» es **condicional al plan del
cliente**, no una propiedad del POS. Prometerlo sin esa condición es vender algo
que puede no existir del lado del cliente.

### 3. Enlaces — **dos tipos, y confundirlos contamina el núcleo**

Los proveedores generan enlaces automáticamente. **No son la misma cosa** y no
pertenecen al mismo módulo:

| Enlace | Qué es | Dónde vive |
|---|---|---|
| **Enlace de la factura** (`public_url`, `qr`) | representación gráfica del documento fiscal, inmutable, atada al CUFE | `DocumentArtifactPort` — **ya modelado** |
| **Enlace o botón de pago** (PSE, tarjeta) | canal de cobro | **Payments, no Electronic Invoicing** |

El enlace de pago **no es fiscal**. Es un medio de cobro que el proveedor ofrece
de propina. Meterlo en el puerto fiscal metería una preocupación de cobro dentro
del canal de facturación, que es justo lo que prohíben `data-ownership.md` r.13
y r.22.

Encaja además donde ya estaba previsto: el linaje preservado modela
`STATIC_QR`, `DYNAMIC_QR` y `merchant-collection-identifier` como métodos de
**pago**, no como artefactos fiscales.

**Decisión:** el enlace de pago que devuelva un proveedor fiscal se trata como
un método de pago externo del módulo Payments. No entra por `DocumentArtifactPort`.

### Consecuencia sobre el saldo de bolsa

Los tres modelos comerciales son distintos y `D-5` no los cubría todos:

| Proveedor | Modelo | Rama del tipo |
|---|---|---|
| FACTUS | bolsa anual divisible entre NITs | `MODELLED` |
| SIIGO | paquetes anuales cerrados (24, 120…) | `MODELLED` |
| ALEGRA | **ilimitado** en plan de pago | `NOT_APPLICABLE` |

`NOT_APPLICABLE` no existía. Un proveedor ilimitado sólo podía declararse
`NOT_EVALUATED`, y eso era **falso**: sí se evaluó, y el resultado es que no hay
bolsa. La señal correspondiente es `UNLIMITED`, distinta de `UNKNOWN`, porque
aquí sí se sabe.
