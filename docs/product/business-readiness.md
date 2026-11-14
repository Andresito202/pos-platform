# Qué comercios puede atender hoy el POS

> **ATENCIÓN — corte histórico, no estado actual.** La evaluación original de este documento corresponde al 7–8 de septiembre de 2026 y a `main` de ese momento. Las frases posteriores «no existe interfaz de caja», «ningún comercio puede vender» y «no existe ni el perfil ni la interfaz» describen ese corte histórico. **No deben emplearse como diagnóstico del HEAD actual.** La actualización verificable de la rama única `cursor/commercial-design-review-0d11` se expone a continuación. Esta actualización es una reconciliación documental, no una nueva prueba de producto ni una certificación de producción.

## Estado actualizado — 2026-11-13 (rama de consolidación)

| Capacidad | Evidencia posterior inspeccionada | Estado demostrable y límite |
| --- | --- | --- |
| Interfaz de caja | `apps/pos-desktop/renderer/src/App.tsx` monta `SalePanel` si existe `SALES_SALE_CREATE`; `SalePanel.tsx` contiene operaciones de carrito/cobro y clientes en espera; `README.md` registra las integraciones | **Implementada en la rama de trabajo**. No significa Windows/Android E2E, instalación comercial ni autorización BUSINESS certificadas. Ya no es correcto afirmar que falta toda la interfaz. |
| Catálogo e inventario | `CatalogPanel`, `InventoryPanel`, `ReceiveStockUseCase`, `AdjustStockUseCase`; evidencia documentada en `integration-verification-20261110.md` | Base conectada para operaciones actuales; no cubre ciclo completo de lotes/FEFO, transformación, recetas ni todas las reglas sectoriales. |
| Importación de existencias | Plantilla CSV UTF-8 editable en Excel y confirmación por fila bajo autorización; documentado en `integration-verification-20261110.md` | Existe **CSV**, no lectura nativa XLSX. Un movimiento manual incierto no conserva su identidad tras cerrar la pantalla; la reejecución requiere cuidado. |
| Ventas en espera | `SalePanel.tsx` y `waiting-carts.md` documentan guardado/recuperación/eliminación en SQLite | Implementado antes del cobro, sin recuperar automáticamente pagos externos inciertos. |
| Venta por peso | `unit_precision` y validaciones de escala, magnitud y saldo registradas en `business-types.md` | Existe base de cantidades fraccionarias; no acredita balanza física, tara, lotes, ni conversión fiscal externa. La regla histórica D-14 requiere revalidación con adaptador Factus y contrato vigente; no se declara resuelta. |
| Especialización del comercio | `business-types.md` enumera faltantes concretos para fruver, salsamentaria/avícola, droguería y pastelería | **No hay certificación de una modalidad sectorial completa**. Una pantalla genérica no prueba el módulo sectorial ni su habilitación/licencia firmada. |
| Hardware y Android | README y backlog mantienen deltas exclusivos de Android/balanza/QR pendientes de incorporar selectivamente | No afirmar que esos cambios están integrados al POS comercial por existir en otras ramas; la verificación física sigue pendiente. |
| Emisión fiscal y pagos externos | `integration-verification-20261110.md` documenta servicios y pruebas con simulación de proveedor | Factus externo, confirmación bancaria y operación comercial completa no acreditados. |

**Prioridad vigente del propietario:** farmacia/droguería, salsamentaria a partir de la base avícola y pastelería. Esta prioridad sustituye el orden de urgencia comercial de la tabla histórica inferior; no implica que sus flujos especializados estén terminados. El núcleo de POS sigue siendo uno solo. La fuente posterior de requisitos sectoriales es [business-types.md](business-types.md); la evidencia y los límites de integraciones, [integration-verification-20261110.md](integration-verification-20261110.md).

**Niveles de evidencia:** los archivos consultados comprueban presencia de código y documentación en la rama. Los conteos de pruebas citados en documentos previos son antecedentes atribuidos a sus respectivos SHAs; **no se reejecutaron pruebas nuevas durante esta actualización**. La certificación BUSINESS/SCM, la instalación Windows, Android comercial y el despliegue quedan pendientes.

---

## Registro histórico (septiembre de 2026; no vigente como diagnóstico)

## Para qué existe este documento

`business-types.md` declara a qué comercios apunta el producto. Este documento
cruza esa lista contra lo que hay en `main`, con la evidencia de cada fila.

Es el cruce que faltaba: la lista de comercios es una **intención de producto**,
y hasta ahora nadie había comprobado cuáles de esas operaciones el POS puede
ejecutar de verdad.

La respuesta corta, y conviene leerla antes que la tabla:

> **Hoy el POS todavía no puede atender a ninguno de los comercios
> prioritarios.** El catálogo real está (2026-09-07) y el inventario también
> (2026-09-08); falta la **interfaz de caja**, y la necesitan todos: sin
> pantalla no hay quien opere lo que ya existe por debajo.

Los comercios de **venta por peso** tienen además un bloqueo propio, y es el
hallazgo que más importa de este cruce.

## Lo que todos necesitan y no existe

| Pieza | Estado | Evidencia |
|---|---|---|
| **Catálogo real** | ✅ | `MIGRATION_014` · `catalog_product` / `catalog_presentation` / `catalog_price` · alcanzable por el canal |
| **Inventario** | ✅ | `MIGRATION_015` · `inventory_stock` / `inventory_movement` · recibir, ajustar y consultar por el canal · la venta descuenta al completarse |
| **Interfaz de caja** | ❌ | el renderer expone tres llamadas técnicas y **ninguna comercial** |
| **Lector de código de barras** | ⚠️ | el catálogo resuelve **código → artículo** (`catalog.item.find`) y garantiza que un código identifica una sola presentación; falta el periférico que lo lea |
| Venta, cobro, caja y adquiriente | ✅ | `Sales`, `Cash`, `Payments`, `Customers` en `main`, probados |
| Impuesto por línea | ✅ | `catalog_fiscal_attribute` · `MIGRATION_013` |

**Actualización del 2026-09-08:** con el inventario materializado queda **una
sola** pieza común en ❌: la **interfaz de caja**. Y mientras siga en ❌ el tipo
de comercio sigue siendo irrelevante y **ninguno puede vender**, porque un
cajero no tiene pantalla desde la que hacerlo. Que el motor esté completo no
vende nada por sí solo; es exactamente la distinción entre *alcanzable* y
*operativo* que este proyecto se obliga a no confundir.

## Comercios prioritarios, uno por uno

| Comercio | Además de lo común, necesita | Estado |
|---|---|---|
| Tienda de barrio | código de barras, presentaciones, crédito | ❌ los tres |
| Minimercado | ídem + compras | ❌ |
| Supermercado pequeño/mediano | ídem + promociones, multisucursal | ❌ promociones · el ámbito multisucursal **sí** existe en el modelo |
| Perecederos y **venta por peso** | balanza, lotes, vencimientos, merma | ❌ los cuatro · **más el bloqueo fiscal de abajo** |
| Carnicería | ídem + despiece, transformación, trazabilidad | ❌ |
| Fruver | ídem + catálogo visual, alertas | ❌ |
| Cacharrería y variedades | referencias, colores, tallas, precio mayorista/minorista | ❌ |
| Papelería | código de barras, inventario | ❌ sólo por la interfaz: código de barras e inventario **ya están** |
| Depósito de bebidas · licorera | presentaciones, envase retornable | ❌ envase · presentaciones existen en el esquema |

## El bloqueo propio de la venta por peso

Cuatro de los diez comercios prioritarios venden por peso: perecederos,
carnicerías, fruver y parte de los minimercados. Ahí hay **dos** problemas
distintos, y sólo uno estaba registrado.

### 1. Seis decimales no se pueden facturar — `D-14`

El POS lleva el dinero y las cantidades en escala 6. La documentación de emisión
de FACTUS es explícita: **todos los numéricos viajan con máximo dos decimales**.

Una báscula produce `0.333333` kg. Ese valor **no se puede transmitir con
fidelidad**, y `toProviderDecimal` se niega a redondearlo en vez de emitir una
factura que no coincide con lo pesado y cobrado.

**Consecuencia concreta:** una carnicería que pese 333 gramos con seis decimales
de precisión puede vender y cobrar, y **no puede facturar electrónicamente esa
venta**. La decisión de qué hacer —redondear la cantidad antes de vender,
declarar la unidad con menos precisión, o rechazar la venta— es de negocio, no
de programa, y hay que tomarla antes de vender a una carnicería.

### 2. La precisión de la unidad ahora sí gobierna

`unit_precision` existía en el catálogo, se arrastraba hasta el snapshot de la
línea y **no comprobaba nada**. Se podía vender `0.000001` de una botella y
cobrarlo; comprobado con sonda contra el contrato antes de escribir la regla.

Ahora `CreateSaleUseCase` rechaza con `QUANTITY_PRECISION_EXCEEDED` la cantidad
que no cabe en la precisión declarada, **antes** de multiplicarla por ningún
precio. Eso protege los dos extremos del catálogo de comercios:

- **tienda, licorera, papelería** venden unidades discretas (`unit_precision`
  0): media unidad es un error de captura, no una venta;
- **carnicería y fruver** venden por peso (`unit_precision` 3): tres decimales
  son legítimos y seis no —y seis, además, no se facturan—.

Declarar la unidad de peso con `unit_precision` 2 hace que `D-14` deje de morder
esa presentación: la cantidad ya no puede tener más decimales de los que el
proveedor acepta. **Es la mitigación disponible hoy**, y es una decisión de
configuración del comercio, no un cambio de código.

## La regla de interfaz todavía no se puede cumplir

`business-types.md` cierra con: «cada negocio verá únicamente las funciones,
categorías y módulos relevantes para su operación».

Eso exige un perfil de comercio que module la interfaz, y **no existe ni el
perfil ni la interfaz**. Se registra aquí para que no se dé por hecho al diseñar
las pantallas: la regla es una decisión ya tomada que la interfaz tendrá que
respetar desde el primer día, no un añadido posterior.

## Orden que se deriva de este cruce

No es una lista de deseos: es el orden en que los bloqueos se desbloquean entre sí.

1. ~~**Catálogo real** con presentaciones, códigos de barras y unidades.~~
   **Hecho el 2026-09-07** (`MIGRATION_014`).
2. ~~**Inventario.** Lo exigen todos los prioritarios salvo la venta pura de
   servicios.~~ **Hecho el 2026-09-08** (`MIGRATION_015`), con la salida de
   mercancía atada a la transacción que completa la venta.
3. **Interfaz de caja.** Es lo único común que queda: **diecinueve** operaciones
   construidas y probadas esperan pantalla, y sin ella ninguna es usable por un
   cajero.
4. **Decisión de negocio sobre `D-14`** antes de vender a una carnicería o un
   fruver.
5. **Balanza y lector**, que son los dos periféricos que aparecen en más
   comercios de la lista.

## Historial

| Fecha | Qué se cruzó |
|---|---|
| 2026-09-07 | primer cruce; `unit_precision` pasa a gobernar la cantidad; se documenta el bloqueo fiscal de la venta por peso |
| 2026-09-07 | catálogo real materializado: la primera de las tres piezas comunes deja de faltar |
