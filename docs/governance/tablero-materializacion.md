# Tablero de materialización — estructura permanente

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
| `CALLER_REACHABLE` | un llamador **fuera del proceso** la alcanza **cruzando el transporte real** y recibe una respuesta válida | que la operación figure en el contrato · que el handler la atienda |
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

## El tablero

**56 capacidades en 5 bloques.** Estructura congelada el 2026-09-06.

**Árbol evaluado: `origin/main` = `2e74410`**, el 2026-09-12. No se evalúa
ninguna rama: una capacidad en una rama abierta no está en `main`.

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
| A9 | Canal IPC comercial (23 tipos) | `CALLER_REACHABLE` | 13 operaciones cruzan el socket con respuesta aseverada · `channel-commercial-transport.test.ts` |
| A10 | Enrutamiento del canal → superficie comercial | `RUNTIME_VERIFIED` | `CommercialComponent` en `main.ts:88`; `LocalChannelComponent` sólo en `win32` |
| A11 | Shell Electron (main, preload, allowlist) | `RUNTIME_VERIFIED` | monta sobre `dist/`; 5 E2E con Electron real · **canal de doble**, no el servicio |
| A12 | Logger estructurado | `RUNTIME_VERIFIED` | `observability`, 4 pruebas |
| A13 | Ciclo de seguridad local (DPAPI, identidad, licencia) | `TESTED` | `main.ts` no lo instancia |
| A14 | Adquisición de snapshot de autorización (SAS-003) | `TESTED` | `main.ts` no lo instancia |

**A9 es la primera fila que alcanza `CALLER_REACHABLE`, y por poco.** Hasta
`02b89bb`, `catalog.*`, `customer.*` e `inventory.*` no obtenían respuesta
válida: `validateResponse` tenía 14 `case` de 23 y ningún `default`, devolvía
`undefined`, y el socket se destruía sin un solo mensaje. La tabla compartida
`Record<IpcMessageType, z.ZodType>` lo cerró.

**No sube por la corrección, sino por la prueba.** Trece operaciones cruzan hoy
un `LocalChannelServer` y un `LocalChannelClient` reales y se asevera su
respuesta. Las diez restantes —`session.*`, `operation.*`, `cash.shift.close` y
los tres pagos que no son efectivo— **nunca han cruzado el socket**; comparten el
mismo `responseSchemaFor`, exhaustivo en compilación, pero eso es un argumento,
no una ejecución. La fila sube por las trece; las diez quedan anotadas.

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

**Ninguna fila del bloque A alcanza `CALLER_REACHABLE`** salvo el handshake y el
estado, que sí tienen prueba con cliente real (`channel.test.ts`: «uses the real
client to negotiate TECH-003 and validate response identity»). No se les asigna
fila propia: son parte de A9.

### Bloque B — Núcleo comercial · 12 capacidades

| # | Capacidad | Peldaño | Evidencia |
|---|---|---|---|
| B1 | Sales V1 (venta → `READY_FOR_PAYMENT`) | `CALLER_REACHABLE` | `sale.create` cruza el socket → `CREATED` |
| B2 | Cash V1 (apertura y cierre de turno) | `RUNTIME_VERIFIED` | `cash.shift.open` cruza → `OPENED`; **`cash.shift.close` no cruza** |
| B3 | Payments V1 (`CASH`, `TRANSFER`, cobertura) | `RUNTIME_VERIFIED` | `payment.register.cash` cruza → `CONFIRMED`; **`TRANSFER` no cruza** |
| B4 | Completado de venta como único punto | `CALLER_REACHABLE` | `sale_completed: true` aseverado al otro lado del socket |
| B5 | Frontera Payments ↔ Cash | `CALLER_REACHABLE` | la vertical turno → venta → cobro recorre el canal en una conexión |
| B6 | Catalog | `CALLER_REACHABLE` | `register` · `find` · `get`: las tres cruzan el socket |
| B7 | Inventory | `CALLER_REACHABLE` | `receive` · `adjust` · `get`: las tres cruzan el socket |
| B8 | Pricing | `DOCUMENTED` | tabla sin motor |
| B9 | Tax (motor de impuestos) | `RUNTIME_VERIFIED` | se calcula dentro de `sale.create`; **su salida no se asevera al otro lado** |
| B10 | Customer / adquiriente | `CALLER_REACHABLE` | `register` · `get` · `find`: las tres cruzan el socket |
| B11 | SaleReturn, notas crédito y débito | `DOCUMENTED` | — |
| B12 | Periféricos POS | `DOCUMENTED` | cero código |

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
cobrarla— recorre el canal **en una sola conexión** y devuelve
`["OPENED", "FOUND", "CREATED", "CONFIRMED"]`. Por eso B5 sube a
`CALLER_REACHABLE`, y con ella B1 y B4.

**B6, B7 y B10 suben por la misma prueba.** Eran seis de las nueve operaciones
que X-2 mataba; hoy las nueve devuelven `SUCCEEDED` al otro lado del socket.

**B2 y B3 se quedan en `RUNTIME_VERIFIED`, y no es un descuido.** La regla es
que una fila sube a `CALLER_REACHABLE` sólo cuando **todas** las operaciones que
nombra cruzan el transporte. De B2 cruza la apertura pero no el cierre; de B3
cruza el efectivo pero no la transferencia. Media capacidad probada no es la
capacidad.

**B8 y B12 se mantienen en `DOCUMENTED`.** `sandbox_price_rule` es una tabla sin
regla que la calcule; periféricos no tiene una sola línea.

### Bloque C — Plano fiscal · 15 capacidades

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

**C1..C8 bajan de 85 a `TESTED`, y la razón es una sola: FACTUS es una isla.**
Verificado sobre `apps/pos-local-service/src`: **cero** llamadas a
`DocumentIssuancePort`, a `issueDocument` y a `NumberingRangePort`. El único
módulo del servicio que importa el paquete fiscal es `customers/`, y lo hace por
el tipo `FiscalCustomer`.

Un adapter con 170 pruebas verdes y sandbox real detrás sigue sin estar
instanciado por ningún runtime. `SANDBOX_VERIFIED` acredita que **el proveedor
respondió**; no acredita que el POS le hable.

**C9, C10 y C11 no están más abajo por falta de ganas.** Emitir exige `Customer`,
tablas DIAN, `Catalog` y `Tax` (`D-9`). Las cuatro existen. **El bloqueo es
nuestro, no de FACTUS**, y hoy es la ausencia de llamada.

### Bloque D — Plataforma central y transporte · 6 capacidades

| # | Capacidad | Peldaño | Evidencia |
|---|---|---|---|
| D1 | PostgreSQL migrations 001 / 002 / 003 | `TESTED` | job de CI con PostgreSQL 16.14; `NOT_EVALUATED` en contenedor sin instancia |
| D2 | Aplicación central que use el esquema | — | `packages/database-postgres/src` **vacío** (`D-4`) |
| D3 | API central | `DOCUMENTED` | — |
| D4 | Transporte saliente local → central | `DOCUMENTED` | **cero cliente HTTP** en `src/sync/` |
| D5 | Ingesta central y reconciliación | `DOCUMENTED` | — |
| D6 | Identidad y licencia central | `DOCUMENTED` | — |

**D4 es la deuda `D-2` y sigue siendo la más cara del proyecto.** Verificado:
`apps/pos-local-service/src/sync/` no contiene cliente HTTP alguno;
`SnapshotProvider` es un puerto cuyo propio comentario dice que el transporte
productivo no existe. A5 está instanciado y aun así **ningún dato sale del
dispositivo**.

### Bloque E — Entrega y operación · 9 capacidades

| # | Capacidad | Peldaño | Evidencia |
|---|---|---|---|
| E1 | Validación TARGET (5 jobs) | `RUNTIME_VERIFIED` | ejecuta en cada PR |
| E2 | CodeQL SAST | `RUNTIME_VERIFIED` | `success` en el run de #73 |
| E3 | SBOM · licencias · vulnerabilidades · provenance | `RUNTIME_VERIFIED` | `success` en el run de #73 sobre `b6f0036`, provenance incluida |
| E4 | Gobernanza de merge de `main` | `IMPLEMENTED` | `skipped` en PR: sólo corre en push a `main`; `NOT_EVALUATED` |
| E5 | Boundaries ARCH-003 + `frozenSourceAreas` | `RUNTIME_VERIFIED` | `pnpm architecture:check` PASS |
| E6 | Strix (pentest con IA) | `IMPLEMENTED` | **nunca ha ejecutado un pentest** |
| E7 | E2E Playwright | `TESTED` | `boot.spec.ts`, 5 specs con Electron real bajo `xvfb` |
| E8 | Instalador NSIS y firma de código | `DOCUMENTED` | `electron-builder` no aparece en el lockfile |
| E9 | Despliegue y operación en producción | `DOCUMENTED` | — |

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
| `END_TO_END` | **0** | — |
| `CALLER_REACHABLE` | **7** | A9 · B1 B4 B5 B6 B7 B10 |
| `RUNTIME_VERIFIED` | **17** | A1 A2 A4 A5 A6 A7 A8 A10 A11 A12 · B2 B3 B9 · E1 E2 E3 E5 |
| `TESTED` | **16** | A3 A13 A14 · C1..C11 · D1 · E7 |
| `IMPLEMENTED` | **3** | C14 · E4 E6 |
| `DOCUMENTED` | **12** | B8 B11 B12 · C12 C13 C15 · D3 D4 D5 D6 · E8 E9 |
| — (nada) | **1** | D2 |
| **Total** | **56** | las 56 filas aparecen una sola vez; recuento verificado parseando el fichero |

`D1` se cuenta en `TESTED` porque el job de CI las ejecuta contra PostgreSQL
16.14. En un contenedor sin instancia es `NOT_EVALUATED`, y así se anota arriba.

**Siete capacidades del POS son alcanzables por un llamador a través del
transporte real.** Ninguna llega a `END_TO_END`: no existe superficie de producto
que las invoque, porque la entrada de producción de Electron depende del
handshake autorizado, que sigue bloqueado.

### Qué cambió, y por qué no coincide con lo proyectado

El tablero anterior se evaluó contra `02b89bb` y proyectó que el merge de #73
movería **cuatro** filas a `CALLER_REACHABLE`: A9, B6, B7 y B10 —las que el
defecto X-2 mataba—. Recalculado contra `2e74410`, **son siete**.

La diferencia no es un ajuste al alza: es que aquella proyección **sólo miró las
filas cuyo defecto se corregía**, y pasó por alto que #73 añadió además una
prueba que recorre la vertical completa por el socket. B1, B4 y B5 no estaban
rotas por X-2; sencillamente **nadie había probado nunca que un llamador externo
las alcanzara**. Esa prueba existe ahora, y por eso suben.

Se anota la discrepancia en lugar de forzar el número proyectado.

| Fila | Antes (`02b89bb`) | Ahora (`2e74410`) | Por qué |
|---|---|---|---|
| A9 | `IMPLEMENTED` | `CALLER_REACHABLE` | 13 operaciones cruzan el socket con respuesta aseverada |
| A11 | `IMPLEMENTED` | `RUNTIME_VERIFIED` | arranca de verdad; el canal sigue siendo un doble |
| B1 | `RUNTIME_VERIFIED` | `CALLER_REACHABLE` | `sale.create` cruza → `CREATED` |
| B4 | `RUNTIME_VERIFIED` | `CALLER_REACHABLE` | `sale_completed` aseverado al otro lado |
| B5 | `IMPLEMENTED` | `CALLER_REACHABLE` | la vertical recorre el canal en una conexión |
| B6 B7 B10 | `IMPLEMENTED` | `CALLER_REACHABLE` | las nueve antes rotas devuelven `SUCCEEDED` |
| E7 | `DOCUMENTED` | `TESTED` | `boot.spec.ts`, 5 specs |

**B2 y B3 no se mueven**, aunque estén en el mismo bloque y su vecina sí suba:
de B2 cruza la apertura y no el cierre, de B3 el efectivo y no la transferencia.

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
como probado lo que no lo estaba. Que siete hayan vuelto a subir tras el merge
de #73 confirma el mecanismo: suben cuando aparece la prueba, no cuando aparece
la afirmación.

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
siete filas que suben lo hacen por las pruebas que #73 aportó, no por el hecho
de haberse mergeado.

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
5. **Subir a `CALLER_REACHABLE` exige nombrar la prueba que cruza el transporte.**
   Sin ese nombre, la fila no sube.

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
| 2026-09-12 | **sin porcentaje** | **merge de la PR #73** (`2e74410`, segundo padre `b6f0036`). X-1 y X-2 dejan de estar vivos en `main`. Reevaluado contra el árbol nuevo, **siete filas alcanzan `CALLER_REACHABLE`** —A9, B1, B4, B5, B6, B7, B10—, A11 sube a `RUNTIME_VERIFIED` y E7 a `TESTED`. Tres más de las cuatro proyectadas: la proyección sólo miró las filas que X-2 rompía, y #73 además aportó la prueba que recorre la vertical por el socket |
