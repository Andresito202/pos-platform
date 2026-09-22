# Aprovisionamiento inicial de sesión de operador

Implementa `DEC-025`. **Léelo antes de usar esto**: dice qué habilita y, sobre
todo, qué no.

> Esto **no es `SEC-G02`**. No hay login, ni rotación, ni recuperación. Una
> sesión aprovisionada prueba que el propietario decidió que ese operador opere
> en ese equipo; **no** prueba que la persona frente al terminal sea quien dice
> ser.

## Regla que no se negocia

**La clave privada operacional nunca entra al repositorio.** Se pasa como ruta
de un fichero en tu máquina. `ci:repository-policy` rechaza material privado
rastreado y esta herramienta no le pide excepción.

## Paso previo: publicar el bundle de confianza

**Esto va primero.** Sin un bundle, el equipo arranca con
`session_trust: INVALID` y rechaza toda sesión.

```bash
node tools/provisioning/publish-session-trust.mjs \
  --root-key         /ruta/segura/root-private.pem \
  --session-key-id   SSA-2026-01 \
  --snapshot-key-id  SAS-2026-01 \
  --environment      PRODUCTION \
  --out-dir          /ruta/segura/confianza
```

Escribe tres ficheros:

| Fichero | Qué es | Dónde va |
|---|---|---|
| `session-trust.json` | el bundle firmado con la raíz | **al equipo** → `POS_SESSION_TRUST_ARTIFACT_PATH` |
| `session-assertion-private.pem` | firma la SSA | **se queda contigo** |
| `authorization-snapshot-private.pem` | firma el SAS | **se queda contigo** |

**Genera las claves además de publicarlas, a propósito.** Separarlo crea la
única forma de equivocarse que no avisa: publicar la pública de un par y
firmar con la privada de otro. El equipo respondería `SIGNATURE_INVALID` a
toda sesión sin decir por qué, y el fallo aparecería en un mostrador.

Los códigos van en **MAYÚSCULAS** (`StableCodeSchema`). La herramienta rechaza
minúsculas antes de firmar: es exactamente el defecto del artefacto publicado
en su día (`D-30`), que trae `ssa-2026-01` y `production` y **no parsea**.

`--environment` tiene que ser idéntico a `POS_SESSION_TRUST_ENVIRONMENT` en el
equipo. Son los dos lados de la misma comparación.

`--bundle-version` (por defecto `1`) sólo sube: el equipo rechaza un bundle con
versión menor que la que ya tiene instalada, para que un artefacto viejo no
pueda revertir una rotación.

## Uso

```bash
node tools/provisioning/sign-operator-session.mjs \
  --session-key     /ruta/segura/session-assertion-private-key.pem \
  --session-key-id  SESSION_KEY_1 \
  --snapshot-key    /ruta/segura/authorization-snapshot-private-key.pem \
  --snapshot-key-id SNAPSHOT_KEY_1 \
  --input           ./operador.json \
  --output          ./operator-session.json
```

**Dos claves, una por sobre** (`D-31`). Firmar identidad
(`SESSION_ASSERTION`) y firmar permisos (`AUTHORIZATION_SNAPSHOT`) son
dominios criptográficos distintos, y el equipo los verifica contra anclas
distintas. Compartir una clave anularía esa separación: quien pudiera emitir
una emitiría la otra, y revocar una obligaría a revocar ambas.

Cada `--*-key-id` tiene que ser el `key_id` que el equipo tiene provisionado
en `local_trust_anchor` **para ese propósito**; si no coincide, el verificador
rechaza la firma. Los dos ids tienen que ser distintos entre sí: el bundle de
confianza exige `key_id` único, y el firmador lo comprueba antes de firmar.

> **Antes esto tomaba una sola `--key`** y firmaba los dos sobres con ella.
> Funcionaba sólo en apariencia: el ancla de `AUTHORIZATION_SNAPSHOT` no se
> poblaba nunca, así que el segundo sobre no llegaba a verificarse y el
> aprovisionamiento se detenía ahí en todo arranque.

## Entrada

Los dos sobres llevan el **mismo binding** —`user_id`, `installation_id`,
`device_id`—. El firmador se niega si no coinciden.

```json
{
  "session_assertion": {
    "session_id": "…uuid…",
    "user_id": "…uuid…",
    "tenant_membership_id": "…uuid…",
    "installation_id": "…uuid del equipo…",
    "device_id": "…uuid del equipo…",
    "issued_at": "2026-09-20T00:00:00.000Z",
    "offline_valid_until": "2026-09-20T12:00:00.000Z",
    "sequence": 1
  },
  "authorization_snapshot": {
    "snapshot_id": "…uuid…",
    "user_id": "…uuid…",
    "installation_id": "…uuid del equipo…",
    "device_id": "…uuid del equipo…",
    "sequence": 1,
    "issued_at": "2026-09-20T00:00:00.000Z",
    "expires_at": "2026-09-21T00:00:00.000Z",
    "assignments": [ { "…": "…" } ]
  }
}
```

`offline_valid_until` no puede exceder **24 h** desde `issued_at`: el cliente
rechaza la SSA aunque la firma sea válida (`DEC-012` §19).

`sequence` debe ser **estrictamente mayor** que la última aceptada en ese
equipo. Igual es un reenvío, menor es un replay, y ninguna desplaza a la sesión
activa. Es lo que usarás para revocar: emite una nueva con secuencia mayor.

`assignments` vacío produce una sesión **sin permisos**: el POS arranca y
responde `UNAUTHORIZED` a todo. Es fail-closed correcto, no un defecto.

## Consumo en el equipo

```bash
POS_OPERATOR_SESSION_ARTIFACT_PATH=/ruta/absoluta/operator-session.json
```

Al arrancar, el servicio lo lee, verifica **los dos sobres contra
`local_trust_anchor`** y activa sesión y permisos por las rutas canónicas
(`SSA-002` y `SAS-003`). Después, el botón «Recuperar sesión» de la pantalla la
encuentra.

El log de arranque emite `security.operator_session` con el desenlace —y nunca
el operador ni el artefacto—:

| Desenlace | Qué significa |
|---|---|
| `ABSENT` | equipo sin aprovisionar. Normal, no es error |
| `INVALID` | el fichero no se pudo leer o no tiene la forma. **No se activa nada y no se degrada lo que hubiera** |
| `SESSION_REJECTED` | la SSA no verificó. No se intenta el snapshot |
| `SNAPSHOT_REJECTED` | la SSA entró y el SAS no: hay sesión sin permisos |
| `PROVISIONED` | sesión y permisos activos |

## Credenciales de cobro y de facturación

El artefacto de sesión abre la puerta; estas dos deciden si el equipo puede
**cobrar por QR** y **facturar electrónicamente**. Ninguna viaja en
configuración plana: las dos van al mismo almacén cifrado del equipo
(AES-256-GCM sobre fichero `0600`, clave raíz de DPAPI en Windows), con el
binding del equipo como dato autenticado, de modo que **un fichero copiado a
otra instalación no descifra**.

Las dos se depositan **por entrada estándar**, nunca por argumento ni por
variable de entorno: un argumento aparece en la lista de procesos y en el
historial del intérprete, y una variable de entorno aparece en cualquier
volcado de diagnóstico y la heredan los procesos hijos.

### Wompi — cobro por QR

```bash
cat credencial-wompi.json | pnpm --filter @pos-platform/pos-local-service deposit-wompi
```

```json
{
  "publicKey": "pub_test_…",
  "integritySecret": "…",
  "eventsSecret": "…",
  "redirectUrl": "https://tu-tienda.example/gracias"
}
```

`redirectUrl` es opcional. Wompi documenta ese retorno como «informativo, nunca
un método de validación»: no entra en la firma de integridad y **no es
evidencia de pago**. La respuesta real sigue viniendo de
`GET /v1/transactions/{id}` o del webhook.

**`publicKey` tiene que ser la pública** —`pub_test_` en sandbox, `pub_prod_`
en producción—. El depósito lo comprueba y rechaza cualquier otra cosa: sin esa
comprobación, pegar ahí la clave privada por error se aceptaría en silencio,
quedaría cifrada en el equipo y viajaría después en cada URL de checkout.

Respuesta `{"status":"DEPOSITED"}` o `{"status":"REJECTED","code":…}`. **Nunca
imprime un valor.** Un depósito posterior sustituye al anterior, que es como se
rota una credencial; uno rechazado no deja nada a medias.

> **Sandbox y producción comparten host.** `wompi-http-client.ts` fija
> `https://production.wompi.co/v1` y lo deja así a propósito: según la
> documentación de Wompi —verificada, no supuesta— es la clave la que
> selecciona el entorno, no la URL. Si alguna vez se demuestra lo contrario,
> eso sería un cambio con evidencia y no una opción de configuración que
> añadir «por si acaso».

### FACTUS — facturación electrónica

```bash
cat credencial-factus.json | pnpm --filter @pos-platform/pos-local-service deposit-credential
```

```json
{
  "provider": "FACTUS",
  "environment": "SANDBOX",
  "fields": { "clientId": "…", "clientSecret": "…", "username": "…", "password": "…" }
}
```

Devuelve una referencia opaca (`secretRef` y `version`), que **no es un
secreto**: es lo que el núcleo necesita para resolver la credencial.

## Orden de puesta en marcha de un equipo

Lo único que no puede hacerse desde el repositorio, reunido en un sitio. Los
pasos 1 y 2 exigen material que sólo custodia el propietario.

| # | Paso | Sin esto |
|---|---|---|
| 1 | `publish-session-trust.mjs` — publica el **bundle** y genera las dos claves operacionales | el equipo registra `session_trust: INVALID`, `provisioned: 0` y rechaza toda sesión |
| 2 | Firmar el **artefacto de sesión** del operador con las dos claves operacionales | el equipo arranca sin sesión: `ABSENT` |
| 3 | Arrancar el servicio **en Windows** apuntando a ambos ficheros | el canal local (named pipe) sólo se monta en `win32`; fuera de ahí el servicio de producción se niega a arrancar |
| 4 | Depositar la credencial de **Wompi** | no hay cobro por QR. El equipo sigue vendiendo en efectivo y por transferencia: es un estado legítimo, no un fallo |
| 5 | Depositar la credencial de **FACTUS** | no hay facturación electrónica real (`F6`) |

Comprobación del paso 3, en el log de arranque:

```
security.session_trust    → {"decision":"VALID","provisioned":2}
security.trust_anchors    → {"usable":"session_assertion=1 authorization_snapshot=1 license=0"}
security.operator_session → {"decision":"PROVISIONED"}
```

Si el segundo recuento sale `authorization_snapshot=0`, el bundle del paso 1 no
publicó la clave de ese propósito y el paso 2 no podrá completarse.

## Riesgo residual aceptado

Sin prueba de presencia —el PIN de `DEC-012` §18 sigue **sin autorizar**—,
quien tenga acceso físico al terminal opera como ese usuario hasta que la SSA
expire. El control es organizativo: quién accede al equipo. Queda aceptado
explícitamente en `DEC-025` §Consecuencias.
