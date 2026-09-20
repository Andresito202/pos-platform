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

## Uso

```bash
node tools/provisioning/sign-operator-session.mjs \
  --key    /ruta/segura/operational-private-key.pem \
  --key-id SESSION_KEY_1 \
  --input  ./operador.json \
  --output ./operator-session.json
```

`--key-id` tiene que ser el `key_id` que el equipo tiene provisionado en
`local_trust_anchor`; si no coincide, el verificador rechaza la firma.

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

## Riesgo residual aceptado

Sin prueba de presencia —el PIN de `DEC-012` §18 sigue **sin autorizar**—,
quien tenga acceso físico al terminal opera como ese usuario hasta que la SSA
expire. El control es organizativo: quién accede al equipo. Queda aceptado
explícitamente en `DEC-025` §Consecuencias.
