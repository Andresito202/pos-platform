# Qué comercios puede atender hoy el POS

## Para qué existe este documento

`business-types.md` declara a qué comercios apunta el producto. Este documento
cruza esa lista contra lo que existe **en la línea activa**, con la evidencia de
cada fila.

La lista de comercios es una **intención de producto**. Este cruce comprueba
cuáles de esas operaciones el POS puede ejecutar de verdad.

> **Aviso: este documento envejece en silencio.** Entre el 2026-09-08 y el
> 2026-09-20 afirmó que «el renderer expone tres llamadas técnicas y **ninguna
> comercial**» mientras once paneles ya invocaban veintiocho operaciones. Nadie
> lo volvió a medir porque nada fallaba. **Mide contra el árbol antes de citar
> una fila de aquí.**

## La respuesta corta — medida el 2026-09-20

> **Ningún comercio real puede operar todavía, y el motivo ya no es ni la
> interfaz ni la autoridad: es un fichero mal formado.** La interfaz de caja
> existe y funciona de extremo a extremo. La credencial del cajero ya tiene
> productor —`DEC-025`, aprovisionamiento firmado por el propietario— y el
> arranque completo se ejecutó el 2026-09-20. Lo que falta es que **el material
> de confianza publicado por `G1.2` sea legible para su propio contrato**
> (`D-30`), y eso exige la clave raíz que custodia el propietario.

El bloqueo ha cambiado de naturaleza dos veces en tres días, y conviene no
confundirlas. Primero faltaba *pantalla*. Después faltaba *autoridad*. Ahora
falta **un artefacto bien escrito**, que es un problema mucho más pequeño —y
por eso mismo merece decirse sin adornos en vez de dejarlo dicho como si
siguiera faltando una autoridad central.

## Lo común a todos los comercios

| Pieza | Estado | Evidencia medida |
|---|---|---|
| **Catálogo real** | ✅ | `MIGRATION_014` · `catalog_product` / `catalog_presentation` / `catalog_price` |
| **Inventario** | ✅ | `MIGRATION_015` · `inventory_stock` / `inventory_movement` · la venta descuenta al completarse |
| **Interfaz de caja** | ✅ | **42 de las 44 operaciones del contrato tienen pantalla**, repartidas en 18 paneles y hooks. `real-channel.spec.ts` conduce una venta entera desde la ventana de Electron contra el servicio real: alta de producto, existencia, escaneo, venta, cobro y recibo |
| Venta, cobro, caja y adquiriente | ✅ | `Sales`, `Cash`, `Payments`, `Customers`, alcanzables por el canal y desde la pantalla |
| Impuesto por línea | ✅ | `catalog_fiscal_attribute` (`MIGRATION_013`) **con escritor desde el 2026-09-20** (`D-19`): `catalog.fiscal.attribute.set`, con pantalla en `CatalogPanel` |
| Devolución | ⚠️ | **Existe desde el 2026-09-27** (`D-48`/`D-49`): `ReturnPanel` → `sales.return.create`. Devuelve líneas enteras de una venta cobrada con un único pago en efectivo **o transferencia**: en efectivo, el dinero sale del turno abierto ahora —y no sale si el turno no lo tiene—; en transferencia, no toca caja y el reembolso queda pendiente hasta que otra persona lo confirme con `payments.refund.confirm` (`ReturnPanel` pide esa confirmación en su propia pantalla). Lo reponible vuelve a la existencia y a su lote cuando se sabe cuál; todo queda auditado. E2E desde la ventana de Electron, los dos medios. **Falta**: la nota crédito de una venta facturada (se devuelve y se avisa), el reembolso de QR, fiado o pago mixto (QR no tiene reversal real de proveedor todavía), el flujo en que el cajero solicita y otro aprueba la devolución misma, y la devolución parcial de una venta con ajuste de redondeo |
| Crédito (fiar) | ✅ | `customers_credit_accounts` / `customers_credit_transactions` · `CreditPanel` · E2E: fiar una venta y recibir el abono |
| Merma | ✅ | movimiento `SHRINKAGE` · el E2E ajusta 3 unidades por merma desde `InventoryPanel` |
| **Productor de credencial de sesión** | ⚠️ | **Existe desde el 2026-09-20** (`DEC-025`): artefacto con SSA + SAS firmado por el propietario, consumido al arrancar por las rutas canónicas. Ejecutado de extremo a extremo con material de prueba. **No sirve todavía con el material publicado** — ver abajo |
| Lector de código de barras | ⚠️ | el catálogo resuelve código → artículo y garantiza que un código identifica una sola presentación. **Desde el 2026-09-26 (`D-46`) el flujo es de lector y no de ratón**: el Enter que envía un lector USB busca el código, el campo se vacía tras cada lectura —antes, la segunda se concatenaba a la primera— y ya no se deshabilita durante la búsqueda —antes perdía el foco y la lectura siguiente se escribía en ningún sitio—; una lectura que no cumple `BarcodeSchema` no llega al servicio y se muestra. Una doble lectura accidental no agrega dos veces, porque buscar no agrega. Ningún lector físico probado → `REQUIRES_LOCAL_VERIFICATION` |
| Balanza | ❌ | ninguna integración; `unit_precision` gobierna la cantidad pero nadie la lee de un periférico |
| Cajón monedero | ⚠️ | **Existe desde el 2026-09-26** (`D-46`), con la política ratificada por el propietario: se abre solo tras un cobro en efectivo que completa la venta —el servicio lo comprueba contra el cobro, un pulso por cobro— y a mano sólo con `CASH_DRAWER_OPEN_MANUAL` (OWNER y GENERAL_ADMIN), motivo del catálogo y auditoría antes del pulso. «Abierto» significa que el pulso llegó a la impresora: sin sensor no se sabe más. Ningún cajón físico → `REQUIRES_LOCAL_VERIFICATION` |
| Impresora de recibos | ⚠️ | **Existe desde el 2026-09-26** (`D-46`): botón «Imprimir recibo» en `ReceiptPanel` → `sales.receipt.print` → cola persistente → ticket ESC/POS por TCP crudo a una impresora de red local. Repetir la misma petición no imprime otro papel; un «sin papel» corregido reintenta el mismo trabajo; un segundo papel sale marcado «REIMPRESIÓN». Probado contra simulador y emulación de protocolo, **ningún modelo físico** → `REQUIRES_LOCAL_VERIFICATION`. USB directo y spooler de Windows no existen |

### Las 2 operaciones sin pantalla, y por qué

| Operación | Motivo |
|---|---|
| `runtime.handshake` | Es de transporte. No es una operación de cajero |
| `session.activate` | **Deliberado.** `SessionPanel` no ofrece botón de activar y hay prueba E2E que lo fija: activar exige una SSA firmada por la autoridad, y no se teclea |

## El bloqueo vigente: el artefacto de confianza no es legible

**Esta sección decía «nadie emite la credencial de sesión» y estuvo dos días
diciéndolo de más.** Se corrige el 2026-09-22 contra lo que se midió
arrancando el servicio, no leyendo código.

La cadena está completa y **se ejecutó entera**:

```
clave raíz del producto  (infra/trust/…-root-public.pem)
        ↓  verifica
bundle de confianza      (una clave por propósito desde D-31)
        ↓  componente `session-trust-provisioning`, antes de que nadie lea claves
local_trust_anchor       (MIGRATION_022)
        ├─ SESSION_ASSERTION      → SessionActivation.activate   (SSA-002)
        └─ AUTHORIZATION_SNAPSHOT → SnapshotAcquisitionService   (SAS-003)
        ↑
    ¿quién FIRMA la SSA del cajero?  ← el propietario, con `DEC-025`
```

Arranque real de un equipo sin provisionar, medido el 2026-09-20 con material
generado para la prueba:

```
security.session_trust    → {"decision":"VALID","provisioned":2}
security.trust_anchors    → {"usable":"session_assertion=1 authorization_snapshot=1 license=0"}
security.operator_session → {"decision":"PROVISIONED"}
```

### Lo que impide llevarlo a un mostrador: `D-30`

El artefacto que `G1.2` **publicó de verdad**
—`infra/trust/session-assertion-operational-key.json`— no parsea contra su
propio contrato: `key_id` vale `ssa-2026-01` y `environment` vale `production`,
en minúsculas, y ambos son `StableCodeSchema`. Un equipo apuntado a ese fichero
registra `session_trust: INVALID`, `provisioned: 0` y **rechaza toda sesión**.

Re-firmarlo con códigos en mayúsculas exige la **clave privada raíz**, que no
entra al repositorio y custodia el propietario. Es lo único que separa este
proyecto de un mostrador real, y **no es trabajo de motor**.

### Tres defectos que sólo aparecieron al ejecutar

Ninguno se veía leyendo. Los tres estaban en la ruta que este documento daba
por buena:

| # | Qué | Estado |
|---|---|---|
| `D-32` | La provisión del ancla corría **después** de que sus consumidores resolvieran las claves. El primer arranque de un equipo recién aprovisionado rechazaba su propia sesión con `SIGNATURE_INVALID` y sólo funcionaba al segundo — justo el arranque para el que se escribió `DEC-025` | ✅ corregido |
| `D-31` | El bundle **no podía publicar** la clave de propósito `AUTHORIZATION_SNAPSHOT`, así que el segundo sobre de `DEC-025` no podía verificarse en ningún arranque | ✅ corregido: una clave por propósito |
| `D-30` | El artefacto publicado no parsea | ❌ **abierto** — depende de la clave raíz |

La razón de que nadie los viera está registrada y vale más que los defectos: la
única prueba que arrancaba el runtime de producción es `skipIf` de Windows, y
CI corre en Linux. **Una puerta que no se ejecuta no es una puerta.**

### Lo que sigue abierto a largo plazo, y no es esto

`DEC-025` es un **bootstrap**, no un emisor central. `DEC-012` D1 mantiene que
la SSA es un artefacto emitido por la autoridad central, y esa autoridad sigue
sin existir:

```
una sesión emitida centralmente
  ← que debe AUTENTICAR al usuario para emitírsela
     ← SEC-G02 «Authentication & Session»   PLANNED / NOT_EVALUATED
```

Eso sigue siendo `D-28` y sigue exigiendo **decidir `SEC-G02`**. Lo que cambia
es que ya **no bloquea a un comercio**: el propietario puede aprovisionar un
equipo hoy. Rotación, revocación en línea y recuperación no existen; revocar
una sesión aprovisionada exige entregar un artefacto con `sequence` mayor, o
esperar a que expire.

### Lo que la prueba de presencia (PIN) sí desbloquea, y lo que no

`DEC-012` D2 autoriza una prueba de presencia local, y §18 fija su política:
**PIN numérico de 6 dígitos**, por CSPRNG y no elegido por el usuario,
individual —el factor compartido está prohibido—, nunca en claro ni en logs,
almacenado sólo como verifier derivado con `scrypt`, máximo 5 intentos con
contadores independientes por usuario.

Su condición previa —que la prohibición de `sync-base-schema.md:27` alcanza a
credenciales centrales replicadas y **no** a material generado localmente,
acotado a la sesión e inútil contra la autoridad central— quedó **ratificada
por el propietario el 2026-09-20**.

**Sigue sin autorizarse su implementación**, y ahora importa más que antes: una
sesión aprovisionada sin PIN significa que **quien tenga acceso físico al
terminal opera como ese usuario** hasta que la SSA expire. `DEC-025` acepta ese
riesgo residual de forma explícita y su control es organizativo —quién tiene
llave del local—, no técnico.

## Capacidades por sector — cruce contra el esquema real

Medido enumerando las tablas de `local-database.ts` y las operaciones del
contrato, no por lectura de documentos.

| Capacidad declarada en `business-types.md` | Estado | Evidencia |
|---|---|---|
| código de barras | ✅ | `catalog.item.find` · índice único parcial por tenant |
| inventario | ✅ | `inventory_stock` / `inventory_movement` |
| caja | ✅ | `cash_shift` / `cash_movement` / `cash_register` |
| crédito | ✅ | `customers_credit_accounts` / `customers_credit_transactions` |
| merma | ✅ | movimiento `SHRINKAGE` |
| multisucursal | ⚠️ | `branch_id` está en el modelo y en el contexto autorizado; **no hay operación ni pantalla** de gestión de sucursales |
| múltiples presentaciones | ✅ | **Cerrado el 2026-09-20.** `catalog.presentation.add` añade una presentación con su precio a un producto ya dado de alta, con pantalla en `CatalogPanel` |
| conversión entre presentaciones | ✅ | **Cerrado el 2026-09-20.** `catalog_unit_conversion` (`MIGRATION_024`, `DEC-004` §1579) declara `1 origen = factor destino`; `inventory.conversion.apply` la ejecuta de forma **atómica** (§1736): salida en origen y entrada en destino en una transacción, con tipos de movimiento propios `CONVERSION_OUT`/`CONVERSION_IN` (`MIGRATION_025`). No redondea: si `cantidad × factor` no da exacto o no cabe en la precisión del destino, rechaza. El factor lo pone el catálogo, nunca el mostrador |
| compras · proveedores | ❌ | **sin tabla.** `PURCHASE_RECEIPT` es un tipo de movimiento de inventario, no un documento de compra: no hay proveedor, ni orden, ni costo |
| promociones | ❌ | sin tabla |
| lotes | ✅ | `inventory_lot` (`MIGRATION_026`); recibir, listar en orden FEFO y rastrear **con pantalla** («Lotes y vencimientos»). Toda salida baja del lote: venta y apertura de paca por FEFO; merma, ajuste negativo y traslado del lote que se nombre en la pantalla de ajuste, o por FEFO. Código único por sucursal (`MIGRATION_028`). Las unidades de una paca abierta heredan su tanda (`MIGRATION_029`). El ajuste positivo suma a una tanda existente nombrándola, y el libro del lote registra entradas y salidas (`MIGRATION_030`) |
| vencimientos | ⚠️ | `expiry_date` por lote; `VALID`/`NEAR_EXPIRY`/`EXPIRED` derivados —«próximo a vencer» = vence hoy o en los próximos **7 días**, decisión del propietario del 2026-09-26—; la venta **no elige un lote vencido** (FEFO sobre vigentes). La lista de lotes avisa cuántas tandas con existencia vencen pronto y cuántas vencidas quedan por sacar. La merma por vencimiento sale **del lote vencido que se nombra** y sin lote se rechaza. «Vence esta semana» (`inventory.lot.expiring`) lista, para **todos los productos** de la sucursal, las tandas con existencia vencidas o a 7 días o menos, nombradas por Catálogo (`catalog.item.get`), cada una con su rastro a un clic |
| despiece · transformación | ❌ | sin tabla ni movimiento |
| trazabilidad de producto | ⚠️ | Lote → ventas y mermas, con pantalla: `inventory.lot.trace` devuelve cada salida de la tanda y la pantalla abre cada venta con su recibo (`inventory_lot_allocation`, `MIGRATION_027`, append-only). Y de la venta **al comprador**: el recibo dice qué cliente nombró la venta y «Compradores del lote» da la lista de un retiro con teléfono y correo, las ventas anónimas contadas y lo ilegible declarado. La venta de mostrador no tiene comprador; facturar a nombre de otro exige confirmación (`D-40`), y el rastro llega también al adquiriente de la factura (`fiscal.document.list`). El rastro y la lista de compradores bajan de la paca a sus unidades |
| precios mayorista/minorista | ❌ | `catalog_price` admite **un** precio `ACTIVE` por presentación |
| envase retornable | ❌ | sin modelo |
| referencias · colores · tallas · variantes | ❌ | sin modelo |
| catálogo visual | ❌ | sin imágenes en el modelo |
| alertas | ❌ | sin modelo |
| balanza | ❌ | sin integración |

## Comercios prioritarios, uno por uno

«Operable» supone resuelto el bloqueo de credencial de sesión, que afecta a
todos por igual y por eso no se repite en cada fila.

| Comercio | Qué le falta, además de la credencial |
|---|---|
| **Papelería** | **Nada más.** Código de barras, inventario, caja, venta y cobro existen y tienen pantalla. Es el comercio más cercano a operable |
| **Tienda de barrio** | **Nada más**, desde el 2026-09-20: declara la segunda presentación y abre pacas para vender unidades |
| **Licorera · depósito de bebidas** | Envase retornable (la segunda presentación ya está) |
| **Cacharrería y variedades** | Referencias, colores, tallas, variantes · precio mayorista/minorista |
| **Minimercado** | Compras y proveedores |
| **Supermercado pequeño/mediano** | Lo del minimercado · promociones · gestión de sucursales |
| **Fruver** | Balanza · catálogo visual · alertas · **`D-14`** |
| **Perecederos · venta por peso** | Balanza · lotes · vencimientos · **`D-14`** |
| **Carnicería** | Lo de perecederos · despiece · transformación · trazabilidad · **`D-14`** |

## El bloqueo propio de la venta por peso

Cuatro de los diez prioritarios venden por peso. Ahí hay dos cosas distintas.

### 1. Seis decimales no se pueden facturar — `D-14`

El POS lleva dinero y cantidades en escala 6; FACTUS acepta **dos decimales**.
Una báscula produce `0.333333` kg, y `toProviderDecimal` devuelve
`NOT_REPRESENTABLE` en vez de redondear: redondear emitiría una factura que no
coincide con lo pesado y cobrado, y el descuadre aparecería en la contabilidad
del comerciante.

**Consecuencia:** una carnicería que pese 333 gramos con seis decimales puede
vender y cobrar, y **no puede facturar electrónicamente esa venta**. Qué hacer
—redondear antes de vender, declarar la unidad con menos precisión, o rechazar—
es una decisión de negocio, y hay que tomarla antes de vender a una carnicería.

**Mitigación disponible hoy, sin cambiar código:** declarar la unidad de peso
con `unit_precision` 2. La cantidad deja de admitir más decimales de los que el
proveedor acepta.

### 2. La precisión de la unidad gobierna la cantidad

`CreateSaleUseCase` rechaza con `QUANTITY_PRECISION_EXCEEDED` la cantidad que no
cabe en la precisión declarada, **antes** de multiplicarla por ningún precio.
Protege los dos extremos del catálogo: la tienda y la papelería venden unidades
discretas (`unit_precision` 0, media unidad es un error de captura); la
carnicería y el fruver venden por peso (`unit_precision` 3 es legítimo, 6 no —y
6, además, no se factura).

## Facturación electrónica — qué cambió el 2026-09-20

`D-19` está **cerrada**: ya existe `catalog.fiscal.attribute.set`, con pantalla,
que da a una presentación sus códigos DIAN validando **pertenencia** a las tablas
verificadas antes de escribir. Medido en E2E: declarados los códigos desde la
ventana, la factura llega a `ISSUED` con CUFE y número.

Ese `ISSUED` es contra el puerto de emisión sustituido del arnés. Hablar con
FACTUS de verdad es `F6` y exige credenciales que no están en el repositorio.

Queda **`D-13`**: el adquiriente genérico de la DIAN («consumidor final») no
está verificado, así que **una venta de mostrador anónima no se puede emitir**.
Es el caso mayoritario de un POS colombiano, y no es trabajo de motor: es una
fuente documental que nadie ha aportado.

## La regla de interfaz sigue sin cumplirse

`business-types.md` cierra con: «cada negocio verá únicamente las funciones,
categorías y módulos relevantes para su operación».

La interfaz ya existe, pero **no hay perfil de comercio que la module**: los
once paneles se montan todos, para todos. La regla es una decisión tomada que la
interfaz tendrá que respetar, y cuanto más crezcan los paneles más caro será
retrofitearla.

## Orden que se deriva de este cruce

No es una lista de deseos: es el orden en que los bloqueos se desbloquean.

1. ~~**Catálogo real**~~ — hecho el 2026-09-07 (`MIGRATION_014`).
2. ~~**Inventario**~~ — hecho el 2026-09-08 (`MIGRATION_015`).
3. ~~**Interfaz de caja**~~ — hecha; las operaciones con pantalla están
   contadas arriba, en una sola frase que `document-claims.test.mjs` vigila.
   Aquí no se repite la cifra: repetirla fue exactamente cómo este punto acabó
   diciendo «28 de 31» mientras la frase vigilada decía «31 de 34».
4. ~~**Escritor de atributos fiscales**~~ — hecho el 2026-09-20 (`D-19`).
5. ~~**Emisión de la credencial de sesión del operador**~~ — resuelta el
   2026-09-20 (`DEC-025`), y ejecutada de extremo a extremo tras corregir
   `D-32` y `D-31`. **Queda `D-30`**: re-firmar el artefacto publicado por
   `G1.2` con códigos en mayúsculas, que exige la clave raíz del propietario.
   Sigue siendo el único bloqueo que afecta a los diez comercios a la vez.
6. **Decisión de negocio sobre `D-14`** antes de vender a una carnicería o un
   fruver; y **fuente documental de `D-13`** para la venta de mostrador anónima.
7. ~~**Segunda presentación por producto** y ~~**conversión entre ellas**~~ —
   hechas el 2026-09-20 (`catalog.presentation.add`,
   `catalog.conversion.declare`, `inventory.conversion.apply`).
8. **Balanza y lector**, los dos periféricos que aparecen en más comercios.

## Qué NO cubre este cruce

- **No se ejecutó nada en un equipo real de comercio.** Todo lo verde está
  medido en este entorno (Linux, SQLite real, Electron bajo `xvfb`). Windows,
  periféricos y una tienda de verdad siguen `REQUIRES_LOCAL_VERIFICATION`.
- **`PRODUCTION` sigue en cero** para toda fila del tablero, y este documento no
  lo cambia.
- **Nada de esto está en `main`:** la línea activa va muy por delante, y CI no
  asigna runner desde el 2026-09-14. Medido de nuevo el 2026-09-22: el run #209
  sobre `4502c6f` dura **2 segundos, sin pasos y sin logs**, con etiqueta
  `ubuntu-24.04` válida. Es asignación de runner, no un fallo del repositorio.

## Historial

| Fecha | Qué se cruzó |
|---|---|
| 2026-09-07 | primer cruce; `unit_precision` pasa a gobernar la cantidad; se documenta el bloqueo fiscal de la venta por peso |
| 2026-09-07 | catálogo real materializado: la primera de las tres piezas comunes deja de faltar |
| 2026-09-08 | inventario materializado; queda la interfaz de caja como única pieza común ausente |
| 2026-09-27 | **devolución en efectivo** (`D-48`): nueva operación con pantalla; la cifra de operaciones con pantalla y de superficies se actualiza en su única frase vigilada |
| 2026-09-22 | **corrección del bloqueo, por haberlo ejecutado.** Este documento afirmó dos días que faltaba «alguien que emita la credencial», cuando `DEC-025` ya autorizaba al propietario a producirla. Al arrancar el servicio de verdad aparecieron tres defectos que nadie podía ver leyendo: `D-32` (la provisión del ancla corría detrás de sus consumidores), `D-31` (el bundle no podía publicar la clave del snapshot) y `D-30` (el artefacto publicado no parsea). Los dos primeros quedan corregidos y la cadena completa se ejecuta: `PROVISIONED`. **El bloqueo real es ahora `D-30`**, y depende de la clave raíz del propietario. Se retira además la cifra de operaciones con pantalla del §Orden: decía «28 de 31» mientras la frase vigilada decía «31 de 34» —dos superficies para el mismo dato es cómo envejeció— |
| 2026-09-20 | **re-medición completa contra el árbol.** La interfaz de caja llevaba doce días construida y el documento seguía diciendo que no existía. Se corrige, se cruzan las capacidades por sector contra las tablas reales del esquema, y se reidentifica el bloqueo común: ya no es pantalla, es la **emisión de la credencial de sesión**. Se anota que `D-28` describe un ancla vacía que G1.2 dejó de serlo |
