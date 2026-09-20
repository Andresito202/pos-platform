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

> **Ningún comercio real puede operar todavía, y el motivo ya no es la
> interfaz.** La interfaz de caja existe y funciona de extremo a extremo. Lo que
> falta es que **alguien emita la credencial de sesión del cajero**: el POS sabe
> verificarla, nadie la produce.

Es un cambio de naturaleza del bloqueo, no un avance de porcentaje. Antes
faltaba *pantalla*; ahora falta *autoridad*.

## Lo común a todos los comercios

| Pieza | Estado | Evidencia medida |
|---|---|---|
| **Catálogo real** | ✅ | `MIGRATION_014` · `catalog_product` / `catalog_presentation` / `catalog_price` |
| **Inventario** | ✅ | `MIGRATION_015` · `inventory_stock` / `inventory_movement` · la venta descuenta al completarse |
| **Interfaz de caja** | ✅ | **28 de las 31 operaciones del contrato tienen pantalla**, repartidas en 11 paneles y hooks. `real-channel.spec.ts` conduce una venta entera desde la ventana de Electron contra el servicio real: alta de producto, existencia, escaneo, venta, cobro y recibo |
| Venta, cobro, caja y adquiriente | ✅ | `Sales`, `Cash`, `Payments`, `Customers`, alcanzables por el canal y desde la pantalla |
| Impuesto por línea | ✅ | `catalog_fiscal_attribute` (`MIGRATION_013`) **con escritor desde el 2026-09-20** (`D-19`): `catalog.fiscal.attribute.set`, con pantalla en `CatalogPanel` |
| Crédito (fiar) | ✅ | `customers_credit_accounts` / `customers_credit_transactions` · `CreditPanel` · E2E: fiar una venta y recibir el abono |
| Merma | ✅ | movimiento `SHRINKAGE` · el E2E ajusta 3 unidades por merma desde `InventoryPanel` |
| **Emisor de credencial de sesión** | ❌ | **el bloqueo vigente** — ver abajo |
| Lector de código de barras | ⚠️ | el catálogo resuelve código → artículo y garantiza que un código identifica una sola presentación. Un lector USB se comporta como teclado y escribe en `barcode-input`, así que **la ruta existe**; lo que no se ha verificado es un periférico real → `REQUIRES_LOCAL_VERIFICATION` |
| Balanza | ❌ | ninguna integración; `unit_precision` gobierna la cantidad pero nadie la lee de un periférico |

### Las 3 operaciones sin pantalla, y por qué

| Operación | Motivo |
|---|---|
| `runtime.handshake` | Es de transporte. No es una operación de cajero |
| `session.activate` | **Deliberado.** `SessionPanel` no ofrece botón de activar y hay prueba E2E que lo fija: activar exige una SSA firmada por la autoridad, y no se teclea |
| `catalog.item.get` | **No tiene ningún llamador.** Está en el contrato y el handler la sirve; `catalog.item.find` cubre hoy el mostrador. Es superficie sin consumidor: decidir si se le da uso o se retira es de producto |

## El bloqueo vigente: nadie emite la credencial de sesión

La cadena de confianza **está materializada** y llega hasta un paso del final:

```
clave raíz del producto  (infra/trust/…-root-public.pem)
        ↓  verifica
artefacto de instalador  (session-assertion-operational-key.json)
        ↓  main.ts:273 provisiona si el veredicto es VALID
local_trust_anchor       (MIGRATION_022)
        ↓  alimenta
SessionAssertionVerifier → session.activate puede VERIFICAR una SSA
        ↑
    ¿quién FIRMA la SSA del cajero?  ← nadie
```

Medido: `unsignedSessionAssertionBytes` sólo aparece **exportada por el
verificador**; ninguna ruta de producción la produce. El issuer de Central
Authority (`SessionTrustKeyIssuer`) firma la **publicación de la clave
operacional**, que es el artefacto de arriba, **no** la aserción de sesión de un
operador. Sólo las pruebas firman SSAs, con material generado en memoria.

**Consecuencia para un comercio real:** el equipo arranca, el servicio levanta,
la pantalla se monta — y `session.activate` rechaza toda credencial, de modo que
ninguna de las 28 operaciones con pantalla es alcanzable. Es el comportamiento
*fail-closed* correcto, no un defecto; por eso es deuda (`D-28`) y no bug.

### La raíz está más abajo de «falta escribir un emisor» — medido el 2026-09-20

`DEC-012` D1 fija que la SSA es un **artefacto emitido por la autoridad
central**. Central Authority existe y sirve exactamente dos endpoints —
`GET /v1/session-trust`, que publica la clave operacional, y
`POST /v1/device-enrollment`, que es `D-3`—. **Ninguno emite SSA.**

Pero escribir ese endpoint no desbloquearía nada, porque la cadena sigue:

```
un comerciante opera
  ← session.activate con una SSA válida
     ← la SSA la emite la autoridad central              (DEC-012 D1, decidido)
        ← que debe AUTENTICAR al usuario para emitirsela
           ← SEC-G02 «Authentication & Session»          PLANNED / NOT_EVALUATED
```

**No se puede emitir una credencial de sesión para un usuario que no se sabe
autenticar.** `DEC-012` §16 deja fuera de alcance, y sujetos a autorización
específica: «`SEC-G01`, `SEC-G02` y `SEC-G03`; login, MFA, rotación de refresh,
bloqueo y recuperación centrales; **el emisor central de SSA y SAS**; … **UI de
login**».

El siguiente paso real, por tanto, no es código: es **decidir `SEC-G02`**, que
el backlog marca `P0 / PLANNED / NOT_EVALUATED`.

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

**Eso no desbloquea a ningún comercio.** La presencia es un factor *adicional*
sobre una sesión ya establecida: sin SSA no hay sesión sobre la que exigirla.
Y §18 es explícita: «Fija la política que la implementación futura deberá
respetar; **no la autoriza**».

> `D-28` en el libro de deudas describe el ancla como vacía «porque nada la
> puebla». Eso quedó **superado por G1.2 el 2026-09-17**: el artefacto de
> instalador sí la puebla. Lo que sigue abierto, y es lo que hay que leer, es la
> **emisión de la SSA del operador**.

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
| múltiples presentaciones | ⚠️ | el esquema lo admite —`catalog_presentation` cuelga de `catalog_product` con índice por producto— pero **no existe operación para añadir una segunda presentación**: `catalog.product.register` crea producto, presentación y precio en una sola transacción, y no hay más operaciones de catálogo que ésa, la fiscal y las dos de lectura |
| compras · proveedores | ❌ | **sin tabla.** `PURCHASE_RECEIPT` es un tipo de movimiento de inventario, no un documento de compra: no hay proveedor, ni orden, ni costo |
| promociones | ❌ | sin tabla |
| lotes | ❌ | sin tabla |
| vencimientos | ❌ | sin tabla |
| despiece · transformación | ❌ | sin tabla ni movimiento |
| trazabilidad de producto | ❌ | `local_operation_audit` audita operaciones, no el recorrido de un lote |
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
| **Tienda de barrio** | Segunda presentación por producto (vender la unidad y el paquete del mismo artículo) |
| **Licorera · depósito de bebidas** | Segunda presentación · envase retornable |
| **Cacharrería y variedades** | Referencias, colores, tallas, variantes · precio mayorista/minorista |
| **Minimercado** | Lo de la tienda · compras y proveedores |
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
3. ~~**Interfaz de caja**~~ — hecha; 28 de 31 operaciones con pantalla,
   conducidas por E2E contra el servicio real.
4. ~~**Escritor de atributos fiscales**~~ — hecho el 2026-09-20 (`D-19`).
5. **Emisión de la credencial de sesión del operador.** Es el único bloqueo que
   afecta a los diez comercios a la vez. Sin él nada de lo anterior es
   alcanzable en un equipo real.
6. **Decisión de negocio sobre `D-14`** antes de vender a una carnicería o un
   fruver; y **fuente documental de `D-13`** para la venta de mostrador anónima.
7. **Segunda presentación por producto.** Es lo más barato de la lista de
   capacidades ausentes y desbloquea tienda de barrio y licorera.
8. **Balanza y lector**, los dos periféricos que aparecen en más comercios.

## Qué NO cubre este cruce

- **No se ejecutó nada en un equipo real de comercio.** Todo lo verde está
  medido en este entorno (Linux, SQLite real, Electron bajo `xvfb`). Windows,
  periféricos y una tienda de verdad siguen `REQUIRES_LOCAL_VERIFICATION`.
- **`PRODUCTION` sigue en cero** para toda fila del tablero, y este documento no
  lo cambia.
- **Nada de esto está en `main`:** la línea activa va muy por delante, y CI no
  asigna runner desde el 2026-09-14.

## Historial

| Fecha | Qué se cruzó |
|---|---|
| 2026-09-07 | primer cruce; `unit_precision` pasa a gobernar la cantidad; se documenta el bloqueo fiscal de la venta por peso |
| 2026-09-07 | catálogo real materializado: la primera de las tres piezas comunes deja de faltar |
| 2026-09-08 | inventario materializado; queda la interfaz de caja como única pieza común ausente |
| 2026-09-20 | **re-medición completa contra el árbol.** La interfaz de caja llevaba doce días construida y el documento seguía diciendo que no existía. Se corrige, se cruzan las capacidades por sector contra las tablas reales del esquema, y se reidentifica el bloqueo común: ya no es pantalla, es la **emisión de la credencial de sesión**. Se anota que `D-28` describe un ancla vacía que G1.2 dejó de serlo |
