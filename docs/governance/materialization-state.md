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
| D-28 | **El ancla de confianza existe y está vacía: no hay emisor.** `local_trust_anchor` (`MIGRATION_022`) ya es el origen real del mapa de claves de los tres verificadores, y `main.ts` lo cablea, pero **nada la puebla en producción**: la emisión de material criptográfico es `LIC-003`/`DEV-003`, que `DEC-011` deja `BLOCKED` «hasta disponer de material real» y sin admitir autofirmados. La consecuencia operativa es exacta y no se disimula: un equipo real arranca con `security.trust_anchors {session_assertion: 0, …}`, `session.activate` rechaza toda SSA y **las 25 operaciones comerciales siguen ruteadas y ninguna alcanzable**. Lo que se cerró fue la ausencia de origen, no la de emisor. Se cierra cuando exista una autoridad que emita, o un procedimiento de aprovisionamiento inicial autorizado por ADR | `MIGRATION_022` · `sqlite-trust-anchor-store.ts` · `main.ts` · `tests/trust-anchor-chain.test.ts` («sin anclas, session.activate rechaza una SSA por lo demás correcta») | el POS no atiende una sola venta en un equipo real; es el comportamiento fail-closed correcto, no un defecto, y por eso es deuda y no bug |
| D-29 | ~~**El outbox persistía el `payload_checksum` que enviaba el llamador.**~~ · **ABIERTA Y CERRADA el 2026-09-20.** La unificación de ramas borró de `DurableSyncStore.enqueue` la recomputación `payload_checksum: checksum(parsed.payload)` **y la prueba que la fijaba**, de modo que el outbox guardaba `input.requestChecksum` —digest de la *petición*: `idempotency_key`, `operator_user_id`, importes— en un campo que describe el *payload*. `central-sync-server.ts:92` recalcula `payloadChecksum(operation.payload)` y rechaza con `SYNC.PAYLOAD_CHECKSUM_MISMATCH`, así que **toda** operación del outbox habría sido rechazada por el central. Medido con sonda sobre SQLite real, no inferido: persistido `01bdbf79…`, recalculado por el central `6f2848ce…`, no coinciden. Restaurado con su comentario y su prueba; verificado que la prueba muerde —reintroduciendo la regresión, `sync-store.test.ts` cae a 1 failed / 5 passed— y que no rompe nada (857 passed / 5 skipped). **Por qué no la vio ninguna puerta:** la única que compara los dos lados es el Central Sync Persistence Gate, y no se ha ejecutado nunca —CI no asigna runner desde el 2026-09-14—. Falta ejecutarlo de extremo a extremo contra PostgreSQL: `REQUIRES_LOCAL_VERIFICATION` | `durable-sync-store.ts` · `sync-store.test.ts` («persists payload_checksum from canonical payload bytes…») · `central-sync-server.ts:92` · `docs/governance/branch-duplication-audit-2026-09-20.md` | **regla que deja**: un valor que llega del llamador no es autoridad **aunque el esquema lo exija**; si un consumidor lo recalcula, el escritor tiene que recalcularlo también |
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
