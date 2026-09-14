# DEC-020 — La identidad del dispositivo se materializa en el arranque

- **Estado:** aceptada
- **Fecha:** 2026-09-14
- **Sustituye a:** nada
- **Relacionada con:** `DEC-011` (Signed Authorization Snapshot), `SEC-004`
  (custodia de secretos), `LIC-003`/`DEV-003` (aprovisionamiento de licencia)

---

## 1. El problema

`LocalSecurityLifecycle`, `DeviceIdentity`, `EncryptedFileSecretStore`,
`WindowsDpapiKeyProvider` y `TrustedClockGuard` existen, están probados y
**nadie los instancia en producción**. El tablero lo registra sin adornos:

> `A13` · Ciclo de seguridad local (DPAPI, identidad, licencia) · `TESTED` ·
> «`main.ts` no lo instancia»

Cuatro tablas —`local_device_identity_state`, `local_device_key_history`,
`local_security_audit` y `local_security_state`— existen desde
`MIGRATION_001` y **jamás han recibido una fila en una ejecución real**. Es el
mismo patrón que `D-23` (`identifier_snapshot` siempre `NULL`) y que
`stock_controlled` antes de `MIGRATION_015`: esquema que existe y no gobierna
nada.

La consecuencia concreta, y no es teórica: el POS **no tiene identidad
criptográfica**. No hay clave privada del dispositivo, luego no hay
proof-of-possession, luego no hay forma de que una autoridad central —cuando
exista— distinga este equipo de cualquier otro. Y `SEC-004`, el almacén que
debe custodiar las credenciales de FACTUS, es precisamente
`EncryptedFileSecretStore` sobre DPAPI: sin arrancarlo, la facturación
electrónica no tiene dónde guardar su secreto.

## 2. La decisión

**El arranque del POS Local Service materializa la identidad del dispositivo, y
falla cerrado si no puede.**

Se añade un `RuntimeComponent` —`local-security`— que corre **inmediatamente
después de la base de datos y antes que cualquier otro componente**, y que en
su `start()` hace exactamente cuatro cosas, en este orden:

1. **`TrustedClockGuard.accept(now)`.** Primero, porque todo lo que sigue lleva
   marca de tiempo. Un reloj retrocedido más allá de la tolerancia detiene el
   arranque: revivir un snapshot expirado o una licencia vencida empieza
   siempre por mover el reloj.
2. **Abrir el almacén cifrado** con la clave raíz que entrega el proveedor
   —DPAPI en Windows—, con contexto ligado a `installation_id` y `device_id`.
3. **Cargar la identidad si el secreto existe; crearla si no.** Un par Ed25519
   generado en el equipo, exportado a PKCS#8 y escrito cifrado con AES-256-GCM.
   La clave privada nunca sale del almacén, nunca se registra y nunca viaja.
4. **Registrar la clave en el libro de identidad** y dejar el asiento
   `DEVICE_KEY_REGISTERED` en `local_security_audit`.

Si cualquiera de los cuatro pasos falla, `ServiceLifecycle` marca `FAILED`,
`main.ts` sale con código 1 y **no se sirve una sola operación comercial**. Un
equipo que no puede proteger su identidad no vende.

### 2.1 El registro es idempotente, la sustitución no es automática

`registerInitialDeviceKey` no hace nada si la clave registrada coincide con la
cargada. Ése es el arranque normal: segunda y enésima vez.

Si **no** coinciden —el secreto protegido produce una clave distinta de la que
esta instalación tiene registrada— el arranque **se detiene**. No se rota, no
se reemplaza y no se «repara». Esa divergencia significa una de dos cosas: o el
almacén de secretos fue sustituido, o la base de datos lo fue. Ninguna de las
dos se resuelve fabricando una identidad nueva y siguiendo como si nada.

La sustitución existe —`replaceDeviceKey(newKeyId, secretName, reason)`— y
exige una razón escrita. Es una operación explícita de un operador, jamás un
efecto colateral de un arranque.

## 3. Lo que esta decisión **no** hace

Esto importa tanto como lo anterior, porque el riesgo de este bloque es
declarar más de lo que se materializa.

**No conecta la verificación de licencia.** `LicenseVerifier` necesita un mapa
de claves públicas de confianza y una licencia firmada. Ninguna de las dos
existe: no hay emisor central (`D6`, `DOCUMENTED`) ni aprovisionamiento
(`LIC-003`/`DEV-003`). Conectarlo con un mapa vacío haría que
`capabilityDecision` devolviera `LICENSE_INVALID` para todo, y si además se
cerrara el paso a las capacidades comerciales, **el POS dejaría de vender**. Un
verificador que siempre dice que no, no es seguridad: es un producto roto. Se
queda fuera, y el tablero lo seguirá diciendo.

**No conecta `SnapshotAcquisitionService` (A14).** Su `SnapshotProvider` sólo
tiene una implementación posible en producción —HTTP contra la API central— y
esa API no existe: `packages/database-postgres` no tiene siquiera carpeta
`src`. Cablearlo contra un proveedor en memoria sería fabricar la confianza que
todo este diseño existe para no fabricar. **A14 permanece `TESTED` y se
declara bloqueado por `D-2`.**

**No introduce un secreto compartido por máquina, ni identidad derivada de la
MAC, ni una cuenta común para Electron y el servicio.** Nada de eso cambia
aquí.

## 4. El proveedor de clave y por qué no es un bypass

`main.ts` elige el proveedor **por plataforma**, igual que ya elige
`LocalChannelComponent`:

```
win32           → WindowsDpapiKeyProvider      protection = OS_BOUND
cualquier otra  → InsecureDerivedKeyProvider   protection = TEST_ONLY
```

En Windows **no existe ruta alguna** hacia el proveedor de pruebas: la rama es
por plataforma y no consulta variables de entorno. La producción exige Windows
—`main.ts` lo impone desde antes de esta decisión— de modo que la segunda rama
sólo es alcanzable donde la producción ya está prohibida.

Y aun así el proveedor de pruebas se guarda dos veces por su cuenta: rechaza
construirse y rechaza entregar una clave si `NODE_ENV !== "test"`. Se llama
`InsecureDerivedKeyProvider` porque un `grep` por «insecure» debe encontrarlo, y
declara `protection = "TEST_ONLY"`, valor que el arranque **registra en el log**
junto a `device_key_id`, bajo el nombre `key_protection`: el redactor del logger
convierte en `[REDACTED]` cualquier campo cuyo nombre contenga «secret», de modo
que el nombre se adapta al redactor y el redactor no se toca.

Esto no es una degradación silenciosa: es audible en cada arranque y está
cerrada en la única plataforma donde el producto se ejecuta.

## 5. Consecuencias

- El equipo adquiere una identidad Ed25519 estable, protegida por DPAPI, que
  **sobrevive al reinicio**. Es la primera pieza de `RT-004` que existe fuera
  de una prueba.
- `local_security_audit` empieza a acumular asientos reales. La auditoría
  append-only deja de ser una tabla vacía.
- `SEC-004` pasa a tener un almacén vivo, que es el prerequisito directo del
  `FactusCredentialResolver` de producción. La facturación electrónica ya tiene
  dónde guardar su secreto; todavía no tiene quién la llame.
- El arranque adquiere un modo de fallo nuevo y deliberado: identidad
  divergente detiene el servicio.
- En Windows, DPAPI se ejecuta en cada arranque del servicio. El coste es una
  invocación de PowerShell por arranque, no por operación.
