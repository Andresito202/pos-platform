# DEC-022 — Origen de la raíz de confianza y exigencia de instalación sin conectividad

Estado:

`RATIFICADA — 2026-09-16`

Esta decisión resuelve B-1 y B-2 de G1.1/G1.1-F y autoriza la implementación D-3 conforme al modelo de confianza aquí definido. La ratificación no autoriza a inventar decisiones no contenidas aquí; las decisiones operativas restantes deben conservar separación de propósito, estado y ámbito.

## Decisión B-2 — La instalación debe poder completarse sin conectividad

**Sí.** Un equipo debe poder quedar instalado y con su material de confianza presente sin disponer de conexión en el momento de la instalación.

La arquitectura local-first y los modos `HYBRID`/`LOCAL_PERPETUAL` hacen de la conectividad una capacidad posterior, no un requisito de instalación. La instalación offline no implica que el POS pueda vender sin haber cumplido las condiciones de activación, autorización y sesión correspondientes.

## Decisión B-1 — La raíz de confianza es propia y se verifica fuera de banda

La raíz de confianza de Camacho POS Colombia es propia del producto. Su integridad se acredita mediante verificación fuera de banda de su huella, no mediante la firma del artefacto que la transporta.

La confianza se separa en tres clases:

| Clase | Rol |
|---|---|
| Plataforma | Integridad y distribución del binario |
| Transporte | Confidencialidad e integridad del canal |
| Firma Camacho | Autoridad criptográfica sobre licencias, SSA, SAS, snapshots maestros y actualizaciones |

La firma de plataforma no introduce confianza criptográfica de aplicación y TLS no sustituye las firmas de aplicación.

## Modelo operativo ratificado para D-3

```text
Trust root público propio
        ↓ fuera de banda
verificación de fingerprint
        ↓
operational DEVICE_TRUST key
        ↓
credencial/attestation del dispositivo
        ↓
installation_id + device_id + tenant/company
        ↓
Central Authority
```

La clave privada de dispositivo se genera localmente y nunca abandona el nodo. La renderer/preload layer no recibe secretos de infraestructura. Restaurar una copia de archivos o clonar una instalación no constituye confianza válida.

## B-3 — Separación por propósito

Se ratifica la separación de propósito criptográfico. `DEVICE_TRUST`, licencias, sesiones, snapshots maestros y actualización no se consideran intercambiables aunque utilicen Ed25519. Toda verificación debe exigir el propósito esperado y rechazar una clave válida para otro propósito.

El trust store puede ser físicamente compartido como estructura de almacenamiento si conserva `key_purpose` y las verificaciones aplican segregación estricta; no se permite una clave de un propósito como autoridad implícita de otro.

## B-4 — Estados de lifecycle

Los estados de lifecycle se mantienen semánticamente distintos. Como mínimo deben poder distinguirse `ACTIVE`, `REVOKED`, `COMPROMISED`, `RETIRED` y estados de provisión/validación que el contrato de la superficie requiera. No se permite colapsar estados con efectos de seguridad distintos en un único estado local que haga indistinguible una clave comprometida de una retirada normal.

La implementación puede proyectar estados en almacenamiento local, pero la decisión de autoridad central y el verifier deben conservar la semántica necesaria para fail-closed.

## B-6 — Ámbito

La raíz propia de producto es de confianza de producto por ambiente; las claves operativas `DEVICE_TRUST` son las que establecen el ámbito de autenticación de dispositivos. El binding de una credencial de dispositivo debe incluir como mínimo tenant/company/installation/device cuando esos identificadores formen parte del contrato de la superficie.

Una clave operativa no puede ampliar por sí sola el ámbito de una credencial ya emitida.

## Enrollment

El enrollment de dispositivo utiliza una activación de un solo uso o mecanismo equivalente, con binding verificable y evidencia auditable. La activación no es la raíz de confianza: autoriza el enrollment de una identidad criptográfica generada localmente.

La autoridad central emite la credencial; el POS local no se convierte en autoridad emisora.

## Reglas de implementación D-3

1. fail-closed para raíz, propósito, estado, ámbito, expiración y binding.
2. proof-of-possession Ed25519 para demostrar posesión de la clave privada.
3. TLS protege el transporte, pero no reemplaza la firma ni el trust root.
4. bearer tokens no son equivalentes a identidad criptográfica del dispositivo.
5. replay e idempotencia son propiedades obligatorias del enrollment.
6. revocación y rotación deben poder invalidar una credencial sin borrar evidencia histórica.
7. backups no incluyen la clave privada de identidad de dispositivo.
8. restore/clone no reactiva silenciosamente una identidad perdida.
9. todos los actos de aceptación de confianza/enrollment dejan evidencia sanitizada y reverificable.
10. la implementación debe distinguir `IMPLEMENTED`, `TESTED`, `RUNTIME_VERIFIED`, `CALLER_REACHABLE`, `END_TO_END` y `PRODUCTION`.

## Lo que NO autoriza

Esta ratificación no autoriza:

- reutilizar la firma de código como raíz de aplicación;
- introducir PKI empresarial no necesaria;
- compartir claves privadas con el renderer;
- crear una segunda autoridad local;
- copiar el persistence gate para convertirlo en Central Authority;
- reabrir Payment/Cash/Sale/Inventory ya aprobados sin evidencia de regresión;
- afirmar sesión real hasta conectar la cadena completa.

## Criterio de cierre D-3

D-3 no se considera terminado por documentación o compilación. El cierre exige, como mínimo:

```text
trust root verificado
→ operational DEVICE_TRUST key
→ device identity
→ one-shot enrollment
→ credential issuance
→ authenticated central boundary
→ device registry
→ session bootstrap
→ replay/revocation/security E2E
→ runtime evidence
```

## Ratificación

Ratificada expresamente por el usuario el `2026-09-16`, autorizando la implementación D-3 sobre la línea única activa `claude/pos-camacho-bloque-4c-ld43py`.
