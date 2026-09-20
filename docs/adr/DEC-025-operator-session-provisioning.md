# DEC-025 — Aprovisionamiento inicial de sesión de operador

## Estado

`ACEPTADA`. Autorizada por el propietario del repositorio el 2026-09-20, en
sesión, sobre la medición de la cadena que recoge el §Contexto.

Es la vía que `D-28` nombra literalmente como alternativa al emisor central:
«se cierra cuando exista una autoridad que emita, **o un procedimiento de
aprovisionamiento inicial autorizado por ADR**».

## Prioridad

`P0`. Es el único bloqueo común a los diez comercios prioritarios de
`business-types.md`.

## Qué NO es

Se dice antes que nada, porque el riesgo de este documento es que se lea como
más de lo que es:

- **No es `SEC-G02`.** Login, MFA, rotación de refresh, bloqueo y recuperación
  siguen `PLANNED / NOT_EVALUATED`. Este ADR no los promueve ni un peldaño.
- **No es un emisor central.** `DEC-012` D1 mantiene que la SSA es un artefacto
  emitido por la autoridad central; esto es un **bootstrap** mientras esa
  autoridad no exista, no su sustituto permanente.
- **No autentica a nadie.** Una sesión aprovisionada prueba que el propietario
  decidió que ese operador opere en ese equipo. No prueba que la persona frente
  al terminal sea quien dice ser. Esa distinción es de `DEC-012` §43 y sigue
  íntegra.
- **No admite autofirmados como sustituto de confianza de producción**
  (`DEC-011` §178, §200). Lo que firma es la clave operacional real publicada
  por `G1.2`, cuya raíz custodia el propietario.

## Contexto — la cadena, medida el 2026-09-20

| Pieza | Estado medido |
|---|---|
| Contrato SSA (`SessionAssertionClaimsSchema`) | ✅ ratificado |
| `SessionAssertionVerifier` | ✅ 181 líneas, cableado en `main.ts:188` |
| `session.activate` / `session.recover` | ✅ |
| `local_trust_anchor` provisionado desde artefacto verificado | ✅ `G1.2`, `main.ts:271-280` |
| Material criptográfico real (raíz + clave operacional) | ✅ `infra/trust/` |
| Techo de vigencia de la SSA (24 h) | ✅ ratificado en `DEC-012` §19 |
| Contrato SAS + `AuthorizationSnapshotVerifier` + `SnapshotAcquisitionService` | ⚠️ **existen y NO se construyen en producción** |
| Emisor de SSA | ❌ |
| Emisor de SAS | ❌ |

Las dos últimas filas son el bloqueo conocido. **La tercera por abajo no lo
era**: `SnapshotAcquisitionService` y `AuthorizationSnapshotVerifier` están
escritos y probados, pero `new` de ambos sólo aparece en pruebas. Un equipo
real no tiene hoy ninguna ruta para instalar un snapshot de autorización,
aunque alguien se lo entregara firmado.

Consecuencia operativa exacta, sin adornos: un equipo real arranca, levanta el
servicio, monta la pantalla, y `session.activate` rechaza toda credencial. Las
31 operaciones con pantalla siguen sin ser alcanzables. Es *fail-closed*
correcto, no un defecto.

## Decisión

Se autoriza un **artefacto de aprovisionamiento de sesión de operador**,
firmado fuera del repositorio con la clave operacional, que el POS Local
Service consume al arrancar.

### D1 — Forma del artefacto

Un fichero JSON con **dos sobres firmados independientes**, cada uno con el
envoltorio `{ claims, signature }` ya usado por licencia, SAS y publicación de
clave:

```
{
  "version": 1,
  "session_assertion":      { "claims": {...}, "signature": "..." },
  "authorization_snapshot": { "claims": {...}, "signature": "..." }
}
```

**Los dos, o ninguno.** Entregar sólo la SSA daría una sesión válida sin un
solo permiso: el POS arrancaría y rechazaría toda operación con `UNAUTHORIZED`.
Parecería avance y no lo sería, así que el consumidor exige ambos y falla
cerrado si falta uno.

No se inventa un envoltorio nuevo ni un segundo mecanismo criptográfico, por el
mismo criterio con que `DEC-011` §38 obligó a reusar el de licencia.

### D2 — Ruta de consumo: la canónica, sin contrato nuevo

El artefacto **no añade ninguna operación al contrato IPC**. Se consume por las
rutas que ya existen:

```
artefacto  →  verificación contra `local_trust_anchor`
           ├─ SSA  →  SessionActivation.activate   (SSA-002)
           └─ SAS  →  SnapshotAcquisitionService   (SAS-003: provider → verifier → store)
```

El `SnapshotProvider` que faltaba se implementa leyendo el artefacto, que es
exactamente el seam que `snapshot-acquisition.ts` dejó abierto.

La pantalla no cambia: `SessionPanel` ya ofrece `session.recover`, y una sesión
activada al arrancar es precisamente lo que `recover` encuentra. **No se añade
botón de activar**, y la prueba E2E que fija su ausencia sigue valiendo.

### D3 — Invariantes que no se relajan

1. **Fail-closed.** Artefacto ausente ⇒ el servicio arranca sin sesión, como
   hoy. Artefacto inválido ⇒ **no se activa nada y no se degrada lo existente**,
   igual que `main.ts` hace con el artefacto de confianza: un fichero
   manipulable no puede dejar el equipo sin sesión ni instalarle una falsa.
2. **La verificación es la de siempre.** `SessionAssertionVerifier` y
   `AuthorizationSnapshotVerifier` contra las claves de `local_trust_anchor`,
   con su `TrustedClockGuard`. No hay camino que salte la verificación.
3. **Binding completo.** `user_id` + `installation_id` + `device_id` de los dos
   sobres tienen que coincidir entre sí y con la configuración del equipo.
   Una discrepancia es `BINDING_MISMATCH` y deniega.
4. **Monotonía de `sequence`.** Responsabilidad del emisor (`DEC-011` §120), y
   el consumidor la aplica: una secuencia igual es reenvío y una menor es
   replay. Ninguna desplaza a la activa.
5. **Techo de 24 h** para `offline_valid_until` (`DEC-012` §19), rechazado por
   el cliente aunque la firma sea válida.
6. **La clave privada nunca entra al repositorio.** El firmador la recibe como
   ruta de fichero en la máquina del propietario. `ci:repository-policy` ya
   rechaza material privado rastreado, y esa puerta no se toca.

### D4 — El firmador

Herramienta de línea de comandos que corre **en la máquina del propietario**,
nunca en CI ni en el servicio. Entradas: ruta de la clave privada operacional,
binding del equipo, identidad del operador y sus asignaciones de rol. Salida:
el artefacto de D1.

No se publica como servicio ni se expone por red: eso sería el emisor central,
que es `SEC-G02` y sigue fuera de alcance.

## Ejecución medida — 2026-09-20

**Este ADR se escribió sin haber arrancado nunca el servicio.** Se arrancó, y
la ruta de consumo que describe `D2` **no llega hasta el final**. Se deja
escrito aquí porque el riesgo de este documento es leerse como una capacidad
disponible:

| Paso de `D2` | Observado |
|---|---|
| Lectura del artefacto | ✅ |
| Provisión del ancla desde `G1.2` | ✅ `decision: VALID, provisioned: 1` — con material generado para la prueba |
| SSA → `SessionActivation.activate` | ✅ **tras corregir el orden de arranque** (`D-32`) |
| SAS → `SnapshotAcquisitionService` | ❌ `SNAPSHOT_REJECTED / VERIFICATION_FAILED` (`D-31`) |

Tres hallazgos, los tres por ejecutar y no por leer:

1. **`D-32`, corregido.** La provisión del ancla estaba detrás de
   `lifecycle.start()` y sus consumidores resuelven las claves durante su
   propio `start()`. El primer arranque de un equipo recién aprovisionado
   rechazaba su propia sesión con `SIGNATURE_INVALID` y sólo funcionaba al
   segundo. Justo el arranque para el que existe este ADR era el único que no
   podía funcionar.
2. **`D-31`, abierto y bloqueante.** `SessionAssertionKeyPurposeSchema` es
   `z.literal("SESSION_ASSERTION")`: el bundle **no puede publicar** la clave
   de propósito `AUTHORIZATION_SNAPSHOT` contra la que `D2` verifica el
   segundo sobre. No hay ruta para provisionar ese propósito, así que
   `PROVISIONED` es inalcanzable con el cableado de hoy. Decidirlo es de ADR:
   una clave por propósito o una compartida.
3. **`D-30`, abierto.** El artefacto real de `G1.2` no parsea contra su propio
   contrato —`key_id` y `environment` en minúsculas frente a
   `StableCodeSchema`—, así que un equipo apuntado al material publicado no
   provisiona nada.

Mientras `D-31` siga abierta, **este ADR está `IMPLEMENTED` y no
`RUNTIME_VERIFIED`**: su invariante `D1` —«los dos sobres, o ninguno»— no se
puede satisfacer.

## Consecuencias

### Lo que habilita

Un comercio cuyo catálogo y operativa ya estén cubiertos —hoy **papelería** y
**tienda de barrio**, según `business-readiness.md`— puede operar en un equipo
real. Sería la primera vez que este proyecto pasa de *alcanzable* a *operativo*.

### Lo que sigue abierto, y queda registrado

- `SEC-G01`, `SEC-G02`, `SEC-G03`: `PLANNED / NOT_EVALUATED`.
- Emisor central de SSA y SAS: pendiente, y este ADR **no** lo sustituye.
- Rotación, revocación en línea y recuperación: no existen. Revocar una sesión
  aprovisionada exige entregar un artefacto nuevo con `sequence` mayor, o que
  expire.
- La prueba de presencia (PIN) de `DEC-012` §18 sigue **sin autorizar**. Una
  sesión aprovisionada sin PIN significa que quien tenga acceso físico al
  terminal opera como ese usuario hasta que la SSA expire. Es un riesgo
  residual **aceptado explícitamente** para el bootstrap, del mismo orden que
  `T2` en §18.1, y su control es organizativo: quién tiene acceso al equipo.

### Cómo se retira

Cuando exista el emisor central, el `SnapshotProvider` de fichero se sustituye
por el de red y el artefacto deja de leerse. La ruta de consumo no cambia,
porque es la canónica: eso es lo que hace que este bootstrap no sea deuda
estructural sino un proveedor distinto en un seam que ya existía.

## Referencias

- `DEC-011` — proyección de autorización (SAS): §38 reutilización criptográfica,
  §120 monotonía, §178 y §200 autofirmados, §208 «no habrá demostración
  end-to-end mientras no exista emisor», §212 alcance.
- `DEC-012` — sesión local y SSA: D1 emisión central, §16 fuera de alcance,
  §18 política de presencia, §19 techo de vigencia, §43 posesión ≠ autenticación.
- `DEC-022` — origen del ancla de confianza.
- `D-28` en `docs/governance/materialization-state.md`.
- `docs/governance/g1.2-session-bootstrap-execution-2026-09-17.md` — el material
  real que hace innecesario el autofirmado.
