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

## Estado verificado sobre `f9987f2` (2026-09-06)

> El **tablero** —bloques, capacidades, escalera de valor y porcentajes— vive en
> [`tablero-materializacion.md`](./tablero-materializacion.md). Aquel documento
> congela la estructura para que sólo se muevan los porcentajes; éste registra la
> evidencia por capacidad. **Ninguno reemplaza al otro y ninguno puede
> contradecirlo: si discrepan, manda el código.**
>
> Censo del 2026-09-08: **1021 pruebas pasan, 6 omitidas, 0 fallos** en 9
> proyectos. `pnpm typecheck` PASS · `pnpm architecture:check` PASS ·
> `pnpm ci:repository-policy` PASS (513 archivos).
>
> El desglose por proyecto y comando vive en el
> [tablero](./tablero-materializacion.md); **esta cabecera no lo duplica**,
> porque duplicar una cifra es garantizar que una de las dos copias envejezca —
> pasó con esta misma línea, que decía 915 cuando ya iban 964.
> `pnpm test:migrations:postgres` **`NOT_EVALUATED`**: exige una instancia
> PostgreSQL que el entorno de verificación no tiene.

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
| Adquisición de snapshot de autorización (SAS-003) | `.../authorization/snapshot-acquisition.ts` | cero referencias fuera del propio archivo |
| Esquema fiscal central | `003_*.up.sql` | ningún consumidor |

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
| D-1 | `local_sync_outbox` no tiene purga ni retención | cero `DELETE` en `durable-sync-store.ts` | crecimiento monótono del archivo SQLite en uso real |
| D-2 | Sin transporte, todo queda `PENDING` de forma permanente | sin cliente HTTP saliente | ningún hecho comercial sale del dispositivo |
| D-3 | La regla que traduce permiso de matriz de producto a forma canónica sólo está escrita caso por caso | `DEC-012` §33.2 la enuncia para `CASH_SHIFT_CLOSE`; no existe enunciado general | cada módulo nuevo la redescubre o la contradice |
| D-4 | `packages/database-core`, `database-postgres` y `testing` declarados con `src/` vacío | `module-boundaries.json` vs `find` | boundaries que no gobiernan nada |
| D-5 | `fiscal_total_amount` en `sales_sales` es pricing, no facturación electrónica | `sale-calculation.ts` | lectura errónea de soporte fiscal inexistente |
| D-6 | Numeración comercial (`sales_document_series_counter`) no es numeración fiscal | esquema | reutilizarla violaría la autorización DIAN |
| D-7 | ~~El `switch` de enrutamiento no tiene `default`~~ · **CERRADA 2026-09-06** | rama `default` con asignación a `never` en `local-channel-component.ts` | — |
| D-11 | «Compatible con SIIGO» es **condicional al plan del cliente**: su API suele exigir plan específico o módulo adicional | `provider-payload-shapes.md` §2 | se promete una integración que el cliente puede no tener contratada |
| D-9 | Emitir una factura exige `Customer`, tablas de referencia DIAN, `Catalog` y `Tax`. **Las cuatro están materializadas y son alcanzables por el canal desde 2026-09-07.** Lo que falta ya no es dato sino el ensamblado del cuerpo de emisión y su envío | `provider-payload-shapes.md` §«Lo que este documento deja claro» | el adapter fiscal no puede emitir aunque el proveedor responda: no hay con qué armar el cuerpo |
| D-22 | **Una venta completada no devuelve existencia**, porque `main` todavía no anula ventas: `sales_sales` admite `CANCELLED` pero ningún código lo produce. `SALE_REVERSAL` existe en `MIGRATION_015` y **no tiene emisor**. Se cierra cuando exista anulación de venta o `SaleReturn` (`B11`) | `MIGRATION_015` · `sqlite-payment-store.ts` | un error del cajero deja la mercancía descontada sin forma de devolverla salvo un ajuste manual, que es la vía que `D-21` señala como abusable |
| D-21 | **No hay reserva entre crear la venta y cobrarla.** La disponibilidad se comprueba al crear y la salida ocurre al completar; en medio, otra venta o un ajuste pueden llevarse la existencia. Mitigado —no resuelto— porque el cobro entero se revierte en ese caso, de modo que nunca queda existencia negativa ni venta cobrada sin mercancía | `create-sale-use-case.ts` · `sqlite-payment-store.ts` → `deductSoldStock` | con dos cajas sobre la misma base, un cobro legítimo puede rechazarse en el último paso |
| D-20 | Las tablas `sandbox_catalog_product`, `sandbox_catalog_presentation` y `sandbox_price_rule` quedan **huérfanas**: ningún código las lee desde `MIGRATION_014`. No se borran porque pueden tener datos en instalaciones existentes y en SQLite eliminarlas exige reconstruir | `local-database.ts` | esquema muerto que confunde a quien lea el modelo físico |
| D-19 | `catalog_fiscal_attribute` comprueba la **forma** de sus códigos DIAN, no su **pertenencia** a las tablas verificadas. Hoy no hay ruta de usuario que inserte —sólo el fixture de pruebas—, pero el caso de uso que se escriba tiene que validar con `validateFiscalDocumentItem` antes de guardar | `MIGRATION_013` · `dian/item.ts` | un atributo con `unit_measure_code: "KGM"` se guardaría y sólo fallaría al emitir |
| D-18 | **La venta por peso con seis decimales no se puede facturar.** Cuatro de los diez comercios prioritarios venden por peso; `D-14` los golpea directamente. Mitigación disponible hoy: declarar la unidad con `unit_precision` 2 | `business-readiness.md` | una carnicería puede vender y cobrar 333 g y **no** emitir la factura electrónica de esa venta |
| D-16 | La **regla exacta de redondeo de la DIAN** para el impuesto de línea no está verificada en este repositorio. Se trunca, por coherencia con `grossUnits` y porque el pagadero pasa después por `NEAREST_50` | `sale-calculation.ts` | la diferencia queda cuatro órdenes por debajo del incremento que llega al cliente, pero es una elección nuestra, no una regla verificada |
| D-17 | `Catalog` sigue siendo `sandbox_catalog_*`. `catalog_fiscal_attribute` **no** cuelga de él —sobrevive al catálogo real— pero eso admite atributos huérfanos | `MIGRATION_013` sin clave ajena | un atributo fiscal puede quedar apuntando a una presentación borrada |
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
