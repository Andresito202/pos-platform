# Tablero de materialización — estructura permanente

> Continuidad 2026-10-22 en la rama activa: [D-23](../testing/sold-identifier-2026-10-22.md) y [escritor inicial D-19](../testing/catalog-fiscal-write-2026-10-22.md) materializados/probados. El test focalizado del canal alcanza SQLite con esos datos, pero no acredita login humano, emisión fiscal productiva ni E2E Android. Se preservan los recuentos y filas históricas inferiores con su alcance original.

> Alcance de lectura — 2026-10-17. Las filas y recuentos inferiores evalúan el SHA histórico indicado en «El tablero»; no constituyen una evaluación del main o de la rama activa actuales. No se promueve ningún peldaño con esta reconciliación documental. Consultar [reconciliación operativa](../product/backlog.md) para la cola actual. Esta nota no elimina evidencia histórica ni certifica tests nuevos.

## Para qué existe este documento

El propietario mantiene un **tablero físico**. Un tablero físico no se puede
reescribir cada semana: si cambian las filas, deja de servir para comparar.

Por eso aquí se congela **la estructura** —bloques, capacidades y ubicación— y
se deja **una sola columna móvil: el peldaño**. De sesión a sesión sólo se
mueven peldaños; las filas se quedan donde están.

Añadir una capacidad nueva es un cambio de estructura y se registra como tal,
con la fecha.

---

## Cambio de gobernanza — 2026-09-12

**Se retira el peldaño `CANONICALLY_APPLIED` y se retira el porcentaje global.**
No es un ajuste de presentación: es la corrección de un defecto de gobernanza
que dejó en pie una afirmación falsa durante seis días.

### Qué falló

El peldaño valía 85 y exigía tres cosas a la vez:

> en `main`, con CI verde, y **alcanzable de extremo a extremo**

Las tres se acreditaban con una sola marca. Las dos primeras son verificables de
un vistazo; la tercera no se verificó nunca. El resultado fue **35 de 56 filas
declarando alcance de extremo a extremo sin que nada lo acreditara**.

### Por qué no se detectó

Porque las pruebas que lo habrían detectado **se llaman como si lo hicieran y no
lo hacen**. En `origin/main`, `apps/pos-local-service/tests/commercial-ipc.test.ts`
contiene un bloque titulado `flujo comercial extremo a extremo`. Su código llama
a `handler.handle(request, connection)`: no construye `LocalChannelServer`, no
construye `LocalChannelClient`, **no cruza el transporte**.

Eso tiene una consecuencia medida, no supuesta: `validateResponse` del servidor
tenía 14 `case` de 23 y ningún `default`, de modo que `catalog.*`, `customer.*` e
`inventory.*` —**nueve operaciones**— devolvían `undefined` y el socket moría en
silencio. Ninguna prueba lo vio, porque ninguna prueba pasaba por el socket.

**Un nombre no es evidencia.** La marca única permitía que el nombre hiciera de
evidencia.

### Qué lo sustituye

Una escalera de **siete peldaños**, cada uno con su propia evidencia. No se puede
estar en un peldaño sin cumplir todos los anteriores.

| Peldaño | Qué exige | Qué **no** basta |
|---|---|---|
| `DOCUMENTED` | documentación específica de la capacidad | una mención de pasada |
| `IMPLEMENTED` | código en el árbol evaluado, y esta tabla dice en qué ruta | que compile |
| `TESTED` | una prueba **ejecuta** el comportamiento y se observó el resultado | que la prueba exista |
| `RUNTIME_VERIFIED` | el arranque de producción **instancia** el componente | que la clase exista |
| `CALLER_REACHABLE` | un llamador **fuera del proceso** la alcanza **cruzando el transporte real**, la atiende el **handler de producción** y el efecto se observa **donde queda escrito** | que la operación figure en el contrato · que el handler la atienda · **que la respuesta la fabrique la propia prueba** |
| `END_TO_END` | además existe **superficie de producto** que la invoca, y la cadena llega al almacenamiento | que exista una prueba que la invoque |
| `PRODUCTION` | validado en el entorno de producción objetivo | — |

**`main` y CI dejan de ser peldaño.** Son dos columnas ortogonales: una
capacidad puede estar en `main` con CI verde y seguir en `IMPLEMENTED`. Era
precisamente la confusión que produjo el error.

### Tres reglas de corte

1. **Alcanzable ≠ materializado.** Una capacidad probada que el runtime no
   instancia se queda en `TESTED`.
2. **Un adapter no vale más que su puerto peor verificado.** Cada puerto puntúa
   por separado.
3. **Infraestructura tope en `RUNTIME_VERIFIED`.** Los peldaños
   `CALLER_REACHABLE` y `END_TO_END` sólo aplican a capacidades que el POS
   expone a un llamador. A una migración o a un job de CI **no se le descuenta**
   por no tener llamador: simplemente no le aplican.

### Por qué ya no hay porcentaje global

Un porcentaje global exige asignar un número a cada peldaño y promediar. Ese
promedio fue lo que permitió que 35 filas infladas se disolvieran en un «63 %»
de aspecto razonable, y lo que hizo que la corrección de un defecto vivo pareciera
un retroceso. **Se sustituye por el recuento de filas por peldaño**, que no se
puede promediar y por tanto no se puede inflar.

No se publica un porcentaje nuevo. Inventar uno sería repetir el error con otra
cifra.

### Dónde encaja la escalera de verificación fiscal

`NOT_EVALUATED` → `MOCK_TESTED` → `SANDBOX_VERIFIED` → `PRODUCTION_VERIFIED` →
`CERTIFIED` es una escalera **distinta**, sobre la evidencia de proveedor, y se
anota en su propia columna. `MOCK_TESTED` no puede sostener más que `TESTED`;
`SANDBOX_VERIFIED` acredita que el proveedor real respondió, no que el POS lo
llame.

---

## Segunda corrección de gobernanza — 2026-09-12

**Las siete filas que este mismo documento subió a `CALLER_REACHABLE` no lo
tenían ganado. Bajan a `RUNTIME_VERIFIED`.**

Es el mismo defecto que la sección anterior denuncia, cometido de nuevo en el
acto de corregirlo. Conviene que quede escrito así de claro.

### Qué falló

La escalera decía que `CALLER_REACHABLE` exige *cruzar el transporte real*. Se
nombró una prueba que efectivamente lo cruza —`channel-commercial-transport.test.ts`—
y se dio por acreditada la fila. Pero **lo que hay al otro lado de ese socket es
un doble**:

```
const server = new LocalChannelServer(
  endpoint,
  new LocalChannelAuthenticator(secret, clock),
  (request) => { ...                       // ← cierre de la prueba
    return Promise.resolve(responseFor(request, "CREATED", { ... }));
  },
```

No hay `CommercialRequestHandler`, no hay `CommercialComponent`, no hay SQLite.
`responseFor` **es de la prueba**: las respuestas `OPENED`, `FOUND`, `CREATED` y
`CONFIRMED` que se citaron como evidencia las escribe el fichero de prueba en
constantes literales.

Verificado, no supuesto: de los ficheros de prueba de `origin/main` que
construyen `LocalChannelServer` —`channel-commercial-transport.test.ts` y
`channel.test.ts`— **ninguno menciona `CommercialRequestHandler` ni
`CommercialComponent`**. En `main` no existe una sola prueba que cruce el socket
y llegue al handler real.

### Qué acredita realmente esa prueba

Mucho, y no es lo que se le atribuyó. Acredita el **transporte**: framing, MAC,
anti-replay, y que los 23 tipos de mensaje se serializan y se validan de ida y
vuelta. Ése fue el defecto X-2 y está genuinamente cerrado.

Lo que no acredita es que la **capacidad comercial** exista al otro lado. Un
llamador que recibe la respuesta que la prueba le fabricó no ha alcanzado nada.

### La regla que faltaba

> **Un socket no es evidencia si detrás hay un doble.**

La versión anterior de este documento estableció que *un nombre no es evidencia*.
Faltaba el segundo filo: tampoco lo es un transporte real atendido por un
sustituto. La escalera y la regla 5 de actualización quedan corregidas arriba.

### Consecuencia en el recuento

`CALLER_REACHABLE` pasa de **7 a 0**. Las siete filas —A9, B1, B4, B5, B6, B7 y
B10— bajan a `RUNTIME_VERIFIED`, que es donde su evidencia real las sostiene:
`CommercialComponent` sí está instanciado por el arranque de producción
(`main.ts:88`, sin condicional de plataforma) y `commercial-ipc.test.ts` sí
ejecuta el handler real contra SQLite. Lo que nunca ocurrió es la unión de las
dos mitades.

**Ninguna fila baja porque algo se haya roto.** Bajan porque la evidencia que se
les exige es la que siempre debieron tener.

---

## El tablero

**57 capacidades en 5 bloques.** Estructura congelada el 2026-09-06; una fila
añadida el 2026-09-14 (`B13`, recibo de venta), registrada abajo.

**Árbol evaluado: `origin/main` = `da1fe74`**, el 2026-09-14. No se evalúa
ninguna rama: una capacidad en una rama abierta no está en `main`.

`da1fe74` es el merge de la PR #76 —segundo padre `d0ebe55`— sobre `2aa8acc`.
Trae tres cosas que el cajero puede hacer desde la pantalla y antes no podía:
cerrar el turno, cobrar por transferencia y pedir el recibo de una venta
cobrada. CI verde sobre `d0ebe55`, con el job de Windows en `windows-2022` en
`success`.

`2aa8acc` es el merge de la PR #75 —segundo padre `83542bc`— sobre `da23b29`.
Trae lo que faltaba para que `CALLER_REACHABLE` dejara de estar vacío: una
prueba que cruza el transporte real **y** llega al handler de producción y a
SQLite, y otra que además la invoca desde la interfaz de Electron.

`da23b29` es el merge de la PR #74 sobre `2e74410`. Tocó cuatro ficheros —el
workflow de CI y tres documentos— y **ni una línea de producción**, de modo que
la única fila que mueve es E7: el escritorio se construye y se arranca bajo
`xvfb` en cada ejecución del workflow.

`2e74410` es el merge de la PR #73 —segundo padre `b6f0036`— sobre el `02b89bb`
anterior. Antes de ese merge, `main` arrastraba **X-1** (la venta creada por el
camino canónico no se podía cobrar en efectivo) y **X-2** (nueve de veintitrés
operaciones mataban el socket). **Ambos están corregidos en el árbol evaluado**,
y por eso varias filas suben. Al final hay una sección con lo que movió.

### Bloque A — Plataforma local · 14 capacidades

| # | Capacidad | Peldaño | Evidencia |
|---|---|---|---|
| A1 | SQLite `MIGRATION_001..015` | `RUNTIME_VERIFIED` | `LocalDatabaseComponent` en `main.ts:81`; 13 pruebas de migración |
| A2 | Idempotencia (`runtime_operations`) | `RUNTIME_VERIFIED` | `OperationConfirmationComponent` en `main.ts:83` |
| A3 | Identidad de dispositivo y licencia (tablas) | `TESTED` | tablas y pruebas; nada las instancia |
| A4 | Auditoría append-only | `RUNTIME_VERIFIED` | `local_operation_audit` lo escribe la transacción comercial |
| A5 | Outbox / inbox / checkpoint / dead-letter | `RUNTIME_VERIFIED` | `DurableSyncComponent` en `main.ts:82`; **nada lo drena** (`D-2`) |
| A6 | SSA y binding de sesión | `RUNTIME_VERIFIED` | `CommercialComponent`; probado por handler, no por transporte |
| A7 | Proyección de autorización | `RUNTIME_VERIFIED` | idem |
| A8 | Master snapshot | `RUNTIME_VERIFIED` | `SqliteMasterSnapshotStore` en `commercial-component.ts:125`, consumido por `OpenCashShiftUseCase`; 37 pruebas |
| A9 | Canal IPC comercial (23 tipos) | `CALLER_REACHABLE` | `channel-commercial-vertical.test.ts`: socket real → handler real → SQLite; 10 de 23 tipos siguen sin cruzar |
| A10 | Enrutamiento del canal → superficie comercial | `RUNTIME_VERIFIED` | `CommercialComponent` en `main.ts:88`; `LocalChannelComponent` sólo en `win32` |
| A11 | Shell Electron (main, preload, allowlist) | `RUNTIME_VERIFIED` | 6 E2E con Electron real; desde #75 uno de ellos habla con el **servicio real** por `src/start.ts`, no con un doble |
| A12 | Logger estructurado | `RUNTIME_VERIFIED` | `observability`, 4 pruebas |
| A13 | Ciclo de seguridad local (DPAPI, identidad, licencia) | `TESTED` | `main.ts` no lo instancia |
| A14 | Adquisición de snapshot de autorización (SAS-003) | `TESTED` | `main.ts` no lo instancia |

**A9 corrige X-2 y ahí se queda.** Hasta `02b89bb`, `catalog.*`, `customer.*` e
`inventory.*` no obtenían respuesta válida: `validateResponse` tenía 14 `case` de
23 y ningún `default`, devolvía `undefined`, y el socket se destruía sin un solo
mensaje. La tabla compartida `Record<IpcMessageType, z.ZodType>` lo cerró, y
trece tipos cruzan hoy un `LocalChannelServer` y un `LocalChannelClient` reales.

**Sube a `CALLER_REACHABLE` con #75, y no por esa prueba.** El servidor de
`channel-commercial-transport.test.ts` lo atiende un cierre de la propia prueba:
acredita que el canal transporta y valida veintitrés tipos de mensaje —que era el
defecto— y nada sobre lo que ocurre después. Lo que la hace subir es
`channel-commercial-vertical.test.ts`, donde detrás del socket está el
`CommercialRequestHandler` de producción y el efecto se lee en SQLite.

Las diez restantes —`session.*`, `operation.*`, `cash.shift.close` y los tres
pagos que no son efectivo— **nunca han cruzado el socket**; comparten el mismo
`responseSchemaFor`, exhaustivo en compilación, pero eso es un argumento, no una
ejecución.

**A11 sube a `RUNTIME_VERIFIED`.** `src/main.ts` era un proceso principal
completo que **nunca se había ejecutado**. Al ejecutarlo aparecieron dos defectos
que `tsc` y las 88 pruebas de `vitest` sobre jsdom no pueden ver: el bundle del
renderer con rutas absolutas, irresolubles bajo `file://`, y el preload emitido
como ESM cuando `sandbox: true` no admite ESM, de modo que `contextBridge` nunca
corría. Corregidos, cinco E2E lo arrancan de verdad.

**No pasa de ahí.** `smoke-entry.mjs` inyecta un `ServiceChannel` de doble: no
hay named pipe ni servicio local detrás. El escritorio arranca; todavía no habla
con el POS.

**A13 y A14 siguen en `TESTED` por la regla 1.** `main.ts` cablea cinco
componentes —`LocalDatabaseComponent`, `DurableSyncComponent`,
`OperationConfirmationComponent`, `CommercialComponent`, `LocalChannelComponent`—
y ninguno es éstas.

**A9 es la única fila del bloque A que alcanza `CALLER_REACHABLE`**, y no pasa
de ahí: diez de veintitrés tipos —`session.*`, `operation.*`, `cash.shift.close`
y los tres pagos que no son efectivo— siguen sin cruzar el socket. El resto del
bloque A es infraestructura local, a la que estos dos peldaños no le aplican
(regla 3).

### Bloque B — Núcleo comercial · 13 capacidades

| # | Capacidad | Peldaño | Evidencia |
|---|---|---|---|
| B1 | Sales V1 (venta → `READY_FOR_PAYMENT`) | `END_TO_END` | `channel-commercial-vertical.test.ts`: socket real → handler real → SQLite · la interfaz de Electron lo invoca (`real-channel.spec.ts`) |
| B2 | Cash V1 (apertura y cierre de turno) | `END_TO_END` | apertura y cierre se mueven desde la pantalla en `real-channel.spec.ts`; el cierre viaja con el `version` que devolvió la apertura, nunca un literal |
| B3 | Payments V1 (`CASH`, `TRANSFER`, cobertura) | `END_TO_END` | `CASH` y `TRANSFER` se cobran desde la pantalla; la transferencia lee su `version` de `payment.get` entre reportar y atestiguar |
| B4 | Completado de venta como único punto | `END_TO_END` | `channel-commercial-vertical.test.ts`: socket real → handler real → SQLite · la interfaz de Electron lo invoca (`real-channel.spec.ts`) |
| B5 | Frontera Payments ↔ Cash | `END_TO_END` | `channel-commercial-vertical.test.ts`: socket real → handler real → SQLite · la interfaz de Electron lo invoca (`real-channel.spec.ts`) |
| B6 | Catalog | `CALLER_REACHABLE` | `channel-commercial-vertical.test.ts`: socket real → handler real → SQLite; **`register` no tiene pantalla**: sin alta de catálogo no hay `END_TO_END` |
| B7 | Inventory | `CALLER_REACHABLE` | `channel-commercial-vertical.test.ts`: socket real → handler real → SQLite; `receive` y `adjust` **no tienen pantalla** |
| B8 | Pricing | `DOCUMENTED` | tabla sin motor |
| B9 | Tax (motor de impuestos) | `RUNTIME_VERIFIED` | se calcula dentro de `sale.create`; **su salida no se asevera al otro lado** |
| B10 | Customer / adquiriente | `CALLER_REACHABLE` | `channel-commercial-vertical.test.ts`: socket real → handler real → SQLite; **ninguna de las tres tiene pantalla** |
| B11 | SaleReturn, notas crédito y débito | `DOCUMENTED` | — |
| B12 | Periféricos POS | `DOCUMENTED` | cero código |
| B13 | Recibo de venta (proyección, `DEC-019`) | `END_TO_END` | `sales.receipt.get` se deriva de la venta cobrada; la pantalla lo pide y distingue `NOT_FOUND` de `NOT_COMPLETED`. Sin tabla, sin migración y sin campo fiscal |

**B5 fue la corrección más cara del tablero, y conviene no olvidar por qué.**
Hasta `02b89bb`, `CreateSaleUseCase` escribía `cash_register_id` y `cash_shift_id`
**siempre `NULL`** —`sqlite-sale-store.ts`, `VALUES (?,?,?,?,NULL,NULL,`— y
`SqlitePaymentStore` rechaza con `CASH_SHIFT_MISSING` cuando el turno es nulo.

> **Una venta creada por el camino canónico no se podía cobrar en efectivo.**
> Con turno abierto o sin él.

Medido, no deducido: restituir ese `NULL,NULL` sobre el árbol corregido hace
fallar **5 pruebas**, entre ellas «la venta así creada se cobra en efectivo y
queda COMPLETED». Ninguna prueba lo vio porque **ninguna encadenaba las dos
mitades**: `payment.test.ts` sembraba la venta escribiendo el turno a mano, y
`sale.test.ts` nunca cobraba.

Hoy la vertical completa —abrir turno, buscar en catálogo, crear la venta,
cobrarla— se ejecuta contra el **handler real y SQLite real** en
`commercial-ipc.test.ts`, y ésa es la evidencia que sostiene a B1, B4 y B5 en
`RUNTIME_VERIFIED`.

**La unión de las dos mitades ya existe**, y es lo que #75 trajo:

| Prueba | Transporte | Handler | Almacenamiento | Interfaz |
|---|---|---|---|---|
| `channel-commercial-transport.test.ts` | **real** | doble | ninguno | — |
| `commercial-ipc.test.ts` | ninguno | **real** | **real** | — |
| `channel-commercial-vertical.test.ts` | **real** | **real** | **real** | — |
| `real-channel.spec.ts` | **real** | **real** | **real** | **real** |

La tercera fila es la que acredita `CALLER_REACHABLE`; la cuarta, `END_TO_END`.

**B1, B4 y B5 llegan a `END_TO_END` y las demás no, por una razón concreta.**
`real-channel.spec.ts` mueve desde la pantalla el turno, la búsqueda por código
de barras, la creación de la venta y el cobro. El alta de catálogo y la entrada
de existencia las hace por el canal, sí, pero **no por pantalla de cajero**:
`page.evaluate` no es superficie de producto.

**Por eso B6, B7 y B10 se quedan en `CALLER_REACHABLE`.** De B6 falta la pantalla
de alta de producto; de B7, las de entrada y ajuste de existencia; de B10 no hay
ninguna. La regla es la misma de siempre: media capacidad alcanzable no es la
capacidad.

**B2 y B3 sí se mueven ahora, y conviene decir qué las movía.** Lo que les
faltaba no era motor sino llamador: `cash.shift.close` y
`payment.register.transfer` existían enteros —contrato, dominio, caso de uso,
almacén, handler, enrutamiento, allowlist y preload— y nadie los invocaba. #76
añadió el llamador y la pantalla, y ninguna de las dos tocó arquitectura.

Dos detalles que el peldaño no muestra y que son la parte cara:

- El cierre exige `expected_version`, y la apertura no devolvía la versión. Se
  añadió `version` al resultado de `cash.shift.open` para que la pantalla
  propague la versión **real**; escribir `expected_version: 1` habría pasado las
  pruebas y roto el bloqueo optimista en el primer turno reabierto.
- La transferencia es un flujo de **tres** pasos, no de dos:
  `payment.register.transfer` devuelve sólo `outcome` y `payment_id`, así que
  `payment.get` es la única fuente de la versión que `payment.transfer.confirm`
  exige. Se consulta siempre, también tras un `IDEMPOTENT`, donde el pago ya
  existía y su versión puede ser cualquiera.

**B13 es fila nueva** (`DEC-019`): el recibo es una **proyección** de la venta
cobrada, no un artefacto almacenado. No hay `MIGRATION_016`, no hay CUFE, no hay
QR fiscal y no hay cabecera DIAN. Y destapó `D-23`: `identifier_snapshot` se
escribe siempre `NULL`, de modo que el recibo no puede mostrar el código del
producto y hoy afirma `null` por honestidad.

**B8 y B12 se mantienen en `DOCUMENTED`.** `sandbox_price_rule` es una tabla sin
regla que la calcule; periféricos no tiene una sola línea.

### Bloque C — Plano fiscal · 19 capacidades

| # | Capacidad | Peldaño | Proveedor | Evidencia |
|---|---|---|---|---|
| C1 | Cinco puertos por capacidad | `TESTED` | — | 170 pruebas; **ningún consumidor** |
| C2 | Declaración tipada de credencial (`D-3`) | `TESTED` | — | idem |
| C3 | Matriz de capacidades y verificación cruzada | `TESTED` | — | idem |
| C4 | Escalera de verificación (`D-4`) | `TESTED` | — | idem |
| C5 | Saldo de bolsa como proyección (`D-5`) | `TESTED` | — | idem |
| C6 | Tablas de códigos DIAN (parciales) | `TESTED` | — | fuente verificada |
| C7 | FACTUS · validación de configuración | `TESTED` | `SANDBOX_VERIFIED` | ejecución del 2026-09-06 |
| C8 | FACTUS · rango de numeración | `TESTED` | `SANDBOX_VERIFIED` | ejecución del 2026-09-06 |
| C9 | FACTUS · emisión de documento | `TESTED` | `MOCK_TESTED` | fake determinista |
| C10 | FACTUS · consulta de estado | `TESTED` | `MOCK_TESTED` | fake determinista |
| C11 | FACTUS · artefacto (XML / PDF) | `TESTED` | `MOCK_TESTED` | fake determinista |
| C12 | Adapter SIIGO | `DOCUMENTED` | `NOT_EVALUATED` | — |
| C13 | Adapter ALEGRA | `DOCUMENTED` | `NOT_EVALUATED` | — |
| C14 | Esquema fiscal central (10 tablas `fiscal.*`) | `IMPLEMENTED` | — | sin prueba y sin consumidor |
| C15 | Contingencia y reconciliación fiscal | `DOCUMENTED` | `NOT_EVALUATED` | — |
| C16 | Documento electrónico local y rango persistido (`DEC-021` F1) | `TESTED` | — | `MIGRATION_016`; 21 pruebas que **ejecutan** cada invariante, incluidas las negativas |
| C17 | Depósito y resolución de credencial fiscal (`DEC-021` F2) | `TESTED` | — | `FiscalCredentialStore` sobre `SEC-004` + `SecretStoreFactusCredentialResolver` + entrada de operador por `stdin`; 17 pruebas, una de ellas lee el fichero crudo y comprueba que **el valor no está en claro** |
| C18 | Ensamblado del payload canónico FACTUS (`DEC-021` F3) | `TESTED` | — | `assembleFactusBill` contra `provider-payload-shapes.md` §FACTUS; 15 pruebas, la primera compara el cuerpo **campo a campo** contra un payload de referencia |
| C19 | Caso de uso de emisión electrónica (`DEC-021` F4/F5) | `CALLER_REACHABLE` | `MOCK_TESTED` | `fiscal.document.issue` cruza el socket real hasta `CommercialRequestHandler` de producción y `IssueElectronicDocumentUseCase`, con el efecto verificado en `fiscal_electronic_document` (no sólo en la respuesta): 2 pruebas en `channel-commercial-vertical.test.ts`. La pantalla existe (`FiscalPanel`) y la invoca de verdad: E2E de Electron contra el servicio real. **No sube a `END_TO_END` y el motivo no es la pantalla: es `D-19`** — ningún producto puede recibir atributos fiscales, así que la cadena nunca llega a escribir el documento. 32 pruebas de unidad + 5 de renderer + 1 E2E |

**C1..C8 siguen en `TESTED`, y la razón ya no es la misma.** Hasta ahora bajaban
porque nada del servicio llamaba a `DocumentIssuancePort`. Con `C19` en
`CALLER_REACHABLE` eso ya no es cierto: `fiscal.document.issue` atraviesa el
canal, invoca el puerto de emisión y **se dispara desde una pantalla real** —con
un `DocumentIssuancePort` falso, porque hablar con FACTUS de verdad es `F6`,
exclusivo del equipo del propietario.

**Lo que impide `END_TO_END` ya no es la pantalla: es `D-19`, y ahora está
demostrado, no supuesto.** `catalog_fiscal_attribute` tiene **un lector en
producción y cero escritores**: ninguna pantalla, ningún caso de uso y ninguna
operación del canal puede darle a una presentación su `unit_measure_code`,
`standard_code`, `tax_code` y `tax_rate`. Sin ellos ninguna línea se puede
declarar ante la DIAN, de modo que **ningún producto dado de alta por el
producto real se puede facturar hoy**. El E2E lo ejercita y lo afirma: la
emisión se dispara desde la pantalla y bloquea con `LINE_FISCAL_ATTRIBUTE_MISSING`,
tanto con adquiriente identificado como sin él. Sembrar ese atributo en el arnés
habría puesto la prueba en verde afirmando una capacidad que el producto no
tiene, que es exactamente el error que este tablero lleva corrigiendo desde que
se retiró `CANONICALLY_APPLIED`.

Un adapter con 170 pruebas verdes y sandbox real detrás sigue sin estar
instanciado por ningún runtime **con credencial real**. `SANDBOX_VERIFIED`
acredita que el proveedor respondió a la prueba de F6; no acredita que la
pantalla del POS lo llame.

**C9, C10 y C11 no están más abajo por falta de ganas.** Emitir exige `Customer`,
tablas DIAN, `Catalog` y `Tax` (`D-9`). Las cuatro existen. `C19` demuestra que el
motor las junta, produce un payload transmisible, es alcanzable desde fuera del
proceso y se dispara desde la pantalla. **El bloqueo restante es nuestro, no de
FACTUS**, y hoy son dos piezas concretas y nombradas: `D-19` —nadie puede dar
atributos fiscales a un producto— y `D-13` —el adquiriente genérico de la DIAN
sin verificar—. Ninguna de las dos es trabajo de motor: la primera es una
pantalla y un caso de uso que nadie ha escrito; la segunda, una fuente
documental que nadie ha aportado.

### Bloque D — Plataforma central y transporte · 6 capacidades

| # | Capacidad | Peldaño | Evidencia |
|---|---|---|---|
| D1 | PostgreSQL migrations 001 / 002 / 003 | `TESTED` | job de CI con PostgreSQL 16.14; `NOT_EVALUATED` en contenedor sin instancia |
| D2 | Aplicación central que use el esquema | — | `packages/database-postgres` **no tiene `src`**: sólo `package.json` y `project.json` (`D-4`) |
| D3 | API central | `DOCUMENTED` | — |
| D4 | Transporte saliente local → central | `TESTED` | `SyncDispatcher` cierra `claimBatch → POST → recordResponse`; 14 pruebas en `sync-dispatcher.test.ts` y 4 en `central-sync-component.test.ts`. **No sube de `TESTED`**: el arranque de producción sólo lo instancia si existe `POS_CENTRAL_BASE_URL`, y no hay autoridad a la que apuntarlo (`D3` sigue `DOCUMENTED`) |
| D5 | Ingesta central y reconciliación | `DOCUMENTED` | **bloqueada por el corte criptográfico**: `sync.sync_operations` fija `source_kind='CENTRAL_SERVICE'` y `device_id IS NULL`, y `first-target-migration-manifest.md:471` prohíbe «escribir `device_id` no nulo ni aceptar `LOCAL_DEVICE` antes de ese corte» (riesgo 7 de §18) |
| D6 | Identidad y licencia central | `DOCUMENTED` | — |

**D4 deja de ser un hueco y pasa a ser una pieza sin contraparte.** El cliente
existe, está probado y falla cerrado; lo que no existe es el servidor. La regla 1
de esta escalera —«una capacidad probada que el runtime no instancia se queda en
`TESTED`»— es exactamente el caso: `main.ts` sólo construye
`CentralSyncComponent` cuando hay `POS_CENTRAL_BASE_URL`, y ninguna instalación
real puede tenerlo mientras `D3` siga `DOCUMENTED`.

**Ningún dato sale todavía del dispositivo**, y por dos motivos, no uno: no hay
destino (`D3`) y no hay credencial de dispositivo (`DEC-008` sin materializar),
de modo que el componente se niega a temporizar y lo registra una vez. El outbox
acumula durablemente, que es lo que `DEC-007` pide de un equipo sin conexión.

Lo que sí queda acreditado es la **simetría de contrato**: el doble de transporte
de las pruebas valida cada petición con `createCentralDeviceHttpRequestSchema` y
`validateCentralDevicePrincipal` —los mismos que usará la autoridad— de modo que
una desviación del cliente se detecta en CI sin red. Se comprobó por mutación:
añadir una sola cabecera fuera del contrato hace caer 8 de 14 pruebas.

### Bloque E — Entrega y operación · 9 capacidades

| # | Capacidad | Peldaño | Evidencia |
|---|---|---|---|
| E1 | Validación TARGET (5 jobs) | `RUNTIME_VERIFIED` | ejecuta en cada PR |
| E2 | CodeQL SAST | `RUNTIME_VERIFIED` | `success` en el run de #73 |
| E3 | SBOM · licencias · vulnerabilidades · provenance | `RUNTIME_VERIFIED` | `success` en el run de #73 sobre `b6f0036`, provenance incluida |
| E4 | Gobernanza de merge de `main` | `RUNTIME_VERIFIED` | job «Main push governance» `success` en `da23b29`; `skipped` en PR por diseño |
| E5 | Boundaries ARCH-003 + `frozenSourceAreas` | `RUNTIME_VERIFIED` | `pnpm architecture:check` PASS |
| E6 | Strix (pentest con IA) | `IMPLEMENTED` | **nunca ha ejecutado un pentest** |
| E7 | E2E Playwright | `RUNTIME_VERIFIED` | `boot.spec.ts`, 5 specs con Electron real · **ejecutados en CI**, run #469 sobre `da23b29` `success` |
| E8 | Instalador NSIS y firma de código | `DOCUMENTED` | `electron-builder` no aparece en el lockfile |
| E9 | Despliegue y operación en producción | `DOCUMENTED` | — |

**E7 sube a `RUNTIME_VERIFIED` y conviene precisar por qué.** Hasta #74 las
pruebas E2E existían y **CI no las corría**: `pnpm test:runtime` incluye
`pos-desktop test` —las 88 de `vitest` sobre jsdom—, pero ni construía el
escritorio ni lo arrancaba. Una prueba que sólo corre en el portátil de quien la
escribió no protege la rama. Hoy el workflow tiene dos pasos —«Build the POS
desktop shell» y «Validate that the POS desktop really boots»— sin
`continue-on-error`, y el run #469 sobre `da23b29` terminó en `success`: si
Electron dejara de arrancar, `main` se pondría en rojo.

**E4 sube a `RUNTIME_VERIFIED`, y la nota anterior estaba envejecida.** Decía
`NOT_EVALUATED` porque en una PR el job aparece `skipped` —sólo corre en push a
`main`—, y de ahí se concluyó que nunca se había observado. Sí se observó: el
push de `da23b29` lo ejecutó, y el paso «Verify main push comes from a merged
PR» terminó en `success`. La gobernanza de merge no es una intención: está
comprobada sobre el commit que hoy es `main`.

**E6 sigue sin subir.** Sin `STRIX_LLM` ni `LLM_API_KEY` emite
`::warning title=Strix penetration test NOT RUN::` y termina en verde. Un job
verde que no corrió no es una capacidad probada, y el gate se escribió
precisamente para que eso se vea.

**E3 conserva `provenance`, y conviene saber por qué casi la pierde.** En el
primer run de #73 el job «Provenance evidence» quedó `skipped` — no por un
defecto suyo, sino porque **depende de `validate` y de `runtime-windows`**, y
Windows estaba en rojo. Corregido ese fallo, provenance corre y termina en
`success`. La lección se queda anotada: un job `skipped` aguas abajo no dice
nada sobre ese job; dice que algo aguas arriba falló.

---

## Recuento por peldaño — sin promedio

| Peldaño | Filas | Cuáles |
|---|---|---|
| `PRODUCTION` | **0** | — |
| `END_TO_END` | **6** | B1 B2 B3 B4 B5 B13 |
| `CALLER_REACHABLE` | **5** | A9 · B6 B7 B10 · C19 |
| `RUNTIME_VERIFIED` | **17** | A1 A2 A4 A5 A6 A7 A8 A10 A11 A12 · B9 · E1 E2 E3 E4 E5 E7 |
| `TESTED` | **19** | A3 A13 A14 · C1..C11 C16 C17 C18 · D1 D4 |
| `IMPLEMENTED` | **2** | C14 · E6 |
| `DOCUMENTED` | **11** | B8 B11 B12 · C12 C13 C15 · D3 D5 D6 · E8 E9 |
| — (nada) | **1** | D2 |
| **Total** | **61** | las 61 filas aparecen una sola vez; recuento verificado parseando el fichero |

`D1` se cuenta en `TESTED` porque el job de CI las ejecuta contra PostgreSQL
16.14. En un contenedor sin instancia es `NOT_EVALUATED`, y así se anota arriba.

**Once capacidades son alcanzables por un llamador externo, y seis de ellas lo
son desde la pantalla.** Diez llegaron por donde el tablero decía que llegarían:
no apareció código nuevo de producción, apareció la prueba que enchufa las dos
mitades que ya existían. La undécima, `C19`, sí es código nuevo: `DEC-021` F5
conecta por primera vez un caso de uso fiscal al canal comercial.

**Lo que separa `CALLER_REACHABLE` de `END_TO_END` es hoy pantalla, no motor.**
B6, B7 y B10 funcionan por el canal contra el handler real; lo que les falta es
una pantalla de cajero que las invoque. Es trabajo de interfaz, no de arquitectura.

`PRODUCTION` sigue en cero, y seguirá: exige el entorno de destino.

### Qué cambió respecto de `02b89bb`

La primera redacción de esta sección afirmaba que siete filas subían a
`CALLER_REACHABLE`. **Esa afirmación se retira**: se apoyaba en una prueba con
handler de doble, según queda documentado arriba. Lo que el merge de #73 movió de
verdad es esto:

| Fila | Antes (`02b89bb`) | Ahora (`da23b29`) | Por qué |
|---|---|---|---|
| A9 | `IMPLEMENTED` | `RUNTIME_VERIFIED` | X-2 cerrado; 13 tipos cruzan el socket, con doble detrás |
| A11 | `IMPLEMENTED` | `RUNTIME_VERIFIED` | arranca de verdad; el canal sigue siendo un doble |
| B5 | `IMPLEMENTED` | `RUNTIME_VERIFIED` | X-1 cerrado: la venta canónica ya se puede cobrar |
| B6 B7 B10 | `IMPLEMENTED` | `RUNTIME_VERIFIED` | las nueve operaciones antes rotas ya obtienen respuesta válida |
| E7 | `DOCUMENTED` | `RUNTIME_VERIFIED` | `boot.spec.ts`, 5 specs · y desde #74 los ejecuta CI |
| E4 | `IMPLEMENTED` | `RUNTIME_VERIFIED` | el push de `da23b29` ejecutó el job y pasó |

**B1 y B4 no se mueven**: ya estaban en `RUNTIME_VERIFIED` y la evidencia nueva
no las saca de ahí. **B2 y B3 tampoco**, por las operaciones que les faltan.

Se anota la retirada en lugar de conservar el número que quedaba mejor.

### Las 35 filas que declaraban `CANONICALLY_APPLIED`

Su recálculo fue el motivo del cambio de gobernanza, y se conserva aquí como
historial. Medido contra `02b89bb`, el árbol en que se detectó el problema:

| Antes | Pasó a | Filas |
|---|---|---|
| `CANON` 85 | `RUNTIME_VERIFIED` | 18 |
| `CANON` 85 | `TESTED` | 10 |
| `CANON` 85 | `IMPLEMENTED` | 7 |

Ninguna bajó por haberse roto: **bajaron porque la evidencia que se les exige
ahora es la que siempre debieron tener.** No se borró código; se dejó de contar
como probado lo que no lo estaba.

Siete de ellas volvieron a subir tras el merge de #73, y **han vuelto a bajar en
la misma jornada** al comprobarse que la prueba invocada usaba un doble. El
mecanismo funciona en los dos sentidos, que es justamente lo que se le pedía: una
fila se mueve cuando cambia la evidencia, no cuando cambia la afirmación.

---

## Lo que movió la PR #73 — **integrada**

Mergeada el 2026-09-12. Merge commit **`2e74410`**; segundo padre **`b6f0036`**;
base `02b89bb`.

| Corregido | Estado en `2e74410` |
|---|---|
| **X-1** · la venta canónica no se podía cobrar en efectivo | resuelto: la caja resuelve el turno y queda persistida en la venta |
| **X-2** · 9 de 23 operaciones mataban el socket | resuelto: tabla `Record<IpcMessageType, z.ZodType>` única y exhaustiva en compilación |

**El merge demuestra integración en `main`, y nada más.** No demuestra
producción, ni operación en Windows, ni que un cajero real pueda usarlo. Las
filas que suben lo hacen por las pruebas que #73 aportó, no por el hecho de
haberse mergeado — y ninguna alcanza `CALLER_REACHABLE`, porque la prueba que
#73 aportó cruza el transporte contra un doble.

Lo que #73 **no** resolvió sigue exactamente donde estaba: identidad real del
cliente del named pipe, handshake autorizado, aprovisionamiento de claves
(`LIC-003` / `DEV-003`), Windows Service con evidencia SCM, firma de código,
recibo, y cliente HTTP hacia el backend central.

---

## Cómo se actualiza

1. Se cambia **sólo la columna `Peldaño`** de las filas afectadas, y se dice con
   qué evidencia.
2. Se recalcula el **recuento por peldaño**. No se calcula ningún porcentaje.
3. Se añade una línea al historial.
4. Si hay que **añadir o quitar una fila**, se registra como cambio de
   estructura con fecha.
5. **Subir a `CALLER_REACHABLE` exige nombrar la prueba que cruza el transporte
   **y comprobar que el servidor lo atiende con el handler de producción**. Si la
   respuesta la construye el fichero de prueba, la fila **no sube**: eso acredita
   el transporte, no la capacidad.
6. **Subir a `END_TO_END` exige además que el efecto se lea donde queda escrito**
   —la base de datos— y no sólo en la respuesta.

## Historial

| Fecha | Estado | Qué movió |
|---|---|---|
| 2026-09-06 | 58 % | estructura congelada · sandbox de FACTUS verde · verificación por puerto · tablas de códigos DIAN |
| 2026-09-07 | 60 % | adquiriente materializado y persistido · `MIGRATION_012` · 915 pruebas |
| 2026-09-07 | 61 % | motor de impuestos por línea · `MIGRATION_013` · una sola aritmética de dinero · 958 pruebas |
| 2026-09-07 | 61 % | `unit_precision` gobierna la cantidad. **El tablero no se mueve.** 964 pruebas |
| 2026-09-07 | 61 % | auditoría del trabajo propio · `D-19` registrada. **Tampoco se mueve.** 969 pruebas |
| 2026-09-07 | 62 % | catálogo real · `MIGRATION_014` · `SandboxCatalogStore` eliminado · 989 pruebas |
| 2026-09-08 | 63 % | inventario · `MIGRATION_015` · descuento en la transacción que completa la venta · 1021 pruebas |
| 2026-09-12 | **sin porcentaje** | **cambio de gobernanza**, medido contra `02b89bb`. Se retira `CANONICALLY_APPLIED` y se retira el global. Las 35 filas que lo declaraban se recalculan contra siete peldaños con evidencia separada; **ninguna alcanzaba `CALLER_REACHABLE`**. Se corrige la etiqueta de A1 (`001..011` → `001..015`) y el error aritmético del bloque B (decía 740 / 62 %; la suma real de sus propias filas era 810 / 68 %) |
| 2026-09-13 | **sin porcentaje** | **merge de la PR #75** (`2aa8acc`, segundo padre `83542bc`). Primer movimiento al alza con evidencia desde el cambio de gobernanza: `CALLER_REACHABLE` **0 → 4** (A9, B6, B7, B10) y `END_TO_END` **0 → 3** (B1, B4, B5). Lo acredita `channel-commercial-vertical.test.ts` —socket real, handler de producción y SQLite— y, para las tres de `END_TO_END`, `real-channel.spec.ts`, que las invoca desde la pantalla de Electron. **Se anota que la previsión era 7 y 6: era incorrecta**, porque contaba filas cuyo alta de catálogo o de existencia sólo se ejecuta por `page.evaluate`, que no es superficie de producto. Se conserva el recuento medido, no el previsto |
| 2026-09-15 | **sin porcentaje** | **`DEC-021` F5, mitad pantalla — C19 **no** sube, y el hallazgo es el resultado**. `FiscalPanel` y `useFiscalIssuance` existen, están montados en `App` y el E2E de Electron los conduce contra el servicio real: la emisión fiscal ya se dispara desde el producto, no sólo desde una prueba de canal. Y aun así `C19` se queda en `CALLER_REACHABLE`, porque **la cadena no llega a escribir el documento**. El motivo, ahora demostrado en vez de supuesto, es `D-19`: `catalog_fiscal_attribute` tiene **un lector en producción y cero escritores** —ninguna pantalla, ningún caso de uso, ninguna operación del canal puede dar a una presentación su `unit_measure_code`, `standard_code`, `tax_code` y `tax_rate`—, de modo que **ningún producto dado de alta por el producto real se puede facturar**. El E2E lo afirma con las dos formas de adquiriente: identificado y anónimo bloquean **igual**, con `LINE_FISCAL_ATTRIBUTE_MISSING`, lo que prueba además que `D-13` no es el único obstáculo. Sembrar el atributo en el arnés habría puesto la prueba en verde afirmando una capacidad inexistente: no se hizo, y esa decisión queda escrita en la propia prueba. Corregido de paso un defecto del arnés que el guardia de `InsecureDerivedKeyProvider` destapó: el proceso E2E no declaraba `NODE_ENV=test` y el almacén de secretos fiscal se negaba a construirse —el guardia hizo exactamente su trabajo—. 5 pruebas de renderer nuevas y 1 E2E; recuento **sin cambios** |
| 2026-09-15 | **sin porcentaje** | **`DEC-021` F5, mitad canal — fila C19 sube a `CALLER_REACHABLE`**. `fiscal.document.issue` entra al contrato (`ipc-commercial.ts`), al `switch` de `CommercialRequestHandler` y a `CommercialComponent`, que ahora construye `IssueElectronicDocumentUseCase` con `FactusAdapter`+`FetchHttpTransport` reales cuando `POS_FISCAL_ENVIRONMENT` está configurado y hay credencial depositada (mismo patrón de `POS_CENTRAL_BASE_URL`/`D4`: ausente, la pieza no se construye y falla cerrado). El adquiriente viaja **por referencia** —`customer_id` de `customer.register`, o el motivo de ausencia— nunca por un segundo juego de campos en la petición. `IssueElectronicDocumentUseCase.execute` gana comprobación de permiso (`FISCAL_DOCUMENT_ISSUE`, `evaluatePermission`), el mismo patrón que ya usan `RegisterCustomerUseCase`/`GetPaymentUseCase` — hueco real frente al resto del canal, no cambio cosmético. Dos pruebas nuevas en `channel-commercial-vertical.test.ts` cruzan el socket real contra el `CommercialRequestHandler` de producción: adquiriente anónimo → `BLOCKED`/`GENERIC_ACQUIRER_NOT_VERIFIED` (D-13 confirmado en producción, no sólo en unitarias) y adquiriente identificado → `ISSUED`, con el `cufe` verificado **en `fiscal_electronic_document`**, no sólo en la respuesta — la propia regla de `CALLER_REACHABLE`. `END_TO_END` no se alcanza: **no existe pantalla** que invoque `fiscal.document.issue` — ni panel de Electron, ni hook, ni `real-channel.spec.ts` — y por eso C1..C11 tampoco suben todavía. Recuento: `CALLER_REACHABLE` **4 → 5**, `TESTED` **20 → 19**, total **61** (sin cambio: C19 se mueve, no se crea) |
| 2026-09-14 | **sin porcentaje** | **`DEC-021` F4 materializado** — *cambio de estructura*: fila **C19**. `IssueElectronicDocumentUseCase` es el punto donde F1+F2+F3 empiezan a valer para algo: identidad antes de transmitir (F1), credencial resuelta (F2), payload ensamblado (F3), y ahora el intento real contra `DocumentIssuancePort`, regla por regla contra `docs/architecture/electronic-invoicing.md` §«Idempotencia y resultado incierto». La clave de idempotencia es `(venta, tipo documental)`, estable entre reintentos; un documento `COMPLETED` resuelve `ALREADY_ISSUED` sin volver a llamar al puerto; un desenlace `UNCERTAIN` se persiste como `UNKNOWN_OUTCOME` y el siguiente intento exige `REQUIRES_RECONCILIATION` — nunca reintenta solo; un `TECHNICAL_FAILURE` es retriable y el reintento **reusa el mismo payload congelado**, con el mismo checksum. **El adquiriente es un parámetro explícito de entrada, no una columna derivada por `JOIN`**: `sales_sales` no vincula cliente porque `CUST-001` sigue `PLANNED`, y no hace falta — `UC-EINV-001` Flujo B y la propia `DEC-021` F3 ya lo modelan así. Se añade `canonicalDocumentTypeCode` a `dian/codes.ts` (inversa de `fiscalDocumentTypeForCode`, misma tabla verificada, `null` para lo no verificado) y `mapPaymentMethodToDian`, que traduce `CASH`→`10` y `TRANSFER`→`42` y bloquea `CARD`/`QR`/`CUSTOMER_CREDIT` por no tener código DIAN verificado, en vez de inventarlo. 31 pruebas nuevas sobre la máquina de estados, la selección de rango, la fuente de venta fiscal, `SynchronizeNumberingRangesUseCase` y el caso de uso completo —camino feliz, idempotencia, desenlace incierto, fallo técnico retriable, los cuatro bloqueos (rango no sincronizado o no vigente, atributo fiscal ausente, adquiriente anónimo vía `GENERIC_ACQUIRER_NOT_VERIFIED`, método de pago sin código DIAN) y dos ventas sin colisión de identidad—, más 3 pruebas añadidas a `dian-codes.test.ts` para la función inversa. Peldaño `TESTED`, no más: **ningún handler del canal comercial invoca este caso de uso todavía** (F5 pendiente); ver la nota corregida bajo C1..C8. Recuento: `TESTED` **19 → 20**, total **60 → 61** |
| 2026-09-14 | **sin porcentaje** | **`DEC-021` F3 materializado** — *cambio de estructura*: fila **C18**. El adapter trataba `document.payload` como opaco, de modo que **nadie definía la forma del cuerpo de emisión**; ahora la define `assembleFactusBill`, contra `provider-payload-shapes.md` §FACTUS (nivel `VERIFICADO_DOC`). Ningún campo inventado. El principio es bloquear y nunca rellenar, y **se devuelven todos los motivos a la vez**: el operador tiene una venta cobrada delante y descubrir los problemas de uno en uno es justo lo que no debe pasarle. Los dos bloqueos que este bloque **no puede levantar** quedan propagados con su nombre: `D-13`, el adquiriente genérico de la DIAN sin verificar —una venta de mostrador anónima, el caso mayoritario de un POS colombiano, **hoy no tiene salida fiscal**— y `D-14`, la precisión: una báscula produce `0,333333` kg y `toProviderDecimal` **nunca redondea**, porque redondear emitiría una factura que no coincide con lo cobrado. 15 pruebas; la primera compara el cuerpo campo a campo. Peldaño `TESTED`: ningún caso de uso lo invoca todavía (F4 pendiente). Recuento: `TESTED` **18 → 19**, total **59 → 60** |
| 2026-09-14 | **sin porcentaje** | **`DEC-021` F2 materializado** — *cambio de estructura*: fila **C17**. `FiscalCredentialStore` custodia la credencial en el almacén de `SEC-004` con **contexto criptográfico propio**, de modo que un secreto de identidad de dispositivo no se puede descifrar como credencial fiscal aunque compartan directorio y clave maestra. El nombre del secreto deriva de `(proveedor, ambiente)`: no hace falta tabla ni índice, y los ambientes no se mezclan. Una rotación invalida la referencia anterior en lugar de servir la nueva en silencio. `SecretStoreFactusCredentialResolver` es el primer resolutor de producción —antes sólo existía el fake de las pruebas— y **no lee del entorno**: `FACTUS_SANDBOX_ENV` queda reservado a F6 en el equipo del propietario. El depósito es una entrada de operador **en la máquina, por `stdin`**, no una operación del canal: añadir una operación comercial que no pasara por `authenticate()` sería un agujero, y depositar la credencial fiscal de un comercio es más sensible que cobrar una venta. 16 pruebas; una lee el fichero crudo y comprueba que el valor no está en claro. Peldaño `TESTED`: el arranque de producción no instancia el resolutor todavía (F3..F5 pendientes). Recuento: `TESTED` **17 → 18**, total **58 → 59** |
| 2026-09-14 | **sin porcentaje** | **`DEC-021` F1 materializado** — *cambio de estructura*: se añade la fila **C16**, documento electrónico local y rango persistido. `MIGRATION_016` crea `fiscal_numbering_range` y `fiscal_electronic_document`, con las invariantes de `outcome.ts` repetidas como `CHECK` y tres triggers (identidad congelada, intentos monótonos, resuelto es final). El índice parcial `fiscal_electronic_document_open_per_sale_idx` hace **estructuralmente imposible** abrir una segunda emisión para una venta cuyo desenlace no está resuelto: es la duplicación ante la DIAN que `DEC-021` §4 llama el único daño irreversible. 21 pruebas ejecutan cada invariante. Peldaño `TESTED`: la tabla existe y se prueba, pero **ningún caso de uso la escribe todavía** (F2..F5 pendientes). **Corrección en `D5`**: no es simplemente `DOCUMENTED`, está bloqueada por el corte criptográfico — el esquema central no admite operaciones de origen dispositivo. Recuento: `TESTED` **16 → 17**, total **57 → 58** |
| 2026-09-14 | **sin porcentaje** | **`D-2` materializado** (`DEC-023`). `D4` sube `DOCUMENTED → TESTED`: `SyncDispatcher` cierra `claimBatch → POST → recordResponse`, con 14 pruebas propias y 4 de componente. **No sube más** por la regla 1: `main.ts` sólo instancia `CentralSyncComponent` si hay `POS_CENTRAL_BASE_URL`, y no hay autoridad a la que apuntarlo. Recuento: `TESTED` **15 → 16**, `DOCUMENTED` **12 → 11** |
| 2026-09-13 | **sin porcentaje** | **barrido de afirmaciones**. E4 sube a `RUNTIME_VERIFIED`: el job «Main push governance» se ejecutó en el push de `da23b29` y pasó; la nota que lo daba por `NOT_EVALUATED` confundía «`skipped` en PR» con «nunca observado». Se corrige la evidencia de D2. Recuento: `RUNTIME_VERIFIED` **26**, `IMPLEMENTED` **2** |
| 2026-09-12 | **sin porcentaje** | **segunda corrección de gobernanza**, sobre el árbol `da23b29`. `CALLER_REACHABLE` pasa de **7 a 0**: las siete filas se apoyaban en `channel-commercial-transport.test.ts`, cuyo servidor atiende con un cierre de la propia prueba. Verificado que **ningún** fichero de prueba de `main` que construya `LocalChannelServer` menciona `CommercialRequestHandler` ni `CommercialComponent`. Bajan a `RUNTIME_VERIFIED`, que con E7 suma **25 filas**. Se añade a la escalera y a la regla 5 el filo que faltaba: **un socket no es evidencia si detrás hay un doble** |
| 2026-09-12 | **sin porcentaje** | **merge de la PR #73** (`2e74410`, segundo padre `b6f0036`). X-1 y X-2 dejan de estar vivos en `main`. Reevaluado contra el árbol nuevo, **siete filas alcanzan `CALLER_REACHABLE`** —A9, B1, B4, B5, B6, B7, B10—, A11 sube a `RUNTIME_VERIFIED` y E7 a `TESTED`. Tres más de las cuatro proyectadas: la proyección sólo miró las filas que X-2 rompía, y #73 además aportó la prueba que recorre la vertical por el socket |
