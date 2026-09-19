# DEC-005 — El crédito al cliente cubre la venta; la obligación vive aparte

**Estado:** aceptada · **Fecha:** 2026-09-19 · **Ámbito:** Payments · Sales · Customers

## Contexto

En una tienda de barrio el fiado no es un caso marginal: es la mitad del
mostrador. El cliente se lleva la mercancía y el dinero no entra.

El repositorio llevaba cuatro bloques evitando esa operación. `CUSTOMER_CREDIT`
figura en el `CHECK` de `payment_method` desde `MIGRATION_011`, pero
`payments-schema.md` §93 es explícito: *«el método no autoriza crear sus
agregados anticipadamente»*. `CUST-002` depende de esta decisión y `PAY-009`
también. Esta decisión llevaba `DEFERRED` desde entonces.

La pregunta que bloqueaba era una sola y no admite término medio:

**¿El crédito cubre la venta, o la deja incompleta?**

## Las dos lecturas, y por qué sólo una sobrevive al código

**Lectura B — la venta queda incompleta y el saldo es la cobertura faltante.**
Es la que parece barata: la maquinaria de cobertura parcial ya existe y está
probada. No sobrevive al contacto con lo que el código hace.

`completeSaleIfCovered` es, dicho en su propio comentario, *«el único punto del
sistema que produce `COMPLETED`»*, y sólo dispara cuando la cobertura recomputada
desde `payments_payment_allocations` alcanza el importe pagadero. Dentro de esa
misma rama, antes de marcar `COMPLETED`, corre `deductSoldStock`.

Las dos cosas están soldadas a propósito: *«una venta cobrada cuya existencia
sigue en la estantería es el descuadre que el inventario existe para impedir»*.

Bajo la lectura B esa rama **nunca se ejecuta**. La consecuencia no es teórica:

- la mercancía que el cliente se llevó sigue contando como existencia, hasta
  que pague la última cuota — es decir, el descuento de inventario ocurriría
  meses después de la entrega, o nunca;
- la venta entregada permanece en `PAYMENT_IN_PROGRESS` indefinidamente;
- y por tanto **no es facturable**, cuando en Colombia la obligación de
  facturar nace con la entrega y no con el cobro.

Tampoco hay estado en el que apoyarla. `PENDING` exige un intento en vuelo hacia
un proveedor. `PARTIALLY_CONFIRMED` está prohibido: `DEC-016` §4.1 dice que no es
alcanzable, que *«su producción es un defecto»*, y aclara que *«la cobertura
parcial de la venta se expresa con varios `Payment`, no con este estado»* — es
confirmación parcial *de un componente*, no el saldo de una venta.

**Lectura A — el crédito cubre, y la deuda vive en su propio agregado.** Es la
que `DEC-002` ya ratificó, aunque nadie hubiera venido a leerla:

> §146 regla 7 (línea 154): *«El inventario y la venta **no deben cerrarse definitivamente
> sin cobertura suficiente, salvo crédito autorizado**.»*
>
> §159, «Excepción: crédito autorizado»: *«**El saldo puede cubrirse mediante
> crédito interno** cuando: el cliente está identificado; existe cupo; la
> política lo permite; **la obligación se registra separadamente**; la
> aprobación queda auditada.»*

`UC-PAY-004` §661 presupone exactamente eso y sería incoherente de otro modo:
habla de reducir *«la cuenta por cobrar mediante un movimiento de crédito
vinculado»*, de *«restaurar cupo»* conservando *«el saldo anterior y nuevo»*, de
*«abonos reales»* y de *«saldo pagado elegible»*. Sus listas de agregados nombran
`CreditAccount` y `CreditTransaction` **junto a** `Sale`, `CashShift` y
`CashMovement`, no dentro de ellos.

Y `UC-PAY-001` §312 clasifica `CUSTOMER_CREDIT` como *«Cuenta por cobrar, no
dinero confirmado»* — la única fila de esa tabla que describe en vez de declarar
un estado, precisamente porque el estado era lo diferido.

## Decisión

**Una venta autorizada a crédito usa `CUSTOMER_CREDIT` como mecanismo de
cobertura de la venta. La obligación se registra en un agregado de crédito
separado.**

El crédito:

- **satisface la cobertura** requerida para completar la venta;
- permite que `completeSaleIfCovered` produzca `COMPLETED`;
- permite que la mercancía salga **dentro de la misma transacción**;
- **no representa efectivo recibido**;
- **no genera movimiento de caja** (`DEC-002` §146 regla 10: *«La caja solo
  registra efectivo realmente recibido»*; `UC-PAY-004` §1156 regla 9: *«El
  crédito reduce cartera sin crear efectivo ficticio»*);
- **no deja una venta entregada en `PAYMENT_IN_PROGRESS`**;
- registra la obligación aparte, nunca como remanente no cubierto de la venta.

Esta decisión no inventa nada: escribe lo que `DEC-002` §159 dejó enunciado y
`UC-PAY-004` ya presupone.

## Invariantes que la implementación debe preservar

1. `payments_payment_allocations` sigue siendo la **fuente única** de cobertura
   (`DEC-016` §5.5). El crédito imputa ahí como cualquier otro componente; no
   abre una segunda vía de cobertura.
2. `completeSaleIfCovered` sigue siendo el **único** punto que produce
   `COMPLETED`.
3. La salida de inventario permanece **atómica** con la finalización.
4. `CUSTOMER_CREDIT` **no crea efectivo ficticio**: no invoca `CashPort`.
5. `CreditAccount` y `CreditTransaction` son agregados **separados** de
   `Payment` y de `Sale`. Nadie escribe directo en tablas de otro módulo.
6. Toda operación es **tenant-scoped**: cupo y saldo se leen bajo el `tenant_id`
   del contexto verificado, nunca bajo uno aportado por el llamador.
7. La autorización del crédito **queda auditada** (`DEC-002` §159).
8. **La deuda no se materializa** hasta que `CUST-002` / `PAY-009` estén
   implementados. Esta decisión no habilita `CUSTOMER_CREDIT` en el runtime: el
   método sigue siendo vocabulario reservado hasta entonces.
9. **No producir `PARTIALLY_CONFIRMED`** (`DEC-016` §4.1).
10. **No crear estados nuevos de `Sale`** para representar el fiado
    (`DEC-016` §4.3).

## Consecuencias

**Un cambio estructural, y es pequeño.** Hoy `sqlite-payment-store.ts` decide con
un solo booleano —`confirming = input.method === "CASH"`— tres cosas a la vez: la
guarda de sobrepago, la inserción de la imputación y el asiento en caja. El
crédito confirma e imputa pero **no** asienta en caja, así que esas tres
responsabilidades tienen que dejar de compartir condición. Es el trabajo
principal que `PAY-009` heredará.

**Hace falta una autoridad de confirmación que hoy no existe.** `authority_type`
admite `LOCAL_DEVICE`, `MANUAL_ATTESTATION` y `EXTERNAL_PROVIDER_AUTHORITATIVE`.
Ninguno significa «el comercio aceptó una obligación». `CUST-002` deberá añadir
la suya.

**El cliente ya puede nombrarse.** `sales_sales.customer_id` existe desde
`MIGRATION_019`, con validación de pertenencia al tenant dentro de la
transacción. La primera condición de `DEC-002` §159 —*«el cliente está
identificado»*— ya tiene dónde apoyarse.

**Los abonos son movimientos contra el `CreditAccount`**, nunca pagos adicionales
sobre una venta ya cerrada. Es lo que hace que `UC-PAY-004` §661 regla 4
—*«si el cliente ya realizó abonos reales»*— tenga un sujeto.

## Dependencias de producto, no de arquitectura

`CUST-002` / `PAY-009` no pueden implementarse sin tres decisiones que **no son
derivables del repositorio** y que esta decisión deliberadamente no inventa:

| Decisión | Por qué no se resuelve aquí |
|---|---|
| Política de cupo inicial | `DEC-002` §159 exige *«existe cupo»*, pero ninguna fuente dice si el cupo se fija por cliente al registrarlo o si hay un cupo por defecto del comercio |
| Autorización por rol/permiso | Ninguna fuente dice si el cajero puede fiar con un permiso propio o si hace falta un rol distinto |
| Comportamiento cuando el cupo resulta insuficiente | Ninguna fuente dice si es rechazo duro o autorización excepcional con motivo auditado |

Inventar un valor para cualquiera de las tres sería tomar una decisión de negocio
disfrazada de detalle técnico.

## Lo que esta decisión NO resuelve, y por qué

**Refund contra crédito.** La reducción de cartera y la restauración de cupo
tienen ruta prevista en `UC-PAY-004` §661. No se implementa ahora, y cuando se
implemente debe respetar su regla 6: *«No se mezcla reducción de cartera con
devolución de efectivo en un único movimiento»*.

**Anulación de una venta a crédito.** Sigue condicionada a `D-22`: `sales_sales`
admite `CANCELLED` y **ningún código lo produce**. Mientras eso siga así, una
venta a crédito no se puede anular, y esta decisión no lo cambia.

**Mora, intereses, cartera y cobranza.** Fuera de alcance. Materializar el saldo
es el primer paso; envejecerlo y cobrarlo son otros.

**El estado derivado de pago de la venta.** `UC-PAY-001` §318 enumera `UNPAID`,
`PARTIALLY_PAID`, `PAID` y demás. No existe ni en el esquema ni en el código, y
una venta cubierta por crédito pondría en tensión la palabra `PAID`: está
cubierta y el cliente debe. Cuando esa proyección se materialice tendrá que
distinguir «cubierta» de «cobrada»; hoy no hay nada que corregir porque no hay
nada escrito.
