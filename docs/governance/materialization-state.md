# Estado de materialización — fuente única

## Propósito

Este documento existe porque el proyecto perdió trabajo dos veces por la misma
causa: **`DONE` en `docs/product/backlog.md` significa "el caso de uso está
escrito", y se leyó como "está implementado".**

Aquí `MATERIALIZED` significa una sola cosa: **existe código en `main` y esta
tabla dice en qué ruta está.** Una fila sin ruta verificable no puede declararse
materializada.

No reemplaza al backlog: el backlog prioriza y describe intención, este
documento registra evidencia. Cuando ambos discrepen, **manda el código**.

## Cómo se usa

Antes de proponer construir algo, búscalo aquí. Si la columna `Código en main`
tiene una ruta, ya existe: léela antes de escribir nada.

Al cerrar un bloque, se actualiza la fila correspondiente con la ruta real y el
comando de prueba ejecutado. No se marca una fila por anticipado.

## Convenciones

`DOC` documentación específica · `MAT` código en `main` · `TEST` prueba que
ejecuta el comportamiento · `CANON` integrado en `main` con CI verde ·
`PROD` validado en producción.

`—` significa que no existe, no que esté pendiente de verificar.

### Qué **no** significa `CANON` aquí — corregido el 2026-09-12

`CANON` en este documento significa **exactamente dos cosas**: está en `main` y
CI está verde. **No dice nada sobre si un llamador la alcanza.**

Durante seis días el tablero definió la misma marca de otra manera —«en `main`,
con CI verde, y **alcanzable de extremo a extremo**»— y esa tercera condición no
se verificó nunca en ninguno de los dos documentos. Dos definiciones distintas
para una sola marca, en dos documentos que declaran no poder contradecirse.

La reachability se acredita ahora en
[`tablero-materializacion.md`](./tablero-materializacion.md), en peldaños
separados —`RUNTIME_VERIFIED`, `CALLER_REACHABLE`, `END_TO_END`—, cada uno con su
propia evidencia. **Una `X` en la columna `CANON` de este documento no autoriza a
decir que la capacidad es alcanzable.**

## Estado verificado sobre `da1fe74` + rama `feat/security-lifecycle-boot` (2026-09-14)

> El **tablero** —bloques, capacidades y escalera de peldaños— vive en
> [`tablero-materializacion.md`](./tablero-materializacion.md). Aquel documento
> congela la estructura para que sólo se mueva el peldaño; éste registra la
> evidencia por capacidad. **El tablero ya no publica porcentajes**: desde el
> 2026-09-12 publica un recuento de filas por peldaño. **Ninguno reemplaza al
> otro y ninguno puede contradecirlo: si discrepan, manda el código.**
>
> Censo del 2026-09-14: **1158 pruebas pasan** en **10** proyectos de vitest,
> con **6 omitidas por entorno**, más **8 pruebas E2E de Electron** bajo `xvfb`,
> que corren en su propio ejecutor y no entran en esa suma. `pnpm typecheck`
> PASS · `pnpm architecture:check` PASS · `pnpm ci:repository-policy` PASS
> (**566 archivos**).
>
> Desglose: contracts 244 · domain 47 · application 16 · local-channel 4 ·
> database-sqlite 37 · observability 4 · fiscal-adapters 170 (2 omitidas) ·
> pos-local-service 499 (4 omitidas) · pos-desktop 124 · migraciones SQLite 13.
>
> Medido sobre la rama `feat/security-lifecycle-boot` a partir de `da1fe74`.
> La rama aporta 13 de esas pruebas —7 de la vertical por el canal y 6 de
> normalización a escala 6—, de modo que en `da23b29` puro son **1141**.
>
> El décimo proyecto es `@pos-platform/local-channel`, que existe desde #73.
>
> Las 6 omitidas son omisiones **legítimas y declaradas**: 2 del sandbox de
> FACTUS, que `describe.skipIf` salta sin credencial, y 4 marcadas `windowsIt`,
> que no corren en Linux y **sí corren en CI sobre `windows-2022`**.

> **Dos puertas que no miraban — 2026-09-20.**
>
> Las dos llevaban tiempo en rojo o en verde **sin estar mirando lo que dicen
> que miran**, y las dos se repararon con la misma disciplina: no basta con que
> la puerta pase, hay que **mutar el árbol** y comprobar que rechaza.
>
> **1 · `architecture:check` devolvía PASS con la violación viva.** El target de
> Nx cachea sobre `{projectRoot}`, que en el proyecto raíz **no incluye los
> ficheros de los demás proyectos** —que son justamente los que el validador
> lee—. Con una dependencia prohibida introducida a mano, `node
> tools/architecture/validate-boundaries.mjs` la rechazaba y `pnpm
> architecture:check` respondía `PASS · Cache: 1/1 hit (100%)`. Se desactiva la
> caché de ese target. Una puerta de 3 s no necesita caché; un acierto de caché
> equivocado convierte la puerta en decoración.
>
> **2 · `ci:repository-policy` juzgaba por la extensión, no por el material.**
> Rechazaba `infra/trust/camacho-pos-session-trust-root-public.pem` **sin
> abrirlo**. Es una clave **pública** Ed25519, y una raíz de confianza existe
> para distribuirse: es lo que permite verificar contra una raíz conocida. La
> prueba de que la heurística no miraba el contenido está en el mismo
> directorio: `session-assertion-operational-key.json` lleva un PEM incrustado y
> pasaba sin abrirse, sólo por su extensión.
>
> La reparación **no es una lista de rutas permitidas**. Una ruta permitida deja
> de mirar el contenido para siempre y admite cualquier cosa que después se
> escriba con ese nombre. Es una condición sobre el contenido: entra sólo el
> fichero cuyo texto **entero** son bloques PEM y **todos** públicos. Seis
> mutaciones lo comprueban, y la que importa es la que rompería cualquier
> allowlist —una clave privada anexada debajo de una pública—: sigue rechazada.
> Los nombres de la lista (`id_rsa`, `id_ed25519`) **no admiten excepción**: son
> nombres de clave privada por convención y no existe un fichero público que se
> llame así.
>
> Ninguna de las tres rutas de `infra/trust/` contiene material privado:
> se verificó leyendo las tres.
>
> **3 · Dos paquetes fuera de toda gobernanza de capas.**
> `@pos-platform/device-trust` y `@pos-platform/central-authority` llegaron con
> la unificación de ramas sin entrada en `module-boundaries.json` **y sin
> `project.json`**. Se declaran con capas nuevas —`security` y
> `central-runtime`— y no metiéndolas en las existentes, por una razón medible:
> `adapter` no veta `better-sqlite3` ni `pg`, de modo que device-trust habría
> quedado autorizado a abrir una base de datos; y `runtime` **veta `pg`**
> precisamente para que el POS Local Service no hable PostgreSQL, así que meter
> ahí a Central Authority habría exigido quitar ese veto. Una capa nueva
> conserva las dos reglas; reutilizar una existente habría debilitado una.

> **Aviso de lectura — la línea `Tests` de vitest no dice toda la verdad.**
>
> `pnpm --filter @pos-platform/target-migrations test` imprime:
>
> ```
>  Test Files  7 failed | 4 passed (11)
>       Tests  65 passed | 147 skipped (212)
> ```
>
> Los siete ficheros **fallan** en `beforeAll` con
> `ECONNREFUSED 127.0.0.1:55432`, y vitest contabiliza sus pruebas como
> *omitidas*. La línea `Tests` **no menciona un solo fallo**.
>
> Quien cite «N pruebas, 0 fallos» leyendo sólo esa línea estará citando una
> línea que esconde siete ficheros rojos. **Para declarar un censo hay que leer
> también `Test Files`.** Esas 147 no se cuentan entre las 6 omitidas de arriba:
> son `pnpm test:migrations:postgres`, que sigue **`REQUIRES_LOCAL_VERIFICATION`**
> en este contenedor y **sí se ejecuta en CI** contra PostgreSQL 16.14 —paso
> «Validate PostgreSQL migrations 001/002/003 including physical runner»,
> `success` en `da23b29`—.

> El desglose por proyecto y comando vive en el
> [tablero](./tablero-materializacion.md); **esta cabecera no lo duplica**,
> porque duplicar una cifra es garantizar que una de las dos copias envejezca.
> Ya pasó dos veces con esta misma línea: decía 915 cuando ya iban 964, y decía
> 1021 cuando ya iban 1154. La segunda vez la detectó un barrido, no el propio
> proceso de actualización.

### Núcleo comercial local

| Capacidad | DOC | MAT | TEST | CANON | PROD | Código en main |
|---|---|---|---|---|---|---|
| Sales V1 (venta → `READY_FOR_PAYMENT`) | ✅ | ✅ | ✅ | ✅ | ❌ | `apps/pos-local-service/src/sales/` · `MIGRATION_010` |
| Cash V1 (apertura/cierre de turno) | ✅ | ✅ | ✅ | ✅ | ❌ | `.../src/cash/` · `MIGRATION_009` |
| Payments V1 (`CASH`, `TRANSFER`, cobertura) | ✅ | ✅ | ✅ | ✅ | ❌ | `.../src/payments/` · `MIGRATION_011` |
| Completado de venta (único punto) | ✅ | ✅ | ✅ | ✅ | ❌ | `.../payments/sqlite-payment-store.ts` → `completeSaleIfCovered` |
| Frontera Payments↔Cash | ✅ | ✅ | ✅ | ✅ | ❌ | `.../payments/cash-port.ts` |
| Adquiriente (`Customer`) — persistencia, casos de uso y canal | ✅ | ✅ | ✅ | ✅ | ❌ | `.../src/customers/` · `MIGRATION_012` · `customer.register`/`get`/`find` |
| Impuesto por línea desde el catálogo (`Tax`) | ✅ | ✅ | ✅ | ✅ | ❌ | `.../src/sales/sale-calculation.ts` · `MIGRATION_013` · `catalog_fiscal_attribute` |
| Catálogo real (producto, presentación, código de barras, precio) | ✅ | ✅ | ✅ | ✅ | ❌ | `.../src/catalog/` · `MIGRATION_014` · `catalog.product.register` / `item.find` / `item.get` |
| La cantidad respeta la precisión de la unidad | ✅ | ✅ | ✅ | ✅ | ❌ | `.../sales/sale-calculation.ts` → `quantityFitsUnitPrecision` |
| Inventario (existencia por sucursal y libro de movimientos) | ✅ | ✅ | ✅ | ✅ | ❌ | `.../src/inventory/` · `MIGRATION_015` · `inventory.stock.receive` / `adjust` / `get` |
| La venta descuenta existencia en la transacción que la completa | ✅ | ✅ | ✅ | ✅ | ❌ | `.../payments/inventory-port.ts` · `sqlite-payment-store.ts` → `deductSoldStock` |

> **Corrección de estado, 2026-09-06.** Payment V1 figuraba aquí como
> `CANONICALLY_APPLIED` desde `BLOQUE 4E`, y lo era en handler y
> persistencia, pero **no era alcanzable por el transporte de producción**:
> los cinco `payment.*` faltaban en el `switch` de enrutamiento y cada
> intento terminaba en `socket.destroy()`. Cerrado por PR #37. La lección
> que deja: «materializado» y «alcanzable de extremo a extremo» son
> propiedades distintas, y una fila de esta tabla debe acreditar la
> segunda cuando la capacidad se expone por un transporte.

### Plataforma local

| Capacidad | DOC | MAT | TEST | CANON | PROD | Código en main |
|---|---|---|---|---|---|---|
| SQLite `MIGRATION_001..014` | ✅ | ✅ | ✅ | ✅ | ❌ | `packages/database-sqlite/src/local-database.ts` |
| Idempotencia (`runtime_operations`) | ✅ | ✅ | ✅ | ✅ | ❌ | `MIGRATION_001` · `.../operations/` |
| Identidad de dispositivo y licencia (tablas) | ✅ | ✅ | ✅ | ✅ | ❌ | `MIGRATION_003` |
| Auditoría append-only | ✅ | ✅ | ✅ | ✅ | ❌ | `MIGRATION_005` + triggers |
| Outbox / inbox / checkpoint / dead-letter | ✅ | ✅ | ✅ | ✅ | ❌ | `.../sync/durable-sync-store.ts` · `MIGRATION_004` |
| SSA y binding de sesión | ✅ | ✅ | ✅ | ✅ | ❌ | `.../session/` · `MIGRATION_007` |
| Proyección de autorización | ✅ | ✅ | ✅ | ✅ | ❌ | `.../authorization/` · `MIGRATION_006` |
| Master snapshot | ✅ | ✅ | ✅ | ✅ | ❌ | `.../master-data/` · `MIGRATION_009` |
| Canal IPC comercial (19 tipos) | ✅ | ✅ | ✅ | ✅ | ❌ | `packages/contracts/src/ipc*.ts` · `.../commercial/` |
| Enrutamiento del canal → superficie comercial | ✅ | ✅ | ✅ | ✅ | ❌ | `.../channel/local-channel-component.ts` · `tests/channel-routing.test.ts` (Windows) |
| Shell Electron (main, preload, allowlist) | ✅ | ✅ | ✅ | ✅ | ❌ | `apps/pos-desktop/src/` |
| Logger estructurado | ✅ | ✅ | ✅ | ✅ | ❌ | `packages/observability/src/` |
| Ancla de confianza local (tabla, lectura y cableado al runtime) | ✅ | ✅ | ✅ | ❌ | ❌ | `MIGRATION_022` · `.../security/sqlite-trust-anchor-store.ts` · `main.ts` — **en rama, no en `main`** |

### Plataforma central

| Capacidad | DOC | MAT | TEST | CANON | PROD | Código en main |
|---|---|---|---|---|---|---|
| PostgreSQL migrations 001/002/003 | ✅ | ✅ | ✅ | ✅ | ❌ | `tools/target-migrations/sql/postgres/` |
| Esquema fiscal (10 tablas `fiscal.*`) | ✅ | ✅ | ❌ | ✅ | ❌ | `003_fiscal_electronic_invoicing_foundation.up.sql` |
| Aplicación central que use ese esquema | ✅ | ❌ | ❌ | ❌ | ❌ | — (`packages/database-postgres/src` vacío) |

### Plano fiscal

| Capacidad | DOC | MAT | TEST | CANON | PROD | Código en main |
|---|---|---|---|---|---|---|
| Cinco puertos por capacidad | ✅ | ✅ | ✅ | ✅ | ❌ | `packages/fiscal-adapters/src/ports/` |
| Declaración tipada de credencial (`D-3`) | ✅ | ✅ | ✅ | ✅ | ❌ | `.../src/credential.ts` |
| Matriz de capacidades y verificación cruzada | ✅ | ✅ | ✅ | ✅ | ❌ | `.../src/capability.ts` · `.../src/adapter-declaration.ts` |
| Escalera de verificación (`D-4`) | ✅ | ✅ | ✅ | ✅ | ❌ | `.../src/verification.ts` |
| Saldo de bolsa como proyección (`D-5`) | ✅ | ✅ | ✅ | ✅ | ❌ | `.../src/quota.ts` |
| Adapter FACTUS (cinco puertos) | ✅ | ✅ | ✅ | ✅ | ❌ | `.../src/factus/` · 2 puertos `SANDBOX_VERIFIED`, 3 `MOCK_TESTED` |
| Tablas de códigos DIAN (parciales, fuente verificada) | ✅ | ✅ | ✅ | ✅ | ❌ | `.../src/dian/codes.ts` · PR #57 |
| Forma canónica del adquiriente (`FiscalCustomer`) | ✅ | ✅ | ✅ | ✅ | ❌ | `.../src/dian/customer.ts` |
| Forma canónica de la línea (`FiscalDocumentItem`) | ✅ | ✅ | ✅ | ✅ | ❌ | `.../src/dian/item.ts` |
| Adapter SIIGO | ✅ | ❌ | ❌ | ❌ | ❌ | — (faltan credenciales de prueba) |
| Adapter ALEGRA | ✅ | ❌ | ❌ | ❌ | ❌ | — (faltan credenciales de prueba) |

> **Qué acredita esta sección y qué no.** Acredita que las cinco formas existen,
> compilan, y que un solo objeto puede satisfacerlas: `port-conformance.test.ts`
> implementa los cinco puertos con un fake determinista. Acredita también que la
> forma admite los **tres** contratos de proveedor, no sólo FACTUS:
> `provider-contracts.test.ts` construye las declaraciones de SIIGO, FACTUS y
> ALEGRA desde `provider-integration-matrix.md` y comprueba que ninguna se
> contradice.
>
> **No acredita compatibilidad con ningún proveedor.** Los tres siguen en
> `NOT_EVALUATED`, y la propia escalera lo impone: un fake determinista tiene
> techo `MOCK_TESTED`, verificado en `verification-and-quota.test.ts`. Ninguna
> línea de este bloque abre una conexión de red.
>
> Comando ejecutado: `pnpm test:fiscal-adapters` — 85 pruebas pasan, 2 omitidas,
> 0 fallos. Cableado en CI como paso «Validate fiscal capability ports».
>
> **Sobre `MOCK_TESTED` del adapter FACTUS.** Las 2 omitidas son la suite de
> sandbox, que sólo corre si están las cuatro variables de entorno y **nunca en
> CI**. El adapter no ha ejecutado ni una petición real: los contract tests
> comprueban que *el adapter* se comporta bien ante una respuesta dada, no que
> el proveedor produzca esa respuesta. La forma exacta del cuerpo de
> `/v2/bills/validate` sigue `UNVERIFIED`. `SANDBOX_VERIFIED` exige ejecutar la
> suite local con credenciales reales y **mover la declaración a mano**, con la
> evidencia observada delante.

> ## Sandbox de FACTUS — VERDE, 2026-09-06
>
> **`pnpm test:fiscal-adapters` con las cuatro variables reales: 103 de 103.**
> Cero omitidas, cero fallos. La suite de sandbox salió a
> `api-sandbox.factus.com.co` y pasó.
>
> | Puerto | Nivel | Evidencia observada |
> |---|---|---|
> | `FISCAL_CONFIGURATION_VALIDATION` | **`SANDBOX_VERIFIED`** | OAuth2 password grant real; `validateConfiguration` → `VALID` |
> | `NUMBERING_RANGE` | **`SANDBOX_VERIFIED`** | rangos reales con `id` de FACTUS, autoridad `PROVIDER`, vigencia declarada |
> | `DOCUMENT_ISSUANCE` | `MOCK_TESTED` | **ni un documento emitido** |
> | `DOCUMENT_STATUS_QUERY` | `MOCK_TESTED` | sin documento que consultar |
> | `DOCUMENT_ARTIFACT` | `MOCK_TESTED` | sin documento del que bajar XML o PDF |
>
> **El adapter como conjunto sigue en `MOCK_TESTED`**, porque no vale más que su
> puerto peor verificado, y `commerciallyClaimableDocumentTypes` devuelve lista
> vacía: afirmar «facturamos con FACTUS» es una afirmación sobre **emitir**, y
> emitir no se ha ejecutado.
>
> Los tres `MOCK_TESTED` no lo están por falta de ganas: emitir exige
> `Customer`, tablas de códigos DIAN, `Catalog` y `Tax`, y ninguna existe
> (`D-9`). **El bloqueo es nuestro, no de FACTUS.**
>
> Esta evidencia obligó a un cambio de tipo: `verification` pasó de un escalar
> por adapter a un nivel **por puerto**. Con un escalar único había que elegir
> entre subestimar dos puertos verificados o **sobreafirmar la emisión fiscal**,
> y lo segundo es exactamente lo que este proyecto no admite.
>
> ### Cómo se llegó, en cinco rondas
>
> **Ejecución real contra el sandbox de FACTUS — 2026-09-06.** El propietario
> ejecutó la suite local con credenciales V2 reales. Resultado observado:
> **86 pasan, 1 falla** de 87.
>
> | Comprobación | Resultado |
> |---|---|
> | `POST /oauth/token`, `grant_type=password`, cuatro valores | **PASS** — 962 ms |
> | Forma de la respuesta de token (`access_token`, `token_type`, `expires_in`, `refresh_token`) | **PASS** — parseó sin relajar el esquema |
> | `validateConfiguration` contra el proveedor real | **PASS** — `VALID` |
> | `GET /v2/numbering-ranges/dian` | HTTP 200; falló el parseo, **corregido con la forma observada** |
>
> La autenticación pasa de supuesta a verificada. El adapter completo **no**.
>
> **Cómo se diagnosticó, en tres rondas.** La primera decía sólo `UNAVAILABLE`,
> porque el aserto descartaba el `reasonCode` —defecto de la prueba, no del
> adapter—. Corregido el aserto, la segunda dijo `UNPARSEABLE_RESPONSE`, lo que
> descartó tres causas de cuatro: hubo **HTTP 200**, luego ruta y Bearer eran
> correctos. La tercera imprimió la forma del cuerpo, sólo nombres de campo:
>
> ```
> TOP KEYS   : data, message, status
> data TYPE  : Object[]
> ITEM KEYS  : end_date, from, prefix, resolution_number, start_date,
>              technical_key, to
> ```
>
> **Primer diagnóstico, incompleto:** «el esquema exigía un `id` que FACTUS no
> devuelve». Era el síntoma. La documentación oficial de emisión, aportada
> después, dio la causa: **`/v2/numbering-ranges` y `/v2/numbering-ranges/dian`
> son recursos distintos**. El primero devuelve los rangos de FACTUS con su
> `id` —el `numbering_range_id` que exige emitir—; el segundo, las resoluciones
> DIAN en crudo. El adapter apuntaba al segundo pidiendo la forma del primero.
>
> **Cerrado en la cuarta ronda.** El motivo autodescriptivo devolvió la forma en
> la propia ejecución, sin otra vuelta contra el proveedor:
>
> ```
> UNPARSEABLE_RESPONSE(shape={status,message,data{data[{id,document,prefix,from,
>   to,current,resolution_number,start_date,end_date,technical_key,is_expired,
>   is_active,…}],pagination{total,per_page,current_page,last_page,from,to,links[…]}}})
> ```
>
> Son **dos formas distintas**, y confundirlas fue la causa de todo:
> `/v2/numbering-ranges` devuelve una colección **paginada** —`data.data[]` con
> `pagination`— y `/v2/numbering-ranges/dian` un array **plano** —`data[]`—. El
> esquema acepta ahora ambas, y hay una prueba por cada una.
>
> La forma real trajo además cuatro campos que no se conocían: `current`
> (consecutivo alcanzado), `document` (código de tipo documental del proveedor),
> `is_active` e `is_expired`.
>
> Tres decisiones que deja el hallazgo:
>
> - **La vigencia declarada por el proveedor manda** sobre nuestra aritmética de
>   fechas. Él conoce su calendario y sus reglas de habilitación; nosotros sólo
>   teníamos dos cadenas. Un rango dentro de fechas pero marcado caducado está
>   caducado.
> - `document` se conserva **en crudo, sin traducir**. Traducirlo a
>   `FiscalDocumentType` exige la tabla de códigos DIAN, que no existe (`D-9`).
>   Inventar la correspondencia sería el mismo error que ya costó tres rondas.
> - `technical_key` es la llave técnica DIAN e interviene en el cálculo del CUFE.
>   Se reconoce para no romper el parseo pero **no se propaga** al snapshot:
>   llevarla al núcleo es una decisión de seguridad propia, no un efecto
>   colateral de sincronizar rangos. Hay una prueba que lo fija.
>
> La declaración se mantiene en `MOCK_TESTED` hasta que la ejecución local
> confirme el verde.

> **Tablas de códigos DIAN — primer trozo de `D-9`, 2026-09-06.**
> `packages/fiscal-adapters/src/dian/codes.ts`. Once tablas con **sólo códigos
> de fuente verificada**: tipo documental, tipo de operación, documento de
> identificación, naturaleza jurídica, tributo, responsabilidad fiscal, unidad
> de medida, estándar de producto, impuesto, forma y método de pago. Fuente
> única hoy: la documentación oficial de emisión de FACTUS aportada por el
> propietario — `VERIFICADO_DOC`.
>
> **Son parciales y lo dicen.** Cubren lo que la documentación ejemplifica, no
> el catálogo DIAN completo. Toda consulta devuelve `null` para un código no
> listado, y `null` significa «no lo sé», nunca «no existe» ni un valor por
> defecto.
>
> Sólo se traduce `"01" → SALES_INVOICE`. Notas crédito y débito, documento
> soporte y su nota de ajuste **no se traducen**: su código DIAN no está
> verificado, e inventarlo emitiría bajo el tipo equivocado —un error fiscal,
> no de programa—.
>
> Habilita `selectRangesForDocumentType`, que reparte los rangos del proveedor
> entre los que corresponden al tipo y los que **no se pueden clasificar**,
> devolviendo ambas listas: descartar en silencio lo desconocido escondería que
> el catálogo está incompleto.

> **Adquiriente — segunda pieza de `D-9`, 2026-09-07.**
>
> Tres capas y una sola forma del dato. `FiscalCustomer` vive en el paquete
> fiscal, junto a las tablas DIAN contra las que se valida;
> `customers_customers` guarda **exactamente** esa forma; y el canal la expone
> con `customer.register`, `customer.get` y `customer.find`. **No hay un segundo
> modelo de cliente**: dos formas del mismo tercero acabarían discrepando, y la
> que discrepe al emitir es la que va en el documento fiscal.
>
> **Las reglas del adquiriente son restricciones de almacenamiento, no sólo de
> validación.** `MIGRATION_012` impone en disco lo que `validateFiscalCustomer`
> comprueba en memoria: identificación sólo dígitos —la documentación es
> taxativa en que viaja sin DV—, DV de un solo dígito, razón social obligatoria
> para persona jurídica y nombres para persona natural, y responsabilidades
> fiscales como array JSON. No es duplicación: el validador informa a un
> operador con hallazgos que puede corregir; la restricción impide que la fila
> exista venga de donde venga.
>
> **Auditoría y outbox no llevan lo mismo, y es deliberado.** El rastro registra
> qué se hizo —tipo documental y naturaleza jurídica— y **no** la
> identificación, el correo, el teléfono ni la dirección. El outbox sí lleva la
> identidad completa, porque el central necesita el tercero para poder emitir.
> Son dos destinos con dos necesidades distintas. Hay una prueba por cada uno.
>
> **Defecto encontrado y corregido en el camino:** el contrato IPC usaba
> `StableCodeSchema` para los códigos DIAN, y ese esquema exige empezar por
> mayúscula. Habría rechazado en la frontera `"31"`, `"13"` y `"1"` —casi todo
> el catálogo verificado— y sólo se habría visto al llegar la primera petición
> real. Lo destapó la prueba de extremo a extremo, no la revisión.
>
> Comandos ejecutados: `pnpm typecheck` PASS · `pnpm test:contracts` 225 ·
> `pnpm test:runtime` 369+4 omitidas · `pnpm test:fiscal-adapters` 141+2 ·
> `pnpm architecture:check` PASS · `pnpm ci:repository-policy` PASS.

> **El impuesto deja de ser cero — 2026-09-07.**
>
> `calculateSaleLine` devolvía `taxUnits: 0n` fijo, con el comentario literal
> «SANDBOX Tax EXCLUDED: siempre 0». Ahora la tasa viene de
> `catalog_fiscal_attribute` (`MIGRATION_013`) y el impuesto se calcula por
> línea, en `BigInt`, sin coma flotante.
>
> **El impuesto es por línea, no por venta.** El snapshot de la venta declaraba
> una tasa única —`category: "EXCLUDED", rate: "0.000000"`—, y eso era falso en
> cuanto una factura tuviera dos tipos impositivos. Ahora la venta sólo declara
> **cuántas líneas quedaron sin atributos fiscales**, que es lo que impide
> facturarla.
>
> **Y un cero sin atributos no dice «exento».** El snapshot de línea tiene dos
> formas: `RATE_APPLIED`, que afirma qué tasa se aplicó, y
> `NO_FISCAL_ATTRIBUTES`, que afirma que el cero es **desconocimiento**. Emitir
> desde una línea de la segunda forma declararía exento algo que nadie ha
> declarado exento.
>
> La tabla lleva la restricción de `D-14` **en disco**: una tasa con más de dos
> decimales significativos no se puede guardar. En los importes el problema se
> descubre al emitir; en la tasa se puede impedir desde el origen porque una
> tasa DIAN no tiene más de dos decimales.

> **Una sola aritmética de dinero — 2026-09-07.**
>
> Había **tres** implementaciones de `scale6ToBigInt` en la misma aplicación
> —`sales/sale-calculation.ts`, `payments/money.ts` y
> `cash/sqlite-cash-shift-store.ts`— y **no se comportaban igual**. Medido antes
> de tocar nada:
>
> ```
> "18000.000000"   estricta=18000000000   laxa=18000000000   IGUAL
> "18000.5"        estricta=THROWS        laxa=18000500000   DIVERGEN
> "18000"          estricta=THROWS        laxa=18000000000   DIVERGEN
> "18000.1234567"  estricta=THROWS        laxa=18000123456   DIVERGEN
> ```
>
> Cuatro de cinco casos. Es «dos verdades sobre el mismo importe» dentro de una
> misma venta y su cobro. Unificadas en `src/money.ts` con la versión
> **estricta**: una cadena que no tiene la forma canónica es un defecto, no un
> dato que haya que adivinar.
>
> **Y se corrigió un defecto latente que la unificación destapó.** La versión
> estricta rechazaba el negativo, y `commercial_rounding_adjustment` es el único
> campo firmado del esquema: su `CHECK` tiene una rama `OR` explícita para
> `-[0-9]*.[0-9]{6}`. `bigIntToScale6` emite ese valor, la base lo guarda, y
> **leerlo de vuelta lanzaba**. La prueba que exigía ese fallo codificaba el
> defecto; ahora hay un invariante de ida y vuelta en su lugar.

### CI/CD y cadena de suministro

| Capacidad | DOC | MAT | TEST | CANON | PROD | Código en main |
|---|---|---|---|---|---|---|
| Validación TARGET (5 jobs) | ✅ | ✅ | ✅ | ✅ | ❌ | `.github/workflows/target-foundation-validation.yml` |
| CodeQL SAST | ✅ | ✅ | ✅ | ✅ | ❌ | `.github/workflows/codeql-sast.yml` |
| SBOM · licencias · vulnerabilidades · provenance | ✅ | ✅ | ✅ | ✅ | ❌ | `tools/ci/` |
| Strix (pentest AI) | ✅ | ✅ | ❌ | ✅ | ❌ | `.github/workflows/security.yml` — sin `STRIX_LLM`/`LLM_API_KEY` |

### Materializado pero no conectado al runtime

Existe código probado que **`main.ts` nunca instancia**. No es trabajo
pendiente: es trabajo hecho y desconectado.

| Capacidad | Código en main | Evidencia de desconexión |
|---|---|---|
| Ciclo de seguridad local (DPAPI, identidad de dispositivo, licencia) | `.../src/security/` | `LocalSecurityLifecycle` solo se instancia en `tests/security.test.ts` |
| Adquisición de snapshot de autorización (SAS-003) | `.../authorization/snapshot-acquisition.ts` | cero referencias fuera del propio archivo **y de sus pruebas**. Sigue desconectada, y no por olvido: `SnapshotProvider` no tiene implementación productiva porque el transporte HTTP hacia la API central no existe (`D-2`). Cablearla exigiría inventar el proveedor |
| Esquema fiscal central | `003_*.up.sql` | ningún consumidor |

> **El mapa de claves de firma deja de estar vacío por construcción — 2026-09-19.**
>
> `main.ts` construía `CommercialComponent` con `new Map()` **literal**. La
> consecuencia no era teórica y no estaba registrada en ninguna parte:
> `session.activate` rechazaba toda SSA porque ninguna `key_id` podía existir
> en un mapa vacío, y sin vínculo de sesión el resto de la superficie quedaba
> detrás de `SESSION_NOT_BOUND`. **Veinticinco operaciones ruteadas, ninguna
> alcanzable.**
>
> `MIGRATION_022` crea `local_trust_anchor` —`(purpose, key_id)` como clave
> primaria, `WITHOUT ROWID`, `STRICT`, `status` en `ACTIVE`/`VERIFY_ONLY`/
> `REVOKED` con `revoked_at` atado por `CHECK`—, `SqliteTrustAnchorStore` la
> lee, `LocalSecurityComponent` la abre en el arranque y `main.ts` pasa
> `() => security.trustAnchors.keysFor("SESSION_ASSERTION")`. La forma es
> perezosa porque los componentes se construyen todos antes de que arranque
> ninguno: leer el ancla en el constructor tocaría una base de datos aún
> cerrada.
>
> **Autorización de la tabla.** `DEC-011` §«Qué queda fuera de alcance» reserva
> «cualquier tabla o migración» a una autorización específica. La de
> `MIGRATION_022` es la del propietario del repositorio, dada en esta sesión de
> forma explícita. Queda anotado aquí porque el ADR exige que se anote, no
> porque el ADR la conceda.
>
> **Qué NO cambia, y es lo que más importa no malinterpretar.** El ancla nace
> vacía y nadie la puebla: no hay emisor, `DEC-011` mantiene el material de
> producción `BLOCKED` y prohíbe autofirmados como sustituto. Un equipo real
> sigue arrancando sin confianza y sigue fallando cerrado. Lo que se cerró es
> **la ausencia de origen**, no la ausencia de emisor (`D-28`).
>
> **Evidencia ejecutada.** `tests/trust-anchor-chain.test.ts`, 10 de 10, contra
> SQLite real y los casos de uso reales:
> `pnpm --filter @pos-platform/pos-local-service test` → **710 pasan, 4 saltadas
> (Windows), 0 fallan**. La prueba central provisiona anclas generadas para el
> test, adquiere el snapshot por la ruta canónica de `SAS-003`
> —proveedor → verificador → store, sin llamar a `activate` a mano— y recorre
> `session.activate` → `cash.shift.open` → `catalog.product.register` →
> `inventory.stock.receive` → `sale.create` → `payment.register.cash`,
> comprobando en disco `sales_sales.status = 'COMPLETED'` y la existencia en
> 10 tras vender 2 de 12. También se prueban la separación por propósito (la
> clave de sesión **no** verifica un snapshot), `REVOKED` frente a
> `VERIFY_ONLY`, y que una fila con material ilegible se descarta sin tumbar
> el arranque.
>
> **`usableCount` cuenta claves legibles, no filas.** El log de arranque
> `security.trust_anchors` emite el recuento por propósito y nunca una
> `key_id`: un operador que lee `session_assertion: 0` sabe por qué el POS
> rechaza cada sesión.

> **Bloque 02 — runtime Windows, estado parcial (2026-09-19).**
>
> Bloque 02 parcialmente verificado. Runtime, restart y persistence demostrados
> en Linux/POSIX. Evidencia física Windows pendiente: Named Pipe/DACL, DPAPI,
> IPC routing y Windows runtime. GitHub Actions Windows runner actualmente no
> disponible. La ausencia de esta evidencia no implica fallo del código
> Windows.
>
> Lo demostrado y ejecutado: `runtime-restart-persistence.test.ts` recorre dos
> procesos distintos sobre la misma base —venta cobrada y `COMPLETED` en el
> primero, leída íntegra y sin duplicar en el segundo—, y `real-channel.spec.ts`
> conduce Electron real contra servicio real. El job `runtime-windows`
> (`windows-2022`) existe en `target-foundation-validation.yml:302` y ejecuta
> los cuatro `windowsIt`; el run 35463020908 sobre `fb8dacf` terminó con
> `billable.WINDOWS.total_ms: 0` y sin runner asignado, igual que los ~20 runs
> anteriores en dos workflows distintos, incluidos los de `main`.
>
> **Ningún commit de `main` ha sido validado por CI desde al menos el
> 2026-09-16.**

> **Semántica operativa del outbox, fijada por prueba — 2026-09-19.**
>
> Tres propiedades del código ya integrado que ninguna prueba sostenía, y que
> deciden si un comercio pierde ventas. Ninguna exigió decidir nada:
>
> 1. **Atomicidad.** El asiento de outbox vive en la transacción del negocio —
>    `sqlite-sale-store.ts` lo escribe como paso 7 dentro del mismo
>    `transaction()`—, de modo que una venta revertida no deja un evento
>    huérfano anunciando al central una venta que nunca existió.
> 2. **Una dead letter detiene toda la cola detrás de ella.** `claimBatch`
>    exige `local_sequence` contigua desde el checkpoint; operaciones sanas y
>    `PENDING` situadas detrás **no se envían**, el bloqueo **sobrevive al
>    reinicio** —`recoverInterruptedDispatches` sólo rescata `IN_FLIGHT`— y la
>    única salida es `requeueDeadLetter`, la revisión manual de `UC-SYNC-003`.
>    Es correcto según `DEC-007`, que no admite reordenar, y es la diferencia
>    entre «hay un evento atascado» y «desde ayer no sube ni una venta».
> 3. **Un fallo de transporte no pierde nada:** el payload sobrevive byte a
>    byte al fallo y al reinicio, y agotar los intentos deja dead letter con su
>    motivo y sus intentos, no un borrado.
>
> Evidencia: `tests/sync-outbox-semantics.test.ts`, 6/6.
>
> **Cerrado el 2026-09-20:** la propiedad 2 ya no es sólo probada, es
> **observable**. `SyncHealthReader` materializa las señales de
> `UC-SYNC-003` §Observabilidad —`outbox_depth`, `oldest_pending_age_ms`,
> `checkpoint_lag`, el desglose por estado local y los veredictos recibidos,
> segmentados por scope— y `main.ts` las emite en el arranque como
> `sync.health`. Con la cola bloqueada por una dead letter durante un día, las
> tres crecen y no vuelven a bajar solas; liberar la cabeza de línea las
> devuelve a cero. Evidencia: `tests/sync-health.test.ts` 7/7 y el log real
> del runtime.
>
> **Dos señales de esa lista siguen sin medirse, y no por omisión.**
> `review_required` y `waiting_for_dependency` no tienen representación en el
> `CHECK` de `local_sync_outbox.status` —cinco estados— así que se cuentan
> como **veredictos recibidos** sobre el inbox, que es lo que de verdad
> existe, y no como estado local. `clock_offset` exige una hora central de
> referencia que no hay: `TrustedClockGuard` sólo impide el retroceso del
> reloj local.
>
> **La cadencia de muestreo no se inventó.** Se emite una vez en el arranque
> porque el intervalo es parte de la política técnica versionada que
> `DEC-007` §1300 exige y que sigue sin existir (`D-2`).

> **`ONB-002` — el bootstrap transaccional de tenant, materializado (2026-09-20).**
>
> Primera pieza de aplicación del plano **central**. `UC-ONB-001` §374 definía
> la frontera transaccional desde hacía tiempo y el esquema de
> `001_central_foundation` ya tenía todas las tablas; lo que faltaba era el
> código que las coordinara. Vive en `packages/database-postgres/src/`, que
> hasta hoy estaba vacío (`D-4`).
>
> Una sola transacción persiste: operación de onboarding con su
> `idempotency_key` → usuario propietario (resuelto o creado) → `Tenant` →
> `Company` → `Branch` → `TenantMembership` OWNER → `UserRoleAssignment` →
> siete asientos de auditoría → `sync_operations` + `outbox_entries` →
> resultado idempotente.
>
> **La idempotencia es física, no una comprobación previa.** La primera
> sentencia es un `INSERT … ON CONFLICT ON CONSTRAINT
> onboarding_operations_identity_uq DO NOTHING`: el perdedor de una carrera no
> crea nada y lee el resultado del ganador. Probado con dos ejecuciones
> concurrentes reales sobre el mismo servidor.
>
> **Estado terminal `READY_FOR_LICENSE`, nunca `COMPLETED`.** `UC-ONB-001`
> §374 regla 6 prohíbe simular una transacción distribuida: la licencia la
> emite otra autoridad, después. No se crea licencia ni dispositivo.
>
> **Tres defectos propios los encontró el esquema, no yo.** `audit_events.operation_id`
> referencia `sync.sync_operations`, así que un onboarding no puede ocuparlo;
> `outbox_entries` exige que la entrada cuelgue de una `sync_operations`,
> escrita primero; y `tenant_memberships_primary_active_uq` admite **una sola**
> pertenencia primaria activa por usuario, de modo que `is_primary` se deriva
> en vez de fijarse —un mismo dueño con dos comercios es el caso normal—.
>
> **La auditoría central es append-only con guarda de fila *y* de TRUNCATE**
> (`audit.reject_append_only_mutation`), más estricta de lo que suponía la
> primera versión de la prueba. Por eso la suite no limpia entre casos: cada
> prueba trae su propia identidad y toda aserción está acotada a su tenant o
> a su correlación. El sello `payload_checksum` se calcula en el servidor
> sobre el `jsonb` ya normalizado, así que puede re-derivarse desde la fila
> con `sha256(new_value::text)`; calcularlo en el cliente sobre el texto
> enviado habría producido un número imposible de verificar.
>
> Evidencia: `packages/database-postgres/tests/initialize-tenant.test.ts`,
> **16/16 contra PostgreSQL 16.13 real**, aplicando `bootstrap.sql` +
> `001_central_foundation.up.sql` sobre un servidor vivo. Sin dobles de base
> de datos.

> **Crédito y QR eran inalcanzables desde el producto — corregido 2026-09-20.**
>
> `DEC-005` quedó **completo en el servicio local** —caso de uso, store,
> handler, esquema IPC y pruebas— y **el cajero no podía invocarlo de ninguna
> forma**: sus cuatro canales nunca se añadieron a `ipc-allowlist.ts` ni a
> `preload-api.ts`, y `payment.register.qr` tampoco. Cinco operaciones
> ratificadas por `IpcMessageTypeSchema`, ruteadas por el servicio, ausentes
> de la superficie del Desktop.
>
> **Por qué ninguna prueba lo vio, que es lo que más importa del hallazgo.**
> Había **tres listas fijadas a mano** —`ipc-allowlist.test.ts`,
> `preload-api.test.ts` y `preload.test.ts`— y las tres se comparaban entre
> sí: la allowlist contra sí misma, el preload contra la allowlist. Todas
> pasaban en verde mientras estuvieran igual de incompletas. Faltaba la
> comparación contra la única fuente que sabe qué operaciones existen: el
> contrato.
>
> `tests/ipc-surface-parity.test.ts` cierra ese hueco: deriva de
> `IpcMessageTypeSchema` y exige que toda operación esté expuesta salvo
> `runtime.handshake`, excluida con razón escrita —negocia protocolo entre el
> proceso principal y el servicio, el renderer no participa—. Añadir un tipo
> al contrato sin exponerlo ni excluirlo deliberadamente rompe la prueba.
>
> `payment.register.qr` se expone aunque el equipo no tenga credencial: el
> servicio responde `PROVIDER_NOT_CONFIGURED`, una negativa tipada. Ocultar el
> canal convertiría esa negativa en «la operación no existe», peor diagnóstico
> para el cajero.
>
> **Lo que esto no da todavía:** alcanzabilidad no es pantalla. El transporte
> está completo de extremo a extremo —verificado en el Electron real, donde
> `window.posService` ya expone los cinco métodos— pero el renderer no tiene
> panel de crédito. Ésa es la pieza siguiente.
>
> Evidencia: desktop 129/129 · E2E 8/8 contra Electron y servicio reales.

> **El panel de crédito, y el eslabón que faltaba para fiar — 2026-09-20.**
>
> El bloque anterior dejó las cinco operaciones de `DEC-005` ruteadas hasta el
> servicio y anotó que **alcanzabilidad no es pantalla**. `CreditPanel` es esa
> pantalla: abrir cuenta, consultarla, fiar una venta y registrar un abono.
>
> **Construirlo destapó que fiar seguía siendo imposible desde el producto.**
> `SqlitePaymentStore.register` rechaza con `CUSTOMER_REQUIRED` toda venta con
> `customer_id` nulo, y una venta **no admite adquiriente después de creada**.
> `SalePanel` nunca había enviado `customer_id` —el contrato lo acepta desde
> `sale.create` y el servicio lo resuelve bajo el `tenant` del contexto
> verificado—, así que toda venta nacida en la pantalla era incobrable a
> crédito. Un panel de crédito completo sobre esa base habría podido abrir
> cuentas y recibir abonos sin poder fiar ni una sola venta.
>
> El arreglo es el mínimo: `createSale(customerId?)` y un campo opcional en
> `SalePanel`. La venta de mostrador sigue yendo sin adquiriente —`null`
> explícito, no ausente— y dos pruebas fijan ambos casos contra
> `SaleCreateRequestSchema`.
>
> **Nombrar al cliente no es aportar ámbito**, y el panel no lo confunde:
> ningún sobre lleva `tenant_id`. El límite de cupo se muestra pero no se
> negocia —`CREDIT_LIMIT_EXCEEDED` es rechazo duro sin override, y lo único
> que se pinta es cuánto quedaba, para cobrar la diferencia por otro medio—.
>
> El arnés E2E recibió las cuatro facultades de `DEC-005`, que son distintas
> entre sí a propósito: autorizar una venta fiada no es abrir una cuenta ni
> recibir un abono.
>
> **Lo que esto no da todavía:** no hay reverso. Fiar por error se deshace con
> un abono, que no es lo mismo —deja los dos hechos en el libro—. El reverso
> sigue en **D-22**, sin decidir.
>
> Evidencia: desktop **141/141** (17 ficheros) · `test:runtime` completo ·
> contracts 244/244 · `typecheck` 10/10 · `architecture:check` 16/16 ·
> `ci:repository-policy` PASS · **E2E 10/10** contra Electron compilado y
> servicio real por socket, incluido el ciclo entero de crédito: alta del
> cliente → apertura de cuenta → venta a su nombre → cobro a crédito
> (`COMPLETED`) → abono en efectivo, contrastando cada cifra contra
> `credit.account.get`.

> **La sesión no tenía pantalla, y sin ella el equipo real no arranca — 2026-09-20.**
>
> `session.activate` y `session.recover` estaban ruteados por el puente desde
> `f342f05` y **nada en el producto los llamaba**: ni un panel ni el proceso
> principal (`grep` sobre `apps/pos-desktop/src/` y `renderer/src/`: cero
> invocaciones). Tres consecuencias, todas de instalación real:
>
> 1. La ventana abría **sin vínculo de sesión**, y entonces cada operación
>    comercial se rechazaba con `SESSION_NOT_BOUND` mostrando un error genérico.
> 2. El servicio **sí** persiste la sesión, pero nadie la recuperaba al
>    arrancar: el equipo que ayer funcionaba amanecía muerto.
> 3. `offline_valid_until` no era visible en ninguna parte, y es el dato que
>    dice hasta cuándo se puede seguir vendiendo sin Internet (`DEC-011`).
>
> `SessionPanel` consulta `session.recover` al montar y muestra los tres
> desenlaces por separado. `NONE` y `UNVERIFIABLE` no son el mismo problema:
> uno pide activar el equipo, el otro pide mirar por qué la sesión almacenada
> no se puede verificar, y el panel nombra la causa que emite el servicio
> (`AMBIGUOUS_DEVICE_SESSION`) sin interpretarla.
>
> **Recuperar no es autenticar.** `session.recover` no lleva payload: no
> presenta credencial ni SSA. El servicio resuelve la sesión por el
> `installation_id`/`device_id` de la configuración local —nunca por algo que
> mande el llamador— y revincula la conexión. Es enteramente local y no
> consulta ninguna autoridad central, que es lo que lo hace alcanzable hoy.
>
> **No hay botón de activar, y es deliberado.** `session.activate` exige una
> SSA firmada por la autoridad emisora (`DEC-011`), que este repositorio no
> tiene —**D-28**—. Un formulario que fabricase una SSA no sería un login:
> sería una credencial inventada, y el servicio la rechazaría con
> `SIGNATURE_INVALID`. Una prueba fija esa ausencia para que nadie la añada por
> descuido. **Un equipo recién instalado sigue sin poder obtener su primera
> sesión**: eso no lo resuelve este bloque y no lo resuelve ningún bloque
> mientras D-28 siga abierta.
>
> **Hallazgo colateral: el doble de `App.test.tsx` fijaba tres métodos a mano.**
> Cuando el panel empezó a consultar al montar, el doble no tenía
> `session.recover`, la llamada reventaba, el panel degradaba a error y **la
> suite seguía en verde** porque ninguna aserción lo miraba —comprobado
> ejecutándolo, no supuesto—. Es la misma deriva de listas fijadas a mano que
> dejó la superficie comercial inalcanzable durante tres bloques. El doble se
> deriva ahora de `RENDERER_API_METHODS`.
>
> Evidencia: desktop **151/151** (18 ficheros) · contracts 244/244 ·
> `typecheck` 10/10 · `architecture:check` 16/16 · `ci:repository-policy` PASS
> (620 ficheros) · `test:runtime` completo, con los **4 tests Windows-gated
> preexistentes en `skip`** (`windowsIt`; no cuentan como PASS) · **E2E 12/12**
> contra Electron compilado y servicio real por socket. La prueba de sesión
> comprueba primero que al montar la pantalla mostraba `NONE` de verdad y sólo
> después que la recuperación la pone `ACTIVE`: sin esa primera aserción
> habría pasado igual con un botón que no hiciera nada.
>
> **Superficie restante sin pantalla**, tras este bloque: `session.activate`
> (bloqueada por D-28), `payment.register.qr` y `payment.cancel` (alcanzables
> por el puente, sin panel), `catalog.item.get` (`catalog.item.find` sí lo
> tiene). `runtime.handshake` queda excluida con razón escrita.

> **QR y cancelación de pago — las dos últimas operaciones de pago sin
> pantalla, 2026-09-20.**
>
> `payment.register.qr` y `payment.cancel` estaban ruteadas por el puente y sin
> panel. `ProviderPaymentPanel` las cubre junto con la lectura de estado, que es
> lo que las une: un cobro que nadie completa deja la venta con un componente
> pendiente, y alguien tiene que poder soltarlo.
>
> **Tres distinciones que la pantalla podía borrar y no borra.**
> *Pendiente no es cobrado*: `payment.register.qr` crea un `Payment` PENDING y
> la aprobación llega después por otra vía, así que el panel no declara cobrada
> ninguna venta al registrar el intent —`PaymentProviderPort` lo dice sin
> rodeos: una imagen QR no es evidencia financiera—.
> *Sin proveedor no es fallo*: `PROVIDER_NOT_CONFIGURED` es el estado real de
> toda instalación sin adquiriente y se muestra como tal; ocultar el botón
> convertiría esa negativa en «la operación no existe».
> *No cancelable no es error*: un pago confirmado es inmutable (`DEC-002`) y
> deshacerlo es una operación compensatoria que V1 no implementa —**D-22**—.
>
> `provider_reference` y `checkout_url` llegan del servicio y el renderer no los
> construye: `DEC-016` §21 reserva la referencia comercial a la capa de
> aplicación. Una prueba comprueba que el payload enviado contiene sólo
> `sale_id` y `amount`, de modo que no pudieron salir de la pantalla.
> `expected_version` sale siempre de una lectura previa: el botón de cancelar
> está cerrado mientras no haya una, porque es control optimista y no un
> contador propio.
>
> **Dos correcciones que vinieron de ejecutar, no de razonar.**
> Primero: supuse que cancelar un pago ya cancelado devolvía
> `PAYMENT_NOT_CANCELLABLE`. `sqlite-payment-store.ts:1307` devuelve
> `IDEMPOTENT` —el pago ya estaba cancelado, que es el mismo hecho—. El código
> tenía razón y la prueba no; y eso destapó un fallo de modelado propio: el
> panel pintaba `IDEMPOTENT` como rechazo, haciendo dudar de una cancelación que
> sí ocurrió. Corregido.
> Segundo: una relectura de `payment.get` parecía devolver `CREATED` tras
> cancelar, lo que habría sido un defecto grave del servicio. No lo era: era una
> carrera de la prueba —`payment-found` no desaparece entre lecturas, así que
> esperar su visibilidad no espera a la respuesta nueva—. Con una aserción que
> reintenta sobre el texto, el servicio deja el pago en `CANCELLED`, como debe.
>
> **El adaptador Wompi no queda ejercido por esta evidencia.** El E2E prueba el
> único desenlace de QR que este equipo puede producir de verdad
> (`PROVIDER_NOT_CONFIGURED`), sin proveedor configurado y sin doble. El camino
> feliz —intent, referencia, checkout, aprobación— sigue
> **`REQUIRES_LOCAL_VERIFICATION`**: exige credenciales de sandbox reales, que
> este entorno no tiene y que no se inventan. La cancelación, en cambio, se
> prueba entera contra el servicio real sobre una transferencia reportada y sin
> atestiguar, que es exactamente un pago pendiente cancelable y no necesita
> proveedor; y `PAYMENT_NOT_CANCELLABLE` se prueba sobre un pago **confirmado**
> de verdad, que es lo único que esa regla protege.
>
> Evidencia: desktop **164/164** (19 ficheros) · contracts 244/244 ·
> `typecheck` 10/10 · `architecture:check` 16/16 · `ci:repository-policy` PASS
> (623 ficheros) · `test:runtime` completo, con los **4 tests Windows-gated
> preexistentes en `skip`** (no cuentan como PASS) · **E2E 14/14** contra
> Electron compilado y servicio real por socket.
>
> **Superficie restante sin pantalla**: `session.activate` (bloqueada por
> **D-28**) y `catalog.item.get` (`catalog.item.find` sí lo tiene, y comparten
> handler). `runtime.handshake` queda excluida con razón escrita. Con esto, toda
> operación comercial del contrato que este repositorio puede ejercer hoy es
> alcanzable desde la pantalla.

### Documentado, no materializado

Ninguna de estas capacidades tiene código en `main`, **independientemente de lo
que declare el backlog**. `main` es la única referencia de esta tabla: `Catalog`,
`Inventory` y el dominio de `Payment` sí tienen código, pero en el linaje
preservado que documenta la sección siguiente, no en `main`.

| Capacidad | Backlog dice | Realidad en código |
|---|---|---|
| Pricing | `PRICE-001/002 = DONE` | solo `sandbox_price_rule` |
| Tax | `TAX-001/002/003 = DONE` | `tax_snapshot` es TEXT congelado; sin motor |
| SaleReturn, notas crédito/débito | documentado | — |
| API central | documentado | — (`apps/` solo tiene 2 aplicaciones) |
| Transporte local↔central | documentado | — (sin cliente HTTP saliente) |
| Adapters de proveedor fiscal | documentado | puertos y declaración en `packages/fiscal-adapters/`; **ningún adapter** |
| Contingencia y reconciliación fiscal ejecutables | documentado | — |
| Instalador NSIS y firma de código | `DEC-010` | — (`electron-builder` ausente del lockfile) |
| Periféricos POS | documentado | — |
| E2E Playwright | configurado | `apps/pos-desktop/e2e/` sin un solo spec |
| `SEC-G01..G10` | `PLANNED` | — |

> **Auditoría de conformidad con el stack, 2026-09-07.** Se contrastó punto por
> punto la lámina «STACK OBJETIVO DEFINIDO» contra el árbol real:
> [`stack-conformance-audit.md`](./stack-conformance-audit.md). **Conformidad
> global 54 %** sobre 91 puntos de stack.
>
> Lo que el barrido devolvió en **cero**: PWA, backend central (NestJS y Fastify
> incluidos), Docker, object storage, workers, infraestructura portable,
> OpenTelemetry, Testcontainers, k6, **linter**, y los ocho puntos de hardware.
>
> Y el hallazgo que más pesa: **administración y roles al 20 %**. Hay 14 roles y
> 126 permisos atómicos documentados, y **10 permisos implementados, ninguno de
> administración**. No existe tabla de roles —los roles viajan dentro del blob
> firmado que emitiría una plataforma central que no existe—, ni panel de
> administración, ni panel de super-administrador, ni forma de dar de alta un
> usuario o asignarle un rol desde el producto. **ABAC, que la matriz exige de
> forma explícita para toda operación financiera, tiene cero implementación**:
> hoy quien tenga `PAYMENTS_PAYMENT_CANCEL` anula cualquier importe sin segundo
> factor y sin motivo.

> **Auditoría quirúrgica del trabajo propio — 2026-09-07.**
>
> Revisión de todo lo materializado en la sesión buscando contradicciones. Tres
> hallazgos, los tres corregidos en el acto:
>
> 1. **Cifras que se contradecían entre documentos propios.** Esta misma
>    cabecera decía «915 pruebas / 491 archivos» cuando el tablero ya decía 964
>    y 500. Causa: la cifra estaba duplicada en dos sitios y sólo se actualizó
>    uno. Ahora la cabecera no duplica el desglose y remite al tablero.
> 2. **Un pago de cero era válido en el contrato.** Comprobado con sonda. En
>    efectivo asentaría un movimiento de caja de importe cero sin mover la
>    cobertura. Los importes de pago pasan a estrictamente positivos; **la
>    apertura y el conteo de cierre no**, porque una caja sí se abre sin base y
>    se cuenta vacía, y hay prueba que lo fija en los dos sentidos.
> 3. **`D-19`**: los códigos DIAN del atributo fiscal se validan en forma, no en
>    pertenencia.
>
> Lo que se comprobó y **estaba bien**: la numeración de deudas no tiene huecos
> ni duplicados; el `CHECK` de `tax_policy_version` admite el valor nuevo; el
> llamador **no puede fijar el precio** —la línea de venta sólo lleva producto,
> presentación y cantidad—; la suma de los totales de línea sigue coincidiendo
> con el total fiscal tras sumar el impuesto; y las cuatro afirmaciones
> medibles del `README` —107 líneas de renderer, 13 operaciones comerciales, 10
> permisos, 2 puertos `SANDBOX_VERIFIED`— se verificaron una por una.

> **Catálogo real — 2026-09-07.**
>
> `MIGRATION_014` sustituye a `sandbox_catalog_*`, que era fixture poblado sólo
> por pruebas. Trae lo que los diez comercios prioritarios necesitan para vender
> —referencia, presentación con su unidad, código de barras y precio— y **nada
> más**: categorías y variantes no entran porque ningún comercio de la lista
> está bloqueado hoy por no tenerlas.
>
> **`SandboxCatalogStore` se eliminó.** La venta lee el catálogo real y no queda
> ninguna otra lectura del mismo producto: es la misma disciplina que obligó a
> unificar la aritmética del dinero.
>
> Tres restricciones sostienen la caja, y las tres se prueban:
>
> - **Un código de barras identifica una sola presentación.** Si dos productos
>   comparten código, el lector no puede decidir cuál cobrar y el cajero no
>   tiene forma de notarlo. El índice es parcial porque `barcode` admite `NULL`
>   y `NULL` no colisiona con `NULL` — hay prueba de los dos casos.
> - **`unit_precision` entre 0 y 6.** Gobierna qué cantidad se puede vender, y 6
>   es el máximo de la escala del dinero.
> - **Un solo precio activo por presentación.** Dos harían que lo cobrado
>   dependa del orden de lectura.
>
> Un producto desactivado deja de encontrarse aunque su presentación siga en la
> tabla: el artículo se ensambla sobre el producto activo, no sobre la fila.
>
> Auditoría y outbox vuelven a llevar cosas distintas: **el rastro registra la
> referencia y la unidad, no el precio**; el outbox lleva el artículo completo
> porque el central lo necesita.

## Deuda registrada

| # | Deuda | Evidencia | Consecuencia si no se atiende |
|---|---|---|---|
| D-26 | **CERRADA en `feat/security-lifecycle-boot`.** `CustomerReadResultSchema` validaba los cuatro códigos DIAN con `StableCodeSchema` —que exige inicial alfabética— mientras la petición los admitía con `DianCodeSchema`. Los códigos DIAN reales son numéricos (`13` cédula, `31` NIT, `1`/`2` organización legal), de modo que un adquiriente colombiano corriente **se registraba y su lectura mataba el socket**. La asimetría estaba escrita desde hacía tres bloques en un comentario de `channel-commercial-transport.test.ts` —«no se corrige aquí porque tocaría los contratos»— y el fixture se había rellenado con `"CC"`, `"PERSONA_NATURAL"` y `"NO_APLICA"`, valores que ningún catálogo DIAN contiene, para que la prueba pasara. La encontró la primera pantalla que leyó un adquiriente real contra el servicio real | `ipc-commercial.ts` · `channel-commercial-transport.test.ts:96` · E2E `real-channel.spec.ts` | **regla que deja**: una respuesta nunca puede ser más estricta que la petición que la originó, y doblar un fixture para que pase una prueba mantiene vivo el defecto que la prueba existía para ver |
| D-27 | **`sales_sales.customer_id` no tiene integridad referencial estructural.** La convención del esquema es la FK compuesta con el tenant delante, y aquí correspondería `FOREIGN KEY (tenant_id, customer_id) REFERENCES customers_customers(tenant_id, id)`. SQLite no la admite por `ALTER TABLE … ADD COLUMN` —la cláusula `REFERENCES` de `ADD COLUMN` es de una sola columna, y una FK simple a `customers_customers(id)` se acepta al crearla y falla con `foreign key mismatch` en la primera venta real, porque la PK del padre es compuesta—. El rebuild de doce pasos tampoco cabe: `applyMigrations` envuelve cada migración en una transacción, `PRAGMA foreign_keys` es no-op dentro de una, y `sales_sale_items` referencia `sales_sales`. Las tres se comprobaron ejecutándolas. La pertenencia al tenant la garantiza `SqliteSaleStore.create`, dentro de la misma transacción y antes de la primera escritura. Se cierra cuando `sales_sales` se reconstruya por cualquier otro motivo | `MIGRATION_019` · `sqlite-sale-store.ts` · `commercial-core-flow.test.ts` | un escritor futuro que no pase por el caso de uso podría asociar un cliente de otro tenant; hoy el Local Service es el único escritor y no hay segunda puerta |
| D-28 | **El POS sabe verificar una credencial de sesión; nadie la emite.** · **Reformulada el 2026-09-20: la redacción anterior —«el ancla existe y está vacía: nada la puebla en producción»— quedó superada por G1.2 el 2026-09-17.** Sí la puebla: `main.ts:273` provisiona `local_trust_anchor` desde un artefacto de instalador (`POS_SESSION_TRUST_ARTIFACT_PATH`) verificado contra la clave raíz del producto (`POS_SESSION_TRUST_ROOT_PUBLIC_KEY_PEM`), y sólo si el veredicto es `VALID` —un artefacto `INVALID` no borra ni provisiona nada, para que un fichero manipulable no pueda dejar el equipo sin confianza—. Lo que sigue abierto es el otro extremo: **ninguna ruta de producción firma una aserción de sesión (SSA) para un operador**. Medido: `unsignedSessionAssertionBytes` sólo aparece exportada por el verificador y ningún productor la invoca fuera de pruebas; el `SessionTrustKeyIssuer` de Central Authority firma la **publicación de la clave operacional** —el artefacto de arriba—, no la SSA del cajero. Consecuencia sin disimular: un equipo real arranca, levanta el servicio y monta la pantalla, y `session.activate` rechaza toda credencial, de modo que **las 28 operaciones con pantalla siguen sin ser alcanzables**. Es fail-closed correcto, no un defecto, y por eso es deuda y no bug. **Raíz medida el 2026-09-20, y está más abajo de «falta escribir un emisor»:** Central Authority existe y sirve exactamente dos endpoints —`GET /v1/session-trust` (publica la clave operacional) y `POST /v1/device-enrollment` (`D-3`)—, ninguno emite SSA; pero escribir ese endpoint no desbloquearía nada, porque la autoridad **debe autenticar al usuario** para emitírsela y `SEC-G02` «Authentication & Session» está `P0 / PLANNED / NOT_EVALUATED` en el backlog. No se puede emitir una credencial de sesión para un usuario que no se sabe autenticar. `DEC-012` §16 deja fuera de alcance y sujetos a autorización específica «el emisor central de SSA y SAS», el login, MFA y la UI de login. El siguiente paso real no es código: es **decidir `SEC-G02`**. Se cierra cuando exista autoridad emisora de SSA (`LIC-003`/`DEV-003`, que `DEC-011` deja `BLOCKED` «hasta disponer de material real» y sin admitir autofirmados) o un procedimiento de aprovisionamiento inicial autorizado por ADR **Vía de cierre abierta el 2026-09-20 (`DEC-025`).** El propietario autorizó el **aprovisionamiento inicial de sesión de operador**, que es la alternativa que esta misma deuda nombraba: un artefacto con SSA **y** SAS, firmado fuera del repositorio con la clave operacional real de `G1.2`, consumido al arrancar por las rutas canónicas (`SSA-002` y `SAS-003`). No es `SEC-G02` y no lo promueve. **Hallazgo colateral que esta deuda no recogía:** `SnapshotAcquisitionService` y `AuthorizationSnapshotVerifier` estaban escritos y probados pero **no se construían en producción** —`new` de ambos sólo aparecía en pruebas—, de modo que un equipo real no tenía ruta para instalar un snapshot de autorización aunque se lo entregaran firmado; queda cableado. **Ejecutado el 2026-09-20 y corregido lo que impedia que funcionase** (`D-32` orden de arranque, `D-31` propósito del bundle): el arranque real de un equipo sin provisionar registra `provisioned: 2`, `usable: session_assertion=1 authorization_snapshot=1 license=0` y `security.operator_session → PROVISIONED`. La ruta de consumo de `DEC-025` queda `RUNTIME_VERIFIED` en Linux con material generado para la prueba. **Lo que sigue faltando para un mostrador es `D-30`**: el artefacto de confianza realmente publicado por `G1.2` no parsea, asi que un equipo apuntado a ese material no provisiona nada. Hasta cerrarlo, `REQUIRES_LOCAL_VERIFICATION` | `DEC-025` · `operator-session-artifact.ts` · `sign-operator-session.mjs` · `main.ts` (bloque `security.operator_session`) · `operator-session-provisioning.test.ts` (8/8) · `MIGRATION_022` · `main.ts:157-180` y `:271-280` · `session-trust-key-verifier.ts` · `session-assertion-verifier.ts:177` · `central-authority/session-trust-key-issuer.ts` · `docs/product/business-readiness.md` | el POS no atiende una sola venta en un equipo real, y es hoy **el único bloqueo común a los diez comercios prioritarios** |
| D-29 | ~~**El outbox persistía el `payload_checksum` que enviaba el llamador.**~~ · **ABIERTA Y CERRADA el 2026-09-20.** La unificación de ramas borró de `DurableSyncStore.enqueue` la recomputación `payload_checksum: checksum(parsed.payload)` **y la prueba que la fijaba**, de modo que el outbox guardaba `input.requestChecksum` —digest de la *petición*: `idempotency_key`, `operator_user_id`, importes— en un campo que describe el *payload*. `central-sync-server.ts:92` recalcula `payloadChecksum(operation.payload)` y rechaza con `SYNC.PAYLOAD_CHECKSUM_MISMATCH`, así que **toda** operación del outbox habría sido rechazada por el central. Medido con sonda sobre SQLite real, no inferido: persistido `01bdbf79…`, recalculado por el central `6f2848ce…`, no coinciden. Restaurado con su comentario y su prueba; verificado que la prueba muerde —reintroduciendo la regresión, `sync-store.test.ts` cae a 1 failed / 5 passed— y que no rompe nada (857 passed / 5 skipped). **Por qué no la vio ninguna puerta:** la única que compara los dos lados es el Central Sync Persistence Gate, y no se ha ejecutado nunca —CI no asigna runner desde el 2026-09-14—. Falta ejecutarlo de extremo a extremo contra PostgreSQL: `REQUIRES_LOCAL_VERIFICATION` | `durable-sync-store.ts` · `sync-store.test.ts` («persists payload_checksum from canonical payload bytes…») · `central-sync-server.ts:92` · `docs/governance/branch-duplication-audit-2026-09-20.md` | **regla que deja**: un valor que llega del llamador no es autoridad **aunque el esquema lo exija**; si un consumidor lo recalcula, el escritor tiene que recalcularlo también |
| D-30 | **El artefacto de confianza publicado por `G1.2` no parsea contra su propio contrato.** Medido el 2026-09-20 ejecutando `SessionAssertionTrustBundleSchema.safeParse` sobre `infra/trust/session-assertion-operational-key.json`: `success: false`, dos incumplimientos —`keys.0.claims.key_id` (`ssa-2026-01`) y `keys.0.claims.environment` (`production`) no casan `StableCodeSchema`, `/^[A-Z][A-Z0-9_]*(?:[.:-][A-Z0-9_]+)*$/`—. Un equipo real apuntado a ese fichero registra `security.session_trust → INVALID`, `provisioned: 0`, y **rechaza toda sesión**: la cadena de confianza muere en el primer paso, más abajo que el «falta un emisor» de `D-28`. **Por qué no lo vio nadie:** la única prueba que arranca el runtime de verdad, `session-bootstrap-main-runtime.test.ts`, es `describe.skipIf(process.platform !== "win32")` y CI corre en Linux; además su propio fixture usa `environment: "production"`, así que **fallaría igual si se ejecutase**, y lee `record.message` cuando el logger emite `event`. El propio `g1.2-…-execution-2026-09-17.md` §77 dejó escrito que no declaraba `RUNTIME_VERIFIED` «porque el último workflow D-3 observado terminó antes de ejecutar pasos». Hay además una **asimetría de alfabeto en los dos lados de la misma comparación**: `config.ts:38` acepta `session_trust_environment` como `z.string().min(1).max(128)` —minúsculas incluidas— y el claim exige `StableCodeSchema`. **Decisión del propietario, no del agente:** re-firmar el artefacto con códigos en mayúsculas exige su clave privada raíz, que no entra al repositorio; la alternativa es cambiar el contrato, que es material firmado. **Reducida el 2026-09-22: todo lo que no exige la clave raíz queda cerrado.** (a) La **asimetría de alfabeto está corregida**: `config.ts` pasa a `StableCodeSchema`, el mismo que el claim firmado, así que un entorno en minúsculas **falla al arrancar nombrando el campo** en vez de dejar arrancar el servicio para que después cada sesión muera con `ENVIRONMENT_MISMATCH` sin decir dónde estaba el error. Ninguna configuración legítima se pierde: la que ahora se rechaza nunca habría verificado nada. (b) Los **tres defectos de `session-bootstrap-main-runtime.test.ts` están corregidos**, y eran tres, no uno: el `environment` en minúsculas que hacía lanzar a su propio `parse`; la espera que leía `record.message` cuando el logger emite `event`, de modo que la condición no casaba **nunca** y la prueba moría a los 30 s por tiempo agotado; y una vigencia fija al 17/18 de septiembre, con lo que **a partir del día 18 la SSA entraba vencida** y la prueba caducaba sola. (c) Se añade un `describe` **que sí corre en Linux** y mira lo que no necesita un named pipe: que el fixture del bundle lo acepte el contrato, que la SSA esté vigente ahora y dentro del techo de 24 h, y —emitiendo por el logger de verdad, no comparando contra una forma escrita a mano— que el campo que la espera lee sea el que el logger emite. El entorno pasa además a escribirse **una sola vez**: se comparaba en dos literales distintos que coincidían entre sí y ninguno cumplía el contrato. Verificado que las guardas muerden: con `production` cae la primera, con la fecha fija cae la tercera. **Lo que sigue abierto es sólo lo que exige la clave privada raíz**: re-firmar el artefacto publicado. `REQUIRES_LOCAL_VERIFICATION` | `infra/trust/session-assertion-operational-key.json` · `packages/contracts/src/session-trust.ts` · `packages/contracts/src/primitives.ts:5` · `apps/pos-local-service/src/config.ts:38` · `tests/session-bootstrap-main-runtime.test.ts:52` · `docs/governance/g1.2-session-bootstrap-execution-2026-09-17.md` | el material de confianza real del producto no sirve para arrancar un equipo, y el documento que lo publicó afirma lo contrario |
| D-31 | ~~**El bundle de confianza no podía publicar la clave del snapshot de autorización, así que `DEC-025` nunca completaba.**~~ · **ABIERTA Y CERRADA el 2026-09-20, ejecutando el arranque.** `SessionAssertionKeyPurposeSchema` era `z.literal("SESSION_ASSERTION")`: el contrato del bundle **no admitía** un `key_purpose` de `AUTHORIZATION_SNAPSHOT`, y `main.ts` escribía ese propósito a mano al provisionar. Pero `DEC-025` verifica el SAS contra `keysFor("AUTHORIZATION_SNAPSHOT")`, que por construcción estaba vacío: **no existía ruta alguna para poblarlo**, aunque `local_trust_anchor` lo modele desde `MIGRATION_022`. Medido con material impecable: `usable: session_assertion=1 authorization_snapshot=0` y `SNAPSHOT_REJECTED / VERIFICATION_FAILED` en **todo** arranque. **Decisión del propietario, autorizada en sesión: una clave por propósito, no una compartida.** El propósito viaja dentro de los claims firmados por la raíz, así que decide a qué ancla entra la clave y no lo elige quien instala el fichero; compartirla anularía la separación —quien pudiera emitir identidad emitiría permisos, y revocar una obligaría a revocar ambas—. `LICENSE` queda fuera a propósito: su cadena tiene verificador propio y nadie ha demostrado que deba distribuirse por aquí. Tres piezas movidas: el contrato pasa a `z.enum([…])`; la resolución deja de devolver `Map<key_id, …>` —ahí se perdía el propósito— y devuelve una lista de publicaciones con su propósito, que se corresponde una a una con las filas del ancla; y el firmador toma **dos claves, una por sobre** (`--session-key` / `--snapshot-key`), porque firmar con una sola sólo funcionaba mientras el segundo sobre no llegaba a verificarse. Se elimina además `PURPOSE_MISMATCH` del verificador: era **inalcanzable** —`parse` corre antes y el esquema es estricto—, y la prueba «rejects malformed trust purpose instead of coercing it» ya lo demostraba sin que nadie lo notara. **Desenlace ejecutado**, primer arranque de un equipo sin provisionar: `provisioned: 2`, `usable: session_assertion=1 authorization_snapshot=1 license=0`, `security.operator_session → PROVISIONED`. Es la primera vez que la invariante `D1` de `DEC-025` —«los dos sobres, o ninguno»— se cumple de extremo a extremo. Verificado que muerde: volviendo a fijar el propósito a mano, la prueba cae con `expected 'session_assertion=2 authorization_sna…'`. `RUNTIME_VERIFIED` de la ruta de consumo en Linux con material de prueba; **no** `END_TO_END`: falta `D-30` y falta Windows | `packages/contracts/src/session-trust.ts` · `session-trust-key-resolver.ts` · `session-trust-key-verifier.ts` · `main.ts` (componente `session-trust-provisioning`) · `tools/provisioning/sign-operator-session.mjs` · `tests/operator-session-boot-order.test.ts` · `tests/session-trust-key-resolver.test.ts` · `tests/operator-session-provisioning.test.ts` (8/8) | **regla que deja**: un dato que viaja firmado y luego se reescribe a mano en el consumidor deja de ser autoridad — y si el contrato sólo admite un valor, nadie nota que se reescribe |
| D-32 | ~~**La provisión del ancla ocurría después de que sus consumidores leyeran las claves.**~~ · **ABIERTA Y CERRADA el 2026-09-20, ejecutando el arranque.** El bloque que provisiona `local_trust_anchor` estaba escrito **detrás** de `lifecycle.start()`. `CommercialComponent` resuelve su mapa de claves una sola vez dentro de su propio `start()` —ceremonia deliberada de `DEC-011`: rotar un ancla exige reiniciar—, así que el verificador de SSA se quedaba con el mapa **vacío de antes de provisionar**, y una `key_id` ausente se reporta como `SIGNATURE_INVALID` por diseño. Medido con artefacto y firma correctos: **primer** arranque `SESSION_REJECTED / SIGNATURE_INVALID`; **segundo** arranque, mismos ficheros, pasa la SSA. Es decir, **el único arranque que no podía funcionar era justo aquel para el que se escribió `DEC-025`**: el de un equipo recién aprovisionado. La prosa de `LocalSecurityComponent` ya describía el orden correcto —«arranca después de la base de datos y antes que `commercial`»— y nada lo obligaba. Corregido convirtiendo la provisión en `RuntimeComponent` situado entre `security` y `commercial`, de modo que el orden sea una posición en la lista y no un comentario. Verificado que la prueba muerde: moviendo el componente al final de la lista, `operator-session-boot-order.test.ts` cae con `expected { decision: 'SESSION_REJECTED' } to not match`. **De paso**, el log del arranque decía `SESSION_REJECTED / detail: "REJECTED"` —el nombre del desenlace, no su causa—: ahora emite la decisión del verificador, que es el dato que distingue firma de vigencia de binding, y que `session.activate` ya devolvía al llamador por IPC | `apps/pos-local-service/src/main.ts` (componente `session-trust-provisioning`) · `tests/operator-session-boot-order.test.ts` · `apps/pos-local-service/src/commercial/commercial-component.ts:68-70` · `apps/pos-local-service/src/security/local-security-component.ts:113-116` | **regla que deja**: cuando un consumidor resuelve una dependencia una sola vez al arrancar, el orden de arranque es parte del contrato — y un comentario que lo describe no lo impone |
| D-33 | ~~**El adapter de Wompi estaba completo y era inalcanzable: nada sabía escribir su credencial.**~~ · **ABIERTA Y CERRADA el 2026-09-22.** `resolveWompiPaymentProvider` sabía **leer** el sobre `payments-wompi` desde su creación y **ningún fichero del árbol lo escribía** fuera de pruebas: no existía una sola ruta soportada para aprovisionar un equipo con cobro por QR. El lado fiscal ya tenía su depósito (`DEC-021` F2) y éste **no inventa un segundo mecanismo**: mismo almacén cifrado, mismo binding como AAD, misma entrada por `stdin` —nunca argumento ni variable de entorno, que dejan rastro en la lista de procesos y en los volcados de diagnóstico—, mismo tope de entrada, mismo borrado de los búferes tras parsear, misma guarda de Windows y la misma regla de no imprimir jamás un valor. **Se añade una comprobación que el lector no podía hacer:** `publicKey` debe llevar el prefijo `pub_test_` o `pub_prod_` que la documentación de Wompi fija para la clave pública. Sin ella, pegar ahí la clave **privada** por error se aceptaría en silencio, quedaría cifrada en el equipo y viajaría después en cada URL de checkout; el prefijo es lo único que las distingue mirando el valor, y el depósito es donde se puede mirar. **La URL no se hizo configurable, a propósito.** Un barrido anterior lo señaló como carencia; el propio `wompi-http-client.ts:13` documenta —verificado contra Wompi, no supuesto— que sandbox y producción **comparten host** y que es la clave la que selecciona el entorno. Añadir un `baseUrl` sería configuración especulativa sobre material de cobro. 7 pruebas, que cierran cada caso con `resolveWompiPaymentProvider` —el mismo camino que `main.ts`— y no con «se escribió un fichero»: aprovisionar y resolver, no filtrar valores, rechazar una clave privada sin escribir nada, rechazar un campo de más, rechazar entrada no-JSON sin citarla, rotar sustituyendo, y **que lo depositado no descifre en otro equipo**. Verificado que muerden: quitando el prefijo cae la tercera; depositando sin el binding cae la primera. `TESTED`; el cobro real contra el sandbox sigue `REQUIRES_LOCAL_VERIFICATION` porque exige credenciales que no están en el repositorio | `deposit-wompi-credential.ts` · `deposit-wompi-cli.ts` · `wompi-credential.ts` (`WompiCredentialSchema`) · `tests/wompi-credential-deposit.test.ts` (7/7) · `tools/provisioning/README.md` | **regla que deja**: una capacidad que sabe leer lo que nadie sabe escribir no está materializada, está a medias — y el lado que falta no suele tener prueba que lo eche en falta |
| D-34 | ~~**Tres de los cuatro puertos fiscales convertían «no pude hablar con el proveedor» en «tu credencial está mal».**~~ · **ABIERTA Y CERRADA el 2026-09-22.** `auth.ts` distingue con cuidado `CREDENTIAL_REJECTED` (el proveedor contestó 401/400) de `TRANSPORT_FAILURE` o el código del transporte (la petición no llegó a salir), e `issue()` conservaba esa distinción. `queryStatus`, `fetchArtifact` y `synchronizeRanges` hacían `catch {}` y devolvían `AUTHENTICATION_FAILURE` fijo, tirando el dato un piso más arriba de donde se calculaba. **No es hipotético: se midió.** Ejecutada la suite de sandbox con credenciales de sandbox **válidas** y la red denegada por el proxy del entorno, `synchronizeRanges` respondió `UNAVAILABLE: AUTHENTICATION_FAILURE`. Es la respuesta más cara que puede darse en un mostrador: manda al comerciante a re-teclear una credencial correcta, o a pedirle otra a FACTUS, cuando lo que falla es la red. Corregido conservando `error.code` en los tres, exactamente como ya hacía la emisión. 4 pruebas nuevas, cada una con **los dos** transportes —red caída y 401— porque afirmar sólo uno dejaría pasar la regresión de volver a fijar el código: con un único caso, un `reasonCode` constante sigue pareciendo correcto. Verificado que muerde: devolviendo el código fijo en rangos, cae la primera. `TESTED` | `packages/fiscal-adapters/src/factus/adapter.ts` · `factus-auth.ts` · `tests/factus-adapter.test.ts` (47/47) | **regla que deja**: cuando una capa se toma el trabajo de distinguir dos causas, la de encima no puede hacer `catch {}` — el diagnóstico se pierde justo donde más falta hace, y nada falla al perderlo |
| D-35 | ~~**No existía nada ejecutable que publicara el bundle de confianza: el paso 1 de la puesta en marcha no tenía con qué hacerse.**~~ · **ABIERTA Y CERRADA el 2026-09-22.** `SessionTrustKeyIssuer` existía como **clase dentro de `apps/central-authority`**, no como herramienta. Medido antes de escribir nada: ningún fichero del árbol producía un bundle. Se había documentado el paso 1 —«publicar el bundle con una clave por propósito»— sin que hubiera con qué, de modo que el propietario se habría parado en el primer comando. `publish-session-trust.mjs` lo publica **y genera las dos claves operacionales en el mismo acto**: separarlo crea la única forma de equivocarse que no avisa —publicar la pública de un par y firmar con la privada de otro—, que da `SIGNATURE_INVALID` en un mostrador y en ningún sitio antes. Rechaza además códigos en minúsculas antes de firmar, que es exactamente el defecto de `D-30`. 6 pruebas: el bundle lo acepta el verificador **del servicio** —no una reimplementación—, la privada escrita corresponde con la pública publicada, no se imprime ninguna clave, y se rechazan minúsculas e identificadores repetidos. **Y una prueba de cadena**: ejecuta los **dos binarios reales** en procesos aparte y arranca el servicio con lo que escriben en disco → `provisioned: 2`, `session_assertion=1 authorization_snapshot=1`, `PROVISIONED`. Es la diferencia entre «el servicio sabe consumir un bundle correcto» y «las herramientas que tenemos producen uno correcto», y lo segundo no lo comprobaba nada. `TESTED` | `tools/provisioning/publish-session-trust.mjs` · `tests/publish-session-trust.test.ts` (6/6) · `tests/provisioning-chain.test.ts` (1/1) · `tools/provisioning/README.md` | **regla que deja**: un paso documentado sin herramienta que lo ejecute es documentación que miente — y nada falla al mentir |
| D-36 | ~~**El script de DPAPI estaba duplicado: dos copias que debían coincidir y nada las comparaba.**~~ · **ABIERTA Y CERRADA el 2026-09-22.** Una copia en `windows-dpapi-key-provider.ts` y otra en `local-channel/windows-production.ts`, **idénticas en significado y distintas en formato** —la segunda con el mismo código colapsado en una línea—, junto con su invocación de `spawnSync` palabra por palabra. Es el script que deriva la clave raíz del equipo: lo primero que se ejecuta en un Windows real. No había divergencia semántica hoy, y ese es justo el problema: arreglar una no habría alcanzado a la otra y **nada habría fallado al no alcanzarla**. Es la misma forma de envejecer que costó doce días en `business-readiness.md`, dos superficies para el mismo dato. Resuelto dejando **una sola**, en `local-channel` —el paquete no puede importar del servicio y el servicio sí del paquete—, que es exactamente el movimiento que ya hizo `canonicalJson` por la misma razón y está registrado como precedente en su cabecera. Se centraliza también `runDpapiRootKey`. Guarda nueva que **sí corre en Linux**: parsea las fuentes y exige que `DPAPI_SCRIPT` se defina en un solo fichero. Verificado que muerde reintroduciendo una segunda definición. La prueba de Windows que lo ejercita de verdad sigue `skipIf` y sin ejecutarse: `REQUIRES_LOCAL_VERIFICATION`. | `packages/local-channel/src/windows-production.ts` · `apps/pos-local-service/src/security/windows-dpapi-key-provider.ts` · `tests/windows-dpapi.test.ts` | **regla que deja**: dos copias que deben coincidir necesitan o una puerta que las compare o dejar de ser dos; el formato distinto las hace indistinguibles de un vistazo |
| D-37 | **La venta por peso SÍ opera, pero su factura declara una unidad falsa.** Medido el 2026-09-22 por el socket real, contra el negocio prioritario —avícola, carnes, embutidos, fruver—. **Dos formas de modelarlo y sólo una llega a la factura:** con `unit_code: "KGM"` y `unit_precision: 3` la venta de 2.355 kg se completa y el inventario baja bien, pero la emisión se detiene en `PAYLOAD_ASSEMBLY_BLOCKED` con `AMOUNT_NOT_REPRESENTABLE / QUANTITY_EXCEEDS_PROVIDER_PRECISION` (`D-18`, fail-closed correcto). Con `unit_precision: 2` factura, pero 10 g de granularidad no es lo que marca una balanza. Con **`unit_code: "GRM"` y `unit_precision: 0`** —precio por gramo, cantidad entera— la cadena llega entera: 2355 g cobrados en 33.650 (28.260 + IVA 19% = 33.629,40, redondeado a 50 por `nearestFiftyHalfAwayFromZero`), inventario exacto en 17.645 g y documento `ISSUED` con CUFE. Queda fijado en `channel-commercial-vertical.test.ts`. **Lo que sigue abierto, y es lo único:** el `unit_measure_code` de esa factura es `94` = «Unidad», que es **falso** para un producto por peso. `UNIT_MEASURE_CODES` sólo tiene ese código verificado —`D-9`, tablas parciales a propósito— y declarar el real se rechaza con `UNIT_MEASURE_CODE_NOT_VERIFIED`: comprobado con `GRM`, `KGM` y `70`, los cuatro rechazados. **No es trabajo de motor: es fuente documental de la DIAN**, del mismo tipo que `D-13`. Sin ella, un comercio por peso factura declarando unidades donde vende gramos. `REQUIRES_LOCAL_VERIFICATION` | `channel-commercial-vertical.test.ts` («venta por peso: el mostrador de una avicola») · `packages/fiscal-adapters/src/dian/codes.ts` (`UNIT_MEASURE_CODES`) · `set-fiscal-attribute-use-case.ts` · `sale-calculation.ts` | **regla que deja**: que una operación termine en verde no significa que lo que declaró sea cierto — el sistema facturó, y facturó una unidad que no es |
| D-38 | **Lotes y vencimientos: esquema materializado, operaciones pendientes.** Autorizado por el propietario el 2026-09-22 para el negocio prioritario —carnes y embutidos, donde la trazabilidad por lote es requisito sanitario y no comodidad—. **No se inventó el modelo: se continuó el decidido.** `UC-INVENTORY-002` §Lotes y §Vencimientos, `RN-018`, `RN-019`, `RN-127` y `RN-130` ya lo especifican; `MIGRATION_026` lo materializa. De los once atributos conceptuales entran los que el árbol sostiene hoy. **Quedan fuera y no se fingen con una columna vacía** —mismo criterio que `MIGRATION_024`—: `costo` (no hay modelo de costo) y `proveedor u origen` (no existe `Supplier`; compras y proveedores es capacidad ausente, y un texto libre sería un proveedor inventado sin identidad). Cuatro invariantes las impone el esquema y no la aplicación: `lot_id` irrepetible por clave primaria; un `lot_code` único por presentación —dos lotes homónimos harían ambigua la trazabilidad y un retiro sanitario no sabría cuál retirar—; el vencimiento no puede preceder a la recepción ni a la fabricación —una fecha así **envenenaría FEFO**, porque ese lote se elegiría siempre primero—; y `quantity_reserved` nunca excede a `quantity_on_hand`. **`EXPIRED` no se almacena**: §Vencimientos lo lista como estado *derivado* y su regla 4 dice que el vencimiento no elimina el lote. Guardarlo como columna obligaría a un proceso que la actualice y daría dos verdades —la fecha y el estado— que pueden discrepar; se deriva de `expiry_date` contra el reloj. 8 pruebas de esquema; verificado que muerden quitando el `CHECK` del vencimiento. Fixtures reconciliados: la lista de DROP que fabrica el «v7» y el pin de `LATEST_LOCAL_SCHEMA_VERSION` (25 → 26). **Operaciones — primer tramo, el 2026-09-22.** `inventory.lot.receive` e `inventory.lot.list` existen, cruzan el socket real y llegan a SQLite. Recibir por lote es **operación aparte** de `inventory.stock.receive`, no un campo opcional: un `lot_code` opcional daría trazabilidad «cuando el cajero se acuerde», y un rastro así no acota un retiro sanitario. El tipo de movimiento no viaja —recibir un lote **es** una recepción— y el permiso se reusa (`INVENTORY_STOCK_RECEIVE`): uno nuevo dejaría sin recibir por lote a todo comercio ya configurado hasta que alguien reconciliara sus roles. El lote y su movimiento comparten transacción: un lote sin entrada sería existencia que el saldo no conoce, y una entrada sin lote, existencia sin rastro. Repetir el mismo `lot_code` con las mismas fechas suma —es la segunda remesa de la tanda—; con otras fechas es `LOT_CODE_CONFLICT` y **no se fusiona**. `NEAR_EXPIRY` **no se calcula, y su ausencia es deliberada**: exige un umbral —¿tres días, siete, treinta?— que es política versionada y nadie la ha decidido. `VALID` y `EXPIRED` se derivan de la fecha sin decidir nada. 4 pruebas nuevas por el canal real. **La de FEFO pasaba por coincidencia** —el orden de llegada y el de vencimiento coincidían— y se rehízo para que la tanda que vence más tarde sea la que llegó primero y además ordene antes alfabéticamente: ahora cae con `ORDER BY received_date` y con `ORDER BY lot_code`. Verificado también que el conflicto de código muerde. Tres puertas de exhaustividad del propio árbol cazaron omisiones mías al añadir las operaciones: el `Record<IpcMessageType>` de `response-schemas.ts`, el `never` del enrutador del canal y la paridad de superficie del Desktop. Ninguna era una prueba que yo escribiera: existían. **Lo que sigue faltando, dicho sin adornos:** la venta **no consume lotes por FEFO**, no hay merma por vencimiento y `inventory_movement` no lleva `lot_id` —regla 2—. Declarar la tanda y ver qué vence ya sirve, pero **el rastro de venta a lote no existe**, que es la mitad que un retiro sanitario necesita. `TESTED` para lo que hay; la capacidad completa, no. **Segundo tramo — consumo por venta, el 2026-09-26.** La venta ya **consume lotes por FEFO y deja rastro**: `MIGRATION_027` crea `inventory_lot_allocation` (lote, movimiento, venta, cantidad) y `appendSaleDeduction` la escribe **en la misma transacción** que el movimiento `SALE`. FEFO es *primero el vencimiento válido más cercano* (§Vencimientos regla 1): un lote vencido a la fecha de negocio **nunca se elige solo**; sale por merma. Desempate: recepción y luego código. **Tabla aparte y no `lot_id` en el movimiento**: una venta de 1,5 kg puede salir de dos tandas, y partirla en dos movimientos cambiaría la clave de idempotencia de la venta. **Sin FK a `inventory_movement`**, a propósito: `MIGRATION_025` reconstruye esa tabla y una FK hacia ella rompería la reconstrucción (`D-27`). La FK va al lote. La tabla es **append-only por trigger** —es un rastro sanitario—. **Faltante no forzado**: si la venta supera lo que hay en lotes vigentes (existencia que entró sin lote), lo que falta queda sin asignar; no se imputa a un lote arbitrario ni se bloquea la venta, y la diferencia es medible. **Sólo se asigna en `POSTED`**: la finalización reintentada (`IDEMPOTENT`) no vuelve a asignar. 6 pruebas: 5 por el canal real (FEFO sobre vigentes saltando el vencido, faltante, producto sin lotes, cobro reintentado, append-only) y 1 contra el almacén. **Esa última existe porque la del canal no medía lo que decía**: el pago idempotente responde antes de llegar al inventario, así que mutar la guarda `IDEMPOTENT` la dejaba en verde. La prueba de almacén llama dos veces a `appendSaleDeduction` y **sí cae** con la mutación (2 asignaciones en vez de 1). Mutaciones verificadas que muerden: quitar el filtro de vencimiento, ordenar por recepción en vez de por vencimiento, asignar también en `IDEMPOTENT`. **Lo que sigue faltando, dicho sin adornos:** (1) **las otras salidas no tocan lotes** —merma, ajuste negativo, traslado y apertura de presentación bajan el saldo pero no el lote—, así que tras una merma el lote y el saldo se desalinean; la merma por vencimiento de un lote concreto no existe; (2) **no hay consulta del rastro** —«qué ventas se llevaron el lote X»— ni por el canal ni en pantalla: el dato está en SQLite y sólo lo lee quien abra la base; (3) `inventory.lot.receive/list` siguen **sin pantalla**; (4) `NEAR_EXPIRY` sigue sin umbral decidido. El rastro venta→lote es `TESTED` y `CALLER_REACHABLE` por el canal de venta; la capacidad de retiro sanitario completa, no. **Tercer tramo — las demás salidas, el 2026-09-26.** Cierra el punto (1). `inventory.stock.adjust` admite `lot_code` opcional y toda salida resuelve su lote en la transacción de su movimiento: **con `lot_code`** es la «selección autorizada» de §Salidas paso 4 —la cantidad entera sale de ese lote, **vencido o no**, y es la única vía por la que sale un lote vencido (§Lote vencido regla 2)—; **sin él**, FEFO sobre vigentes como la venta. `inventory.conversion.apply` baja de los lotes de la paca por FEFO. **La merma con motivo `EXPIRED` sin lote es `LOT_REQUIRED`** (§Mermas regla 3): sin lote, FEFO descontaría una tanda vigente en lugar de la que se botó. Un lote nombrado que no existe en la sucursal es `LOT_NOT_FOUND`; uno que no alcanza, `LOT_INSUFFICIENT` con lo que tiene el lote —no el saldo—. **En ambos rechazos el movimiento ya escrito se deshace** —la transacción se aborta—: rechazar por el lote no puede dejar el saldo descontado. El contrato rechaza `lot_code` en `ADJUSTMENT_POSITIVE`: sumar a una tanda es recibirla con sus fechas. La huella de idempotencia incluye el lote **sólo cuando viaja**, así que un ajuste sin lote conserva la huella de antes. La pantalla de ajuste lleva el campo «Lote (opcional)». **Defecto propio encontrado y corregido en el camino**: `MIGRATION_026` hizo único `(tenant, presentación, código)` **sin sucursal** y `receiveLot` buscaba con esa clave. Medido con una prueba: recibir `L-X` en la sucursal A cuando B ya lo tenía **sumó las 10 unidades de A al lote de B** —un lote de 20 con 10 de existencia, y A con 10 y sin lote—. `MIGRATION_028` recrea el índice con la sucursal dentro (la clave nueva contiene a la vieja: ningún dato existente la viola) y `receiveLot` busca por sucursal. Que la misma tanda llegue a dos sucursales con fechas distintas se acepta: si eso es conflicto es política no decidida. Pruebas: +1 de contrato, +6 por el canal real (merma vencida nombrada, `LOT_REQUIRED`, ajuste y traslado por FEFO saltando el vencido y ajuste positivo que no toca lotes, lote que no alcanza y lote inexistente con deshecho verificado, merma repetida `IDEMPOTENT` y misma clave con otro lote `IDEMPOTENCY_CONFLICT`, apertura de paca por FEFO y repetida), +2 de almacén (lote de otra sucursal `LOT_NOT_FOUND`; regresión de las dos sucursales), +1 de esquema, y el E2E de Electron que teclea `EXPIRED` sin lote y con un lote inexistente y ve `LOT_REQUIRED` y `LOT_NOT_FOUND` en la pantalla, con el saldo intacto. **Doce mutaciones, las doce muerden**: ajuste positivo que asigna, asignar en `IDEMPOTENT` (ajuste y conversión), rechazo sin deshacer (dos variantes), sin `LOT_REQUIRED`, lote nombrado sin filtro de sucursal, conversión que no asigna, ajuste sin lote que no asigna, huella sin lote, `receiveLot` sin sucursal y el libro sin `MIGRATION_028`. **Lo que sigue faltando:** consulta del rastro y pantalla de lotes (puntos 2 y 3); las unidades de una paca abierta **no heredan su lote** —el rastro llega a la paca, no a la unidad—; `NEAR_EXPIRY` sin umbral. **Cuarto tramo — rastro y pantalla, el 2026-09-26.** Cierra los puntos 2 y 3. `inventory.lot.trace` (tipo 38 del contrato) devuelve, para un código de lote en la sucursal del contexto, el lote, lo recibido —lo que queda más **todas** las salidas— y cada salida en orden de ocurrencia con su tipo, cantidad, venta, motivo y fecha. Se pide **por código**, que es lo que trae la etiqueta del proveedor. Es lectura con `INVENTORY_STOCK_READ`: un permiso nuevo dejaría sin rastro a todo comercio ya configurado. **Devuelve la venta, no al comprador**: quién compró es dato de `Sales`/`Customers` y el almacén no lee sus tablas (`data-ownership.md` reglas 1 y 2); la pantalla abre cada venta con `sales.receipt.get`, el contrato de su dueño. Tope de 2000 salidas con `truncated` explícito: un rastro cortado en silencio es un retiro que deja ventas fuera. La pantalla «Lotes y vencimientos» (`LotPanel` + `useLots`) recibe tandas, las lista en el orden FEFO que da el servicio y rastrea hasta el recibo. **Dos defectos propios encontrados y corregidos en el camino**: (a) los cinco códigos de lote —`LOT_CODE_CONFLICT`, `LOT_DATES_INVALID` y los tres del tramo anterior— **no estaban en el mapa de categorías** y el canal los devolvía como `INTERNAL`: un código mal tecleado se reportaba como fallo del servicio; (b) **`receiveLot` con fechas incoherentes subía la existencia sin lote**: el `CHECK` rechazaba el lote después de escrito el movimiento de entrada y el rechazo se **devolvía** dentro de la transacción, que se confirmaba con el movimiento dentro. Medido: 2000 → 3000 con `LOT_DATES_INVALID`. Ahora se lanza y la transacción se deshace. Pruebas: +3 de contrato, +2 por el canal real (dos tandas y dos ventas —una repartida entre ambas— más una merma, con lo recibido cuadrando y cada venta abriéndose con su recibo; `NOT_FOUND` frente a lote sin salidas), +3 de caso de uso y almacén (permiso, sucursal, tope), aserciones de categoría en las cinco rutas de lote, y **dos recorridos E2E de Electron** —recibir dos tandas y verlas en orden FEFO, mermar una nombrándola y rastrearla; y declarar la tanda del café antes de venderlo, rastrearla después de la venta y abrir desde el rastro el recibo con su número—. **Ocho mutaciones, las ocho muerden**: rastro sin sucursal, recibido sobre las devueltas, `truncated` siempre falso, permiso de recibir en lugar de leer, fechas sin deshacer, `LOT_REQUIRED` sin categoría, orden inverso y `NOT_FOUND` como lote vacío. **Lo que sigue faltando:** el rastro **llega a la venta, no al comprador** —ni el rastro ni el recibo nombran al cliente—; las unidades de una paca abierta no heredan su lote; **Quinto tramo — del lote a la persona, el 2026-09-26.** Cierra «llega a la venta, no al comprador». La venta ya guardaba el cliente (`MIGRATION_019`) y la pantalla de venta ya lo pedía; lo que faltaba es que **el recibo lo dijera**. `sales.receipt.get` expone `customer_id` —una columna de `sales_sales`, así que Ventas sigue leyendo sólo lo suyo—, y **sólo el identificador**: nombre y contacto los da `customer.get`, bajo el permiso de Clientes. Del lote a la persona hay tres saltos y tres dueños, y ninguno lee tablas de otro. La pantalla de lotes, al abrir una venta, muestra al comprador o dice «venta de mostrador, sin comprador identificado»; y «Compradores del lote» recorre las ventas del rastro y da la lista de un retiro: compradores sin repetir con teléfono y correo, las ventas anónimas contadas aparte y **cada venta o cliente que no se pudo leer, con su código** —un retiro que dejara fuera a alguien sin decirlo sería peor que no tener lista—. Al revisar lo escrito se encontró y corrigió antes de publicar que abrir otra venta dejaba a la vista **el comprador de la anterior**: ahora sólo se muestra si es el de la venta abierta. Pruebas: +1 por el canal real (venta nombrada y anónima del mismo lote; el recibo coincide con `sales_sales` y `customer.get` da nombre, teléfono y correo), +2 de renderer (lista con anónimos y fallos; comprador de otra venta), y el E2E: la venta de mostrador del primer recorrido se ve anónima, y la venta fiada a Rosa Quintero se rastrea desde su tanda hasta su nombre e identificación. **Cinco mutaciones, las cinco muerden.** `END_TO_END` en este entorno Linux. **Lo que no cubre:** la venta de mostrador no tiene comprador, y eso no se arregla con software —es política de captura—; y ver `D-40`: la factura puede nombrar a otro adquiriente. **Sexto tramo — la paca abierta, el 2026-09-26.** Cierra «las unidades de una paca abierta no heredan su lote». Al abrir una paca, FEFO dice de qué tandas salió y **las unidades entran en un lote con el mismo código y las mismas fechas**, con `origin_lot_id` apuntando al lote de la paca (`MIGRATION_029`, columna sin `REFERENCES` por la misma razón que `MIGRATION_019`). La cuota de cada tanda es `tomado × destino / origen`, la misma proporción de la conversión, sin releer el catálogo. Otra paca de la misma tanda suma al lote de unidades que ya salió de ella. **Dos casos entran sin lote, a propósito**: si la cuota no da exacta en escala 6 —el total sí, lo comprueba el caso de uso; un reparto entre dos tandas puede no—, y si en las unidades ya existe ese código **con otro origen**: fusionar dos tandas bajo un código es justo lo que haría ambiguo un retiro. `inventory.lot.trace` añade `origin_lot` y `derived_lots`: el rastro sube de las unidades a la paca y baja de la paca a sus unidades. La pantalla ofrece «Rastrear origen» y «Rastrear unidades», y **«Compradores del lote» recorre los lotes derivados** —con tope de 50 y aviso si algún rastro venía cortado—: el retiro de una paca que no bajara a sus unidades dejaría fuera justo a quien compró suelto. Un lote derivado cuyo rastro no llega se lista con su código. Pruebas: el vertical de apertura amplía a herencia por tanda con fechas y origen, venta de 30 unidades repartida entre las dos tandas heredadas, y rastro en los dos sentidos; +1 vertical (otra paca de la misma tanda suma; código con otro origen no se fusiona y las unidades entran al saldo sin lote); +1 de almacén (cuota no exacta: sin lote inventado); +2 de renderer (compradores de los lotes derivados con el ilegible listado; subir y bajar entre paca y unidades); y el E2E de la paca de gaseosa: la tanda `GAS-L1` se abre desde la pantalla y el rastro baja a sus 12 unidades y vuelve a subir. **Ocho mutaciones, las ocho muerden.** **Séptimo tramo — entradas a una tanda existente, el 2026-09-26.** El ajuste positivo admite `lot_code` y suma a esa tanda **si ya existe** en la sucursal: no crea lotes —una tanda nueva trae fechas y se recibe—; un código inexistente es `LOT_NOT_FOUND` y el movimiento se deshace. Hasta ese día el contrato lo rechazaba y una prueba lo fijaba: la prueba cambió **por requisito del propietario**, y lo dice. Hacerlo sin más habría abierto la vía de robo que el repo ya señala: una tanda inflada a mano sería indistinguible de una recibida, porque el libro del lote sólo tenía salidas. **`MIGRATION_030` añade `direction` a `inventory_lot_allocation`** (`OUT` por omisión para lo existente; una entrada no puede llevar venta, lo impone el esquema) y ahora **toda** entrada deja fila con su movimiento: recepción, remesa, herencia de paca y ajuste positivo. El saldo de un lote es entradas menos salidas, y el rastro devuelve `inflows` con tipo y motivo. **Defecto propio encontrado y corregido**: una remesa sobre una tanda agotada sumaba la cantidad y la dejaba en `CONSUMED`; FEFO sólo toma `ACTIVE`, así que esa existencia no se vendía nunca desde el lote. Medido con la prueba: `40.000000/CONSUMED`. Ahora la remesa, el ajuste positivo y la herencia reactivan. Pruebas: 2 de contrato actualizadas (la regla que cambió y la fixture), +3 por el canal real (ajuste positivo a tanda agotada que suma, reactiva, la vuelve a vender, se ve en el rastro con su motivo y no se repite en `IDEMPOTENT`; `LOT_NOT_FOUND` sin mover el saldo; remesa que reactiva), **el invariante «saldo del lote = entradas − salidas» comprobado sobre todos los lotes** en cuatro pruebas, y el E2E: desde la pantalla, 3 de más en PANELA-TARDE y el rastro muestra «Recepción» y «Ajuste +». **Siete mutaciones, las siete muerden**, incluida la del defecto. **Octavo tramo — «próximo a vencer», el 2026-09-26.** **El propietario decidió el umbral: 7 días.** Hasta ese día `NEAR_EXPIRY` no existía a propósito, porque exigía un número que nadie había decidido. Ahora es `NEAR_EXPIRY_DAYS = 7` en el contrato, **un solo sitio**, y viaja en la respuesta de `inventory.lot.list` (`near_expiry_days`): la pantalla lo muestra desde ahí. Regla: vence hoy o en los 7 días siguientes, ambos extremos incluidos; el octavo día es `VALID`. Días de calendario en UTC sobre la fecha, sin husos. La venta no cambia —FEFO ya pone primero lo que vence antes—: el estado es aviso (§Vencimientos regla 3), y la lista de lotes cuenta las tandas **con existencia** que vencen pronto y las vencidas que quedan por sacar por merma. Registrado también en `UC-INVENTORY-002` §Vencimientos. La prueba que esperaba `VALID` para una tanda a 2 días cambió a `NEAR_EXPIRY` **por la decisión**, y lo dice. Pruebas: +7 de frontera (umbral del contrato; hoy, día 7, día 8, ayer; fin de año y febrero bisiesto; sin vencimiento), +2 de contrato, +1 de renderer (el doble responde 5 días para que una pantalla con el 7 escrito no pase), y el E2E: una tanda a 5 días sale `NEAR_EXPIRY` con el aviso «1 tanda … 7 días». **Cinco mutaciones, las cinco muerden** —una se repitió porque su filtro no casaba con ninguna prueba y no se contó hasta que casó—. **Falta la vista de todo el negocio**: el aviso es por presentación. **Noveno tramo — lo que vence esta semana, el 2026-09-26.** Cierra esa falta. `inventory.lot.expiring` (tipo 39) devuelve, para la sucursal del contexto, las tandas **con existencia** vencidas o que vencen hasta la fecha de negocio más `NEAR_EXPIRY_DAYS` —la misma frontera que `lotExpiryState`, que pone el estado a cada fila—, por vencimiento, con tope de 500 y `truncated`. Una tanda agotada no aparece: no hay nada que vender ni que botar. Lectura con `INVENTORY_STOCK_READ`. **Devuelve la presentación, no el nombre**: la pantalla lo pide a Catálogo con `catalog.item.get`, que así tiene **su primer llamador** —`business-readiness` la listaba como «superficie sin consumidor», y sale de esa lista—. Un nombre que no llega no borra la fila: se muestra el identificador con el código del fallo, porque un aviso que perdiera filas dejaría producto vencido en la vitrina sin avisar. Cada fila se rastrea con un clic. Pruebas: +1 por el canal real (dos productos; vencida, hoy, día 7 y la del pollo dentro; día 8, agotada por merma y sin fecha fuera; nombre por Catálogo), +3 de caso de uso y almacén (permiso, sucursal, tope), +2 de contrato, +1 de renderer (la fila sin nombre se conserva) y el E2E: la panela a 5 días aparece como «Panela · Bloque 500g — Vender primero» y lleva a su rastro. **Cinco mutaciones, las cinco muerden.** A9 y `business-readiness` reconciliados: 39 tipos, 37 con pantalla en 15 superficies, 2 sin pantalla. **Pendiente también:** y la misma tanda en dos sucursales con fechas distintas se acepta, porque si es conflicto es política no decidida. **Décimo tramo — la misma tanda en dos sucursales, el 2026-09-26.** **El propietario decidió: es conflicto si las fechas no coinciden.** `receiveLot` compara ahora también contra los lotes de **otras** sucursales de la misma presentación y código: si la fabricación o el vencimiento difieren —`NULL` contra fecha incluido, con `IS NOT`— es `LOT_CODE_CONFLICT`, igual que dentro de una sucursal, y no se escribe nada. La fecha de recepción no se compara: es de cada sucursal. La herencia al abrir una paca aplica la misma regla: si otra sucursal tiene el código en la presentación destino con otras fechas, esas unidades entran sin lote en vez de fabricar una segunda versión de la tanda. Pruebas a nivel de almacén —una sesión del canal está atada a una sucursal, y aquí hacen falta dos—: tres discrepancias (vencimiento, fabricación, vencimiento contra ninguno) que no mueven existencia en ninguna sucursal, mismas fechas con distinta recepción que se aceptan, y la herencia que no se hace. **Cinco mutaciones, las cinco muerden**, incluida la que compara con `<>` —que dejaría pasar `NULL` contra fecha— y la que compararía también la recepción. Queda por decidir si esto merece aviso fuera del código: hoy el operador ve `LOT_CODE_CONFLICT` sin saber qué fechas tiene la otra sucursal. **Undécimo tramo — el rechazo dice con qué fechas existe la tanda, el 2026-09-26** (autorizado por el propietario). `LOT_CODE_CONFLICT` trae `conflicting_lot`: fabricación y vencimiento registrados, y si el choque es en esta sucursal o en **otra, sin nombrarla** —el operador sólo está autorizado en la suya, y para corregir la captura le bastan las fechas—. Si varias sucursales discrepan, se devuelven las de la primera en recibirla, que fijó las fechas de la tanda. La pantalla lo muestra junto al rechazo. Pruebas: el choque en la misma sucursal por el canal real, el choque con otra sucursal en el almacén, el mensaje en el renderer y el E2E (la panela con otro vencimiento muestra «en esta sucursal» y 2026-12-31). **Cuatro mutaciones, las cuatro muerden.** Rastro y pantalla: `END_TO_END` en Electron con servicio real, en este entorno Linux; en Windows, `REQUIRES_LOCAL_VERIFICATION` | `MIGRATION_026` · `MIGRATION_027` · `local-database.test.ts` («MIGRATION_026 — lote y vencimiento») · `channel-commercial-vertical.test.ts` («trazabilidad de venta a lote») · `inventory.test.ts` («asignación de venta a lote», «ajuste con lote nombrado») · `MIGRATION_028` · `real-channel.spec.ts` («una tienda se monta desde la pantalla», «un cajero vende de verdad» 3a y 6b) · `ipc-contracts.test.ts` («inventory.lot.trace») · `trace-lot-use-case.ts` · `LotPanel.tsx` · `docs/use-cases/inventory/UC-INVENTORY-002-manage-stock-lifecycle.md` §Lotes | **regla que deja**: un esquema sin sus operaciones no es una capacidad, es la mitad de una — y la mitad que no se ve es la que el comerciante necesita |
| D-39 | ~~**No existía ninguna ruta para alimentar el inventario: un POS no se podía estrenar.**~~ · **ABIERTA Y CERRADA el 2026-09-22.** Medido antes de escribir nada: poner **un** artículo vendible y facturable costaba tres operaciones —`catalog.product.register`, `catalog.fiscal.attribute.set`, `inventory.stock.receive`—, todas de una en una, y **no había nada masivo en el contrato ni en la doctrina**. `UC-ONB-001` inicializa el tenant —licencia y dispositivos—, no el catálogo. Un minimercado tiene entre dos y cinco mil referencias: diez o quince mil capturas a mano antes de la primera venta. **Eso, y no el motor, es lo que impide estrenar un POS**, y ningún documento del repositorio lo recogía. `catalog.item.import` carga hasta 500 por llamada —la trama admite 1 MiB y una fila ronda 300 bytes; el tope existe para que el fallo sea legible, no por límite del importador—. **No es todo o nada, a propósito**, que es exactamente lo contrario de la conversión atómica y por la razón opuesta: allí las dos mitades carecen de sentido por separado, aquí cada fila es un artículo independiente. Tres mil filas y una mala no puede descartar 2.999 buenas; cada fila devuelve su desenlace con su índice y el operador corrige una línea, no el fichero. **Compone los tres casos de uso existentes y no escribe una tabla**: las instancias se izan para reutilizarlas: una ruta de importación con validaciones propias acabaría admitiendo lo que la normal rechaza, y esa divergencia no se vería hasta que un artículo importado se comportara distinto a uno capturado. Cuesta más que un INSERT masivo y es la única forma de que sea el mismo artículo. `initial_quantity` y `fiscal` son **opcionales**: una ficha sin existencia es «todavía no llegó» —distinto de «se agotó», por eso no se obliga a declarar cero— y un comercio que aún no factura electrónicamente no tiene por qué inventarse códigos DIAN para cargar su catálogo. 2 pruebas por el socket real. **La primera no se conforma con que la carga responda `COMPLETED`: vende y factura lo cargado**, porque un importador que deja artículos invendibles habría pasado cualquier prueba que sólo mirase su propia respuesta. Verificado que muerde: cortando el lote en la fila mala, cae. Se documenta además la secuencia completa en `docs/product/inventory-onboarding.md`, con lo que falta marcado: no existe `Supplier` ni documento de compra, y la venta no consume lotes. **Pantalla, el 2026-09-26.** «Carga inicial del catálogo» lee el fichero del comerciante y valida **antes de enviar nada**, con el número de línea de su hoja: el servicio no puede decir «la línea 214 tiene el precio vacío», porque cuando la fila llega la línea ya no existe. Acepta lo que un comerciante entrega de verdad: `;` —Excel en español exporta así porque la coma es decimal—, tabuladores —lo que llega al copiar celdas y pegarlas— y BOM. **No adivina**: `3.200` se rechaza por ambiguo diciendo qué escribir, existencia en cero se rechaza, los códigos DIAN van todos o ninguno. Traduce el `index` que devuelve el servicio —relativo al lote— a la línea del fichero; verificado mutando que sin esa traducción la prueba cae. **Tres cosas que sólo aparecieron al ejecutar la pantalla contra el servicio real**, con las 16 unitarias en verde: (1) la E2E dependía de que la primera prueba del fichero vinculara la sesión y fallaba aislada con `SESSION_NOT_BOUND` —se hizo autosuficiente—; (2) yo había escrito que reactivar una SSA responde `STALE_SEQUENCE` y responde `REJECTED/SEQUENCE_REPLAY`, porque el verificador caza el replay antes del almacén —se comprueba la decisión exacta, no «cualquier rechazo»—; y (3) **la pantalla mostraba `UNAUTHORIZED` tanto si faltaba un permiso como si no había sesión**, que se remedian de forma opuesta —ahora muestra el `result_code`—. Un cuarto, del propio código: el BOM estaba escrito como **carácter invisible** dentro del regex, y por eso dos mutaciones no se aplicaron sin avisar y saqué conclusiones de ellas. Se sustituyó por el escape visible y se remidió: lo quitan dos mecanismos y la prueba cae sólo al quitar ambos. E2E 18/18, en la suite y aislada. `TESTED` | `catalog.item.import` · `import-catalog-use-case.ts` · `channel-commercial-vertical.test.ts` («carga inicial») · `CatalogImportPanel.tsx` · `catalog-import.ts` (16 pruebas) · `useCatalogImport.ts` · `real-channel.spec.ts` («el comerciante carga su catálogo») · `docs/product/inventory-onboarding.md` | **regla que deja**: una capacidad que sólo se puede usar de una en una no está terminada para quien tiene miles — y el volumen real del cliente es parte del contrato, no del despliegue |
| D-40 | ~~**La factura puede nombrar a un adquiriente distinto del que nombró la venta.**~~ · **ABIERTA Y CERRADA el 2026-09-26.** Hallado al llevar el rastro de lote hasta el comprador: `fiscal.document.issue` resolvía su adquiriente sin compararlo con `sales_sales.customer_id`. **Decisión del propietario: opción 2, «advertir»** —de tres ofrecidas: exigir, advertir, sólo registrar—. Si el adquiriente pedido no es el cliente que nombró la venta —otro cliente, uno cuando la venta fue de mostrador, o ninguno cuando la venta nombró a alguien— la emisión se detiene con `BLOCKED`/`CUSTOMER_MISMATCH` y `customer_mismatch` con los dos identificadores, **sin crear documento ni transmitir**; el operador confirma reenviando con `acknowledge_customer_mismatch: true` y se emite. La comparación vive en el caso de uso, que ya lee la venta (`SqliteFiscalSaleSource` lee ahora `customer_id`), y el `customer_id` pedido es **campo obligatorio** de su entrada: un llamador que lo olvidara no podría saltarse el aviso. Va **antes de crear el documento**: el reintento de un documento ya congelado no pasa por ahí y no se bloquea —bloquearlo dejaría una factura a medias ante la DIAN—. La pantalla de emisión dice los dos adquirientes y ofrece «Emitir de todos modos», que reenvía **la misma petición** que se avisó, no lo que haya en los campos después. **Defecto propio que el aviso destapó**: «Nueva venta» limpiaba el carrito pero **no el campo de cliente**; tras una venta fiada, todas las siguientes del día salían a nombre de ese cliente —comprador falso en el recibo y en el rastro de un retiro—. Lo reveló el E2E fiscal, que empezó a ver el aviso en una venta que debía ser de mostrador. Corregido. Fixtures reconciliadas sin esconder el aviso: las pruebas fiscales siembran la venta a nombre del cliente que facturan, y tres pruebas del canal nombran al cliente en la venta —es el flujo correcto—; la única que factura sin identificar una venta con cliente declara la confirmación y sigue midiendo `D-13`. Pruebas: +5 de caso de uso (tres diferencias sin transmitir, confirmada que emite, reintento que no pregunta), +2 pasos por el canal real (diferencia sin documento; venta de mostrador facturada a un cliente tras confirmar), +2 de contrato, +2 de renderer (confirmar reenvía la petición avisada; nueva venta limpia el cliente) y el E2E fiscal (aviso y confirmación en la ventana, y campo de cliente vacío tras «Nueva venta»). **Seis mutaciones, las seis muerden.** **Segundo tramo — el rastro llega también a la factura, el 2026-09-26.** El documento fiscal no guardaba a quién se facturó: sólo el payload congelado para el proveedor. **`MIGRATION_031`** añade `acquirer_kind` (`IDENTIFIED`/`NOT_IDENTIFIED`, y `NULL` = **no registrado**: un documento anterior no se da por anónimo) y `acquirer_customer_id`, que el caso de uso fija al crear el documento —campo **obligatorio** de `create()`: ningún llamador puede olvidarlo— con el adquiriente **pedido**, no el cliente de la venta. **Hallazgo propio corregido antes de publicar**: el trigger que congela la identidad del documento no cubría las columnas nuevas, y a quién se facturó podía cambiarse mientras el documento no estuviera resuelto; `MIGRATION_031` trae su propio trigger de inmutabilidad. Nueva lectura **`fiscal.document.list`** (tipo 40, Electronic Invoicing): los documentos de una venta con número, estado y adquiriente, incluidos rechazados y fallidos —para un retiro también cuenta a quién se intentó facturar—. Va con `SALES_RECEIPT_READ` —no se inventa permiso— y siempre montada, aunque la emisión no esté configurada. «Compradores del lote» consulta ahora recibo **y** facturas de cada venta: junta al cliente de la venta y al adquiriente de la factura, dice de dónde salió cada uno («venta», «factura» o las dos), una venta sólo cuenta como anónima si nada la nombra **y todo se pudo leer**, y una factura sin adquiriente registrado se declara como hueco del retiro (`ACQUIRER_NOT_RECORDED`). Al abrir una venta, la pantalla muestra sus facturas y «Ver adquiriente de la factura» cuando no es el cliente de la venta. Pruebas: +3 de almacén y caso de uso (permiso; documento sin registro = no registrado; adquiriente inmutable), aserción del adquiriente guardado en la emisión confirmada, +1 paso por el canal real (la venta de mostrador lista su factura a nombre del cliente, que el recibo no puede decir; venta sin factura = lista vacía), +2 de contrato, +2 de renderer (compradores por venta y por factura con el hueco declarado; la factura y su adquiriente al abrir la venta) y el E2E fiscal (la tanda de la venta de mostrador lleva hasta «Cliente Fiscal» por la factura). **Siete mutaciones, las siete muerden.** A9 y `business-readiness` reconciliados: 40 tipos, 38 con pantalla en 16 superficies. | `issue-electronic-document-use-case.ts` · `fiscal-sale-source.ts` · `FiscalPanel.tsx` · `SalePanel.tsx` · `fiscal-issuance.test.ts` («D-40») · `channel-commercial-vertical.test.ts` («adquiriente identificado») · `FiscalPanelMismatch.test.tsx` · `real-channel.spec.ts` | **regla que deja**: una comprobación nueva que empieza a saltar donde no se esperaba no es ruido: es el primer testigo de un defecto que ya estaba |
| D-41 | **`central-authority` no compila en modo estricto y ninguna puerta lo ve.** Medido el 2026-09-26 al añadir `src/authentication/` (`DEC-026`): `pnpm --filter @pos-platform/central-authority typecheck` falla con 7 errores, **todos en ficheros anteriores y no modificados** —`main.ts` (tipos importados de `node:https` que no existen allí; `DeviceEnrollmentTransportPolicy` sin `now`), `wompi-payment-event.ts:82` (`unknown`) y `tests/live-enrollment-e2e.ts`—. Ninguno en `src/authentication/`. La causa de que nadie lo notara: el script raíz `pnpm typecheck` recorre diez paquetes y **`central-authority` no es uno de ellos**; sus pruebas sí corren en `test:runtime`, pero vitest transpila sin comprobar tipos. No se corrige en el mismo cambio que lo encontró, para no mezclar alcance. Se cierra cuando los siete errores estén resueltos **y** el paquete entre en `pnpm typecheck`, en ese orden, porque añadirlo antes pondría la puerta en rojo | `apps/central-authority/src/main.ts` · `wompi-payment-event.ts` · `tests/live-enrollment-e2e.ts` · `package.json` (script `typecheck`) | el servidor central —donde ahora se construye el login— puede acumular errores de tipo sin que CI falle |
| D-42 | ~~**El inventario de dependencias contaba como paquete cualquier `package.json` del almacén de pnpm, y discrepaba del SBOM.**~~ · **ABIERTA Y CERRADA el 2026-09-26.** Lo destapó la primera dependencia central (`apps/api`, NestJS + Fastify, `DEC-026` G-7): `ci:license-gate` falló con «dependency inventory package missing from SBOM». Causa medida: `generate-dependency-inventory.mjs` recorría recursivamente `node_modules/.pnpm` y contaba **todo** `package.json`, incluidos ficheros internos de un paquete —`fast-uri/benchmark`, `secure-json-parse/benchmarks`, `pino/test/fixtures/transport`—, que además no declaran licencia y salían como `MISSING_LICENSE_METADATA`. El SBOM toma los paquetes del grafo de `pnpm list`, que no los incluye: los dos gates tenían definiciones distintas de «paquete». Corrección: sólo cuenta el manifiesto raíz de un paquete instalado (`.pnpm/<id>/node_modules/<nombre>` o `/@scope/<nombre>`). **Comprobado que no oculta nada**: comparando antes y después, el filtro retira exactamente esas 3 claves, las 3 internas, y ningún paquete instalado. Tras la corrección: inventario 378 paquetes y 0 hallazgos, licencias 0 a revisar y 0 denegadas, vulnerabilidades 0 avisos, `ci:supply-chain-tests` 40/40 (+1 prueba nueva) | `tools/ci/generate-dependency-inventory.mjs` (`isInstalledPackageRootManifest`) · `generate-dependency-inventory.test.mjs` | un gate de licencias en rojo por ficheros de benchmark bloquea cualquier dependencia nueva; aceptarlos como excepción habría enseñado a ignorar el gate |
| D-1 | **`PARTIAL`.** **La duración de la retención continúa `NO DEFINIDA`: es una decisión/configuración pendiente, no código de purga que falte.** Revisado y precisado el 2026-09-19. `DEC-007` §1360-1398 fija la **forma** y delega el **valor**: la política debe distinguir `active_retention`, `archive_retention`, `audit_retention` y `legal_retention`; para el outbox, las pendientes se conservan «hasta resolver» y las aceptadas y rechazadas durante un «**periodo mínimo configurable**». `non-functional-requirements.md` §«Objetivos pendientes de benchmark» lista la retención entre los valores que deberán confirmarse con pruebas reales. Cotas aplicables cuando se decida: §288.8 (la clave de idempotencia no se elimina antes del plazo), §298.12 (el inbox conserva su checksum toda la ventana aplicable) y §731 (la retención no puede ser menor que la mayor ventana de retry, recuperación y operación offline); `UC-SYNC-003` añade que una dead letter «no se purga prematuramente». `config.ts` declara nueve claves `POS_*` y ninguna de retención: falta el punto de configuración que `DEC-007` presupone. Sigue sin haber un solo `DELETE`. **Sobre `ARCHIVED` — corregida una imprecisión propia de la revisión previa de ese mismo día, que lo presentaba como contradicción normativa: no lo es.** `DEC-007` §118 y §504 lo definen como estado **terminal conceptual** del ciclo de la operación; `local_sync_outbox.status` representa la **máquina local de despacho** y hoy no lo contiene; y **no existe contradicción entre `SyncServerStatusSchema` y `DEC-007`**, porque ese enum son los veredictos que emite el servidor y `ARCHIVED` no es un veredicto del servidor. Lo que hay es una **laguna de materialización** en la proyección local. Su implementación **depende de la política de retención**, porque `DEC-007` §504 define `ARCHIVED` en función de la conservación posterior al ciclo activo («terminó su ciclo activo y se conserva según retención»): **por tanto no debe añadirse todavía** — sería un estado en el que nada entra y del que nada sale. Se cierra cuando exista la duración decidida; implementar la purga antes sería inventarla | `DEC-007` §1360-1398 · §288.8 · §298.12 · §731 · §118 · §504 · `non-functional-requirements.md` §objetivos pendientes · `MIGRATION_004` (`local-database.ts:105`) · `config.ts` · `durable-sync-store.ts` | crecimiento monótono del archivo SQLite en uso real |
| D-2 | **`BLOCKED`** — por decisión arquitectónica vigente, no por deuda de implementación. Revisado y precisado el 2026-09-19. `DEC-017` §123 **no autoriza construir transporte ni API central**: la ausencia del transporte es consecuencia de la decisión canónica en vigor, y construirlo exige una decisión que la extienda. El outbox en sí está materializado y probado —encolado idempotente, contigüidad, checkpoint monótono, reintento exponencial acotado, dead letter, recuperación de `IN_FLIGHT` al arrancar— pero `claimBatch`, `recordResponse` y `recordTransportFailure` **tienen cero llamadores en `src/`**: sólo los invocan las pruebas. **Corregida una imprecisión propia de la revisión previa de ese mismo día, que afirmaba que «la cadencia y el tamaño de lote no están decididos en ninguna ADR».** Sí hay regla normativa: `DEC-007` §1300 establece que el **límite, el backoff, el jitter, la ventana, las exclusiones y el tratamiento de agotamiento deben provenir de una política técnica versionada** y que **no se hardcodean como números universales**, y §1328 regla 8 establece que el tamaño de lote es configurable. Lo que no existe en el repositorio son los **valores concretos** ni la **política técnica versionada** que `DEC-007` exige. `durable-sync-store.ts:38` tiene defaults de retry —`maxAttempts` 5, `baseDelayMs` 1 000, `maxDelayMs` 60 000— que producción usa porque `main.ts:108` construye el componente sin política; esos valores **todavía no están respaldados por la política técnica versionada** que `DEC-007` exige. El **jitter todavía no está materializado**: `retryDelayMs` no lo aplica. Se cierra cuando exista una decisión que extienda `DEC-017` con transporte y API central, y la política técnica versionada con sus valores | `DEC-017` §123 · `DEC-007` §1300 · §1328.8 · `durable-sync-store.ts:38` · `main.ts:108` · `grep claimBatch apps/pos-local-service/src` → sólo la definición | ningún hecho comercial sale del dispositivo |
| D-3 | La regla que traduce permiso de matriz de producto a forma canónica sólo está escrita caso por caso | `DEC-012` §33.2 la enuncia para `CASH_SHIFT_CLOSE`; no existe enunciado general | cada módulo nuevo la redescubre o la contradice |
| D-4 | **Reducida el 2026-09-20.** `packages/database-core` y `testing` siguen declarados con `src/` vacío. `database-postgres` **ya no**: `ONB-002` lo materializó con el bootstrap transaccional de tenant, probado contra PostgreSQL real | `module-boundaries.json` vs `find` · `packages/database-postgres/src/` | boundaries que no gobiernan nada, en los dos paquetes que siguen vacíos |
| D-5 | `fiscal_total_amount` en `sales_sales` es pricing, no facturación electrónica | `sale-calculation.ts` | lectura errónea de soporte fiscal inexistente |
| D-6 | Numeración comercial (`sales_document_series_counter`) no es numeración fiscal | esquema | reutilizarla violaría la autorización DIAN |
| D-7 | ~~El `switch` de enrutamiento no tiene `default`~~ · **CERRADA 2026-09-06** | rama `default` con asignación a `never` en `local-channel-component.ts` | — |
| D-11 | «Compatible con SIIGO» es **condicional al plan del cliente**: su API suele exigir plan específico o módulo adicional | `provider-payload-shapes.md` §2 | se promete una integración que el cliente puede no tener contratada |
| D-9 | Emitir una factura exige `Customer`, tablas de referencia DIAN, `Catalog` y `Tax`. **Las cuatro están materializadas y son alcanzables por el canal desde 2026-09-07.** Lo que falta ya no es dato sino el ensamblado del cuerpo de emisión y su envío | `provider-payload-shapes.md` §«Lo que este documento deja claro» | el adapter fiscal no puede emitir aunque el proveedor responda: no hay con qué armar el cuerpo |
| D-22 | **Una venta completada no devuelve existencia**, porque `main` todavía no anula ventas: `sales_sales` admite `CANCELLED` pero ningún código lo produce. `SALE_REVERSAL` existe en `MIGRATION_015` y **no tiene emisor**. Se cierra cuando exista anulación de venta o `SaleReturn` (`B11`) | `MIGRATION_015` · `sqlite-payment-store.ts` | un error del cajero deja la mercancía descontada sin forma de devolverla salvo un ajuste manual, que es la vía que `D-21` señala como abusable |
| D-23 | ~~**`sales_sale_items.identifier_snapshot` nunca se puebla.**~~ · **CERRADA 2026-09-19.** `create-sale-use-case.ts` escribía `null` fijo desde el origen, de modo que una venta de un producto con código de barras lo perdía. La creación de venta congela ahora el `barcode` de la presentación con la que se vendió —ya estaba cargado en el mismo bucle que resuelve catálogo y precio, así que no hubo consulta nueva—. `null` sigue significando «esta presentación no declara código», que es distinto de «no se miró». No entra en `calculation_checksum`: el identificador no es dinero. | `create-sale-use-case.ts` · `commercial-core-flow.test.ts` («la venta congela el identificador del producto») · `channel-commercial-vertical.test.ts:860` | — |
| D-21 | **No hay reserva entre crear la venta y cobrarla.** La disponibilidad se comprueba al crear y la salida ocurre al completar; en medio, otra venta o un ajuste pueden llevarse la existencia. **Mitigación medida el 2026-09-20, ya no sólo afirmada:** con dos ventas compitiendo por la misma existencia escasa, ambas se crean —ésa es la ventana, y es real—, sólo una consume, la otra recibe `INSUFFICIENT_STOCK`, la existencia nunca queda negativa y el rechazo **no deja rastro**: ni pago, ni imputación, ni movimiento de caja, ni segunda salida de inventario, y reintentarlo devuelve lo mismo sin escribir nada. El coste que queda es de **experiencia, no de integridad**: un cobro legítimo puede rechazarse en el último paso, con el cliente delante. Se cierra con la reserva que `UC-INVENTORY-002` §90 ya especifica, y esa pieza tiene **dos entradas hoy sin decidir**: la duración de expiración de una reserva (§107 regla 4 exige liberarla por transición explícita y no dice cuándo) y la liberación al anular una venta, que depende de `D-22`, bloqueada | `create-sale-use-case.ts` · `sqlite-payment-store.ts` → `deductSoldStock` · `tests/sale-stock-concurrency.test.ts` (4/4) | con dos cajas sobre la misma base, un cobro legítimo puede rechazarse en el último paso |
| D-20 | Las tablas `sandbox_catalog_product`, `sandbox_catalog_presentation` y `sandbox_price_rule` quedan **huérfanas**: ningún código las lee desde `MIGRATION_014`. No se borran porque pueden tener datos en instalaciones existentes y en SQLite eliminarlas exige reconstruir | `local-database.ts` | esquema muerto que confunde a quien lea el modelo físico |
| D-19 | ~~**`catalog_fiscal_attribute` tiene un lector en producción y cero escritores.**~~ · **CERRADA 2026-09-20.** Ninguna pantalla, ningún caso de uso y ninguna operación del canal podía darle a una presentación su `unit_measure_code`, `standard_code`, `tax_code` y `tax_rate`: sólo lo insertaban los fixtures. La cierra la operación **`catalog.fiscal.attribute.set`**, nueva y no un campo más del alta: un código fiscal equivocado se corrige y el alta ocurre una sola vez, y añadir es menos invasivo sobre una superficie cerrada que modificarla. Valida con `validateFiscalDocumentItem` **antes** de escribir, como exigía esta deuda, sobre un ítem sonda neutro (`quantity`/`unitPrice` unitarios, sin descuento) y filtrando los hallazgos a las rutas del atributo: la tabla comprueba la **forma** de sus códigos con `GLOB`, no su **pertenencia** a las tablas verificadas, y `"95"`/`"998"`/`"99"` se guardarían sin protesta para fallar al emitir. Reutiliza el permiso `CATALOG_PRODUCT_REGISTER`: quien da de alta es quien declara los códigos, y un permiso nuevo exigiría sembrarlo en los roles. **Medido en E2E, no inferido:** con la presentación declarada desde la ventana real, `LINE_FISCAL_ATTRIBUTE_MISSING` desaparece, el mostrador anónimo queda bloqueado por su única causa restante (`GENERIC_ACQUIRER_NOT_VERIFIED`, `D-13`) y con adquiriente identificado la factura llega a **`ISSUED`** con CUFE y número. Ese `ISSUED` es contra el puerto sustituido del arnés (`FakeIssuancePort`); el proveedor real es `F6`. | `ipc-commercial.ts` · `set-fiscal-attribute-use-case.ts` · `sqlite-catalog-store.ts` → `setFiscalAttribute` · `CatalogPanel.tsx` · `channel-commercial-vertical.test.ts` («el escritor que faltaba (D-19)», 7/7) · `AdminPanels.test.tsx` («códigos fiscales (D-19)», 4/4) · `real-channel.spec.ts:864` (16/16 con `xvfb-run`) | — |
| D-18 | **La venta por peso con seis decimales no se puede facturar.** Cuatro de los diez comercios prioritarios venden por peso; `D-14` los golpea directamente. Mitigación disponible hoy: declarar la unidad con `unit_precision` 2 | `business-readiness.md` | una carnicería puede vender y cobrar 333 g y **no** emitir la factura electrónica de esa venta |
| D-16 | La **regla exacta de redondeo de la DIAN** para el impuesto de línea no está verificada en este repositorio. Se trunca, por coherencia con `grossUnits` y porque el pagadero pasa después por `NEAREST_50` | `sale-calculation.ts` | la diferencia queda cuatro órdenes por debajo del incremento que llega al cliente, pero es una elección nuestra, no una regla verificada |
| D-17 | ~~`catalog_fiscal_attribute` **no** cuelga del catálogo real — `MIGRATION_013` sin clave ajena, un atributo fiscal puede quedar apuntando a una presentación borrada~~ · **CERRADA 2026-09-19.** Nació una migración **antes** que el catálogo: cuando se escribió, `catalog_presentation` no existía. `MIGRATION_021` reconstruye la tabla con `FOREIGN KEY (tenant_id, presentation_id) REFERENCES catalog_presentation(tenant_id, id)`, conservando íntegros sus `CHECK`, su clave primaria y sus filas. Cabe reconstruirla donde `sales_sales` no cupo (`D-27`) porque **nadie la referencia**: sin tablas hijas, sin índices propios y sin claves ajenas que rehacer, es el caso de `MIGRATION_008`. La copia comprueba la clave fila a fila, así que un huérfano preexistente detiene el arranque en vez de borrarse en silencio — riesgo nulo en la práctica: ninguna ruta de usuario inserta en esta tabla. La primera frase original («`Catalog` sigue siendo `sandbox_catalog_*`») había quedado obsoleta con `MIGRATION_014`; lo que seguía vivo era la clave ajena. | `MIGRATION_021` · `local-database.test.ts` («MIGRATION_021 — el atributo fiscal cuelga del catálogo») | — |
| D-15 | ~~El ayudante de named pipe agotaba `timeout: 15_000` compilando C# con `Add-Type`~~ · **CERRADA 2026-09-07** | falló en `190b60e` y en `cbee0f8`, **dos diffs que no tocan ese archivo** —el segundo añadía sólo dos imágenes y texto—. Causa real: cada llamada arranca un PowerShell nuevo y **recompila** el tipo C#, así que todas pagan el compilador, no sólo la primera. Timeout a 60 s y **un** reintento acotado, sólo ante `ETIMEDOUT` | — |
| D-14 | **El POS lleva el dinero en escala 6 y el proveedor acepta dos decimales.** Un importe con dígitos significativos más allá del segundo decimal no se puede transmitir con fidelidad | `item.ts` · `toProviderDecimal` devuelve `NOT_REPRESENTABLE`, nunca redondea | una báscula produce `0.333333` kg: esa venta no se puede facturar sin una decisión de negocio previa |
| D-12 | El dígito de verificación del NIT **no se calcula ni se verifica**: se comprueba su forma y su presencia, nunca su valor | `customer.ts` · prueba «un DV con la forma correcta y el valor equivocado NO se detecta» | un DV equivocado con forma válida pasa el filtro y emite contra un tercero que no es |
| D-13 | El adquiriente genérico de la DIAN («consumidor final») **no está verificado**, así que una venta de mostrador anónima **no se puede emitir**: `prepareCustomerForIssuance` bloquea con `GENERIC_ACQUIRER_NOT_VERIFIED` | `customer.ts` | es el caso mayoritario de un POS colombiano y hoy no tiene salida fiscal |
| D-10 | ALEGRA separa crear de timbrar, y un fallo entre ambos pasos deja una factura **creada y sin timbrar** | `provider-payload-shapes.md` §ALEGRA | reintentar a ciegas crearía una segunda factura; es el fallo que ya cerramos para FACTUS, por otra causa y aún abierto para ALEGRA |
| D-8 | ~~`Catalog`, `Inventory` y el dominio de `Payment` en un linaje no integrable~~ · **CERRADA 2026-09-06 por `DEC-018`** | rama reclasificada como referencia de diseño; `frozenSourceAreas` en `module-boundaries.json` lo impone en CI | — |

Corrección de `D-3`, 2026-09-06. La redacción original afirmaba que los permisos
fiscales documentados en minúscula «serían rechazados por el contrato». **Era
falso.** `permission-matrix.md` usa minúscula con puntos para *todos* los
permisos —`authorization.policy.create_draft`, `cash.count.abort`,
`cash.shift.close`—, y `DEC-012` §33.2 documenta la correspondencia:
`CASH_SHIFT_CLOSE` es la forma canónica de `cash.shift.close`. Son dos espacios
de nombres deliberados, no una incompatibilidad. Lo que sí falta, y es lo que
la fila registra ahora, es un enunciado general de esa regla: hoy sólo existe
caso por caso.

Sobre `D-7`: la corrección de PR #37 resolvió la instancia —los cinco `payment.*`
sin `case`— pero no la clase. Un tipo nuevo en el contrato podía volver a caer en
silencio, y el único guardián era una prueba que sólo corre en Windows. La rama
`default` con asignación a `never` convierte ese olvido en **error de
compilación**: verificado quitando `case "payment.cancel"` y observando
`TS2322: Type '{… message_type: "payment.cancel" …}' is not assignable to type
'never'`. La garantía pasó de una prueba de una plataforma a una propiedad del
tipo, comprobada en cada `pnpm typecheck`.

## Incidente de gobierno de `main` — 2026-09-06

`main` quedó en rojo tras mergear #43, y la causa **no fue el diff**: fue el
método de merge que usé.

El workflow tiene un control compensatorio, `Main push governance`, que exige
que **todo commit de primera línea en `main` sea un merge commit** creado por
GitHub y sea el `merge_commit_sha` de un PR mergeado contra `main`
(`tools/ci/validate-main-push-history.sh`). Mergeé #42 y #43 con *squash*, que
produce un commit de un solo padre. El gate los rechazó:

```
main introduced non-merge commit 57a4703149b2dd1a6f2039568498a67b20e743ab.
Direct pushes and squash/rebase merges are not accepted.
```

Verificado sobre `origin/main`: los PRs #36 a #41 tienen dos padres cada uno y
pasaron el gate; `8850179` (#42) y `57a4703` (#43) tienen uno solo. Son los dos
únicos commits de la historia de `main` que incumplen el control, y los dos son
míos. Contradice además una instrucción explícita del propietario: «un solo PR
no significa squash obligatorio, conservar la trazabilidad».

**Qué se corrige y qué no.** El gate valida el rango introducido por cada push,
así que el siguiente merge correcto devuelve `main` a verde. Eso es lo que se
hace. Lo que **no** se corrige es la historia: los dos commits siguen ahí, y
reescribir `main` es destructivo y no se hace sin autorización expresa del
propietario. Queda como cicatriz registrada, no como problema resuelto.

Regla operativa que se deriva: en este repositorio los PRs se integran con
**merge commit**, nunca con squash ni rebase.

**Cumplida desde entonces, verificado el 2026-09-06.** Los primeros padres de
`main` tras el incidente tienen dos padres cada uno:

```
f9987f2 d2dc4e8 a77afd4   (#57)
d2dc4e8 674aa1a ec57f40   (#56)
674aa1a 3b1a42f 50beae0   (#55)
```

Antes de mergear #57 se probó la combinación **localmente sobre el resultado
fusionado**, no cada PR por separado: dos PRs verdes en aislamiento pueden
romperse al juntarse. `git merge origin/main` sobre la cabeza de #57 resolvió sin
conflicto, y sobre el árbol resultante: 114 pruebas pasan, 2 omitidas, `typecheck`
PASS, ARCH-003 PASS, política de repositorio PASS.

## Linaje preservado — hallazgo del 2026-09-06

La auditoría forense concluyó que `Catalog` e `Inventory` «no existen». **Era
cierto del remoto y falso del disco del propietario.** Al preparar la publicación
de la etiqueta de archivado apareció un volumen grande de trabajo sin commitear
sobre `domain/cash-open-vertical-20260901`. Se preservó antes de tocar nada:

`wip/local-catalog-inventory-payment-20260906` → `a10249fe5c48c7e1e162b3cc2ee2264ae09485ef`
· 145 archivos, 14 654 inserciones · publicado en el remoto.

### Qué contiene

| Área | Contenido |
|---|---|
| Catalog | `product`, `product-identifier`, `product-presentation`, `product-variant`, `variant-attributes`, `unit-conversion`, `conversion-factor`, 6 eventos de dominio, repositorios SQLite y PostgreSQL, casos de uso `create-product`, `update-product`, `deactivate-product`, `define-conversion`, con pruebas |
| Inventory | `inventory-movement`, `inventory-reservation`, `inventory-transfer`, `inventory-transfer-line`, `lot`, `on-hand-quantity`, `stock-balance`, 6 eventos, repositorios, 9 casos de uso (reserva, consumo, liberación, ajuste, merma, y el ciclo completo de traslado), con pruebas |
| Payment | dominio `payment`, `payment-attempt`, `payment-method`, `merchant-collection-identifier`, 4 eventos, puertos de autorización y autenticidad, casos de uso `initiate-payment` y `confirm-payment` |
| Migraciones | `005_catalog_foundation` y `006_inventory_foundation` (PostgreSQL), con pruebas |

### Por qué no se integra por merge, y qué se decidió

Verificado sobre el remoto el 2026-09-06:

```
git merge-base --is-ancestor 503aeb141ee323c822e5c95ad86022dbdb8f0f8a \
  origin/wip/local-catalog-inventory-payment-20260906   →   cierto
```

La rama **desciende del linaje hexagonal archivado**. `DEC-017` §4.4 prohíbe
integrarlo por merge o `cherry-pick`, y la razón es medible:

| Plano | Estado | Evidencia |
|---|---|---|
| PostgreSQL `001`–`003` | **idénticos byte a byte** a `main` | comparación de blob SHA |
| PostgreSQL `004`–`006` | **no existen en `main`** — adición pura, sin colisión de numeración | `git ls-tree` de ambas ramas |
| SQLite `MIGRATION_001`–`010` | **los diez divergen** del cuerpo homónimo en `main` | SHA-256 por cuerpo de migración |

La colisión de identidad de `DEC-017` §3 es **exclusivamente del plano SQLite**.
Diez migraciones comparten número y difieren en contenido: mezclarlas rompería
el linaje de checksums de cualquier base instalada. En PostgreSQL no hay
colisión: `004`, `005` y `006` son números libres en `main`.

De ahí se sigue que **el rescate no es una decisión única sino dos**, y tienen
coste muy distinto:

1. **Dominio y aplicación puros** (`packages/domain/src/{catalog,inventory,payment}`,
   casos de uso y sus pruebas) no tocan migraciones. Su obstáculo es de forma
   arquitectónica —puertos hexagonales frente al patrón canónico de `DEC-017`—
   no de identidad de migraciones.
2. **Persistencia SQLite** (`packages/database-sqlite/src/sqlite-*-repository.ts`)
   sí depende del esquema divergente y **no es portable tal cual**: requiere
   migraciones nuevas `MIGRATION_012` en adelante sobre el esquema de `main`.

**Decidido en `DEC-018` (2026-09-06): no se porta código, ninguna de las dos.**

Tres hallazgos lo forzaron, y el primero invalida la recomendación previa de
«rescatar el dominio puro»:

1. `Payment` y `Cash` del linaje **duplican capacidades que `main` ya tiene
   canónicas y probadas de extremo a extremo**. Su `PaymentMethod` es más ancho
   —nueve métodos frente a dos—, pero más ancho sobre el papel no es más
   avanzado.
2. Los 30 archivos de dominio del linaje dependen de `../money.js`,
   `../quantity.js`, `../tenant-scope.js`, `../company-scope.js` y
   `../actor.js`, **ninguno de los cuales existe en `main`**. `main` implementa
   el dinero como funciones en `apps/pos-local-service/src/payments/money.ts`.
   Misma invariante, dos representaciones — y `DEC-017` §3 ya registró que un
   segundo modelo de dinero «introduciría dos verdades sobre el mismo importe».
3. `DEC-017` §4.2 **prohíbe expresamente** ampliar `packages/domain` y
   `packages/application`, que es justo lo que el porte exigiría.

La rama se reclasifica a **referencia de diseño**, mismo estatus que el linaje
archivado. Se conserva como la especificación más detallada que existe de
`Catalog`, `Inventory` y de los siete métodos de pago que `main` no soporta.
`Catalog` e `Inventory` se implementarán en `apps/pos-local-service/src/` con la
representación monetaria de `main` y migraciones desde `MIGRATION_012`.

**Prohibido:** reimplementar `Catalog` o `Inventory` desde cero sin haber leído
antes esta rama. Y ya no depende de que alguien lo recuerde: `frozenSourceAreas`
en `module-boundaries.json` hace fallar CI si aparece un área nueva bajo el
`src/` de esos dos paquetes.

## Linaje archivado

`archive/cash-hexagonal-20260902` → `503aeb141ee323c822e5c95ad86022dbdb8f0f8a`
**Publicada en el remoto el 2026-09-06** (objeto anotado `f153e8b`).

Arquitectura hexagonal detenida el 2026-09-02: dominio puro, casos de uso con
puertos, adaptadores PostgreSQL, migración `004_cash_foundation` y 16 suites de
prueba. **No integrable** por colisión de identidad de migraciones (`DEC-017` §3).

Consultable como referencia de diseño para `Catalog`, `Inventory`, `CashCount` y
`CashDifferenceReview`. Prohibido integrarlo por merge o `cherry-pick`.
