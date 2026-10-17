# DEC-022 — Propuesta de raíz de confianza y bootstrap de dispositivo

## Estado

`RATIFIED — 2026-10-16 (principios arquitectónicos)`

Este documento convierte la evidencia existente de SEC-004, DEC-008, DEC-011 y la preparación D-3 en una propuesta arquitectónica concreta. No se considera una decisión ratificada por su mera existencia y no autoriza por sí solo secretos, KMS, endpoints productivos ni credenciales reales.

## 1. Problema que debe resolver

El POS Local Service necesita distinguir una instalación/dispositivo legítimo de un cliente que simplemente conoce un endpoint o posee un token de transporte.

La solución debe permitir:

- bootstrap inicial sin distribuir claves privadas centrales al POS;
- generación local de la identidad criptográfica del dispositivo;
- autenticación posterior de la instalación;
- revocación y rotación;
- recuperación sin convertir un backup en clon de identidad;
- separación entre device trust, licencias, actualizaciones y snapshots maestros;
- funcionamiento fail-closed cuando no exista una cadena de confianza válida.

## 2. Decisión propuesta

### 2.1 Trust anchor

La raíz de confianza de device trust será una **clave pública raíz de dispositivo**, distribuida como parte del artefacto de instalación firmado y validado por la cadena de firma de código/actualización.

La clave privada raíz nunca se distribuye al POS, repositorio, CI ordinario ni renderer.

La clave pública raíz no se obtiene por el mismo canal cuya autenticidad pretende validar.

Esto mantiene la propiedad establecida por DEC-008: transporte no sustituye firma.

### 2.2 Claves operativas

La raíz no firma cada operación de dispositivo directamente.

La raíz autoriza una o más claves operativas de device trust mediante un artefacto firmado que contiene como mínimo:

```text
key_id
key_purpose = DEVICE_TRUST
public_key
status
valid_from
version
```

La clave operativa se usa para autenticar credenciales/attestations de dispositivo. Su private key permanece bajo custodia central reforzada.

La separación impide que una clave de licencia, actualización o snapshot maestro pueda convertirse accidentalmente en raíz de device trust.

### 2.3 Identidad privada del dispositivo

En el primer arranque del POS Local Service:

1. se genera localmente un par Ed25519;
2. la private key se almacena mediante el mecanismo protegido definido por SEC-004;
3. la private key nunca se envía al servidor;
4. la public key se asocia a una instalación mediante un proceso de enrollment;
5. la identidad persistente queda ligada a `installation_id` y `device_id`.

La clonación de SQLite, carpeta de instalación o backup no crea una segunda identidad válida.

### 2.4 Enrollment inicial

El enrollment requiere una credencial de activación de un solo uso o equivalente administrativo, emitida fuera del canal de confianza permanente y con alcance limitado.

El bootstrap debe producir evidencia verificable de:

```text
activation authorization
→ installation identity
→ device public key
→ tenant/company binding
→ enrollment result
→ audit evidence
```

El activation credential no se convierte en la raíz permanente y debe ser inutilizable después de completar o expirar el enrollment.

### 2.5 Autenticación de frontera central

Una vez inscrito, el POS se autentica mediante:

- TLS para seguridad del canal;
- identidad criptográfica del dispositivo para autenticidad de la instalación;
- credencial/attestation firmada verificable contra la cadena `root → operational device-trust key`;
- binding explícito de tenant, installation y device;
- estado de revocación;
- versionado de credenciales.

Un bearer token estático por sí solo no constituye device trust.

### 2.6 Rotación

La rotación sigue una cadena autenticada:

```text
root trust anchor
    ↓ signs
new operational DEVICE_TRUST key
    ↓ authenticates
new device credential / attestation
```

Una clave operativa retirada no debe permitir nuevas inscripciones. Las credenciales existentes se mantienen o revocan según su política explícita.

La rotación no reescribe hechos comerciales ya confirmados.

## 3. Propiedades de seguridad obligatorias

La implementación futura debe demostrar:

1. private key de dispositivo nunca sale del nodo local;
2. renderer/preload nunca recibe la private key;
3. backup ordinario no contiene la private key;
4. restaurar un backup no restaura automáticamente la confianza;
5. clonar una instalación no produce un dispositivo confiable;
6. token de transporte no puede sustituir una firma de device trust;
7. una clave con otro `key_purpose` no verifica device trust;
8. una clave revocada deniega;
9. una clave desconocida deniega sin enumeración útil;
10. tenant/installation/device binding se verifica después de autenticar la evidencia firmada;
11. rotación conserva una cadena verificable;
12. ausencia de trust válido produce fail-closed.

## 4. Ownership

- `Devices` posee identidad y estado del dispositivo.
- `Licensing` posee licencia/activación comercial.
- `Authorization` posee autorización del usuario.
- `Sync` posee transporte, outbox/inbox y checkpoints.
- `Audit` posee evidencia auditable.
- La autoridad central administra el registro de confianza y su ciclo de vida, pero no adquiere ownership de las ventas, caja, pagos o inventario locales.

El trust bootstrap no crea un módulo global de seguridad que absorba estos owners.

## 5. Qué NO se decide aquí

Quedan fuera de esta propuesta y requieren decisión/implementación separada:

- proveedor concreto de KMS/HSM;
- formato final del certificado/attestation;
- proveedor de activación;
- TTL exacto de credenciales de device trust;
- endpoint productivo definitivo;
- despliegue de Central Authority;
- política comercial de reinstalación;
- recuperación de una private key perdida.

No se inventan valores operativos para cerrar artificialmente esos puntos.

## 6. Relación con componentes existentes

La propuesta reutiliza la maquinaria criptográfica existente donde corresponda:

- Ed25519;
- `canonicalJson`;
- `TrustedSigningKey`;
- `TrustedClockGuard`;
- separación por `key_purpose`;
- fail-closed;
- auditoría sanitizada.

No introduce una segunda canonicalización ni una segunda familia criptográfica.

El servidor de persistence gate sigue siendo exclusivamente evidencia de D-2. No se convierte por copia en Central Authority.

## 7. Ratificación de principios arquitectónicos — 2026-10-16

Se ratifican los siete principios de seguridad de esta propuesta para orientar la implementación, a partir de la autorización expresa del responsable del proyecto de resolver el bloqueo de confianza del dispositivo y cerrar la certificación. Esta ratificación **no equivale a despliegue ni a certificación de runtime**.

```text
[x] trust anchor público distribuido por artefacto firmado
[x] cadena root → operational DEVICE_TRUST key
[x] identidad privada generada localmente y protegida por el sistema
[x] enrollment con autorización de un solo uso/equivalente administrativo
[x] autenticación de dispositivo firmada sobre TLS
[x] revocación y rotación
[x] restore/clone no equivale a trust
```

La implementación sigue obligada a demostrar cada propiedad con pruebas ejecutables. No se autorizan claves privadas raíz en el POS/repositorio/CI, bearer estático como sustituto de device trust, credenciales ficticias, bypass de expiraciones ni excepciones para hacer verde la suite.

Los parámetros operativos enumerados en §5 siguen requiriendo valores reales y revisión antes de habilitar producción; no se inventarán proveedor KMS/HSM, claves, tokens, certificados, ni endpoints desplegados.

## 8. Consecuencia para D-3

Esta propuesta elimina la ambigüedad arquitectónica principal sin materializar todavía una raíz falsa ni credenciales de producción.

Después de su ratificación, D-3 puede avanzar por bloques implementables:

```text
trust verifier
→ device identity store
→ enrollment contract
→ central device registry
→ authenticated central boundary
→ Central Authority persistence
→ runtime integration
→ executable security/e2e gates
```
