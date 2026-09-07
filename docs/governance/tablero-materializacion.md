# Tablero de materialización — estructura permanente

## Para qué existe este documento

El propietario mantiene un **tablero físico**. Un tablero físico no se puede
reescribir cada semana: si cambian las filas, deja de servir para comparar.

Por eso aquí se congela **la estructura** —bloques, capacidades, escalera de
valor y ubicación— y se deja **una sola columna móvil: el nivel**. De sesión a
sesión sólo se mueven porcentajes; las filas se quedan donde están.

Añadir una capacidad nueva es un cambio de estructura y se registra como tal, con
la fecha, para que un porcentaje de hoy nunca se compare contra un tablero de
composición distinta.

## Escalera de valor — permanente, no se renegocia

Es la escalera de las instrucciones del proyecto, con un número por peldaño para
poder promediar. **Es progresiva**: no se puede estar en un peldaño sin cumplir
todos los anteriores.

| Peldaño | Valor | Qué exige |
|---|---|---|
| — | **0** | no existe código ni documento específico |
| `DOCUMENTED` | **15** | existe documentación específica de la capacidad |
| `MATERIALIZED` | **40** | existe código en `main` y esta tabla dice en qué ruta |
| `TESTED` | **60** | una prueba **ejecuta** el comportamiento y se observó el resultado |
| `REVIEWED` | **70** | una persona revisó y aprobó explícitamente |
| `CANONICALLY_APPLIED` | **85** | en `main`, con CI verde, y **alcanzable de extremo a extremo** |
| `PRODUCTION_READY` | **100** | validado en el entorno de producción objetivo |

### Dos reglas de corte que evitan inflar el tablero

1. **Alcanzable ≠ materializado.** Es la lección que dejó Payment V1: estaba
   implementado y probado, y aun así ningún cliente podía usarlo porque faltaba
   el enrutamiento. Una capacidad probada pero que el runtime no instancia
   **se queda en 60**, no sube a 85.
2. **Un adapter no vale más que su puerto peor verificado.** Ya es una propiedad
   del tipo (`overallVerification` es el mínimo), y aquí se aplica igual: cada
   puerto puntúa por separado.

### Dónde encaja la escalera de verificación fiscal

`NOT_EVALUATED` → `MOCK_TESTED` → `SANDBOX_VERIFIED` → `PRODUCTION_VERIFIED` →
`CERTIFIED` es una escalera **distinta**, sobre la evidencia de proveedor. Se
traduce así, y sólo así:

- `MOCK_TESTED` → tope **60**. Un fake determinista prueba que *el adapter* se
  comporta bien ante una respuesta dada, no que el proveedor la produzca.
- `SANDBOX_VERIFIED` → puede llegar a **85** si además está en `main` con CI
  verde. Salió a la red y el proveedor real respondió.
- `PRODUCTION_VERIFIED` → condición necesaria para **100**.

---

## El tablero

**56 capacidades en 5 bloques.** Estructura congelada el 2026-09-06.

### Bloque A — Plataforma local · 14 capacidades

| # | Capacidad | Nivel | Valor |
|---|---|---|---|
| A1 | SQLite `MIGRATION_001..011` | `CANON` | 85 |
| A2 | Idempotencia (`runtime_operations`) | `CANON` | 85 |
| A3 | Identidad de dispositivo y licencia (tablas) | `CANON` | 85 |
| A4 | Auditoría append-only | `CANON` | 85 |
| A5 | Outbox / inbox / checkpoint / dead-letter | `CANON` | 85 |
| A6 | SSA y binding de sesión | `CANON` | 85 |
| A7 | Proyección de autorización | `CANON` | 85 |
| A8 | Master snapshot | `CANON` | 85 |
| A9 | Canal IPC comercial (14 tipos) | `CANON` | 85 |
| A10 | Enrutamiento del canal → superficie comercial | `CANON` | 85 |
| A11 | Shell Electron (main, preload, allowlist) | `CANON` | 85 |
| A12 | Logger estructurado | `CANON` | 85 |
| A13 | Ciclo de seguridad local (DPAPI, identidad, licencia) | `TESTED` | 60 |
| A14 | Adquisición de snapshot de autorización (SAS-003) | `TESTED` | 60 |

**A13 y A14 se quedan en 60 por la regla 1**: tienen código y prueba en `main`,
y `main.ts` **no las instancia**. Verificado: `main.ts` cablea cinco componentes
—`LocalDatabaseComponent`, `DurableSyncComponent`, `OperationConfirmationComponent`,
`CommercialComponent`, `LocalChannelComponent`— y ninguno es éstas.
`LocalSecurityLifecycle` sólo aparece en su propio archivo y en su prueba.

**Bloque A = 1140 / 14 = 81 %**

### Bloque B — Núcleo comercial · 12 capacidades

| # | Capacidad | Nivel | Valor |
|---|---|---|---|
| B1 | Sales V1 (venta → `READY_FOR_PAYMENT`) | `CANON` | 85 |
| B2 | Cash V1 (apertura y cierre de turno) | `CANON` | 85 |
| B3 | Payments V1 (`CASH`, `TRANSFER`, cobertura) | `CANON` | 85 |
| B4 | Completado de venta como único punto | `CANON` | 85 |
| B5 | Frontera Payments ↔ Cash | `CANON` | 85 |
| B6 | Catalog | `DOCUMENTED` | 15 |
| B7 | Inventory | `DOCUMENTED` | 15 |
| B8 | Pricing | `DOCUMENTED` | 15 |
| B9 | Tax (motor de impuestos) | `CANON` | 85 |
| B10 | Customer / adquiriente | `CANON` | 85 |
| B11 | SaleReturn, notas crédito y débito | `DOCUMENTED` | 15 |
| B12 | Periféricos POS | `DOCUMENTED` | 15 |

**B6 y B7 tienen implementación completa, pero no en `main`**: viven en
`wip/local-catalog-inventory-payment-20260906`, y `DEC-018` decidió no portarlas.
El tablero puntúa `main`, así que valen 15. Que exista trabajo hecho en otro
linaje no cambia lo que el POS puede hacer hoy.

**B8 y B9 tienen tabla pero no motor**: `sandbox_price_rule` y un `tax_snapshot`
que es TEXT congelado. Una tabla sin regla que la calcule no es la capacidad.

**B10 pasa a 85 el 2026-09-07.** La capacidad es la forma canónica más la
persistencia más el camino: `FiscalCustomer` en el paquete fiscal,
`MIGRATION_012` y el módulo `customers/` en el servicio local, y
`customer.register` · `customer.get` · `customer.find` en el canal, con prueba
de extremo a extremo por el handler de producción. **No se añade fila**: las
tres partes son una sola capacidad, y partirla en tres inflaría el tablero sin
que el POS haga nada más.

**B9 pasa a 85 el 2026-09-07.** El impuesto se calcula por línea desde la tasa
que declara `catalog_fiscal_attribute`, se congela en el snapshot de la línea y
llega al canal por `sale.create`. **B6 se queda en 15**: el catálogo sigue
siendo `sandbox_catalog_*` y sólo se le añadieron atributos fiscales; que el
impuesto ya funcione no materializa el catálogo.

**Bloque B = 670 / 12 = 56 %**

### Bloque C — Plano fiscal · 15 capacidades

| # | Capacidad | Nivel | Valor |
|---|---|---|---|
| C1 | Cinco puertos por capacidad | `CANON` | 85 |
| C2 | Declaración tipada de credencial (`D-3`) | `CANON` | 85 |
| C3 | Matriz de capacidades y verificación cruzada | `CANON` | 85 |
| C4 | Escalera de verificación (`D-4`) | `CANON` | 85 |
| C5 | Saldo de bolsa como proyección (`D-5`) | `CANON` | 85 |
| C6 | Tablas de códigos DIAN (parciales, fuente verificada) | `CANON` | 85 |
| C7 | FACTUS · validación de configuración | `CANON` · `SANDBOX_VERIFIED` | 85 |
| C8 | FACTUS · rango de numeración | `CANON` · `SANDBOX_VERIFIED` | 85 |
| C9 | FACTUS · emisión de documento | `TESTED` · `MOCK_TESTED` | 60 |
| C10 | FACTUS · consulta de estado | `TESTED` · `MOCK_TESTED` | 60 |
| C11 | FACTUS · artefacto (XML / PDF) | `TESTED` · `MOCK_TESTED` | 60 |
| C12 | Adapter SIIGO | `DOCUMENTED` | 15 |
| C13 | Adapter ALEGRA | `DOCUMENTED` | 15 |
| C14 | Esquema fiscal central (10 tablas `fiscal.*`) | `MATERIALIZED` | 40 |
| C15 | Contingencia y reconciliación fiscal ejecutables | `DOCUMENTED` | 15 |

**C9, C10 y C11 no están en 60 por falta de ganas.** Emitir exige `Customer`,
tablas de referencia DIAN, `Catalog` y `Tax` (`D-9`). C6 acaba de cerrar la
primera de las cuatro; las otras tres son B10, B6 y B9 de este mismo tablero.
**El bloqueo es nuestro, no de FACTUS.**

**C14 se queda en 40 aunque esté en `main` con CI verde**: no tiene prueba que
ejecute su comportamiento ni un solo consumidor. Aplicar la regla progresiva es
lo que impide contarlo como 85.

**Bloque C = 945 / 15 = 63 %**

### Bloque D — Plataforma central y transporte · 6 capacidades

| # | Capacidad | Nivel | Valor |
|---|---|---|---|
| D1 | PostgreSQL migrations 001 / 002 / 003 | `CANON` | 85 |
| D2 | Aplicación central que use el esquema | — | 0 |
| D3 | API central | `DOCUMENTED` | 15 |
| D4 | Transporte saliente local → central | `DOCUMENTED` | 15 |
| D5 | Ingesta central y reconciliación | `DOCUMENTED` | 15 |
| D6 | Identidad y licencia central (emisión, revocación) | `DOCUMENTED` | 15 |

**D2 vale 0, no 15**: `packages/database-postgres/src` está **vacío**. Es la
deuda `D-4` — un boundary declarado que no gobierna nada.

**D4 es la deuda `D-2`, y es la más cara del proyecto**: sin cliente HTTP
saliente, todo hecho comercial queda `PENDING` para siempre. El outbox (A5) está
en 85 y aun así **ningún dato sale del dispositivo**. Un bloque puede estar alto
y la cadena seguir rota; por eso el tablero se lee por bloques *y* por deudas.

**Bloque D = 145 / 6 = 24 %**

### Bloque E — Entrega y operación · 9 capacidades

| # | Capacidad | Nivel | Valor |
|---|---|---|---|
| E1 | Validación TARGET (5 jobs) | `CANON` | 85 |
| E2 | CodeQL SAST | `CANON` | 85 |
| E3 | SBOM · licencias · vulnerabilidades · provenance | `CANON` | 85 |
| E4 | Gobernanza de merge de `main` | `CANON` | 85 |
| E5 | Boundaries ARCH-003 + `frozenSourceAreas` | `CANON` | 85 |
| E6 | Strix (pentest con IA) | `MATERIALIZED` | 40 |
| E7 | E2E Playwright | `DOCUMENTED` | 15 |
| E8 | Instalador NSIS y firma de código | `DOCUMENTED` | 15 |
| E9 | Despliegue y operación en producción | `DOCUMENTED` | 15 |

**E6 vale 40 y no 85**: el workflow está en `main` y el gate es correcto, pero
**nunca ha ejecutado un pentest**. Sin `STRIX_LLM` ni `LLM_API_KEY` emite
`::warning title=Strix penetration test NOT RUN::` y termina en verde. Un job
verde que no corrió no es una capacidad probada, y el gate se escribió
precisamente para que eso se vea en vez de esconderse.

**E7 vale 15**: hay `playwright.config.ts` y un README, y **cero ficheros
`*.spec.ts`**. Configuración no es cobertura.

**E8 vale 15**: `electron-builder` **no aparece en el lockfile**. `DEC-010` lo
documenta; nada lo implementa.

**Bloque E = 510 / 9 = 57 %**

---

## Totales

| Bloque | Capacidades | Puntos | % |
|---|---|---|---|
| A · Plataforma local | 14 | 1140 | **81 %** |
| B · Núcleo comercial | 12 | 670 | **56 %** |
| C · Plano fiscal | 15 | 945 | **63 %** |
| D · Central y transporte | 6 | 145 | **24 %** |
| E · Entrega y operación | 9 | 510 | **57 %** |
| **GLOBAL** | **56** | **3410** | **61 %** |

**33 de 56 capacidades en `CANONICALLY_APPLIED`. Ninguna en `PRODUCTION_READY`.**

El global es la media simple de las 56 capacidades, no una media de los cinco
bloques: ponderar por bloque haría que D —seis filas— pesara lo mismo que C
—quince—, y eso no describe el proyecto.

## Censo de pruebas — ejecutado el 2026-09-07 sobre `2b2b81d` + adquiriente

Los porcentajes de arriba se apoyan en esto, no en una impresión. Comandos
ejecutados en este contenedor, con el resultado observado:

| Comando | Proyecto | Resultado |
|---|---|---|
| `pnpm test:contracts` | `@pos-platform/contracts` | 230 pasan |
| `pnpm test:domain` | `@pos-platform/domain` | 47 pasan |
| `pnpm test:application` | `@pos-platform/application` | 16 pasan |
| `pnpm test:runtime` | `database-sqlite` | 37 pasan |
| `pnpm test:runtime` | `observability` | 4 pasan |
| `pnpm test:runtime` | `pos-local-service` | 389 pasan · 4 omitidas |
| `pnpm test:runtime` | `pos-desktop` | 63 pasan |
| `pnpm test:fiscal-adapters` | `fiscal-adapters` | 170 pasan · 2 omitidas |
| `pnpm test:migrations:sqlite` | `target-migrations` | 13 pasan |
| **Total** | 9 proyectos | **969 pasan · 6 omitidas · 0 fallos** |

| Verificación | Resultado |
|---|---|
| `pnpm typecheck` | PASS · 13 proyectos, `tsc --noEmit` |
| `pnpm architecture:check` | PASS · ARCH-003 |
| `pnpm ci:repository-policy` | PASS · 500 archivos rastreados |

**Qué acreditan las 6 omitidas, y por qué no son un hueco oculto:**

- **4** en `pos-local-service` son la prueba de enrutamiento del canal, que sólo
  corre en Windows. En Windows se ejecutan.
- **2** en `fiscal-adapters` son la suite de sandbox de FACTUS: sólo corre con
  las cuatro variables de entorno reales y **nunca en CI**. El 2026-09-06 se
  ejecutó en la máquina del propietario: **103 de 103, cero omitidas**. Es esa
  ejecución la que sostiene C7 y C8 en 85.

`pnpm test:migrations:postgres` queda **`NOT_EVALUATED`** aquí: exige una
instancia PostgreSQL que este contenedor no tiene. No se declara PASS lo que no
se ejecutó.

## Cómo se actualiza

1. Se cambia **sólo la columna `Nivel`** de las filas afectadas.
2. Se recalcula el total del bloque y el global.
3. Se añade una línea al historial.
4. Si hay que **añadir o quitar una fila**, se registra como cambio de
   estructura con fecha: un porcentaje sólo es comparable contra otro del mismo
   tablero.

## Historial

| Fecha | Global | Qué movió |
|---|---|---|
| 2026-09-06 | **58 %** | estructura congelada · sandbox de FACTUS verde (C7 y C8 a 85) · verificación por puerto · tablas de códigos DIAN (C6 a 85) |
| 2026-09-07 | **60 %** | adquiriente materializado, persistido y alcanzable por el canal (B10 a 85) · `MIGRATION_012` · 915 pruebas |
| 2026-09-07 | **61 %** | el impuesto deja de ser cero: motor por línea desde el catálogo (B9 a 85) · `MIGRATION_013` · una sola aritmética de dinero · 958 pruebas |
| 2026-09-07 | **61 %** | **el tablero no se mueve**: `unit_precision` pasa a gobernar la cantidad, pero es un defecto corregido dentro de `Sales V1`, que ya estaba en `CANON`. 964 pruebas |
| 2026-09-07 | **61 %** | auditoría del trabajo propio: cifras contradictorias corregidas, el pago de cero deja de ser válido, `D-19` registrada. **El tablero tampoco se mueve.** 969 pruebas |
