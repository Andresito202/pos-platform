# Gate — adapters fiscales multi-proveedor

## Estado

`DECISIÓN PENDIENTE` — 2026-09-06. **No autoriza implementar nada.**

No crea paquetes, no crea puertos, no escribe adapters, no toca el núcleo
comercial. Reúne lo que hay que decidir para que «nuestro POS es compatible con
Alegra» sea una afirmación demostrable y no comercial.

## 1. El problema que resuelve

Un cliente pregunta si el POS funciona con su proveedor. Responder «sí» sólo es
honesto si existe evidencia ejecutada contra ese proveedor. Hoy no existe
ninguna: `provider-integration-matrix.md` registra los cinco proveedores como
`DESIGNED` o `FUTURE`, todos con verificación `NOT_EVALUATED`.

La regla de aceptación de esa matriz ya lo fija y no se relaja aquí: *ningún
provider obtiene PASS por compilar, pasar mocks, tener DTOs o mostrar
`Connected`*.

## 2. Hallazgo que condiciona todo el diseño

**Lo que cada proveedor entrega al cliente es estructuralmente distinto.** No es
una diferencia de nombres: es de forma, de ciclo de vida y de quién aporta cada
pieza.

| | SIIGO | FACTUS | ALEGRA |
|---|---|---|---|
| Valores del cliente | `username`, `access_key` | `client_id`, `client_secret`, `username`, `password` | API `email`, API `token` |
| Nº de valores | 2 | **4** | 2 |
| Aporta la plataforma | **`Partner-Id`** (nuestro, no del cliente) | ninguno verificado | ninguno verificado |
| Transporte de auth | Bearer/JWT | OAuth2 password grant | HTTP Basic |
| Ciclo del token | corto, `expires_in`, re-autenticar | `access_token` + **`refresh_token`** | largo hasta rotación, **sin refresh** |
| Origen de la credencial | Siigo Nube → Alianzas → Mi Credencial API | portal Factus | Configuración → API - Integraciones |
| Nunca es | la contraseña de la cuenta | — | **la contraseña de la cuenta** |

Fuente: `docs/architecture/provider-integration-matrix.md`, verificada contra
documentación oficial el 2026-08-17. La fila de FACTUS quedó confirmada además
contra credenciales de sandbox reales el 2026-09-06.

**Consecuencia:** ningún puerto ni tabla puede asumir «usuario y contraseña». El
adapter de cada proveedor debe **declarar** qué credenciales requiere, y la
custodia debe guardar una referencia opaca a un secreto cuya *forma* la conoce
el adapter, no el núcleo. Esto es coherente con `SEC-004` y con `DEC-013`, pero
todavía no está expresado como contrato.

## 3. Lo que ya existe y no debe rediseñarse

| Pieza | Dónde | Estado |
|---|---|---|
| Cinco puertos por capacidad | `electronic-invoicing.md` §Puertos | **documentados, no escritos** |
| Modelo canónico `ElectronicDocument` | `electronic-invoicing.md` · migration 003 | DDL central materializado |
| Matriz de capacidades por adapter | `electronic-invoicing.md` §Matriz | documentada |
| Niveles de verificación | `provider-integration-matrix.md` | `MOCK_TESTED` → `SANDBOX_VERIFIED` → `PRODUCTION_VERIFIED` → `CERTIFIED` |
| Contrato por proveedor | `provider-integration-matrix.md` | auth, endpoints, rate limit, idempotencia, webhooks |
| Prohibición de contaminar el core | `data-ownership.md` r.13, r.22 | vigente |

El trabajo de investigación de proveedores **ya está hecho**. Este gate no lo
repite: lo consume.

## 4. Qué se puede verificar hoy y qué no

| Proveedor | Sandbox disponible | Nivel alcanzable ahora |
|---|---|---|
| **FACTUS** | **Sí** — credenciales V2 en poder del responsable | `SANDBOX_VERIFIED` |
| SIIGO | `UNVERIFIED`; la documentación indica que las credenciales de prueba **se solicitan a Siigo** | `MOCK_TESTED` |
| ALEGRA | sandbox dedicado `UNVERIFIED`; el API explorer **puede modificar la cuenta real** | `MOCK_TESTED` |
| HKA · ODOO | no aplica | ninguno |

Sólo FACTUS puede pasar de `MOCK_TESTED` hoy. Para SIIGO y ALEGRA hace falta una
gestión comercial —pedir credenciales de prueba— que no es trabajo de ingeniería.

**Restricción del entorno automatizado:** `api-sandbox.factus.com.co` responde
`CONNECT tunnel failed, 403` desde el entorno de agente. La verificación contra
sandbox real sólo puede ejecutarla el responsable en su máquina. Un bloque de
implementación no puede prometer `SANDBOX_VERIFIED` desde CI.

## 5. Decisiones que hay que tomar

### D-1 · Dónde viven los adapters

- **Opción A** — paquete nuevo `packages/fiscal-adapters`, con entrada propia en
  `module-boundaries.json`. No prejuzga la decisión central-vs-local que sigue
  abierta en `electronic-invoicing-v2` §19.
- **Opción B** — esperar a que exista la aplicación central y ubicarlos allí.

**Recomendación: A.** Un adapter es un componente hoja; construirlo no obliga a
decidir dónde se orquesta. Y mantiene vivos los tres paquetes hoy vacíos como
destino legítimo en vez de dejarlos como inconsistencia.

### D-2 · Puertos primero, adapters después

Los cinco puertos están documentados pero no existen como código. Sin ellos, el
primer adapter define la forma por accidente y el segundo se acomoda al primero
— que es exactamente cómo un proveedor termina definiendo el modelo interno.

**Recomendación:** materializar los puertos y la declaración de capacidades
**antes** del primer adapter, y validar la forma contra los **tres** contratos
de la matriz, no sólo contra FACTUS.

### D-3 · Cómo se declara la credencial de cada proveedor

Dado el hallazgo de §2, el adapter debe declarar su requerimiento de credencial
de forma tipada. El núcleo guarda una referencia opaca; el adapter sabe qué hay
detrás.

**Requiere decisión:** si esa declaración vive en el propio adapter, en la
matriz de capacidades, o en ambas con verificación cruzada.

### D-4 · Qué se prueba y con qué evidencia

Dos niveles separados, y ninguno sustituye al otro:

1. **Contract tests contra fake determinista** — corren en CI, sin red, sin
   credenciales. Producen `MOCK_TESTED`.
2. **Suite de sandbox** — detrás de bandera de entorno, nunca en CI, ejecutada
   por el responsable. Produce `SANDBOX_VERIFIED` sólo con evidencia observada.

**Prohibido:** que un fake verde se reporte como compatibilidad con el
proveedor.

### D-5 · Consumo de bolsa

El modelo comercial de FACTUS para aliados SaaS multi-tenant vende una **bolsa
anual de documentos divisible entre NITs**, y cada NIT exige certificado propio.
La arquitectura ya encaja —`ExternalIntegration` por cuenta de aliado,
`FiscalConnection` por NIT con `certificate_reference`—, pero **no se encontró
ningún concepto de saldo o cuota consumida**.

Si la bolsa se agota, la emisión se detiene. **Requiere decisión:** si el saldo
se modela, se consulta al proveedor, o se ignora explícitamente en V1.

## 6. Alcance propuesto para el primer bloque

Si estas decisiones se ratifican, el primer bloque debería limitarse a:

1. materializar los cinco puertos y la declaración de capacidades;
2. un adapter FACTUS que los implemente;
3. contract tests contra fake determinista, en CI;
4. una suite de sandbox apagada por defecto, documentada para ejecución local.

**Fuera de alcance:** proyección local, contrato de payload por `snapshot_type`,
verificador, transporte, API central, adapters de SIIGO y ALEGRA. Cada uno es su
propio bloque.

## 7. Lo que este gate no resuelve

- El adquiriente sigue sin existir. Ninguna factura real se emite sin él; para
  probar el adapter sirve un fixture, pero **Customer está en la ruta crítica**.
- La decisión central-vs-local de `electronic-invoicing-v2` §19 sigue abierta.
- Los documentos legales entregados por el proveedor —SLA, términos y
  condiciones, acuerdo de alianza y acuerdo de confidencialidad— **no han sido
  analizados**. El SLA es el que debe fijar timeouts, política de reintento y
  tratamiento de `UNKNOWN_OUTCOME`; hasta leerlo, esos parámetros son
  `NOT_EVALUATED`.

## 8. Regla que no se relaja

Las credenciales nunca entran al repositorio, ni al árbol, ni a la matriz, ni a
la evidencia. Sólo variables de entorno o el almacén de `SEC-004`. El gate
`validate-repository-policy.mjs` escanea patrones de secreto en archivos
rastreados y debe seguir pasando.

---

## 9. Ratificación

Ratificadas el 2026-09-06 por **Wilson Andrés Camacho Culma**, responsable del
producto. Las cinco decisiones de §5 quedan cerradas así:

| | Decisión | Ratificada |
|---|---|---|
| `D-1` | Ubicación | **Opción A** — paquete `packages/fiscal-adapters` con entrada propia en `module-boundaries.json` |
| `D-2` | Orden | **Puertos y declaración de capacidades primero**, validados contra los tres contratos, antes del primer adapter |
| `D-3` | Credencial | **Declaración tipada en el adapter**, verificada contra la matriz de capacidades. El núcleo sólo guarda referencia opaca |
| `D-4` | Evidencia | **Dos niveles separados**: fake determinista en CI (`MOCK_TESTED`); suite de sandbox tras bandera de entorno, ejecutada localmente (`SANDBOX_VERIFIED`) |
| `D-5` | Saldo de bolsa | **Se modela** — ver §12 |

## 10. SLA verificado, y una suposición que resultó falsa

El `Acuerdo de Nivel de Servicio` fue leído el 2026-09-06.

**Corrección: este gate afirmó antes que el SLA fijaría timeouts, política de
reintento y tratamiento de `UNKNOWN_OUTCOME`. Es falso.** El documento es un
acuerdo de **tiempos de respuesta de soporte**, no un SLO técnico. No contiene
latencia comprometida, porcentaje de disponibilidad ni presupuesto de error.

Lo que sí fija, y es verificable:

| Elemento | Valor |
|---|---|
| Disponibilidad declarada | 24/7, 365 días |
| Horario hábil | lunes a viernes, 8:00–20:00 |
| Severidad alta — hábil | respuesta en **1 hora** |
| Severidad alta — día no hábil, 8:00–20:00 | respuesta en **2 horas** |
| Severidad alta — fuera de esa franja | siguiente día desde las 8:00 |
| Severidad media | **4 horas hábiles** |
| Severidad baja | **6 horas hábiles** |
| Mantenimiento programado | máx. **4 horas por evento**, después de las 20:00, máx. **1 vez al mes**, con preaviso |
| Exclusión expresa | **fallos de la DIAN** |

**Los tiempos son de atención a la petición de soporte, no de respuesta del
API.** Por tanto los parámetros técnicos siguen derivándose de la documentación
del proveedor —80 req/min, HTTP 429, `X-RateLimit-*`, `Retry-After`, ya
registrados en `provider-integration-matrix.md`— y no del SLA.

Dos consecuencias sí son de diseño:

1. **Ventana de mantenimiento de hasta 4 horas.** La cola fiscal debe sobrevivir
   una indisponibilidad planificada de ese orden sin perder documentos ni agotar
   reintentos. Es una cota de diseño concreta, no una estimación.
2. **La exclusión de fallos DIAN confirma la regla existente.** Un fallo aguas
   arriba no es un fallo del proveedor y no autoriza inferir aceptación:
   `UNKNOWN_OUTCOME` se resuelve por consulta o conciliación, nunca por
   vencimiento de un plazo.

## 11. Marco legal aplicable al diseño

Del contrato de alianza y del acuerdo de confidencialidad:

- **Ley 1581 de 2012** (Habeas Data). Por el canal fiscal circulan datos
  personales de adquirientes. La clasificación de payloads y respuestas como
  datos sensibles que ya declara `electronic-invoicing.md` queda anclada a una
  obligación legal, no sólo a criterio técnico: sin datos personales en logs ni
  trazas, artefactos con acceso autorizado y política de retención explícita.
- **El proveedor entrega los datos de acceso por usuario y por paquete
  adquirido.** Confirma el modelo de una `ExternalIntegration` por cuenta de
  aliado con credenciales por usuario, y `FiscalConnection` por NIT.
- **Cesión y subcontratación requieren autorización previa y escrita.** Un
  tercero no puede operar el canal fiscal por nuestra cuenta sin ese permiso.
- La confidencialidad cubre expresamente *"cualquier otro dato o información
  generada o transmitida a través del API"*.

## 12. Custodia de credenciales

Las credenciales de sandbox no son rotativas —es un ambiente gratuito de
pruebas—, lo que **aumenta** la exigencia de custodia: no hay rotación que
mitigue una fuga.

Reglas:

1. **Nunca en el repositorio.** Ni en código, ni en pruebas, ni en fixtures, ni
   en documentación, ni en mensajes de commit, ni en descripciones de PR.
2. **Sólo variables de entorno** para ejecución local, o el almacén de `SEC-004`
   para producción. Los nombres de variable son públicos; los valores no.
3. **Nunca en CI.** La suite de sandbox está apagada por defecto y CI no recibe
   credenciales de proveedor.
4. **Redacción obligatoria en logs y errores.** Un mensaje de error del adapter
   nunca incluye credencial, token ni cabecera de autorización.
5. **El núcleo guarda referencia opaca**, jamás el valor. Sólo el adapter conoce
   la forma del secreto que hay detrás.
6. `validate-repository-policy.mjs` debe seguir pasando: es la red que detecta un
   descuido.

### Saldo de bolsa (`D-5` ratificada)

El modelo comercial vende una bolsa anual divisible entre NITs. Se modela el
saldo como **proyección observable**, no como autoridad: la verdad la tiene el
proveedor. El sistema registra consumo para poder **alertar antes del
agotamiento**, y nunca bloquea una venta comercial por saldo fiscal — coherente
con la regla de que la caída fiscal no pierde la venta.

La forma concreta de consulta o reporte de saldo queda `NOT_EVALUATED`: no se
verificó endpoint oficial para ello. Es el primer punto a resolver contra el
sandbox real.
