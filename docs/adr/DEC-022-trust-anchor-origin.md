# DEC-022 — Origen de la raíz de confianza y exigencia de instalación sin conectividad

Estado:

`PROPUESTA — PENDIENTE DE RATIFICACIÓN`

Resuelve las decisiones `B-1` y `B-2` identificadas por el diagnóstico `G1`
(`G1.1` y `G1.1-F`). No autoriza implementación alguna.

---

## Contexto

`G1` estableció, con evidencia, que el repositorio define exhaustivamente el
**mantenimiento** del conjunto de claves de confianza y **no define su origen**:

| Texto | Documento | Verbo |
|---|---|---|
| «El cliente **conserva** claves públicas … autorizados» | `DEC-008:163` | conserva |
| «artefacto firmado por una raíz **ya confiable**» | `DEC-008:2596` | ya confiable |
| «La confianza **se actualiza** únicamente mediante un proceso autenticado» | `DEC-008` invariante 5 | se actualiza |
| «Una clave pública **arbitraria** no se acepta como raíz» | `DEC-008` invariante 4 | arbitraria |
| «material público **previamente** confiable» | `security-model.md:59` | previamente |
| «claves públicas **provisionadas** en la instalación» | `DEC-011:96` | provisionadas |

Seis formulaciones de tres documentos. Todas presuponen un conjunto que ya
existe. Ninguna lo origina.

La ausencia no es un olvido: `DEC-008:13-21` excluye expresamente «formato de
transporte definitivo» e «implementación específica por sistema operativo», y
`DEC-008:56` excluye «infraestructura PKI empresarial completa». El origen de la
raíz cayó en la intersección de esas exclusiones.

Verificado además:

- `Authenticode` no aparece en el repositorio. Cero ocurrencias.
- «cadena de confianza» aparece dos veces (`DEC-008:682`, `:2416`) y **no se
  define en ninguna**.
- No existe política de pinning TLS, CA privada ni certificado esperado.
- La activación online (`DEC-008:983,1013`) y la offline (`:1096-1114`)
  **presuponen** la raíz: la respuesta va firmada con `signing_key_id` y ningún
  campo de la respuesta transporta claves de confianza.

## Problema

La verificación de un artefacto exige una clave; obtener esa clave por una vía
verificable exige verificar otro artefacto. La recursión **no termina dentro del
sistema criptográfico**: termina en una premisa no criptográfica que alguien debe
elegir y declarar.

Elegirla es esta decisión.

---

## Decisión B-2 — La instalación debe poder completarse sin conectividad

**Sí.** Un equipo debe poder quedar instalado y con su material de confianza
presente sin disponer de conexión en el momento de la instalación.

### Fundamento

1. `ADR-003` y `DEC-007` fijan la arquitectura local-first como premisa del
   producto, no como optimización.
2. `DEC-010:198` (regla 9 de «Actualizaciones»): «`HYBRID` puede recibir
   actualización administrada, **sin volver Internet requisito para vender**».
3. `DEC-010:197` (regla 8): «`LOCAL_PERPETUAL` admite **paquetes offline
   firmados** según derechos contratados».

Un producto cuya instalación exige Internet contradice las tres. El mercado
objetivo —comercio minorista colombiano— no garantiza conectividad en el momento
de la instalación, y `DEC-010` ya decidió admitir explícitamente la modalidad
offline.

### Consecuencia inmediata

Queda **descartado** que la entrega del trust store dependa del enrollment
online o de la sesión TLS **como vía única de arranque**. Ambas siguen siendo
válidas para lo que ya tienen decidido: actualización posterior del conjunto de
confianza (`DEC-008` §«Actualización de confianza») y protección del canal
(`integration-contracts.md:208,372`).

### Lo que esta decisión NO dice

No dice que el POS pueda **operar** sin haber contactado nunca con la autoridad.
No puede: la SSA la emite la autoridad central y sólo ella (`DEC-012` §8).
`B-2` gobierna la **instalación**, no la apertura de sesión. El primer contacto
sigue siendo necesario antes de vender; deja de serlo para instalar.

---

## Decisión B-1 — La raíz de confianza es propia y se verifica fuera de banda

**La raíz de confianza de Camacho POS Colombia es propia del producto. Su
integridad se acredita mediante verificación fuera de banda de su huella, no
mediante la firma del artefacto que la transporta.**

Y, correlativamente:

| Clase de confianza | Rol que se le concede | Rol que se le niega |
|---|---|---|
| **Confianza de plataforma** (firma del artefacto ejecutable, cadena del sistema operativo) | Control de **distribución e integridad del binario**, ya exigido por `DEC-010:191-193` y `secret-key…:237-246` | **No introduce** confianza criptográfica de aplicación. No avala ninguna clave que el artefacto transporte |
| **Confianza de transporte** (TLS) | Protección de **confidencialidad e integridad del canal**, ya exigida por `integration-contracts.md:208,372` y `DEC-007:1563` | **No introduce** una `TrustedSigningKey` |
| **Confianza de firma de Camacho** | **Única** fuente de autoridad sobre licencias, SSA, SAS, snapshots maestros y actualizaciones | — |

### Fundamento

1. **`DEC-008:2433` ya lo dice para la plataforma**: «Nunca debe asumirse
   confianza por el simple hecho de que un archivo pueda ejecutarse.»
2. **`DEC-008` §«Descarga» regla 3 ya lo dice para el transporte**: «El canal de
   transporte **no sustituye la firma**.»
3. **`DEC-008` invariante 10 lo exige**: «Toda confianza tiene **versión y
   trazabilidad**.» Ni la firma de un instalador ni una sesión TLS dejan
   evidencia persistente, reverificable ni auditable después del momento en que
   se evaluaron. Una raíz introducida por cualquiera de las dos sería una raíz
   cuya procedencia resulta indemostrable al día siguiente.
4. **`secret-key-and-support-management.md:258` segrega los propósitos**: las
   credenciales de firma de instaladores «**no se comparten con firma de
   licencias**», y `device-licensing-schema.md:256` añade que `SIGNING_KEY` y
   `UPDATE_KEY` «**no se mezclan**». La firma del instalador, por tanto, no puede
   avalar una clave de licencias aunque la transporte: sería una transferencia de
   confianza entre propósitos que dos normas vigentes desautorizan.
5. **`DEC-008:56` excluye «infraestructura PKI empresarial completa»** del
   alcance. Una raíz propia verificada por huella satisface el requisito sin
   construir una PKI.

### Qué significa «fuera de banda»

Que la huella de la raíz se confirma por un canal distinto de aquel por el que
viaja la raíz. La clave pública **no es un secreto**: poseerla no otorga ningún
derecho, sólo permite verificar firmas. La amenaza que hay que conjurar es la
**sustitución**, no la divulgación. Por tanto el canal fuera de banda necesita
**integridad**, no confidencialidad, y una confirmación de huella satisface esa
propiedad sin infraestructura nueva.

### Lo que esta decisión desbloquea

**El portador deja de ser una decisión arquitectónica y pasa a ser una decisión
operativa.** Tanto un instalador firmado como un paquete de provisioning
administrativo pueden transportar la raíz, porque en ambos casos **su aceptación
queda condicionada a la misma comprobación de huella**, y no a la firma del
portador. Elegir el portador ya no compromete el modelo de confianza.

Esto resuelve la tensión registrada en `G1.1` §3.4: A y C dejan de ser
alternativas excluyentes y pasan a ser la misma decisión a distinta escala.

### Consecuencia sobre el modelo del trust store — `B-5`

Queda **resuelta afirmativamente** la pregunta `B-5`: el modelo **debe registrar
la procedencia**, porque el invariante 10 exige trazabilidad de toda confianza y
esta decisión sitúa la acreditación en un acto —la verificación de huella— que
ocurre fuera del sistema y no deja rastro por sí mismo.

Se registra además el hallazgo que lo hace ineludible: la tabla especificada en
`device-licensing-schema.md:266-268` tiene catorce columnas y **ninguna registra
cómo llegó la clave ni qué evidencia se aceptó**. La forma especificada es, por
tanto, insuficiente para esta decisión.

Deben distinguirse dos informaciones que no son la misma:

| Información | Naturaleza |
|---|---|
| **Quién autorizó la clave** | Autoridad central. Ya modelado: `key_id`, `key_purpose`, `environment`, `key_status` |
| **Cómo llegó y qué se verificó** | Acto local de aceptación. **No modelado** |

---

## Lo que esta decisión NO autoriza

1. Crear `licensing.trusted_signing_keys`. La migración **sigue bloqueada**:
   `B-3` (propósito), `B-4` (estados) y `B-6` (ámbito) continúan abiertas, y la
   forma de la tabla depende de las tres.
2. Implementar portador alguno: ni paquete de provisioning, ni transporte de
   trust store dentro del instalador.
3. Generar claves, certificados ni material criptográfico de ninguna clase.
4. Cablear `sessionSigningKeys`. El mapa vacío sigue siendo el comportamiento
   correcto (`DEC-015:176-183`).
5. Tratar la firma de código como resuelta. `RT-009-B` permanece
   `BLOCKED / REQUIRES_CERTIFICATE` (`DEC-010:239-250`), y esta decisión
   **reduce** su criticidad para el arranque de confianza sin eliminarla para la
   distribución.

## Decisiones que siguen abiertas

| # | Decisión | Por qué no se cierra aquí |
|---|---|---|
| `B-3` | Store único con `key_purpose` o segregado por propósito | La evidencia apunta a segregación (`device-licensing-schema.md:256`, `secret-key…:258`) pero `SessionAssertionVerifier` no discrimina propósito y `MasterSnapshotVerifier` sí: conciliar las dos formas es trabajo propio |
| `B-4` | Proyección de los siete estados conceptuales sobre los tres locales | Hay pérdida semántica acreditada: `COMPROMISED` y `RETIRED` no tienen destino y hoy verificarían igual |
| `B-6` | Ámbito de la raíz: global por ambiente, por tenant, o menor | `UNIQUE (environment, key_purpose, key_id)` no lleva `tenant_id`, pero un `UNIQUE` no es una decisión de negocio |

## Ratificación

Esta decisión queda **propuesta**, no adoptada. Requiere ratificación expresa de
Wilson Andrés Camacho Culma, con fecha, conforme al precedente de `DEC-010:229`.
Hasta entonces no debe citarse como decisión vigente ni usarse para desbloquear
ningún gate.

## Documentos relacionados

- `docs/adr/DEC-008-device-trust-license-activation.md`
- `docs/adr/DEC-010-pos-runtime.md`
- `docs/adr/DEC-011-authorization-projection-sas.md`
- `docs/adr/DEC-012-local-session-and-cash-governance.md`
- `docs/adr/DEC-015-transport-session-binding.md`
- `docs/architecture/security-model.md`
- `docs/security/secret-key-and-support-management.md`
- `docs/architecture/physical-model/device-licensing-schema.md`
