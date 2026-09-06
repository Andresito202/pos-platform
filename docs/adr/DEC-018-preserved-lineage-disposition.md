# DEC-018 — Destino del linaje preservado de Catalog, Inventory y Payment

## Estado

`NORMATIVA RATIFICADA` — 2026-09-06. Cierra la deuda `D-8`.

No crea tablas, no crea migraciones, no elimina ramas ni historia. Decide qué se
hace con `wip/local-catalog-inventory-payment-20260906` y convierte esa decisión
en una comprobación de CI.

Depende de `DEC-017`, que declaró canónica la arquitectura de `main`. No lo
modifica: lo aplica.

## 1. Problema

El 2026-09-06, al publicar la etiqueta de archivado, apareció un volumen grande
de trabajo sin commitear en el disco del propietario: `Catalog`, `Inventory` y
un dominio de `Payment` completos, con repositorios, casos de uso y pruebas. Se
preservó en `wip/local-catalog-inventory-payment-20260906` (`a10249f`, 145
archivos, 14 654 inserciones) y quedó registrado como `D-8`.

La deuda decía: *dos implementaciones de las mismas capacidades divergiendo*. No
decía qué hacer. Este documento lo decide.

La recomendación previa —«el dominio puro es adaptable, su obstáculo es de forma
arquitectónica»— **era imprecisa**, y verificarlo cambió la decisión.

## 2. Hallazgos que fuerzan la decisión

### 2.1 `Payment` y `Cash` del linaje duplican capacidades que `main` ya tiene

`main` tiene Payment V1 y Cash V1 `CANONICALLY_APPLIED`: reglas, persistencia
(`MIGRATION_009`, `MIGRATION_011`), enrutamiento IPC y pruebas verdes de extremo
a extremo.

El linaje preservado trae `packages/domain/src/payment/` y
`packages/domain/src/cash/` — la **misma capacidad**, no una distinta. Su
`PaymentMethod` es más ancho —nueve métodos frente a los dos de `main`, con QR
estático y dinámico, tarjeta, monedero, crédito de cliente y crédito de regalo—,
pero más ancho sobre el papel no es más avanzado: lo de `main` funciona por el
transporte real y está probado.

Integrarlos crearía dos implementaciones de la misma capacidad. Es exactamente
el modo de fallo que `materialization-state.md` existe para impedir.

### 2.2 El dominio del linaje depende de primitivas que `main` no tiene, y una es dinero

Verificado leyendo los `import` de los 30 archivos de dominio del linaje: sus
agregados dependen de `../money.js`, `../quantity.js`, `../tenant-scope.js`,
`../company-scope.js` y `../actor.js`, en la raíz de `packages/domain/src/`.
**Ninguno existe en `main`.**

`main` implementa la aritmética monetaria como funciones en
`apps/pos-local-service/src/payments/money.ts` —`scale6ToBigInt`,
`bigIntToScale6`—. El linaje la implementa como clase `Money` en el dominio.
**Ambas respetan la misma invariante** —escala 6, cadena canónica, `BigInt`,
nunca coma flotante—, y precisamente por eso el problema no es de corrección
sino de duplicidad: `DEC-017` §3 ya registró que convivir con un segundo modelo
de dinero «introduciría dos verdades sobre el mismo importe».

Hay además una colisión de nombre: `main` ya define `Actor` en
`packages/domain/src/authorization/actor.ts`.

### 2.3 `DEC-017` §4.2 prohíbe expresamente el destino que haría falta

> «`packages/domain` y `packages/application` conservan únicamente lo que hoy
> contienen (autorización y sesión) y **no se amplían preventivamente**.»

Portar `Catalog` o `Inventory` con su capa de primitivas exige ampliar esos dos
paquetes. No es una cuestión de forma ni de gusto: es normativa ratificada.

## 3. Decisión

### 3.1 No se porta código

`wip/local-catalog-inventory-payment-20260906` se reclasifica de **trabajo
pendiente de rescate** a **referencia de diseño**, el mismo estatus que
`archive/cash-hexagonal-20260902`.

Consultarlo está permitido y **recomendado**. Integrarlo por merge,
`cherry-pick` o copia queda prohibido.

### 3.2 Qué se conserva como especificación, y es mucho

La rama no se tira: es el diseño más detallado que existe de capacidades que
`main` todavía no materializa.

| Área | Valor como especificación |
|---|---|
| `Catalog` | producto, identificadores, presentaciones, variantes, atributos, conversión de unidades y factor de conversión, con seis eventos de dominio |
| `Inventory` | movimiento, reserva, traslado con su ciclo completo, lote, saldo y existencias, con nueve casos de uso |
| `Payment` | los siete métodos que `main` **no** soporta todavía, y `PaymentAuthorityType` local/central/proveedor externo |
| Migraciones PostgreSQL `005`/`006` | DDL de referencia para catálogo e inventario centrales |

### 3.3 Dónde se implementarán realmente

En `apps/pos-local-service/src/catalog/` y `apps/pos-local-service/src/inventory/`,
siguiendo el patrón canónico de `DEC-017` §4.2, con la representación monetaria
de `main` y migraciones nuevas desde `MIGRATION_012`. Cada uno es su propio
bloque y ninguno está autorizado por este documento.

### 3.4 Requisito previo, no opcional

Antes de escribir la primera línea de `Catalog` o `Inventory` **hay que leer esa
rama**. Reimplementar desde cero sin consultarla es la tercera repetición del
mismo fallo que ya costó trabajo dos veces.

## 4. La decisión es ejecutable, no una nota

`DEC-017` §4.2 dependía de que alguien la recordara. Ahora la comprueba CI.

`module-boundaries.json` declara `frozenSourceAreas`, y
`validate-boundaries.mjs` falla si aparece un área nueva bajo el `src/` de un
proyecto congelado:

```
@pos-platform/domain src/catalog is not in its frozen area set (DEC-017 4.2);
implement it under apps/pos-local-service/src/ instead
```

Verificado creando `packages/domain/src/catalog/product.ts`, observando el
fallo, y borrándolo para volver a `PASS`. Cubierto por tres pruebas en
`validate-boundaries.test.mjs`.

## 5. Qué no decide este documento

- No autoriza implementar `Catalog` ni `Inventory`.
- No amplía `PaymentMethod` en `main`.
- No decide el destino de las migraciones PostgreSQL `005`/`006` del linaje:
  esos números siguen libres en `main`, y usarlos exige su propio bloque.
- No reescribe historia ni borra la rama, que permanece íntegra en el remoto.
